import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ShopStore } from '../../core/store';
import { GoldRateService } from '../../core/gold-rate.service';
import { ThemePreference, UiService } from '../../core/ui.service';
import { Purity, RateCard, ShopSettings } from '../../core/models';
import { ALL_PURITIES, deriveRates, purityLabel } from '../../core/calc';
import { todayISO } from '../../core/dates';
import { downloadFile } from '../../core/csv';
import { Icon } from '../../shared/icon';
import { InrPipe } from '../../shared/pipes';

type ProfileFields = Omit<ShopSettings, 'rates' | 'ratesUpdatedAt'>;

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon, InrPipe],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class SettingsPage {
  protected readonly store = inject(ShopStore);
  protected readonly market = inject(GoldRateService);
  protected readonly ui = inject(UiService);

  protected readonly purities = ALL_PURITIES;
  protected readonly purityLabel = purityLabel;

  protected readonly rates = signal<RateCard>({ ...this.store.settings().rates });
  protected readonly profile = signal<ProfileFields>(this.pickProfile());

  protected readonly ratesDirty = computed(() =>
    ALL_PURITIES.some((p) => Number(this.rates()[p]) !== this.store.settings().rates[p]),
  );

  protected readonly ratesUpdated = computed(() =>
    new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(this.store.settings().ratesUpdatedAt),
    ),
  );

  protected readonly counts = computed(() => ({
    customers: this.store.customers().length,
    bills: this.store.bills().length,
    payments: this.store.payments().length,
  }));

  protected readonly themes: { key: ThemePreference; label: string; icon: 'monitor' | 'sun' | 'moon' }[] = [
    { key: 'auto', label: 'Match device', icon: 'monitor' },
    { key: 'light', label: 'Light', icon: 'sun' },
    { key: 'dark', label: 'Dark', icon: 'moon' },
  ];

  constructor() {
    if (!this.market.reference() && !this.market.loading()) void this.market.refresh();
  }

  private pickProfile(): ProfileFields {
    const { rates: _rates, ratesUpdatedAt: _updated, ...profile } = this.store.settings();
    return { ...profile };
  }

  protected setRate(purity: Purity, value: number | null): void {
    this.rates.update((rates) => ({ ...rates, [purity]: Number(value) || 0 }));
  }

  protected deriveFrom24K(): void {
    const current = this.rates();
    this.rates.set(deriveRates(Number(current['24K']) || 0, Number(current['999']) || 0));
  }

  protected useMarket(): void {
    const ref = this.market.reference();
    if (!ref) return;
    this.rates.set(deriveRates(ref.gold24PerGram, ref.silver999PerGram ?? this.rates()['999']));
  }

  protected saveRates(): void {
    const rates = this.rates();
    if (ALL_PURITIES.some((p) => !(Number(rates[p]) > 0))) {
      this.ui.toast('Every rate must be greater than zero.', 'error');
      return;
    }
    this.store.updateRates(rates);
    this.ui.toast('Board rates updated for today');
  }

  protected updateProfile<K extends keyof ProfileFields>(key: K, value: ProfileFields[K]): void {
    this.profile.update((p) => ({ ...p, [key]: value }));
  }

  protected saveProfile(): void {
    const p = this.profile();
    if (!p.shopName.trim()) {
      this.ui.toast('Shop name cannot be empty.', 'error');
      return;
    }
    this.store.updateSettings({
      ...p,
      shopName: p.shopName.trim(),
      billPrefix: p.billPrefix.trim().toUpperCase() || 'MSR',
      receiptPrefix: p.receiptPrefix.trim().toUpperCase() || 'RC',
      creditDays: Math.max(Math.round(Number(p.creditDays) || 30), 1),
      gstPercent: Math.max(Number(p.gstPercent) || 0, 0),
    });
    this.profile.set(this.pickProfile());
    this.ui.toast('Shop details saved');
  }

  protected exportBackup(): void {
    downloadFile(`msr-jewelers-backup-${todayISO()}.json`, this.store.exportJSON(), 'application/json');
    this.ui.toast('Backup downloaded');
  }

  protected async importBackup(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!confirm(`Replace all current data with the backup "${file.name}"? Export a backup first if unsure.`)) return;
    try {
      this.store.importJSON(await file.text());
      this.rates.set({ ...this.store.settings().rates });
      this.profile.set(this.pickProfile());
      this.ui.toast('Backup restored');
    } catch (error) {
      this.ui.toast(error instanceof Error ? error.message : 'Could not read that file.', 'error');
    }
  }

  protected resetDemo(): void {
    if (!confirm('Replace every customer, bill and payment with sample data? Shop details and rates are kept.')) return;
    this.store.resetToDemo();
    this.ui.toast('Sample data loaded', 'info');
  }

  protected clearAll(): void {
    const isDemo = this.store.isDemo();
    if (!confirm(isDemo
      ? 'Erase the sample customers, bills and payments and start your own book?'
      : 'Erase ALL customers, bills and payments from this browser? This cannot be undone.')) return;
    if (!isDemo && !confirm('Last check: have you downloaded a backup? Erase everything?')) return;
    this.store.clearAll();
    this.ui.toast('All records erased. Shop details kept.', 'info');
  }
}
