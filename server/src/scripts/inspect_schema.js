import { query } from "../config/db.js";

async function run() {
  const alCols = await query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'audit_logs' 
    ORDER BY ordinal_position;
  `);
  console.log('AUDIT_LOGS COLUMNS:', alCols.rows.map(r => r.column_name));
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
