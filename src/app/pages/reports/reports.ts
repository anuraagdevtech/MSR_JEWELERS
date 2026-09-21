import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShopStore } from '../../core/store';
import { PERIODS, PeriodKey, rangeFor } from '../../core/analytics';
import { SalesReport } from './sales-report';
import { ItemsReport } from './items-report';
import { CustomersReport } from './customers-report';
import { CollectionsReport } from './collections-report';
import { GstReport } from './gst-report';

const TABS = [
  { key: 'sales', label: 'Sales' },
  { key: 'items', label: 'Best sellers' },
  { key: 'customers', label: 'Customers' },
  { key: 'collections', label: 'Collections' },
  { key: 'gst', label: 'GST' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

@Component({
  selector: 'app-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SalesReport, ItemsReport, CustomersReport, CollectionsReport, GstReport],
  template: `
    <header class="page-head">
      <div>
        <h1 class="page-title">Reports</h1>
        <p class="page-sub">{{ range().label }} · {{ activeLabel() }}</p>
      </div>
      <div class="field period">
        <label for="report-period">Period</label>
        <select id="report-period" class="input" (change)="period.set($any($event.target).value)">
          @for (p of periods; track p.key) {
            <option [value]="p.key" [selected]="p.key === period()">{{ p.label }}</option>
          }
        </select>
      </div>
    </header>

    <nav class="tabs" aria-label="Report">
      @for (t of tabs; track t.key) {
        <a [routerLink]="['/reports', t.key]" [class.on]="active() === t.key" [attr.aria-current]="active() === t.key ? 'page' : null">
          {{ t.label }}
        </a>
      }
    </nav>

    @switch (active()) {
      @case ('sales') { <app-sales-report [range]="range()" /> }
      @case ('items') { <app-items-report [range]="range()" /> }
      @case ('customers') { <app-customers-report [range]="range()" /> }
      @case ('collections') { <app-collections-report [range]="range()" /> }
      @case ('gst') { <app-gst-report [range]="range()" /> }
    }
  `,
  styles: `
    .period {
      min-width: 190px;
    }
  `,
})
export class ReportsPage {
  private readonly store = inject(ShopStore);

  /** Route parameter: which report tab is open. */
  readonly tab = input<string>('sales');

  protected readonly tabs = TABS;
  protected readonly periods = PERIODS;
  protected readonly period = signal<PeriodKey>('fy');

  protected readonly active = computed<TabKey>(() => TABS.find((t) => t.key === this.tab())?.key ?? 'sales');
  protected readonly activeLabel = computed(() => TABS.find((t) => t.key === this.active())!.label);

  private readonly earliest = computed(() => {
    const dates = [...this.store.bills().map((b) => b.date), ...this.store.payments().map((p) => p.date)];
    return dates.reduce((min, d) => (d < min ? d : min), this.store.today());
  });

  protected readonly range = computed(() => rangeFor(this.period(), this.store.today(), this.earliest()));
}
