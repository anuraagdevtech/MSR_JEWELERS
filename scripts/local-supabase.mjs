// Creates an isolated development database and dummy accounts. Never targets a hosted URL.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

export const LOCAL_ENV_FILE = '.env.supabase.local';
export const testAccounts = [
  {
    username: 'admin',
    email: 'admin@msr.local',
    password: 'AdminDemo!2026',
    name: 'Demo Admin',
    role: 'admin',
  },
  {
    username: 'billing',
    email: 'billing@msr.local',
    password: 'BillingDemo!2026',
    name: 'Demo Billing',
    role: 'billing',
  },
  {
    username: 'analytics',
    email: 'analytics@msr.local',
    password: 'AnalyticsDemo!2026',
    name: 'Demo Analytics',
    role: 'analytics',
  },
];

export function readLocalEnv() {
  return Object.fromEntries(
    readFileSync(LOCAL_ENV_FILE, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
}

export function assertLocal(env) {
  for (const name of ['SUPABASE_URL', 'SUPABASE_DB_URL']) {
    const host = new URL(env[name]).hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host))
      throw new Error('Dummy account setup is limited to a local database.');
  }
}

export async function initialiseLocal(env) {
  assertLocal(env);
  const sql = postgres(env.SUPABASE_DB_URL, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(readFileSync('supabase/schema.sql', 'utf8'));
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.admin.listUsers();
    if (error) throw error;
    for (const account of testAccounts) {
      let user = data.users.find((u) => u.email === account.email);
      if (!user) {
        const result = await client.auth.admin.createUser({
          email: account.email,
          password: account.password,
          email_confirm: true,
          user_metadata: { full_name: account.name },
        });
        if (result.error) throw result.error;
        user = result.data.user;
      }
      // Use the real database role, never editable user_metadata, for access decisions.
      await sql`update public.profiles set role = ${account.role}, full_name = ${account.name} where user_id = ${user.id}`;
      console.log(`Ready: ${account.username} (${account.role})`);
    }
  } finally {
    await sql.end();
  }
}

async function main() {
  const command = process.argv[2] ?? 'setup';
  if (command === 'setup' || command === 'start') {
    const args = [
      'node_modules/supabase/dist/supabase.js',
      'start',
      '--runtime',
      'native',
      '--preparation',
      'on-demand',
      '--exclude',
      'storage,functions,analytics,pooler',
      '--output-format',
      'json',
    ];
    const child = spawnSync(process.execPath, args, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    if (child.status !== 0) throw new Error(child.stderr || 'Supabase did not start.');
    const status = JSON.parse(child.stdout);
    const env = status.env;
    const values = {
      SUPABASE_URL: env.API_URL,
      SUPABASE_ANON_KEY: env.ANON_KEY || env.PUBLISHABLE_KEY,
      SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY || env.SECRET_KEY,
      SUPABASE_DB_URL: env.DB_URL,
    };
    writeFileSync(
      LOCAL_ENV_FILE,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') + '\n',
      { mode: 0o600 },
    );
    chmodSync(LOCAL_ENV_FILE, 0o600);
    console.log(`Local Supabase: ${env.API_URL}\nStudio: ${env.STUDIO_URL}`);
  }
  await initialiseLocal(readLocalEnv());
  console.log('Run npm run start:supabase to open the database-backed app.');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/local-supabase.mjs')) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
