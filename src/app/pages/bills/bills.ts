import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ShopStore } from '../../core/store';
import { addDays, addMonths, financialYearStart, startOfMonth, todayISO } from '../../core/dates';
import { downloadCsv } from '../../core/csv';
import { Icon } from '../../shared/icon';
import { StatusChip } from '../../shared/status-chip';
import { DayPipe, GramsPipe, InrPipe } from '../../shared/pipes';

type Segment = 'all' | 'open' | 'overdue' | 'paid';
type Preset = 'all' | 'month' | 'last-month' | 'fy' | 'custom';

const PAGE = 40;

@Component({
  selector: 'app-bills',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, StatusChip, InrPipe, DayPipe, GramsPipe],
  templateUrl: './bills.html',
  styles: `
    .items-cell {
      max-width: 260px;
      color: var(--text-2);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @media (max-width: 900px) {
      .hide-md {
        display: none;
      }
    }
  `,
})
export class BillsPage {
  private readonly store = inject(ShopStore);
  private readonly router = inject(Router);

  readonly status = input<string>();

  protected readonly segment = linkedSignal<Segment>(() => {
    const status = this.status();
    return status === 'open' || status === 'overdue' || status === 'paid' ? status : 'all';
  });
  protected readonly query = signal('');
  protected readonly preset = signal<Preset>('all');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly limit = signal(PAGE);

  private readonly all = computed(() => {
    const totals = this.store.billTotals();
    const statuses = this.store.billStatus();
    const customers = this.store.customerById();
    return this.store
      .bills()
      .map((bill) => ({
        bill,
        totals: totals.get(bill.id)!,
        status: statuses.get(bill.id),
        customer: customers.get(bill.customerId),
        items: bill.items.map((i) => i.description).join(', '),
      }))
      .sort((a, b) => b.bill.date.localeCompare(a.bill.date) || b.bill.createdAt.localeCompare(a.bill.createdAt));
  });

  protected readonly segments = computed(() => {
    const rows = this.all();
    return [
      { key: 'all' as Segment, label: 'All bills', count: rows.length },
      { key: 'open' as Segment, label: 'Balance due', count: rows.filter((r) => (r.status?.balance ?? 0) > 0).length },
      { key: 'overdue' as Segment, label: 'Overdue', count: rows.filter((r) => r.status?.overdue).length },
      { key: 'paid' as Segment, label: 'Paid', count: rows.filter((r) => r.status?.state === 'paid').length },
    ];
  });

  protected readonly filtered = computed(() => {
    const term = this.query().trim().toLowerCase();
    const segment = this.segment();
    const from = this.from();
    const to = this.to();
    return this.all().filter((row) => {
      const balance = row.status?.balance ?? 0;
      if (segment === 'open' && balance <= 0) return false;
      if (segment === 'overdue' && !row.status?.overdue) return false;
      if (segment === 'paid' && row.status?.state !== 'paid') return false;
      if (from && row.bill.date < from) return false;
      if (to && row.bill.date > to) return false;
      if (!term) return true;
      return (
        row.bill.billNo.toLowerCase().includes(term) ||
        (row.customer?.name.toLowerCase().includes(term) ?? false) ||
        row.items.toLowerCase().includes(term)
      );
    });
  });

  protected readonly visible = computed(() => this.filtered().slice(0, this.limit()));

  protected readonly summary = computed(() =>
    this.filtered().reduce(
      (acc, row) => ({
        total: acc.total + row.totals.total,
        paid: acc.paid + (row.status?.paid ?? 0),
        balance: acc.balance + (row.status?.balance ?? 0),
        weight: acc.weight + row.totals.netWeight,
      }),
      { total: 0, paid: 0, balance: 0, weight: 0 },
    ),
  );

  protected setPreset(preset: Preset): void {
    this.preset.set(preset);
    this.limit.set(PAGE);
    const today = todayISO();
    switch (preset) {
      case 'month':
        this.from.set(startOfMonth(today));
        this.to.set(today);
        break;
      case 'last-month':
        this.from.set(addMonths(startOfMonth(today), -1));
        this.to.set(addDays(startOfMonth(today), -1));
        break;
      case 'fy':
        this.from.set(financialYearStart(today));
        this.to.set(today);
        break;
      case 'all':
        this.from.set('');
        this.to.set('');
        break;
    }
  }

  protected setDate(which: 'from' | 'to', value: string): void {
    (which === 'from' ? this.from : this.to).set(value);
    this.preset.set('custom');
    this.limit.set(PAGE);
  }

  protected open(billId: string): void {
    void this.router.navigate(['/bills', billId]);
  }

  protected exportCsv(): void {
    downloadCsv(
      `msr-bills-${todayISO()}.csv`,
      ['Bill no', 'Date', 'Customer', 'Phone', 'Items', 'Net weight (g)', 'Taxable', 'GST', 'Total', 'Paid', 'Balance', 'Status'],
      this.filtered().map((row) => [
        row.bill.billNo,
        row.bill.date,
        row.customer?.name ?? '',
        row.customer?.phone ?? '',
        row.items,
        row.totals.netWeight,
        row.totals.taxable,
        row.totals.gst,
        row.totals.total,
        Math.round(row.status?.paid ?? 0),
        Math.round(row.status?.balance ?? 0),
        row.status?.overdue ? 'Overdue' : row.status?.state ?? '',
      ]),
    );
  }
}
