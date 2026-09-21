-- MSR Jewellers · database schema, access rules and functions
--
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- It is safe to run again; it only creates what is missing and replaces functions/policies.
--
-- Security model
--   * Every read and write requires a signed-in user who has passed two-factor
--     authentication (JWT "aal" claim = aal2). Without the authenticator code the
--     database returns nothing, whatever the app shows.
--   * Owners see and manage everything.
--   * Staff can look up customers, create bills and record payments, and see only the
--     bills/receipts they entered since the start of yesterday (for reprinting).
--     They cannot see opening balances, other bills, dashboards or change settings,
--     and cannot delete anything.
--   * New sign-ups get no access ("pending") until an owner grants a role.

-- ---------------------------------------------------------------------------------------
-- People and roles
-- ---------------------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  role       text not null default 'pending' check (role in ('owner', 'staff', 'pending')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users created before this script ran.
insert into public.profiles (user_id, email)
select id, coalesce(email, '') from auth.users
on conflict (user_id) do nothing;

-- Nobody may change their own role (stops staff promoting themselves and owners locking
-- themselves out). Another owner, or the SQL editor, has to do it.
create or replace function public.guard_role_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role and new.user_id = auth.uid() then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id or new.email is distinct from old.email then
    raise exception 'User and email cannot be changed here' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_role_change on public.profiles;
create trigger guard_role_change
  before update on public.profiles
  for each row execute function public.guard_role_change();

-- ---------------------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------------------

create or replace function public.has_mfa()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid();
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
as $$
  select public.has_mfa() and coalesce(public.my_role(), '') in ('owner', 'staff');
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
as $$
  select public.has_mfa() and coalesce(public.my_role(), '') = 'owner';
$$;

-- Rows a staff member entered since the start of yesterday, India time.
create or replace function public.in_staff_window(p_created_by uuid, p_created_at timestamptz)
returns boolean
language sql
stable
as $$
  select p_created_by = auth.uid()
     and p_created_at >= (
       (date_trunc('day', now() at time zone 'Asia/Kolkata') - interval '1 day')
       at time zone 'Asia/Kolkata'
     );
$$;

-- ---------------------------------------------------------------------------------------
-- Business data
-- ---------------------------------------------------------------------------------------

create table if not exists public.shop_settings (
  id         smallint primary key default 1 check (id = 1),
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table if not exists public.customers (
  id         text primary key,
  name       text not null check (length(btrim(name)) >= 2),
  phone      text not null,
  email      text,
  city       text not null default '',
  address    text,
  gstin      text,
  notes      text,
  created_on date not null default current_date,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- Kept apart from customers so staff can look customers up without seeing their dues.
create table if not exists public.customer_openings (
  customer_id text primary key references public.customers (id) on delete cascade,
  amount      numeric(14, 2) not null default 0
);

create table if not exists public.bills (
  id          text primary key,
  bill_no     text not null unique,
  customer_id text not null references public.customers (id) on delete restrict,
  bill_date   date not null,
  items       jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  discount    numeric(14, 2) not null default 0 check (discount >= 0),
  gst_percent numeric(5, 2) not null default 3 check (gst_percent >= 0),
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

create table if not exists public.payments (
  id          text primary key,
  receipt_no  text not null unique,
  customer_id text not null references public.customers (id) on delete restrict,
  bill_id     text references public.bills (id) on delete cascade,
  paid_on     date not null,
  amount      numeric(14, 2) not null check (amount > 0),
  mode        text not null check (mode in ('Cash', 'UPI', 'Card', 'Bank transfer', 'Cheque', 'Old gold')),
  reference   text,
  old_gold    jsonb,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

create index if not exists bills_customer_idx on public.bills (customer_id);
create index if not exists bills_date_idx on public.bills (bill_date);
create index if not exists payments_customer_idx on public.payments (customer_id);
create index if not exists payments_bill_idx on public.payments (bill_id);
create index if not exists payments_date_idx on public.payments (paid_on);

insert into public.shop_settings (id, data)
values (1, jsonb_build_object(
  'shopName', 'MSR Jewellers',
  'tagline', 'Gold · Diamond · Silver',
  'address', '',
  'phone', '',
  'gstin', '',
  'billPrefix', 'MSR',
  'receiptPrefix', 'RC',
  'creditDays', 30,
  'gstPercent', 3,
  'rates', jsonb_build_object('24K', 14000, '22K', 12835, '18K', 10500, '999', 215, '925', 199),
  'ratesUpdatedAt', to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS')
))
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.shop_settings     enable row level security;
alter table public.customers         enable row level security;
alter table public.customer_openings enable row level security;
alter table public.bills             enable row level security;
alter table public.payments          enable row level security;

revoke all on public.profiles, public.shop_settings, public.customers,
  public.customer_openings, public.bills, public.payments from anon;

-- profiles
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "profiles: owners read all" on public.profiles;
create policy "profiles: owners read all" on public.profiles
  for select to authenticated using ((select public.is_owner()));

drop policy if exists "profiles: update own name" on public.profiles;
create policy "profiles: update own name" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.has_mfa()))
  with check (user_id = (select auth.uid()));

drop policy if exists "profiles: owners manage" on public.profiles;
create policy "profiles: owners manage" on public.profiles
  for update to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));

-- shop_settings
drop policy if exists "settings: members read" on public.shop_settings;
create policy "settings: members read" on public.shop_settings
  for select to authenticated using ((select public.is_member()));

drop policy if exists "settings: owners write" on public.shop_settings;
create policy "settings: owners write" on public.shop_settings
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));

-- customers
drop policy if exists "customers: members read" on public.customers;
create policy "customers: members read" on public.customers
  for select to authenticated using ((select public.is_member()));

drop policy if exists "customers: members add" on public.customers;
create policy "customers: members add" on public.customers
  for insert to authenticated
  with check ((select public.is_member()) and created_by = (select auth.uid()));

drop policy if exists "customers: members edit" on public.customers;
create policy "customers: members edit" on public.customers
  for update to authenticated
  using ((select public.is_member()))
  with check ((select public.is_member()));

drop policy if exists "customers: owners delete" on public.customers;
create policy "customers: owners delete" on public.customers
  for delete to authenticated using ((select public.is_owner()));

-- customer_openings (owners only)
drop policy if exists "openings: owners" on public.customer_openings;
create policy "openings: owners" on public.customer_openings
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));

-- bills: staff create them through create_bill(); direct inserts are for owner imports.
drop policy if exists "bills: owners read" on public.bills;
create policy "bills: owners read" on public.bills
  for select to authenticated using ((select public.is_owner()));

drop policy if exists "bills: staff read own recent" on public.bills;
create policy "bills: staff read own recent" on public.bills
  for select to authenticated
  using ((select public.is_member()) and public.in_staff_window(created_by, created_at));

drop policy if exists "bills: owners import" on public.bills;
create policy "bills: owners import" on public.bills
  for insert to authenticated with check ((select public.is_owner()));

drop policy if exists "bills: owners delete" on public.bills;
create policy "bills: owners delete" on public.bills
  for delete to authenticated using ((select public.is_owner()));

-- payments
drop policy if exists "payments: owners read" on public.payments;
create policy "payments: owners read" on public.payments
  for select to authenticated using ((select public.is_owner()));

drop policy if exists "payments: staff read own recent" on public.payments;
create policy "payments: staff read own recent" on public.payments
  for select to authenticated
  using ((select public.is_member()) and public.in_staff_window(created_by, created_at));

drop policy if exists "payments: owners import" on public.payments;
create policy "payments: owners import" on public.payments
  for insert to authenticated with check ((select public.is_owner()));

drop policy if exists "payments: owners delete" on public.payments;
create policy "payments: owners delete" on public.payments
  for delete to authenticated using ((select public.is_owner()));

-- ---------------------------------------------------------------------------------------
-- Numbering and counter operations
-- ---------------------------------------------------------------------------------------

-- Next number in a financial-year series, e.g. MSR/26-27/0042. Serialised with an
-- advisory lock so two counters saving at the same moment never get the same number.
create or replace function public.next_doc_number(p_prefix text, p_date date, p_kind text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start int;
  v_stem  text;
  v_next  int;
begin
  v_start := case when extract(month from p_date) >= 4
                  then extract(year from p_date)::int
                  else extract(year from p_date)::int - 1 end;
  v_stem := p_prefix || '/' || lpad((v_start % 100)::text, 2, '0') || '-'
            || lpad(((v_start + 1) % 100)::text, 2, '0') || '/';
  perform pg_advisory_xact_lock(hashtext(p_kind || ':' || v_stem));

  if p_kind = 'bill' then
    select coalesce(max(substr(bill_no, length(v_stem) + 1)::int), 0) + 1 into v_next
    from public.bills
    where left(bill_no, length(v_stem)) = v_stem and substr(bill_no, length(v_stem) + 1) ~ '^\d+$';
  else
    select coalesce(max(substr(receipt_no, length(v_stem) + 1)::int), 0) + 1 into v_next
    from public.payments
    where left(receipt_no, length(v_stem)) = v_stem and substr(receipt_no, length(v_stem) + 1) ~ '^\d+$';
  end if;

  return v_stem || lpad(v_next::text, 4, '0');
end;
$$;

revoke execute on function public.next_doc_number(text, date, text) from public, anon, authenticated;

create or replace function public.insert_payment(p jsonb, p_bill_id text, p_customer_id text)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_row    public.payments;
begin
  select coalesce(data ->> 'receiptPrefix', 'RC') into v_prefix from public.shop_settings where id = 1;
  insert into public.payments
    (id, receipt_no, customer_id, bill_id, paid_on, amount, mode, reference, old_gold, notes, created_by)
  values (
    p ->> 'id',
    public.next_doc_number(coalesce(v_prefix, 'RC'), (p ->> 'date')::date, 'receipt'),
    p_customer_id,
    p_bill_id,
    (p ->> 'date')::date,
    (p ->> 'amount')::numeric,
    p ->> 'mode',
    nullif(p ->> 'reference', ''),
    case when jsonb_typeof(p -> 'oldGold') = 'object' then p -> 'oldGold' end,
    nullif(p ->> 'notes', ''),
    auth.uid()
  )
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.insert_payment(jsonb, text, text) from public, anon, authenticated;

-- Creates a bill and any payments taken at billing in one transaction.
create or replace function public.create_bill(p_bill jsonb, p_payments jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix   text;
  v_bill     public.bills;
  v_payment  jsonb;
  v_payments jsonb := '[]'::jsonb;
begin
  if not public.is_member() then
    raise exception 'Two-factor sign-in and shop access are required' using errcode = '42501';
  end if;
  if (p_bill ->> 'date')::date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Bill date cannot be in the future' using errcode = '22023';
  end if;

  select coalesce(data ->> 'billPrefix', 'MSR') into v_prefix from public.shop_settings where id = 1;

  insert into public.bills
    (id, bill_no, customer_id, bill_date, items, discount, gst_percent, notes, created_by)
  values (
    p_bill ->> 'id',
    public.next_doc_number(coalesce(v_prefix, 'MSR'), (p_bill ->> 'date')::date, 'bill'),
    p_bill ->> 'customerId',
    (p_bill ->> 'date')::date,
    p_bill -> 'items',
    coalesce((p_bill ->> 'discount')::numeric, 0),
    coalesce((p_bill ->> 'gstPercent')::numeric, 3),
    nullif(p_bill ->> 'notes', ''),
    auth.uid()
  )
  returning * into v_bill;

  for v_payment in select value from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    v_payments := v_payments || to_jsonb(public.insert_payment(v_payment, v_bill.id, v_bill.customer_id));
  end loop;

  return jsonb_build_object('bill', to_jsonb(v_bill), 'payments', v_payments);
end;
$$;

create or replace function public.add_payment(p_payment jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member() then
    raise exception 'Two-factor sign-in and shop access are required' using errcode = '42501';
  end if;
  if (p_payment ->> 'date')::date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Payment date cannot be in the future' using errcode = '22023';
  end if;
  return to_jsonb(public.insert_payment(
    p_payment,
    nullif(p_payment ->> 'billId', ''),
    p_payment ->> 'customerId'
  ));
end;
$$;

-- Owners only: wipe every customer, bill and payment (settings are kept).
create or replace function public.erase_all_records()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only owners can erase records' using errcode = '42501';
  end if;
  delete from public.payments where true;
  delete from public.bills where true;
  delete from public.customer_openings where true;
  delete from public.customers where true;
end;
$$;

revoke execute on function public.create_bill(jsonb, jsonb) from public, anon;
revoke execute on function public.add_payment(jsonb) from public, anon;
revoke execute on function public.erase_all_records() from public, anon;
grant execute on function public.create_bill(jsonb, jsonb) to authenticated;
grant execute on function public.add_payment(jsonb) to authenticated;
grant execute on function public.erase_all_records() to authenticated;

-- ---------------------------------------------------------------------------------------
-- Live updates (owners' phones refresh as the counter bills)
-- ---------------------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['customers', 'customer_openings', 'bills', 'payments', 'shop_settings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
