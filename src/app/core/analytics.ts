import { Bill, BillItem, BillTotals, ItemCategory, Metal, Purity } from './models';
import { hsnFor, itemAmount, itemMaking, itemMetalValue, metalOf } from './calc';
import {
  addDays,
  addMonths,
  financialYearStart,
  monthKey,
  startOfMonth,
} from './dates';
import { formatDate, formatMonth } from './format';

export type PeriodKey = 'mtd' | 'last-month' | 'quarter' | 'fy' | 'last-fy' | '12m' | 'all';

export interface ReportRange {
  key: PeriodKey;
  from: string;
  to: string;
  label: string;
}

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'mtd', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'fy', label: 'This FY' },
  { key: 'last-fy', label: 'Last FY' },
  { key: '12m', label: 'Last 12 months' },
  { key: 'all', label: 'All time' },
];

function fyLabel(start: string): string {
  const year = Number(start.slice(0, 4));
  return `FY ${year}–${String(year + 1).slice(2)}`;
}

/** Calendar windows the reports understand; quarters follow the Indian financial year. */
export function rangeFor(key: PeriodKey, today: string, earliest: string): ReportRange {
  switch (key) {
    case 'mtd':
      return { key, from: startOfMonth(today), to: today, label: `${formatMonth(monthKey(today), true)} to date` };
    case 'last-month': {
      const from = addMonths(startOfMonth(today), -1);
      return { key, from, to: addDays(startOfMonth(today), -1), label: formatMonth(monthKey(from), true) };
    }
    case 'quarter': {
      const fyStart = financialYearStart(today);
      const monthsIn = (Number(today.slice(0, 4)) - Number(fyStart.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - 4;
      const from = addMonths(fyStart, Math.floor(monthsIn / 3) * 3);
      return { key, from, to: today, label: `Q${Math.floor(monthsIn / 3) + 1} ${fyLabel(fyStart)} to date` };
    }
    case 'fy': {
      const from = financialYearStart(today);
      return { key, from, to: today, label: `${fyLabel(from)} to date` };
    }
    case 'last-fy': {
      const from = addMonths(financialYearStart(today), -12);
      return { key, from, to: addDays(financialYearStart(today), -1), label: fyLabel(from) };
    }
    case '12m': {
      const from = addDays(addMonths(today, -12), 1);
      return { key, from, to: today, label: `${formatDate(from)} – today` };
    }
    case 'all':
      return { key, from: earliest, to: today, label: 'All time' };
  }
}

/** Month keys covering the range, oldest first, capped to the most recent `cap`. */
export function monthsBetween(from: string, to: string, cap = 24): string[] {
  const months: string[] = [];
  for (let m = startOfMonth(from); m <= to && months.length < 240; m = addMonths(m, 1)) {
    months.push(monthKey(m));
  }
  return months.slice(-cap);
}

export const inRange = (date: string, range: Pick<ReportRange, 'from' | 'to'>) =>
  date >= range.from && date <= range.to;

/** One sold item with its share of the bill's discount and tax. */
export interface SaleLine {
  bill: Bill;
  item: BillItem;
  metal: Metal;
  hsn: string;
  grams: number;
  pieces: number;
  /** Item value before discount and GST. */
  amount: number;
  /** Item value after its share of the bill discount: the GST base. */
  taxable: number;
  making: number;
  metalValue: number;
}

export function saleLines(bills: Bill[], totals: Map<string, BillTotals>, range: Pick<ReportRange, 'from' | 'to'>): SaleLine[] {
  const lines: SaleLine[] = [];
  for (const bill of bills) {
    if (!inRange(bill.date, range)) continue;
    const t = totals.get(bill.id);
    const ratio = t && t.subtotal > 0 ? t.taxable / t.subtotal : 1;
    for (const item of bill.items) {
      const amount = itemAmount(item);
      lines.push({
        bill,
        item,
        metal: metalOf(item.purity),
        hsn: hsnFor(item),
        grams: Number(item.netWeight) || 0,
        pieces: Number(item.pieces) || 1,
        amount,
        taxable: amount * ratio,
        making: itemMaking(item),
        metalValue: itemMetalValue(item),
      });
    }
  }
  return lines;
}

export type RankBy = 'revenue' | 'pieces' | 'grams';

export interface ItemSummary {
  key: string;
  description: string;
  category: ItemCategory;
  purity: Purity;
  metal: Metal;
  pieces: number;
  bills: number;
  grams: number;
  revenue: number;
  making: number;
  metalValue: number;
}

/** Best sellers: the same design in the same purity counts as one product. */
export function summariseItems(lines: SaleLine[]): ItemSummary[] {
  const map = new Map<string, ItemSummary & { billIds: Set<string> }>();
  for (const line of lines) {
    const name = line.item.description.trim();
    const key = `${name.toLowerCase()}|${line.item.purity}`;
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        description: name,
        category: line.item.category,
        purity: line.item.purity,
        metal: line.metal,
        pieces: 0,
        bills: 0,
        grams: 0,
        revenue: 0,
        making: 0,
        metalValue: 0,
        billIds: new Set(),
      };
      map.set(key, row);
    }
    row.pieces += line.pieces;
    row.grams += line.grams;
    row.revenue += line.taxable;
    row.making += line.making;
    row.metalValue += line.metalValue;
    row.billIds.add(line.bill.id);
  }
  return [...map.values()].map(({ billIds, ...row }) => ({ ...row, bills: billIds.size }));
}

export function rankItems(items: ItemSummary[], by: RankBy): ItemSummary[] {
  const value = (i: ItemSummary) => (by === 'pieces' ? i.pieces : by === 'grams' ? i.grams : i.revenue);
  return [...items].sort((a, b) => value(b) - value(a) || b.revenue - a.revenue);
}

export interface GroupTotal {
  label: string;
  revenue: number;
  grams: number;
  pieces: number;
  making: number;
  count: number;
}

export function groupLines(lines: SaleLine[], key: (line: SaleLine) => string): GroupTotal[] {
  const map = new Map<string, GroupTotal>();
  for (const line of lines) {
    const label = key(line);
    const row = map.get(label) ?? { label, revenue: 0, grams: 0, pieces: 0, making: 0, count: 0 };
    row.revenue += line.taxable;
    row.grams += line.grams;
    row.pieces += line.pieces;
    row.making += line.making;
    row.count++;
    map.set(label, row);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

export const purityGroup = (line: SaleLine) => `${line.metal} ${line.item.purity}`;

/** Making charge as a share of metal value: the jeweller's margin on labour. */
export function makingRate(making: number, metalValue: number): number {
  return metalValue > 0 ? (making / metalValue) * 100 : 0;
}

export const formatPercent = (value: number, digits = 0) => `${(Number(value) || 0).toFixed(digits)}%`;
export const formatCount = (value: number) => new Intl.NumberFormat('en-IN').format(Math.round(value));
export const formatGramsShort = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} kg` : `${Math.round(value)} g`;

/** Short axis labels ("Apr", or "Apr 26" when the span crosses a year) and full labels. */
export function monthLabels(months: string[]): { short: string[]; full: string[] } {
  const multiYear = months.length > 12;
  return {
    short: months.map((m) => (multiYear ? `${formatMonth(m)} ${m.slice(2, 4)}` : formatMonth(m))),
    full: months.map((m) => formatMonth(m, true)),
  };
}
