import { Role } from './roles';

/** Public test credentials, accepted only when no Supabase database is connected. */
export const DEMO_ACCOUNTS: ReadonlyArray<{
  username: string;
  email: string;
  password: string;
  name: string;
  role: Role;
}> = [
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

export function findDemoAccount(username: string, password: string) {
  const value = username.trim().toLowerCase();
  return DEMO_ACCOUNTS.find(
    (a) => (a.username === value || a.email === value) && a.password === password,
  );
}
