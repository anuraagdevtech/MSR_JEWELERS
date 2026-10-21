// Populate only an EMPTY local development database. No existing shop records are replaced.
import postgres from 'postgres';
import { assertLocal, readLocalEnv } from './local-supabase.mjs';
import { generateDemoData } from '../src/app/core/seed';
import {
  billToRow,
  customerToRow,
  paymentToRow,
  registerEntryToRow,
} from '../src/app/core/cloud-mapping';

const env = readLocalEnv();
assertLocal(env);
const sql = postgres(env.SUPABASE_DB_URL, { max: 1, onnotice: () => {} });
async function main() {
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(72846321)`;
      const [count] = await tx`select count(*)::int as n from public.customers`;
      if (count.n) {
        console.log('Sample data skipped: this local database already has customers.');
        return;
      }
      const [admin] =
        await tx`select user_id from public.profiles where email = 'admin@msr.local' and role = 'admin'`;
      if (!admin) throw new Error('Run npm run supabase:setup first.');
      const data = generateDemoData();
      await tx`insert into public.customers ${tx(data.customers.map((c) => customerToRow(c, admin.user_id)))}`;
      const openings = data.customers
        .filter((c) => c.openingBalance)
        .map((c) => ({ customer_id: c.id, amount: c.openingBalance }));
      if (openings.length) await tx`insert into public.customer_openings ${tx(openings)}`;
      const bills = data.bills.map((b) => ({
        ...billToRow(b, admin.user_id),
        items: tx.json(b.items),
      }));
      await tx`insert into public.bills ${tx(bills)}`;
      const payments = data.payments.map((p) => ({
        ...paymentToRow(p, admin.user_id),
        old_gold: p.oldGold ? tx.json(p.oldGold) : null,
      }));
      await tx`insert into public.payments ${tx(payments)}`;
      await tx`insert into public.register_entries ${tx(data.registerEntries.map((r) => registerEntryToRow(r, admin.user_id)))}`;
      await tx`update public.shop_settings set data = ${tx.json({ ...data.settings, sampleData: true })} where id = 1`;
      console.log(
        `Local sample book: ${data.customers.length} customers, ${data.bills.length} bills, ${data.payments.length} receipts, ${data.registerEntries.length} register entries.`,
      );
    });
  } finally {
    await sql.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
