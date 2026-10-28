import { spawn } from 'node:child_process';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chatCompletionUrl } from '../ai_explain.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const io = createInterface({ input: process.stdin, output: process.stdout });
const question = prompt => new Promise(resolve => io.question(prompt, resolve));

console.log('Match for Every Fan - Demo V5 - Microsoft Foundry');
console.log('Your API key is used only by this local server and is not saved.');
const endpoint = (await question('Resource endpoint (https://...openai.azure.com): ')).trim();
const visionInput = (await question('Image model deployment [gpt-4o]: ')).trim();
io.close();
const visionDeployment = visionInput || 'gpt-4o';
try {
  chatCompletionUrl(endpoint);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(visionDeployment))
    throw new Error('Invalid image model deployment name.');
} catch (error) {
  console.error(`Configuration error: ${error.message}`);
  process.exit(1);
}

if (!process.stdin.isTTY) {
  console.error('Open this launcher in a terminal to enter the API key privately.');
  process.exit(1);
}

function secretPrompt() {
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write('API key (hidden): ');
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const done = (error) => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onKey = (char, key) => {
      if (key?.ctrl && key.name === 'c') return done(new Error('Cancelled.'));
      if (key?.name === 'return' || key?.name === 'enter') return done();
      if (key?.name === 'backspace') {
        if (value.length) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
      } else if (char && !key?.ctrl && !key?.meta && char >= ' ' && char !== '\x7f') {
        value += char;
        process.stdout.write('*');
      }
    };
    process.stdin.on('keypress', onKey);
  });
}

let apiKey;
try { apiKey = (await secretPrompt()).trim(); }
catch (error) { console.error(error.message); process.exit(1); }
if (!apiKey) { console.error('The API key cannot be empty.'); process.exit(1); }

console.log('Open http://127.0.0.1:3008 and turn on AI mode when you want commentary.');
console.log('While AI mode is on, sampled frames are sent to the image model about every three seconds (maximum 36 requests per launch).');
console.log('Keep this window open. Close it to stop the server.');
const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, HOST: '127.0.0.1', PORT: '3008', AZURE_OPENAI_ENDPOINT: endpoint,
    AZURE_OPENAI_DEPLOYMENT: '', AZURE_OPENAI_VISION_DEPLOYMENT: visionDeployment,
    AZURE_OPENAI_API_KEY: apiKey },
  stdio: 'inherit'
});
apiKey = '';
child.on('error', error => { console.error(`Could not start server: ${error.message}`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
