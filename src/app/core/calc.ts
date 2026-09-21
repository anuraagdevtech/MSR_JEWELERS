import {
  Bill,
  BillItem,
  BillStatus,
  BillTotals,
  Customer,
  ItemCategory,
  Metal,
  Payment,
  Purity,
  RateCard,
} from './models';
import { daysBetween } from './dates';

export const GOLD_PURITIES: Purity[] = ['24K', '22K', '18K'];
export const SILVER_PURITIES: Purity[] = ['999', '925'];
export const ALL_PURITIES: Purity[] = [...GOLD_PURITIES, ...SILVER_PURITIES];

export const CATEGORIES: ItemCategory[] = [
  'Necklace',
  'Chain',
  'Ring',
  'Bangles',
  'Earrings',
  'Bracelet',
  'Pendant',
  'Mangalsutra',
  'Anklet',
  'Coin',
  'Silver article',
  'Other',
];

export function metalOf(purity: Purity): Metal {
  return purity === '999' || purity === '925' ? 'Silver' : 'Gold';
}

export function purityLabel(purity: Purity): string {
  return metalOf(purity) === 'Gold' ? `Gold ${purity}` : `Silver ${purity}`;
}

export function hsnFor(item: Pick<BillItem, 'category' | 'purity'>): string {
  if (item.category === 'Coin') return '7118';
  if (item.category === 'Silver article') return '7114';
  return '7113';
}

/** Standard derivation used across South Indian counters: 22K = 22/24, 18K = 18/24 of 24K. */
export function deriveRates(gold24: number, silver999: number): RateCard {
  const roundTo = (value: number, step: number) => Math.round(value / step) * step;
  return {
    '24K': roundTo(gold24, 1),
    '22K': roundTo((gold24 * 22) / 24, 5),
    '18K': roundTo((gold24 * 18) / 24, 5),
    '999': roundTo(silver999, 0.5),
    '925': roundTo(silver999 * 0.925, 0.5),
  };
}

const num = (value: unknown) => Number(value) || 0;
const money = (value: number) => Math.round(value * 100) / 100;

export function itemMetalValue(item: BillItem): number {
  return money(num(item.netWeight) * num(item.rate));
}

export function itemMaking(item: BillItem): number {
  const value =
    item.makingType === 'percent'
      ? (itemMetalValue(item) * num(item.makingValue)) / 100
      : num(item.netWeight) * num(item.makingValue);
  return money(value);
}

export function itemAmount(item: BillItem): number {
  return money(itemMetalValue(item) + itemMaking(item) + num(item.stoneCharges));
}

export function computeBillTotals(bill: Pick<Bill, 'items' | 'discount' | 'gstPercent'>): BillTotals {
  let metalValue = 0;
  let making = 0;
  let stones = 0;
  let netWeight = 0;
  for (const item of bill.items) {
    metalValue += itemMetalValue(item);
    making += itemMaking(item);
    stones += num(item.stoneCharges);
    netWeight += num(item.netWeight);
  }
  const subtotal = money(metalValue + making + stones);
  const discount = Math.min(Math.max(num(bill.discount), 0), subtotal);
  const taxable = money(subtotal - discount);
  const cgst = money((taxable * num(bill.gstPercent)) / 200);
  const sgst = cgst;
  const gst = money(cgst + sgst);
  const total = Math.round(taxable + gst);
  return {
    metalValue: money(metalValue),
    making: money(making),
    stones: money(stones),
    subtotal,
    discount,
    taxable,
    cgst,
    sgst,
    gst,
    roundOff: money(total - (taxable + gst)),
    total,
    netWeight: Math.round(netWeight * 1000) / 1000,
  };
}

export function oldGoldValue(weight: number, rate: number): number {
  return Math.round(num(weight) * num(rate));
}

export interface Allocation {
  byBill: Map<string, BillStatus>;
  openingRemaining: number;
  advance: number;
}

/**
 * Settles a customer's credits against their debits the way a khata is read:
 * payments tagged to a bill go to that bill first; anything else (untagged payments,
 * overpayments, negative opening balance) clears the oldest dues first. Whatever is
 * left over is an advance held for the customer.
 */
export function allocatePayments(
  customer: Customer,
  bills: Bill[],
  payments: Payment[],
  totals: Map<string, BillTotals>,
  today: string,
  creditDays: number,
): Allocation {
  const ordered = [...bills].sort(
    (a, b) => a.date.localeCompare(b.date) || a.billNo.localeCompare(b.billNo),
  );
  const remaining = new Map<string, number>();
  const paid = new Map<string, number>();
  for (const bill of ordered) {
    remaining.set(bill.id, totals.get(bill.id)?.total ?? 0);
    paid.set(bill.id, 0);
  }

  let openingRemaining = Math.max(customer.openingBalance, 0);
  let pool = Math.max(-customer.openingBalance, 0);

  const sortedPayments = [...payments].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  );
  for (const payment of sortedPayments) {
    const due = payment.billId !== undefined ? remaining.get(payment.billId) : undefined;
    if (due === undefined) {
      pool += payment.amount;
      continue;
    }
    const applied = Math.min(payment.amount, due);
    remaining.set(payment.billId!, due - applied);
    paid.set(payment.billId!, (paid.get(payment.billId!) ?? 0) + applied);
    pool += payment.amount - applied;
  }

  const fromOpening = Math.min(pool, openingRemaining);
  openingRemaining -= fromOpening;
  pool -= fromOpening;

  for (const bill of ordered) {
    if (pool <= 0) break;
    const due = remaining.get(bill.id) ?? 0;
    if (due <= 0) continue;
    const applied = Math.min(pool, due);
    remaining.set(bill.id, due - applied);
    paid.set(bill.id, (paid.get(bill.id) ?? 0) + applied);
    pool -= applied;
  }

  const byBill = new Map<string, BillStatus>();
  for (const bill of ordered) {
    const total = totals.get(bill.id)?.total ?? 0;
    const balance = Math.round((remaining.get(bill.id) ?? 0) * 100) / 100;
    const billPaid = paid.get(bill.id) ?? 0;
    const daysOpen = Math.max(daysBetween(bill.date, today), 0);
    const hasDue = balance > 0.5;
    byBill.set(bill.id, {
      total,
      paid: billPaid,
      balance: hasDue ? balance : 0,
      state: !hasDue ? 'paid' : billPaid > 0.5 ? 'partial' : 'unpaid',
      overdue: hasDue && daysOpen > creditDays,
      daysOpen,
    });
  }

  return { byBill, openingRemaining, advance: pool };
}

export const AGING_BUCKETS = [
  { key: '0-30', label: '0–30 days', min: 0, max: 30 },
  { key: '31-60', label: '31–60 days', min: 31, max: 60 },
  { key: '61-90', label: '61–90 days', min: 61, max: 90 },
  { key: '90+', label: 'Over 90 days', min: 91, max: Infinity },
] as const;

export function agingBucketIndex(days: number): number {
  return AGING_BUCKETS.findIndex((bucket) => days >= bucket.min && days <= bucket.max);
}
