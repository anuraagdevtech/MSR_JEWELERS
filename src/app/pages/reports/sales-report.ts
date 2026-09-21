import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ShopStore } from '../../core/store';
import {
  ReportRange,
  formatCount,
  formatGramsShort,
  formatPercent,
  groupLines,
  inRange,
  makingRate,
  monthLabels,
  monthsBetween,
  purityGroup,
  saleLines,
} from '../../core/analytics';
import { monthKey, parseISODate } from '../../core/dates';
import { formatGrams, formatINR, formatINRCompact, formatMonth } from '../../core/format';
import { ColumnChart, ColumnSeries } from '../../shared/charts/column-chart';
import { BarList, BarRow } from '../../shared/charts/bar-list';
import { GramsPipe, InrPipe } from '../../shared/pipes';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

@Component({
  selector: 'app-sales-report',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ColumnChart, BarList, InrPipe, GramsPipe],
  templateUrl: './sales-report.html',
})
export class SalesReport {
  private readonly store = inject(ShopStore);
  readonly range = input.required<ReportRange>();

  protected readonly inr = (v: number) => formatINR(v);
  protected readonly inrCompact = formatINRCompact;
  protected readonly grams = (v: number) => formatGrams(v, 1);
  protected readonly gramsAxis = formatGramsShort;
  protected readonly percent = formatPercent;

  private readonly bills = computed(() => this.store.bills().filter((b) => inRange(b.date, this.range())));
  private readonly lines = computed(() => saleLines(this.store.bills(), this.store.billTotals(), this.range()));

  protected readonly kpis = computed(() => {
    const totals = this.store.billTotals();
    let sales = 0;
    let taxable = 0;
    let gst = 0;
    let discount = 0;
    for (const bill of this.bills()) {
      const t = totals.get(bill.id);
      if (!t) continue;
      sales += t.total;
      taxable += t.taxable;
      gst += t.gst;
      discount += t.discount;
    }
    let making = 0;
    let metalValue = 0;
    let goldGrams = 0;
    let silverGrams = 0;
    for (const line of this.lines()) {
      making += line.making;
      metalValue += line.metalValue;
      if (line.metal === 'Gold') goldGrams += line.grams;
      else silverGrams += line.grams;
    }
    const count = this.bills().length;
    return {
      sales,
      taxable,
      gst,
      discount,
      making,
      makingRate: makingRate(making, metalValue),
      count,
      avg: count ? sales / count : 0,
      goldGrams,
      silverGrams,
    };
  });

  protected readonly monthly = computed(() => {
    const months = monthsBetween(this.range().from, this.range().to);
    const index = new Map(months.map((m, i) => [m, i]));
    const blank = () => months.map(() => 0);
    const sales = blank();
    const bills = blank();
    const making = blank();
    const goldOut = blank();
    const goldIn = blank();
    const totals = this.store.billTotals();
    for (const bill of this.bills()) {
      const i = index.get(monthKey(bill.date));
      if (i === undefined) continue;
      sales[i] += totals.get(bill.id)?.total ?? 0;
      bills[i]++;
    }
    for (const line of this.lines()) {
      const i = index.get(monthKey(line.bill.date));
      if (i === undefined) continue;
      making[i] += line.making;
      if (line.metal === 'Gold') goldOut[i] += line.grams;
    }
    for (const p of this.store.payments()) {
      if (!p.oldGold || !inRange(p.date, this.range())) continue;
      const i = index.get(monthKey(p.date));
      if (i !== undefined) goldIn[i] += p.oldGold.weight;
    }
    const labels = monthLabels(months);
    return {
      labels,
      rows: months.map((m, i) => ({
        month: formatMonth(m, true),
        bills: bills[i],
        sales: sales[i],
        making: making[i],
        avg: bills[i] ? sales[i] / bills[i] : 0,
        goldOut: goldOut[i],
        goldIn: goldIn[i],
      })),
      salesSeries: [{ name: 'Sales incl. GST', color: 'var(--series-debit)', values: sales }] as ColumnSeries[],
      makingSeries: [{ name: 'Making charges', color: 'var(--series-debit)', values: making }] as ColumnSeries[],
      goldSeries: [
        { name: 'Gold sold', color: 'var(--series-debit)', values: goldOut },
        { name: 'Old gold taken in', color: 'var(--series-credit)', values: goldIn },
      ] as ColumnSeries[],
    };
  });

  protected readonly weekdays = computed<BarRow[]>(() => {
    const totals = this.store.billTotals();
    const value = WEEKDAYS.map(() => 0);
    const count = WEEKDAYS.map(() => 0);
    for (const bill of this.bills()) {
      const day = (parseISODate(bill.date).getDay() + 6) % 7;
      value[day] += totals.get(bill.id)?.total ?? 0;
      count[day]++;
    }
    return WEEKDAYS.map((label, i) => ({
      label,
      value: value[i],
      note: `${formatCount(count[i])} ${count[i] === 1 ? 'bill' : 'bills'}`,
    }));
  });

  protected readonly purities = computed<BarRow[]>(() =>
    groupLines(this.lines(), purityGroup).map((g) => ({
      label: g.label,
      value: g.revenue,
      note: `${formatGrams(g.grams, 1)} · ${formatCount(g.pieces)} ${g.pieces === 1 ? 'piece' : 'pieces'}`,
    })),
  );
}
