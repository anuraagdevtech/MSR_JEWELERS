import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ShopStore } from './core/store';
import { UiService } from './core/ui.service';
import { Icon, IconName } from './shared/icon';
import { PaymentDialog } from './shared/payment-dialog';
import { CustomerDialog } from './shared/customer-dialog';
import { Toasts } from './shared/toasts';
import { GlobalSearch } from './shared/global-search';
import { InrPipe } from './shared/pipes';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    Icon,
    PaymentDialog,
    CustomerDialog,
    Toasts,
    GlobalSearch,
    InrPipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly store = inject(ShopStore);
  protected readonly ui = inject(UiService);
  private readonly router = inject(Router);

  protected readonly nav: NavItem[] = [
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { path: '/customers', label: 'Customers', icon: 'users' },
    { path: '/bills', label: 'Bills', icon: 'receipt' },
    { path: '/ledger', label: 'Credit & debit', icon: 'ledger' },
    { path: '/settings', label: 'Settings', icon: 'settings' },
  ];

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

  constructor() {
    // Close the mobile drawer whenever navigation completes.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.ui.navOpen.set(false));
  }
}
