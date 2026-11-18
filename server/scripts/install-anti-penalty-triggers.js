import pool, { query } from "../src/config/db.js";

export async function installAntiPenaltyTriggers() {
  try {
    // 1. Attendance Trigger: neutralizes any attempts to mark absent or set penalty/lock, and protects check_out from auto-checkout
    await query(`
      CREATE OR REPLACE FUNCTION prevent_unwanted_absent_penalty()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.penalty_status IS NOT NULL 
           OR NEW.is_admin_locked IS TRUE 
           OR NEW.penalty_reason IS NOT NULL 
           OR NEW.penalty_applied_at IS NOT NULL 
           OR NEW.penalized_by_task_id IS NOT NULL THEN
          NEW.is_admin_locked := FALSE;
          NEW.penalty_status := NULL;
          NEW.penalty_reason := NULL;
          NEW.penalty_applied_at := NULL;
          NEW.penalized_by_task_id := NULL;

          -- Protect check_out from accidental penalty auto-checkout
          IF TG_OP = 'UPDATE' THEN
            IF OLD.check_out IS NULL THEN
              NEW.check_out := NULL;
            END IF;
          ELSE
            IF NEW.check_in IS NOT NULL THEN
              NEW.check_out := NULL;
            END IF;
          END IF;
        END IF;

        IF (NEW.status = 'absent' AND (OLD.status = 'present' OR OLD.status = 'checked-in' OR NEW.check_in IS NOT NULL)) THEN
          NEW.status := 'present';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_prevent_unwanted_absent_penalty ON attendance;
      CREATE TRIGGER trg_prevent_unwanted_absent_penalty
      BEFORE INSERT OR UPDATE ON attendance
      FOR EACH ROW
      EXECUTE FUNCTION prevent_unwanted_absent_penalty();
    `);
    console.log("✅ [Trigger] trg_prevent_unwanted_absent_penalty created on attendance table.");

    // 2. Notifications Trigger: automatically silences any missed report/absent penalty notifications
    await query(`
      CREATE OR REPLACE FUNCTION prevent_absent_penalty_notifications()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.title ILIKE '%Absent%' 
           OR NEW.title ILIKE '%Missed%' 
           OR NEW.title ILIKE '%Penalty%' 
           OR NEW.title ILIKE '%Report Due%' 
           OR NEW.message ILIKE '%absent and reporting is locked%' THEN
          RETURN NULL; -- Discard notification row silently
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_prevent_absent_penalty_notifications ON notifications;
      CREATE TRIGGER trg_prevent_absent_penalty_notifications
      BEFORE INSERT ON notifications
      FOR EACH ROW
      EXECUTE FUNCTION prevent_absent_penalty_notifications();
    `);
    console.log("✅ [Trigger] trg_prevent_absent_penalty_notifications created on notifications table.");

    // 3. Tasks Trigger: prevents SLA penalty from being set
    await query(`
      CREATE OR REPLACE FUNCTION prevent_task_sla_penalty()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.sla_penalty_applied := FALSE;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_prevent_task_sla_penalty ON tasks;
      CREATE TRIGGER trg_prevent_task_sla_penalty
      BEFORE INSERT OR UPDATE ON tasks
      FOR EACH ROW
      EXECUTE FUNCTION prevent_task_sla_penalty();
    `);
    console.log("✅ [Trigger] trg_prevent_task_sla_penalty created on tasks table.");

    // 4. Clean up any accidental check_out on active records for today
    await query(`
      UPDATE attendance
      SET check_out = NULL,
          status = 'present',
          penalty_status = NULL,
          penalty_reason = NULL,
          penalty_applied_at = NULL,
          is_admin_locked = FALSE,
          updated_at = NOW()
      WHERE date >= CURRENT_DATE - INTERVAL '1 day'
        AND check_in IS NOT NULL
        AND (penalty_status IS NOT NULL OR penalty_reason IS NOT NULL OR penalty_applied_at IS NOT NULL OR is_admin_locked IS TRUE);
    `);
  } catch (err) {
    console.error("❌ Error installing triggers:", err);
  }
}

if (process.argv[1] && process.argv[1].endsWith("install-anti-penalty-triggers.js")) {
  installAntiPenaltyTriggers().then(() => {
    pool.end().catch(() => {});
    process.exit(0);
  });
}
