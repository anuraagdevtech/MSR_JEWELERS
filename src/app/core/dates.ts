// All business dates are stored as local calendar dates ("YYYY-MM-DD") so a bill made
// at 1 a.m. IST never slips to the previous day the way toISOString() would.

const DAY_MS = 86_400_000;

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function utcDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1) / DAY_MS;
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round(utcDay(to) - utcDay(from));
}

export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** Adds calendar months, clamping the day (31 Mar + 1 month = 30 Apr). */
export function addMonths(iso: string, months: number): string {
  const date = parseISODate(iso);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return toISODate(date);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Indian financial year start (1 April) for the given date. */
export function financialYearStart(iso: string): string {
  const date = parseISODate(iso);
  const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${year}-04-01`;
}

/** e.g. "26-27" for any date between 1 Apr 2026 and 31 Mar 2027. */
export function financialYearLabel(iso: string): string {
  const start = Number(financialYearStart(iso).slice(0, 4));
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

export function isWithin(iso: string, from: string, to: string): boolean {
  return iso >= from && iso <= to;
}

/** The last `count` month keys ending with the month of `endIso`, oldest first. */
export function lastMonths(endIso: string, count: number): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(monthKey(addMonths(startOfMonth(endIso), -i)));
  }
  return keys;
}
