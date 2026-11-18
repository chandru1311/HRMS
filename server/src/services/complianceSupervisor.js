import { query } from "../config/db.js";
import { sendNotificationOnce } from "./notificationService.js";

/**
 * Compliance Supervisor Service
 * -------------------------------------------------------------
 * Automatically enforces:
 * 1. 1-Hour Task View / Acknowledge SLA -> Auto-marks attendance as Absent (locked)
 * 2. 1-Hour Progress Report Reminder -> Sends notification to employee
 * 3. 2-Hour Continuous Hourly Reporting SLA -> Auto-marks attendance as Absent (locked)
 */

export const getCompanyTimezone = async (companyId) => {
  if (!companyId) return "Asia/Kolkata";
  try {
    const res = await query("SELECT settings FROM companies WHERE id = $1", [companyId]);
    const settings = res.rows[0]?.settings;
    if (settings && typeof settings === "object" && settings.timezone) {
      return settings.timezone;
    }
    return "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
};

export const getLocalDateInTz = (timeZone = "Asia/Kolkata") => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  } catch {
    return new Date().toISOString().split("T")[0];
  }
};

let isCheckingCompliance = false;

export const checkComplianceNow = async (io = null, targetCompanyId = null) => {
  let attempts = 0;
  while (isCheckingCompliance && attempts < 30) {
    await new Promise(r => setTimeout(r, 200));
    attempts++;
  }
  isCheckingCompliance = true;
  try {
    const taskPenalties = await runTaskUnseenComplianceCheck(io, targetCompanyId);
    const { remindersCount, penaltyCount } = await runHourlyReportingComplianceCheck(io, targetCompanyId);
    return { taskPenalties, remindersCount, penaltyCount };
  } finally {
    isCheckingCompliance = false;
  }
};

/**
 * 1. Check for tasks assigned to employees not viewed/acknowledged within 10 minutes
 */
export const runTaskUnseenComplianceCheck = async (io = null, targetCompanyId = null) => {
  try {
    let sql = `
      SELECT t.id, t.title, t.company_id, t.assigned_to, t.created_at, t.assigned_at,
             u.name as employee_name, u.email as employee_email
      FROM tasks t
      JOIN users u ON t.assigned_to = u.id
      WHERE t.status NOT IN ('completed', 'cancelled', 'suspended')
        AND t.assigned_to IS NOT NULL
        AND t.viewed_at IS NULL
        AND (t.sla_penalty_applied IS FALSE OR t.sla_penalty_applied IS NULL)
        AND COALESCE(t.assigned_at, t.created_at) <= (NOW() - INTERVAL '10 minutes')
    `;
    const params = [];
    if (targetCompanyId) {
      params.push(targetCompanyId);
      sql += ` AND t.company_id = $${params.length}`;
    }
    sql += ` ORDER BY COALESCE(t.assigned_at, t.created_at) DESC LIMIT 50`;

    const res = await query(sql, params);
    const violations = res.rows;
    if (violations.length === 0) return 0;

    console.log(`⏱️ [Compliance] Found ${violations.length} task(s) unviewed for > 10 minutes. Applying penalties...`);

    for (const task of violations) {
      // 1. Mark task penalty applied immediately to prevent duplicate runs
      await query(
        `UPDATE tasks SET sla_penalty_applied = TRUE, updated_at = NOW() WHERE id = $1`,
        [task.id]
      );

      const tz = await getCompanyTimezone(task.company_id);
      const today = getLocalDateInTz(tz);
      const penaltyReason = `Task "${task.title}" was not opened or acknowledged within 10 minutes of assignment.`;

      // 2. Check if employee already has an attendance record today
      const attRes = await query(
        `SELECT id, status, is_admin_locked, penalty_status FROM attendance WHERE user_id = $1 AND date = $2 LIMIT 1`,
        [task.assigned_to, today]
      );

      let attId = null;
      if (attRes.rows.length > 0) {
        attId = attRes.rows[0].id;
        // Do not overwrite if already penalized under unseen_task_penalty
        await query(
          `UPDATE attendance
           SET status = 'absent',
               penalty_status = 'unseen_task_penalty',
               is_admin_locked = TRUE,
               penalty_applied_at = NOW(),
               penalty_reason = $1,
               penalized_by_task_id = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [penaltyReason, task.id, attId]
        );
      } else {
        attId = `${task.assigned_to}_${today}`;
        await query(
          `INSERT INTO attendance (
            id, user_id, company_id, date, status, penalty_status,
            is_admin_locked, penalty_applied_at, penalty_reason, penalized_by_task_id,
            created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, 'absent', 'unseen_task_penalty', TRUE, NOW(), $5, $6, NOW(), NOW())
          ON CONFLICT (id) DO UPDATE SET
            status = 'absent',
            penalty_status = 'unseen_task_penalty',
            is_admin_locked = TRUE,
            penalty_applied_at = NOW(),
            penalty_reason = EXCLUDED.penalty_reason,
            penalized_by_task_id = EXCLUDED.penalized_by_task_id,
            updated_at = NOW()`,
          [attId, task.assigned_to, task.company_id, today, penaltyReason, task.id]
        );
      }

      // 3. Send Notification to Employee (guaranteed exactly 1 notification)
      await sendNotificationOnce({
        userId: task.assigned_to,
        title: "Attendance Marked Absent (Task Unviewed SLA)",
        message: `You did not view or acknowledge task "${task.title}" within 10 minutes of assignment. Your attendance has been marked Absent and check-in is locked for today. Contact your Admin to resolve.`,
        type: "error",
        link: "/tasks",
        io,
        activityType: "absent_penalty",
        entityId: task.id
      });

      // 4. Send Notification to Admins of this company (guaranteed exactly 1 alert per employee absent)
      if (task.company_id) {
        const adminsRes = await query(
          `SELECT id FROM users WHERE company_id = $1 AND role IN ('admin', 'superadmin')`,
          [task.company_id]
        );

        for (const admin of adminsRes.rows) {
          await sendNotificationOnce({
            userId: admin.id,
            title: "Employee Marked Absent: Task SLA Breach",
            message: `${task.employee_name || "Employee"} did not view task "${task.title}" within 10 minutes. Attendance automatically marked Absent.`,
            type: "warning",
            link: "/admin",
            io,
            activityType: "admin_absent_alert",
            entityId: `${task.assigned_to}_${task.id}`
          });
        }
      }

      // 5. Emit real-time alerts via Socket.IO
      if (io) {
        const payload = {
          attendanceId: attId,
          userId: task.assigned_to,
          companyId: task.company_id,
          employeeName: task.employee_name,
          penaltyType: "unseen_task_penalty",
          penaltyReason,
          taskId: task.id,
          taskTitle: task.title
        };
        io.to(`user_${task.assigned_to}`).emit("attendance_penalty_applied", payload);
        if (task.company_id) io.to(`company_${task.company_id}`).emit("attendance_penalty_applied", payload);
        io.emit("attendance_penalty_applied", payload);
      }
    }

    return violations.length;
  } catch (err) {
    console.error("❌ [ComplianceSupervisor] runTaskUnseenComplianceCheck error:", err);
    return 0;
  }
};

/**
 * 2. Check for checked-in employees and active task assignees for:
 *    - 5-minute progress report reminder (every 5 minutes)
 *    - 10-minute missed report penalty -> Auto-marks attendance as Absent (locked)
 */
export const runHourlyReportingComplianceCheck = async (io = null, targetCompanyId = null) => {
  try {
    let penaltyCount = 0;
    let remindersCount = 0;
    const penalizedUsers = new Set();
    const remindedUsers = new Set();

    // 1. Check employees with active assigned tasks
    let taskSql = `
      SELECT t.id as task_id, t.title as task_title, t.company_id, t.assigned_to, t.viewed_at, t.assigned_at, t.created_at, t.last_reported_at, t.deadline, t.metadata, t.sla_penalty_applied,
             u.name as employee_name, u.email as employee_email,
             c.settings as company_settings
      FROM tasks t
      JOIN users u ON t.assigned_to = u.id
      LEFT JOIN companies c ON t.company_id = c.id
      WHERE t.status NOT IN ('completed', 'cancelled', 'suspended')
        AND t.assigned_to IS NOT NULL
        AND (t.sla_penalty_applied IS FALSE OR t.sla_penalty_applied IS NULL)
    `;
    const taskParams = [];
    if (targetCompanyId) {
      taskParams.push(targetCompanyId);
      taskSql += ` AND t.company_id = $${taskParams.length}`;
    }

    const activeTasksRes = await query(taskSql, taskParams);

    for (const task of activeTasksRes.rows) {
      const tz = await getCompanyTimezone(task.company_id);
      const today = getLocalDateInTz(tz);

      // Find latest report for this employee & task today (isolated strictly per task)
      const repRes = await query(
        `SELECT created_at FROM hourly_reports 
         WHERE user_id = $1 AND task_id = $2 AND report_date = $3
         ORDER BY created_at DESC LIMIT 1`,
        [task.assigned_to, task.task_id, today]
      );

      // If task deadline is already passed and has expired, reporting is locked on deadline grounds
      const rawMeta = task.metadata;
      const meta = (rawMeta && typeof rawMeta === 'object') ? rawMeta : (typeof rawMeta === 'string' ? JSON.parse(rawMeta || '{}') : {});
      if (meta.deadlineNotified || task.deadline_notified) {
        continue;
      }
      const candidateDeadlines = [
        task.deadline ? new Date(task.deadline).getTime() : 0,
        meta.deadlineTimestamp ? new Date(meta.deadlineTimestamp).getTime() : 0
      ].filter(ts => ts > 0 && !isNaN(ts));
      const exactDeadline = candidateDeadlines.length > 0 ? new Date(Math.max(...candidateDeadlines)) : null;
      if (exactDeadline && !isNaN(exactDeadline.getTime())) {
        if (Date.now() > exactDeadline.getTime()) {
          // Task deadline has completed; mark metadata so it never notifies again
          const updatedMeta = { ...meta, deadlineNotified: true, deadlineNotifiedAt: new Date().toISOString() };
          await query(
            `UPDATE tasks SET metadata = $1, updated_at = NOW() WHERE id = $2`,
            [JSON.stringify(updatedMeta), task.task_id]
          ).catch(() => {});

          // Send exactly one notification and skip hourly report penalties
          await sendNotificationOnce({
            userId: task.assigned_to,
            title: `Task Deadline Completed: ${task.task_title}`,
            message: `The deadline for task "${task.task_title}" has completed. Action on this task is concluded.`,
            type: "warning",
            link: "/task-management",
            io,
            activityType: "task_deadline_completed",
            entityId: task.task_id,
            taskTitle: task.task_title
          });
          continue;
        }
      }

      const repTime = repRes.rows.length > 0
        ? new Date(repRes.rows[0].created_at).getTime()
        : 0;
      const lastReportedTime = task.last_reported_at
        ? new Date(task.last_reported_at).getTime()
        : 0;
      const unlockTime = meta.unlockedAt
        ? new Date(meta.unlockedAt).getTime()
        : 0;

      const latestReportMs = Math.max(repTime, lastReportedTime, unlockTime);

      const baselineTime = latestReportMs > 0
        ? latestReportMs
        : new Date(task.assigned_at || task.created_at).getTime();

      const elapsedMinutes = Math.floor((Date.now() - baselineTime) / (60 * 1000));

      // Rule 1: At most 1 progress reminder per task
      if (elapsedMinutes >= 5 && elapsedMinutes < 10 && !remindedUsers.has(task.assigned_to)) {
        const notifResult = await sendNotificationOnce({
          userId: task.assigned_to,
          title: `Task Progress Report Due (5m): ${task.task_title}`,
          message: `5 minutes have passed since your last update on task "${task.task_title}". Please submit your progress report. If you do not report within 10 minutes, your attendance will be marked Absent.`,
          type: "warning",
          link: "/task-management",
          io,
          activityType: "report_reminder",
          entityId: task.task_id,
          taskTitle: task.task_title
        });

        if (notifResult && !notifResult.duplicate) {
          remindersCount++;
        }
        remindedUsers.add(task.assigned_to);
      }

      // Rule 2: 10-Minute Missing Report Violation (>= 10 minutes) -> Mark Absent & Lock Task
      if (elapsedMinutes >= 10) {
        // 1. Immediately apply SLA penalty and block the task itself
        await query(
          `UPDATE tasks SET sla_penalty_applied = TRUE, updated_at = NOW() WHERE id = $1`,
          [task.task_id]
        ).catch(() => {});

        if (io) {
          io.to(`user_${task.assigned_to}`).emit("task_updated", { id: task.task_id, sla_penalty_applied: true });
          io.emit("task_updated", { id: task.task_id, sla_penalty_applied: true });
        }

        // 2. Mark attendance as Absent and lock the record
        const attRes = await query(
          `SELECT id, status, is_admin_locked, penalty_status FROM attendance WHERE user_id = $1 AND date = $2 LIMIT 1`,
          [task.assigned_to, today]
        );

        let attRecord = attRes.rows[0];
        const penaltyReason = `Missed required progress report on task "${task.task_title}" for > 10 minutes (exceeded 10-minute limit).`;
        let attId = attRecord?.id;

        if (attRecord) {
          if (attRecord.status !== "absent" || !attRecord.is_admin_locked) {
            penaltyCount++;
            await query(
              `UPDATE attendance
               SET status = 'absent',
                   penalty_status = COALESCE(penalty_status, 'missed_hourly_report_penalty'),
                   is_admin_locked = TRUE,
                   penalty_applied_at = NOW(),
                   penalty_reason = COALESCE(penalty_reason, $1),
                   penalized_by_task_id = COALESCE(penalized_by_task_id, $2),
                   updated_at = NOW()
               WHERE id = $3`,
              [penaltyReason, task.task_id, attId]
            );
          }
        } else {
          penaltyCount++;
          attId = "att_" + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
          await query(
            `INSERT INTO attendance (
              id, user_id, company_id, date, status, check_out, penalty_status,
              is_admin_locked, penalty_applied_at, penalty_reason, penalized_by_task_id,
              created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, 'absent', NOW(), 'missed_hourly_report_penalty', TRUE, NOW(), $5, $6, NOW(), NOW())`,
            [attId, task.assigned_to, task.company_id, today, penaltyReason, task.task_id]
          );
        }

        if (!penalizedUsers.has(task.assigned_to)) {
          penalizedUsers.add(task.assigned_to);

          // Exactly ONE notification to employee for marking absent
          await sendNotificationOnce({
            userId: task.assigned_to,
            title: "Attendance Marked Absent (Missed Task Report)",
            message: `You have not reported to the admin on task "${task.task_title}" for over 10 minutes. Your attendance has been marked Absent and task actions locked. Contact your Admin to resolve.`,
            type: "error",
            link: "/task-management",
            io,
            activityType: "absent_penalty",
            entityId: task.task_id
          });

          // Exactly ONE notification to Company Admins per employee absent
          if (task.company_id) {
            const adminsRes = await query(
              `SELECT id FROM users WHERE company_id = $1 AND role IN ('admin', 'superadmin')`,
              [task.company_id]
            );

            for (const admin of adminsRes.rows) {
              await sendNotificationOnce({
                userId: admin.id,
                title: "Missed Task Report: Attendance Marked Absent",
                message: `${task.employee_name || "Employee"} did not report on task "${task.task_title}" within 10 minutes. Attendance automatically marked Absent and task locked.`,
                type: "warning",
                link: "/task-management",
                io,
                activityType: "admin_absent_alert",
                entityId: `${task.assigned_to}_${task.task_id}`
              });
            }
          }

          // Socket.IO Alert
          if (io) {
            const payload = {
              attendanceId: attId,
              userId: task.assigned_to,
              companyId: task.company_id,
              employeeName: task.employee_name,
              penaltyType: "missed_hourly_report_penalty",
              penaltyReason,
              taskId: task.task_id,
              taskTitle: task.task_title,
              elapsedMinutes
            };
            io.to(`user_${task.assigned_to}`).emit("attendance_penalty_applied", payload);
            if (task.company_id) io.to(`company_${task.company_id}`).emit("attendance_penalty_applied", payload);
            io.emit("attendance_penalty_applied", payload);
          }
        }
      }
    }

    // 2. Also check general active check-ins (for test suite or employees without explicit tasks)
    let sql = `
      SELECT a.id as attendance_id, a.user_id, a.company_id, a.check_in, a.date, a.updated_at,
             u.name as employee_name, u.email as employee_email,
             c.settings as company_settings
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN companies c ON a.company_id = c.id
      WHERE a.date >= (CURRENT_DATE - INTERVAL '1 day')
        AND a.check_in IS NOT NULL
        AND a.check_out IS NULL
        AND a.status = 'present'
        AND (a.is_admin_locked IS FALSE OR a.is_admin_locked IS NULL)
    `;
    const params = [];
    if (targetCompanyId) {
      params.push(targetCompanyId);
      sql += ` AND a.company_id = $${params.length}`;
    }

    const activeAtt = await query(sql, params);

    for (const record of activeAtt.rows) {
      if (penalizedUsers.has(record.user_id)) continue;

      // CRITICAL: An employee without active tasks must NEVER be penalized or marked absent for missed progress reports!
      // Progress reporting and absent penalties only apply when an employee has active tasks assigned to them.
      const activeTasksCheck = await query(
        `SELECT id FROM tasks 
         WHERE assigned_to = $1 
           AND status NOT IN ('completed', 'cancelled', 'suspended')
         LIMIT 1`,
        [record.user_id]
      );

      if (activeTasksCheck.rows.length === 0) {
        // Employee has no active tasks -> No progress report requirement -> Skip completely!
        continue;
      }

      const today = record.date ? new Date(record.date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];

      // Find latest hourly report for this employee today
      const repRes = await query(
        `SELECT created_at FROM hourly_reports 
         WHERE user_id = $1 AND report_date = $2
         ORDER BY created_at DESC LIMIT 1`,
        [record.user_id, today]
      );

      // Check if user has an active task with a recent report or extension:
      const recentTaskRes = await query(
        `SELECT MAX(last_reported_at) as max_reported FROM tasks WHERE assigned_to = $1 AND status NOT IN ('completed', 'cancelled', 'suspended')`,
        [record.user_id]
      );
      const taskReportedMs = recentTaskRes.rows[0]?.max_reported ? new Date(recentTaskRes.rows[0].max_reported).getTime() : 0;

      const latestTime = Math.max(
        repRes.rows.length > 0 ? new Date(repRes.rows[0].created_at).getTime() : 0,
        taskReportedMs,
        new Date(record.check_in).getTime()
      );

      const elapsedMinutes = Math.floor((Date.now() - latestTime) / (60 * 1000));

      // Rule 1: Hourly progress report reminder (>= 60 and < 120 minutes) - at most 1 reminder per day
      if (elapsedMinutes >= 60 && elapsedMinutes < 120 && !remindedUsers.has(record.user_id)) {
        const notifResult = await sendNotificationOnce({
          userId: record.user_id,
          title: "Progress Report Due",
          message: `An hour has passed since your last update. Please submit your progress report to maintain your attendance standing.`,
          type: "warning",
          link: "/task-management",
          io,
          activityType: "report_reminder",
          entityId: "hourly_general"
        });

        if (notifResult && !notifResult.duplicate) {
          remindersCount++;
        }
        remindedUsers.add(record.user_id);
      }

      // Rule 2: Missed General Hourly Report Violation (>= 120 minutes)
      if (elapsedMinutes >= 120) {
        penaltyCount++;
        penalizedUsers.add(record.user_id);
        const penaltyReason = `Missed required progress report for ${elapsedMinutes} minutes (exceeded 2-hour limit).`;

        // Update attendance to Absent and Lock reporting (do NOT auto check out)
        await query(
          `UPDATE attendance
           SET status = 'absent',
               penalty_status = 'missed_hourly_report_penalty',
               is_admin_locked = TRUE,
               penalty_applied_at = NOW(),
               penalty_reason = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [penaltyReason, record.attendance_id]
        );

        // Exactly ONE notification to Employee for marking absent
        await sendNotificationOnce({
          userId: record.user_id,
          title: "Attendance Marked Absent (Missed Progress Reports)",
          message: `You have missed submitting progress reports for over 10 minutes. Your attendance is marked Absent and reporting is locked. Contact your Admin to resolve.`,
          type: "error",
          link: "/task-management",
          io,
          activityType: "absent_penalty",
          entityId: record.attendance_id
        });

        // Exactly ONE notification to Company Admins per employee absent
        if (record.company_id) {
          const adminsRes = await query(
            `SELECT id FROM users WHERE company_id = $1 AND role IN ('admin', 'superadmin')`,
            [record.company_id]
          );

          for (const admin of adminsRes.rows) {
            await sendNotificationOnce({
              userId: admin.id,
              title: "Missed Report Alert: Attendance Marked Absent",
              message: `${record.employee_name || "Employee"} has not submitted progress reports for > 10 minutes. Attendance automatically marked Absent.`,
              type: "warning",
              link: "/task-management",
              io,
              activityType: "admin_absent_alert",
              entityId: `${record.user_id}_hourly`
            });
          }
        }

        // Socket.IO Alert
        if (io) {
          const payload = {
            attendanceId: record.attendance_id,
            userId: record.user_id,
            companyId: record.company_id,
            employeeName: record.employee_name,
            penaltyType: "missed_hourly_report_penalty",
            penaltyReason,
            elapsedMinutes
          };
          io.to(`user_${record.user_id}`).emit("attendance_penalty_applied", payload);
          if (record.company_id) io.to(`company_${record.company_id}`).emit("attendance_penalty_applied", payload);
          io.emit("attendance_penalty_applied", payload);
        }
      }
    }

    return { remindersCount, penaltyCount };
  } catch (err) {
    console.error("❌ [ComplianceSupervisor] runHourlyReportingComplianceCheck error:", err);
    return { remindersCount: 0, penaltyCount: 0 };
  }
};

/**
 * Start the background compliance supervisor daemon
 */
export const startComplianceSupervisor = (io, intervalMs = 60000) => {
  console.log("🛡️ [ComplianceSupervisor] Task & Progress Reporting SLA Supervisor started (60s tick).");

  // Initial immediate check
  setTimeout(() => {
    checkComplianceNow(io).catch(() => {});
  }, 3000);

  // Periodic recurring check
  const intervalId = setInterval(() => {
    checkComplianceNow(io).catch(err => {
      console.error("❌ [ComplianceSupervisor] Tick error:", err);
    });
  }, intervalMs);

  return intervalId;
};
