import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShopStore } from '../../core/store';
import { LedgerEntry, PaymentMode } from '../../core/models';
import { addDays, addMonths, financialYearStart, startOfMonth, todayISO } from '../../core/dates';
import { downloadCsv } from '../../core/csv';
import { phoneDigits } from '../../core/format';
import { Icon } from '../../shared/icon';
import { DayPipe, InrPipe } from '../../shared/pipes';

type Flow = 'all' | 'debit' | 'credit';
type Preset = 'today' | 'month' | 'last-month' | '3m' | 'fy' | 'all' | 'custom';

const PAGE_DAYS = 30;
const MODES: PaymentMode[] = ['Cash', 'UPI', 'Card', 'Bank transfer', 'Cheque', 'Old gold'];

interface DayGroup {
  date: string;
  debit: number;
  credit: number;
  entries: Array<LedgerEntry & { customerName: string }>;
}

@Component({
  selector: 'app-ledger',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, InrPipe, DayPipe],
  templateUrl: './ledger.html',
  styleUrl: './ledger.scss',
})
export class LedgerPage {
  private readonly store = inject(ShopStore);

  /** `?type=debit|credit` */
  readonly type = input<string>();

  protected readonly modes = MODES;
  protected readonly flow = linkedSignal<Flow>(() => {
    const type = this.type();
    return type === 'debit' || type === 'credit' ? type : 'all';
  });
  protected readonly mode = signal<PaymentMode | ''>('');
  protected readonly query = signal('');
  protected readonly preset = signal<Preset>('3m');
  protected readonly from = signal(addMonths(startOfMonth(todayISO()), -2));
  protected readonly to = signal(todayISO());
  protected readonly dayLimit = signal(PAGE_DAYS);

  protected readonly filtered = computed(() => {
    const customers = this.store.customerById();
    const term = this.query().trim().toLowerCase();
    const digits = phoneDigits(term);
    const flow = this.flow();
    const mode = this.mode();
    const from = this.from();
    const to = this.to();
    return this.store
      .ledger()
      .filter((entry) => {
        if (flow !== 'all' && entry.type !== flow) return false;
        if (mode && entry.mode !== mode) return false;
        if (from && entry.date < from) return false;
        if (to && entry.date > to) return false;
        if (!term) return true;
        const customer = customers.get(entry.customerId);
        return (
          entry.ref.toLowerCase().includes(term) ||
          entry.particulars.toLowerCase().includes(term) ||
          (customer?.name.toLowerCase().includes(term) ?? false) ||
          (digits.length >= 3 && !!customer && phoneDigits(customer.phone).includes(digits))
        );
      })
      .map((entry) => ({ ...entry, customerName: customers.get(entry.customerId)?.name ?? 'Unknown' }));
  });

  protected readonly summary = computed(() => {
    let debit = 0;
    let credit = 0;
    let debitCount = 0;
    let creditCount = 0;
    for (const entry of this.filtered()) {
      if (entry.type === 'debit') {
        debit += entry.amount;
        debitCount++;
      } else {
        credit += entry.amount;
        creditCount++;
      }
    }
    return { debit, credit, net: debit - credit, debitCount, creditCount };
  });

  private readonly groups = computed<DayGroup[]>(() => {
    const groups: DayGroup[] = [];
    for (const entry of this.filtered()) {
      let group = groups[groups.length - 1];
      if (!group || group.date !== entry.date) {
        group = { date: entry.date, debit: 0, credit: 0, entries: [] };
        groups.push(group);
      }
      group.entries.push(entry);
      if (entry.type === 'debit') group.debit += entry.amount;
      else group.credit += entry.amount;
    }
    return groups;
  });

  protected readonly visibleGroups = computed(() => this.groups().slice(0, this.dayLimit()));
  protected readonly hiddenDays = computed(() => Math.max(this.groups().length - this.dayLimit(), 0));

  protected setPreset(preset: Preset): void {
    this.preset.set(preset);
    this.dayLimit.set(PAGE_DAYS);
    const today = todayISO();
    const ranges: Record<Exclude<Preset, 'custom'>, [string, string]> = {
      today: [today, today],
      month: [startOfMonth(today), today],
      'last-month': [addMonths(startOfMonth(today), -1), addDays(startOfMonth(today), -1)],
      '3m': [addMonths(startOfMonth(today), -2), today],
      fy: [financialYearStart(today), today],
      all: ['', ''],
    };
    if (preset !== 'custom') {
      const [from, to] = ranges[preset];
      this.from.set(from);
      this.to.set(to);
    }
  }

  protected setDate(which: 'from' | 'to', value: string): void {
    (which === 'from' ? this.from : this.to).set(value);
    this.preset.set('custom');
    this.dayLimit.set(PAGE_DAYS);
  }

  protected setFlow(flow: Flow): void {
    this.flow.set(flow);
    if (flow === 'debit') this.mode.set('');
  }

  protected exportCsv(): void {
    const rows = [...this.filtered()].reverse();
    downloadCsv(
      `msr-ledger-${this.from() || 'start'}-to-${this.to() || todayISO()}.csv`,
      ['Date', 'Voucher', 'Customer', 'Particulars', 'Mode', 'Debit', 'Credit'],
      rows.map((r) => [
        r.date,
        r.ref,
        r.customerName,
        r.particulars,
        r.mode ?? '',
        r.type === 'debit' ? r.amount : '',
        r.type === 'credit' ? r.amount : '',
      ]),
    );
  }
}
