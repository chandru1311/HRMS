import { query } from "../config/db.js";

/**
 * Sends a notification ensuring that for every activity, exactly ONE notification is delivered.
 * Enforces deduplication for:
 * 1. Task assignment (exactly 1 notification per assigned task per employee)
 * 2. Absent / SLA penalties (exactly 1 notification per absent event today per employee)
 * 3. Progress report reminders (at most 1 reminder per task/shift per employee)
 * 4. Admin alerts (exactly 1 alert per employee absent event to admin)
 * 5. General notifications (deduplicated against existing identical title/message)
 */
export const sendNotificationOnce = async ({
  userId,
  title,
  message,
  type = "info",
  link = "",
  io = null,
  activityType = null, // "task_assigned" | "task_deadline_completed" | "absent_penalty" | "report_reminder" | "admin_absent_alert" | "general"
  entityId = null,     // e.g. taskId, employeeId
  taskTitle = null,    // e.g. title of task for precise matching
  windowHours = 12
}) => {
  if (!userId || !title || !message) return null;

  try {
    let duplicateCheckQuery = "";
    let duplicateCheckParams = [];

    const lowerTitle = (title || "").toLowerCase();

    if (
      activityType === "task_assigned" || 
      lowerTitle.includes("new task") || 
      lowerTitle.includes("task assigned")
    ) {
      // Exactly ONE notification per task assignment
      const match = title.match(/(?:New Task|Task Assigned):\s*(.*)/i) || message.match(/assigned a new task:\s*"(.*?)"/i);
      const cleanTaskTitle = taskTitle || (match ? match[1].trim() : title.replace(/^New Task:\s*/i, "").trim());
      const taskPattern = cleanTaskTitle ? `%${cleanTaskTitle}%` : `%${title.substring(0, 20)}%`;

      duplicateCheckQuery = `
        SELECT id, title, message, created_at FROM notifications 
        WHERE user_id = $1 
          AND (
            title ILIKE 'New Task%' OR 
            title ILIKE '%Task Assigned%' OR 
            title ILIKE 'Task: %'
          )
          AND (message LIKE $2 OR title LIKE $2)
          AND created_at >= (NOW() - INTERVAL '24 hours')
        ORDER BY created_at DESC
        LIMIT 1
      `;
      duplicateCheckParams = [userId, taskPattern];

    } else if (
      activityType === "task_deadline_completed" ||
      lowerTitle.includes("deadline completed") ||
      lowerTitle.includes("deadline finished")
    ) {
      // Exactly ONE notification per completed deadline per task (forever)
      const match = title.match(/Deadline Completed:\s*(.*)/i) || message.match(/deadline for task "(.*?)"/i);
      const cleanTaskTitle = taskTitle || (match ? match[1].trim() : title.replace(/^Task Deadline Completed:\s*/i, "").trim());
      const taskPattern = cleanTaskTitle ? `%${cleanTaskTitle}%` : `%${title.substring(0, 20)}%`;

      duplicateCheckQuery = `
        SELECT id, title, message, created_at FROM notifications 
        WHERE user_id = $1 
          AND (
            title ILIKE '%Deadline Completed%' OR 
            title ILIKE '%Deadline Finished%'
          )
          AND (title LIKE $2 OR message LIKE $2)
        ORDER BY created_at DESC
        LIMIT 1
      `;
      duplicateCheckParams = [userId, taskPattern];

    } else if (
      activityType === "absent_penalty" || 
      lowerTitle.includes("marked absent")
    ) {
      // Exactly ONE notification per absent event today
      duplicateCheckQuery = `
        SELECT id, title, message, created_at FROM notifications 
        WHERE user_id = $1 
          AND (
            title ILIKE 'Attendance Marked Absent%' OR 
            title ILIKE '%Marked Absent%'
          )
          AND created_at >= (NOW() - INTERVAL '12 hours')
        ORDER BY created_at DESC
        LIMIT 1
      `;
      duplicateCheckParams = [userId];

    } else if (
      activityType === "report_reminder" || 
      lowerTitle.includes("report due") || 
      lowerTitle.includes("hourly report")
    ) {
      // At most ONE progress report reminder per task / shift
      const cleanEntity = entityId ? `%${entityId}%` : `%${message.substring(0, 25)}%`;
      duplicateCheckQuery = `
        SELECT id, title, message, created_at FROM notifications 
        WHERE user_id = $1 
          AND (
            title ILIKE '%Report Due%' OR 
            title ILIKE '%Hourly Report%'
          )
          AND (message LIKE $2 OR created_at >= (NOW() - INTERVAL '12 hours'))
        ORDER BY created_at DESC
        LIMIT 1
      `;
      duplicateCheckParams = [userId, cleanEntity];

    } else if (
      activityType === "admin_absent_alert" || 
      lowerTitle.includes("missed report alert") || 
      lowerTitle.includes("employee marked absent")
    ) {
      // Exactly ONE absent alert per employee to this admin today
      const empPattern = entityId ? `%${entityId}%` : `%${message.substring(0, 25)}%`;
      duplicateCheckQuery = `
        SELECT id, title, message, created_at FROM notifications 
        WHERE user_id = $1 
          AND (
            title ILIKE 'Employee Marked Absent%' OR 
            title ILIKE 'Missed Report Alert%' OR 
            title ILIKE 'Missed Task Report%'
          )
          AND (message LIKE $2 OR created_at >= (NOW() - INTERVAL '12 hours'))
        ORDER BY created_at DESC
        LIMIT 1
      `;
      duplicateCheckParams = [userId, empPattern];

    } else {
      // General Deduplication: Same title/message within deduplication window
      duplicateCheckQuery = `
        SELECT id, title, message, created_at FROM notifications 
        WHERE user_id = $1 
          AND (title = $2 OR message = $3)
          AND created_at >= (NOW() - INTERVAL '${Math.max(1, windowHours)} hours')
        ORDER BY created_at DESC
        LIMIT 1
      `;
      duplicateCheckParams = [userId, title, message];
    }

    if (duplicateCheckQuery) {
      const existing = await query(duplicateCheckQuery, duplicateCheckParams);
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        return {
          id: row.id,
          _id: row.id,
          userId,
          title: row.title,
          message: row.message,
          duplicate: true,
          created_at: row.created_at,
          createdAt: row.created_at
        };
      }
    }

    // Insert single new notification
    const id = "notif_" + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    const result = await query(
      `INSERT INTO notifications (id, user_id, title, message, type, read, link)
       VALUES ($1, $2, $3, $4, $5, FALSE, $6)
       RETURNING *`,
      [id, userId, title, message, type, link]
    );

    const row = result.rows[0];
    const formatted = {
      id: row.id,
      _id: row.id,
      userId: row.user_id,
      title: row.title,
      message: row.message,
      type: row.type,
      read: row.read,
      link: row.link,
      createdAt: row.created_at,
      created_at: row.created_at,
      timestamp: row.created_at
    };

    if (io) {
      io.emit(`notification_${userId}`, formatted);
    }

    return formatted;
  } catch (err) {
    console.error("sendNotificationOnce error:", err);
    return null;
  }
};

