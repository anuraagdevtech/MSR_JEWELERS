export type Role = 'admin' | 'billing' | 'analytics';
export type AccountRole = Role | 'pending';

export const ROLE_LABELS: Record<AccountRole, string> = {
  admin: 'Admin',
  billing: 'Billing',
  analytics: 'Analytics',
  pending: 'No access',
};

/** Old accounts retain their access after the Owner/Staff names change. */
export function normaliseRole(value: unknown): AccountRole {
  if (value === 'owner') return 'admin';
  if (value === 'staff') return 'billing';
  return value === 'admin' || value === 'billing' || value === 'analytics' ? value : 'pending';
}

export function permissionsFor(role: AccountRole | null) {
  return {
    manage: role === 'admin',
    bill: role === 'admin' || role === 'billing',
    analyse: role === 'admin' || role === 'analytics',
  };
}

export function homeForRole(role: AccountRole | null): string {
  return role === 'billing' ? '/counter' : '/dashboard';
}
