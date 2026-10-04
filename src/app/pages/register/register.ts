import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ShopStore } from '../../core/store';
import { UiService } from '../../core/ui.service';
import { RegisterEntry, RegisterRow } from '../../core/models';
import { addDays, addMonths, financialYearStart, startOfMonth, todayISO } from '../../core/dates';
import { downloadCsv } from '../../core/csv';
import { formatGrams, formatINR, phoneDigits } from '../../core/format';
import { CustomerPicker } from '../../shared/customer-picker';
import { Icon } from '../../shared/icon';
import { BalancePipe, DayPipe, GramsPipe, InrPipe, PhonePipe } from '../../shared/pipes';

type View = 'entries' | 'balances';
type Preset = 'month' | 'last-month' | '3m' | '6m' | 'fy' | 'all' | 'custom';

/** A register line with the customer details the paper book repeats on every row. */
interface Line extends RegisterRow {
  customerName: string;
  phone: string;
  address: string;
}

interface BalanceRow {
  customerId: string;
  name: string;
  phone: string;
  address: string;
  careOf: string;
  entries: number;
  goldCredit: number;
  goldDebit: number;
  goldBalance: number;
  cashCredit: number;
  cashDebit: number;
  cashBalance: number;
  lastDate?: string;
}

const PAGE_SIZE = 100;

/**
 * The counter register, laid out like the shop's whiteboard book: one line per slip with the
 * gold (grams) and cash given and received, and the customer's running balance of each.
 */
@Component({
  selector: 'app-register',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormsModule,
    CustomerPicker,
    Icon,
    InrPipe,
    BalancePipe,
    GramsPipe,
    DayPipe,
    PhonePipe,
  ],
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class RegisterPage {
  protected readonly store = inject(ShopStore);
  private readonly ui = inject(UiService);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly view = signal<View>('entries');
  protected readonly query = signal('');
  protected readonly preset = signal<Preset>('6m');
  protected readonly from = signal(addMonths(startOfMonth(todayISO()), -5));
  protected readonly to = signal(todayISO());
  protected readonly limit = signal(PAGE_SIZE);
  protected readonly openOnly = signal(false);

  // ---- The book ----------------------------------------------------------------------------

  private readonly lines = computed<Line[]>(() => {
    const customers = this.store.customerById();
    return this.store.registerRows().map((row) => {
      const customer = customers.get(row.customerId);
      return {
        ...row,
        customerName: customer?.name ?? 'Unknown',
        phone: customer?.phone ?? '',
        address: [customer?.address, customer?.city].filter(Boolean).join(', '),
      };
    });
  });

  /** Newest line first, like the register opened at the last written page. */
  protected readonly filtered = computed(() => {
    const term = this.query().trim().toLowerCase();
    const digits = phoneDigits(term);
    const from = this.from();
    const to = this.to();
    return this.lines()
      .filter((line) => {
        if (from && line.date < from) return false;
        if (to && line.date > to) return false;
        if (!term) return true;
        return (
          line.customerName.toLowerCase().includes(term) ||
          line.slipNo.toLowerCase().includes(term) ||
          line.address.toLowerCase().includes(term) ||
          (line.careOfName?.toLowerCase().includes(term) ?? false) ||
          (line.notes?.toLowerCase().includes(term) ?? false) ||
          (digits.length >= 3 &&
            (phoneDigits(line.phone).includes(digits) ||
              phoneDigits(line.careOfPhone ?? '').includes(digits)))
        );
      })
      .reverse();
  });

  protected readonly visible = computed(() => this.filtered().slice(0, this.limit()));
  protected readonly hidden = computed(() => Math.max(this.filtered().length - this.limit(), 0));

  /** Column totals for the lines on screen, as the board is tallied at the foot of a page. */
  protected readonly totals = computed(() => {
    const rows = this.filtered();
    let goldCredit = 0;
    let goldDebit = 0;
    let cashCredit = 0;
    let cashDebit = 0;
    const customers = new Set<string>();
    for (const row of rows) {
      goldCredit += row.goldCredit;
      goldDebit += row.goldDebit;
      cashCredit += row.cashCredit;
      cashDebit += row.cashDebit;
      customers.add(row.customerId);
    }
    return {
      lines: rows.length,
      customers: customers.size,
      goldCredit: round3(goldCredit),
      goldDebit: round3(goldDebit),
      cashCredit: Math.round(cashCredit),
      cashDebit: Math.round(cashDebit),
      lastDate: rows[0]?.date,
    };
  });

  /** One row per customer, with what the register says they owe as of today. */
  protected readonly balances = computed<BalanceRow[]>(() => {
    const customers = this.store.customerById();
    const careOf = new Map<string, string>();
    for (const row of this.store.registerRows()) {
      if (row.careOfName) careOf.set(row.customerId, row.careOfName);
    }
    const term = this.query().trim().toLowerCase();
    const digits = phoneDigits(term);
    const rows: BalanceRow[] = [];
    for (const [customerId, summary] of this.store.registerSummaries()) {
      const customer = customers.get(customerId);
      const row: BalanceRow = {
        customerId,
        name: customer?.name ?? 'Unknown',
        phone: customer?.phone ?? '',
        address: [customer?.address, customer?.city].filter(Boolean).join(', '),
        careOf: careOf.get(customerId) ?? '',
        ...summary,
      };
      if (this.openOnly() && !row.goldBalance && !row.cashBalance) continue;
      if (
        term &&
        !row.name.toLowerCase().includes(term) &&
        !row.address.toLowerCase().includes(term) &&
        !row.careOf.toLowerCase().includes(term) &&
        !(digits.length >= 3 && phoneDigits(row.phone).includes(digits))
      ) {
        continue;
      }
      rows.push(row);
    }
    return rows.sort(
      (a, b) =>
        Math.abs(b.goldBalance) - Math.abs(a.goldBalance) ||
        Math.abs(b.cashBalance) - Math.abs(a.cashBalance) ||
        a.name.localeCompare(b.name),
    );
  });

  /** The register's overall position: what is out with customers, net of what is held. */
  protected readonly position = computed(() => {
    let gold = 0;
    let cash = 0;
    let openGold = 0;
    let openCash = 0;
    for (const row of this.balances()) {
      gold = round3(gold + row.goldBalance);
      cash += row.cashBalance;
      if (row.goldBalance) openGold++;
      if (row.cashBalance) openCash++;
    }
    return { gold, cash: Math.round(cash), openGold, openCash, accounts: this.balances().length };
  });

  // ---- Filters -----------------------------------------------------------------------------

  protected setPreset(preset: Preset): void {
    this.preset.set(preset);
    this.limit.set(PAGE_SIZE);
    const today = todayISO();
    const ranges: Record<Exclude<Preset, 'custom'>, [string, string]> = {
      month: [startOfMonth(today), today],
      'last-month': [addMonths(startOfMonth(today), -1), addDays(startOfMonth(today), -1)],
      '3m': [addMonths(startOfMonth(today), -2), today],
      '6m': [addMonths(startOfMonth(today), -5), today],
      fy: [financialYearStart(today), today],
      all: ['', ''],
    };
    if (preset !== 'custom') {
      const [from, to] = ranges[preset];
      this.from.set(from);
      this.to.set(to);
    }
  }

  protected setDate(which: 'from' | 'to', value: string): void {
    (which === 'from' ? this.from : this.to).set(value);
    this.preset.set('custom');
    this.limit.set(PAGE_SIZE);
  }

  protected search(value: string): void {
    this.query.set(value);
    this.limit.set(PAGE_SIZE);
  }

  // ---- Reading the figures -----------------------------------------------------------------

  /** Gold balances read like the khata: "4.200 g Dr" when the customer owes the gold. */
  protected goldBalance(grams: number): string {
    if (!grams) return formatGrams(0);
    return `${formatGrams(Math.abs(grams))} ${grams > 0 ? 'Dr' : 'Cr'}`;
  }

  protected goldMeaning(grams: number): string {
    if (!grams) return 'Nothing outstanding either way';
    return grams > 0 ? 'Gold out with customers' : 'Customers’ gold held at the shop';
  }

  protected cashMeaning(rupees: number): string {
    if (!rupees) return 'Nothing outstanding either way';
    return rupees > 0 ? 'Cash due from customers' : 'Advances held for customers';
  }

  // ---- Entry form --------------------------------------------------------------------------

  protected readonly editingId = signal<string | null>(null);
  protected readonly date = signal(todayISO());
  protected readonly slipNo = signal('');
  protected readonly customerId = signal('');
  protected readonly careOfName = signal('');
  protected readonly careOfPhone = signal('');
  protected readonly goldCredit = signal<number | null>(null);
  protected readonly goldDebit = signal<number | null>(null);
  protected readonly cashCredit = signal<number | null>(null);
  protected readonly cashDebit = signal<number | null>(null);
  protected readonly notes = signal('');
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);

  protected readonly errors = computed(() => {
    const list: string[] = [];
    if (!this.customerId()) list.push('Choose the customer this slip belongs to.');
    if (!this.date()) list.push('Enter the date written on the slip.');
    else if (this.date() > todayISO()) list.push('The date cannot be in the future.');
    const figures = [this.goldCredit(), this.goldDebit(), this.cashCredit(), this.cashDebit()];
    if (!figures.some((value) => Number(value) > 0)) {
      list.push('Fill at least one of the gold or cash columns.');
    }
    if (figures.some((value) => Number(value) < 0)) {
      list.push('Figures cannot be negative — use the credit column for what comes in.');
    }
    return list;
  });

  /** Where this customer's register balance lands once the line is saved. */
  protected readonly preview = computed(() => {
    const customerId = this.customerId();
    if (!customerId) return null;
    const summary = this.store.registerSummaries().get(customerId);
    const editing = this.editingId()
      ? this.store.registerEntries().find((e) => e.id === this.editingId())
      : undefined;
    const goldWas =
      (summary?.goldBalance ?? 0) - (editing ? editing.goldDebit - editing.goldCredit : 0);
    const cashWas =
      (summary?.cashBalance ?? 0) - (editing ? editing.cashDebit - editing.cashCredit : 0);
    const gold = round3(goldWas + num(this.goldDebit()) - num(this.goldCredit()));
    const cash = Math.round(cashWas + num(this.cashDebit()) - num(this.cashCredit()));
    const name = this.store.customerById().get(customerId)?.name ?? 'This customer';
    return { name, gold, cash };
  });

  protected openEntry(entry?: RegisterEntry): void {
    this.editingId.set(entry?.id ?? null);
    this.date.set(entry?.date ?? todayISO());
    this.slipNo.set(entry?.slipNo ?? this.store.nextSlipNo());
    this.customerId.set(entry?.customerId ?? '');
    this.careOfName.set(entry?.careOfName ?? '');
    this.careOfPhone.set(entry?.careOfPhone ?? '');
    this.goldCredit.set(entry?.goldCredit || null);
    this.goldDebit.set(entry?.goldDebit || null);
    this.cashCredit.set(entry?.cashCredit || null);
    this.cashDebit.set(entry?.cashDebit || null);
    this.notes.set(entry?.notes ?? '');
    this.submitted.set(false);
    const element = this.dialog()?.nativeElement;
    if (element && !element.open) element.showModal();
    setTimeout(() =>
      element?.querySelector<HTMLElement>(entry ? '#entry-slip' : '#entry-customer')?.focus(),
    );
  }

  protected closeEntry(): void {
    this.dialog()?.nativeElement.close();
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog()?.nativeElement) this.closeEntry();
  }

  protected createCustomer(query: string): void {
    this.ui.openCustomer({
      initialQuery: query,
      onSaved: (id) => {
        this.customerId.set(id);
        this.onCustomerChosen(id);
      },
    });
  }

  /** Fills "c/o" from the last slip this customer appeared on. */
  protected onCustomerChosen(customerId: string): void {
    if (!customerId || this.careOfName() || this.careOfPhone()) return;
    const previous = [...this.store.registerRows()]
      .reverse()
      .find((row) => row.customerId === customerId && (row.careOfName || row.careOfPhone));
    if (!previous) return;
    this.careOfName.set(previous.careOfName ?? '');
    this.careOfPhone.set(previous.careOfPhone ?? '');
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    if (this.errors().length || this.busy()) return;
    const input = {
      date: this.date(),
      slipNo: this.slipNo().trim(),
      customerId: this.customerId(),
      careOfName: this.careOfName().trim() || undefined,
      careOfPhone: this.careOfPhone().trim() || undefined,
      goldCredit: num(this.goldCredit()),
      goldDebit: num(this.goldDebit()),
      cashCredit: num(this.cashCredit()),
      cashDebit: num(this.cashDebit()),
      notes: this.notes().trim() || undefined,
    };
    const editingId = this.editingId();
    this.busy.set(true);
    try {
      if (editingId) {
        await this.store.updateRegisterEntry(editingId, input);
        this.ui.toast('Register entry updated');
      } else {
        await this.store.addRegisterEntry(input);
        this.ui.toast('Written into the register');
      }
      this.closeEntry();
    } catch (error) {
      this.ui.toast((error as Error).message, 'error');
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const id = this.editingId();
    const entry = id ? this.store.registerEntries().find((e) => e.id === id) : undefined;
    if (!entry) return;
    const what = [
      entry.goldCredit ? `${formatGrams(entry.goldCredit)} in` : '',
      entry.goldDebit ? `${formatGrams(entry.goldDebit)} out` : '',
      entry.cashCredit ? `${formatINR(entry.cashCredit)} in` : '',
      entry.cashDebit ? `${formatINR(entry.cashDebit)} out` : '',
    ]
      .filter(Boolean)
      .join(', ');
    if (!confirm(`Delete this register entry (${what})? The balance will change.`)) return;
    try {
      await this.store.deleteRegisterEntry(entry.id);
      this.ui.toast('Register entry deleted', 'info');
      this.closeEntry();
    } catch (error) {
      this.ui.toast((error as Error).message, 'error');
    }
  }

  // ---- Taking it off screen ----------------------------------------------------------------

  protected print(): void {
    setTimeout(() => window.print(), 50);
  }

  protected exportCsv(): void {
    const stamp = `${this.from() || 'start'}-to-${this.to() || todayISO()}`;
    if (this.view() === 'balances') {
      downloadCsv(
        `msr-register-balances-${todayISO()}.csv`,
        [
          'Customer Name', 'Ph. No.', 'Address', 'c/o Name', 'Entries', 'Last entry',
          'Gold credit (g)', 'Gold debit (g)', 'Gold balance (g, Dr+ / Cr-)',
          'Cash credit', 'Cash debit', 'Cash balance (Dr+ / Cr-)',
        ],
        this.balances().map((row) => [
          row.name, row.phone, row.address, row.careOf, row.entries, row.lastDate ?? '',
          row.goldCredit, row.goldDebit, row.goldBalance,
          row.cashCredit, row.cashDebit, row.cashBalance,
        ]),
      );
      return;
    }
    const rows = [...this.filtered()].reverse();
    downloadCsv(
      `msr-register-${stamp}.csv`,
      [
        'S.No', 'Customer Name', 'Ph. No.', 'Address', 'c/o Name', 'c/o Ph. No.',
        'Slip No', 'Date', 'Gold credit (g)', 'Gold debit (g)', 'Cash credit', 'Cash debit',
        'Gold balance (g)', 'Cash balance', 'Notes',
      ],
      rows.map((row) => [
        row.serial, row.customerName, row.phone, row.address,
        row.careOfName ?? '', row.careOfPhone ?? '', row.slipNo, row.date,
        row.goldCredit || '', row.goldDebit || '', row.cashCredit || '', row.cashDebit || '',
        row.goldBalance, row.cashBalance, row.notes ?? '',
      ]),
    );
  }
}

function num(value: number | null): number {
  return Number(value) || 0;
}

function round3(value: number): number {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}
