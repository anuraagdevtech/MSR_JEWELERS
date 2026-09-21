import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { formatINR, formatINRCompact } from '../../core/format';
import { Icon } from '../icon';

export interface ColumnSeries {
  name: string;
  /** CSS colour, normally a series token such as var(--series-debit). */
  color: string;
  values: number[];
}

interface Bar {
  key: string;
  d: string;
  color: string;
}

const PAD = { top: 12, right: 4, bottom: 28, left: 52 };
const BAR_GAP = 2;
const MAX_BAR = 24;

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/** Column path with a 4px rounded data end and a square baseline. */
function columnPath(x: number, y: number, width: number, baseline: number): string {
  const height = baseline - y;
  const r = Math.min(4, width / 2, height);
  return `M${x},${baseline}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${baseline}Z`;
}

/**
 * Grouped column chart for a handful of series over time. One y-axis, hairline grid,
 * legend always shown for 2+ series, hover/focus tooltip, and a table view so no value
 * is gated behind the tooltip.
 */
@Component({
  selector: 'app-column-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './column-chart.html',
  styleUrl: './column-chart.scss',
})
export class ColumnChart {
  readonly labels = input.required<string[]>();
  /** Longer labels for the tooltip and table (e.g. "Sep 2026"). */
  readonly fullLabels = input<string[]>();
  readonly series = input.required<ColumnSeries[]>();
  readonly height = input(240);
  readonly caption = input('');
  /** Formats exact values (tooltip, table). Defaults to rupees. */
  readonly format = input<(value: number) => string>(formatINR);
  /** Formats y-axis ticks. Defaults to compact rupees (₹4.3L). */
  readonly axisFormat = input<(value: number) => string>(formatINRCompact);
  /** Adds a totals row to the table view; off for ratios, where a sum means nothing. */
  readonly showTotal = input(true);

  protected readonly width = signal(640);
  protected readonly active = signal<number | null>(null);
  protected readonly showTable = signal(false);
  protected readonly pad = PAD;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const observer = new ResizeObserver((entries) => {
        const width = Math.floor(entries[0]?.contentRect.width ?? 0);
        if (width > 0) this.width.set(Math.max(width, 260));
      });
      observer.observe(this.host.nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected readonly scale = computed(() => {
    const maxValue = Math.max(0, ...this.series().flatMap((s) => s.values));
    const step = niceStep(maxValue / 4);
    const top = Math.max(step, Math.ceil(maxValue / step) * step);
    const ticks: number[] = [];
    for (let value = 0; value <= top + step / 2; value += step) ticks.push(value);
    return { top, ticks };
  });

  protected readonly plotBottom = computed(() => this.height() - PAD.bottom);
  protected readonly plotRight = computed(() => this.width() - PAD.right);

  protected y(value: number): number {
    const { top } = this.scale();
    const plotHeight = this.plotBottom() - PAD.top;
    return this.plotBottom() - (value / top) * plotHeight;
  }

  protected readonly band = computed(() => {
    const count = Math.max(this.labels().length, 1);
    return (this.plotRight() - PAD.left) / count;
  });

  protected readonly groups = computed(() => {
    const band = this.band();
    const series = this.series();
    const k = Math.max(series.length, 1);
    const barWidth = Math.max(Math.min(MAX_BAR, (band * 0.72 - (k - 1) * BAR_GAP) / k), 3);
    const groupWidth = k * barWidth + (k - 1) * BAR_GAP;
    const baseline = this.plotBottom();
    const everyOther = band < 40;
    const lastIndex = this.labels().length - 1;

    return this.labels().map((label, i) => {
      const bandX = PAD.left + i * band;
      const start = bandX + (band - groupWidth) / 2;
      const bars: Bar[] = [];
      series.forEach((s, j) => {
        const value = s.values[i] ?? 0;
        if (value <= 0) return;
        const x = start + j * (barWidth + BAR_GAP);
        bars.push({ key: s.name, color: s.color, d: columnPath(x, this.y(value), barWidth, baseline) });
      });
      return {
        index: i,
        label,
        showLabel: !everyOther || (lastIndex - i) % 2 === 0,
        bandX,
        center: bandX + band / 2,
        bars,
      };
    });
  });

  protected readonly tooltip = computed(() => {
    const index = this.active();
    if (index === null) return null;
    const group = this.groups()[index];
    if (!group) return null;
    const width = 190;
    const left = Math.min(Math.max(group.center - width / 2, 0), this.width() - width);
    return {
      left,
      width,
      title: this.fullLabels()?.[index] ?? group.label,
      rows: this.series().map((s) => ({ name: s.name, color: s.color, value: s.values[index] ?? 0 })),
    };
  });

  protected readonly ariaLabel = computed(() => {
    const names = this.series().map((s) => s.name).join(' and ');
    return `${this.caption() || 'Column chart'}: ${names} for ${this.labels().length} periods. Use the table view for exact values.`;
  });

  protected fullLabel(index: number): string {
    return this.fullLabels()?.[index] ?? this.labels()[index];
  }

  protected total(series: ColumnSeries): number {
    return series.values.reduce((sum, v) => sum + v, 0);
  }
}
