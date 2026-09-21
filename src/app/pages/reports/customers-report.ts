import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShopStore } from '../../core/store';
import {
  ReportRange,
  formatCount,
  formatPercent,
  inRange,
  monthLabels,
  monthsBetween,
} from '../../core/analytics';
import { addDays, daysBetween, monthKey } from '../../core/dates';
import { formatINR, initials } from '../../core/format';
import { ColumnChart, ColumnSeries } from '../../shared/charts/column-chart';
import { BarList, BarRow } from '../../shared/charts/bar-list';
import { Icon } from '../../shared/icon';
import { BalancePipe, DayPipe, InrPipe } from '../../shared/pipes';

const DORMANT_DAYS = 180;

@Component({
  selector: 'app-customers-report',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ColumnChart, BarList, Icon, InrPipe, BalancePipe, DayPipe],
  templateUrl: './customers-report.html',
})
export class CustomersReport {
  private readonly store = inject(ShopStore);
  readonly range = input.required<ReportRange>();

  protected readonly inr = (v: number) => formatINR(v);
  protected readonly count = formatCount;
  protected readonly percent = formatPercent;
  protected readonly dormantDays = DORMANT_DAYS;

  /** Each customer's first-ever bill date, to tell new buyers from returning ones. */
  private readonly firstBill = computed(() => {
    const first = new Map<string, string>();
    for (const bill of this.store.bills()) {
      const current = first.get(bill.customerId);
      if (!current || bill.date < current) first.set(bill.customerId, bill.date);
    }
    return first;
  });

  private readonly periodSpend = computed(() => {
    const totals = this.store.billTotals();
    const map = new Map<string, { spend: number; bills: number }>();
    for (const bill of this.store.bills()) {
      if (!inRange(bill.date, this.range())) continue;
      const row = map.get(bill.customerId) ?? { spend: 0, bills: 0 };
      row.spend += totals.get(bill.id)?.total ?? 0;
      row.bills++;
      map.set(bill.customerId, row);
    }
    return map;
  });

  protected readonly kpis = computed(() => {
    const spend = this.periodSpend();
    const first = this.firstBill();
    const { from, to } = this.range();
    let fresh = 0;
    let repeat = 0;
    let total = 0;
    for (const [customerId, row] of spend) {
      const firstDate = first.get(customerId) ?? from;
      if (firstDate >= from && firstDate <= to) fresh++;
      if (row.bills >= 2) repeat++;
      total += row.spend;
    }
    const buyers = spend.size;
    return {
      buyers,
      fresh,
      returning: buyers - fresh,
      repeatRate: buyers ? (repeat / buyers) * 100 : 0,
      avgSpend: buyers ? total / buyers : 0,
      totalCustomers: this.store.customers().length,
    };
  });

  protected readonly monthly = computed(() => {
    const months = monthsBetween(this.range().from, this.range().to);
    const index = new Map(months.map((m, i) => [m, i]));
    const buyers = months.map(() => new Set<string>());
    for (const bill of this.store.bills()) {
      if (!inRange(bill.date, this.range())) continue;
      const i = index.get(monthKey(bill.date));
      if (i !== undefined) buyers[i].add(bill.customerId);
    }
    const first = this.firstBill();
    const fresh = buyers.map((set, i) => [...set].filter((id) => monthKey(first.get(id) ?? '') === months[i]).length);
    const returning = buyers.map((set, i) => set.size - fresh[i]);
    const labels = monthLabels(months);
    const series: ColumnSeries[] = [
      { name: 'New buyers', color: 'var(--series-debit)', values: fresh },
      { name: 'Returning buyers', color: 'var(--series-credit)', values: returning },
    ];
    return { labels, series };
  });

  protected readonly top = computed(() => {
    const summaries = this.store.customerSummaries();
    const customers = this.store.customerById();
    return [...this.periodSpend().entries()]
      .map(([id, row]) => ({ customer: customers.get(id)!, summary: summaries.get(id)!, ...row }))
      .filter((r) => r.customer)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 15)
      .map((r) => ({ ...r, initials: initials(r.customer.name) }));
  });

  protected readonly cities = computed<BarRow[]>(() => {
    const customers = this.store.customerById();
    const map = new Map<string, { spend: number; people: Set<string> }>();
    for (const [id, row] of this.periodSpend()) {
      const city = customers.get(id)?.city || 'Unknown';
      const entry = map.get(city) ?? { spend: 0, people: new Set<string>() };
      entry.spend += row.spend;
      entry.people.add(id);
      map.set(city, entry);
    }
    return [...map.entries()]
      .sort((a, b) => b[1].spend - a[1].spend)
      .slice(0, 8)
      .map(([label, e]) => ({
        label,
        value: e.spend,
        note: `${e.people.size} ${e.people.size === 1 ? 'customer' : 'customers'}`,
      }));
  });

  /** Good customers who have not bought for six months: worth a call before the next festival. */
  protected readonly dormant = computed(() => {
    const today = this.store.today();
    const cutoff = addDays(today, -DORMANT_DAYS);
    const summaries = this.store.customerSummaries();
    return this.store
      .customers()
      .map((customer) => ({ customer, summary: summaries.get(customer.id)! }))
      .filter((r) => r.summary?.lastBillDate && r.summary.lastBillDate < cutoff)
      .sort((a, b) => b.summary.billed - a.summary.billed)
      .slice(0, 10)
      .map((r) => ({ ...r, days: daysBetween(r.summary.lastBillDate!, today) }));
  });
}
