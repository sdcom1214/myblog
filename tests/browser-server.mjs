import { spawn } from 'node:child_process';
import { createApp } from '../server/app.js';

// Use the production static server and an isolated DB so browser checks never alter player data.
const app = createApp({ database: ':memory:' });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const test = spawn('python', ['tests/browser-online.py'], { stdio: 'inherit', env: { ...process.env, FOOTBALL_TEST_URL: `http://127.0.0.1:${app.server.address().port}` } });
test.once('error', async error => { process.stderr.write(error.message + '\n'); await app.close(); process.exit(1); });
test.once('exit', async code => { await app.close(); process.exit(code ?? 1); });
