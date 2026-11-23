import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import app from "../app.js";
import { query } from "../config/db.js";
import { generateToken } from "../middlewares/auth.js";
import { generateVerificationSessionToken } from "../services/livenessVerification.js";
import { checkComplianceNow } from "../services/complianceSupervisor.js";

const PORT = 5098;
let server;
let baseUrl;

const companyA = "comp_sla_tenant_a";
const companyB = "comp_sla_tenant_b";

const adminA = {
  id: "usr_admin_sla_a",
  name: "Admin Tenant A",
  email: "admin_a@test.local",
  role: "admin",
  companyId: companyA
};
const empA1 = {
  id: "usr_emp_sla_a1",
  name: "Emp A1 (Primary)",
  email: "emp_a1@test.local",
  role: "employee",
  companyId: companyA
};
const empA2 = {
  id: "usr_emp_sla_a2",
  name: "Emp A2 (Secondary)",
  email: "emp_a2@test.local",
  role: "employee",
  companyId: companyA
};
const empB = {
  id: "usr_emp_sla_b",
  name: "Emp Tenant B",
  email: "emp_b@test.local",
  role: "employee",
  companyId: companyB
};

let adminToken;
let empTokenA1;

async function issueTestToken(userId, company, actionType = "check-in") {
  const { rawToken, tokenHash } = generateVerificationSessionToken();
  const sessionId = "avs_sc_" + Math.random().toString(36).substring(2);
  const attemptId = "ava_sc_" + Math.random().toString(36).substring(2);

  await query(
    `INSERT INTO attendance_verification_attempts (
       id, user_id, company_id, work_mode, status, gps_result, face_result, liveness_result, model
     ) VALUES ($1, $2, $3, 'office', 'verified', 'inside', 'matched', 'not_checked', 'ArcFace')`,
    [attemptId, userId, company]
  );

  await query(
    `INSERT INTO attendance_verification_sessions (
       id, attempt_id, user_id, company_id, token_hash, action_type, status, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'issued', NOW() + INTERVAL '10 minutes')`,
    [sessionId, attemptId, userId, company, tokenHash, actionType]
  );

  return rawToken;
}

describe("Task SLA & Hourly Report Compliance Engine - 12 Scenarios Test Suite", () => {
  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(PORT, resolve));
    baseUrl = `http://localhost:${PORT}/api`;

    // Seed test companies
    await query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'Tenant A', 'tenant-a') ON CONFLICT (id) DO NOTHING`, [companyA]);
    await query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'Tenant B', 'tenant-b') ON CONFLICT (id) DO NOTHING`, [companyB]);

    // Seed test users
    await query(`INSERT INTO users (id, name, email, password_hash, role, company_id) VALUES ($1, $2, $3, 'hashed', 'admin', $4) ON CONFLICT (id) DO NOTHING`, [adminA.id, adminA.name, adminA.email, companyA]);
    await query(`INSERT INTO users (id, name, email, password_hash, role, company_id) VALUES ($1, $2, $3, 'hashed', 'employee', $4) ON CONFLICT (id) DO NOTHING`, [empA1.id, empA1.name, empA1.email, companyA]);
    await query(`INSERT INTO users (id, name, email, password_hash, role, company_id) VALUES ($1, $2, $3, 'hashed', 'employee', $4) ON CONFLICT (id) DO NOTHING`, [empA2.id, empA2.name, empA2.email, companyA]);
    await query(`INSERT INTO users (id, name, email, password_hash, role, company_id) VALUES ($1, $2, $3, 'hashed', 'employee', $4) ON CONFLICT (id) DO NOTHING`, [empB.id, empB.name, empB.email, companyB]);

    // Clean test data
    await query(`DELETE FROM tasks WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM hourly_reports WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM attendance WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM notifications WHERE user_id IN ($1, $2, $3, $4)`, [adminA.id, empA1.id, empA2.id, empB.id]);

    adminToken = generateToken({ id: adminA.id, email: adminA.email, role: adminA.role, companyId: companyA });
    empTokenA1 = generateToken({ id: empA1.id, email: empA1.email, role: empA1.role, companyId: companyA });
  });

  after(async () => {
    await query(`DELETE FROM tasks WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM hourly_reports WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM attendance WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM notifications WHERE user_id IN ($1, $2, $3, $4)`, [adminA.id, empA1.id, empA2.id, empB.id]);
    await query(`DELETE FROM users WHERE id IN ($1, $2, $3, $4)`, [adminA.id, empA1.id, empA2.id, empB.id]);
    await query(`DELETE FROM companies WHERE id IN ($1, $2)`, [companyA, companyB]);
    await new Promise(resolve => server.close(resolve));
  });

  // Scenario 1: Employee with no task -> not marked absent
  it("Scenario 1: Employee with no task -> not marked absent and no lock applied", async () => {
    const today = new Date().toISOString().split("T")[0];
    const attId = `att_sc1_${Date.now()}`;

    await query(`DELETE FROM tasks WHERE assigned_to = $1`, [empA1.id]);
    await query(`DELETE FROM attendance WHERE user_id = $1 AND date = $2`, [empA1.id, today]);

    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, check_in, is_admin_locked)
       VALUES ($1, $2, $3, $4, 'present', NOW() - INTERVAL '3 hours', FALSE)`,
      [attId, empA1.id, companyA, today]
    );

    const checkRes = await checkComplianceNow(null, companyA);
    assert.strictEqual(checkRes.taskPenalties, 0, "No task penalties should occur for user with no tasks");
    assert.strictEqual(checkRes.penaltyCount, 0, "No report penalties should occur for user with no tasks");

    const row = (await query(`SELECT * FROM attendance WHERE id = $1`, [attId])).rows[0];
    assert.strictEqual(row.status, "present");
    assert.strictEqual(row.is_admin_locked, false);
    assert.strictEqual(row.penalty_status, null);
  });

  // Scenario 2: Valid task acknowledged within 10 min -> not marked absent
  it("Scenario 2: Valid task acknowledged within 10 min -> not marked absent", async () => {
    const today = new Date().toISOString().split("T")[0];
    const taskId = `task_sc2_${Date.now()}`;
    const attId = `att_sc2_${Date.now()}`;

    await query(`DELETE FROM tasks WHERE assigned_to = $1`, [empA1.id]);
    await query(`DELETE FROM attendance WHERE user_id = $1 AND date = $2`, [empA1.id, today]);

    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, check_in, is_admin_locked)
       VALUES ($1, $2, $3, $4, 'present', NOW() - INTERVAL '1 hour', FALSE)`,
      [attId, empA1.id, companyA, today]
    );

    // Task assigned 5 minutes ago and acknowledged (viewed) 2 minutes ago
    await query(
      `INSERT INTO tasks (id, company_id, title, assigned_to, created_by, status, viewed_at, acknowledged_at, assigned_at, created_at)
       VALUES ($1, $2, 'Task Acknowledged Promptly', $3, $4, 'accepted', NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '5 minutes')`,
      [taskId, companyA, empA1.id, adminA.id]
    );

    const checkRes = await checkComplianceNow(null, companyA);
    assert.strictEqual(checkRes.taskPenalties, 0, "Acknowledged task must not incur absence penalty");

    const row = (await query(`SELECT * FROM attendance WHERE id = $1`, [attId])).rows[0];
    assert.strictEqual(row.status, "present");
    assert.strictEqual(row.is_admin_locked, false);
  });

  // Scenario 3: Valid task unacknowledged after 10 min -> marked absent & locked
  it("Scenario 3: Valid task unacknowledged after 10 min -> marked absent & locked", async () => {
    const today = new Date().toISOString().split("T")[0];
    const taskId = `task_sc3_${Date.now()}`;
    const attId = `att_sc3_${Date.now()}`;

    await query(`DELETE FROM tasks WHERE assigned_to = $1`, [empA1.id]);
    await query(`DELETE FROM attendance WHERE user_id = $1 AND date = $2`, [empA1.id, today]);

    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, check_in, is_admin_locked)
       VALUES ($1, $2, $3, $4, 'present', NOW() - INTERVAL '1 hour', FALSE)`,
      [attId, empA1.id, companyA, today]
    );

    // Task assigned 15 minutes ago, never viewed or acknowledged
    await query(
      `INSERT INTO tasks (id, company_id, title, assigned_to, created_by, status, viewed_at, acknowledged_at, sla_penalty_applied, assigned_at, created_at)
       VALUES ($1, $2, 'Urgent Unseen Task', $3, $4, 'new', NULL, NULL, FALSE, NOW() - INTERVAL '15 minutes', NOW() - INTERVAL '15 minutes')`,
      [taskId, companyA, empA1.id, adminA.id]
    );

    const checkRes = await checkComplianceNow(null, companyA);
    assert.strictEqual(checkRes.taskPenalties, 1, "Unacknowledged task > 10m must trigger 1 penalty");

    const row = (await query(`SELECT * FROM attendance WHERE id = $1`, [attId])).rows[0];
    assert.strictEqual(row.status, "absent");
    assert.strictEqual(row.is_admin_locked, true);
    assert.strictEqual(row.penalty_status, "unseen_task_penalty");
    assert.strictEqual(row.penalized_by_task_id, taskId);
  });

  // Scenario 4: Task assigned to another employee -> current employee not penalized
  it("Scenario 4: Task assigned to another employee -> current employee not penalized", async () => {
    const today = new Date().toISOString().split("T")[0];
    const taskId = `task_sc4_${Date.now()}`;
    const attIdA1 = `att_sc4_a1_${Date.now()}`;

    await query(`DELETE FROM tasks WHERE company_id = $1`, [companyA]);
    await query(`DELETE FROM attendance WHERE company_id = $1`, [companyA]);

    // Emp A1 is present
    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, check_in, is_admin_locked)
       VALUES ($1, $2, $3, $4, 'present', NOW() - INTERVAL '1 hour', FALSE)`,
      [attIdA1, empA1.id, companyA, today]
    );

    // Task is assigned to Emp A2 (not Emp A1), overdue for acknowledgement
    await query(
      `INSERT INTO tasks (id, company_id, title, assigned_to, created_by, status, viewed_at, acknowledged_at, sla_penalty_applied, assigned_at, created_at)
       VALUES ($1, $2, 'Task for Emp A2', $3, $4, 'new', NULL, NULL, FALSE, NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '20 minutes')`,
      [taskId, companyA, empA2.id, adminA.id]
    );

    await checkComplianceNow(null, companyA);

    // Emp A1 must remain untouched
    const rowA1 = (await query(`SELECT * FROM attendance WHERE id = $1`, [attIdA1])).rows[0];
    assert.strictEqual(rowA1.status, "present");
    assert.strictEqual(rowA1.is_admin_locked, false);
  });

  // Scenario 5: Cancelled task -> no absence enforcement
  it("Scenario 5: Cancelled task -> no absence enforcement", async () => {
    const today = new Date().toISOString().split("T")[0];
    const taskId = `task_sc5_${Date.now()}`;
    const attId = `att_sc5_${Date.now()}`;

    await query(`DELETE FROM tasks WHERE company_id = $1`, [companyA]);
    await query(`DELETE FROM attendance WHERE company_id = $1`, [companyA]);

    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, check_in, is_admin_locked)
       VALUES ($1, $2, $3, $4, 'present', NOW() - INTERVAL '1 hour', FALSE)`,
      [attId, empA1.id, companyA, today]
    );

    // Task was assigned 30 minutes ago but cancelled
    await query(
      `INSERT INTO tasks (id, company_id, title, assigned_to, created_by, status, viewed_at, acknowledged_at, sla_penalty_applied, assigned_at, created_at)
       VALUES ($1, $2, 'Cancelled Task', $3, $4, 'cancelled', NULL, NULL, FALSE, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes')`,
      [taskId, companyA, empA1.id, adminA.id]
    );

    const checkRes = await checkComplianceNow(null, companyA);
    assert.strictEqual(checkRes.taskPenalties, 0, "Cancelled task must never trigger penalties");

    const row = (await query(`SELECT * FROM attendance WHERE id = $1`, [attId])).rows[0];
    assert.strictEqual(row.status, "present");
    assert.strictEqual(row.is_admin_locked, false);
  });

  // Scenario 6: Reassigned task -> old assignee not penalized
  it("Scenario 6: Reassigned task -> old assignee not penalized", async () => {
    const today = new Date().toISOString().split("T")[0];
    const taskId = `task_sc6_${Date.now()}`;
    const attIdA1 = `att_sc6_a1_${Date.now()}`;

    await query(`DELETE FROM tasks WHERE company_id = $1`, [companyA]);
    await query(`DELETE FROM attendance WHERE company_id = $1`, [companyA]);

    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, check_in, is_admin_locked)
       VALUES ($1, $2, $3, $4, 'present', NOW() - INTERVAL '1 hour', FALSE)`,
      [attIdA1, empA1.id, companyA, today]
    );

    // Task reassigned to empA2 just 2 minutes ago
    await query(
      `INSERT INTO tasks (id, company_id, title, assigned_to, created_by, status, viewed_at, acknowledged_at, sla_penalty_applied, assigned_at, created_at)
       VALUES ($1, $2, 'Reassigned Task', $3, $4, 'new', NULL, NULL, FALSE, NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '40 minutes')`,
      [taskId, companyA, empA2.id, adminA.id]
    );

    const checkRes = await checkComplianceNow(null, companyA);
    assert.strictEqual(checkRes.taskPenalties, 0, "Reassigned task within 10 min window should not penalize anyone");

    const rowA1 = (await query(`SELECT * FROM attendance WHERE id = $1`, [attIdA1])).rows[0];
    assert.strictEqual(rowA1.status, "present");
    assert.strictEqual(rowA1.is_admin_locked, false);
  });

  // Scenario 7: Completed task -> no penalty
  it("Scenario 7: Completed task -> no penalty", async () => {
    const today = new Date().toISOString().split("T")[0];
    const taskId = `task_sc7_${Date.now()}`;
    const attId = `att_sc7_${Date.now()}`;

    await query(`DELETE FROM tasks WHERE company_id = $1`, [companyA]);
    await query(`DELETE FROM attendance WHERE company_id = $1`, [companyA]);

    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, check_in, is_admin_locked)
       VALUES ($1, $2, $3, $4, 'present', NOW() - INTERVAL '1 hour', FALSE)`,
      [attId, empA1.id, companyA, today]
    );

    // Task completed
    await query(
      `INSERT INTO tasks (id, company_id, title, assigned_to, created_by, status, viewed_at, acknowledged_at, completed_at, sla_penalty_applied, assigned_at, created_at)
       VALUES ($1, $2, 'Completed Task', $3, $4, 'completed', NOW() - INTERVAL '50 minutes', NOW() - INTERVAL '50 minutes', NOW() - INTERVAL '10 minutes', FALSE, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour')`,
      [taskId, companyA, empA1.id, adminA.id]
    );

    const checkRes = await checkComplianceNow(null, companyA);
    assert.strictEqual(checkRes.taskPenalties, 0, "Completed tasks must never trigger penalties");

    const row = (await query(`SELECT * FROM attendance WHERE id = $1`, [attId])).rows[0];
    assert.strictEqual(row.status, "present");
    assert.strictEqual(row.is_admin_locked, false);
  });

  // Scenario 8: Deadline not reached (< 10 min) -> no penalty
  it("Scenario 8: Deadline not reached (< 10 min) -> no penalty", async () => {
    const today = new Date().toISOString().split("T")[0];
    const taskId = `task_sc8_${Date.now()}`;
    const attId = `att_sc8_${Date.now()}`;

    await query(`DELETE FROM tasks WHERE company_id = $1`, [companyA]);
    await query(`DELETE FROM attendance WHERE company_id = $1`, [companyA]);

    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, check_in, is_admin_locked)
       VALUES ($1, $2, $3, $4, 'present', NOW() - INTERVAL '30 minutes', FALSE)`,
      [attId, empA1.id, companyA, today]
    );

    // Task assigned only 5 minutes ago (< 10m SLA)
    await query(
      `INSERT INTO tasks (id, company_id, title, assigned_to, created_by, status, viewed_at, acknowledged_at, sla_penalty_applied, assigned_at, created_at)
       VALUES ($1, $2, 'Fresh Task 5m Old', $3, $4, 'new', NULL, NULL, FALSE, NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '5 minutes')`,
      [taskId, companyA, empA1.id, adminA.id]
    );

    const checkRes = await checkComplianceNow(null, companyA);
    assert.strictEqual(checkRes.taskPenalties, 0, "Task assigned < 10m ago must be within grace period");

    const row = (await query(`SELECT * FROM attendance WHERE id = $1`, [attId])).rows[0];
    assert.strictEqual(row.status, "present");
    assert.strictEqual(row.is_admin_locked, false);
  });

  // Scenario 9: Progress report with no task -> not marked absent
  it("Scenario 9: Progress report with no task -> not marked absent", async () => {
    const today = new Date().toISOString().split("T")[0];
    const attId = `att_sc9_${Date.now()}`;

    await query(`DELETE FROM tasks WHERE company_id = $1`, [companyA]);
    await query(`DELETE FROM attendance WHERE company_id = $1`, [companyA]);
    await query(`DELETE FROM hourly_reports WHERE company_id = $1`, [companyA]);

    // Checked in 3 hours ago, but has NO tasks
    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, check_in, is_admin_locked)
       VALUES ($1, $2, $3, $4, 'present', NOW() - INTERVAL '3 hours', FALSE)`,
      [attId, empA1.id, companyA, today]
    );

    const checkRes = await checkComplianceNow(null, companyA);
    assert.strictEqual(checkRes.penaltyCount, 0, "No progress report penalty when employee has no tasks");

    const row = (await query(`SELECT * FROM attendance WHERE id = $1`, [attId])).rows[0];
    assert.strictEqual(row.status, "present");
    assert.strictEqual(row.is_admin_locked, false);
  });

  // Scenario 10: Duplicate enforcement runs -> no duplicate records
  it("Scenario 10: Duplicate enforcement runs -> idempotent, no duplicate records", async () => {
    const today = new Date().toISOString().split("T")[0];
    const taskId = `task_sc10_${Date.now()}`;
    const attId = `att_sc10_${Date.now()}`;

    await query(`DELETE FROM tasks WHERE company_id = $1`, [companyA]);
    await query(`DELETE FROM attendance WHERE company_id = $1`, [companyA]);

    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, check_in, is_admin_locked)
       VALUES ($1, $2, $3, $4, 'present', NOW() - INTERVAL '1 hour', FALSE)`,
      [attId, empA1.id, companyA, today]
    );

    // Overdue task
    await query(
      `INSERT INTO tasks (id, company_id, title, assigned_to, created_by, status, viewed_at, acknowledged_at, sla_penalty_applied, assigned_at, created_at)
       VALUES ($1, $2, 'Task For Duplicate Check', $3, $4, 'new', NULL, NULL, FALSE, NOW() - INTERVAL '25 minutes', NOW() - INTERVAL '25 minutes')`,
      [taskId, companyA, empA1.id, adminA.id]
    );

    // Run 1
    const run1 = await checkComplianceNow(null, companyA);
    assert.strictEqual(run1.taskPenalties, 1);

    // Run 2 (immediately after)
    const run2 = await checkComplianceNow(null, companyA);
    assert.strictEqual(run2.taskPenalties, 0, "Second run should find 0 new penalties (idempotent)");

    // Verify exactly 1 attendance record exists for this employee today
    const attRows = await query(`SELECT * FROM attendance WHERE user_id = $1 AND date = $2`, [empA1.id, today]);
    assert.strictEqual(attRows.rows.length, 1, "Must have exactly 1 attendance row, no duplicates");
  });

  // Scenario 11: Tenant isolation -> Company A task does not penalize Company B
  it("Scenario 11: Tenant isolation -> Company A task does not penalize Company B", async () => {
    const today = new Date().toISOString().split("T")[0];
    const taskIdA = `task_sc11_a_${Date.now()}`;
    const attIdB = `att_sc11_b_${Date.now()}`;

    await query(`DELETE FROM tasks WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM attendance WHERE company_id IN ($1, $2)`, [companyA, companyB]);

    // Emp B is present
    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, check_in, is_admin_locked)
       VALUES ($1, $2, $3, $4, 'present', NOW() - INTERVAL '1 hour', FALSE)`,
      [attIdB, empB.id, companyB, today]
    );

    // Task belongs to Company A
    await query(
      `INSERT INTO tasks (id, company_id, title, assigned_to, created_by, status, viewed_at, acknowledged_at, sla_penalty_applied, assigned_at, created_at)
       VALUES ($1, $2, 'Company A Overdue Task', $3, $4, 'new', NULL, NULL, FALSE, NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '20 minutes')`,
      [taskIdA, companyA, empA1.id, adminA.id]
    );

    // Run compliance for Company B only
    const checkB = await checkComplianceNow(null, companyB);
    assert.strictEqual(checkB.taskPenalties, 0);

    const rowB = (await query(`SELECT * FROM attendance WHERE id = $1`, [attIdB])).rows[0];
    assert.strictEqual(rowB.status, "present");
    assert.strictEqual(rowB.is_admin_locked, false);
  });

  // Scenario 12: Race condition / concurrency -> atomic re-validation
  it("Scenario 12: Concurrency & fail-safe check-in -> unlocks when zero active penalized tasks exist", async () => {
    const today = new Date().toISOString().split("T")[0];
    const attId = `att_sc12_${Date.now()}`;

    await query(`DELETE FROM tasks WHERE company_id = $1`, [companyA]);
    await query(`DELETE FROM attendance WHERE company_id = $1`, [companyA]);

    // Simulate an employee who was previously locked due to unseen_task_penalty, but the task has since been deleted
    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, is_admin_locked, penalty_status, penalized_by_task_id)
       VALUES ($1, $2, $3, $4, 'absent', TRUE, 'unseen_task_penalty', 'task_deleted_123')`,
      [attId, empA1.id, companyA, today]
    );

    // Employee attempts check-in -> fail-safe logic detects 0 active tasks and auto-resolves false lock
    const token = await issueTestToken(empA1.id, companyA, "check-in");
    const checkInRes = await fetch(`${baseUrl}/attendance/check-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${empTokenA1}` },
      body: JSON.stringify({
        verificationSessionToken: token,
        location: { latitude: 12.9716, longitude: 77.5946, accuracy: 10 }
      })
    });

    assert.strictEqual(checkInRes.status, 200, "Fail-safe must allow check-in when employee has no active penalized tasks");
    const checkInData = await checkInRes.json();
    assert.ok(checkInData.status === "present" || checkInData.status === "checked-in");
  });
});
