import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShopStore } from '../../core/store';
import { UiService } from '../../core/ui.service';
import { LedgerEntry, Payment } from '../../core/models';
import { addDays, addMonths, financialYearStart, lastMonths, monthKey, todayISO } from '../../core/dates';
import { formatMonth, initials } from '../../core/format';
import { whatsappReminderLink } from '../../core/reminders';
import { downloadCsv } from '../../core/csv';
import { ColumnChart, ColumnSeries } from '../../shared/charts/column-chart';
import { Icon } from '../../shared/icon';
import { StatusChip } from '../../shared/status-chip';
import { BalancePipe, DayPipe, GramsPipe, InrPipe, PhonePipe } from '../../shared/pipes';

type Tab = 'statement' | 'bills' | 'payments';
type StatementRange = 'all' | 'fy' | '12m';

interface StatementRow extends LedgerEntry {
  balance: number;
}

@Component({
  selector: 'app-customer-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ColumnChart, Icon, StatusChip, InrPipe, BalancePipe, DayPipe, GramsPipe, PhonePipe],
  templateUrl: './customer-detail.html',
  styleUrl: './customer-detail.scss',
})
export class CustomerDetailPage {
  protected readonly store = inject(ShopStore);
  protected readonly ui = inject(UiService);

  readonly id = input.required<string>();

  protected readonly tab = signal<Tab>('statement');
  protected readonly range = signal<StatementRange>('all');

  protected readonly customer = computed(() => this.store.customerById().get(this.id()));
  protected readonly summary = computed(() => this.store.customerSummaries().get(this.id()));
  protected readonly initials = computed(() => initials(this.customer()?.name ?? ''));

  protected readonly whatsapp = computed(() => {
    const customer = this.customer();
    const summary = this.summary();
    if (!customer || !summary) return null;
    return whatsappReminderLink(customer, summary.balance, this.store.settings().shopName);
  });

  /** Oldest-first running balance, shown newest first. */
  private readonly fullStatement = computed<StatementRow[]>(() => {
    const entries = this.store
      .ledger()
      .filter((e) => e.customerId === this.id())
      .reverse();
    let balance = 0;
    return entries.map((entry) => {
      balance += entry.type === 'debit' ? entry.amount : -entry.amount;
      return { ...entry, balance: Math.round(balance) };
    });
  });

  protected readonly rangeStart = computed(() => {
    const today = this.store.today();
    switch (this.range()) {
      case 'fy':
        return financialYearStart(today);
      case '12m':
        return addDays(addMonths(today, -12), 1);
      default:
        return '';
    }
  });

  protected readonly statement = computed(() => {
    const start = this.rangeStart();
    const all = this.fullStatement();
    const inRange = start ? all.filter((row) => row.date >= start) : all;
    const before = start ? all.filter((row) => row.date < start) : [];
    const broughtForward = before.length ? before[before.length - 1].balance : null;
    const debit = inRange.filter((r) => r.type === 'debit').reduce((s, r) => s + r.amount, 0);
    const credit = inRange.filter((r) => r.type === 'credit').reduce((s, r) => s + r.amount, 0);
    return { rows: [...inRange].reverse(), broughtForward, debit, credit };
  });

  protected readonly bills = computed(() => {
    const totals = this.store.billTotals();
    const statuses = this.store.billStatus();
    return this.store
      .bills()
      .filter((b) => b.customerId === this.id())
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map((bill) => ({
        bill,
        totals: totals.get(bill.id)!,
        status: statuses.get(bill.id),
        items: bill.items.map((i) => i.description).join(', '),
      }));
  });

  protected readonly payments = computed(() => {
    const bills = this.store.billById();
    return this.store
      .payments()
      .filter((p) => p.customerId === this.id())
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map((payment) => ({ payment, bill: payment.billId ? bills.get(payment.billId) : undefined }));
  });

  protected readonly openBills = computed(() => this.bills().filter((row) => (row.status?.balance ?? 0) > 0));

  protected readonly trend = computed(() => {
    const months = lastMonths(this.store.today(), 12);
    const index = new Map(months.map((m, i) => [m, i]));
    const billed = months.map(() => 0);
    const paid = months.map(() => 0);
    for (const row of this.bills()) {
      const i = index.get(monthKey(row.bill.date));
      if (i !== undefined) billed[i] += row.totals.total;
    }
    for (const row of this.payments()) {
      const i = index.get(monthKey(row.payment.date));
      if (i !== undefined) paid[i] += row.payment.amount;
    }
    const series: ColumnSeries[] = [
      { name: 'Billed (debit)', color: 'var(--series-debit)', values: billed },
      { name: 'Paid (credit)', color: 'var(--series-credit)', values: paid },
    ];
    return {
      labels: months.map((m) => formatMonth(m)),
      fullLabels: months.map((m) => formatMonth(m, true)),
      series,
      active: billed.some((v) => v > 0) || paid.some((v) => v > 0),
    };
  });

  protected edit(): void {
    this.ui.openCustomer({ customerId: this.id() });
  }

  protected collect(billId?: string): void {
    this.ui.openPayment({ customerId: this.id(), billId });
  }

  protected removePayment(payment: Payment): void {
    if (!confirm(`Delete receipt ${payment.receiptNo} for ₹${payment.amount.toLocaleString('en-IN')}? The balance will go back up.`)) {
      return;
    }
    this.store.deletePayment(payment.id);
    this.ui.toast(`Receipt ${payment.receiptNo} deleted`, 'info');
  }

  protected printStatement(): void {
    this.tab.set('statement');
    setTimeout(() => window.print(), 50);
  }

  protected exportStatement(): void {
    const customer = this.customer();
    if (!customer) return;
    const rows = [...this.statement().rows].reverse();
    downloadCsv(
      `statement-${customer.name.replace(/\s+/g, '-').toLowerCase()}-${todayISO()}.csv`,
      ['Date', 'Reference', 'Particulars', 'Mode', 'Debit', 'Credit', 'Balance (Dr+ / Cr-)'],
      rows.map((r) => [
        r.date,
        r.ref,
        r.particulars,
        r.mode ?? '',
        r.type === 'debit' ? r.amount : '',
        r.type === 'credit' ? r.amount : '',
        r.balance,
      ]),
    );
  }
}
