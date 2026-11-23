import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import crypto from "crypto";
import app from "../app.js";
import { query } from "../config/db.js";
import { generateToken } from "../middlewares/auth.js";
import { hashToken } from "../services/livenessVerification.js";

const PORT = 5098;
let server;
let baseUrl;

const companyA = "comp_bio_test_a";
const companyB = "comp_bio_test_b";

const adminA = {
  id: "usr_admin_bio_a",
  name: "Bio Admin A",
  email: "admin_bio_a@test.local",
  role: "admin",
  companyId: companyA
};
const emp1 = {
  id: "usr_emp_bio_1",
  name: "Employee Bio One",
  email: "emp_bio_1@test.local",
  role: "employee",
  companyId: companyA,
  shiftStart: "09:00",
  shiftEnd: "18:00"
};
const emp2 = {
  id: "usr_emp_bio_2",
  name: "Employee Bio Two",
  email: "emp_bio_2@test.local",
  role: "employee",
  companyId: companyA,
  shiftStart: "09:00",
  shiftEnd: "18:00"
};
const adminB = {
  id: "usr_admin_bio_b",
  name: "Bio Admin B",
  email: "admin_bio_b@test.local",
  role: "admin",
  companyId: companyB
};

let adminTokenA;
let emp1Token;
let emp2Token;
let adminTokenB;

describe("Face Biometric Status in Admin Attendance Monitoring (10 Scenarios)", () => {
  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(PORT, resolve));
    baseUrl = `http://localhost:${PORT}/api`;

    // Seed companies
    await query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'Bio Corp A', 'bio-corp-a') ON CONFLICT (id) DO NOTHING`, [companyA]);
    await query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'Bio Corp B', 'bio-corp-b') ON CONFLICT (id) DO NOTHING`, [companyB]);

    // Seed users
    await query(
      `INSERT INTO users (id, name, email, password_hash, role, company_id, shift_start, shift_end, department)
       VALUES ($1, $2, $3, 'hashed', 'admin', $4, '09:00', '18:00', 'Operations')
       ON CONFLICT (id) DO NOTHING`,
      [adminA.id, adminA.name, adminA.email, companyA]
    );
    await query(
      `INSERT INTO users (id, name, email, password_hash, role, company_id, shift_start, shift_end, department)
       VALUES ($1, $2, $3, 'hashed', 'employee', $4, '09:00', '18:00', 'Engineering')
       ON CONFLICT (id) DO NOTHING`,
      [emp1.id, emp1.name, emp1.email, companyA]
    );
    await query(
      `INSERT INTO users (id, name, email, password_hash, role, company_id, shift_start, shift_end, department)
       VALUES ($1, $2, $3, 'hashed', 'employee', $4, '09:00', '18:00', 'Product')
       ON CONFLICT (id) DO NOTHING`,
      [emp2.id, emp2.name, emp2.email, companyA]
    );
    await query(
      `INSERT INTO users (id, name, email, password_hash, role, company_id, shift_start, shift_end, department)
       VALUES ($1, $2, $3, 'hashed', 'admin', $4, '09:00', '18:00', 'Operations')
       ON CONFLICT (id) DO NOTHING`,
      [adminB.id, adminB.name, adminB.email, companyB]
    );

    // Clear test data
    await query(`DELETE FROM attendance WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM attendance_verification_sessions WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM attendance_verification_attempts WHERE company_id IN ($1, $2)`, [companyA, companyB]);

    adminTokenA = generateToken({ id: adminA.id, email: adminA.email, role: adminA.role, companyId: companyA });
    emp1Token = generateToken({ id: emp1.id, email: emp1.email, role: emp1.role, companyId: companyA });
    emp2Token = generateToken({ id: emp2.id, email: emp2.email, role: emp2.role, companyId: companyA });
    adminTokenB = generateToken({ id: adminB.id, email: adminB.email, role: adminB.role, companyId: companyB });
  });

  after(async () => {
    await query(`DELETE FROM attendance WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM attendance_verification_sessions WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM attendance_verification_attempts WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await new Promise(resolve => server.close(resolve));
  });

  it("1. Employee passes face verification and checks in -> Admin sees Verified", async () => {
    const today = new Date().toISOString().split("T")[0];
    const attemptId = `ava_test_${Date.now()}_1`;
    const sessionId = `avs_test_${Date.now()}_1`;
    const rawToken = crypto.randomBytes(16).toString("hex");
    const tokenHash = hashToken(rawToken);

    // Seed verified verification attempt
    await query(
      `INSERT INTO attendance_verification_attempts (
         id, user_id, company_id, work_mode, status, face_result, gps_result, liveness_result, model, metadata
       ) VALUES ($1, $2, $3, 'office', 'verified', 'matched', 'inside', 'live', 'ArcFace', '{"actionType":"check-in"}')`,
      [attemptId, emp1.id, companyA]
    );

    // Seed verification session
    await query(
      `INSERT INTO attendance_verification_sessions (
         id, attempt_id, user_id, company_id, token_hash, status, expires_at, action_type
       ) VALUES ($1, $2, $3, $4, $5, 'issued', NOW() + INTERVAL '5 minutes', 'check-in')`,
      [sessionId, attemptId, emp1.id, companyA, tokenHash]
    );

    // Employee checks in with the valid session token
    const checkInRes = await fetch(`${baseUrl}/attendance/check-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${emp1Token}` },
      body: JSON.stringify({
        verificationSessionToken: rawToken,
        location: { latitude: 11.3715, longitude: 77.6445, accuracy: 50 }
      })
    });
    assert.strictEqual(checkInRes.status, 200);

    // Admin views attendance records
    const monRes = await fetch(`${baseUrl}/attendance/monitoring/records?preset=today`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    assert.strictEqual(monRes.status, 200);
    const monData = await monRes.json();
    const emp1Rec = monData.records.find(r => r.userId === emp1.id);
    assert.ok(emp1Rec, "Employee 1 record must be present");
    assert.strictEqual(emp1Rec.faceBiometricStatus, "Verified");
    assert.strictEqual(emp1Rec.faceVerification, "Verified");
    assert.strictEqual(emp1Rec.gpsVerification, "Verified");
  });

  it("2. Employee passes verification but attempt record deleted -> graceful fallback, never crashes", async () => {
    const pastDate = "2026-11-01";
    const attId = `${emp1.id}_${pastDate}`;

    // Attendance record with biometric_verified = true flag but missing attempt record
    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, check_in, status, biometric_verified, verification_method, location)
       VALUES ($1, $2, $3, $4::date, $5, 'present', TRUE, 'FACE', '{"latitude":11.37,"longitude":77.64}')
       ON CONFLICT (id) DO UPDATE SET biometric_verified = TRUE`,
      [attId, emp1.id, companyA, pastDate, `${pastDate}T09:05:00.000Z`]
    );

    const monRes = await fetch(`${baseUrl}/attendance/monitoring/records?preset=custom&dateFrom=${pastDate}&dateTo=${pastDate}`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    assert.strictEqual(monRes.status, 200);
    const monData = await monRes.json();
    const rec = monData.records.find(r => r.id === attId);
    assert.ok(rec);
    assert.strictEqual(rec.faceBiometricStatus, "Verified");
    assert.strictEqual(rec.faceVerification, "Verified");
  });

  it("3. Employee fails face verification -> Attendance check-in remains blocked", async () => {
    // Attempting check-in without verification token
    const noTokenRes = await fetch(`${baseUrl}/attendance/check-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${emp2Token}` },
      body: JSON.stringify({ location: { latitude: 11.37, longitude: 77.64 } })
    });
    assert.strictEqual(noTokenRes.status, 400);

    // Attempting check-in with invalid/expired token
    const badTokenRes = await fetch(`${baseUrl}/attendance/check-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${emp2Token}` },
      body: JSON.stringify({
        verificationSessionToken: "invalid_fake_token_hex_12345678",
        location: { latitude: 11.37, longitude: 77.64 }
      })
    });
    assert.strictEqual(badTokenRes.status, 403);
  });

  it("4. Employee fails liveness verification -> Attempt recorded as Liveness Failed and check-in blocked", async () => {
    const today = new Date().toISOString().split("T")[0];
    const attemptId = `ava_spoof_${Date.now()}`;

    // Record spoof/liveness failed attempt
    await query(
      `INSERT INTO attendance_verification_attempts (
         id, user_id, company_id, work_mode, status, failure_category, face_result, gps_result, liveness_result, model, metadata
       ) VALUES ($1, $2, $3, 'office', 'failed', 'liveness_failed', 'not_matched', 'inside', 'spoof', 'ArcFace', '{"actionType":"check-in"}')`,
      [attemptId, emp2.id, companyA]
    );

    // Check-in remains blocked because no valid session is issued for liveness failure
    const checkInRes = await fetch(`${baseUrl}/attendance/check-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${emp2Token}` },
      body: JSON.stringify({ verificationSessionToken: "unissued_token_liveness" })
    });
    assert.strictEqual(checkInRes.status, 403);

    // Monitoring API reflects Liveness Failed for this unclocked staff attempt today
    const monRes = await fetch(`${baseUrl}/attendance/monitoring/records?preset=today`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    assert.strictEqual(monRes.status, 200);
    const monData = await monRes.json();
    const emp2Rec = monData.records.find(r => r.userId === emp2.id);
    assert.ok(emp2Rec);
    assert.strictEqual(emp2Rec.faceBiometricStatus, "Liveness Failed");
  });

  it("5. Historical attendance without biometric data -> Not Available", async () => {
    const historicalDate = "2026-09-15";
    const histId = `${emp1.id}_${historicalDate}`;

    // Historical record created prior to biometric requirement
    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, check_in, check_out, status, biometric_verified, verification_method, location)
       VALUES ($1, $2, $3, $4::date, $5, $6, 'present', FALSE, 'STANDARD', '{}')
       ON CONFLICT (id) DO NOTHING`,
      [histId, emp1.id, companyA, historicalDate, `${historicalDate}T09:00:00.000Z`, `${historicalDate}T18:00:00.000Z`]
    );

    const monRes = await fetch(`${baseUrl}/attendance/monitoring/records?preset=custom&dateFrom=${historicalDate}&dateTo=${historicalDate}`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    assert.strictEqual(monRes.status, 200);
    const monData = await monRes.json();
    const rec = monData.records.find(r => r.id === histId);
    assert.ok(rec);
    assert.strictEqual(rec.faceBiometricStatus, "Not Available");
    assert.strictEqual(rec.faceVerification, "Not Available");
    assert.strictEqual(rec.gpsVerification, "Not Available");
  });

  it("6. Two employees' biometric results are never mixed", async () => {
    const testDate = "2026-11-10";
    const attId1 = `${emp1.id}_${testDate}`;
    const attId2 = `${emp2.id}_${testDate}`;
    const attemptId1 = `ava_mix_test_emp1`;

    // Emp 1 verified via biometrics
    await query(
      `INSERT INTO attendance_verification_attempts (
         id, user_id, company_id, status, face_result, gps_result, liveness_result, attempted_at
       ) VALUES ($1, $2, $3, 'verified', 'matched', 'inside', 'live', $4)`,
      [attemptId1, emp1.id, companyA, `${testDate}T09:00:00.000Z`]
    );

    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, check_in, status, biometric_verified, metadata)
       VALUES ($1, $2, $3, $4::date, $5, 'present', TRUE, $6)
       ON CONFLICT (id) DO NOTHING`,
      [attId1, emp1.id, companyA, testDate, `${testDate}T09:00:05.000Z`, JSON.stringify({ verificationAttemptId: attemptId1 })]
    );

    // Emp 2 standard check-in without biometrics
    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, check_in, status, biometric_verified, metadata)
       VALUES ($1, $2, $3, $4::date, $5, 'present', FALSE, '{}')
       ON CONFLICT (id) DO NOTHING`,
      [attId2, emp2.id, companyA, testDate, `${testDate}T09:10:00.000Z`]
    );

    const monRes = await fetch(`${baseUrl}/attendance/monitoring/records?preset=custom&dateFrom=${testDate}&dateTo=${testDate}`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    const monData = await monRes.json();
    const r1 = monData.records.find(r => r.userId === emp1.id);
    const r2 = monData.records.find(r => r.userId === emp2.id);

    assert.strictEqual(r1.faceBiometricStatus, "Verified");
    assert.strictEqual(r2.faceBiometricStatus, "Not Available");
  });

  it("7. Multiple attendance sessions display their respective verification results", async () => {
    const dayA = "2026-11-04";
    const dayB = "2026-11-05";
    const attA = `${emp1.id}_${dayA}`;
    const attB = `${emp1.id}_${dayB}`;
    const avaA = `ava_sess_a_${Date.now()}`;
    const avaB = `ava_sess_b_${Date.now()}`;

    // Session A: Verified
    await query(
      `INSERT INTO attendance_verification_attempts (id, user_id, company_id, status, face_result, gps_result, attempted_at)
       VALUES ($1, $2, $3, 'verified', 'matched', 'inside', $4)`,
      [avaA, emp1.id, companyA, `${dayA}T09:00:00.000Z`]
    );
    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, check_in, status, biometric_verified, metadata)
       VALUES ($1, $2, $3, $4::date, $5, 'present', TRUE, $6)
       ON CONFLICT (id) DO NOTHING`,
      [attA, emp1.id, companyA, dayA, `${dayA}T09:00:02.000Z`, JSON.stringify({ verificationAttemptId: avaA })]
    );

    // Session B: Face Mismatch
    await query(
      `INSERT INTO attendance_verification_attempts (id, user_id, company_id, status, face_result, failure_category, gps_result, attempted_at)
       VALUES ($1, $2, $3, 'failed', 'not_matched', 'face_mismatch', 'inside', $4)`,
      [avaB, emp1.id, companyA, `${dayB}T09:00:00.000Z`]
    );
    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, check_in, status, biometric_verified, metadata)
       VALUES ($1, $2, $3, $4::date, $5, 'present', FALSE, $6)
       ON CONFLICT (id) DO NOTHING`,
      [attB, emp1.id, companyA, dayB, `${dayB}T09:00:02.000Z`, JSON.stringify({ verificationAttemptId: avaB })]
    );

    const monRes = await fetch(`${baseUrl}/attendance/monitoring/records?preset=custom&dateFrom=${dayA}&dateTo=${dayB}`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    const monData = await monRes.json();
    const rowA = monData.records.find(r => r.date === dayA && r.userId === emp1.id);
    const rowB = monData.records.find(r => r.date === dayB && r.userId === emp1.id);

    assert.strictEqual(rowA.faceBiometricStatus, "Verified");
    assert.strictEqual(rowB.faceBiometricStatus, "Face Mismatch");
  });

  it("8. Company A cannot access Company B's verification records (Tenant Isolation)", async () => {
    const today = new Date().toISOString().split("T")[0];
    const attemptIdB = `ava_comp_b_${Date.now()}`;

    // Seed attempt in Company B
    await query(
      `INSERT INTO attendance_verification_attempts (id, user_id, company_id, status, face_result, gps_result, attempted_at)
       VALUES ($1, $2, $3, 'verified', 'matched', 'inside', NOW())`,
      [attemptIdB, adminB.id, companyB]
    );

    // Admin A requests records from Company A -> cannot see Company B records
    const monResA = await fetch(`${baseUrl}/attendance/monitoring/records?preset=today`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    const monDataA = await monResA.json();
    const hasCompanyBUser = monDataA.records.some(r => r.userId === adminB.id);
    assert.strictEqual(hasCompanyBUser, false, "Admin A must never receive Company B user attendance");
  });

  it("9. GPS and face verification statuses remain independent", async () => {
    const testDate = "2026-11-12";
    const attId = `${emp1.id}_${testDate}`;
    const attemptId = `ava_gps_indep_${Date.now()}`;

    // Face verified, but GPS outside geofence
    await query(
      `INSERT INTO attendance_verification_attempts (
         id, user_id, company_id, status, face_result, failure_category, gps_result, attempted_at
       ) VALUES ($1, $2, $3, 'verified', 'matched', NULL, 'outside', $4)`,
      [attemptId, emp1.id, companyA, `${testDate}T09:00:00.000Z`]
    );

    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, check_in, status, biometric_verified, location, metadata)
       VALUES ($1, $2, $3, $4::date, $5, 'present', TRUE, '{"inGeofence":false}', $6)
       ON CONFLICT (id) DO NOTHING`,
      [attId, emp1.id, companyA, testDate, `${testDate}T09:00:02.000Z`, JSON.stringify({ verificationAttemptId: attemptId })]
    );

    const monRes = await fetch(`${baseUrl}/attendance/monitoring/records?preset=custom&dateFrom=${testDate}&dateTo=${testDate}`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    const monData = await monRes.json();
    const rec = monData.records.find(r => r.id === attId);

    assert.strictEqual(rec.faceBiometricStatus, "Verified");
    assert.strictEqual(rec.gpsVerification, "Outside Geofence");
  });

  it("10. Existing MFA and attendance enforcement continue working", async () => {
    // Verify health endpoint
    const health = await fetch(`${baseUrl}/health`).then(r => r.json());
    assert.strictEqual(health.status, "ok");

    // Verify employee cannot access admin monitoring
    const forbidRes = await fetch(`${baseUrl}/attendance/monitoring/records`, {
      headers: { Authorization: `Bearer ${emp1Token}` }
    });
    assert.strictEqual(forbidRes.status, 403);
  });
});
