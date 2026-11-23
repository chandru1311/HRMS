import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import app from "../app.js";
import { query } from "../config/db.js";
import { generateToken } from "../middlewares/auth.js";

const PORT = 5097;
let server;
let baseUrl;

const companyA = "comp_mon_test_a";
const companyB = "comp_mon_test_b";

const adminA = {
  id: "usr_admin_mon_a",
  name: "Monitoring Admin A",
  email: "admin_mon_a@test.local",
  role: "admin",
  companyId: companyA
};
const empA = {
  id: "usr_emp_mon_a",
  name: "Employee Mon A",
  email: "emp_mon_a@test.local",
  role: "employee",
  companyId: companyA,
  shiftStart: "09:00",
  shiftEnd: "18:00"
};
const adminB = {
  id: "usr_admin_mon_b",
  name: "Monitoring Admin B",
  email: "admin_mon_b@test.local",
  role: "admin",
  companyId: companyB
};

let adminTokenA;
let empTokenA;
let adminTokenB;

describe("Admin Attendance Monitoring Module Test Suite", () => {
  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(PORT, resolve));
    baseUrl = `http://localhost:${PORT}/api`;

    // Seed companies
    await query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'Mon Corp A', 'mon-corp-a') ON CONFLICT (id) DO NOTHING`, [companyA]);
    await query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'Mon Corp B', 'mon-corp-b') ON CONFLICT (id) DO NOTHING`, [companyB]);

    // Seed users
    await query(`INSERT INTO users (id, name, email, password_hash, role, company_id, shift_start, shift_end, department)
                 VALUES ($1, $2, $3, 'hashed', 'admin', $4, '09:00', '18:00', 'Management')
                 ON CONFLICT (id) DO NOTHING`, [adminA.id, adminA.name, adminA.email, companyA]);
    await query(`INSERT INTO users (id, name, email, password_hash, role, company_id, shift_start, shift_end, department)
                 VALUES ($1, $2, $3, 'hashed', 'employee', $4, '09:00', '18:00', 'Engineering')
                 ON CONFLICT (id) DO NOTHING`, [empA.id, empA.name, empA.email, companyA]);
    await query(`INSERT INTO users (id, name, email, password_hash, role, company_id, shift_start, shift_end, department)
                 VALUES ($1, $2, $3, 'hashed', 'admin', $4, '09:00', '18:00', 'Management')
                 ON CONFLICT (id) DO NOTHING`, [adminB.id, adminB.name, adminB.email, companyB]);

    // Clear residual test data
    await query(`DELETE FROM attendance WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM regularization_requests WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM audit_logs WHERE company_id IN ($1, $2)`, [companyA, companyB]);

    adminTokenA = generateToken({ id: adminA.id, email: adminA.email, role: adminA.role, companyId: companyA });
    empTokenA = generateToken({ id: empA.id, email: empA.email, role: empA.role, companyId: companyA });
    adminTokenB = generateToken({ id: adminB.id, email: adminB.email, role: adminB.role, companyId: companyB });
  });

  after(async () => {
    await query(`DELETE FROM attendance WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM regularization_requests WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM audit_logs WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [adminA.id, empA.id, adminB.id]);
    await query(`DELETE FROM companies WHERE id IN ($1, $2)`, [companyA, companyB]);
    await new Promise(resolve => server.close(resolve));
  });

  it("1. RBAC Check: Admin can access monitoring endpoints; Employee gets 403 Forbidden", async () => {
    // Admin request -> 200 OK
    const adminRes = await fetch(`${baseUrl}/attendance/monitoring/summary`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    assert.strictEqual(adminRes.status, 200);
    const summary = await adminRes.json();
    assert.ok(summary.summary);
    assert.strictEqual(typeof summary.summary.totalEmployees, "number");

    // Employee request -> 403 Forbidden
    const empRes = await fetch(`${baseUrl}/attendance/monitoring/summary`, {
      headers: { Authorization: `Bearer ${empTokenA}` }
    });
    assert.strictEqual(empRes.status, 403);
  });

  it("2. Tenant Isolation: Admin A cannot view records from Company B", async () => {
    const today = new Date().toISOString().split("T")[0];
    const attBId = `att_mon_b_${Date.now()}`;

    // Seed attendance in Company B
    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, check_in)
       VALUES ($1, $2, $3, $4, 'present', NOW())`,
      [attBId, adminB.id, companyB, today]
    );

    // Admin A requests records
    const resA = await fetch(`${baseUrl}/attendance/monitoring/records?date=${today}`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    assert.strictEqual(resA.status, 200);
    const dataA = await resA.json();
    const hasCompanyBRecords = (dataA.records || []).some(r => r.company_id === companyB || r.userId === adminB.id);
    assert.strictEqual(hasCompanyBRecords, false, "Admin A must never see Company B attendance records");
  });

  it("3. Summary Metrics: Accurately reflects present, absent, late, working counts", async () => {
    const today = new Date().toISOString().split("T")[0];
    const attAId = `att_mon_a_check_${Date.now()}`;

    // Clean and seed a checked-in record for empA
    await query(`DELETE FROM attendance WHERE company_id = $1`, [companyA]);
    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, check_in, is_admin_locked)
       VALUES ($1, $2, $3, $4, 'present', NOW(), FALSE)`,
      [attAId, empA.id, companyA, today]
    );

    const res = await fetch(`${baseUrl}/attendance/monitoring/summary?date=${today}`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    assert.strictEqual(res.status, 200);
    const { summary } = await res.json();
    assert.ok(summary.totalEmployees >= 2);
    assert.strictEqual(summary.presentEmployees, 1);
    assert.strictEqual(summary.currentlyWorking, 1);
  });

  it("4. Shift-Based Late Arrival: Calculates minutes late when check-in is past shift + grace period", async () => {
    const today = new Date().toISOString().split("T")[0];
    const attLateId = `att_late_${Date.now()}`;

    await query(`DELETE FROM attendance WHERE user_id = $1 AND date = $2`, [empA.id, today]);

    // Check-in at 09:45 (shift is 09:00 with 15m grace -> late by 30 mins)
    const lateCheckInTime = `${today}T09:45:00.000Z`;
    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, check_in, is_admin_locked)
       VALUES ($1, $2, $3, $4, 'late', $5, FALSE)`,
      [attLateId, empA.id, companyA, today, lateCheckInTime]
    );

    const res = await fetch(`${baseUrl}/attendance/monitoring/records?date=${today}`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const empRecord = (data.records || []).find(r => r.userId === empA.id);
    assert.ok(empRecord);
    assert.ok(empRecord.attendanceStatus.toLowerCase().includes("late"));
    assert.ok(empRecord.lateByMinutes > 0, "lateByMinutes should be positive");
  });

  it("5. Regularization Review: Approving request syncs check-in/out into attendance and marks approved", async () => {
    const today = new Date().toISOString().split("T")[0];
    const regId = `reg_test_${Date.now()}`;

    // Seed regularization request
    await query(
      `INSERT INTO regularization_requests (
        id, user_id, company_id, attendance_date, requested_check_in, requested_check_out, reason, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'Card sensor malfunction', 'pending')`,
      [regId, empA.id, companyA, today, `${today} 09:00:00`, `${today} 18:00:00`]
    );

    // Admin approves request
    const reviewRes = await fetch(`${baseUrl}/attendance/monitoring/regularization/${regId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminTokenA}` },
      body: JSON.stringify({
        action: "approve",
        adminRemarks: "Approved after verifying CCTV logs"
      })
    });

    assert.strictEqual(reviewRes.status, 200);
    const reviewData = await reviewRes.json();
    assert.strictEqual(reviewData.request.status, "approved");

    // Verify attendance row was updated/created with present status
    const attCheck = await query(`SELECT * FROM attendance WHERE user_id = $1 AND date = $2`, [empA.id, today]);
    assert.ok(attCheck.rows.length > 0);
    assert.strictEqual(attCheck.rows[0].status, "present");
    assert.strictEqual(attCheck.rows[0].is_admin_locked, false);
  });

  it("6. Unlock & Manual Correction: Admin can unlock attendance and record is updated with audit log", async () => {
    const today = new Date().toISOString().split("T")[0];
    const attLockId = `att_locked_${Date.now()}`;

    await query(`DELETE FROM attendance WHERE user_id = $1 AND date = $2`, [empA.id, today]);
    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, status, is_admin_locked, penalty_status)
       VALUES ($1, $2, $3, $4, 'absent', TRUE, 'unseen_task_penalty')`,
      [attLockId, empA.id, companyA, today]
    );

    // Unlock attendance
    const unlockRes = await fetch(`${baseUrl}/attendance/monitoring/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminTokenA}` },
      body: JSON.stringify({
        userId: empA.id,
        date: today,
        reason: "Manager granted task acknowledgement exemption"
      })
    });

    assert.strictEqual(unlockRes.status, 200);
    const unlockData = await unlockRes.json();
    assert.strictEqual(unlockData.attendance.is_admin_locked, false);
    assert.strictEqual(unlockData.attendance.penalty_status, null);

    // Manual correction
    const correctRes = await fetch(`${baseUrl}/attendance/monitoring/manual-correct`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminTokenA}` },
      body: JSON.stringify({
        userId: empA.id,
        date: today,
        status: "present",
        checkIn: `${today}T09:00:00.000Z`,
        checkOut: `${today}T18:00:00.000Z`,
        remarks: "Manual shift adjustment"
      })
    });

    assert.strictEqual(correctRes.status, 200);
    const correctData = await correctRes.json();
    assert.strictEqual(correctData.attendance.status, "present");

    // Wait for non-blocking setImmediate audit logging to complete
    await new Promise(r => setTimeout(r, 500));

    // Verify audit logs were generated
    const auditLogs = await query(`SELECT * FROM audit_logs WHERE company_id = $1`, [companyA]);
    assert.ok(auditLogs.rows.length >= 2, "Audit logs must record unlock and manual correction");
  });

  it("7. CSV Export: Successfully returns streaming CSV content with attendance headers", async () => {
    const today = new Date().toISOString().split("T")[0];
    const exportRes = await fetch(`${baseUrl}/attendance/monitoring/export-csv?date=${today}`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });

    assert.strictEqual(exportRes.status, 200);
    assert.ok(exportRes.headers.get("content-type").includes("text/csv"));
    const csvContent = await exportRes.text();
    assert.ok(csvContent.includes("Employee ID") && csvContent.includes("Employee Name") && csvContent.includes("Department"));
  });
});
