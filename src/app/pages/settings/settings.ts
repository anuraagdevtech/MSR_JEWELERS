import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ShopStore } from '../../core/store';
import { GoldRateService } from '../../core/gold-rate.service';
import { ThemePreference, UiService } from '../../core/ui.service';
import { Purity, RateCard, ShopSettings } from '../../core/models';
import { ALL_PURITIES, deriveRates, purityLabel } from '../../core/calc';
import { todayISO } from '../../core/dates';
import { downloadFile } from '../../core/csv';
import { AuthService } from '../../core/auth.service';
import { supabase } from '../../core/supabase';
import { Icon } from '../../shared/icon';
import { InrPipe } from '../../shared/pipes';

type ProfileFields = Omit<ShopSettings, 'rates' | 'ratesUpdatedAt' | 'sampleData'>;

interface TeamMember {
  userId: string;
  email: string;
  fullName: string;
  role: 'owner' | 'staff' | 'pending';
  isMe: boolean;
}

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
  protected readonly auth = inject(AuthService);
  protected readonly busy = signal(false);

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
    if (this.store.cloud) void this.loadTeam();
  }

  private pickProfile(): ProfileFields {
    const { rates: _rates, ratesUpdatedAt: _updated, sampleData: _sample, ...profile } = this.store.settings();
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

  /** Runs a save, showing its progress and any error as a toast. */
  private async run(task: () => Promise<unknown>, success: string, tone: 'success' | 'info' = 'success'): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    try {
      await task();
      this.ui.toast(success, tone);
      return true;
    } catch (error) {
      this.ui.toast(error instanceof Error ? error.message : 'Something went wrong.', 'error');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveRates(): Promise<void> {
    const rates = this.rates();
    if (ALL_PURITIES.some((p) => !(Number(rates[p]) > 0))) {
      this.ui.toast('Every rate must be greater than zero.', 'error');
      return;
    }
    await this.run(() => this.store.updateRates(rates), 'Board rates updated for today');
  }

  protected updateProfile<K extends keyof ProfileFields>(key: K, value: ProfileFields[K]): void {
    this.profile.update((p) => ({ ...p, [key]: value }));
  }

  protected async saveProfile(): Promise<void> {
    const p = this.profile();
    if (!p.shopName.trim()) {
      this.ui.toast('Shop name cannot be empty.', 'error');
      return;
    }
    const saved = await this.run(
      () =>
        this.store.updateSettings({
          ...p,
          shopName: p.shopName.trim(),
          billPrefix: p.billPrefix.trim().toUpperCase() || 'MSR',
          receiptPrefix: p.receiptPrefix.trim().toUpperCase() || 'RC',
          creditDays: Math.max(Math.round(Number(p.creditDays) || 30), 1),
          gstPercent: Math.max(Number(p.gstPercent) || 0, 0),
        }),
      'Shop details saved',
    );
    if (saved) this.profile.set(this.pickProfile());
  }

  protected exportBackup(): void {
    downloadFile(`msr-jewellers-backup-${todayISO()}.json`, this.store.exportJSON(), 'application/json');
    this.ui.toast('Backup downloaded');
  }

  protected async importBackup(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!confirm(`Replace all current data with the backup "${file.name}"? Export a backup first if unsure.`)) return;
    const text = await file.text();
    const restored = await this.run(() => this.store.importJSON(text), 'Backup restored');
    if (restored) {
      this.rates.set({ ...this.store.settings().rates });
      this.profile.set(this.pickProfile());
    }
  }

  protected async resetDemo(): Promise<void> {
    if (!confirm('Replace every customer, bill and payment with sample data? Shop details and rates are kept.')) return;
    await this.run(() => this.store.resetToDemo(), 'Sample data loaded', 'info');
  }

  protected async clearAll(): Promise<void> {
    const isDemo = this.store.isDemo();
    const where = this.store.cloud ? 'for everyone' : 'from this browser';
    if (!confirm(isDemo
      ? 'Erase the sample customers, bills and payments and start your own book?'
      : `Erase ALL customers, bills and payments ${where}? This cannot be undone.`)) return;
    if (!isDemo && !confirm('Last check: have you downloaded a backup? Erase everything?')) return;
    await this.run(() => this.store.clearAll(), 'All records erased. Shop details kept.', 'info');
  }

  // ---- Team (cloud mode) ---------------------------------------------------------------

  protected readonly team = signal<TeamMember[]>([]);
  protected readonly teamLoading = signal(false);

  protected async loadTeam(): Promise<void> {
    if (!supabase) return;
    this.teamLoading.set(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, email, full_name, role, created_at')
      .order('created_at');
    this.teamLoading.set(false);
    if (error) {
      this.ui.toast(error.message, 'error');
      return;
    }
    this.team.set(
      (data ?? []).map((row) => ({
        userId: row.user_id,
        email: row.email,
        fullName: row.full_name ?? '',
        role: row.role,
        isMe: row.user_id === this.auth.profile()?.userId,
      })),
    );
  }

  protected async setRole(member: TeamMember, role: TeamMember['role']): Promise<void> {
    if (!supabase || member.role === role) return;
    if (role === 'owner' && !confirm(`Make ${member.email} an owner? Owners see all accounts and can delete records.`)) {
      await this.loadTeam();
      return;
    }
    const db = supabase;
    const label = role === 'pending' ? 'Access removed' : `${member.email} is now ${role === 'owner' ? 'an owner' : 'counter staff'}`;
    await this.run(async () => {
      const { error } = await db.from('profiles').update({ role }).eq('user_id', member.userId);
      if (error) throw new Error(error.message);
    }, label);
    await this.loadTeam();
  }
}
