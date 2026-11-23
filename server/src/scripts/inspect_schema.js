import { query } from "../config/db.js";

async function run() {
  const attCols = await query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'attendance'
    ORDER BY ordinal_position;
  `);
  console.log('ATTENDANCE COLUMNS:', attCols.rows);

  const compCols = await query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'companies'
    ORDER BY ordinal_position;
  `);
  console.log('COMPANIES COLUMNS:', compCols.rows.map(r => r.column_name));

  const sampleAtt = await query(`
    SELECT id, user_id, check_in, location, metadata, biometric_verified
    FROM attendance
    ORDER BY check_in DESC NULLS LAST
    LIMIT 3;
  `);
  console.log('SAMPLE ATTENDANCE:', sampleAtt.rows);

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
