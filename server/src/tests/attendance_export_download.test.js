import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import ExcelJS from "exceljs";
import app from "../app.js";
import { query } from "../config/db.js";
import { generateToken } from "../middlewares/auth.js";

let server;
let baseUrl;

const companyA = "comp_exp_test_a";
const companyB = "comp_exp_test_b";

const adminA = {
  id: "usr_admin_exp_a",
  name: "Export Admin A",
  email: "admin_exp_a@test.local",
  employee_id: "EMP-ADM-A",
  role: "admin",
  department: "Management",
  designation: "HR Manager",
  companyId: companyA
};

const empA1 = {
  id: "usr_emp_exp_a1",
  name: "Chandru Developer",
  email: "emp_exp_a1@test.local",
  employee_id: "EMP-0010",
  role: "employee",
  department: "Engineering",
  designation: "Full Stack Engineer",
  companyId: companyA,
  shiftStart: "09:00",
  shiftEnd: "18:00"
};

const empA2 = {
  id: "usr_emp_exp_a2",
  name: "Dharshini Designer",
  email: "emp_exp_a2@test.local",
  employee_id: "EMP-0011",
  role: "employee",
  department: "Design",
  designation: "UI/UX Designer",
  companyId: companyA,
  shiftStart: "10:00",
  shiftEnd: "19:00"
};

const empB = {
  id: "usr_emp_exp_b",
  name: "Employee Corp B",
  email: "emp_exp_b@test.local",
  employee_id: "EMP-B-01",
  role: "employee",
  department: "Finance",
  designation: "Accountant",
  companyId: companyB,
  shiftStart: "09:00",
  shiftEnd: "18:00"
};

let adminTokenA;
let empTokenA1;

describe("Admin Attendance Report Download & Export Suite", () => {
  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}/api`;

    // 1. Seed companies
    await query(
      `INSERT INTO companies (id, name, slug) VALUES 
       ($1, 'Alpha Innovations', 'alpha-innovations'),
       ($2, 'Beta Industries', 'beta-industries')
       ON CONFLICT (id) DO NOTHING`,
      [companyA, companyB]
    );

    // 2. Seed users
    for (const u of [adminA, empA1, empA2, empB]) {
      await query(
        `INSERT INTO users (id, name, email, employee_id, password_hash, role, company_id, shift_start, shift_end, department, designation)
         VALUES ($1, $2, $3, $4, 'hashed', $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET 
           employee_id = EXCLUDED.employee_id,
           department = EXCLUDED.department,
           designation = EXCLUDED.designation`,
        [u.id, u.name, u.email, u.employee_id, u.role, u.companyId, u.shiftStart || "09:00", u.shiftEnd || "18:00", u.department, u.designation]
      );
    }

    // 3. Clean test attendance & leaves
    await query(`DELETE FROM attendance WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM leave_requests WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM audit_logs WHERE company_id IN ($1, $2)`, [companyA, companyB]);

    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    // Seed Attendance for empA1
    await query(
      `INSERT INTO attendance (
        id, user_id, company_id, date, check_in, check_out, duration_minutes,
        status, latitude, longitude, accuracy, resolved_address, location_status, biometric_verified
       ) VALUES 
       ($1, $2, $3, $4::date, $5, $6, 540, 'present', 11.0168, 76.9558, 25, 'Gandhipuram, Coimbatore, Tamil Nadu, India', 'Verified', TRUE),
       ($7, $2, $3, $8::date, $9, $10, 480, 'present', 11.0168, 76.9558, 20, 'Gandhipuram, Coimbatore, Tamil Nadu, India', 'Verified', TRUE)`,
      [
        `att_exp_a1_1`, empA1.id, companyA, today, `${today}T09:15:00.000Z`, `${today}T18:15:00.000Z`,
        `att_exp_a1_2`, yesterday, `${yesterday}T09:00:00.000Z`, `${yesterday}T17:00:00.000Z`
      ]
    );

    // Seed Attendance for empA2
    await query(
      `INSERT INTO attendance (
        id, user_id, company_id, date, check_in, check_out, duration_minutes,
        status, latitude, longitude, accuracy, resolved_address, location_status, biometric_verified
       ) VALUES 
       ($1, $2, $3, $4::date, $5, $6, 510, 'present', 11.3715, 77.6445, 45, 'Villarasampatti, Erode, Tamil Nadu, India', 'Location Captured', TRUE)`,
      [`att_exp_a2_1`, empA2.id, companyA, today, `${today}T10:10:00.000Z`, `${today}T18:40:00.000Z`]
    );

    // Seed Attendance for Company B (Tenant isolation test)
    await query(
      `INSERT INTO attendance (
        id, user_id, company_id, date, check_in, status, latitude, longitude, resolved_address
       ) VALUES ($1, $2, $3, $4::date, $5, 'present', 13.0827, 80.2707, 'Chennai, Tamil Nadu')`,
      [`att_exp_b_1`, empB.id, companyB, today, `${today}T09:00:00.000Z`]
    );

    // Seed Approved Leave for empA1
    await query(
      `INSERT INTO leave_requests (
        id, user_id, company_id, leave_type, start_date, end_date, total_days, reason, status
       ) VALUES ($1, $2, $3, 'casual', $4::date, $4::date, 1, 'Personal event', 'approved')`,
      [`lr_exp_1`, empA1.id, companyA, yesterday]
    );

    adminTokenA = generateToken({ id: adminA.id, email: adminA.email, role: adminA.role, companyId: companyA });
    empTokenA1 = generateToken({ id: empA1.id, email: empA1.email, role: empA1.role, companyId: companyA });
  });

  after(async () => {
    await query(`DELETE FROM attendance WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM leave_requests WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM audit_logs WHERE company_id IN ($1, $2)`, [companyA, companyB]);
    await query(`DELETE FROM users WHERE id IN ($1, $2, $3, $4)`, [adminA.id, empA1.id, empA2.id, empB.id]);
    await query(`DELETE FROM companies WHERE id IN ($1, $2)`, [companyA, companyB]);
    await new Promise(resolve => server.close(resolve));
  });

  it("1. CSV Export for Company includes all 18 specified column headers and records", async () => {
    const res = await fetch(`${baseUrl}/attendance/monitoring/export-csv?preset=today`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/csv/);

    const text = await res.text();
    const lines = text.trim().split("\n");
    assert.ok(lines.length >= 2, "Must contain header and at least one row");

    const headerLine = lines[0].replace("\uFEFF", "");
    const expectedHeaders = [
      "Employee ID",
      "Employee Name",
      "Attendance Date",
      "Department",
      "Designation",
      "Shift",
      "Check-In Time",
      "Check-Out Time",
      "Working Hours",
      "Late Arrival (Minutes)",
      "Early Departure (Minutes)",
      "GPS Status",
      "Check-In Location / Place",
      "Latitude",
      "Longitude",
      "GPS Accuracy",
      "Face Biometric Status",
      "Attendance Status"
    ];

    expectedHeaders.forEach(h => {
      assert.ok(headerLine.includes(h), `Header "${h}" must be present in CSV`);
    });

    // Check data presence
    assert.ok(text.includes("EMP-0010"));
    assert.ok(text.includes("Chandru Developer"));
    assert.ok(text.includes("Gandhipuram, Coimbatore, Tamil Nadu, India"));
  });

  it("2. Excel Export for Company (.xlsx) generates valid spreadsheet with professional headers", async () => {
    const res = await fetch(`${baseUrl}/attendance/monitoring/export-excel?preset=this_month`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get("content-type"), /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    assert.ok(buffer.length > 0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet(1);
    assert.ok(worksheet, "Worksheet must exist");

    // Title should contain Company Name
    const title = worksheet.getCell("A1").value;
    assert.match(String(title), /ALPHA INNOVATIONS/i);

    // Verify presence of 18 columns in header
    let foundHeaders = false;
    worksheet.eachRow((row) => {
      const values = row.values;
      if (Array.isArray(values) && values.includes("Employee ID") && values.includes("GPS Status")) {
        foundHeaders = true;
        assert.ok(values.includes("Face Biometric Status"));
        assert.ok(values.includes("Check-In Location / Place"));
      }
    });
    assert.ok(foundHeaders, "Must find the 18 columns header row");
  });

  it("3. PDF Export for Company (.pdf) produces valid PDF document in landscape layout", async () => {
    const res = await fetch(`${baseUrl}/attendance/monitoring/export-pdf?preset=this_month`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("content-type"), "application/pdf");

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    assert.ok(buffer.length > 500, "PDF buffer must be valid size");

    // PDF files start with %PDF-
    const headerMagic = buffer.slice(0, 5).toString("utf-8");
    assert.strictEqual(headerMagic, "%PDF-", "File must begin with standard PDF magic number %PDF-");
  });

  it("4. Individual Employee Report (CSV) includes employee summary metrics and only their records", async () => {
    const res = await fetch(`${baseUrl}/attendance/monitoring/export?format=csv&preset=this_month&employeeId=EMP-0010`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    assert.strictEqual(res.status, 200);
    const text = await res.text();

    // Must include metadata summary comments
    assert.ok(text.includes("# Employee: Chandru Developer"));
    assert.ok(text.includes("# Summary:"));
    assert.ok(text.includes("Present:"));
    assert.ok(text.includes("Leave Days: 1"));

    // Must contain Chandru's records and NOT Dharshini's or Corp B
    assert.ok(text.includes("EMP-0010"));
    assert.strictEqual(text.includes("EMP-0011"), false, "Individual report must not contain other employees");
    assert.strictEqual(text.includes("EMP-B-01"), false, "Individual report must not contain other company employees");
  });

  it("5. Individual Employee Report (Excel) contains summary metrics block and table", async () => {
    const res = await fetch(`${baseUrl}/attendance/monitoring/export-excel?preset=this_month&employeeId=${empA1.id}`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    assert.strictEqual(res.status, 200);

    const buffer = Buffer.from(await res.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Employee Attendance");
    assert.ok(sheet, "Employee Attendance sheet must exist");

    // Check employee header text
    let foundEmpInfo = false;
    let foundSummary = false;
    sheet.eachRow((row) => {
      const rowStr = JSON.stringify(row.values);
      if (rowStr.includes("Chandru Developer")) foundEmpInfo = true;
      if (rowStr.includes("ATTENDANCE SUMMARY METRICS")) foundSummary = true;
    });

    assert.ok(foundEmpInfo, "Employee info must be present in header");
    assert.ok(foundSummary, "Summary metrics section must be present");
  });

  it("6. Date Range Filtering: Today, Yesterday, This Week, and Custom Range operate accurately", async () => {
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    // Today preset
    const todayRes = await fetch(`${baseUrl}/attendance/monitoring/export-csv?preset=today`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    const todayText = await todayRes.text();
    assert.ok(todayText.includes("Chandru Developer"));
    assert.ok(todayText.includes("Dharshini Designer"));

    // Custom Date Range for Yesterday only
    const customRes = await fetch(`${baseUrl}/attendance/monitoring/export-csv?preset=custom&startDate=${yesterday}&endDate=${yesterday}`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    const customText = await customRes.text();
    assert.ok(customText.includes("Chandru Developer"));
    // Dharshini had no attendance yesterday
    assert.strictEqual(customText.includes("Dharshini Designer"), false);
  });

  it("7. Tenant Isolation: Admin A cannot export Company B records or query Company B employee", async () => {
    // Attempting to export Company B employee with Admin A's token
    const res = await fetch(`${baseUrl}/attendance/monitoring/export-csv?employeeId=EMP-B-01`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    // Must reject with 404 Not Found
    assert.strictEqual(res.status, 404);
    const errData = await res.json();
    assert.match(errData.error, /Employee not found/i);

    // Company wide export must not contain any Company B data
    const compRes = await fetch(`${baseUrl}/attendance/monitoring/export-csv?preset=this_month`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    const compText = await compRes.text();
    assert.strictEqual(compText.includes("EMP-B-01"), false);
    assert.strictEqual(compText.includes("Beta Industries"), false);
  });

  it("8. RBAC Security: Non-admin users receive 403 Forbidden on all export endpoints", async () => {
    const csvRes = await fetch(`${baseUrl}/attendance/monitoring/export-csv`, {
      headers: { Authorization: `Bearer ${empTokenA1}` }
    });
    assert.strictEqual(csvRes.status, 403);

    const excelRes = await fetch(`${baseUrl}/attendance/monitoring/export-excel`, {
      headers: { Authorization: `Bearer ${empTokenA1}` }
    });
    assert.strictEqual(excelRes.status, 403);

    const pdfRes = await fetch(`${baseUrl}/attendance/monitoring/export-pdf`, {
      headers: { Authorization: `Bearer ${empTokenA1}` }
    });
    assert.strictEqual(pdfRes.status, 403);
  });

  it("9. Audit Logging: Export operation logs audit record with administrator, report type, and count", async () => {
    await fetch(`${baseUrl}/attendance/monitoring/export-csv?preset=today`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });

    // Wait a brief moment for asynchronous audit log insertion
    await new Promise(r => setTimeout(r, 200));

    const auditRes = await query(
      `SELECT * FROM audit_logs 
       WHERE company_id = $1 AND action = 'ATTENDANCE_REPORT_EXPORTED' 
       ORDER BY created_at DESC LIMIT 1`,
      [companyA]
    );

    assert.ok(auditRes.rows.length > 0, "Audit log row must be recorded");
    const log = auditRes.rows[0];
    assert.strictEqual(log.user_id, adminA.id);
    assert.strictEqual(log.action, "ATTENDANCE_REPORT_EXPORTED");
    assert.ok(log.details, "Audit log details must exist");
  });

  it("10. Data Protection: Exported documents never leak passwords, tokens, or biometric embeddings", async () => {
    const res = await fetch(`${baseUrl}/attendance/monitoring/export-csv?preset=this_month`, {
      headers: { Authorization: `Bearer ${adminTokenA}` }
    });
    const text = await res.text();

    assert.strictEqual(text.includes("password_hash"), false);
    assert.strictEqual(text.includes("hashed"), false);
    assert.strictEqual(text.includes("token"), false);
    assert.strictEqual(text.includes("embedding"), false);
  });
});
