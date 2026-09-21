import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ShopStore } from '../core/store';
import { CustomerDialogOptions, UiService } from '../core/ui.service';
import { AuthService } from '../core/auth.service';
import { phoneDigits } from '../core/format';
import { Icon } from './icon';

const CITIES = [
  'Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi', 'Dharwad', 'Belagavi', 'Udupi', 'Shivamogga',
  'Davanagere', 'Tumakuru', 'Mandya', 'Hassan', 'Ballari', 'Chikkamagaluru', 'Karwar', 'Sirsi',
];

@Component({
  selector: 'app-customer-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon],
  template: `
    <dialog #dialog class="modal" aria-labelledby="customer-title" (close)="close()" (click)="onBackdrop($event)">
      <form class="modal-card" (ngSubmit)="save()" novalidate>
        <header class="modal-head">
          <div>
            <p class="eyebrow">{{ editingId() ? 'Edit customer' : 'New customer' }}</p>
            <h2 id="customer-title">{{ editingId() ? name() || 'Customer' : 'Add customer' }}</h2>
          </div>
          <button type="button" class="icon-btn" (click)="close()" aria-label="Close">
            <app-icon name="close" />
          </button>
        </header>

        <div class="modal-body">
          <div class="grid-2">
            <div class="field">
              <label for="cust-name">Full name</label>
              <input id="cust-name" class="input" name="name" autocomplete="off" [(ngModel)]="name" />
            </div>
            <div class="field">
              <label for="cust-phone">Mobile</label>
              <input
                id="cust-phone"
                class="input"
                name="phone"
                type="tel"
                inputmode="tel"
                placeholder="10-digit mobile"
                [(ngModel)]="phone"
              />
            </div>
          </div>
          @if (duplicate(); as other) {
            <p class="notice notice-info">
              <app-icon name="info" [size]="16" />
              {{ other.name }} already uses this number. Save anyway if they share a phone.
            </p>
          }
          <div class="grid-2">
            <div class="field">
              <label for="cust-city">City / town</label>
              <input id="cust-city" class="input" name="city" list="city-options" [(ngModel)]="city" />
              <datalist id="city-options">
                @for (c of cities; track c) {
                  <option [value]="c"></option>
                }
              </datalist>
            </div>
            <div class="field">
              <label for="cust-email">Email <span class="optional">optional</span></label>
              <input id="cust-email" class="input" name="email" type="email" [(ngModel)]="email" />
            </div>
          </div>
          <div class="field">
            <label for="cust-address">Address <span class="optional">optional</span></label>
            <input id="cust-address" class="input" name="address" [(ngModel)]="address" />
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="cust-gstin">GSTIN <span class="optional">B2B only</span></label>
              <input id="cust-gstin" class="input" name="gstin" [(ngModel)]="gstin" />
            </div>
            @if (auth.isOwner()) {
            <div class="field">
              <label for="cust-opening">Opening balance (₹)</label>
              <input
                id="cust-opening"
                class="input"
                name="opening"
                type="number"
                inputmode="numeric"
                [(ngModel)]="openingBalance"
              />
              <small class="hint">Old khata dues. Use a minus sign for an advance held.</small>
            </div>
            }
          </div>
          <div class="field">
            <label for="cust-notes">Notes <span class="optional">optional</span></label>
            <textarea id="cust-notes" class="input" rows="2" name="notes" [(ngModel)]="notes"></textarea>
          </div>

          @if (submitted() && errors().length) {
            <ul class="form-errors" role="alert">
              @for (error of errors(); track error) {
                <li>{{ error }}</li>
              }
            </ul>
          }
        </div>

        <footer class="modal-foot">
          @if (editingId() && canDelete() && auth.isOwner()) {
            <button type="button" class="btn btn-ghost btn-danger me-auto" (click)="remove()">
              <app-icon name="trash" [size]="16" /> Delete
            </button>
          }
          <button type="button" class="btn btn-ghost" (click)="close()">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="busy()">
            <app-icon name="check" [size]="16" />
            {{ busy() ? 'Saving…' : editingId() ? 'Save changes' : 'Add customer' }}
          </button>
        </footer>
      </form>
    </dialog>
  `,
})
export class CustomerDialog {
  private readonly store = inject(ShopStore);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly cities = CITIES;
  protected readonly editingId = signal<string | null>(null);
  protected readonly name = signal('');
  protected readonly phone = signal('');
  protected readonly city = signal('');
  protected readonly email = signal('');
  protected readonly address = signal('');
  protected readonly gstin = signal('');
  protected readonly openingBalance = signal<number | null>(null);
  protected readonly notes = signal('');
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  private onSaved?: (id: string) => void;

  protected readonly duplicate = computed(() => {
    const digits = phoneDigits(this.phone()).slice(-10);
    if (digits.length < 10) return null;
    return (
      this.store
        .customers()
        .find((c) => c.id !== this.editingId() && phoneDigits(c.phone).slice(-10) === digits) ?? null
    );
  });

  protected readonly canDelete = computed(() => {
    const id = this.editingId();
    return !!id && this.store.canDeleteCustomer(id);
  });

  protected readonly errors = computed(() => {
    const list: string[] = [];
    if (this.name().trim().length < 2) list.push('Enter the customer’s name.');
    if (phoneDigits(this.phone()).slice(-10).length !== 10) list.push('Enter a 10-digit mobile number.');
    if (!this.city().trim()) list.push('Enter the city or town.');
    const email = this.email().trim();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) list.push('Check the email address.');
    return list;
  });

  constructor() {
    effect(() => {
      const options = this.ui.customerDialog();
      const element = this.dialog()?.nativeElement;
      if (!element) return;
      if (options) {
        untracked(() => this.reset(options));
        if (!element.open) element.showModal();
        const first = untracked(() => (this.name() ? '#cust-phone' : '#cust-name'));
        setTimeout(() => element.querySelector<HTMLElement>(first)?.focus());
      } else if (element.open) {
        element.close();
      }
    });
  }

  private reset(options: CustomerDialogOptions): void {
    const existing = options.customerId ? this.store.customerById().get(options.customerId) : undefined;
    const typed = (options.initialQuery ?? '').trim();
    const typedIsPhone = typed !== '' && /^[\d\s+-]+$/.test(typed);
    this.onSaved = options.onSaved;
    this.editingId.set(existing?.id ?? null);
    this.name.set(existing?.name ?? (typedIsPhone ? '' : typed));
    this.phone.set(existing?.phone ?? (typedIsPhone ? typed : ''));
    this.city.set(existing?.city ?? '');
    this.email.set(existing?.email ?? '');
    this.address.set(existing?.address ?? '');
    this.gstin.set(existing?.gstin ?? '');
    this.openingBalance.set(existing?.openingBalance || null);
    this.notes.set(existing?.notes ?? '');
    this.submitted.set(false);
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    if (this.errors().length || this.busy()) return;
    const digits = phoneDigits(this.phone()).slice(-10);
    const input = {
      name: this.name().trim().replace(/\s+/g, ' '),
      phone: `${digits.slice(0, 5)} ${digits.slice(5)}`,
      city: this.city().trim(),
      email: this.email().trim() || undefined,
      address: this.address().trim() || undefined,
      gstin: this.gstin().trim().toUpperCase() || undefined,
      openingBalance: Math.round(Number(this.openingBalance()) || 0),
      notes: this.notes().trim() || undefined,
    };
    const editingId = this.editingId();
    this.busy.set(true);
    try {
      let id: string;
      if (editingId) {
        await this.store.updateCustomer(editingId, input);
        id = editingId;
        this.ui.toast(`${input.name} updated`);
      } else {
        id = (await this.store.addCustomer(input)).id;
        this.ui.toast(`${input.name} added to customers`);
      }
      const callback = this.onSaved;
      this.close();
      callback?.(id);
    } catch (error) {
      this.ui.toast((error as Error).message, 'error');
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const id = this.editingId();
    if (!id || !confirm(`Delete ${this.name()}? This cannot be undone.`)) return;
    try {
      if (await this.store.deleteCustomer(id)) {
        this.ui.toast('Customer deleted', 'info');
        this.close();
        void this.router.navigate(['/customers']);
      }
    } catch (error) {
      this.ui.toast((error as Error).message, 'error');
    }
  }

  protected close(): void {
    this.onSaved = undefined;
    this.ui.customerDialog.set(null);
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog()?.nativeElement) this.close();
  }
}
