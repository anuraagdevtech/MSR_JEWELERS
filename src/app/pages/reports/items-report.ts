import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ShopStore } from '../../core/store';
import {
  RankBy,
  ReportRange,
  formatCount,
  formatPercent,
  groupLines,
  makingRate,
  purityGroup,
  rankItems,
  saleLines,
  summariseItems,
} from '../../core/analytics';
import { CATEGORIES } from '../../core/calc';
import { todayISO } from '../../core/dates';
import { formatGrams, formatINR } from '../../core/format';
import { downloadCsv } from '../../core/csv';
import { BarList, BarRow } from '../../shared/charts/bar-list';
import { Icon } from '../../shared/icon';
import { GramsPipe, InrPipe } from '../../shared/pipes';

const RANKS: { key: RankBy; label: string }[] = [
  { key: 'revenue', label: 'Sales value' },
  { key: 'pieces', label: 'Pieces' },
  { key: 'grams', label: 'Weight' },
];

@Component({
  selector: 'app-items-report',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BarList, Icon, InrPipe, GramsPipe],
  templateUrl: './items-report.html',
})
export class ItemsReport {
  private readonly store = inject(ShopStore);
  readonly range = input.required<ReportRange>();

  protected readonly ranks = RANKS;
  protected readonly categories = CATEGORIES;
  protected readonly rankBy = signal<RankBy>('revenue');
  protected readonly category = signal('');
  protected readonly percent = formatPercent;
  protected readonly makingRate = makingRate;

  protected readonly metricFormat = computed(() => {
    const by = this.rankBy();
    return by === 'pieces'
      ? (v: number) => `${formatCount(v)} pcs`
      : by === 'grams'
        ? (v: number) => formatGrams(v, 1)
        : (v: number) => formatINR(v);
  });

  private readonly allLines = computed(() => saleLines(this.store.bills(), this.store.billTotals(), this.range()));
  private readonly lines = computed(() => {
    const category = this.category();
    return category ? this.allLines().filter((l) => l.item.category === category) : this.allLines();
  });

  protected readonly ranked = computed(() => rankItems(summariseItems(this.lines()), this.rankBy()));
  protected readonly top = computed(() => this.ranked().slice(0, 25));

  protected readonly kpis = computed(() => {
    const lines = this.lines();
    const revenue = lines.reduce((s, l) => s + l.taxable, 0);
    const making = lines.reduce((s, l) => s + l.making, 0);
    const metal = lines.reduce((s, l) => s + l.metalValue, 0);
    const best = this.ranked()[0];
    return {
      pieces: lines.reduce((s, l) => s + l.pieces, 0),
      designs: this.ranked().length,
      revenue,
      makingRate: makingRate(making, metal),
      best,
      bestShare: best && revenue ? (best.revenue / revenue) * 100 : 0,
    };
  });

  private metric(row: { revenue: number; pieces: number; grams: number }): number {
    const by = this.rankBy();
    return by === 'pieces' ? row.pieces : by === 'grams' ? row.grams : row.revenue;
  }

  protected readonly topBars = computed<BarRow[]>(() =>
    this.ranked()
      .slice(0, 8)
      .map((i) => ({
        label: `${i.description} · ${i.purity}`,
        value: this.metric(i),
        note: `${i.category} · ${i.bills} ${i.bills === 1 ? 'bill' : 'bills'}`,
      })),
  );

  protected readonly categoryBars = computed<BarRow[]>(() =>
    groupLines(this.allLines(), (l) => l.item.category)
      .map((g) => ({ label: g.label, value: this.metric(g), note: `${formatCount(g.pieces)} pcs · ${formatGrams(g.grams, 1)}` }))
      .sort((a, b) => b.value - a.value),
  );

  protected readonly purityBars = computed<BarRow[]>(() =>
    groupLines(this.lines(), purityGroup)
      .map((g) => ({ label: g.label, value: this.metric(g), note: `${formatCount(g.pieces)} pcs` }))
      .sort((a, b) => b.value - a.value),
  );

  protected setRank(by: RankBy): void {
    this.rankBy.set(by);
  }

  protected exportCsv(): void {
    downloadCsv(
      `msr-best-sellers-${this.range().from}-to-${this.range().to || todayISO()}.csv`,
      ['Rank', 'Item', 'Purity', 'Category', 'Pieces', 'Bills', 'Net weight (g)', 'Sales value (pre-GST)', 'Making earned', 'Making % of metal'],
      this.ranked().map((i, index) => [
        index + 1,
        i.description,
        i.purity,
        i.category,
        i.pieces,
        i.bills,
        i.grams.toFixed(3),
        Math.round(i.revenue),
        Math.round(i.making),
        makingRate(i.making, i.metalValue).toFixed(1),
      ]),
    );
  }
}
