import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShopStore } from '../../core/store';
import { ReportRange, inRange, monthsBetween, saleLines } from '../../core/analytics';
import { monthKey } from '../../core/dates';
import { formatMonth } from '../../core/format';
import { downloadCsv } from '../../core/csv';
import { Icon } from '../../shared/icon';
import { DayPipe, GramsPipe, InrPipe } from '../../shared/pipes';

const HSN_NAMES: Record<string, string> = {
  '7113': 'Articles of jewellery of precious metal',
  '7114': "Goldsmiths' / silversmiths' wares",
  '7118': 'Coins',
};

const round2 = (v: number) => Math.round(v * 100) / 100;

@Component({
  selector: 'app-gst-report',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, InrPipe, GramsPipe, DayPipe],
  templateUrl: './gst-report.html',
})
export class GstReport {
  private readonly store = inject(ShopStore);
  readonly range = input.required<ReportRange>();

  private readonly bills = computed(() =>
    this.store
      .bills()
      .filter((b) => inRange(b.date, this.range()))
      .sort((a, b) => a.date.localeCompare(b.date) || a.billNo.localeCompare(b.billNo)),
  );

  protected readonly months = computed(() => {
    const totals = this.store.billTotals();
    const months = monthsBetween(this.range().from, this.range().to, 240);
    const rows = months.map((m) => ({ key: m, month: formatMonth(m, true), invoices: 0, taxable: 0, cgst: 0, sgst: 0, value: 0 }));
    const index = new Map(months.map((m, i) => [m, i]));
    for (const bill of this.bills()) {
      const row = rows[index.get(monthKey(bill.date)) ?? -1];
      const t = totals.get(bill.id);
      if (!row || !t) continue;
      row.invoices++;
      row.taxable += t.taxable;
      row.cgst += t.cgst;
      row.sgst += t.sgst;
      row.value += t.total;
    }
    const total = rows.reduce(
      (acc, r) => ({
        invoices: acc.invoices + r.invoices,
        taxable: acc.taxable + r.taxable,
        cgst: acc.cgst + r.cgst,
        sgst: acc.sgst + r.sgst,
        value: acc.value + r.value,
      }),
      { invoices: 0, taxable: 0, cgst: 0, sgst: 0, value: 0 },
    );
    return { rows: rows.filter((r) => r.invoices).reverse(), total };
  });

  /** HSN-wise summary for GSTR-1 (Table 12); bill discounts are spread across items pro rata. */
  protected readonly hsn = computed(() => {
    const map = new Map<string, { hsn: string; rate: number; grams: number; pieces: number; taxable: number }>();
    for (const line of saleLines(this.bills(), this.store.billTotals(), this.range())) {
      const rate = line.bill.gstPercent;
      const key = `${line.hsn}|${rate}`;
      const row = map.get(key) ?? { hsn: line.hsn, rate, grams: 0, pieces: 0, taxable: 0 };
      row.grams += line.grams;
      row.pieces += line.pieces;
      row.taxable += line.taxable;
      map.set(key, row);
    }
    return [...map.values()]
      .sort((a, b) => a.hsn.localeCompare(b.hsn))
      .map((r) => {
        const half = round2((r.taxable * r.rate) / 200);
        return { ...r, name: HSN_NAMES[r.hsn] ?? '', taxable: round2(r.taxable), cgst: half, sgst: half };
      });
  });

  /** Invoices to GST-registered buyers, reported invoice by invoice (GSTR-1 B2B). */
  protected readonly b2b = computed(() => {
    const customers = this.store.customerById();
    const totals = this.store.billTotals();
    return this.bills()
      .map((bill) => ({ bill, customer: customers.get(bill.customerId), totals: totals.get(bill.id)! }))
      .filter((r) => r.customer?.gstin);
  });

  private get fileStem(): string {
    return `${this.range().from}-to-${this.range().to}`;
  }

  protected exportMonths(): void {
    downloadCsv(
      `msr-gst-monthly-${this.fileStem}.csv`,
      ['Month', 'Invoices', 'Taxable value', 'CGST', 'SGST', 'Total tax', 'Invoice value'],
      this.months().rows.map((r) => [r.month, r.invoices, round2(r.taxable), round2(r.cgst), round2(r.sgst), round2(r.cgst + r.sgst), round2(r.value)]),
    );
  }

  protected exportHsn(): void {
    downloadCsv(
      `msr-gst-hsn-${this.fileStem}.csv`,
      ['HSN', 'Description', 'UQC', 'Total quantity', 'Pieces', 'Taxable value', 'Rate %', 'CGST', 'SGST'],
      this.hsn().map((r) => [r.hsn, r.name, 'GMS', r.grams.toFixed(3), r.pieces, r.taxable, r.rate, r.cgst, r.sgst]),
    );
  }

  protected exportInvoices(): void {
    const customers = this.store.customerById();
    const totals = this.store.billTotals();
    downloadCsv(
      `msr-gst-invoices-${this.fileStem}.csv`,
      ['Invoice no', 'Date', 'Customer', 'GSTIN', 'Taxable value', 'CGST', 'SGST', 'Round off', 'Invoice value'],
      this.bills().map((b) => {
        const t = totals.get(b.id)!;
        const c = customers.get(b.customerId);
        return [b.billNo, b.date, c?.name ?? '', c?.gstin ?? '', t.taxable, t.cgst, t.sgst, t.roundOff, t.total];
      }),
    );
  }
}
