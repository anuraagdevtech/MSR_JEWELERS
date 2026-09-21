import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { CLOUD, ENV } from './env';

/** The shared Supabase client, or null in local mode. */
export const supabase: SupabaseClient | null = CLOUD
  ? createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

/** Turns a Supabase / PostgREST error into something a shopkeeper can act on. */
export function friendlyError(error: unknown): string {
  const e = error as { message?: string; code?: string } | null;
  const message = e?.message ?? String(error ?? 'Something went wrong');
  if (e?.code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'You do not have permission to do that. Ask an owner.';
  }
  if (/Failed to fetch|NetworkError|network/i.test(message)) {
    return 'No internet connection. Check the connection and try again.';
  }
  if (/JWT|session/i.test(message) && /expired|invalid/i.test(message)) {
    return 'Your session has ended. Please sign in again.';
  }
  return message;
}
