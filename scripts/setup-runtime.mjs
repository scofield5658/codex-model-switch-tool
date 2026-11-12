import path from 'node:path';
import {createPythonRuntime} from '../runtime/python.mjs';
import messages from '../locales/messages.json';

// Bundled as dist/setup-runtime.cjs for both repository and installed-plugin use.
const root = path.resolve(__dirname, '..');
async function setup() { try {
  const python = await createPythonRuntime({root, timeoutMs: 180000}).ensure();
  console.log('Python runtime ready: ' + python);
} catch (error) {
  console.error(messages[error.code]?.en || 'Python runtime setup failed. Check the application data directory permissions.');
  process.exitCode = 1;
} }
setup();
