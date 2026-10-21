import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const schema = readFileSync('supabase/schema.sql', 'utf8');
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  billing: '22222222-2222-4222-8222-222222222222',
  analytics: '33333333-3333-4333-8333-333333333333',
  pending: '44444444-4444-4444-8444-444444444444',
};

test('database permission matrix, legacy migration, billing workflow and validation', async (t) => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.jwt(), auth.uid() to anon, authenticated;
    create publication supabase_realtime;
    -- Reproduce users already using the previous Owner/Staff schema.
    create table public.profiles (user_id uuid primary key references auth.users(id), email text not null,
      full_name text not null default '', role text default 'pending' check(role in ('owner','staff','pending')), created_at timestamptz default now());
  `);
  for (const [role, id] of Object.entries(ids)) {
    await db.query('insert into auth.users(id,email) values ($1,$2)', [id, `${role}@msr.local`]);
    await db.query('insert into profiles(user_id,email,role) values($1,$2,$3)', [
      id,
      `${role}@msr.local`,
      role === 'admin' ? 'owner' : role === 'billing' ? 'staff' : 'pending',
    ]);
  }
  await db.exec(schema);
  await db.query("update profiles set role='analytics' where user_id=$1", [ids.analytics]);
  await db.exec(schema); // Safe to rerun on an already migrated database.
  assert.equal(
    (await db.query('select role from profiles where user_id=$1', [ids.admin])).rows[0].role,
    'admin',
  );
  assert.equal(
    (await db.query('select role from profiles where user_id=$1', [ids.billing])).rows[0].role,
    'billing',
  );

  await db.exec(`
    insert into customers(id,name,phone,city) values ('c1','Ravi Kumar','9999900000','Hyderabad'),('c2','Priya Rao','9999900001','Hyderabad');
    insert into customer_openings values('c1', 1000);
    insert into register_entries(id,entry_date,customer_id,gold_credit) values ('r1',current_date,'c1',5);
    insert into bills(id,bill_no,customer_id,bill_date,items,created_by) values ('b1','MSR/26-27/0001','c1',current_date,'[{"description":"Ring"}]','${ids.admin}');
    insert into payments(id,receipt_no,customer_id,paid_on,amount,mode,created_by) values ('p1','RC/26-27/0001','c1',current_date,500,'Cash','${ids.admin}');
  `);
  async function as(
    role: keyof typeof ids | 'anon',
    aal: string,
    sql: string,
    params: unknown[] = [],
  ) {
    await db.exec('begin');
    try {
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: role === 'anon' ? undefined : ids[role], aal }),
      ]);
      await db.exec(`set local role ${role === 'anon' ? 'anon' : 'authenticated'}`);
      return await db.query(sql, params);
    } finally {
      await db.exec('rollback');
    }
  }
  for (const role of ['admin', 'billing', 'analytics', 'pending'] as const) {
    for (const aal of ['aal1', 'aal2']) {
      await t.test(`${role}/${aal}: reads match the role`, async () => {
        const enabled = aal === 'aal2' && role !== 'pending';
        for (const table of [
          'shop_settings',
          'customers',
          'customer_openings',
          'bills',
          'payments',
          'register_entries',
        ]) {
          const visible =
            enabled &&
            (['admin', 'analytics'].includes(role) ||
              ['shop_settings', 'customers'].includes(table));
          const result = await as(role, aal, `select count(*)::int as n from public.${table}`);
          assert.equal(Number(result.rows[0].n) > 0, visible, `${role}/${aal} ${table}`);
        }
      });
      if (aal === 'aal1' || role === 'analytics' || role === 'pending') {
        await t.test(`${role}/${aal}: billing RPC cannot bypass read-only or MFA`, async () => {
          await assert.rejects(
            as(role, aal, 'select public.create_bill($1::jsonb)', [
              JSON.stringify({
                id: 'denied',
                customerId: 'c1',
                date: '2026-01-01',
                items: [{ description: 'Ring' }],
              }),
            ]),
          );
          await assert.rejects(
            as(role, aal, 'select public.add_payment($1::jsonb)', [
              JSON.stringify({
                id: 'denied',
                customerId: 'c1',
                date: '2026-01-01',
                amount: 50,
                mode: 'Cash',
              }),
            ]),
          );
          await assert.rejects(as(role, aal, 'select public.erase_all_records()'));
        });
      }
    }
  }
  await t.test('anonymous cannot read any business table', async () => {
    for (const table of [
      'customers',
      'bills',
      'payments',
      'customer_openings',
      'shop_settings',
      'register_entries',
    ])
      await assert.rejects(as('anon', 'aal1', `select * from ${table}`));
  });
  await t.test(
    'Analytics and Billing cannot change settings, roles, openings or the register',
    async () => {
      for (const role of ['billing', 'analytics'] as const) {
        for (const [table, set] of [
          ['shop_settings', "data='{}'::jsonb"],
          ['profiles', "role='admin'"],
          ['customer_openings', 'amount=0'],
          ['register_entries', 'gold_credit=0'],
        ]) {
          assert.equal(
            (await as(role, 'aal2', `update ${table} set ${set} returning *`)).rows.length,
            0,
          );
        }
        await assert.rejects(as(role, 'aal2', "insert into customer_openings values('c2',100)"));
        await assert.rejects(
          as(
            role,
            'aal2',
            "insert into register_entries(id,entry_date,customer_id,gold_credit) values('no',current_date,'c1',1)",
          ),
        );
        assert.equal(
          (await as(role, 'aal2', "delete from bills where id='b1' returning *")).rows.length,
          0,
        );
      }
    },
  );
  await t.test('Analytics cannot insert or edit customers', async () => {
    await assert.rejects(
      as(
        'analytics',
        'aal2',
        "insert into customers(id,name,phone,created_by) values('no','No Entry','9999999999',$1)",
        [ids.analytics],
      ),
    );
    assert.equal(
      (await as('analytics', 'aal2', "update customers set name='no' returning *")).rows.length,
      0,
    );
  });
  await t.test(
    'Billing creates customers and the server sets sequential document numbers',
    async () => {
      assert.equal(
        (
          await as(
            'billing',
            'aal2',
            "insert into customers(id,name,phone,created_by) values('new','New Buyer','9999900002',$1) returning id",
            [ids.billing],
          )
        ).rows.length,
        1,
      );
      await assert.rejects(
        as(
          'billing',
          'aal2',
          "insert into customers(id,name,phone,created_by) values('spoof','Bad Buyer','9999900003',$1)",
          [ids.admin],
        ),
      );
      const payload = {
        id: 'b2',
        customerId: 'c1',
        date: '2026-01-01',
        items: [{ description: 'Ring' }],
      };
      const result = await as('billing', 'aal2', 'select public.create_bill($1::jsonb) as result', [
        JSON.stringify(payload),
      ]);
      const bill = (result.rows[0].result as any).bill;
      assert.match(bill.bill_no, /MSR\/25-26\/0001/);
      assert.equal(bill.created_by, ids.billing);
    },
  );
  await t.test('future dates and cross-customer receipts are rejected', async () => {
    await assert.rejects(
      as('billing', 'aal2', 'select public.create_bill($1::jsonb)', [
        JSON.stringify({ id: 'no', customerId: 'c1', date: '2999-01-01', items: [{}] }),
      ]),
    );
    await assert.rejects(
      as('billing', 'aal2', 'select public.add_payment($1::jsonb)', [
        JSON.stringify({
          id: 'no',
          customerId: 'c2',
          billId: 'b1',
          date: '2026-01-01',
          amount: 50,
          mode: 'Cash',
        }),
      ]),
    );
  });
  await t.test('Admin cannot change their own role; another admin is required', async () => {
    await assert.rejects(
      as('admin', 'aal2', "update profiles set role='billing' where user_id=$1", [ids.admin]),
    );
  });
  await t.test('permission is revoked immediately after role removal', async () => {
    await db.query("update profiles set role='pending' where user_id=$1", [ids.analytics]);
    assert.equal((await as('analytics', 'aal2', 'select * from bills')).rows.length, 0);
  });
  await t.test('Admin erase includes register entries and keeps shop settings', async () => {
    await as(
      'admin',
      'aal2',
      `do $$ begin
      perform public.erase_all_records();
      if exists(select 1 from customers) or exists(select 1 from bills) or exists(select 1 from payments)
        or exists(select 1 from customer_openings) or exists(select 1 from register_entries) then
        raise exception 'Erase left business records behind';
      end if;
      if not exists(select 1 from shop_settings) then raise exception 'Erase removed shop settings'; end if;
    end $$`,
    );
    assert.equal((await db.query('select count(*)::int as n from customers')).rows[0].n, 2); // rollback in fixture
    const settings = (await as('admin', 'aal2', 'select data from shop_settings')).rows[0]
      .data as any;
    assert.equal(settings.address, 'Gandhinagar, Hyderabad, Telangana');
    assert.equal(settings.stateCode, '36');
  });
  await db.close();
});
