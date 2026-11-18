import pool, { query } from "../src/config/db.js";

export async function runUnlockAllAccounts(io = null) {
  try {
    // 1. Unlock all locked/penalized attendance records
    const updateRes = await query(`
      UPDATE attendance
      SET status = 'present',
          penalty_status = NULL,
          penalty_reason = NULL,
          penalized_by_task_id = NULL,
          is_admin_locked = FALSE,
          check_out = NULL,
          updated_at = NOW()
      WHERE is_admin_locked IS TRUE 
         OR penalty_status IS NOT NULL 
         OR status = 'absent'
         OR penalty_reason IS NOT NULL
      RETURNING id, user_id, date, status, is_admin_locked
    `);
    console.log(`🔓 [Auto-Unlock] Unlocked ${updateRes.rows.length} attendance records.`);

    // 2. Also reset any sla_penalty_applied on tasks
    const taskRes = await query(`
      UPDATE tasks
      SET sla_penalty_applied = FALSE,
          updated_at = NOW()
      WHERE sla_penalty_applied IS TRUE
      RETURNING id, title, assigned_to
    `);
    console.log(`🔓 [Auto-Unlock] Reset SLA penalty on ${taskRes.rows.length} tasks.`);

    // 3. Delete all missed report / absent penalty notifications
    const delNotifs = await query(`
      DELETE FROM notifications
      WHERE title ILIKE '%Missed Progress%'
         OR title ILIKE '%Missed Report%'
         OR title ILIKE '%Missed Task Report%'
         OR title ILIKE 'Progress Report Due%'
         OR title ILIKE 'Attendance Marked Absent%'
         OR title ILIKE '%Penalty%'
      RETURNING id, user_id, title
    `);
    console.log(`🔓 [Auto-Unlock] Removed ${delNotifs.rows.length} penalty notifications.`);

    if (io) {
      io.emit("attendance_penalty_reverted", {
        isAttendanceLocked: false,
        is_admin_locked: false,
        status: "present"
      });
      io.emit("attendance_updated", {
        isAttendanceLocked: false,
        is_admin_locked: false,
        status: "present"
      });
    }
  } catch (err) {
    console.error("🔓 [Auto-Unlock] Error unlocking accounts:", err.message);
  }
}

if (process.argv[1] && process.argv[1].endsWith("unlock-all-accounts.js")) {
  runUnlockAllAccounts().then(() => {
    pool.end().catch(() => {});
    process.exit(0);
  }).catch(() => {
    pool.end().catch(() => {});
    process.exit(1);
  });
}
