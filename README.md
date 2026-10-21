# MSR Jewellers

Counter software for **MSR Jewellers, Gandhinagar, Hyderabad, Telangana**: customers, GST tax invoices, payments, a credit/debit
khata, and business reports. Built with Angular 22 (standalone components, signals,
zoneless). It runs in two modes:

- **Supabase mode** (hosted or local): data lives in PostgreSQL; Admin, Billing and Analytics sign in
  with a password **and** an authenticator-app code (two-factor), from the shop PC or a phone.
- **Browser demo**: dummy logins let you try each role; sample data stays in one browser.
  This is a preview, not secure storage for real customer records.

## What's inside

| Page | Who | What it does |
| --- | --- | --- |
| **Dashboard** | Admin, Analytics | Sales (debit) and collections (credit) with change vs the previous period, outstanding and overdue dues, 12-month billed-vs-collected chart, dues by age, best sellers, collections by mode, sales by category, highest dues with WhatsApp reminders, recent activity. |
| **Reports** | Admin, Analytics | **Sales** (monthly sales, making charges earned, gold out vs old gold in, busiest days, metal & purity mix) · **Best sellers** (top designs by value, pieces or weight; categories; CSV) · **Customers** (new vs returning buyers, repeat rate, top customers, cities, big spenders to call back) · **Collections** (collection ratio, days of sales outstanding, time to settle, aged receivables) · **GST** (month-wise CGST/SGST, HSN summary for GSTR-1, B2B invoices, CSV exports). |
| **Customers** | Admin, Analytics | Every account with lifetime billed, paid and khata balance (`Dr` = customer owes, `Cr` = advance). |
| **Customer statement** | Admin, Analytics | Running-balance statement, bills, payments, 12-month chart, print and CSV. |
| **Bills / Credit & debit** | Admin, Analytics | All invoices with status; day book of every debit and credit. |
| **Register** | Admin, Analytics | The counter's whiteboard book on screen: S.No, customer, phone, address, c/o name and phone, slip no. and date, gold credit and debit in grams, cash credit and debit, notes — with column totals, each customer's running gold and cash balance, a balances-per-customer view, print and CSV. |
| **Counter** | Admin, Billing | Quick actions, today's bills and receipts, cash in the drawer for the end-of-day tally. |
| **New bill / Record payment** | Admin, Billing | GST invoice with purity-wise rates, making, stones, HUID, old-gold exchange and payment at billing. |
| **Settings** | Admin | Board rates, shop and invoice details, team access, theme, backup / restore. |

Balances: a payment tagged to a bill settles that bill first; untagged payments and
overpayments clear the oldest dues first; anything left over is held as an advance.

The **register** is a separate book, the way it is on the shop's board. A *debit* is what was
handed to the customer (so they owe it) and a *credit* is what came back in; gold runs in grams
and cash in rupees as two balances, read as `Dr` (owed to the shop) or `Cr` (held for the
customer). It does not touch GST bills or receipts, so nothing is counted twice.

## Security in hosted mode

- **Two-factor sign-in for everyone.** The first sign-in shows a QR code to scan with Google
  Authenticator or Microsoft Authenticator; every sign-in after that needs the 6-digit code.
- **Enforced by the database, not just the screens.** Every table has row-level security that
  requires the two-factor level (`aal2`) and a role. Someone with only a stolen password gets
  nothing back, even by calling the database directly. See `supabase/schema.sql`.
- **Roles.** **Admin** manages the shop and team. **Analytics** reads all dashboards, reports,
  customers, bills and register balances, and can print/export reports; it cannot change records.
  **Billing** can look up customers, make bills
  and take payments; they see only the bills and receipts they entered today or yesterday, never
  balances, dashboards, reports, the register or settings, and cannot delete anything. New sign-ups
  get no access until an admin assigns a role. Nobody can change their own role.
- **Bill and receipt numbers are issued by the database**, so two counters saving at once never
  clash.
- **Auto sign-out** after 30 minutes without a click or keypress.
- Security headers (Content-Security-Policy, no framing, HSTS) are set in `vercel.json`.

## Put it online (Supabase + Vercel)

About 20 minutes, once. You need a free GitHub account with this repository in it.

### 1. Create the database

1. Sign up at [supabase.com](https://supabase.com) and create a **New project**. Choose the
   **Mumbai (ap-south-1)** region and save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql),
   and press **Run**. It is safe to run again later.
3. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up".
   Only you should be able to add people.
4. **Authentication → Multi-Factor**: make sure **TOTP (authenticator app)** is enabled
   (it is by default).
5. **Project Settings → API**: note the **Project URL** and the **anon / publishable key**.
   Never use the `service_role` / secret key in the app.

### 2. Create the first Admin

1. **Authentication → Users → Add user → Create new user**: enter your email and a strong password,
   tick **Auto Confirm User**.
2. In **SQL Editor**, run (with your email and name):

   ```sql
   update public.profiles
   set role = 'admin', full_name = 'Your Name'
   where email = 'you@example.com';
   ```

### 3. Deploy the website

1. Sign up at [vercel.com](https://vercel.com) with GitHub and **Add New → Project** → import
   this repository. `vercel.json` already sets the build command and output folder.
2. Under **Environment Variables** add:
   - `SUPABASE_URL` = the Project URL from step 1.5
   - `SUPABASE_ANON_KEY` = the anon / publishable key from step 1.5
3. Press **Deploy**. You get an address like `https://msr-jewellers.vercel.app`.
4. Back in Supabase, **Authentication → URL Configuration**: set **Site URL** to that address and
   add `https://<your-address>/login` under **Redirect URLs** (used by password-reset emails).

> Vercel's free **Hobby** plan is meant for non-commercial use; a shop should use **Vercel Pro**.
> Supabase's free plan pauses a project after a week with no activity and has no automatic
> backups; **Supabase Pro** removes the pause and adds daily backups. Either way, download a
> backup from **Settings → Your data** now and then.

### 4. First sign-in and your team

1. Open your address, sign in, scan the QR code with an authenticator app, and type the code.
2. A new hosted database opens empty. Use **Settings → Your data → Load sample data** to explore,
   or **Restore backup** to bring in your browser data. Erase sample records before starting real billing.
3. To add a person: Supabase **Authentication → Users → Add user**. They sign in and set up their
   authenticator; you then choose **Admin**, **Billing** or **Analytics** in **Settings → Team & access**.

**Lost phone?** In Supabase, **Authentication → Users →** the person **→ MFA factors → delete**.
At their next sign-in they scan a new QR code. Keep at least two Admin accounts so one can help the other.

## Running it on your computer

Requires Node.js 22.22+ (`nvm use` reads `.nvmrc`).

```bash
npm install
npm start
```

Open http://localhost:4200. Without Supabase settings this is the **browser demo** with the accounts below. To run against
your Supabase project, copy `.env.example` to `.env` and fill in the two values first.
`npm run build` produces the static site in `dist/frontend/browser`.

## Demo usernames and passwords

These accounts work in the browser demo and the local Supabase development database:

| Username | Email alias | Password | Access |
| --- | --- | --- | --- |
| `admin` | `admin@msr.local` | `AdminDemo!2026` | All records, settings and team management |
| `billing` | `billing@msr.local` | `BillingDemo!2026` | Customers, new bills, payments and own recent entries |
| `analytics` | `analytics@msr.local` | `AnalyticsDemo!2026` | Read-only dashboards, customers, bills and register |

Supabase also requires real authenticator-app enrolment and a code. The browser demo does
not simulate two-factor security. Dummy accounts are never created in a hosted project;
use individual real emails and unique passwords there.

## Real local Supabase

On the supported native runtime (including Apple silicon), run:

```bash
npm ci
npm run supabase:setup
npm run supabase:sample-data
npm run start:supabase
```

Open **http://localhost:4311** and sign in with a dummy account above. On first sign-in,
scan the authenticator QR code and enter its current code. The setup command prints the
local **Studio** address as well. Native runtime services use ports assigned by the CLI.
The sample-data command only populates an empty local database and never replaces records.

Local keys are generated in the ignored `.env.supabase.local` file with restricted file
permissions. The browser receives only the public key. The setup and sample-data scripts
refuse hosted database URLs.

```bash
npm test                  # Date formatting, roles, migration and database policies
npm run test:supabase     # Real Auth, TOTP, PostgREST, concurrent billing and access tests
npm run supabase:stop     # Stop services and keep the database for next time
```

The integration suite uses disposable test users and rows, cleans them up, and keeps sample
or shop records. Existing `owner` and `staff` accounts migrate to `admin` and `billing`.
For an existing hosted project, run the updated `supabase/schema.sql` before deploying this
version. The matching initial migration is in `supabase/migrations/` for CLI workflows.

All calendar dates, activity dates, rate timestamps and monthly chart labels include a year.
Shop settings default to Telangana state code **36**. Enter the shop's real GSTIN and phone
in Settings; no registration or contact number has been invented.

## Code map

- `supabase/schema.sql` – tables, roles, row-level security, numbering functions.
- `src/app/core/` – data model, bill maths (`calc.ts`), report maths (`analytics.ts`), the store
  (`store.ts`, local or cloud), sign-in and 2FA (`auth.service.ts`), route guards, sample data.
- `src/app/pages/` – one lazily loaded folder per page; `reports/` holds the five report tabs and
  `register/` the counter's register book.
- `src/app/shared/` – charts (SVG, no chart library), dialogs, customer picker, pipes.
- `src/app/layout/` – sidebar and top bar around signed-in pages.
- `scripts/ng.mjs` – runs the Angular CLI with the Supabase settings from the environment.
