import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShopStore } from '../../core/store';
import { PaymentMode } from '../../core/models';
import { AGING_BUCKETS, agingBucketIndex } from '../../core/calc';
import {
  ReportRange,
  formatCount,
  formatPercent,
  inRange,
  monthLabels,
  monthsBetween,
} from '../../core/analytics';
import { addDays, daysBetween, monthKey, todayISO } from '../../core/dates';
import { formatINR } from '../../core/format';
import { downloadCsv } from '../../core/csv';
import { ColumnChart, ColumnSeries } from '../../shared/charts/column-chart';
import { BarList, BarRow } from '../../shared/charts/bar-list';
import { Icon } from '../../shared/icon';
import { GramsPipe, InrPipe } from '../../shared/pipes';

@Component({
  selector: 'app-collections-report',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ColumnChart, BarList, Icon, InrPipe, GramsPipe],
  templateUrl: './collections-report.html',
})
export class CollectionsReport {
  private readonly store = inject(ShopStore);
  readonly range = input.required<ReportRange>();

  protected readonly inr = (v: number) => formatINR(v);
  protected readonly percent = formatPercent;
  protected readonly pct = (v: number) => formatPercent(v);
  protected readonly buckets = AGING_BUCKETS;

  private readonly payments = computed(() => this.store.payments().filter((p) => inRange(p.date, this.range())));

  protected readonly kpis = computed(() => {
    const totals = this.store.billTotals();
    const statuses = this.store.billStatus();
    const today = this.store.today();
    const billed = this.store
      .bills()
      .filter((b) => inRange(b.date, this.range()))
      .reduce((s, b) => s + (totals.get(b.id)?.total ?? 0), 0);
    const collected = this.payments().reduce((s, p) => s + p.amount, 0);
    const oldGold = this.payments().reduce((s, p) => s + (p.oldGold?.weight ?? 0), 0);

    let outstanding = 0;
    for (const summary of this.store.customerSummaries().values()) {
      if (summary.balance > 0) outstanding += summary.balance;
    }
    // Days of sales outstanding, on the last 90 days' billing.
    const since = addDays(today, -89);
    const recent = this.store
      .bills()
      .filter((b) => b.date >= since && b.date <= today)
      .reduce((s, b) => s + (totals.get(b.id)?.total ?? 0), 0);
    const dso = recent > 0 ? outstanding / (recent / 90) : 0;

    // How long settled bills in this period took to clear, from their tagged payments.
    const lastPaid = new Map<string, string>();
    for (const p of this.store.payments()) {
      if (!p.billId) continue;
      const current = lastPaid.get(p.billId);
      if (!current || p.date > current) lastPaid.set(p.billId, p.date);
    }
    const settleDays: number[] = [];
    for (const bill of this.store.bills()) {
      if (!inRange(bill.date, this.range()) || statuses.get(bill.id)?.state !== 'paid') continue;
      const last = lastPaid.get(bill.id);
      if (last) settleDays.push(Math.max(daysBetween(bill.date, last), 0));
    }
    const sameDay = settleDays.filter((d) => d === 0).length;
    return {
      billed,
      collected,
      ratio: billed ? (collected / billed) * 100 : 0,
      outstanding,
      dso,
      avgSettle: settleDays.length ? settleDays.reduce((a, b) => a + b, 0) / settleDays.length : 0,
      sameDayShare: settleDays.length ? (sameDay / settleDays.length) * 100 : 0,
      oldGold,
      receipts: this.payments().length,
    };
  });

  protected readonly monthly = computed(() => {
    const months = monthsBetween(this.range().from, this.range().to);
    const index = new Map(months.map((m, i) => [m, i]));
    const billed = months.map(() => 0);
    const collected = months.map(() => 0);
    const totals = this.store.billTotals();
    for (const bill of this.store.bills()) {
      const i = index.get(monthKey(bill.date));
      if (i !== undefined && inRange(bill.date, this.range())) billed[i] += totals.get(bill.id)?.total ?? 0;
    }
    for (const p of this.payments()) {
      const i = index.get(monthKey(p.date));
      if (i !== undefined) collected[i] += p.amount;
    }
    const labels = monthLabels(months);
    const flow: ColumnSeries[] = [
      { name: 'Billed (debit)', color: 'var(--series-debit)', values: billed },
      { name: 'Collected (credit)', color: 'var(--series-credit)', values: collected },
    ];
    const ratio: ColumnSeries[] = [
      {
        name: 'Collected per ₹100 billed',
        color: 'var(--series-credit)',
        values: billed.map((b, i) => (b ? Math.round((collected[i] / b) * 100) : 0)),
      },
    ];
    return { labels, flow, ratio };
  });

  protected readonly modes = computed<BarRow[]>(() => {
    const map = new Map<PaymentMode, { amount: number; count: number }>();
    let total = 0;
    for (const p of this.payments()) {
      const row = map.get(p.mode) ?? { amount: 0, count: 0 };
      row.amount += p.amount;
      row.count++;
      map.set(p.mode, row);
      total += p.amount;
    }
    return [...map.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([mode, r]) => ({
        label: mode,
        value: r.amount,
        note: `${formatPercent(total ? (r.amount / total) * 100 : 0)} · ${formatCount(r.count)} receipts`,
      }));
  });

  /** Aged receivables: what each customer owes, by how old the unpaid bills are. */
  protected readonly aged = computed(() => {
    const statuses = this.store.billStatus();
    const opening = this.store.openingRemaining();
    const today = this.store.today();
    const byCustomer = new Map<string, number[]>();
    const add = (customerId: string, days: number, amount: number) => {
      const row = byCustomer.get(customerId) ?? AGING_BUCKETS.map(() => 0);
      row[agingBucketIndex(days)] += amount;
      byCustomer.set(customerId, row);
    };
    for (const bill of this.store.bills()) {
      const s = statuses.get(bill.id);
      if (s && s.balance > 0) add(bill.customerId, s.daysOpen, s.balance);
    }
    for (const c of this.store.customers()) {
      const left = opening.get(c.id) ?? 0;
      if (left > 0) add(c.id, daysBetween(c.createdAt, today), left);
    }
    const customers = this.store.customerById();
    const rows = [...byCustomer.entries()]
      .map(([id, amounts]) => ({
        customer: customers.get(id)!,
        amounts,
        total: amounts.reduce((a, b) => a + b, 0),
      }))
      .filter((r) => r.customer && r.total > 0.5)
      .sort((a, b) => b.amounts[3] - a.amounts[3] || b.total - a.total);
    const totals = AGING_BUCKETS.map((_, i) => rows.reduce((s, r) => s + r.amounts[i], 0));
    return { rows, totals, grand: totals.reduce((a, b) => a + b, 0) };
  });

  protected exportAged(): void {
    downloadCsv(
      `msr-aged-receivables-${todayISO()}.csv`,
      ['Customer', 'Phone', ...AGING_BUCKETS.map((b) => b.label), 'Total'],
      this.aged().rows.map((r) => [r.customer.name, r.customer.phone, ...r.amounts.map(Math.round), Math.round(r.total)]),
    );
  }
}
