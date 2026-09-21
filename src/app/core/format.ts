import { parseISODate } from './dates';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const inrPaise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const plain = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

const dateFormat = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const shortDateFormat = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });
const monthFormat = new Intl.DateTimeFormat('en-IN', { month: 'short' });
const monthYearFormat = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' });

/** Coerces to a finite number and turns -0 into 0 so nothing prints as "-₹0". */
function clean(value: number): number {
  return Number(value) || 0;
}

export function formatINR(value: number, withPaise = false): string {
  const n = clean(value);
  if (withPaise) return inrPaise.format(Math.round(n * 100) / 100 || 0);
  return inr.format(Math.round(n) || 0);
}

/** Indian short scale: ₹950, ₹85K, ₹4.3L, ₹1.25Cr. */
export function formatINRCompact(value: number): string {
  const n = clean(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const trim = (v: number, digits: number) => String(Number(v.toFixed(digits)));
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7, 2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5, abs >= 1e6 ? 1 : 2)}L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3, abs >= 1e4 ? 0 : 1)}K`;
  return `${sign}₹${Math.round(abs)}`;
}

export function formatNumber(value: number): string {
  return plain.format(clean(value));
}

export function formatGrams(value: number, digits = 3): string {
  return `${clean(value).toFixed(digits)} g`;
}

export function formatDate(iso: string | undefined | null): string {
  return iso ? dateFormat.format(parseISODate(iso)) : '—';
}

export function formatShortDate(iso: string | undefined | null): string {
  return iso ? shortDateFormat.format(parseISODate(iso)) : '—';
}

export function formatMonth(monthKey: string, withYear = false): string {
  const date = parseISODate(`${monthKey}-01`);
  return withYear ? monthYearFormat.format(date) : monthFormat.format(date);
}

/** Khata convention: dues read "Dr" (customer owes), advances read "Cr". */
export function formatBalance(value: number): string {
  const n = Math.round(clean(value));
  if (n === 0) return formatINR(0);
  return `${formatINR(Math.abs(n))} ${n > 0 ? 'Dr' : 'Cr'}`;
}

export function initials(name: string): string {
  return name
    .split(/[\s.@_-]+/)
    .map((part) => part.match(/\p{L}/u)?.[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function formatPhone(phone: string): string {
  const digits = phoneDigits(phone);
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  return phone;
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
}

function belowThousand(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundred) return belowHundred(rest);
  return `${ONES[hundred]} Hundred${rest ? ` and ${belowHundred(rest)}` : ''}`;
}

/**
 * Amount in words in British English with the Indian system (lakh / crore), as printed on
 * invoices: "Rupees Twelve Lakh Thirty-Four Thousand Five Hundred and Sixty-Seven Only".
 */
export function amountInWords(value: number): string {
  let n = Math.round(Math.abs(clean(value)));
  if (n === 0) return 'Rupees Zero Only';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  if (crore) parts.push(`${crore >= 100 ? belowThousand(crore) : belowHundred(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(n < 100 && parts.length ? `and ${belowHundred(n)}` : belowThousand(n));
  return `Rupees ${parts.join(' ')} Only`;
}
