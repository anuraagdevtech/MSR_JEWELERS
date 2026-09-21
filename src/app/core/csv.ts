function escape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Builds a CSV (with a BOM so Excel reads ₹ and Indian names correctly) and downloads it. */
export function downloadCsv(filename: string, header: string[], rows: unknown[][]): void {
  const body = [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
  downloadFile(filename, `﻿${body}`, 'text/csv;charset=utf-8');
}

export function downloadFile(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
