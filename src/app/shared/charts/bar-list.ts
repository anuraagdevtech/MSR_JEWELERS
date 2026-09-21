import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface BarRow {
  label: string;
  value: number;
  /** Secondary text under the bar, e.g. a share or count. */
  note?: string;
}

/**
 * Ranked horizontal bars in one series colour: label and value sit above each bar so
 * nothing depends on hovering, and the bar length carries the comparison.
 */
@Component({
  selector: 'app-bar-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hasData()) {
      <ul class="bar-list">
        @for (row of scaled(); track row.label) {
          <li [attr.title]="row.label + ': ' + format()(row.value)">
            <div class="row-head">
              <span class="row-label">{{ row.label }}</span>
              <span class="row-value">{{ format()(row.value) }}</span>
            </div>
            <div class="bar-track">
              @if (row.value > 0) {
                <div class="bar" [style.width.%]="row.percent" [style.background]="color()"></div>
              }
            </div>
            @if (row.note) {
              <small>{{ row.note }}</small>
            }
          </li>
        }
      </ul>
    } @else {
      <p class="empty-note">{{ emptyText() }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .bar-list {
      display: grid;
      gap: 14px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .row-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 0.875rem;
      margin-bottom: 6px;
    }
    .row-label {
      color: var(--text-2);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row-value {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .bar-track {
      height: 8px;
    }
    .bar {
      height: 100%;
      min-width: 2px;
      border-radius: 0 4px 4px 0;
    }
    small {
      display: block;
      margin-top: 4px;
      color: var(--text-3);
      font-size: 0.75rem;
    }
    .empty-note {
      margin: 0;
      padding: 24px 0;
      color: var(--text-3);
      text-align: center;
      font-size: 0.875rem;
    }
  `,
})
export class BarList {
  readonly rows = input.required<BarRow[]>();
  readonly format = input<(value: number) => string>((value) => String(value));
  readonly color = input('var(--series-debit)');
  readonly emptyText = input('Nothing to show for this period.');

  protected readonly hasData = computed(() => this.rows().some((row) => row.value > 0));

  protected readonly scaled = computed(() => {
    const max = Math.max(...this.rows().map((row) => row.value), 0);
    return this.rows().map((row) => ({ ...row, percent: max > 0 ? (row.value / max) * 100 : 0 }));
  });
}
