import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Icon } from '../../shared/icon';

type SignedOutView = 'password' | 'forgot' | 'sent';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginPage {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);

  /** Where to go after signing in (`?next=/bills/new`). */
  readonly next = input<string>();

  protected readonly view = signal<SignedOutView>('password');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly code = signal('');
  protected readonly newPassword = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly enrolment = signal<{ factorId: string; qr: SafeUrl; secret: string } | null>(null);
  protected readonly showSecret = signal(false);

  private readonly codeField = viewChild<ElementRef<HTMLInputElement>>('codeField');

  constructor() {
    effect(() => {
      const stage = this.auth.stage();
      untracked(() => {
        this.error.set(null);
        this.code.set('');
        if (stage === 'ready') {
          const next = this.next();
          void this.router.navigateByUrl(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
        } else if (stage === 'enrol' && !this.enrolment()) {
          void this.beginEnrolment();
        } else if (stage === 'verify') {
          setTimeout(() => this.codeField()?.nativeElement.focus());
        }
      });
    });
  }

  private async attempt(task: () => Promise<string | null>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.error.set(await task());
    } finally {
      this.busy.set(false);
    }
  }

  protected signIn(): Promise<void> {
    if (!this.email().trim() || !this.password()) {
      this.error.set('Enter your email and password.');
      return Promise.resolve();
    }
    return this.attempt(() => this.auth.signIn(this.email(), this.password()));
  }

  protected onCodeInput(value: string): void {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    this.code.set(digits);
    // Six digits is a complete code: check it straight away, like a banking app.
    if (digits.length === 6) void (this.auth.stage() === 'enrol' ? this.confirmEnrolment() : this.verify());
  }

  protected verify(): Promise<void> {
    return this.attempt(async () => {
      const problem = await this.auth.verify(this.code());
      if (problem) this.code.set('');
      return problem;
    });
  }

  private async beginEnrolment(): Promise<void> {
    const result = await this.auth.startEnrolment();
    if (typeof result === 'string') {
      this.error.set(result);
      return;
    }
    this.enrolment.set({
      factorId: result.factorId,
      // Supabase returns the QR code as an SVG data URL from our own auth server.
      qr: this.sanitizer.bypassSecurityTrustUrl(result.qrCode),
      secret: result.secret,
    });
  }

  protected confirmEnrolment(): Promise<void> {
    const enrolment = this.enrolment();
    if (!enrolment) return Promise.resolve();
    return this.attempt(async () => {
      const problem = await this.auth.confirmEnrolment(enrolment.factorId, this.code());
      if (problem) this.code.set('');
      else this.enrolment.set(null);
      return problem;
    });
  }

  protected sendReset(): Promise<void> {
    if (!this.email().trim()) {
      this.error.set('Enter the email you sign in with.');
      return Promise.resolve();
    }
    return this.attempt(async () => {
      const problem = await this.auth.sendPasswordReset(this.email());
      if (!problem) this.view.set('sent');
      return problem;
    });
  }

  protected savePassword(): Promise<void> {
    const password = this.newPassword();
    if (password.length < 10) {
      this.error.set('Use at least 10 characters.');
      return Promise.resolve();
    }
    if (password !== this.confirmPassword()) {
      this.error.set('The two passwords do not match.');
      return Promise.resolve();
    }
    return this.attempt(() => this.auth.setNewPassword(password));
  }

  protected async useAnotherAccount(): Promise<void> {
    this.enrolment.set(null);
    this.view.set('password');
    this.password.set('');
    await this.auth.signOut();
  }

  protected checkAgain(): Promise<void> {
    return this.attempt(async () => {
      await this.auth.refresh();
      return this.auth.stage() === 'no-access' ? 'Still waiting. Ask an owner to choose your access in Settings.' : null;
    });
  }
}
