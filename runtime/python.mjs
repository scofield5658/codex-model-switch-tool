import {execFile} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile, rename, rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const metadata = ['pyproject.toml', 'uv.lock', '.python-version'];
const probe = `import sys, pathlib, tomllib, importlib.metadata as m
assert sys.version.split()[0] == sys.argv[1]
assert sys.prefix != sys.base_prefix
lock = tomllib.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
for p in lock['package']:
    if 'virtual' not in p['source']:
        assert m.version(p['name']) == p['version']
import tomlkit
`;

class PythonRuntimeError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function failure(code) {
  // Only stable codes cross the MCP boundary; subprocess output may contain local paths or credentials.
  return new PythonRuntimeError(code);
}

export function pythonEnvironment(env = process.env) {
  const clean = {...env};
  for (const key of ['PYTHONHOME', 'PYTHONPATH', 'PYTHONUSERBASE', 'PYTHONSTARTUP', 'VIRTUAL_ENV', 'CONDA_PREFIX']) delete clean[key];
  clean.PYTHONNOUSERSITE = '1';
  clean.PYTHONDONTWRITEBYTECODE = '1';
  return clean;
}

function runtimeDirectory(env) {
  if (env.MODEL_SWITCHER_RUNTIME_DIR) {
    if (!path.isAbsolute(env.MODEL_SWITCHER_RUNTIME_DIR)) throw failure('pythonRuntimePath');
    return env.MODEL_SWITCHER_RUNTIME_DIR;
  }
  const home = homedir();
  const data = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
    : process.platform === 'win32' ? env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
      : env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.join(home, '.local', 'share');
  return path.join(data, 'codex-model-switch-tool', 'runtimes');
}

async function findUv(env, remaining) {
  const candidates = env.MODEL_SWITCHER_UV ? [env.MODEL_SWITCHER_UV]
    : ['uv', path.join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv'),
      ...(process.platform === 'darwin' ? ['/opt/homebrew/bin/uv', '/usr/local/bin/uv'] : [])];
  for (const candidate of candidates) {
    try { await exec(candidate, ['--version'], {env, timeout: remaining(5000)}); return candidate; }
    catch (error) {
      if (error.killed || error.code === 'pythonSetupTimeout') throw failure('pythonSetupTimeout');
      // Try standard GUI-app locations if PATH is incomplete.
    }
  }
  throw failure('uvMissing');
}

export function createPythonRuntime({root, env = process.env, timeoutMs = 45000}) {
  let pending;
  async function prepare() {
    const deadline = Date.now() + timeoutMs;
    const remaining = (limit = timeoutMs) => {
      const left = deadline - Date.now();
      if (left <= 0) throw failure('pythonSetupTimeout');
      return Math.min(limit, left);
    };
    let files;
    try { files = await Promise.all(metadata.map(name => readFile(path.join(root, name), 'utf8'))); }
    catch { throw failure('pythonManifest'); }
    const pin = files[2].trim();
    if (!/^3\.\d+\.\d+$/.test(pin)) throw failure('pythonManifest');
    // Exclude the plugin path so a cache refresh or relocation can reuse the same environment.
    const id = createHash('sha256').update(JSON.stringify(['v2', process.platform, process.arch, ...files])).digest('hex');
    const directory = path.join(runtimeDirectory(env), id);
    const marker = path.join(directory, 'ready');
    const clean = pythonEnvironment(env);
    const interpreter = generation => path.join(directory, generation, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const verify = python => exec(python, ['-I', '-c', probe, pin, path.join(root, 'uv.lock')], {env: clean, timeout: remaining(10000), maxBuffer: 16384});
    async function existing() {
      try {
        const generation = await readFile(marker, 'utf8');
        if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/.test(generation)) return;
        const python = interpreter(generation);
        await verify(python);
        return python;
      } catch { /* Missing or damaged environments are replaced, never repaired in place. */ }
    }
    const ready = await existing();
    if (ready) return ready;
    const uv = await findUv(clean, remaining);
    await mkdir(directory, {recursive: true, mode: 0o700});
    // Keep only uv's network/cache controls; inherited resolver flags must not alter the lock contract.
    for (const key of Object.keys(clean)) {
      if (key.startsWith('UV_') && !['UV_CACHE_DIR', 'UV_PYTHON_INSTALL_DIR', 'UV_OFFLINE', 'UV_PYTHON_DOWNLOADS', 'UV_SYSTEM_CERTS', 'UV_NATIVE_TLS'].includes(key)) delete clean[key];
    }
    // Each initializer owns a new generation. Concurrent startup or repair cannot remove files
    // from an interpreter already returned to another MCP process.
    const generation = randomUUID();
    const owned = path.join(directory, generation);
    const python = interpreter(generation);
    clean.UV_PROJECT_ENVIRONMENT = path.join(owned, '.venv');
    try {
      await exec(uv, ['sync', '--locked', '--managed-python', '--python', pin, '--no-dev', '--no-config', '--no-progress', '--project', root],
        {env: clean, cwd: root, timeout: remaining(), killSignal: 'SIGKILL', maxBuffer: 1024 * 1024});
      await verify(python);
    } catch (error) {
      await rm(owned, {recursive: true, force: true}).catch(() => {});
      throw failure(error.killed || error.code === 'pythonSetupTimeout' ? 'pythonSetupTimeout' : 'pythonSetupFailed');
    }
    // Reuse a winner published while uv was running. Only remove our own unpublished generation.
    const winner = await existing();
    if (winner) { await rm(owned, {recursive: true, force: true}); return winner; }
    const temp = marker + '.' + randomUUID();
    try { await writeFile(temp, generation, {mode: 0o600}); await rename(temp, marker); }
    finally { await rm(temp, {force: true}); }
    return python;
  }
  return {
    ensure() {
      // Share first initialization; allow a retry after an installation or network failure.
      pending ??= prepare().catch(error => { pending = undefined; if(error instanceof PythonRuntimeError)throw error;
        const sanitized=failure('pythonSetupFailed');
        sanitized.cause={code:error.code,syscall:error.syscall};
        throw sanitized; });
      return pending;
    },
  };
}
