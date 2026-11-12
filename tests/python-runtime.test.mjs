import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, cp, readFile, writeFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);
const root = process.cwd();
const module = await import('../runtime/python.mjs').catch(() => ({}));
const create = options => {
  assert.equal(typeof module.createPythonRuntime, 'function', 'A managed runtime must replace system Python');
  return module.createPythonRuntime(options);
};

test('managed Python survives plugin relocation, ignores ambient Python, and reuses an offline environment', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'switcher-runtime-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  const env = {...process.env, MODEL_SWITCHER_RUNTIME_DIR: path.join(temp, 'data with spaces'), PYTHONHOME: '/invalid', PYTHONPATH: '/invalid', MODEL_SWITCHER_PYTHON: '/invalid'};
  const runtime = create({root, env});
  const [python, parallel, concurrent] = await Promise.all([runtime.ensure(), runtime.ensure(), create({root, env}).ensure()]);
  assert.equal(python, parallel);
  await exec(concurrent, ['-I', '-c', 'import tomlkit']);
  assert(python.startsWith(env.MODEL_SWITCHER_RUNTIME_DIR + path.sep));
  const {stdout} = await exec(python, ['-I', '-c', 'import sys,tomlkit; print(sys.version.split()[0]); print(tomlkit.__version__); print(sys.prefix != sys.base_prefix)']);
  assert.deepEqual(stdout.trim().split('\n'), ['3.12.13', '0.13.3', 'True']);
  const active = await create({root, env}).ensure();
  const before = (await stat(active)).mtimeMs;
  const moved = path.join(temp, 'relocated plugin');
  await mkdir(moved);
  await cp(root + '/pyproject.toml', moved + '/pyproject.toml');
  for (const name of ['uv.lock', '.python-version']) await cp(path.join(root, name), path.join(moved, name));
  const offline = create({root: moved, env: {...env, MODEL_SWITCHER_UV: '/missing-uv', UV_OFFLINE: '1'}});
  assert.equal(await offline.ensure(), active);
  assert.equal((await stat(active)).mtimeMs, before);
  // Changing the dependency contract must select a different environment, never mutate the old one.
  await writeFile(path.join(moved, 'pyproject.toml'), (await readFile(path.join(moved, 'pyproject.toml'), 'utf8')) + '\n# changed contract\n');
  await assert.rejects(create({root: moved, env: {...env, MODEL_SWITCHER_UV: '/missing-uv'}}).ensure(), {code: 'uvMissing'});
  assert.equal((await stat(active)).mtimeMs, before);
});

test('damaged dependency files are repaired from the uv cache', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'switcher-repair-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  const env = {...process.env, MODEL_SWITCHER_RUNTIME_DIR: temp};
  const python = await create({root, env}).ensure();
  const {stdout} = await exec(python, ['-I', '-c', 'import pathlib,tomlkit; print(pathlib.Path(tomlkit.__file__).parent)']);
  assert(stdout.trim().startsWith(temp + path.sep));
  await rm(stdout.trim(), {recursive: true});
  const repaired = await create({root, env: {...env, UV_OFFLINE: '1'}}).ensure();
  assert.notEqual(repaired, python);
  await exec(repaired, ['-I', '-c', 'import tomlkit']);
  // An interrupted first setup can leave package metadata without files or a ready marker.
  await rm(path.join(path.dirname(path.dirname(path.dirname(path.dirname(repaired)))), 'ready'));
  const broken = await exec(repaired, ['-I', '-c', 'import pathlib,tomlkit; print(pathlib.Path(tomlkit.__file__).parent)']);
  await rm(broken.stdout.trim(), {recursive: true});
  const recovered = await create({root, env: {...env, UV_OFFLINE: '1'}}).ensure();
  assert.notEqual(recovered, repaired);
  await exec(recovered, ['-I', '-c', 'import tomlkit']);
});

test('missing uv fails explicitly without a system Python fallback', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'switcher-no-uv-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  await assert.rejects(create({root, env: {...process.env, MODEL_SWITCHER_RUNTIME_DIR: temp, MODEL_SWITCHER_UV: '/missing-uv'}}).ensure(), {code: 'uvMissing'});
});

test('Python interpreter isolation preserves provider credentials from unrelated environment variables', () => {
  assert.equal(typeof module.pythonEnvironment, 'function');
  const clean = module.pythonEnvironment({PYTHONHOME: '/invalid', PYTHONPATH: '/invalid', VIRTUAL_ENV: '/invalid', PYTHON_SERVICE_API_KEY: 'fixture-only', PATH: '/bin'});
  assert.equal(clean.PYTHON_SERVICE_API_KEY, 'fixture-only');
  assert.equal(clean.PYTHONHOME, undefined);
  assert.equal(clean.PYTHONPATH, undefined);
  assert.equal(clean.VIRTUAL_ENV, undefined);
});

test('an incomplete environment is retryable after offline initialization fails', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'switcher-offline-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  const env = {...process.env, MODEL_SWITCHER_RUNTIME_DIR: temp, UV_CACHE_DIR: path.join(temp, 'cache'), UV_PYTHON_INSTALL_DIR: path.join(temp, 'pythons'), UV_OFFLINE: '1'};
  const runtime = create({root, env});
  await assert.rejects(runtime.ensure(), {code: 'pythonSetupFailed'});
  await assert.rejects(runtime.ensure(), {code: 'pythonSetupFailed'});
});

test('missing metadata and relative runtime directories fail with actionable codes', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'switcher-metadata-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  await assert.rejects(create({root: temp}).ensure(), {code: 'pythonManifest'});
  await assert.rejects(create({root, env: {...process.env, MODEL_SWITCHER_RUNTIME_DIR: 'relative'}}).ensure(), {code: 'pythonRuntimePath'});
  const blocked = path.join(temp, 'not-a-directory');
  await writeFile(blocked, 'fixture');
  await assert.rejects(create({root, env: {...process.env, MODEL_SWITCHER_RUNTIME_DIR: blocked}}).ensure(), {code: 'pythonSetupFailed'});
});

test('uv setup is time bounded and subprocess diagnostics are not exposed', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'switcher-timeout-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  const fakeUv = path.join(temp, 'uv');
  await writeFile(fakeUv, `#!${process.execPath}\nif(process.argv.includes('--version'))process.exit(0);process.stderr.write('SECRET_TEST_SENTINEL');setInterval(()=>{},1000);`, {mode: 0o700});
  await assert.rejects(create({root, env: {...process.env, MODEL_SWITCHER_RUNTIME_DIR: temp, MODEL_SWITCHER_UV: fakeUv}, timeoutMs: 100}).ensure(), error => {
    assert.equal(error.code, 'pythonSetupTimeout');
    assert(!error.message.includes('SECRET_TEST_SENTINEL'));
    return true;
  });
});

test('concurrent recovery never exposes another repair process to partially installed packages', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'switcher-concurrent-repair-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  const env = {...process.env, MODEL_SWITCHER_RUNTIME_DIR: temp};
  const python = await create({root, env}).ensure();
  const {stdout} = await exec(python, ['-I', '-c', 'import pathlib,tomlkit; print(pathlib.Path(tomlkit.__file__).parent)']);
  await rm(stdout.trim(), {recursive: true});
  const results = await Promise.allSettled(Array.from({length: 20}, async () => {
    const ready = await create({root, env}).ensure();
    await exec(ready, ['-I', '-c', 'import tomlkit.container,tomlkit._utils']);
    return ready;
  }));
  assert.equal(results.filter(r => r.status === 'rejected').length, 0, 'Every concurrent request must receive a complete environment');
});

test('a stalled uv version probe is reported as timeout rather than missing uv', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'switcher-probe-timeout-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  const fakeUv = path.join(temp, 'uv');
  await writeFile(fakeUv, `#!${process.execPath}\nsetInterval(()=>{},1000);`, {mode: 0o700});
  await assert.rejects(create({root, env: {...process.env, MODEL_SWITCHER_RUNTIME_DIR: temp, MODEL_SWITCHER_UV: fakeUv}, timeoutMs: 100}).ensure(), {code: 'pythonSetupTimeout'});
});
