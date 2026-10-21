import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatShortDate, formatMonth } from '../src/app/core/format';
import { monthLabels } from '../src/app/core/analytics';
import { normaliseRole, permissionsFor, homeForRole } from '../src/app/core/roles';
import { DEMO_ACCOUNTS, findDemoAccount } from '../src/app/core/demo-accounts';
import { defaultSettings, generateDemoData } from '../src/app/core/seed';
import { migrateShopProfile } from '../src/app/core/shop-profile';
import { billFromRow, billToRow } from '../src/app/core/cloud-mapping';

test('all date styles include the year, including activity dates and chart month labels', () => {
  for (const value of ['2025-12-31', '2026-01-01', '2028-02-29']) {
    for (const fn of [formatDate, formatShortDate])
      assert.match(fn(value), new RegExp(value.slice(0, 4)));
    assert.match(formatMonth(value.slice(0, 7)), new RegExp(value.slice(0, 4)));
  }
  const labels = monthLabels(['2025-12', '2026-01']);
  assert.match(labels.short[0], /2025/);
  assert.match(labels.short[1], /2026/);
  assert.equal(formatShortDate(undefined), '—');
});

test('Admin, Billing and Analytics have distinct permissions and safe legacy upgrades', () => {
  assert.deepEqual(permissionsFor('admin'), { manage: true, bill: true, analyse: true });
  assert.deepEqual(permissionsFor('billing'), { manage: false, bill: true, analyse: false });
  assert.deepEqual(permissionsFor('analytics'), { manage: false, bill: false, analyse: true });
  for (const role of [null, 'pending'] as const)
    assert.deepEqual(permissionsFor(role), { manage: false, bill: false, analyse: false });
  assert.equal(normaliseRole('owner'), 'admin');
  assert.equal(normaliseRole('staff'), 'billing');
  assert.equal(normaliseRole('superuser'), 'pending');
  assert.equal(homeForRole('analytics'), '/dashboard');
  assert.equal(homeForRole('billing'), '/counter');
});

test('dummy usernames and email aliases authenticate only with the correct password', () => {
  for (const account of DEMO_ACCOUNTS) {
    assert.equal(findDemoAccount(account.username, account.password)?.role, account.role);
    assert.equal(findDemoAccount(account.email, account.password)?.role, account.role);
    assert.equal(findDemoAccount(account.username, 'wrong-password'), undefined);
    assert.equal(
      findDemoAccount(account.username, DEMO_ACCOUNTS.find((a) => a !== account)!.password),
      undefined,
    );
  }
});

test('Hyderabad shop migration corrects placeholders without overwriting real details', () => {
  const settings = defaultSettings();
  assert.equal(settings.address, 'Gandhinagar, Hyderabad, Telangana');
  assert.equal(settings.stateCode, '36');
  assert.equal(settings.gstin, '');
  const migrated = migrateShopProfile({
    ...settings,
    address: '12, Sayyaji Rao Road, Mysuru, Karnataka 570001',
    gstin: '29ABCDE1234F1Z5',
    phone: '0821 242 0000',
  });
  assert.equal(migrated.address, settings.address);
  assert.equal(migrated.gstin, '');
  const real = {
    ...settings,
    address: '42 Gandhinagar, Hyderabad',
    phone: '9999900000',
    gstin: '36EXAMPLE0000A1Z1',
  };
  assert.deepEqual(migrateShopProfile(real), real);
  assert.equal(
    migrateShopProfile({ ...real, stateCode: undefined, gstin: '29EXAMPLE0000A1Z1' }).stateCode,
    '29',
  );
});

test('bill creator survives the database mapping used to restrict Billing history', () => {
  const bill = generateDemoData('2026-10-21').bills[0];
  const mapped = billFromRow(billToRow(bill, 'test-user-id'));
  assert.equal(mapped.createdBy, 'test-user-id');
  assert.equal(mapped.billNo, bill.billNo);
});
