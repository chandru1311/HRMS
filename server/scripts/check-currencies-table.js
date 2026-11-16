import { query } from "../src/config/db.js";

async function check() {
  const res = await query(`
    SELECT table_name, column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name IN ('currencies', 'exchange_rates', 'tax_rules')
    ORDER BY table_name, ordinal_position;
  `);
  console.log("Existing columns:", res.rows);
  process.exit(0);
}
check().catch(e => { console.error(e); process.exit(1); });

