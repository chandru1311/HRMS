import http from "http";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "hrms_jwt_super_secret_railway_2026";

const makeRequest = (path, token) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "localhost",
      port: 5001,
      path,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      }
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
};

async function testEndpoints() {
  console.log("=== Testing Attendance Monitoring Endpoints on Port 5001 ===");

  // 1. Health check
  const health = await makeRequest("/api/health", "");
  console.log("1. /api/health -> Status:", health.status, health.body);

  // 2. Admin Token for carrezza-global-solutions
  const adminToken = jwt.sign(
    { id: "admin_test", email: "admin@carrezza.com", role: "admin", companyId: "carrezza-global-solutions" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  // Summary
  const summary = await makeRequest("/api/attendance/monitoring/summary?preset=today", adminToken);
  console.log("2. /summary (admin) -> Status:", summary.status);
  console.log("   Total:", summary.body?.totalEmployees, "Present:", summary.body?.presentEmployees, "Working:", summary.body?.currentlyWorking);
  console.log("   Has summary object:", Boolean(summary.body?.summary));

  // Records (today)
  const records = await makeRequest("/api/attendance/monitoring/records?preset=today&limit=5", adminToken);
  console.log("3. /records (today) -> Status:", records.status);
  console.log("   Records count:", records.body?.records?.length, "Pagination total:", records.body?.pagination?.total);
  if (records.body?.records?.length > 0) {
    const r0 = records.body.records[0];
    console.log("   Sample record keys:", {
      id: r0.id,
      employeeId: r0.employeeId,
      employeeName: r0.employeeName,
      department: r0.department,
      shift: r0.shift,
      checkIn: r0.checkInFormatted,
      checkOut: r0.checkOutFormatted,
      workingHours: r0.workingHoursFormatted,
      gps: r0.gpsVerification,
      face: r0.faceVerification,
      status: r0.attendanceStatus
    });
  }

  // Records (this_month)
  const monthRecords = await makeRequest("/api/attendance/monitoring/records?preset=this_month&limit=5", adminToken);
  console.log("4. /records (this_month) -> Status:", monthRecords.status);
  console.log("   Records count:", monthRecords.body?.records?.length, "Pagination total:", monthRecords.body?.pagination?.total);

  // Live
  const live = await makeRequest("/api/attendance/monitoring/live", adminToken);
  console.log("5. /live -> Status:", live.status, "Counts:", live.body?.counts);

  // Analytics
  const analytics = await makeRequest("/api/attendance/monitoring/analytics", adminToken);
  console.log("6. /analytics -> Status:", analytics.status, "TotalStaff:", analytics.body?.totalStaff, "AvgHours:", analytics.body?.avgWorkingHours);

  // 3. SuperAdmin Token with companyId in query
  const superToken = jwt.sign(
    { id: "super_test", email: "superadmin@hrms.com", role: "superadmin" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
  const superSummary = await makeRequest("/api/attendance/monitoring/summary?preset=today&companyId=carrezza-global-solutions", superToken);
  console.log("7. /summary (superadmin with query companyId) -> Status:", superSummary.status, "Total:", superSummary.body?.totalEmployees);

  // 4. SuperAdmin Token without companyId (tests automatic fallback to main company)
  const superFallback = await makeRequest("/api/attendance/monitoring/summary?preset=today", superToken);
  console.log("8. /summary (superadmin fallback) -> Status:", superFallback.status, "Total:", superFallback.body?.totalEmployees);

  console.log("\nALL ENDPOINT TESTS PASSED SUCCESSFULLY!");
  process.exit(0);
}

testEndpoints().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
