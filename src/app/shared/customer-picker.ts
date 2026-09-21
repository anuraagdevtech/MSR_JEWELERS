import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ShopStore } from '../core/store';
import { AuthService } from '../core/auth.service';
import { initials, phoneDigits } from '../core/format';
import { Icon } from './icon';
import { BalancePipe, PhonePipe } from './pipes';

let pickerCount = 0;

/** Find a customer by name, phone or city; keyboard friendly for the counter. */
@Component({
  selector: 'app-customer-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, BalancePipe, PhonePipe],
  template: `
    @if (selected(); as customer) {
      <div class="picked">
        <span class="avatar">{{ initialsOf(customer.name) }}</span>
        <div class="picked-text">
          <strong>{{ customer.name }}</strong>
          <small>{{ customer.phone | phone }} · {{ customer.city }}</small>
        </div>
        @if (balanceOf(customer.id); as bal) {
          <span class="picked-bal" [class.due]="bal > 0">{{ bal | balance }}</span>
        }
        @if (!locked()) {
          <button type="button" class="btn btn-ghost btn-sm" (click)="clear()">Change</button>
        }
      </div>
    } @else {
      <div class="combo">
        <app-icon name="search" [size]="16" class="combo-icon" />
        <input
          #field
          type="search"
          class="input"
          role="combobox"
          autocomplete="off"
          [id]="inputId()"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="listId"
          [attr.aria-activedescendant]="open() ? listId + '-' + highlighted() : null"
          [placeholder]="placeholder()"
          [value]="query()"
          (input)="onInput($any($event.target).value)"
          (focus)="open.set(true)"
          (blur)="onBlur()"
          (keydown)="onKey($event)"
        />
        @if (open()) {
          <ul class="options" role="listbox" [id]="listId">
            @for (customer of matches(); track customer.id; let i = $index) {
              <li
                role="option"
                [id]="listId + '-' + i"
                [class.active]="i === highlighted()"
                [attr.aria-selected]="i === highlighted()"
                (mousedown)="$event.preventDefault()"
                (click)="choose(customer.id)"
                (mouseenter)="highlighted.set(i)"
              >
                <span class="avatar sm">{{ initialsOf(customer.name) }}</span>
                <span class="opt-text">
                  <strong>{{ customer.name }}</strong>
                  <small>{{ customer.phone | phone }} · {{ customer.city }}</small>
                </span>
                @if (balanceOf(customer.id); as bal) {
                  <small class="opt-bal" [class.due]="bal > 0">{{ bal | balance }}</small>
                }
              </li>
            } @empty {
              <li class="none">No customer matches “{{ query() }}”.</li>
            }
            @if (allowCreate()) {
              <li
                role="option"
                class="create"
                [id]="listId + '-' + matches().length"
                [class.active]="highlighted() === matches().length"
                (mousedown)="$event.preventDefault()"
                (click)="create.emit(query())"
              >
                <app-icon name="userPlus" [size]="16" />
                Add new customer{{ query() ? ' “' + query() + '”' : '' }}
              </li>
            }
          </ul>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
    }
    .combo {
      position: relative;
    }
    .combo-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-3);
      pointer-events: none;
    }
    .combo .input {
      padding-left: 36px;
    }
    .options {
      position: absolute;
      z-index: 20;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      max-height: 320px;
      overflow: auto;
      margin: 0;
      padding: 6px;
      list-style: none;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: var(--shadow-lg);
    }
    li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 8px;
      cursor: pointer;
    }
    li.active {
      background: var(--hover-wash);
    }
    li.none {
      cursor: default;
      color: var(--text-3);
      font-size: 0.875rem;
    }
    li.create {
      color: var(--accent-text);
      font-weight: 600;
      font-size: 0.875rem;
      border-top: 1px solid var(--border);
      border-radius: 0 0 8px 8px;
      margin-top: 4px;
    }
    .opt-text,
    .picked-text {
      display: grid;
      min-width: 0;
      flex: 1;
    }
    .opt-text small,
    .picked-text small {
      color: var(--text-3);
      font-size: 0.75rem;
    }
    .opt-bal,
    .picked-bal {
      font-variant-numeric: tabular-nums;
      color: var(--text-2);
      white-space: nowrap;
    }
    .due {
      color: var(--danger-text);
      font-weight: 600;
    }
    .picked {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface-2);
    }
  `,
})
export class CustomerPicker {
  private readonly store = inject(ShopStore);
  private readonly auth = inject(AuthService);

  readonly value = model<string>('');
  readonly placeholder = input('Search by name, phone or city');
  readonly allowCreate = input(true);
  readonly locked = input(false);
  readonly inputId = input(`customer-picker-${++pickerCount}`);
  readonly create = output<string>();

  protected readonly listId = `customer-options-${pickerCount}`;
  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly highlighted = signal(0);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly selected = computed(() => this.store.customerById().get(this.value()) ?? null);

  protected readonly matches = computed(() => {
    const term = this.query().trim().toLowerCase();
    const digits = phoneDigits(term);
    const summaries = this.store.customerSummaries();
    const list = this.store.customers().filter((c) => {
      if (!term) return true;
      return (
        c.name.toLowerCase().includes(term) ||
        c.city.toLowerCase().includes(term) ||
        (digits.length >= 3 && phoneDigits(c.phone).includes(digits))
      );
    });
    return list
      .sort((a, b) =>
        term
          ? a.name.localeCompare(b.name)
          : (summaries.get(b.id)?.lastActivity ?? '').localeCompare(summaries.get(a.id)?.lastActivity ?? ''),
      )
      .slice(0, 8);
  });

  protected initialsOf(name: string): string {
    return initials(name);
  }

  /** Balances are for owners only; staff see 0, which hides the figure. */
  protected balanceOf(customerId: string): number {
    if (!this.auth.isOwner()) return 0;
    return this.store.customerSummaries().get(customerId)?.balance ?? 0;
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.highlighted.set(0);
    this.open.set(true);
  }

  protected onBlur(): void {
    this.open.set(false);
  }

  protected onKey(event: KeyboardEvent): void {
    const optionCount = this.matches().length + (this.allowCreate() ? 1 : 0);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.open.set(true);
      this.highlighted.update((i) => Math.min(i + 1, optionCount - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlighted.update((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const match = this.matches()[this.highlighted()];
      if (match) this.choose(match.id);
      else if (this.allowCreate()) this.create.emit(this.query());
    } else if (event.key === 'Escape') {
      this.open.set(false);
    }
  }

  protected choose(customerId: string): void {
    this.value.set(customerId);
    this.query.set('');
    this.open.set(false);
  }

  protected clear(): void {
    this.value.set('');
    setTimeout(() => this.field()?.nativeElement.focus());
  }
}
