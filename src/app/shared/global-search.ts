import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { ShopStore } from '../core/store';
import { initials, phoneDigits } from '../core/format';
import { Icon } from './icon';
import { BalancePipe, DayPipe, InrPipe, PhonePipe } from './pipes';

interface Result {
  kind: 'customer' | 'bill';
  id: string;
  link: string[];
}

/** Top-bar search across customers (name, phone, city) and bills (bill number). Press "/" to focus. */
@Component({
  selector: 'app-global-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, BalancePipe, InrPipe, DayPipe, PhonePipe],
  host: { '(document:keydown)': 'onGlobalKey($event)' },
  template: `
    <div class="search" role="search">
      <app-icon name="search" [size]="16" class="search-icon" />
      <input
        #field
        type="search"
        class="input"
        placeholder="Search customer, phone or bill no."
        aria-label="Search customers and bills"
        role="combobox"
        autocomplete="off"
        aria-controls="global-results"
        [attr.aria-expanded]="showResults()"
        [value]="query()"
        (input)="onInput($any($event.target).value)"
        (focus)="focused.set(true)"
        (blur)="focused.set(false)"
        (keydown)="onKey($event)"
      />
      <kbd class="search-kbd" aria-hidden="true">/</kbd>

      @if (showResults()) {
        <div class="results" id="global-results" role="listbox">
          @if (customers().length) {
            <p class="results-label">Customers</p>
            @for (c of customers(); track c.customer.id; let i = $index) {
              <button
                type="button"
                role="option"
                class="result"
                [class.active]="highlighted() === i"
                [attr.aria-selected]="highlighted() === i"
                (mousedown)="$event.preventDefault()"
                (click)="go(['/customers', c.customer.id])"
              >
                <span class="avatar sm">{{ initialsOf(c.customer.name) }}</span>
                <span class="result-text">
                  <strong>{{ c.customer.name }}</strong>
                  <small>{{ c.customer.phone | phone }} · {{ c.customer.city }}</small>
                </span>
                <small class="result-meta" [class.text-danger]="c.balance > 0">{{ c.balance | balance }}</small>
              </button>
            }
          }
          @if (bills().length) {
            <p class="results-label">Bills</p>
            @for (b of bills(); track b.bill.id; let i = $index) {
              <button
                type="button"
                role="option"
                class="result"
                [class.active]="highlighted() === customers().length + i"
                [attr.aria-selected]="highlighted() === customers().length + i"
                (mousedown)="$event.preventDefault()"
                (click)="go(['/bills', b.bill.id])"
              >
                <span class="avatar sm square"><app-icon name="receipt" [size]="14" /></span>
                <span class="result-text">
                  <strong>{{ b.bill.billNo }}</strong>
                  <small>{{ b.customerName }} · {{ b.bill.date | day }}</small>
                </span>
                <small class="result-meta">{{ b.total | inr }}</small>
              </button>
            }
          }
          @if (!customers().length && !bills().length) {
            <p class="results-empty">Nothing found for “{{ query() }}”.</p>
          }
        </div>
      }
    </div>
  `,
})
export class GlobalSearch {
  private readonly store = inject(ShopStore);
  private readonly router = inject(Router);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly query = signal('');
  protected readonly focused = signal(false);
  protected readonly highlighted = signal(0);

  protected readonly showResults = computed(() => this.focused() && this.query().trim().length > 0);

  protected readonly customers = computed(() => {
    const term = this.query().trim().toLowerCase();
    if (!term) return [];
    const digits = phoneDigits(term);
    const summaries = this.store.customerSummaries();
    return this.store
      .customers()
      .filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.city.toLowerCase().startsWith(term) ||
          (digits.length >= 3 && phoneDigits(c.phone).includes(digits)),
      )
      .slice(0, 6)
      .map((customer) => ({ customer, balance: summaries.get(customer.id)?.balance ?? 0 }));
  });

  protected readonly bills = computed(() => {
    const term = this.query().trim().toLowerCase();
    if (term.length < 2) return [];
    const totals = this.store.billTotals();
    const customers = this.store.customerById();
    return this.store
      .bills()
      .filter((b) => b.billNo.toLowerCase().includes(term))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 4)
      .map((bill) => ({
        bill,
        total: totals.get(bill.id)?.total ?? 0,
        customerName: customers.get(bill.customerId)?.name ?? 'Unknown',
      }));
  });

  private readonly results = computed<Result[]>(() => [
    ...this.customers().map((c) => ({ kind: 'customer' as const, id: c.customer.id, link: ['/customers', c.customer.id] })),
    ...this.bills().map((b) => ({ kind: 'bill' as const, id: b.bill.id, link: ['/bills', b.bill.id] })),
  ]);

  protected initialsOf(name: string): string {
    return initials(name);
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.highlighted.set(0);
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.results().length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.highlighted.update((i) => Math.min(i + 1, count - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlighted.update((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      const target = this.results()[this.highlighted()];
      if (target) {
        event.preventDefault();
        this.go(target.link);
      }
    } else if (event.key === 'Escape') {
      this.query.set('');
      this.field()?.nativeElement.blur();
    }
  }

  protected onGlobalKey(event: KeyboardEvent): void {
    if (event.key !== '/' || event.metaKey || event.ctrlKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], dialog[open]')) return;
    event.preventDefault();
    this.field()?.nativeElement.focus();
  }

  protected go(link: string[]): void {
    this.query.set('');
    this.field()?.nativeElement.blur();
    void this.router.navigate(link);
  }
}
