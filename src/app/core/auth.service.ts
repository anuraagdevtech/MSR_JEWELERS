import { Injectable, computed, signal } from '@angular/core';
import { CLOUD } from './env';
import { friendlyError, supabase } from './supabase';

export type Role = 'owner' | 'staff';

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
  role: Role | 'pending';
}

export interface Enrolment {
  factorId: string;
  qrCode: string;
  secret: string;
}

const IDLE_LIMIT_MS = 30 * 60 * 1000;
const LOCAL_PROFILE: Profile = { userId: 'local', email: '', fullName: 'Owner', role: 'owner' };

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly cloud = CLOUD;
  readonly stage = signal<AuthStage>(CLOUD ? 'loading' : 'ready');
  readonly profile = signal<Profile | null>(CLOUD ? null : LOCAL_PROFILE);
  readonly email = signal('');
  /** Set when the session ended on its own, shown on the login screen. */
  readonly notice = signal<string | null>(null);

  readonly role = computed<Role | null>(() => {
    const role = this.profile()?.role;
    return role === 'owner' || role === 'staff' ? role : null;
  });
  readonly isOwner = computed(() => this.role() === 'owner');
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
      ? { userId: row.user_id, email: row.email, fullName: row.full_name ?? '', role: row.role }
      : null;
    this.profile.set(profile);

    if (!profile || (profile.role !== 'owner' && profile.role !== 'staff')) {
      this.stage.set('no-access');
    } else if (this.recovering) {
      this.stage.set('recovery');
    } else {
      this.lastActivity = Date.now();
      this.stage.set('ready');
    }
  }

  async signIn(email: string, password: string): Promise<string | null> {
    if (!supabase) return null;
    this.notice.set(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
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
