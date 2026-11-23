import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import crypto from "crypto";
import app from "../app.js";
import { query } from "../config/db.js";
import { generateToken } from "../middlewares/auth.js";
import { hashToken } from "../services/livenessVerification.js";
import { setCachedAddress, clearAddressCache, formatNominatimAddress } from "../services/reverseGeocodingService.js";

const PORT = 5097;
let server;
let baseUrl;

const companyA = "comp_loc_test_a";
const companyB = "comp_loc_test_b";

const adminA = {
  id: "usr_admin_loc_a",
  name: "Location Admin A",
  email: "admin_loc_a@test.local",
  role: "admin",
  companyId: companyA
};
const emp1 = {
  id: "usr_emp_loc_1",
  name: "Chandru Location",
  email: "chandru_loc@test.local",
  role: "employee",
  companyId: companyA,
  shiftStart: "09:00",
  shiftEnd: "18:00"
};
const emp2 = {
  id: "usr_emp_loc_2",
  name: "Priya Location",
  email: "priya_loc@test.local",
  role: "employee",
  companyId: companyA,
  shiftStart: "09:00",
  shiftEnd: "18:00"
};
const adminB = {
  id: "usr_admin_loc_b",
  name: "Location Admin B",
  email: "admin_loc_b@test.local",
  role: "admin",
  companyId: companyB
};

let adminTokenA;
let emp1Token;
let emp2Token;
let adminTokenB;

describe("Attendance Location Reverse Geocoding & Date Column Suite", () => {
  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(PORT, resolve));
    baseUrl = `http://localhost:${PORT}/api`;

    // 1. Seed companies
    await query(
      `INSERT INTO companies (id, name, slug, latitude, longitude, allowed_radius_meters)
       VALUES ($1, 'Geo Corp A', 'geo-corp-a', 11.0168, 76.9558, 200)
       ON CONFLICT (id) DO UPDATE SET latitude = 11.0168, longitude = 76.9558, allowed_radius_meters = 200`,
      [companyA]
    );
    await query(
      `INSERT INTO companies (id, name, slug, latitude, longitude, allowed_radius_meters)
       VALUES ($1, 'Geo Corp B', 'geo-corp-b', NULL, NULL, NULL)
       ON CONFLICT (id) DO NOTHING`,
      [companyB]
    );

    // 2. Seed users
    await query(
      `INSERT INTO users (id, name, email, password_hash, role, company_id, shift_start, shift_end, department)
       VALUES ($1, $2, $3, 'hashed', 'admin', $4, '09:00', '18:00', 'Executive')
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
       VALUES ($1, $2, $3, 'hashed', 'employee', $4, '09:00', '18:00', 'Design')
       ON CONFLICT (id) DO NOTHING`,
      [emp2.id, emp2.name, emp2.email, companyA]
    );
    await query(
      `INSERT INTO users (id, name, email, password_hash, role, company_id, shift_start, shift_end, department)
       VALUES ($1, $2, $3, 'hashed', 'admin', $4, '09:00', '18:00', 'Operations')
       ON CONFLICT (id) DO NOTHING`,
      [adminB.id, adminB.name, adminB.email, companyB]
    );

    // 3. Clear existing test data
    await query(`DELETE FROM attendance WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM attendance_verification_sessions WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM attendance_verification_attempts WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM environment_settings WHERE company_id IN ($1, $2)`, [companyA, companyB]);

    adminTokenA = generateToken({ id: adminA.id, email: adminA.email, role: adminA.role, companyId: companyA });
    emp1Token = generateToken({ id: emp1.id, email: emp1.email, role: emp1.role, companyId: companyA });
    emp2Token = generateToken({ id: emp2.id, email: emp2.email, role: emp2.role, companyId: companyA });
    adminTokenB = generateToken({ id: adminB.id, email: adminB.email, role: adminB.role, companyId: companyB });
  });

  after(async () => {
    await query(`DELETE FROM attendance WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM attendance_verification_sessions WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM attendance_verification_attempts WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM environment_settings WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    clearAddressCache();
    await new Promise(resolve => server.close(resolve));
  });

  it("1. Reverse geocoding payload formatting: extracts and formats human-readable address", () => {
    const nominatimSample = {
      address: {
        road: "Cross Cut Road",
        suburb: "Gandhipuram",
        city: "Coimbatore",
        state_district: "Coimbatore",
        state: "Tamil Nadu",
        country: "India"
      }
    };
    const formatted = formatNominatimAddress(nominatimSample);
    assert.ok(formatted.includes("Gandhipuram"), "Must contain locality Gandhipuram");
    assert.ok(formatted.includes("Coimbatore"), "Must contain city Coimbatore");
    assert.ok(formatted.includes("Tamil Nadu"), "Must contain state Tamil Nadu");
    assert.ok(formatted.includes("India"), "Must contain country India");
  });

  it("2. Employee checks in with GPS enabled & Geofence enabled -> Verified status, coordinates & address stored", async () => {
    const rawToken = crypto.randomBytes(16).toString("hex");
    const tokenHash = hashToken(rawToken);
    const attemptId = `ava_loc_${Date.now()}_1`;
    const sessionId = `avs_loc_${Date.now()}_1`;

    // Seed verified attempt inside geofence
    await query(
      `INSERT INTO attendance_verification_attempts (
         id, user_id, company_id, work_mode, status, face_result, gps_result, liveness_result, attempted_at
       ) VALUES ($1, $2, $3, 'office', 'verified', 'matched', 'inside', 'live', NOW())`,
      [attemptId, emp1.id, companyA]
    );
    await query(
      `INSERT INTO attendance_verification_sessions (
         id, attempt_id, user_id, company_id, token_hash, status, expires_at, action_type
       ) VALUES ($1, $2, $3, $4, $5, 'issued', NOW() + INTERVAL '5 minutes', 'check-in')`,
      [sessionId, attemptId, emp1.id, companyA, tokenHash]
    );

    // Pre-cache known address for testing
    setCachedAddress(11.0168, 76.9558, "Gandhipuram, Coimbatore, Tamil Nadu, India");

    // Employee checks in with valid coordinates (11.0168, 76.9558)
    const checkInRes = await fetch(`${baseUrl}/attendance/check-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${emp1Token}` },
      body: JSON.stringify({
        verificationSessionToken: rawToken,
        location: {
          latitude: 11.0168,
          longitude: 76.9558,
          accuracy: 25,
          locationName: "Gandhipuram, Coimbatore, Tamil Nadu, India"
        }
      })
    });
    assert.strictEqual(checkInRes.status, 200);

    // Verify DB columns
    const dbRow = await query(`SELECT * FROM attendance WHERE user_id = $1 ORDER BY check_in DESC LIMIT 1`, [emp1.id]);
    const att = dbRow.rows[0];
    assert.ok(att, "Attendance row must exist");
    assert.strictEqual(Number(att.latitude), 11.0168);
    assert.strictEqual(Number(att.longitude), 76.9558);
    assert.strictEqual(Number(att.accuracy), 25);
    assert.strictEqual(att.resolved_address, "Gandhipuram, Coimbatore, Tamil Nadu, India");
    assert.strictEqual(att.location_status, "Verified");

    // Admin monitoring records API verification
    const monRes = await fetch(`${baseUrl}/attendance/monitoring/records?preset=today`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    const monData = await monRes.json();
    const rec = monData.records.find(r => r.userId === emp1.id);
    assert.ok(rec);
    assert.strictEqual(rec.gpsVerification, "Verified");
    assert.strictEqual(rec.latitude, 11.0168);
    assert.strictEqual(rec.longitude, 76.9558);
    assert.strictEqual(rec.place, "Gandhipuram, Coimbatore, Tamil Nadu, India");
    assert.strictEqual(rec.geofenceEnforcement, "Enabled");
    assert.strictEqual(rec.mapsUrl, "https://www.google.com/maps?q=11.0168,76.9558");
  });

  it("3. Employee checks in with GPS enabled & Geofence disabled -> Location Captured status (NOT Not Available)", async () => {
    // Disable geofencing for Company A in environment settings
    await query(`DELETE FROM environment_settings WHERE company_id = $1 AND key = 'geofence_settings'`, [companyA]);
    await query(
      `INSERT INTO environment_settings (id, company_id, category, key, value)
       VALUES ($1, $2, 'geofence', 'geofence_settings', '{"enable_geofencing": false, "enabled": false}'::jsonb)`,
      [`env_geo_${Date.now()}`, companyA]
    );

    const rawToken = crypto.randomBytes(16).toString("hex");
    const tokenHash = hashToken(rawToken);
    const attemptId = `ava_loc_${Date.now()}_2`;
    const sessionId = `avs_loc_${Date.now()}_2`;

    await query(
      `INSERT INTO attendance_verification_attempts (
         id, user_id, company_id, work_mode, status, face_result, gps_result, liveness_result, attempted_at
       ) VALUES ($1, $2, $3, 'office', 'verified', 'matched', 'not_required', 'live', NOW())`,
      [attemptId, emp2.id, companyA]
    );
    await query(
      `INSERT INTO attendance_verification_sessions (
         id, attempt_id, user_id, company_id, token_hash, status, expires_at, action_type
       ) VALUES ($1, $2, $3, $4, $5, 'issued', NOW() + INTERVAL '5 minutes', 'check-in')`,
      [sessionId, attemptId, emp2.id, companyA, tokenHash]
    );

    setCachedAddress(11.3715, 77.6445, "Villarasampatti, Erode, Tamil Nadu, India");

    const checkInRes = await fetch(`${baseUrl}/attendance/check-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${emp2Token}` },
      body: JSON.stringify({
        verificationSessionToken: rawToken,
        location: {
          latitude: 11.3715,
          longitude: 77.6445,
          accuracy: 45
        }
      })
    });
    assert.strictEqual(checkInRes.status, 200);

    const monRes = await fetch(`${baseUrl}/attendance/monitoring/records?preset=today`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    const monData = await monRes.json();
    const rec = monData.records.find(r => r.userId === emp2.id);
    assert.ok(rec);
    assert.strictEqual(rec.gpsVerification, "Location Captured", "Must be 'Location Captured' when geofencing is disabled");
    assert.strictEqual(rec.latitude, 11.3715);
    assert.strictEqual(rec.longitude, 77.6445);
    assert.strictEqual(rec.geofenceEnforcement, "Disabled");
    assert.strictEqual(rec.mapsUrl, "https://www.google.com/maps?q=11.3715,77.6445");
  });

  it("4. Employee denies GPS permission (no coordinates) -> Not Available status, no fabricated location", async () => {
    const rawToken = crypto.randomBytes(16).toString("hex");
    const tokenHash = hashToken(rawToken);
    const attemptId = `ava_loc_${Date.now()}_3`;
    const sessionId = `avs_loc_${Date.now()}_3`;
    const testDate = "2026-11-20";

    await query(
      `INSERT INTO attendance_verification_attempts (
         id, user_id, company_id, status, face_result, gps_result, liveness_result, attempted_at
       ) VALUES ($1, $2, $3, 'verified', 'matched', 'not_required', 'live', NOW())`,
      [attemptId, emp1.id, companyA]
    );
    await query(
      `INSERT INTO attendance_verification_sessions (
         id, attempt_id, user_id, company_id, token_hash, status, expires_at, action_type
       ) VALUES ($1, $2, $3, $4, $5, 'issued', NOW() + INTERVAL '5 minutes', 'check-in')`,
      [sessionId, attemptId, emp1.id, companyA, tokenHash]
    );

    // Check in with empty location
    const checkInRes = await fetch(`${baseUrl}/attendance/check-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${emp1Token}` },
      body: JSON.stringify({
        date: testDate,
        verificationSessionToken: rawToken,
        location: {
          latitude: null,
          longitude: null,
          accuracy: null,
          locationName: "Office / Remote (Location unavailable)"
        }
      })
    });
    assert.strictEqual(checkInRes.status, 200);

    const monRes = await fetch(`${baseUrl}/attendance/monitoring/records?preset=custom&dateFrom=${testDate}&dateTo=${testDate}`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    const monData = await monRes.json();
    const rec = monData.records.find(r => r.userId === emp1.id);
    assert.ok(rec);
    assert.strictEqual(rec.gpsVerification, "Not Available");
    assert.strictEqual(rec.latitude, null);
    assert.strictEqual(rec.longitude, null);
    assert.strictEqual(rec.mapsUrl, null);
  });

  it("5. Accuracy Insufficient: accuracy threshold exceeded (> 500m) -> Accuracy Insufficient status", async () => {
    const testDate = "2026-11-19";
    const attId = `${emp2.id}_${testDate}`;

    await query(
      `INSERT INTO attendance (
         id, user_id, company_id, date, check_in, status, latitude, longitude, accuracy, location_status, biometric_verified
       ) VALUES ($1, $2, $3, $4::date, $5, 'present', 11.0168, 76.9558, 850, 'Accuracy Insufficient', TRUE)`,
      [attId, emp2.id, companyA, testDate, `${testDate}T09:00:00.000Z`]
    );

    const monRes = await fetch(`${baseUrl}/attendance/monitoring/records?preset=custom&dateFrom=${testDate}&dateTo=${testDate}`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    const monData = await monRes.json();
    const rec = monData.records.find(r => r.userId === emp2.id);
    assert.ok(rec);
    assert.strictEqual(rec.gpsVerification, "Accuracy Insufficient");
    assert.strictEqual(rec.accuracy, 850);
  });

  it("6. Date Column present on every record across Today, Yesterday, and Multi-day ranges", async () => {
    const today = new Date().toISOString().split("T")[0];
    const monRes = await fetch(`${baseUrl}/attendance/monitoring/records?preset=this_month`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    assert.strictEqual(monRes.status, 200);
    const monData = await monRes.json();
    assert.ok(monData.records.length > 0, "Must contain attendance records");

    monData.records.forEach(rec => {
      assert.ok(rec.date, "date field must be present (YYYY-MM-DD)");
      assert.ok(rec.dateFormatted, "dateFormatted must be present (e.g. 23 Nov 2026)");
      assert.match(rec.dateFormatted, /\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/, "dateFormatted format must match 'DD Mon YYYY'");
    });
  });

  it("7. Reverse-geocode admin endpoint works with coordinates and updates attendance", async () => {
    const testLat = 13.0827;
    const testLon = 80.2707;
    setCachedAddress(testLat, testLon, "George Town, Chennai, Tamil Nadu, India");

    const res = await fetch(`${baseUrl}/attendance/monitoring/reverse-geocode`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminTokenA}` },
      body: JSON.stringify({ latitude: testLat, longitude: testLon })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.address, "George Town, Chennai, Tamil Nadu, India");
  });

  it("8. CSV export includes Date, GPS Status, Place, and Face Biometric columns", async () => {
    const res = await fetch(`${baseUrl}/attendance/monitoring/export-csv?preset=this_month`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    assert.strictEqual(res.status, 200);
    const csv = await res.text();
    const headerLine = csv.split("\n")[0];
    assert.ok(headerLine.includes("Date"), "CSV header must include 'Date'");
    assert.ok(headerLine.includes("GPS Status"), "CSV header must include 'GPS Status'");
    assert.ok(headerLine.includes("Location Place"), "CSV header must include 'Location Place'");
    assert.ok(headerLine.includes("Face Biometric"), "CSV header must include 'Face Biometric'");
  });

  it("9. Strict Tenant Isolation: Admin A cannot view Company B location details or records", async () => {
    const today = new Date().toISOString().split("T")[0];
    const attIdB = `${adminB.id}_${today}`;

    // Seed Company B attendance with location
    await query(
      `INSERT INTO attendance (id, user_id, company_id, date, check_in, status, latitude, longitude, resolved_address)
       VALUES ($1, $2, $3, $4::date, NOW(), 'present', 12.9716, 77.5946, 'MG Road, Bengaluru, Karnataka, India')
       ON CONFLICT (id) DO NOTHING`,
      [attIdB, adminB.id, companyB, today]
    );

    // Admin A queries
    const resA = await fetch(`${baseUrl}/attendance/monitoring/records?preset=today`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    const dataA = await resA.json();
    const hasCompanyBRecord = dataA.records.some(r => r.userId === adminB.id || r.place?.includes("Bengaluru"));
    assert.strictEqual(hasCompanyBRecord, false, "Company A admin must never receive Company B location records");
  });

  it("10. Biometric verification remains mandatory even when GPS location is captured", async () => {
    // Attempt check-in without biometric token -> blocked with 400
    const noBioRes = await fetch(`${baseUrl}/attendance/check-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${emp1Token}` },
      body: JSON.stringify({
        location: { latitude: 11.0168, longitude: 76.9558, accuracy: 20 }
      })
    });
    assert.strictEqual(noBioRes.status, 400);

    // Attempt check-in with invalid token -> blocked with 403
    const badBioRes = await fetch(`${baseUrl}/attendance/check-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${emp1Token}` },
      body: JSON.stringify({
        verificationSessionToken: "invalid_unissued_token",
        location: { latitude: 11.0168, longitude: 76.9558, accuracy: 20 }
      })
    });
    assert.strictEqual(badBioRes.status, 403);
  });
});
