// End-to-end tests against the REAL local Auth, PostgREST and PostgreSQL services.
// Disposable users/rows are prefixed and removed; the shop's own rows are never erased.
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { assertLocal, readLocalEnv, testAccounts } from './local-supabase.mjs';

const env = readLocalEnv();
assertLocal(env);
const sql = postgres(env.SUPABASE_DB_URL, { max: 1, onnotice: () => {} });
const authOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const privileged = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, authOptions);
const client = () => createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, authOptions);
const prefix = `_test_${Date.now()}_`;
const users = [];
const clients = [];
let passed = 0;
const check = (label) => {
  passed++;
  console.log(`PASS ${label}`);
};

function totp(secret, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.toUpperCase().replace(/=+$/, ''))
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((x) => parseInt(x, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function login(role) {
  const email = `${prefix}${role}@msr.local`;
  const password = `TestOnly!${randomUUID()}`;
  const created = await privileged.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  const user = created.data.user;
  users.push(user.id);
  await sql`update profiles set role=${role} where user_id=${user.id}`;
  const app = client();
  clients.push(app);
  const invalid = await app.auth.signInWithPassword({ email, password: 'wrong-password' });
  assert.ok(invalid.error);
  check(`${role}: wrong password rejected`);
  assert.ifError((await app.auth.signInWithPassword({ email, password })).error);
  for (const table of ['customers', 'bills', 'payments', 'register_entries']) {
    const result = await app.from(table).select('id');
    assert.ifError(result.error);
    assert.deepEqual(result.data, []);
  }
  check(`${role}: password alone reveals no business data`);
  const enrolled = await app.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Disposable test authenticator',
  });
  assert.ifError(enrolled.error);
  const { id: factorId, totp: factor } = enrolled.data;
  const expired = await app.auth.mfa.challengeAndVerify({
    factorId,
    code: totp(factor.secret, Date.now() - 300000),
  });
  assert.ok(expired.error);
  check(`${role}: expired MFA code rejected`);
  const verified = await app.auth.mfa.challengeAndVerify({ factorId, code: totp(factor.secret) });
  assert.ifError(verified.error);
  assert.equal((await app.auth.mfa.getAuthenticatorAssuranceLevel()).data.currentLevel, 'aal2');
  check(`${role}: real TOTP enrolment and verification succeed`);
  return { app, user };
}

try {
  const signUp = await client().auth.signUp({
    email: `${prefix}signup@msr.local`,
    password: `TestOnly!${randomUUID()}`,
  });
  assert.ok(signUp.error);
  check('Public registration is disabled while email login remains enabled');
  // Confirm the documented dummy usernames really exist in local Supabase Auth.
  for (const account of testAccounts) {
    const app = client();
    clients.push(app);
    assert.ifError(
      (await app.auth.signInWithPassword({ email: account.email, password: account.password }))
        .error,
    );
    await app.auth.signOut();
    check(`dummy account ${account.username} can sign in`);
  }
  const admin = await login('admin');
  const billing = await login('billing');
  const analytics = await login('analytics');
  const pending = await login('pending');

  const customerId = `${prefix}customer`;
  assert.ifError(
    (
      await billing.app
        .from('customers')
        .insert({
          id: customerId,
          name: 'Test Customer',
          phone: '9999900000',
          city: 'Hyderabad',
          created_by: billing.user.id,
        })
    ).error,
  );
  check('Billing creates a customer');
  const spoof = await billing.app
    .from('customers')
    .insert({
      id: `${prefix}spoof`,
      name: 'Spoof Customer',
      phone: '9999900000',
      created_by: admin.user.id,
    });
  assert.ok(spoof.error);
  check('Billing cannot forge the creator');
  await sql`insert into customer_openings(customer_id,amount) values(${customerId}, 1000)`;
  await sql`insert into register_entries(id,entry_date,customer_id,gold_credit) values(${prefix + 'reg'},current_date,${customerId},5)`;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const billPayload = (id) => ({
    id,
    customerId,
    date: today,
    items: [
      {
        id: 'i1',
        description: 'Test ring',
        category: 'Ring',
        purity: '22K',
        pieces: 1,
        grossWeight: 2,
        netWeight: 2,
        rate: 100,
        makingType: 'percent',
        makingValue: 10,
        stoneCharges: 0,
      },
    ],
    discount: 0,
    gstPercent: 3,
  });
  const made = await billing.app.rpc('create_bill', {
    p_bill: billPayload(prefix + 'bill'),
    p_payments: [{ id: prefix + 'receipt', date: today, amount: 50, mode: 'Cash' }],
  });
  assert.ifError(made.error);
  assert.equal(made.data.bill.created_by, billing.user.id);
  assert.equal(made.data.payments.length, 1);
  check('Billing saves a bill and receipt atomically');

  const invalidId = prefix + 'rollback';
  const invalid = await billing.app.rpc('create_bill', {
    p_bill: billPayload(invalidId),
    p_payments: [{ id: prefix + 'invalid-receipt', date: today, amount: 10, mode: 'Invalid mode' }],
  });
  assert.ok(invalid.error);
  assert.deepEqual((await admin.app.from('bills').select('id').eq('id', invalidId)).data, []);
  check('An invalid receipt rolls back the whole bill');

  const signOutApp = client();
  clients.push(signOutApp);
  assert.ifError(
    (
      await signOutApp.auth.signInWithPassword({
        email: testAccounts[0].email,
        password: testAccounts[0].password,
      })
    ).error,
  );
  assert.ifError((await signOutApp.auth.signOut()).error);
  assert.equal((await signOutApp.auth.getSession()).data.session, null);
  const signedOut = await signOutApp.from('customers').select('id');
  assert.ok(signedOut.error || signedOut.data.length === 0);
  check('Signing out removes access to customer records');

  const parallel = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      billing.app.rpc('create_bill', { p_bill: billPayload(prefix + 'parallel' + i) }),
    ),
  );
  for (const r of parallel) assert.ifError(r.error);
  assert.equal(new Set(parallel.map((r) => r.data.bill.bill_no)).size, 6);
  check('Concurrent billing assigns six distinct invoice numbers');
  for (const table of ['customer_openings', 'register_entries']) {
    assert.deepEqual((await billing.app.from(table).select('*')).data, []);
    assert.ok((await analytics.app.from(table).select('*')).data.length > 0);
  }
  check('Billing cannot read balances; Analytics can');

  for (const app of [analytics.app, pending.app]) {
    assert.ok((await app.rpc('create_bill', { p_bill: billPayload(prefix + randomUUID()) })).error);
    assert.ok(
      (
        await app.rpc('add_payment', {
          p_payment: {
            id: prefix + randomUUID(),
            customerId,
            date: today,
            amount: 10,
            mode: 'Cash',
          },
        })
      ).error,
    );
    assert.ok((await app.rpc('erase_all_records')).error);
  }
  check('Analytics and pending users cannot call write RPCs');
  for (const table of ['customers', 'bills', 'payments', 'register_entries']) {
    assert.ifError((await analytics.app.from(table).select('*')).error);
    assert.deepEqual(
      (
        await analytics.app
          .from(table)
          .delete()
          .like('id', prefix + '%')
          .select('id')
      ).data,
      [],
    );
  }
  check('Analytics can read reports source data but cannot delete it');
  assert.ok(
    (
      await analytics.app
        .from('customers')
        .insert({
          id: prefix + 'bad',
          name: 'Bad Insert',
          phone: '9999900000',
          created_by: analytics.user.id,
        })
    ).error,
  );
  assert.deepEqual(
    (await analytics.app.from('shop_settings').update({ data: {} }).eq('id', 1).select('id')).data,
    [],
  );
  assert.deepEqual(
    (
      await analytics.app
        .from('profiles')
        .update({ role: 'admin' })
        .eq('user_id', analytics.user.id)
        .select('user_id')
    ).data,
    [],
  );
  check('Analytics cannot create customers, change settings or promote itself');
  assert.ok(
    (await admin.app.from('profiles').update({ role: 'billing' }).eq('user_id', admin.user.id))
      .error,
  );
  check('Admin cannot accidentally demote itself');
  const settings = await admin.app.from('shop_settings').select('data').eq('id', 1).single();
  assert.equal(settings.data.data.address, 'Gandhinagar, Hyderabad, Telangana');
  check('Hyderabad address is stored in the real database');

  await sql`update bills set created_at=now()-interval '3 days' where id=${prefix + 'bill'}`;
  assert.deepEqual(
    (
      await billing.app
        .from('bills')
        .select('id')
        .eq('id', prefix + 'bill')
    ).data,
    [],
  );
  check('Billing cannot reopen work outside its recent-entry window');
  await sql`update profiles set role='pending' where user_id=${analytics.user.id}`;
  assert.deepEqual((await analytics.app.from('bills').select('id')).data, []);
  check('Role revocation takes effect without waiting for token expiry');
  assert.deepEqual((await pending.app.from('customers').select('id')).data, []);
  const anon = await client().from('customers').select('id');
  assert.ok(anon.error || anon.data.length === 0);
  check('Anonymous and pending visitors see no customers');
  console.log(`\n${passed} real Supabase checks passed.`);
} finally {
  // Only this run's disposable fixtures are removed.
  await sql`delete from payments where id like ${prefix + '%'}`;
  await sql`delete from bills where id like ${prefix + '%'}`;
  await sql`delete from register_entries where id like ${prefix + '%'}`;
  await sql`delete from customer_openings where customer_id like ${prefix + '%'}`;
  await sql`delete from customers where id like ${prefix + '%'}`;
  for (const app of clients) await app.auth.signOut();
  for (const id of users) await privileged.auth.admin.deleteUser(id);
  await sql.end();
}
