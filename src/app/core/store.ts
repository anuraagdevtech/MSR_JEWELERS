import { Injectable, computed, effect, signal } from '@angular/core';
import {
  Bill,
  BillStatus,
  BillTotals,
  Customer,
  CustomerSummary,
  LedgerEntry,
  Payment,
  RateCard,
  ShopData,
  ShopSettings,
} from './models';
import { allocatePayments, computeBillTotals } from './calc';
import { daysBetween, financialYearLabel, todayISO } from './dates';
import { formatGrams, formatINR } from './format';
import { defaultSettings, emptyData, generateDemoData } from './seed';

const STORAGE_KEY = 'msr-jewelers:data:v1';

export type CustomerInput = Omit<Customer, 'id' | 'createdAt'>;
export type BillInput = Omit<Bill, 'id' | 'billNo' | 'createdAt'>;
export type PaymentInput = Omit<Payment, 'id' | 'receiptNo' | 'createdAt' | 'customerId'>;

function uid(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function nowStamp(): string {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8);
  return `${todayISO()}T${time}`;
}

function isShopData(value: unknown): value is ShopData {
  const data = value as ShopData;
  return (
    !!data &&
    data.version === 1 &&
    Array.isArray(data.customers) &&
    Array.isArray(data.bills) &&
    Array.isArray(data.payments) &&
    typeof data.settings === 'object'
  );
}

function withSettingsDefaults(data: ShopData): ShopData {
  const defaults = defaultSettings();
  return {
    ...data,
    settings: { ...defaults, ...data.settings, rates: { ...defaults.rates, ...data.settings.rates } },
  };
}

function loadInitial(): ShopData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isShopData(parsed)) return withSettingsDefaults(parsed);
    }
  } catch {
    // Unreadable or blocked storage: fall through to demo data.
  }
  return generateDemoData();
}

@Injectable({ providedIn: 'root' })
export class ShopStore {
  private readonly state = signal<ShopData>(loadInitial());

  /** True while the book holds generated sample records. */
  readonly isDemo = computed(() => !!this.state().demo);
  readonly storageError = signal<string | null>(null);
  readonly today = signal(todayISO());

  readonly customers = computed(() => this.state().customers);
  readonly bills = computed(() => this.state().bills);
  readonly payments = computed(() => this.state().payments);
  readonly settings = computed(() => this.state().settings);

  readonly customerById = computed(() => new Map(this.customers().map((c) => [c.id, c])));
  readonly billById = computed(() => new Map(this.bills().map((b) => [b.id, b])));

  readonly billTotals = computed(() => {
    const map = new Map<string, BillTotals>();
    for (const bill of this.bills()) map.set(bill.id, computeBillTotals(bill));
    return map;
  });

  private readonly billsByCustomer = computed(() => groupBy(this.bills(), (b) => b.customerId));
  private readonly paymentsByCustomer = computed(() => groupBy(this.payments(), (p) => p.customerId));

  private readonly allocations = computed(() => {
    const totals = this.billTotals();
    const today = this.today();
    const creditDays = this.settings().creditDays;
    const bills = this.billsByCustomer();
    const payments = this.paymentsByCustomer();
    return new Map(
      this.customers().map((customer) => [
        customer.id,
        allocatePayments(
          customer,
          bills.get(customer.id) ?? [],
          payments.get(customer.id) ?? [],
          totals,
          today,
          creditDays,
        ),
      ]),
    );
  });

  readonly billStatus = computed(() => {
    const map = new Map<string, BillStatus>();
    for (const allocation of this.allocations().values()) {
      for (const [billId, status] of allocation.byBill) map.set(billId, status);
    }
    return map;
  });

  /** Dues still open from the opening (paper khata) balance, per customer. */
  readonly openingRemaining = computed(() => {
    const map = new Map<string, number>();
    for (const [customerId, allocation] of this.allocations()) {
      map.set(customerId, allocation.openingRemaining);
    }
    return map;
  });

  readonly customerSummaries = computed(() => {
    const totals = this.billTotals();
    const statuses = this.billStatus();
    const openingLeft = this.openingRemaining();
    const bills = this.billsByCustomer();
    const payments = this.paymentsByCustomer();
    const summaries = new Map<string, CustomerSummary>();

    for (const customer of this.customers()) {
      const customerBills = bills.get(customer.id) ?? [];
      const customerPayments = payments.get(customer.id) ?? [];
      const billed = customerBills.reduce((sum, b) => sum + (totals.get(b.id)?.total ?? 0), 0);
      const paid = customerPayments.reduce((sum, p) => sum + p.amount, 0);
      let overdueAmount = 0;
      let oldestDueDays = 0;
      for (const bill of customerBills) {
        const status = statuses.get(bill.id);
        if (!status || status.balance <= 0) continue;
        if (status.overdue) overdueAmount += status.balance;
        oldestDueDays = Math.max(oldestDueDays, status.daysOpen);
      }
      if ((openingLeft.get(customer.id) ?? 0) > 0) {
        overdueAmount += openingLeft.get(customer.id) ?? 0;
        oldestDueDays = Math.max(oldestDueDays, daysBetween(customer.createdAt, this.today()));
      }
      const lastBillDate = maxDate(customerBills.map((b) => b.date));
      const lastPaymentDate = maxDate(customerPayments.map((p) => p.date));
      summaries.set(customer.id, {
        billed,
        paid,
        balance: Math.round(customer.openingBalance + billed - paid),
        billsCount: customerBills.length,
        lastBillDate,
        lastPaymentDate,
        lastActivity: maxDate([lastBillDate, lastPaymentDate].filter(Boolean) as string[]),
        overdueAmount: Math.round(overdueAmount),
        oldestDueDays,
        goldExchangedGrams: customerPayments.reduce((sum, p) => sum + (p.oldGold?.weight ?? 0), 0),
      });
    }
    return summaries;
  });

  /** Every debit (bill, opening due) and credit (payment, opening advance), newest first. */
  readonly ledger = computed<LedgerEntry[]>(() => {
    const totals = this.billTotals();
    const billById = this.billById();
    const entries: LedgerEntry[] = [];

    for (const customer of this.customers()) {
      if (customer.openingBalance !== 0) {
        entries.push({
          id: `opening-${customer.id}`,
          date: customer.createdAt,
          createdAt: `${customer.createdAt}T00:00:00`,
          customerId: customer.id,
          type: customer.openingBalance > 0 ? 'debit' : 'credit',
          source: 'opening',
          ref: 'Opening',
          particulars: 'Opening balance (brought forward)',
          amount: Math.abs(customer.openingBalance),
        });
      }
    }

    for (const bill of this.bills()) {
      const names = bill.items.map((item) => item.description);
      const totalsForBill = totals.get(bill.id);
      entries.push({
        id: bill.id,
        date: bill.date,
        createdAt: bill.createdAt,
        customerId: bill.customerId,
        type: 'debit',
        source: 'bill',
        ref: bill.billNo,
        particulars: `Sale · ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''} · ${formatGrams(totalsForBill?.netWeight ?? 0)}`,
        amount: totalsForBill?.total ?? 0,
        billId: bill.id,
      });
    }

    for (const payment of this.payments()) {
      const bill = payment.billId ? billById.get(payment.billId) : undefined;
      const against = bill ? ` · against ${bill.billNo}` : '';
      const particulars =
        payment.mode === 'Old gold' && payment.oldGold
          ? `Old gold ${formatGrams(payment.oldGold.weight)} ${payment.oldGold.purity} @ ${formatINR(payment.oldGold.rate)}/g${against}`
          : `${payment.notes || 'Payment received'}${against}`;
      entries.push({
        id: payment.id,
        date: payment.date,
        createdAt: payment.createdAt,
        customerId: payment.customerId,
        type: 'credit',
        source: 'payment',
        ref: payment.receiptNo,
        particulars,
        amount: payment.amount,
        mode: payment.mode,
        billId: payment.billId,
        paymentId: payment.id,
      });
    }

    return entries.sort(
      (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
  });

  constructor() {
    // Counter PCs stay open overnight: roll "today" forward whenever the tab comes back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.today.set(todayISO());
    });
    effect(() => {
      const data = this.state();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        this.storageError.set(null);
      } catch {
        this.storageError.set('Could not save to this browser. Export a backup from Settings.');
      }
    });
  }

  // ---- Customers ---------------------------------------------------------------------------

  addCustomer(input: CustomerInput): Customer {
    const customer: Customer = { ...input, id: uid('c'), createdAt: todayISO() };
    this.state.update((data) => ({ ...data, customers: [...data.customers, customer] }));
    return customer;
  }

  updateCustomer(id: string, input: CustomerInput): void {
    this.state.update((data) => ({
      ...data,
      customers: data.customers.map((c) => (c.id === id ? { ...c, ...input } : c)),
    }));
  }

  canDeleteCustomer(id: string): boolean {
    return !this.bills().some((b) => b.customerId === id) && !this.payments().some((p) => p.customerId === id);
  }

  deleteCustomer(id: string): boolean {
    if (!this.canDeleteCustomer(id)) return false;
    this.state.update((data) => ({ ...data, customers: data.customers.filter((c) => c.id !== id) }));
    return true;
  }

  // ---- Bills & payments --------------------------------------------------------------------

  createBill(input: BillInput, paymentsAtBilling: PaymentInput[]): Bill {
    const bill: Bill = {
      ...input,
      id: uid('b'),
      billNo: this.nextNumber(this.settings().billPrefix, input.date, this.bills().map((b) => b.billNo)),
      createdAt: nowStamp(),
    };
    const receiptNos = this.payments().map((p) => p.receiptNo);
    const payments: Payment[] = [];
    for (const draft of paymentsAtBilling.filter((p) => p.amount > 0)) {
      const receiptNo = this.nextNumber(this.settings().receiptPrefix, draft.date, receiptNos);
      receiptNos.push(receiptNo);
      payments.push({
        ...draft,
        id: uid('p'),
        receiptNo,
        customerId: bill.customerId,
        billId: bill.id,
        createdAt: nowStamp(),
      });
    }
    this.state.update((data) => ({
      ...data,
      bills: [...data.bills, bill],
      payments: [...data.payments, ...payments],
    }));
    return bill;
  }

  /** Removes a bill together with every payment recorded against it. */
  deleteBill(id: string): void {
    this.state.update((data) => ({
      ...data,
      bills: data.bills.filter((b) => b.id !== id),
      payments: data.payments.filter((p) => p.billId !== id),
    }));
  }

  addPayment(customerId: string, input: PaymentInput): Payment {
    const payment: Payment = {
      ...input,
      id: uid('p'),
      customerId,
      receiptNo: this.nextNumber(
        this.settings().receiptPrefix,
        input.date,
        this.payments().map((p) => p.receiptNo),
      ),
      createdAt: nowStamp(),
    };
    this.state.update((data) => ({ ...data, payments: [...data.payments, payment] }));
    return payment;
  }

  deletePayment(id: string): void {
    this.state.update((data) => ({ ...data, payments: data.payments.filter((p) => p.id !== id) }));
  }

  paymentsForBill(billId: string): Payment[] {
    return this.payments()
      .filter((p) => p.billId === billId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  }

  previewBillNo(date: string): string {
    return this.nextNumber(this.settings().billPrefix, date, this.bills().map((b) => b.billNo));
  }

  // ---- Settings & data ---------------------------------------------------------------------

  updateSettings(patch: Partial<ShopSettings>): void {
    this.state.update((data) => ({ ...data, settings: { ...data.settings, ...patch } }));
  }

  updateRates(rates: RateCard): void {
    this.updateSettings({ rates: { ...rates }, ratesUpdatedAt: nowStamp() });
  }

  exportJSON(): string {
    return JSON.stringify(this.state(), null, 2);
  }

  importJSON(json: string): void {
    const parsed = JSON.parse(json);
    if (!isShopData(parsed)) {
      throw new Error('This file is not an MSR Jewelers backup.');
    }
    this.state.set({ ...withSettingsDefaults(parsed), demo: parsed.demo ?? false });
  }

  /** Fresh demo history priced off the shop's current 24K and silver rates; settings are kept. */
  resetToDemo(): void {
    const settings = this.settings();
    const demo = generateDemoData(todayISO(), {
      gold24: settings.rates['24K'],
      silver999: settings.rates['999'],
    });
    this.state.set({ ...demo, settings });
  }

  clearAll(): void {
    const settings = this.settings();
    this.state.set({ ...emptyData(), demo: false, settings });
  }

  private nextNumber(prefix: string, date: string, existing: string[]): string {
    const fy = financialYearLabel(date);
    const stem = `${prefix}/${fy}/`;
    const highest = existing
      .filter((no) => no.startsWith(stem))
      .reduce((max, no) => Math.max(max, Number(no.slice(stem.length)) || 0), 0);
    return `${stem}${String(highest + 1).padStart(4, '0')}`;
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function maxDate(dates: string[]): string | undefined {
  return dates.reduce<string | undefined>((max, d) => (!max || d > max ? d : max), undefined);
}
