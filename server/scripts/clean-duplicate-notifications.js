import { query } from "../src/config/db.js";

/**
 * Cleanup script to remove redundant duplicate notifications in the database,
 * ensuring each user only keeps 1 notification per distinct activity.
 */
export async function runCleanDuplicateNotifications() {
  try {
    // 1. Delete identical (user_id, title, message) notifications keeping only the most recent one
    const resIdentical = await query(`
      DELETE FROM notifications n1
      WHERE EXISTS (
        SELECT 1 FROM notifications n2
        WHERE n2.user_id = n1.user_id
          AND n2.title = n1.title
          AND n2.message = n1.message
          AND (n2.created_at > n1.created_at OR (n2.created_at = n1.created_at AND n2.id > n1.id))
      )
    `);

    // 2. Delete repetitive reminder notifications for the same user and task on the same day, keeping the latest
    const resReminders = await query(`
      DELETE FROM notifications n1
      WHERE (n1.title ILIKE '%Report Due%' OR n1.title ILIKE '%Hourly Report%')
        AND EXISTS (
          SELECT 1 FROM notifications n2
          WHERE n2.user_id = n1.user_id
            AND (n2.title ILIKE '%Report Due%' OR n2.title ILIKE '%Hourly Report%')
            AND DATE(n2.created_at) = DATE(n1.created_at)
            AND (n2.created_at > n1.created_at OR (n2.created_at = n1.created_at AND n2.id > n1.id))
        )
    `);

    // 3. Delete repetitive absent notifications for the same user on the same day, keeping the latest
    const resAbsent = await query(`
      DELETE FROM notifications n1
      WHERE (n1.title ILIKE 'Attendance Marked Absent%' OR n1.title ILIKE '%Marked Absent%')
        AND EXISTS (
          SELECT 1 FROM notifications n2
          WHERE n2.user_id = n1.user_id
            AND (n2.title ILIKE 'Attendance Marked Absent%' OR n2.title ILIKE '%Marked Absent%')
            AND DATE(n2.created_at) = DATE(n1.created_at)
            AND (n2.created_at > n1.created_at OR (n2.created_at = n1.created_at AND n2.id > n1.id))
        )
    `);

    // 4. Delete repetitive task deadline completed notifications for the same user and task title
    const resDeadline = await query(`
      DELETE FROM notifications n1
      WHERE (n1.title ILIKE 'Task Deadline Completed%' OR n1.title ILIKE '%Deadline Finished%')
        AND EXISTS (
          SELECT 1 FROM notifications n2
          WHERE n2.user_id = n1.user_id
            AND n2.title = n1.title
            AND (n2.created_at > n1.created_at OR (n2.created_at = n1.created_at AND n2.id > n1.id))
        )
    `);

    // 5. Delete repetitive task assignment notifications for the same user and task
    const resAssigned = await query(`
      DELETE FROM notifications n1
      WHERE (n1.title ILIKE 'Task Assigned%' OR n1.title ILIKE 'New Task%')
        AND EXISTS (
          SELECT 1 FROM notifications n2
          WHERE n2.user_id = n1.user_id
            AND n2.title = n1.title
            AND (n2.created_at > n1.created_at OR (n2.created_at = n1.created_at AND n2.id > n1.id))
        )
    `);

    const totalDeleted = (resIdentical.rowCount || 0) + (resReminders.rowCount || 0) + (resAbsent.rowCount || 0) + (resDeadline.rowCount || 0) + (resAssigned.rowCount || 0);
    console.log(`✅ [Notifications] Cleaned up duplicate notifications: ${totalDeleted} duplicates removed.`);
  } catch (err) {
    console.warn(`⚠️ [Notifications] Duplicate cleanup note: ${err.message}`);
  }
}

