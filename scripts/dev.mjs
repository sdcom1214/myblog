import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const children = [spawn(process.execPath, ['server/app.js'], { stdio: 'inherit', env: { ...process.env, API_PORT: process.env.API_PORT || '4174' } }), spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), ...process.argv.slice(2)], { stdio: 'inherit', env: process.env })];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); Promise.all(children.map(child => new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)))).then(() => process.exit(code)); }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
for (const child of children) { child.once('error', () => stop(1)); child.once('exit', code => { if (!stopping) stop(code || 1); }); }
