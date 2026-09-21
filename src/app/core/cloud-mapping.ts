import { Bill, BillItem, Customer, OldGoldDetail, Payment, PaymentMode } from './models';
import { toISODate } from './dates';

// Database rows use snake_case columns and real timestamps; the app works with the camelCase
// records in models.ts and local "YYYY-MM-DDTHH:MM:SS" stamps for ordering within a day.

export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  city: string;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  created_on: string;
  created_at?: string;
  created_by?: string | null;
}

export interface OpeningRow {
  customer_id: string;
  amount: number | string;
}

export interface BillRow {
  id: string;
  bill_no: string;
  customer_id: string;
  bill_date: string;
  items: BillItem[];
  discount: number | string;
  gst_percent: number | string;
  notes: string | null;
  created_at: string;
  created_by?: string | null;
}

export interface PaymentRow {
  id: string;
  receipt_no: string;
  customer_id: string;
  bill_id: string | null;
  paid_on: string;
  amount: number | string;
  mode: PaymentMode;
  reference: string | null;
  old_gold: OldGoldDetail | null;
  notes: string | null;
  created_at: string;
  created_by?: string | null;
}

const opt = (value: string | null | undefined) => (value ? value : undefined);

/** "2026-09-21T08:58:12.4+00:00" → "2026-09-21T14:28:12" in the browser's time zone. */
export function toLocalStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${toISODate(date)}T${date.toTimeString().slice(0, 8)}`;
}

/** Local "YYYY-MM-DDTHH:MM:SS" → a real instant for the database. */
export function toInstant(stamp: string): string {
  const date = new Date(stamp.length === 10 ? `${stamp}T00:00:00` : stamp);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function customerFromRow(row: CustomerRow, opening = 0): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: opt(row.email),
    city: row.city,
    address: opt(row.address),
    gstin: opt(row.gstin),
    notes: opt(row.notes),
    openingBalance: Number(opening) || 0,
    createdAt: row.created_on,
  };
}

export function customerToRow(customer: Customer, userId: string): CustomerRow {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email ?? null,
    city: customer.city,
    address: customer.address ?? null,
    gstin: customer.gstin ?? null,
    notes: customer.notes ?? null,
    created_on: customer.createdAt,
    created_by: userId,
  };
}

export function billFromRow(row: BillRow): Bill {
  return {
    id: row.id,
    billNo: row.bill_no,
    customerId: row.customer_id,
    date: row.bill_date,
    items: row.items,
    discount: Number(row.discount) || 0,
    gstPercent: Number(row.gst_percent) || 0,
    notes: opt(row.notes),
    createdAt: toLocalStamp(row.created_at),
  };
}

export function billToRow(bill: Bill, userId: string): BillRow {
  return {
    id: bill.id,
    bill_no: bill.billNo,
    customer_id: bill.customerId,
    bill_date: bill.date,
    items: bill.items,
    discount: bill.discount,
    gst_percent: bill.gstPercent,
    notes: bill.notes ?? null,
    created_at: toInstant(bill.createdAt),
    created_by: userId,
  };
}

export function paymentFromRow(row: PaymentRow): Payment {
  return {
    id: row.id,
    receiptNo: row.receipt_no,
    customerId: row.customer_id,
    billId: opt(row.bill_id),
    date: row.paid_on,
    amount: Number(row.amount) || 0,
    mode: row.mode,
    reference: opt(row.reference),
    oldGold: row.old_gold ?? undefined,
    notes: opt(row.notes),
    createdAt: toLocalStamp(row.created_at),
  };
}

export function paymentToRow(payment: Payment, userId: string): PaymentRow {
  return {
    id: payment.id,
    receipt_no: payment.receiptNo,
    customer_id: payment.customerId,
    bill_id: payment.billId ?? null,
    paid_on: payment.date,
    amount: payment.amount,
    mode: payment.mode,
    reference: payment.reference ?? null,
    old_gold: payment.oldGold ?? null,
    notes: payment.notes ?? null,
    created_at: toInstant(payment.createdAt),
    created_by: userId,
  };
}
