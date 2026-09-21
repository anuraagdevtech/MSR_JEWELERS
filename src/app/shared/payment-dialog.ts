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
import { ShopStore } from '../core/store';
import { PaymentDialogOptions, UiService } from '../core/ui.service';
import { AuthService } from '../core/auth.service';
import { PaymentMode, Purity } from '../core/models';
import { GOLD_PURITIES, oldGoldValue } from '../core/calc';
import { todayISO } from '../core/dates';
import { formatINR } from '../core/format';
import { CustomerPicker } from './customer-picker';
import { Icon } from './icon';
import { BalancePipe, DayPipe, InrPipe } from './pipes';

const MODES: PaymentMode[] = ['Cash', 'UPI', 'Card', 'Bank transfer', 'Cheque', 'Old gold'];

const REFERENCE_HINT: Partial<Record<PaymentMode, string>> = {
  UPI: 'UPI transaction ID',
  Card: 'Last 4 digits / approval code',
  'Bank transfer': 'NEFT / IMPS / RTGS reference',
  Cheque: 'Cheque no. and bank',
};

/** Section 269ST: cash of ₹2 lakh or more from one person in a day is not allowed. */
const CASH_LIMIT = 200_000;

@Component({
  selector: 'app-payment-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CustomerPicker, Icon, InrPipe, BalancePipe, DayPipe],
  templateUrl: './payment-dialog.html',
})
export class PaymentDialog {
  protected readonly store = inject(ShopStore);
  private readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly modes = MODES;
  protected readonly goldPurities = GOLD_PURITIES;
  protected readonly today = todayISO;

  protected readonly customerLocked = signal(false);
  protected readonly customerId = signal('');
  protected readonly billId = signal('');
  protected readonly mode = signal<PaymentMode>('Cash');
  protected readonly amount = signal<number | null>(null);
  protected readonly date = signal(todayISO());
  protected readonly reference = signal('');
  protected readonly notes = signal('');
  protected readonly goldWeight = signal<number | null>(null);
  protected readonly goldPurity = signal<Purity>('22K');
  protected readonly goldRate = signal<number | null>(null);
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);

  protected readonly customer = computed(() => this.store.customerById().get(this.customerId()));
  protected readonly balance = computed(
    () => this.store.customerSummaries().get(this.customerId())?.balance ?? 0,
  );

  protected readonly openBills = computed(() => {
    const statuses = this.store.billStatus();
    const selected = this.billId();
    return this.store
      .bills()
      .filter((b) => b.customerId === this.customerId())
      .map((bill) => ({ bill, status: statuses.get(bill.id) }))
      .filter(({ bill, status }) => (status?.balance ?? 0) > 0 || bill.id === selected)
      .sort((a, b) => a.bill.date.localeCompare(b.bill.date));
  });

  protected readonly effectiveAmount = computed(() =>
    this.mode() === 'Old gold'
      ? oldGoldValue(this.goldWeight() ?? 0, this.goldRate() ?? 0)
      : Math.round(Number(this.amount()) || 0),
  );

  protected readonly balanceAfter = computed(() => this.balance() - this.effectiveAmount());
  protected readonly referenceHint = computed(() => REFERENCE_HINT[this.mode()] ?? '');
  protected readonly cashWarning = computed(
    () => this.mode() === 'Cash' && this.effectiveAmount() >= CASH_LIMIT,
  );

  protected readonly errors = computed(() => {
    const list: string[] = [];
    if (!this.customerId()) list.push('Choose the customer who paid.');
    if (this.effectiveAmount() <= 0) list.push('Enter an amount greater than zero.');
    if (this.mode() === 'Old gold' && !(Number(this.goldWeight()) > 0)) list.push('Enter the old gold weight.');
    if (!this.date() || this.date() > todayISO()) list.push('Payment date cannot be in the future.');
    return list;
  });

  constructor() {
    effect(() => {
      const options = this.ui.paymentDialog();
      const element = this.dialog()?.nativeElement;
      if (!element) return;
      if (options) {
        untracked(() => this.reset(options));
        if (!element.open) element.showModal();
        // Start where the counter types first: the customer search, or the amount when preset.
        setTimeout(() =>
          element.querySelector<HTMLElement>(options.customerId ? '#payment-amount' : '#payment-customer')?.focus(),
        );
      } else if (element.open) {
        element.close();
      }
    });
  }

  private reset(options: PaymentDialogOptions): void {
    this.customerLocked.set(!!options.customerId);
    this.customerId.set(options.customerId ?? '');
    this.billId.set(options.billId ?? '');
    this.mode.set('Cash');
    this.date.set(todayISO());
    this.reference.set('');
    this.notes.set('');
    this.goldWeight.set(null);
    this.goldPurity.set('22K');
    this.goldRate.set(this.store.settings().rates['22K']);
    this.submitted.set(false);
    this.amount.set(null);
  }

  /** What is due on the chosen bill, or on the whole account. Offered as a one-tap fill, never pre-filled. */
  protected readonly suggested = computed(() => {
    const billId = this.billId();
    if (billId) return Math.round(this.store.billStatus().get(billId)?.balance ?? 0);
    return Math.max(this.balance(), 0);
  });

  protected onCustomer(customerId: string): void {
    this.customerId.set(customerId);
    this.billId.set('');
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('#payment-amount')?.focus());
  }

  protected onBill(billId: string): void {
    this.billId.set(billId);
  }

  protected onPurity(purity: Purity): void {
    this.goldPurity.set(purity);
    this.goldRate.set(this.store.settings().rates[purity]);
  }

  protected newCustomer(typed: string): void {
    this.ui.openCustomer({ initialQuery: typed, onSaved: (id) => this.onCustomer(id) });
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    if (this.errors().length || this.busy()) return;
    const mode = this.mode();
    this.busy.set(true);
    try {
      const payment = await this.store.addPayment(this.customerId(), {
        billId: this.billId() || undefined,
        date: this.date(),
        amount: this.effectiveAmount(),
        mode,
        reference: mode === 'Cash' || mode === 'Old gold' ? undefined : this.reference().trim() || undefined,
        oldGold:
          mode === 'Old gold'
            ? { weight: Number(this.goldWeight()), purity: this.goldPurity(), rate: Number(this.goldRate()) }
            : undefined,
        notes: this.notes().trim() || undefined,
      });
      this.ui.toast(`Receipt ${payment.receiptNo} saved · ${formatINR(payment.amount)} from ${this.customer()?.name}`);
      this.close();
    } catch (error) {
      this.ui.toast((error as Error).message, 'error');
    } finally {
      this.busy.set(false);
    }
  }

  protected close(): void {
    this.ui.paymentDialog.set(null);
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog()?.nativeElement) this.close();
  }
}
