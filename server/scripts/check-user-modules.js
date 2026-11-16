import { query } from "../src/config/db.js";

async function run() {
  const u = await query(`
    SELECT u.id, u.name, u.email, u.role, u.company_id, c.name as comp_name, c.modules 
    FROM users u 
    LEFT JOIN companies c ON u.company_id = c.id 
    WHERE u.name ILIKE '%Dhamodharan%'
  `);
  console.log("User details:", u.rows);

  const admins = await query(`
    SELECT id, name, email, role, company_id 
    FROM users 
    WHERE role IN ('admin', 'superadmin') AND company_id = $1
  `, [u.rows[0]?.company_id]);
  console.log("Admins of this company:", admins.rows);

  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });

