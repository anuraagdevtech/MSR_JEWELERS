// Replaced at build time by scripts/ng.mjs (--define). Unset means local mode.
declare const SUPABASE_URL: string | undefined;
declare const SUPABASE_ANON_KEY: string | undefined;

export const ENV = {
  supabaseUrl: typeof SUPABASE_URL === 'string' ? SUPABASE_URL : '',
  supabaseAnonKey: typeof SUPABASE_ANON_KEY === 'string' ? SUPABASE_ANON_KEY : '',
};

/** True when the app is connected to Supabase (login, 2FA and shared data). */
export const CLOUD = !!(ENV.supabaseUrl && ENV.supabaseAnonKey);
