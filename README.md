# MSR Jewellers

Counter software for a jewellery shop: customers, GST tax invoices, payments, a credit/debit
khata, and business reports. Built with Angular 22 (standalone components, signals,
zoneless). It runs in two modes:

- **Hosted (cloud) mode**: data lives in a Supabase database; owners and counter staff sign in
  with a password **and** an authenticator-app code (two-factor), from the shop PC or a phone.
- **Local mode**: no login; data stays in one browser. Used for trying the app and for development.

## What's inside

| Page | Who | What it does |
| --- | --- | --- |
| **Dashboard** | Owners | Sales (debit) and collections (credit) with change vs the previous period, outstanding and overdue dues, 12-month billed-vs-collected chart, dues by age, best sellers, collections by mode, sales by category, highest dues with WhatsApp reminders, recent activity. |
| **Reports** | Owners | **Sales** (monthly sales, making charges earned, gold out vs old gold in, busiest days, metal & purity mix) · **Best sellers** (top designs by value, pieces or weight; categories; CSV) · **Customers** (new vs returning buyers, repeat rate, top customers, cities, big spenders to call back) · **Collections** (collection ratio, days of sales outstanding, time to settle, aged receivables) · **GST** (month-wise CGST/SGST, HSN summary for GSTR-1, B2B invoices, CSV exports). |
| **Customers** | Owners | Every account with lifetime billed, paid and khata balance (`Dr` = customer owes, `Cr` = advance). |
| **Customer statement** | Owners | Running-balance statement, bills, payments, 12-month chart, print and CSV. |
| **Bills / Credit & debit** | Owners | All invoices with status; day book of every debit and credit. |
| **Counter** | Everyone | Quick actions, today's bills and receipts, cash in the drawer for the end-of-day tally. |
| **New bill / Record payment** | Everyone | GST invoice with purity-wise rates, making, stones, HUID, old-gold exchange and payment at billing. |
| **Settings** | Owners | Board rates, shop and invoice details, team access, theme, backup / restore. |

Balances: a payment tagged to a bill settles that bill first; untagged payments and
overpayments clear the oldest dues first; anything left over is held as an advance.

## Security in hosted mode

- **Two-factor sign-in for everyone.** The first sign-in shows a QR code to scan with Google
  Authenticator or Microsoft Authenticator; every sign-in after that needs the 6-digit code.
- **Enforced by the database, not just the screens.** Every table has row-level security that
  requires the two-factor level (`aal2`) and a role. Someone with only a stolen password gets
  nothing back, even by calling the database directly. See `supabase/schema.sql`.
- **Roles.** *Owners* see and manage everything. *Counter staff* can look up customers, make bills
  and take payments; they see only the bills and receipts they entered today or yesterday, never
  balances, dashboards, reports or settings, and cannot delete anything. New sign-ups get no
  access until an owner assigns a role. Nobody can change their own role.
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

### 2. Create the first owner

1. **Authentication → Users → Add user → Create new user**: enter your email and a strong password,
   tick **Auto Confirm User**.
2. In **SQL Editor**, run (with your email and name):

   ```sql
   update public.profiles
   set role = 'owner', full_name = 'Your Name'
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
2. The app opens with **sample data** so you can explore. When ready, go to **Settings → Your data**
   and **Erase all** (or **Restore backup** to bring in data from local mode).
3. To add a person: Supabase **Authentication → Users → Add user**. They sign in and set up their
   authenticator; you then choose **Owner** or **Counter staff** in **Settings → Team & access**.

**Lost phone?** In Supabase, **Authentication → Users →** the person **→ MFA factors → delete**.
At their next sign-in they scan a new QR code. Keep at least two owners so one can help the other.

## Running it on your computer

Requires Node.js 22.22+ (`nvm use` reads `.nvmrc`).

```bash
npm install
npm start
```

Open http://localhost:4200. Without Supabase settings this is **local mode**. To run against
your Supabase project, copy `.env.example` to `.env` and fill in the two values first.
`npm run build` produces the static site in `dist/frontend/browser`.

## Code map

- `supabase/schema.sql` – tables, roles, row-level security, numbering functions.
- `src/app/core/` – data model, bill maths (`calc.ts`), report maths (`analytics.ts`), the store
  (`store.ts`, local or cloud), sign-in and 2FA (`auth.service.ts`), route guards, sample data.
- `src/app/pages/` – one lazily loaded folder per page; `reports/` holds the five report tabs.
- `src/app/shared/` – charts (SVG, no chart library), dialogs, customer picker, pipes.
- `src/app/layout/` – sidebar and top bar around signed-in pages.
- `scripts/ng.mjs` – runs the Angular CLI with the Supabase settings from the environment.
