import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ShopStore } from '../core/store';
import { UiService } from '../core/ui.service';
import { AuthService } from '../core/auth.service';
import { Icon, IconName } from '../shared/icon';
import { PaymentDialog } from '../shared/payment-dialog';
import { CustomerDialog } from '../shared/customer-dialog';
import { GlobalSearch } from '../shared/global-search';
import { InrPipe } from '../shared/pipes';
import { initials } from '../core/format';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

const OWNER_NAV: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { path: '/reports', label: 'Reports', icon: 'chart' },
  { path: '/customers', label: 'Customers', icon: 'users' },
  { path: '/bills', label: 'Bills', icon: 'receipt' },
  { path: '/ledger', label: 'Credit & debit', icon: 'ledger' },
  { path: '/counter', label: 'Counter', icon: 'wallet' },
  { path: '/settings', label: 'Settings', icon: 'settings' },
];

const STAFF_NAV: NavItem[] = [
  { path: '/counter', label: 'Counter', icon: 'wallet' },
  { path: '/bills/new', label: 'New bill', icon: 'receipt' },
];

/** Sidebar, top bar and shared dialogs around every signed-in page. */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, PaymentDialog, CustomerDialog, GlobalSearch, InrPipe],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly store = inject(ShopStore);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly nav = computed(() => (this.auth.isOwner() ? OWNER_NAV : STAFF_NAV));
  protected readonly settings = this.store.settings;

  protected readonly rates = computed(() => {
    const rates = this.settings().rates;
    return [
      { label: '24K', value: rates['24K'] },
      { label: '22K', value: rates['22K'] },
      { label: '18K', value: rates['18K'] },
      { label: 'Silver', value: rates['999'] },
    ];
  });

  protected readonly ratesUpdated = computed(() => {
    const stamp = this.settings().ratesUpdatedAt;
    if (!stamp) return '';
    const date = new Date(stamp);
    return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
  });

  protected readonly ratesStale = computed(() => !this.settings().ratesUpdatedAt.startsWith(this.store.today()));

  protected readonly initials = computed(() => initials(this.auth.displayName()) || '?');

  constructor() {
    // Close the mobile drawer whenever navigation completes.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.ui.navOpen.set(false));
    // Signed out elsewhere (idle timer, another tab, expired session): back to the login screen.
    effect(() => {
      if (this.auth.stage() !== 'ready' && this.auth.stage() !== 'loading') {
        void this.router.navigateByUrl('/login');
      }
    });
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    void this.router.navigateByUrl('/login');
  }
}
