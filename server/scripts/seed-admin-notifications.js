import pg from "pg";

const url = "postgresql://postgres:wbmoHIZoKMKVvFhmAHgDYLUdVhZCcTzq@kodama.proxy.rlwy.net:52896/railway";
const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log("Connected to Railway PostgreSQL");

  const admins = await client.query(
    "SELECT id, name, email, role, company_id FROM users WHERE company_id = 'comp-hxu9hzjl7' AND role IN ('admin', 'superadmin', 'manager')"
  );
  console.log("Company Admins found:", admins.rows.length);

  for (const admin of admins.rows) {
    const tasks = [
      {
        title: "Task Completed",
        message: "Dhamodharan completed the task \"lo\".",
        link: "/task-management",
        type: "task",
        created_at: new Date(Date.now() - 1000 * 60 * 15) // 15 mins ago
      },
      {
        title: "Task Completed",
        message: "Dhamodharan completed the task \"hi\".",
        link: "/task-management",
        type: "task",
        created_at: new Date(Date.now() - 1000 * 60 * 35) // 35 mins ago
      }
    ];

    for (const t of tasks) {
      const existing = await client.query(
        "SELECT id FROM notifications WHERE user_id = $1 AND title = $2 AND message = $3",
        [admin.id, t.title, t.message]
      );
      if (existing.rows.length === 0) {
        const id = "notif_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        await client.query(
          "INSERT INTO notifications (id, user_id, title, message, link, type, read, created_at) VALUES ($1, $2, $3, $4, $5, $6, false, $7)",
          [id, admin.id, t.title, t.message, t.link, t.type, t.created_at]
        );
        console.log(`Inserted notification for ${admin.name} (${admin.id}): ${t.message}`);
      } else {
        console.log(`Notification already exists for ${admin.name}: ${t.message}`);
      }
    }
  }

  // Print top 10 notifications for guru (usr_sqxp4q810mucinkug)
  const notifs = await client.query(
    "SELECT id, title, message, link, type, read, created_at FROM notifications WHERE user_id = 'usr_sqxp4q810mucinkug' ORDER BY created_at DESC LIMIT 10"
  );
  console.log("Guru's latest notifications:\n", notifs.rows);

  await client.end();
}

run().catch(console.error);
