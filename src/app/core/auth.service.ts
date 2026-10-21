import { Injectable, computed, signal } from '@angular/core';
import { CLOUD } from './env';
import { friendlyError, supabase } from './supabase';
import { AccountRole, Role, ROLE_LABELS, normaliseRole, permissionsFor } from './roles';
import { DEMO_ACCOUNTS, findDemoAccount } from './demo-accounts';

export type { Role } from './roles';

/**
 * Where a visitor is in the sign-in journey:
 * signed-out → (password) → enrol | verify → ready, or no-access for users without a role.
 * "recovery" is the extra step after a password-reset link, once 2FA is passed.
 */
export type AuthStage = 'loading' | 'signed-out' | 'enrol' | 'verify' | 'no-access' | 'recovery' | 'ready';

export interface Profile {
  userId: string;
  email: string;
  fullName: string;
  role: AccountRole;
}

export interface Enrolment {
  factorId: string;
  qrCode: string;
  secret: string;
}

const IDLE_LIMIT_MS = 30 * 60 * 1000;
const DEMO_SESSION_KEY = 'msr-demo-account';

function restoreDemoProfile(): Profile | null {
  if (CLOUD) return null;
  try {
    const username = sessionStorage.getItem(DEMO_SESSION_KEY);
    const account = DEMO_ACCOUNTS.find((a) => a.username === username);
    return account ? { userId: `demo-${account.role}`, email: account.email, fullName: account.name, role: account.role } : null;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly cloud = CLOUD;
  readonly profile = signal<Profile | null>(restoreDemoProfile());
  readonly stage = signal<AuthStage>(CLOUD ? 'loading' : this.profile() ? 'ready' : 'signed-out');
  readonly email = signal('');
  /** Set when the session ended on its own, shown on the login screen. */
  readonly notice = signal<string | null>(null);

  readonly role = computed<Role | null>(() => {
    const role = this.profile()?.role;
    return role && role !== 'pending' ? role : null;
  });
  readonly permissions = computed(() => permissionsFor(this.role()));
  readonly isAdmin = computed(() => this.permissions().manage);
  readonly canBill = computed(() => this.permissions().bill);
  readonly canAnalyse = computed(() => this.permissions().analyse);
  readonly roleLabel = computed(() => ROLE_LABELS[this.role() ?? 'pending']);
  readonly displayName = computed(() => {
    const p = this.profile();
    return p?.fullName || p?.email.split('@')[0] || '';
  });

  private recovering = false;
  private lastActivity = Date.now();
  private readonly settled: Promise<void>;
  private resolveSettled!: () => void;

  constructor() {
    this.settled = new Promise((resolve) => (this.resolveSettled = resolve));
    if (!supabase) {
      this.resolveSettled();
      this.watchIdle();
      return;
    }
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') this.recovering = true;
      // Supabase advises not awaiting other auth calls inside this callback.
      setTimeout(() => void this.refresh());
    });
    void this.refresh().finally(() => this.resolveSettled());
    this.watchIdle();
  }

  /** Resolves once the first session check has finished. */
  whenSettled(): Promise<void> {
    return this.settled;
  }

  async refresh(): Promise<void> {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) {
      this.profile.set(null);
      this.email.set('');
      this.stage.set('signed-out');
      return;
    }
    this.email.set(session.user.email ?? '');

    const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError || !aal) {
      this.stage.set('signed-out');
      return;
    }
    if (aal.currentLevel !== 'aal2') {
      this.profile.set(null);
      this.stage.set(aal.nextLevel === 'aal2' ? 'verify' : 'enrol');
      return;
    }

    const { data: row } = await supabase
      .from('profiles')
      .select('user_id, email, full_name, role')
      .eq('user_id', session.user.id)
      .maybeSingle();
    const profile: Profile | null = row
      ? { userId: row.user_id, email: row.email, fullName: row.full_name ?? '', role: normaliseRole(row.role) }
      : null;
    this.profile.set(profile);

    if (!profile || profile.role === 'pending') {
      this.stage.set('no-access');
    } else if (this.recovering) {
      this.stage.set('recovery');
    } else {
      this.lastActivity = Date.now();
      this.stage.set('ready');
    }
  }

  async signIn(email: string, password: string): Promise<string | null> {
    this.notice.set(null);
    if (!supabase) {
      const account = findDemoAccount(email, password);
      if (!account) return 'Username or password is incorrect.';
      this.profile.set({ userId: `demo-${account.role}`, email: account.email, fullName: account.name, role: account.role });
      this.email.set(account.email);
      this.lastActivity = Date.now();
      try {
        sessionStorage.setItem(DEMO_SESSION_KEY, account.username);
      } catch {
        // The demo still works in memory when the browser blocks session storage.
      }
      this.stage.set('ready');
      return null;
    }
    const identifier = email.includes('@') ? email.trim() : `${email.trim().toLowerCase()}@msr.local`;
    const { error } = await supabase.auth.signInWithPassword({ email: identifier, password });
    if (error) {
      return /invalid login/i.test(error.message) ? 'Email or password is incorrect.' : friendlyError(error);
    }
    await this.refresh();
    return null;
  }

  /** Checks the 6-digit code from the authenticator app. */
  async verify(code: string): Promise<string | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) return friendlyError(error);
    const factor = data.totp.find((f) => f.status === 'verified');
    if (!factor) {
      this.stage.set('enrol');
      return null;
    }
    const result = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    if (result.error) return 'That code did not match. Check the time on your phone and try the newest code.';
    await this.refresh();
    return null;
  }

  /** First sign-in: registers an authenticator app and returns the QR code to scan. */
  async startEnrolment(): Promise<Enrolment | string> {
    if (!supabase) return 'Not connected';
    const { data: factors } = await supabase.auth.mfa.listFactors();
    for (const stale of factors?.all.filter((f) => f.status === 'unverified') ?? []) {
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16)}`,
      issuer: 'MSR Jewellers',
    });
    if (error || !data) return friendlyError(error);
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  }

  async confirmEnrolment(factorId: string, code: string): Promise<string | null> {
    if (!supabase) return null;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) return 'That code did not match. Scan the QR code again or wait for the next code.';
    await this.refresh();
    return null;
  }

  async sendPasswordReset(email: string): Promise<string | null> {
    if (!supabase) return null;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${location.origin}/login`,
    });
    return error ? friendlyError(error) : null;
  }

  async setNewPassword(password: string): Promise<string | null> {
    if (!supabase) return null;
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return friendlyError(error);
    this.recovering = false;
    await this.refresh();
    return null;
  }

  async signOut(reason?: string): Promise<void> {
    this.recovering = false;
    this.notice.set(reason ?? null);
    if (supabase) await supabase.auth.signOut();
    else {
      try {
        sessionStorage.removeItem(DEMO_SESSION_KEY);
      } catch {
        // Always clear the in-memory session, even if browser storage is blocked.
      }
    }
    this.profile.set(null);
    this.stage.set('signed-out');
  }

  /** Signs out after 30 minutes without a click or keypress, e.g. on the shop's shared PC. */
  private watchIdle(): void {
    const mark = () => (this.lastActivity = Date.now());
    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      window.addEventListener(type, mark, { passive: true });
    }
    setInterval(() => {
      if (this.stage() === 'ready' && Date.now() - this.lastActivity > IDLE_LIMIT_MS) {
        void this.signOut('Signed out after 30 minutes of inactivity.');
      }
    }, 60_000);
  }
}
