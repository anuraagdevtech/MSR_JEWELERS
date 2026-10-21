import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import {
  Bill,
  BillStatus,
  BillTotals,
  Customer,
  CustomerSummary,
  LedgerEntry,
  Payment,
  RateCard,
  RegisterEntry,
  RegisterRow,
  RegisterSummary,
  ShopData,
  ShopSettings,
} from './models';
import { allocatePayments, computeBillTotals } from './calc';
import { addDays, daysBetween, financialYearLabel, todayISO } from './dates';
import { formatGrams, formatINR } from './format';
import { defaultSettings, emptyData, generateDemoData } from './seed';
import { migrateShopProfile } from './shop-profile';
import { AuthService } from './auth.service';
import { CLOUD } from './env';
import { friendlyError, supabase } from './supabase';
import {
  BillRow,
  CustomerRow,
  OpeningRow,
  PaymentRow,
  RegisterEntryRow,
  billFromRow,
  billToRow,
  customerFromRow,
  customerToRow,
  paymentFromRow,
  paymentToRow,
  registerEntryFromRow,
  registerEntryToRow,
} from './cloud-mapping';

// Keep this key as-is: renaming it would orphan every browser's saved records.
const STORAGE_KEY = 'msr-jewelers:data:v1';
const PAGE_SIZE = 1000;
const RESYNC_AFTER_MS = 2 * 60 * 1000;

export type CustomerInput = Omit<Customer, 'id' | 'createdAt'>;
export type BillInput = Omit<Bill, 'id' | 'billNo' | 'createdAt'>;
export type PaymentInput = Omit<Payment, 'id' | 'receiptNo' | 'createdAt' | 'customerId'>;
export type RegisterEntryInput = Omit<RegisterEntry, 'id' | 'createdAt'>;

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

function round3(value: number): number {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function withDefaults(settings: Partial<ShopSettings> | null | undefined): ShopSettings {
  const defaults = defaultSettings();
  const merged = { ...defaults, ...settings, rates: { ...defaults.rates, ...settings?.rates } };
  // Earlier builds saved the US spelling as the default shop name.
  if (merged.shopName === 'MSR Jewelers') merged.shopName = defaults.shopName;
  return migrateShopProfile({ ...merged, stateCode: settings?.stateCode });
}

/** Fills in anything a backup from an older build is missing. */
function withSettingsDefaults(data: ShopData): ShopData {
  return {
    ...data,
    registerEntries: Array.isArray(data.registerEntries) ? data.registerEntries : [],
    settings: withDefaults(data.settings),
  };
}

function loadLocal(): ShopData {
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

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((x) => x.id === item.id);
  if (index === -1) return [...list, item];
  const next = [...list];
  next[index] = item;
  return next;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The shop's book: customers, bills, payments and settings, plus everything derived from
 * them (balances, bill status, ledger). In local mode it lives in this browser's storage;
 * in cloud mode it is loaded from Supabase after sign-in, kept live with realtime updates,
 * and every change is written to the database before it shows on screen.
 */
@Injectable({ providedIn: 'root' })
export class ShopStore {
  private readonly auth = inject(AuthService);
  private readonly state = signal<ShopData>(CLOUD ? emptyData() : loadLocal());

  readonly cloud = CLOUD;
  /** False until the cloud book has been fetched after sign-in. */
  readonly loaded = signal(!CLOUD);
  readonly loadError = signal<string | null>(null);
  /** True while the book holds generated sample records. */
  readonly isDemo = computed(() => !!this.state().demo || !!this.state().settings.sampleData);
  readonly storageError = signal<string | null>(null);
  readonly today = signal(todayISO());

  readonly customers = computed(() => this.auth.stage() !== 'ready' ? [] : this.state().customers.map((c) =>
    this.auth.canAnalyse() ? c : { ...c, openingBalance: 0 },
  ));
  readonly bills = computed(() => this.auth.stage() !== 'ready' ? [] : this.state().bills.filter((b) => this.visibleAtCounter(b)));
  readonly payments = computed(() => this.auth.stage() !== 'ready' ? [] : this.state().payments.filter((p) => this.visibleAtCounter(p)));
  readonly registerEntries = computed(() => this.auth.canAnalyse() ? this.state().registerEntries : []);
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

  /**
   * The register book, oldest line first, numbered S.No 1..N like the paper book, each line
   * carrying that customer's gold and cash balance as at that line.
   */
  readonly registerRows = computed<RegisterRow[]>(() => {
    const sorted = [...this.registerEntries()].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
    const gold = new Map<string, number>();
    const cash = new Map<string, number>();
    return sorted.map((entry, index) => {
      const goldBalance = round3((gold.get(entry.customerId) ?? 0) + entry.goldDebit - entry.goldCredit);
      const cashBalance = Math.round((cash.get(entry.customerId) ?? 0) + entry.cashDebit - entry.cashCredit);
      gold.set(entry.customerId, goldBalance);
      cash.set(entry.customerId, cashBalance);
      return { ...entry, serial: index + 1, goldBalance, cashBalance };
    });
  });

  /** What each customer owes the register, in grams and in rupees. */
  readonly registerSummaries = computed(() => {
    const summaries = new Map<string, RegisterSummary>();
    for (const entry of this.registerEntries()) {
      const current =
        summaries.get(entry.customerId) ??
        {
          entries: 0,
          goldCredit: 0,
          goldDebit: 0,
          goldBalance: 0,
          cashCredit: 0,
          cashDebit: 0,
          cashBalance: 0,
        };
      current.entries += 1;
      current.goldCredit = round3(current.goldCredit + entry.goldCredit);
      current.goldDebit = round3(current.goldDebit + entry.goldDebit);
      current.goldBalance = round3(current.goldDebit - current.goldCredit);
      current.cashCredit += entry.cashCredit;
      current.cashDebit += entry.cashDebit;
      current.cashBalance = Math.round(current.cashDebit - current.cashCredit);
      if (!current.lastDate || entry.date > current.lastDate) current.lastDate = entry.date;
      summaries.set(entry.customerId, current);
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

  private channel: RealtimeChannel | null = null;
  private loading: Promise<void> | null = null;
  private lastSync = 0;
  private generation = 0;

  private visibleAtCounter(record: Bill | Payment): boolean {
    if (this.auth.canAnalyse()) return true;
    return record.createdBy === this.auth.profile()?.userId && record.createdAt.slice(0, 10) >= addDays(this.today(), -1);
  }

  private requirePermission(kind: 'admin' | 'billing'): void {
    if (this.auth.stage() !== 'ready' || !(kind === 'admin' ? this.auth.isAdmin() : this.auth.canBill())) {
      throw new Error('This profile cannot change these records. Ask an admin.');
    }
  }

  constructor() {
    // Counter PCs stay open overnight: roll "today" forward and catch up whenever the tab
    // comes back into view.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      this.today.set(todayISO());
      if (CLOUD && this.loaded() && Date.now() - this.lastSync > RESYNC_AFTER_MS) void this.load();
    });

    if (!CLOUD) {
      effect(() => {
        const data = this.state();
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
          this.storageError.set(null);
        } catch {
          this.storageError.set('Could not save to this browser. Export a backup from Settings.');
        }
      });
      return;
    }

    effect(() => {
      const ready = this.auth.stage() === 'ready';
      const user = this.auth.profile()?.userId;
      const role = this.auth.role();
      untracked(() => {
        this.unload();
        if (ready && user && role) void this.load();
      });
    });
  }

  // ---- Cloud sync --------------------------------------------------------------------------

  /** Fetches the whole book the signed-in user is allowed to see. */
  load(): Promise<void> {
    if (!supabase) return Promise.resolve();
    if (this.loading) return this.loading;
    const request = this.fetchEverything().finally(() => {
      if (this.loading === request) this.loading = null;
    });
    this.loading = request;
    return request;
  }

  private async fetchEverything(): Promise<void> {
    const db = supabase!;
    const generation = this.generation;
    try {
      const canAnalyse = this.auth.canAnalyse();
      const [settingsRow, customerRows, openingRows, billRows, paymentRows, registerRows] =
        await Promise.all([
          db.from('shop_settings').select('data').eq('id', 1).maybeSingle(),
          this.fetchAll<CustomerRow>('customers'),
          canAnalyse ? this.fetchAll<OpeningRow>('customer_openings', 'customer_id') : Promise.resolve([]),
          this.fetchAll<BillRow>('bills'),
          this.fetchAll<PaymentRow>('payments'),
          canAnalyse ? this.fetchAll<RegisterEntryRow>('register_entries') : Promise.resolve([]),
        ]);
      if (settingsRow.error) throw settingsRow.error;
      if (generation !== this.generation || this.auth.stage() !== 'ready') return;
      const openings = new Map(openingRows.map((o) => [o.customer_id, Number(o.amount) || 0]));
      const settings = withDefaults(settingsRow.data?.data as Partial<ShopSettings> | undefined);
      this.state.set({
        version: 1,
        demo: !!settings.sampleData,
        settings,
        customers: customerRows.map((row) => customerFromRow(row, openings.get(row.id) ?? 0)),
        bills: billRows.map(billFromRow),
        payments: paymentRows.map(paymentFromRow),
        registerEntries: registerRows.map(registerEntryFromRow),
      });
      this.lastSync = Date.now();
      this.loadError.set(null);
      this.loaded.set(true);
      this.subscribe();
    } catch (error) {
      if (generation === this.generation) this.loadError.set(friendlyError(error));
    }
  }

  private async fetchAll<T>(table: string, orderBy = 'id'): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase!
        .from(table)
        .select('*')
        .order(orderBy)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...((data ?? []) as T[]));
      if (!data || data.length < PAGE_SIZE) return rows;
    }
  }

  private unload(): void {
    this.generation++;
    this.loading = null;
    if (this.channel) void supabase?.removeChannel(this.channel);
    this.channel = null;
    this.loaded.set(false);
    this.state.set(emptyData());
  }

  /** Live updates: owners' phones reflect the counter within a second or two. */
  private subscribe(): void {
    if (!supabase || this.channel) return;
    const on = <T extends Record<string, unknown>>(
      table: string,
      handler: (payload: RealtimePostgresChangesPayload<T>) => void,
    ) => ({ table, handler });
    const listeners = [
      on<CustomerRow & Record<string, unknown>>('customers', (p) => {
        if (p.eventType === 'DELETE') return this.removeCustomerLocally(String(p.old['id']));
        const existing = this.customerById().get(p.new.id);
        this.patch((d) => ({
          ...d,
          customers: upsertById(d.customers, customerFromRow(p.new, existing?.openingBalance ?? 0)),
        }));
      }),
      on<OpeningRow & Record<string, unknown>>('customer_openings', (p) => {
        const id = String(p.eventType === 'DELETE' ? p.old['customer_id'] : p.new.customer_id);
        const amount = p.eventType === 'DELETE' ? 0 : Number(p.new.amount) || 0;
        this.patch((d) => ({
          ...d,
          customers: d.customers.map((c) => (c.id === id ? { ...c, openingBalance: amount } : c)),
        }));
      }),
      on<BillRow & Record<string, unknown>>('bills', (p) => {
        if (p.eventType === 'DELETE') return this.removeBillLocally(String(p.old['id']));
        this.patch((d) => ({ ...d, bills: upsertById(d.bills, billFromRow(p.new)) }));
      }),
      on<PaymentRow & Record<string, unknown>>('payments', (p) => {
        if (p.eventType === 'DELETE') {
          const id = String(p.old['id']);
          return this.patch((d) => ({ ...d, payments: d.payments.filter((x) => x.id !== id) }));
        }
        this.patch((d) => ({ ...d, payments: upsertById(d.payments, paymentFromRow(p.new)) }));
      }),
      on<RegisterEntryRow & Record<string, unknown>>('register_entries', (p) => {
        if (p.eventType === 'DELETE') {
          const id = String(p.old['id']);
          return this.patch((d) => ({
            ...d,
            registerEntries: d.registerEntries.filter((x) => x.id !== id),
          }));
        }
        this.patch((d) => ({
          ...d,
          registerEntries: upsertById(d.registerEntries, registerEntryFromRow(p.new)),
        }));
      }),
      on<{ data: Partial<ShopSettings> }>('shop_settings', (p) => {
        if (p.eventType === 'DELETE') return;
        const settings = withDefaults(p.new.data);
        this.patch((d) => ({ ...d, settings, demo: !!settings.sampleData }));
      }),
    ];

    let channel = supabase.channel('shop-book');
    for (const { table, handler } of listeners) {
      channel = channel.on(
        'postgres_changes' as never,
        { event: '*', schema: 'public', table },
        handler as never,
      );
    }
    this.channel = channel.subscribe();
  }

  private patch(update: (data: ShopData) => ShopData): void {
    this.state.update(update);
  }

  private removeCustomerLocally(id: string): void {
    this.patch((d) => ({
      ...d,
      customers: d.customers.filter((c) => c.id !== id),
      registerEntries: d.registerEntries.filter((e) => e.customerId !== id),
    }));
  }

  private removeBillLocally(id: string): void {
    this.patch((d) => ({
      ...d,
      bills: d.bills.filter((b) => b.id !== id),
      payments: d.payments.filter((p) => p.billId !== id),
    }));
  }

  private userId(): string {
    return this.auth.profile()?.userId ?? '';
  }

  private fail(error: unknown): never {
    throw new Error(friendlyError(error));
  }

  // ---- Customers ---------------------------------------------------------------------------

  async addCustomer(input: CustomerInput): Promise<Customer> {
    this.requirePermission('billing');
    const customer: Customer = {
      ...input,
      openingBalance: this.auth.isAdmin() ? input.openingBalance : 0,
      id: uid('c'),
      createdAt: todayISO(),
    };
    if (supabase) {
      const { error } = await supabase.from('customers').insert(customerToRow(customer, this.userId()));
      if (error) this.fail(error);
      if (customer.openingBalance) {
        const { error: openingError } = await supabase
          .from('customer_openings')
          .upsert({ customer_id: customer.id, amount: customer.openingBalance });
        if (openingError) this.fail(openingError);
      }
    }
    this.patch((d) => ({ ...d, customers: upsertById(d.customers, customer) }));
    return customer;
  }

  async updateCustomer(id: string, input: CustomerInput): Promise<void> {
    this.requirePermission('billing');
    const current = this.customerById().get(id);
    if (!current) return;
    const next: Customer = {
      ...current,
      ...input,
      openingBalance: this.auth.isAdmin() ? input.openingBalance : current.openingBalance,
    };
    if (supabase) {
      const { id: _id, created_on: _on, created_by: _by, ...fields } = customerToRow(next, this.userId());
      const { error } = await supabase.from('customers').update(fields).eq('id', id);
      if (error) this.fail(error);
      if (this.auth.isAdmin() && next.openingBalance !== current.openingBalance) {
        const { error: openingError } = next.openingBalance
          ? await supabase.from('customer_openings').upsert({ customer_id: id, amount: next.openingBalance })
          : await supabase.from('customer_openings').delete().eq('customer_id', id);
        if (openingError) this.fail(openingError);
      }
    }
    this.patch((d) => ({ ...d, customers: upsertById(d.customers, next) }));
  }

  canDeleteCustomer(id: string): boolean {
    return (
      !this.bills().some((b) => b.customerId === id) &&
      !this.payments().some((p) => p.customerId === id) &&
      !this.registerEntries().some((e) => e.customerId === id)
    );
  }

  async deleteCustomer(id: string): Promise<boolean> {
    this.requirePermission('admin');
    if (!this.canDeleteCustomer(id)) return false;
    if (supabase) {
      const { error } = await supabase.from('customers').delete().eq('id', id);
      if (error) this.fail(error);
    }
    this.removeCustomerLocally(id);
    return true;
  }

  // ---- Bills & payments --------------------------------------------------------------------

  async createBill(input: BillInput, paymentsAtBilling: PaymentInput[]): Promise<Bill> {
    this.requirePermission('billing');
    const drafts = paymentsAtBilling.filter((p) => p.amount > 0);
    if (supabase) {
      const { data, error } = await supabase.rpc('create_bill', {
        p_bill: { ...input, id: uid('b') },
        p_payments: drafts.map((p) => ({ ...p, id: uid('p') })),
      });
      if (error) this.fail(error);
      const result = data as { bill: BillRow; payments: PaymentRow[] };
      const bill = billFromRow(result.bill);
      const payments = result.payments.map(paymentFromRow);
      this.patch((d) => ({
        ...d,
        bills: upsertById(d.bills, bill),
        payments: payments.reduce((list, p) => upsertById(list, p), d.payments),
      }));
      return bill;
    }

    const bill: Bill = {
      ...input,
      id: uid('b'),
      billNo: this.nextNumber(this.settings().billPrefix, input.date, this.state().bills.map((b) => b.billNo)),
      createdAt: nowStamp(),
      createdBy: this.userId(),
    };
    const receiptNos = this.state().payments.map((p) => p.receiptNo);
    const payments: Payment[] = [];
    for (const draft of drafts) {
      const receiptNo = this.nextNumber(this.settings().receiptPrefix, draft.date, receiptNos);
      receiptNos.push(receiptNo);
      payments.push({
        ...draft,
        id: uid('p'),
        receiptNo,
        customerId: bill.customerId,
        billId: bill.id,
        createdAt: nowStamp(),
        createdBy: this.userId(),
      });
    }
    this.patch((d) => ({ ...d, bills: [...d.bills, bill], payments: [...d.payments, ...payments] }));
    return bill;
  }

  /** Removes a bill together with every payment recorded against it. */
  async deleteBill(id: string): Promise<void> {
    this.requirePermission('admin');
    if (supabase) {
      const { error } = await supabase.from('bills').delete().eq('id', id);
      if (error) this.fail(error);
    }
    this.removeBillLocally(id);
  }

  async addPayment(customerId: string, input: PaymentInput): Promise<Payment> {
    this.requirePermission('billing');
    if (supabase) {
      const { data, error } = await supabase.rpc('add_payment', {
        p_payment: { ...input, id: uid('p'), customerId },
      });
      if (error) this.fail(error);
      const payment = paymentFromRow(data as PaymentRow);
      this.patch((d) => ({ ...d, payments: upsertById(d.payments, payment) }));
      return payment;
    }
    const payment: Payment = {
      ...input,
      id: uid('p'),
      customerId,
      receiptNo: this.nextNumber(
        this.settings().receiptPrefix,
        input.date,
        this.state().payments.map((p) => p.receiptNo),
      ),
      createdAt: nowStamp(),
      createdBy: this.userId(),
    };
    this.patch((d) => ({ ...d, payments: [...d.payments, payment] }));
    return payment;
  }

  async deletePayment(id: string): Promise<void> {
    this.requirePermission('admin');
    if (supabase) {
      const { error } = await supabase.from('payments').delete().eq('id', id);
      if (error) this.fail(error);
    }
    this.patch((d) => ({ ...d, payments: d.payments.filter((p) => p.id !== id) }));
  }

  paymentsForBill(billId: string): Payment[] {
    return this.payments()
      .filter((p) => p.billId === billId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  }

  /** The next bill number as far as this screen knows; the server assigns the final one. */
  previewBillNo(date: string): string {
    return this.nextNumber(this.settings().billPrefix, date, this.state().bills.map((b) => b.billNo));
  }

  // ---- Register ----------------------------------------------------------------------------

  async addRegisterEntry(input: RegisterEntryInput): Promise<RegisterEntry> {
    this.requirePermission('admin');
    const entry: RegisterEntry = { ...normaliseEntry(input), id: uid('r'), createdAt: nowStamp() };
    if (supabase) {
      const { error } = await supabase
        .from('register_entries')
        .insert(registerEntryToRow(entry, this.userId()));
      if (error) this.fail(error);
    }
    this.patch((d) => ({ ...d, registerEntries: upsertById(d.registerEntries, entry) }));
    return entry;
  }

  async updateRegisterEntry(id: string, input: RegisterEntryInput): Promise<void> {
    this.requirePermission('admin');
    const current = this.registerEntries().find((e) => e.id === id);
    if (!current) return;
    const next: RegisterEntry = { ...current, ...normaliseEntry(input) };
    if (supabase) {
      const { id: _id, created_at: _at, created_by: _by, ...fields } = registerEntryToRow(
        next,
        this.userId(),
      );
      const { error } = await supabase.from('register_entries').update(fields).eq('id', id);
      if (error) this.fail(error);
    }
    this.patch((d) => ({ ...d, registerEntries: upsertById(d.registerEntries, next) }));
  }

  async deleteRegisterEntry(id: string): Promise<void> {
    this.requirePermission('admin');
    if (supabase) {
      const { error } = await supabase.from('register_entries').delete().eq('id', id);
      if (error) this.fail(error);
    }
    this.patch((d) => ({ ...d, registerEntries: d.registerEntries.filter((e) => e.id !== id) }));
  }

  /** The slip number after the highest one already in the book, if they run in a series. */
  nextSlipNo(): string {
    const numbers = this.registerEntries()
      .map((e) => e.slipNo.match(/(\d+)\s*$/)?.[1])
      .filter((n): n is string => !!n);
    if (!numbers.length) return '';
    const highest = numbers.reduce((max, n) => Math.max(max, Number(n)), 0);
    const width = numbers.reduce((w, n) => Math.max(w, n.length), 1);
    return String(highest + 1).padStart(width, '0');
  }

  // ---- Settings & data ---------------------------------------------------------------------

  async updateSettings(patch: Partial<ShopSettings>): Promise<void> {
    this.requirePermission('admin');
    const next = { ...this.settings(), ...patch };
    if (supabase) {
      const { error } = await supabase.from('shop_settings').upsert({ id: 1, data: next });
      if (error) this.fail(error);
    }
    this.patch((d) => ({ ...d, settings: next }));
  }

  updateRates(rates: RateCard): Promise<void> {
    return this.updateSettings({ rates: { ...rates }, ratesUpdatedAt: nowStamp() });
  }

  exportJSON(): string {
    this.requirePermission('admin');
    const { settings, ...rest } = this.state();
    return JSON.stringify({ ...rest, demo: this.isDemo(), settings: { ...settings, sampleData: undefined } }, null, 2);
  }

  /** Replaces every record with the contents of a backup file. */
  async importJSON(json: string): Promise<void> {
    this.requirePermission('admin');
    const parsed = JSON.parse(json);
    if (!isShopData(parsed)) {
      throw new Error('This file is not an MSR Jewellers backup.');
    }
    await this.replaceAll({ ...withSettingsDefaults(parsed), demo: parsed.demo ?? false });
  }

  /** Fresh sample history priced off the shop's current 24K and silver rates; settings are kept. */
  async resetToDemo(): Promise<void> {
    this.requirePermission('admin');
    const settings = this.settings();
    const demo = generateDemoData(todayISO(), {
      gold24: settings.rates['24K'],
      silver999: settings.rates['999'],
    });
    await this.replaceAll({ ...demo, settings });
  }

  async clearAll(): Promise<void> {
    this.requirePermission('admin');
    await this.replaceAll({ ...emptyData(), demo: false, settings: this.settings() });
  }

  private async replaceAll(data: ShopData): Promise<void> {
    const settings: ShopSettings = { ...data.settings, sampleData: !!data.demo };
    if (supabase) {
      const db = supabase;
      const user = this.userId();
      const insert = async (table: string, rows: object[]) => {
        for (const batch of chunks(rows, 250)) {
          const { error } = await db.from(table).insert(batch);
          if (error) this.fail(error);
        }
      };
      const erased = await db.rpc('erase_all_records');
      if (erased.error) this.fail(erased.error);
      await insert('customers', data.customers.map((c) => customerToRow(c, user)));
      await insert(
        'customer_openings',
        data.customers.filter((c) => c.openingBalance).map((c) => ({ customer_id: c.id, amount: c.openingBalance })),
      );
      await insert('bills', data.bills.map((b) => billToRow(b, user)));
      await insert('payments', data.payments.map((p) => paymentToRow(p, user)));
      await insert('register_entries', data.registerEntries.map((e) => registerEntryToRow(e, user)));
      const { error } = await db.from('shop_settings').upsert({ id: 1, data: settings });
      if (error) this.fail(error);
    }
    this.state.set({ ...data, settings, demo: !!data.demo });
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

/** Keeps grams to three decimals, rupees whole, and never lets a figure go negative. */
function normaliseEntry(input: RegisterEntryInput): RegisterEntryInput {
  const grams = (value: number) => Math.max(round3(value), 0);
  const rupees = (value: number) => Math.max(Math.round(Number(value) || 0), 0);
  return {
    ...input,
    slipNo: input.slipNo.trim(),
    careOfName: input.careOfName?.trim() || undefined,
    careOfPhone: input.careOfPhone?.trim() || undefined,
    goldCredit: grams(input.goldCredit),
    goldDebit: grams(input.goldDebit),
    cashCredit: rupees(input.cashCredit),
    cashDebit: rupees(input.cashDebit),
    notes: input.notes?.trim() || undefined,
  };
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
