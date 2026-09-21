# MSR Jewelers

Counter software for a jewellery shop: customers, GST tax invoices, payments, and a
credit/debit khata with dashboards. Built with Angular 22 (standalone components, signals,
zoneless). Everything runs in the browser; there is no server.

## What's inside

| Page | What it does |
| --- | --- |
| **Dashboard** | Sales billed (debit) and collections (credit) with change vs the previous period, outstanding and overdue dues, a 12-month billed-vs-collected chart, dues by age (0–30 / 31–60 / 61–90 / 90+ days), collections by payment mode, sales by category, highest dues with WhatsApp reminders, and recent activity. |
| **Customers** | Every account with lifetime billed, paid and khata balance (`Dr` = customer owes, `Cr` = advance held). Filter by dues, overdue or advance; export to CSV. |
| **Customer statement** | Running-balance statement (all time, this FY, 12 months), bills, payments, a 12-month chart, print and CSV export. |
| **Bills** | All invoices with paid / part-paid / overdue status, date filters, totals and CSV export. |
| **New bill** | Line items by purity (24K/22K/18K gold, 999/925 silver) with net/gross weight, rate, making charge (% or ₹/g), stones and HUID; discount, CGST + SGST, round-off; old-gold exchange; payment at billing. |
| **Bill** | Printable tax invoice (HSN, amount in words, settlement history), record payment, delete. |
| **Credit & debit** | Day book of every debit and credit across customers, with filters, daily subtotals and CSV export. |
| **Settings** | Today's board rates (with a live international reference), shop and invoice details, theme, backup / restore, sample data. |

How balances work: a payment tagged to a bill settles that bill first; untagged payments
and overpayments clear the oldest dues first; anything left over is held as an advance.
A bill is **overdue** once it is unpaid past the credit period (30 days by default).

## Your data

Records are saved in this browser's local storage, so they stay on this computer only.
Use **Settings → Download backup** regularly, and **Restore backup** to move to another
computer. On first launch the app loads realistic sample data (40 customers, ~18 months of
bills and payments) so you can explore; erase it from **Settings** when you are ready to
start your own book.

## Running it

Requires Node.js 22.22+ (Angular CLI 22).

```bash
npm install
npm start
```

Then open http://localhost:4200. Build for production with `npm run build`; the output
in `dist/frontend/browser` is a static site that can be hosted anywhere.

## Code map

- `src/app/core/` – data model, bill maths (`calc.ts`), the signal store with persistence
  (`store.ts`), sample-data generator (`seed.ts`), formatting and dates.
- `src/app/shared/` – charts (SVG, no chart library), dialogs, customer picker, pipes.
- `src/app/pages/` – one lazily loaded folder per page.
- `src/styles/` – design tokens (light and dark), components and print styles.
