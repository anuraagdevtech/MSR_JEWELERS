import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  inject,
  input,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ShopStore } from '../../core/store';
import { UiService } from '../../core/ui.service';
import { AuthService } from '../../core/auth.service';
import { hsnFor, itemAmount, itemMaking, metalOf } from '../../core/calc';
import { amountInWords } from '../../core/format';
import { Icon } from '../../shared/icon';
import { StatusChip } from '../../shared/status-chip';
import { DayPipe, GramsPipe, InrPipe, PhonePipe } from '../../shared/pipes';

const STATES: Record<string, string> = {
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
};

@Component({
  selector: 'app-bill-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, StatusChip, InrPipe, DayPipe, GramsPipe, PhonePipe],
  templateUrl: './bill-detail.html',
  styleUrl: './bill-detail.scss',
})
export class BillDetailPage {
  protected readonly store = inject(ShopStore);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  readonly id = input.required<string>();
  /** `?print=1` after "Save & print". */
  readonly print = input<string>();

  protected readonly settings = this.store.settings;
  protected readonly bill = computed(() => this.store.billById().get(this.id()));
  protected readonly customer = computed(() => {
    const bill = this.bill();
    return bill ? this.store.customerById().get(bill.customerId) : undefined;
  });
  protected readonly totals = computed(() => this.store.billTotals().get(this.id()));
  protected readonly status = computed(() => this.store.billStatus().get(this.id()));
  protected readonly payments = computed(() => (this.bill() ? this.store.paymentsForBill(this.id()) : []));
  protected readonly receivedHere = computed(() => this.payments().reduce((sum, p) => sum + p.amount, 0));
  protected readonly adjustedFromAccount = computed(() =>
    Math.max((this.status()?.paid ?? 0) - Math.min(this.receivedHere(), this.status()?.total ?? 0), 0),
  );
  protected readonly placeOfSupply = computed(() => {
    const code = this.settings().gstin.slice(0, 2);
    return STATES[code] ? `${STATES[code]} (${code})` : code || '—';
  });

  protected readonly words = computed(() => amountInWords(this.totals()?.total ?? 0));

  protected readonly lines = computed(() =>
    (this.bill()?.items ?? []).map((item) => ({
      item,
      hsn: hsnFor(item),
      metal: metalOf(item.purity),
      making: itemMaking(item),
      amount: itemAmount(item),
    })),
  );

  constructor() {
    afterNextRender(() => {
      if (this.print()) {
        setTimeout(() => {
          window.print();
          void this.router.navigate([], { queryParams: {}, replaceUrl: true });
        }, 250);
      }
    });
  }

  protected printInvoice(): void {
    window.print();
  }

  protected collect(): void {
    const bill = this.bill();
    if (bill) this.ui.openPayment({ customerId: bill.customerId, billId: bill.id });
  }

  protected async remove(): Promise<void> {
    const bill = this.bill();
    if (!bill) return;
    const linked = this.payments().length;
    const message =
      `Delete bill ${bill.billNo}?` +
      (linked ? ` ${linked} payment${linked === 1 ? '' : 's'} recorded against it will also be deleted.` : '') +
      ' This cannot be undone.';
    if (!confirm(message)) return;
    try {
      await this.store.deleteBill(bill.id);
      this.ui.toast(`Bill ${bill.billNo} deleted`, 'info');
      void this.router.navigate(['/bills']);
    } catch (error) {
      this.ui.toast((error as Error).message, 'error');
    }
  }
}
