import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ShopStore, PaymentInput } from '../../core/store';
import { UiService } from '../../core/ui.service';
import { BillItem, ItemCategory, MakingType, PaymentMode, Purity } from '../../core/models';
import {
  CATEGORIES,
  GOLD_PURITIES,
  SILVER_PURITIES,
  computeBillTotals,
  itemAmount,
  metalOf,
  oldGoldValue,
} from '../../core/calc';
import { todayISO } from '../../core/dates';
import { formatINR } from '../../core/format';
import { CustomerPicker } from '../../shared/customer-picker';
import { Icon } from '../../shared/icon';
import { BalancePipe, GramsPipe, InrPipe } from '../../shared/pipes';

const PAY_MODES: PaymentMode[] = ['Cash', 'UPI', 'Card', 'Bank transfer', 'Cheque'];

const CATEGORY_DEFAULTS: Partial<Record<ItemCategory, Partial<BillItem>>> = {
  Coin: { purity: '24K', makingType: 'percent', makingValue: 4 },
  Anklet: { purity: '925', makingType: 'perGram', makingValue: 30 },
  'Silver article': { purity: '999', makingType: 'perGram', makingValue: 20 },
};

let draftCounter = 0;

@Component({
  selector: 'app-bill-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, CustomerPicker, Icon, InrPipe, BalancePipe, GramsPipe],
  templateUrl: './bill-form.html',
  styleUrl: './bill-form.scss',
})
export class BillFormPage {
  private readonly store = inject(ShopStore);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);

  /** `?customer=<id>` when starting a bill from a customer's page. */
  readonly customer = input<string>();

  protected readonly categories = CATEGORIES;
  protected readonly purities = [...GOLD_PURITIES, ...SILVER_PURITIES];
  protected readonly payModes = PAY_MODES;
  protected readonly goldPurities = GOLD_PURITIES;
  protected readonly metalOf = metalOf;
  protected readonly itemAmount = itemAmount;
  protected readonly today = todayISO;
  protected readonly settings = this.store.settings;

  protected readonly customerId = linkedSignal(() => this.customer() ?? '');
  protected readonly date = signal(todayISO());
  protected readonly items = signal<BillItem[]>([this.newItem()]);
  protected readonly discount = signal<number | null>(null);
  protected readonly notes = signal('');

  protected readonly oldGoldOn = signal(false);
  protected readonly ogWeight = signal<number | null>(null);
  protected readonly ogPurity = signal<Purity>('22K');
  protected readonly ogRate = signal<number | null>(this.store.settings().rates['22K']);

  protected readonly payAmount = signal<number | null>(null);
  protected readonly payMode = signal<PaymentMode>('UPI');
  protected readonly payReference = signal('');
  protected readonly submitted = signal(false);

  protected readonly customerRecord = computed(() => this.store.customerById().get(this.customerId()));
  protected readonly previousBalance = computed(
    () => this.store.customerSummaries().get(this.customerId())?.balance ?? 0,
  );
  protected readonly billNo = computed(() => this.store.previewBillNo(this.date() || todayISO()));

  protected readonly totals = computed(() =>
    computeBillTotals({
      items: this.items(),
      discount: Number(this.discount()) || 0,
      gstPercent: this.settings().gstPercent,
    }),
  );

  protected readonly oldGold = computed(() =>
    this.oldGoldOn() ? oldGoldValue(this.ogWeight() ?? 0, this.ogRate() ?? 0) : 0,
  );
  protected readonly netPayable = computed(() => this.totals().total - this.oldGold());
  protected readonly paidNow = computed(() => Math.max(Math.round(Number(this.payAmount()) || 0), 0));
  protected readonly toKhata = computed(() => this.netPayable() - this.paidNow());
  protected readonly newBalance = computed(() => this.previousBalance() + this.toKhata());

  protected readonly errors = computed(() => {
    const list: string[] = [];
    if (!this.customerId()) list.push('Choose or add the customer.');
    const valid = this.items().filter((i) => i.description.trim() && Number(i.netWeight) > 0);
    if (!valid.length) list.push('Add at least one item with a description and net weight.');
    if (this.items().some((i) => Number(i.netWeight) > 0 && !(Number(i.rate) > 0))) {
      list.push('Every item needs a rate per gram.');
    }
    if (this.items().some((i) => Number(i.grossWeight) > 0 && Number(i.grossWeight) < Number(i.netWeight))) {
      list.push('Gross weight cannot be less than net weight.');
    }
    if (!this.date() || this.date() > todayISO()) list.push('Bill date cannot be in the future.');
    if (this.oldGoldOn() && !(Number(this.ogWeight()) > 0)) list.push('Enter the old gold weight or turn off the exchange.');
    return list;
  });

  protected readonly cashWarning = computed(() => this.payMode() === 'Cash' && this.paidNow() >= 200_000);

  private newItem(): BillItem {
    const rates = this.store.settings().rates;
    return {
      id: `draft-${++draftCounter}`,
      description: '',
      category: 'Chain',
      purity: '22K',
      huid: '',
      pieces: 1,
      grossWeight: 0,
      netWeight: 0,
      rate: rates['22K'],
      makingType: 'percent',
      makingValue: 12,
      stoneCharges: 0,
    };
  }

  protected addItem(): void {
    this.items.update((list) => [...list, this.newItem()]);
  }

  protected removeItem(index: number): void {
    this.items.update((list) => (list.length > 1 ? list.filter((_, i) => i !== index) : [this.newItem()]));
  }

  protected updateItem(index: number, patch: Partial<BillItem>): void {
    this.items.update((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  protected setCategory(index: number, category: ItemCategory): void {
    const defaults = CATEGORY_DEFAULTS[category] ?? {};
    const purity = defaults.purity ?? this.items()[index].purity;
    this.updateItem(index, { category, ...defaults, rate: this.settings().rates[purity] });
  }

  protected setPurity(index: number, purity: Purity): void {
    const current = this.items()[index];
    const switchingMetal = metalOf(purity) !== metalOf(current.purity);
    const makingType: MakingType = metalOf(purity) === 'Silver' ? 'perGram' : 'percent';
    this.updateItem(index, {
      purity,
      rate: this.settings().rates[purity],
      ...(switchingMetal ? { makingType, makingValue: makingType === 'perGram' ? 25 : 12 } : {}),
    });
  }

  protected setNetWeight(index: number, value: number | null): void {
    const item = this.items()[index];
    const net = Number(value) || 0;
    // Keep gross in step with net until the counter enters a separate gross weight.
    const syncGross = !item.grossWeight || item.grossWeight === item.netWeight;
    this.updateItem(index, { netWeight: net, ...(syncGross ? { grossWeight: net } : {}) });
  }

  protected setOgPurity(purity: Purity): void {
    this.ogPurity.set(purity);
    this.ogRate.set(this.settings().rates[purity]);
  }

  protected payInFull(): void {
    this.payAmount.set(Math.max(this.netPayable(), 0));
  }

  protected rateDiffers(item: BillItem): boolean {
    return Number(item.rate) !== this.settings().rates[item.purity];
  }

  protected save(print = false): void {
    this.submitted.set(true);
    if (this.errors().length) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const items = this.items()
      .filter((i) => i.description.trim() && Number(i.netWeight) > 0)
      .map((item, index) => ({
        ...item,
        id: `i${index + 1}`,
        description: item.description.trim(),
        huid: item.huid?.trim().toUpperCase() || undefined,
        pieces: Number(item.pieces) || 1,
        grossWeight: Number(item.grossWeight) || Number(item.netWeight),
        netWeight: Number(item.netWeight),
        rate: Number(item.rate),
        makingValue: Number(item.makingValue) || 0,
        stoneCharges: Number(item.stoneCharges) || 0,
      }));

    const payments: PaymentInput[] = [];
    if (this.oldGoldOn() && this.oldGold() > 0) {
      payments.push({
        date: this.date(),
        amount: this.oldGold(),
        mode: 'Old gold',
        oldGold: { weight: Number(this.ogWeight()), purity: this.ogPurity(), rate: Number(this.ogRate()) },
        notes: `${Number(this.ogWeight()).toFixed(3)} g old ${this.ogPurity()} gold exchanged`,
      });
    }
    if (this.paidNow() > 0) {
      const mode = this.payMode();
      payments.push({
        date: this.date(),
        amount: this.paidNow(),
        mode,
        reference: mode === 'Cash' ? undefined : this.payReference().trim() || undefined,
        notes: this.paidNow() >= this.netPayable() ? 'Paid at billing' : 'Advance at billing',
      });
    }

    const bill = this.store.createBill(
      {
        customerId: this.customerId(),
        date: this.date(),
        items,
        discount: this.totals().discount,
        gstPercent: this.settings().gstPercent,
        notes: this.notes().trim() || undefined,
      },
      payments,
    );
    const due = this.toKhata();
    this.ui.toast(
      `Bill ${bill.billNo} saved · ${formatINR(this.totals().total)}${due > 0 ? ` · ${formatINR(due)} to khata` : ''}`,
    );
    void this.router.navigate(['/bills', bill.id], { queryParams: print ? { print: 1 } : {} });
  }

  protected newCustomer(typed: string): void {
    this.ui.openCustomer({ initialQuery: typed, onSaved: (id) => this.customerId.set(id) });
  }
}
