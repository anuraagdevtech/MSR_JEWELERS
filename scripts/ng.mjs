// Runs the Angular CLI with the Supabase project settings baked in as build-time constants.
// Values come from the environment (e.g. Vercel project settings) or a local, git-ignored
// .env file. Without them the app runs in local mode: no login, data kept in this browser.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

function readDotEnv(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

const env = { ...readDotEnv('.env'), ...process.env };
const url = env.SUPABASE_URL ?? '';
const key = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || '';

const defines = [];
if (url && key) {
  defines.push('--define', `SUPABASE_URL=${JSON.stringify(url)}`);
  defines.push('--define', `SUPABASE_ANON_KEY=${JSON.stringify(key)}`);
  console.log(`Cloud mode: ${url}`);
} else {
  console.log('Local mode: SUPABASE_URL / SUPABASE_ANON_KEY not set, data stays in this browser.');
}

const child = spawn(process.execPath, ['node_modules/@angular/cli/bin/ng.js', ...process.argv.slice(2), ...defines], {
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
