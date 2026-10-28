import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function createVisionBridge(root) {
  const python = path.join(root, '.venv', 'Scripts', 'python.exe');
  const model = path.join(root, 'models', 'yolox_s.onnx');
  const available = existsSync(python) && existsSync(model);
  let child, starting, nextId = 0, buffer = '';
  const pending = new Map();

  function failAll(message) {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error(message));
    }
    pending.clear();
    child = null;
    starting = null;
  }

  async function start() {
    if (!available) throw new Error('Local vision model is not installed.');
    if (child && !starting) return child;
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      const process = spawn(python, ['-u', 'scripts/vision_worker.py'], {
        cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
      });
      child = process;
      const readyTimer = setTimeout(() => {
        process.kill();
        reject(new Error('Local vision model did not start in time.'));
      }, 30000);
      process.stdout.setEncoding('utf8');
      process.stdout.on('data', chunk => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          let message;
          try { message = JSON.parse(line); } catch { continue; }
          if (message.ready) {
            clearTimeout(readyTimer);
            starting = null;
            resolve(process);
          } else if (pending.has(message.id)) {
            const { resolve: finish, reject: fail, timer } = pending.get(message.id);
            pending.delete(message.id); clearTimeout(timer);
            if (message.error) fail(new Error(message.error)); else finish(message);
          }
        }
      });
      process.on('error', error => { clearTimeout(readyTimer); reject(error); failAll('Local vision model stopped.'); });
      process.on('exit', () => { clearTimeout(readyTimer); reject(new Error('Local vision model exited.')); failAll('Local vision model stopped.'); });
    });
    return starting;
  }

  async function analyze(jpeg) {
    if (typeof jpeg !== 'string' || jpeg.length > 1_600_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(jpeg))
      throw new Error('Invalid JPEG frame.');
    const worker = await start();
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Vision analysis timed out.')); }, 30000);
      pending.set(id, { resolve, reject, timer });
      worker.stdin.write(JSON.stringify({ id, jpeg }) + '\n', error => {
        if (error && pending.has(id)) {
          clearTimeout(timer); pending.delete(id); reject(error);
        }
      });
    });
  }
  return { available, analyze };
}
