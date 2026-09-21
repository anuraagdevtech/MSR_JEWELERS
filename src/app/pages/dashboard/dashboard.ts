import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShopStore } from '../../core/store';
import { UiService } from '../../core/ui.service';
import { AGING_BUCKETS, agingBucketIndex, itemAmount } from '../../core/calc';
import {
  addDays,
  addMonths,
  daysBetween,
  financialYearStart,
  isWithin,
  lastMonths,
  monthKey,
  startOfMonth,
} from '../../core/dates';
import { formatDate, formatGrams, formatINR, formatMonth, initials } from '../../core/format';
import { whatsappReminderLink } from '../../core/reminders';
import { PaymentMode } from '../../core/models';
import { ColumnChart, ColumnSeries } from '../../shared/charts/column-chart';
import { BarList, BarRow } from '../../shared/charts/bar-list';
import { Icon } from '../../shared/icon';
import { DayPipe, GramsPipe, InrPipe, PhonePipe } from '../../shared/pipes';

type PeriodKey = 'mtd' | '3m' | 'fy' | '12m';

interface Range {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  label: string;
  compare: string;
}

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ColumnChart, BarList, Icon, InrPipe, DayPipe, GramsPipe, PhonePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class DashboardPage {
  protected readonly store = inject(ShopStore);
  protected readonly ui = inject(UiService);

  protected readonly periods: { key: PeriodKey; label: string }[] = [
    { key: 'mtd', label: 'This month' },
    { key: '3m', label: '3 months' },
    { key: 'fy', label: 'This FY' },
    { key: '12m', label: '12 months' },
  ];
  protected readonly period = signal<PeriodKey>('mtd');

  protected readonly formatINR = (v: number) => formatINR(v);
  protected readonly formatGrams = (v: number) => formatGrams(v, 1);

  protected readonly greeting = computed(() => {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  });

  protected readonly todayLabel = computed(() =>
    new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
      new Date(),
    ),
  );

  protected readonly range = computed<Range>(() => {
    const today = this.store.today();
    switch (this.period()) {
      case 'mtd': {
        const from = startOfMonth(today);
        return {
          from,
          to: today,
          prevFrom: addMonths(from, -1),
          prevTo: addMonths(today, -1),
          label: `${formatMonth(monthKey(today), true)} to date`,
          compare: 'vs same days last month',
        };
      }
      case '3m': {
        const from = addMonths(startOfMonth(today), -2);
        return {
          from,
          to: today,
          prevFrom: addMonths(from, -3),
          prevTo: addMonths(today, -3),
          label: `${formatDate(from)} – today`,
          compare: 'vs previous 3 months',
        };
      }
      case 'fy': {
        const from = financialYearStart(today);
        return {
          from,
          to: today,
          prevFrom: addMonths(from, -12),
          prevTo: addMonths(today, -12),
          label: `FY ${from.slice(0, 4)}–${String(Number(from.slice(0, 4)) + 1).slice(2)} to date`,
          compare: 'vs same period last FY',
        };
      }
      case '12m': {
        const from = addDays(addMonths(today, -12), 1);
        return {
          from,
          to: today,
          prevFrom: addMonths(from, -12),
          prevTo: addMonths(today, -12),
          label: 'last 12 months',
          compare: 'vs previous 12 months',
        };
      }
    }
  });

  private readonly periodFigures = computed(() => {
    const { from, to, prevFrom, prevTo } = this.range();
    const totals = this.store.billTotals();
    let billed = 0;
    let prevBilled = 0;
    let bills = 0;
    let weight = 0;
    for (const bill of this.store.bills()) {
      const total = totals.get(bill.id)?.total ?? 0;
      if (isWithin(bill.date, from, to)) {
        billed += total;
        bills++;
        weight += totals.get(bill.id)?.netWeight ?? 0;
      } else if (isWithin(bill.date, prevFrom, prevTo)) {
        prevBilled += total;
      }
    }
    let collected = 0;
    let prevCollected = 0;
    let oldGoldValue = 0;
    let oldGoldGrams = 0;
    for (const payment of this.store.payments()) {
      if (isWithin(payment.date, from, to)) {
        collected += payment.amount;
        if (payment.mode === 'Old gold') {
          oldGoldValue += payment.amount;
          oldGoldGrams += payment.oldGold?.weight ?? 0;
        }
      } else if (isWithin(payment.date, prevFrom, prevTo)) {
        prevCollected += payment.amount;
      }
    }
    const newCustomers = this.store.customers().filter((c) => isWithin(c.createdAt, from, to)).length;
    return {
      billed,
      prevBilled,
      collected,
      prevCollected,
      bills,
      avgBill: bills ? billed / bills : 0,
      weight,
      oldGoldValue,
      oldGoldGrams,
      newCustomers,
    };
  });

  protected readonly figures = this.periodFigures;

  protected readonly dues = computed(() => {
    let outstanding = 0;
    let advances = 0;
    let withDues = 0;
    let overdue = 0;
    let overdueCustomers = 0;
    for (const summary of this.store.customerSummaries().values()) {
      if (summary.balance > 0) {
        outstanding += summary.balance;
        withDues++;
      } else if (summary.balance < 0) {
        advances += -summary.balance;
      }
      if (summary.overdueAmount > 0) {
        overdue += summary.overdueAmount;
        overdueCustomers++;
      }
    }
    return { outstanding, advances, withDues, overdue, overdueCustomers };
  });

  protected delta(current: number, previous: number): { text: string; dir: 'up' | 'down' | 'flat' } | null {
    if (previous <= 0) return null;
    const change = ((current - previous) / previous) * 100;
    if (Math.abs(change) < 0.5) return { text: '0%', dir: 'flat' };
    return { text: `${Math.abs(change).toFixed(0)}%`, dir: change > 0 ? 'up' : 'down' };
  }

  protected readonly trend = computed(() => {
    const months = lastMonths(this.store.today(), 12);
    const index = new Map(months.map((m, i) => [m, i]));
    const billed = months.map(() => 0);
    const collected = months.map(() => 0);
    const totals = this.store.billTotals();
    for (const bill of this.store.bills()) {
      const i = index.get(monthKey(bill.date));
      if (i !== undefined) billed[i] += totals.get(bill.id)?.total ?? 0;
    }
    for (const payment of this.store.payments()) {
      const i = index.get(monthKey(payment.date));
      if (i !== undefined) collected[i] += payment.amount;
    }
    const series: ColumnSeries[] = [
      { name: 'Billed (debit)', color: 'var(--series-debit)', values: billed },
      { name: 'Collected (credit)', color: 'var(--series-credit)', values: collected },
    ];
    return {
      labels: months.map((m) => formatMonth(m)),
      fullLabels: months.map((m, i) => `${formatMonth(m, true)}${i === months.length - 1 ? ' (to date)' : ''}`),
      series,
      billedTotal: billed.reduce((a, b) => a + b, 0),
      collectedTotal: collected.reduce((a, b) => a + b, 0),
    };
  });

  protected readonly aging = computed<BarRow[]>(() => {
    const amounts = AGING_BUCKETS.map(() => 0);
    const counts = AGING_BUCKETS.map(() => 0);
    for (const status of this.store.billStatus().values()) {
      if (status.balance <= 0) continue;
      const i = agingBucketIndex(status.daysOpen);
      amounts[i] += status.balance;
      counts[i]++;
    }
    const today = this.store.today();
    for (const customer of this.store.customers()) {
      const left = this.store.openingRemaining().get(customer.id) ?? 0;
      if (left <= 0) continue;
      const i = agingBucketIndex(daysBetween(customer.createdAt, today));
      amounts[i] += left;
      counts[i]++;
    }
    return AGING_BUCKETS.map((bucket, i) => ({
      label: bucket.label,
      value: Math.round(amounts[i]),
      note: counts[i] ? `${counts[i]} open ${counts[i] === 1 ? 'bill' : 'bills'}` : 'Nothing due',
    }));
  });

  protected readonly modes = computed<BarRow[]>(() => {
    const { from, to } = this.range();
    const byMode = new Map<PaymentMode, { amount: number; count: number }>();
    let total = 0;
    for (const payment of this.store.payments()) {
      if (!isWithin(payment.date, from, to)) continue;
      const entry = byMode.get(payment.mode) ?? { amount: 0, count: 0 };
      entry.amount += payment.amount;
      entry.count++;
      byMode.set(payment.mode, entry);
      total += payment.amount;
    }
    return [...byMode.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([mode, entry]) => ({
        label: mode,
        value: entry.amount,
        note: `${total ? Math.round((entry.amount / total) * 100) : 0}% · ${entry.count} ${entry.count === 1 ? 'receipt' : 'receipts'}`,
      }));
  });

  protected readonly categories = computed<BarRow[]>(() => {
    const { from, to } = this.range();
    const byCategory = new Map<string, { amount: number; grams: number; pieces: number }>();
    for (const bill of this.store.bills()) {
      if (!isWithin(bill.date, from, to)) continue;
      for (const item of bill.items) {
        const entry = byCategory.get(item.category) ?? { amount: 0, grams: 0, pieces: 0 };
        entry.amount += itemAmount(item);
        entry.grams += Number(item.netWeight) || 0;
        entry.pieces += Number(item.pieces) || 0;
        byCategory.set(item.category, entry);
      }
    }
    return [...byCategory.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 7)
      .map(([category, entry]) => ({
        label: category,
        value: Math.round(entry.amount),
        note: `${formatGrams(entry.grams, 1)} · ${entry.pieces} ${entry.pieces === 1 ? 'piece' : 'pieces'}`,
      }));
  });

  protected readonly topDues = computed(() => {
    const summaries = this.store.customerSummaries();
    const shopName = this.store.settings().shopName;
    return this.store
      .customers()
      .map((customer) => ({ customer, summary: summaries.get(customer.id)! }))
      .filter((row) => row.summary.balance > 0)
      .sort((a, b) => b.summary.balance - a.summary.balance)
      .slice(0, 6)
      .map((row) => ({
        ...row,
        initials: initials(row.customer.name),
        whatsapp: whatsappReminderLink(row.customer, row.summary.balance, shopName),
      }));
  });

  protected readonly recent = computed(() => {
    const customers = this.store.customerById();
    return this.store
      .ledger()
      .slice(0, 8)
      .map((entry) => ({ entry, customer: customers.get(entry.customerId) }));
  });
}
