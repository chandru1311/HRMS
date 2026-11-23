import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { query } from "../config/db.js";
import auditService from "./auditService.js";

/**
 * Format a Date object to "DD Mon YYYY" (e.g. 23 Nov 2026)
 */
export const formatDateReadable = (dateStr) => {
  if (!dateStr) return "Not Available";
  const s = String(dateStr).split("T")[0];
  const parts = s.split("-");
  if (parts.length !== 3) return s;
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${months[monthIdx] || parts[1]} ${year}`;
};

/**
 * Format HH:MM from ISO string or timestamp
 */
export const formatTimeHHMM = (isoStr) => {
  if (!isoStr) return "Not Available";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "Not Available";
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return "Not Available";
  }
};

/**
 * Calculate late and early departure minutes
 */
export const calculateLateAndEarly = (checkIn, checkOut, shiftStart = "10:00", shiftEnd = "19:00") => {
  let lateByMinutes = 0;
  let earlyDepartureMinutes = 0;

  if (checkIn) {
    try {
      const cIn = new Date(checkIn);
      const [sh, sm] = (shiftStart || "10:00").split(":").map(Number);
      const shiftIn = new Date(cIn);
      shiftIn.setUTCHours(sh, sm, 0, 0);

      const diffMs = cIn.getTime() - shiftIn.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins > 0) {
        lateByMinutes = diffMins;
      }
    } catch (_) {}
  }

  if (checkOut) {
    try {
      const cOut = new Date(checkOut);
      const [eh, em] = (shiftEnd || "19:00").split(":").map(Number);
      const shiftOut = new Date(cOut);
      shiftOut.setUTCHours(eh, em, 0, 0);

      const diffMs = shiftOut.getTime() - cOut.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins > 0) {
        earlyDepartureMinutes = diffMins;
      }
    } catch (_) {}
  }

  return { lateByMinutes, earlyDepartureMinutes };
};

/**
 * Evaluate GPS verification status
 */
export const evaluateGpsVerification = (att, isGeofenceEnabled = true) => {
  const loc = att.check_in_location || att.location || {};
  const lat = att.latitude != null ? att.latitude : loc.latitude;
  const lon = att.longitude != null ? att.longitude : loc.longitude;
  const accuracy = att.accuracy != null ? Number(att.accuracy) : (loc.accuracy != null ? Number(loc.accuracy) : null);

  if (lat == null || lon == null || lat === "" || lon === "") {
    return "Not Available";
  }

  if (accuracy != null && accuracy > 500) {
    return "Accuracy Insufficient";
  }

  if (att.location_status) {
    return att.location_status;
  }

  if (!isGeofenceEnabled) {
    return "Location Captured";
  }

  if (att.in_geofence === true) {
    return "Verified";
  }

  if (att.in_geofence === false) {
    return "Outside Geofence";
  }

  return "Verified";
};

/**
 * Evaluate Face Biometric verification status
 */
export const evaluateBiometricVerification = (att, attempt = null) => {
  if (att && att.biometric_verified === true) {
    return "Verified";
  }
  if (!attempt) {
    return "Not Available";
  }

  if (attempt.face_result === "mismatch") return "Face Mismatch";
  if (attempt.liveness_result === "failed") return "Liveness Failed";
  if (attempt.status === "failed") return "Failed";
  if (attempt.status === "verified" || attempt.face_result === "matched") return "Verified";
  if (attempt.status === "pending") return "Pending";

  return "Not Available";
};

/**
 * 18 Column Definitions required by the specification
 */
export const ATTENDANCE_REPORT_COLUMNS = [
  { key: "employeeId", header: "Employee ID", width: 14 },
  { key: "employeeName", header: "Employee Name", width: 22 },
  { key: "attendanceDate", header: "Attendance Date", width: 16 },
  { key: "department", header: "Department", width: 16 },
  { key: "designation", header: "Designation", width: 18 },
  { key: "shift", header: "Shift", width: 18 },
  { key: "checkInTime", header: "Check-In Time", width: 14 },
  { key: "checkOutTime", header: "Check-Out Time", width: 14 },
  { key: "workingHours", header: "Working Hours", width: 14 },
  { key: "lateArrival", header: "Late Arrival (Minutes)", width: 20 },
  { key: "earlyDeparture", header: "Early Departure (Minutes)", width: 22 },
  { key: "gpsStatus", header: "GPS Status", width: 18 },
  { key: "place", header: "Check-In Location / Place", width: 30 },
  { key: "latitude", header: "Latitude", width: 14 },
  { key: "longitude", header: "Longitude", width: 14 },
  { key: "accuracy", header: "GPS Accuracy", width: 14 },
  { key: "faceBiometric", header: "Face Biometric Status", width: 20 },
  { key: "attendanceStatus", header: "Attendance Status", width: 18 }
];

/**
 * Fetch and construct export dataset
 */
export async function fetchExportData({
  companyId,
  employeeId = null,
  startDate,
  endDate,
  tz = "Asia/Kolkata",
  isGeofenceEnabled = true
}) {
  // 1. Fetch Company Name
  const compRes = await query("SELECT name FROM companies WHERE id = $1 LIMIT 1", [companyId]);
  const companyName = compRes.rows[0]?.name || "Zuna HRMS Organization";

  // 2. Fetch Users
  let targetUser = null;
  const userMap = new Map();

  if (employeeId) {
    const userRes = await query(
      `SELECT id, name, email, employee_id, department, designation, shift_start, shift_end, role
       FROM users 
       WHERE company_id = $1 AND (id = $2 OR employee_id = $2)
       LIMIT 1`,
      [companyId, employeeId]
    );

    if (userRes.rows.length === 0) {
      return { error: "Employee not found in your company.", statusCode: 404 };
    }
    targetUser = userRes.rows[0];
    userMap.set(targetUser.id, targetUser);
  } else {
    const usersRes = await query(
      `SELECT id, name, email, employee_id, department, designation, shift_start, shift_end, role 
       FROM users 
       WHERE company_id = $1 AND role <> 'superadmin'
       ORDER BY name ASC`,
      [companyId]
    );
    usersRes.rows.forEach(u => userMap.set(u.id, u));
  }

  // 3. Fetch Attendance Records
  let attQuery = `
    SELECT * FROM attendance 
    WHERE company_id = $1 AND date >= $2::date AND date <= $3::date
  `;
  const attParams = [companyId, startDate, endDate];

  if (targetUser) {
    attQuery += ` AND user_id = $4`;
    attParams.push(targetUser.id);
  }
  attQuery += ` ORDER BY date DESC, check_in DESC`;

  const attRes = await query(attQuery, attParams);

  // 4. Fetch Biometric Attempts in date range
  const attemptsRes = await query(
    `SELECT id, user_id, status, face_result, gps_result, liveness_result, attempted_at
     FROM attendance_verification_attempts
     WHERE company_id = $1 AND attempted_at >= $2::date AND attempted_at <= ($3::date + INTERVAL '1 day')
     ORDER BY attempted_at DESC`,
    [companyId, startDate, endDate]
  );
  const attemptsByUserDate = new Map();
  attemptsRes.rows.forEach(att => {
    const dStr = new Date(att.attempted_at).toISOString().split("T")[0];
    const key = `${att.user_id}_${dStr}`;
    if (!attemptsByUserDate.has(key)) {
      attemptsByUserDate.set(key, att);
    }
  });

  // 5. If individual employee, compute summary metrics including leaves
  let summary = null;
  if (targetUser) {
    // Approved leaves in range
    const leavesRes = await query(
      `SELECT start_date, end_date, total_days, leave_type
       FROM leave_requests
       WHERE company_id = $1 AND user_id = $2 AND status = 'approved'
         AND start_date <= $4::date AND end_date >= $3::date`,
      [companyId, targetUser.id, startDate, endDate]
    );

    let leaveDays = 0;
    leavesRes.rows.forEach(l => {
      leaveDays += Number(l.total_days || 1);
    });

    // Calculate total days in range
    const sDate = new Date(startDate);
    const eDate = new Date(endDate);
    const diffTime = Math.abs(eDate - sDate);
    const totalDaysInRange = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    let presentDays = 0;
    let absentDays = 0;
    let lateArrivals = 0;
    let halfDays = 0;
    let totalWorkingMinutes = 0;

    attRes.rows.forEach(att => {
      const u = targetUser;
      const { lateByMinutes } = calculateLateAndEarly(att.check_in, att.check_out, u.shift_start, u.shift_end);
      if (lateByMinutes > 0) lateArrivals++;

      const st = String(att.status || "").toLowerCase();
      if (st === "half_day" || st === "half day") {
        halfDays++;
      } else if (st === "present") {
        presentDays++;
      } else if (st.includes("absent")) {
        absentDays++;
      } else if (att.check_in) {
        presentDays++;
      }

      const dur = Number(att.duration_minutes || att.accumulated_working_minutes) || 0;
      totalWorkingMinutes += dur;
    });

    summary = {
      totalWorkingDays: totalDaysInRange,
      presentDays,
      absentDays,
      lateArrivals,
      halfDays,
      leaveDays,
      totalWorkingHours: `${(totalWorkingMinutes / 60).toFixed(1)} hrs`
    };
  }

  // 6. Map to the 18 required report columns
  const formattedRecords = attRes.rows.map(att => {
    const u = userMap.get(att.user_id) || {};
    const { lateByMinutes, earlyDepartureMinutes } = calculateLateAndEarly(
      att.check_in,
      att.check_out,
      u.shift_start,
      u.shift_end
    );

    const dStr = att.date ? new Date(att.date).toISOString().split("T")[0] : "";
    const cIn = att.check_in ? formatTimeHHMM(att.check_in) : "Not Available";
    const cOut = att.check_out ? formatTimeHHMM(att.check_out) : "Not Available";
    const durMins = Number(att.duration_minutes || att.accumulated_working_minutes) || 0;
    const workingHours = durMins > 0 ? `${(durMins / 60).toFixed(2)} hrs` : "0.00 hrs";

    const loc = att.check_in_location || att.location || {};
    const lat = att.latitude != null ? String(att.latitude) : (loc.latitude != null ? String(loc.latitude) : "Not Available");
    const lon = att.longitude != null ? String(att.longitude) : (loc.longitude != null ? String(loc.longitude) : "Not Available");
    const accuracy = att.accuracy != null ? `${att.accuracy} m` : (loc.accuracy != null ? `${loc.accuracy} m` : "Not Available");
    const place = att.resolved_address || loc.locationName || (lat !== "Not Available" && lon !== "Not Available" ? `${lat}, ${lon}` : "Not Available");

    const gpsStatus = evaluateGpsVerification(att, isGeofenceEnabled);
    const attemptKey = `${att.user_id}_${dStr}`;
    const attempt = attemptsByUserDate.get(attemptKey);
    const faceBiometric = evaluateBiometricVerification(att, attempt);

    let statusLabel = att.status ? (att.status.charAt(0).toUpperCase() + att.status.slice(1)) : "Present";
    if (att.attendance_lock) statusLabel += " (Locked)";

    return {
      employeeId: u.employee_id || u.id || "Not Available",
      employeeName: u.name || "Not Available",
      attendanceDate: formatDateReadable(dStr),
      department: u.department || "Not Available",
      designation: u.designation || "Not Available",
      shift: `${u.shift_start || "10:00"} - ${u.shift_end || "19:00"}`,
      checkInTime: cIn,
      checkOutTime: cOut,
      workingHours,
      lateArrival: lateByMinutes,
      earlyDeparture: earlyDepartureMinutes,
      gpsStatus,
      place,
      latitude: lat,
      longitude: lon,
      accuracy,
      faceBiometric,
      attendanceStatus: statusLabel
    };
  });

  return {
    companyName,
    isIndividual: Boolean(targetUser),
    employee: targetUser,
    summary,
    startDate,
    endDate,
    records: formattedRecords,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Generate and stream CSV
 */
export function sendCsvExport(exportData, res) {
  const { companyName, isIndividual, employee, summary, startDate, endDate, records } = exportData;
  const filename = isIndividual
    ? `attendance_${employee.employee_id || employee.id}_${startDate}_to_${endDate}.csv`
    : `company_attendance_${startDate}_to_${endDate}.csv`;

  const lines = [];

  // Metadata comments for individual employee
  if (isIndividual && summary) {
    lines.push(`# ================================================================`);
    lines.push(`# ${companyName.toUpperCase()} - INDIVIDUAL ATTENDANCE REPORT`);
    lines.push(`# Employee: ${employee.name} (ID: ${employee.employee_id || employee.id})`);
    lines.push(`# Department: ${employee.department || "N/A"} | Designation: ${employee.designation || "N/A"}`);
    lines.push(`# Reporting Period: ${startDate} to ${endDate}`);
    lines.push(`# Summary: Working Days: ${summary.totalWorkingDays}, Present: ${summary.presentDays}, Absent: ${summary.absentDays}, Late Arrivals: ${summary.lateArrivals}, Half Days: ${summary.halfDays}, Leave Days: ${summary.leaveDays}, Total Hours: ${summary.totalWorkingHours}`);
    lines.push(`# ================================================================`);
    lines.push(``);
  }

  // 18 Column CSV Header
  const headers = ATTENDANCE_REPORT_COLUMNS.map(c => `"${c.header}"`).join(",");
  lines.push(headers);

  // Rows
  records.forEach(r => {
    const row = [
      `"${r.employeeId}"`,
      `"${r.employeeName}"`,
      `"${r.attendanceDate}"`,
      `"${r.department}"`,
      `"${r.designation}"`,
      `"${r.shift}"`,
      `"${r.checkInTime}"`,
      `"${r.checkOutTime}"`,
      `"${r.workingHours}"`,
      r.lateArrival,
      r.earlyDeparture,
      `"${r.gpsStatus}"`,
      `"${String(r.place).replace(/"/g, '""')}"`,
      `"${r.latitude}"`,
      `"${r.longitude}"`,
      `"${r.accuracy}"`,
      `"${r.faceBiometric}"`,
      `"${r.attendanceStatus}"`
    ];
    lines.push(row.join(","));
  });

  const csvContent = "\uFEFF" + lines.join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csvContent);
}

/**
 * Generate and stream Excel (.xlsx) using exceljs
 */
export async function sendExcelExport(exportData, res) {
  const { companyName, isIndividual, employee, summary, startDate, endDate, records } = exportData;
  const filename = isIndividual
    ? `attendance_${employee.employee_id || employee.id}_${startDate}_to_${endDate}.xlsx`
    : `company_attendance_${startDate}_to_${endDate}.xlsx`;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Zuna HRMS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(isIndividual ? "Employee Attendance" : "Company Attendance", {
    views: [{ showGridLines: true }]
  });

  let currentRow = 1;

  // Title Block
  const titleCell = sheet.getCell(`A${currentRow}`);
  titleCell.value = `${companyName.toUpperCase()} - ATTENDANCE REPORT`;
  titleCell.font = { name: "Arial", size: 14, bold: true, color: { argb: "1E3A8A" } };
  currentRow++;

  if (isIndividual && employee) {
    const empCell = sheet.getCell(`A${currentRow}`);
    empCell.value = `Employee: ${employee.name}  |  ID: ${employee.employee_id || employee.id}  |  Department: ${employee.department || "General"}  |  Designation: ${employee.designation || "N/A"}`;
    empCell.font = { name: "Arial", size: 10, bold: true, color: { argb: "334155" } };
    currentRow++;
  }

  const metaCell = sheet.getCell(`A${currentRow}`);
  metaCell.value = `Period: ${startDate} to ${endDate}  |  Generated on: ${new Date().toLocaleString()}  |  Total Records: ${records.length}`;
  metaCell.font = { name: "Arial", size: 9, italic: true, color: { argb: "64748B" } };
  currentRow += 2;

  // Individual Summary Box
  if (isIndividual && summary) {
    const sumTitle = sheet.getCell(`A${currentRow}`);
    sumTitle.value = "ATTENDANCE SUMMARY METRICS";
    sumTitle.font = { name: "Arial", size: 10, bold: true, color: { argb: "1E3A8A" } };
    currentRow++;

    const sumHeaders = ["Total Working Days", "Present Days", "Absent Days", "Late Arrivals", "Half Days", "Leave Days", "Total Working Hours"];
    const sumValues = [summary.totalWorkingDays, summary.presentDays, summary.absentDays, summary.lateArrivals, summary.halfDays, summary.leaveDays, summary.totalWorkingHours];

    const hRow = sheet.getRow(currentRow);
    sumHeaders.forEach((h, i) => {
      const cell = hRow.getCell(i + 1);
      cell.value = h;
      cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "0F172A" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F1F5F9" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "CBD5E1" } },
        bottom: { style: "thin", color: { argb: "CBD5E1" } },
        left: { style: "thin", color: { argb: "CBD5E1" } },
        right: { style: "thin", color: { argb: "CBD5E1" } }
      };
    });
    currentRow++;

    const vRow = sheet.getRow(currentRow);
    sumValues.forEach((v, i) => {
      const cell = vRow.getCell(i + 1);
      cell.value = v;
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "1E3A8A" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "CBD5E1" } },
        bottom: { style: "thin", color: { argb: "CBD5E1" } },
        left: { style: "thin", color: { argb: "CBD5E1" } },
        right: { style: "thin", color: { argb: "CBD5E1" } }
      };
    });
    currentRow += 2;
  }

  // 18 Columns Data Table Header
  const headerRow = sheet.getRow(currentRow);
  headerRow.height = 26;
  ATTENDANCE_REPORT_COLUMNS.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1E3A8A" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "medium", color: { argb: "0F172A" } },
      bottom: { style: "medium", color: { argb: "0F172A" } },
      left: { style: "thin", color: { argb: "475569" } },
      right: { style: "thin", color: { argb: "475569" } }
    };
  });
  currentRow++;

  // Data Rows
  records.forEach((r, rowIdx) => {
    const row = sheet.getRow(currentRow);
    row.height = 20;
    const isEven = rowIdx % 2 === 0;
    const bgColor = isEven ? "FFFFFF" : "F8FAFC";

    const values = [
      r.employeeId,
      r.employeeName,
      r.attendanceDate,
      r.department,
      r.designation,
      r.shift,
      r.checkInTime,
      r.checkOutTime,
      r.workingHours,
      r.lateArrival,
      r.earlyDeparture,
      r.gpsStatus,
      r.place,
      r.latitude,
      r.longitude,
      r.accuracy,
      r.faceBiometric,
      r.attendanceStatus
    ];

    values.forEach((val, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = val;
      cell.font = { name: "Arial", size: 8.5, color: { argb: "1E293B" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
      cell.border = {
        top: { style: "thin", color: { argb: "E2E8F0" } },
        bottom: { style: "thin", color: { argb: "E2E8F0" } },
        left: { style: "thin", color: { argb: "E2E8F0" } },
        right: { style: "thin", color: { argb: "E2E8F0" } }
      };

      // Alignment rules
      if (colIdx === 9 || colIdx === 10) {
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else if ([0, 2, 5, 6, 7, 8, 11, 15, 16, 17].includes(colIdx)) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }
    });

    currentRow++;
  });

  // Adjust column widths
  ATTENDANCE_REPORT_COLUMNS.forEach((col, idx) => {
    sheet.getColumn(idx + 1).width = Math.max(col.width, 12);
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}

/**
 * Generate and stream PDF (.pdf) using pdfkit
 */
export function sendPdfExport(exportData, res) {
  const { companyName, isIndividual, employee, summary, startDate, endDate, records } = exportData;
  const filename = isIndividual
    ? `attendance_${employee.employee_id || employee.id}_${startDate}_to_${endDate}.pdf`
    : `company_attendance_${startDate}_to_${endDate}.pdf`;

  // Landscape A4 (841.89 x 595.28 pt)
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 25,
    bufferPages: true
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const margin = 25;
  const contentWidth = pageWidth - margin * 2; // 791.89 pt

  // 18 Column Widths configured to cleanly fit 780pt printable area
  const colWidths = [
    42, // Emp ID
    62, // Emp Name
    48, // Date
    46, // Dept
    46, // Designation
    44, // Shift
    32, // In
    32, // Out
    34, // Hours
    26, // Late
    26, // Early
    46, // GPS
    74, // Place
    38, // Lat
    38, // Lon
    30, // Acc
    48, // Face
    46  // Status
  ]; // Sum = 778 pt

  // Top Banner
  doc.rect(margin, margin, contentWidth, 3).fill("#2563EB");
  doc.moveDown(0.3);

  doc.fontSize(14).font("Helvetica-Bold").fillColor("#0F172A").text(companyName.toUpperCase(), margin, margin + 8);
  doc.fontSize(9).font("Helvetica-Bold").fillColor("#2563EB").text("ATTENDANCE MONITORING REPORT", margin, margin + 26);

  let metaText = `Period: ${startDate} to ${endDate}  |  Generated on: ${new Date().toLocaleDateString()}  |  Total Records: ${records.length}`;
  if (isIndividual && employee) {
    metaText = `Employee: ${employee.name} (ID: ${employee.employee_id || employee.id})  |  Dept: ${employee.department || "General"}  |  Desig: ${employee.designation || "N/A"}\nPeriod: ${startDate} to ${endDate}  |  Generated on: ${new Date().toLocaleDateString()}`;
  }
  doc.fontSize(8).font("Helvetica").fillColor("#64748B").text(metaText, margin, margin + 38);

  let startY = isIndividual ? margin + 65 : margin + 55;

  // Render Individual Summary Cards
  if (isIndividual && summary) {
    const boxHeight = 28;
    doc.rect(margin, startY, contentWidth, boxHeight).fillAndStroke("#F8FAFC", "#CBD5E1");

    const sumItems = [
      `Total Days: ${summary.totalWorkingDays}`,
      `Present: ${summary.presentDays}`,
      `Absent: ${summary.absentDays}`,
      `Late Arrivals: ${summary.lateArrivals}`,
      `Half Days: ${summary.halfDays}`,
      `Leaves: ${summary.leaveDays}`,
      `Hours: ${summary.totalWorkingHours}`
    ];

    doc.fontSize(8).font("Helvetica-Bold").fillColor("#1E3A8A");
    const itemWidth = contentWidth / sumItems.length;
    sumItems.forEach((item, i) => {
      doc.text(item, margin + i * itemWidth, startY + 9, {
        width: itemWidth,
        align: "center"
      });
    });

    startY += boxHeight + 10;
  }

  // Draw Table Headers
  const drawTableHeader = (yPos) => {
    doc.rect(margin, yPos, contentWidth, 18).fill("#1E293B");
    doc.fontSize(6.5).font("Helvetica-Bold").fillColor("#FFFFFF");

    let currentX = margin;
    ATTENDANCE_REPORT_COLUMNS.forEach((col, idx) => {
      const w = colWidths[idx];
      doc.text(col.header, currentX + 1, yPos + 5, {
        width: w - 2,
        align: "center",
        ellipsis: true
      });
      currentX += w;
    });
  };

  drawTableHeader(startY);
  let currentY = startY + 18;

  // Draw Table Rows
  records.forEach((r, idx) => {
    // Check for page break
    if (currentY > pageHeight - margin - 30) {
      doc.addPage();
      drawTableHeader(margin + 10);
      currentY = margin + 28;
    }

    const rowHeight = 15;
    const isEven = idx % 2 === 0;
    doc.rect(margin, currentY, contentWidth, rowHeight).fill(isEven ? "#FFFFFF" : "#F8FAFC");
    doc.rect(margin, currentY, contentWidth, rowHeight).strokeColor("#E2E8F0").lineWidth(0.5).stroke();

    doc.fontSize(6).font("Helvetica").fillColor("#1E293B");

    const rowVals = [
      r.employeeId,
      r.employeeName,
      r.attendanceDate,
      r.department,
      r.designation,
      r.shift,
      r.checkInTime,
      r.checkOutTime,
      r.workingHours,
      String(r.lateArrival),
      String(r.earlyDeparture),
      r.gpsStatus,
      r.place,
      r.latitude,
      r.longitude,
      r.accuracy,
      r.faceBiometric,
      r.attendanceStatus
    ];

    let currentX = margin;
    rowVals.forEach((val, cIdx) => {
      const w = colWidths[cIdx];
      let align = "left";
      if (cIdx === 9 || cIdx === 10) align = "right";
      else if ([0, 2, 5, 6, 7, 8, 11, 15, 16, 17].includes(cIdx)) align = "center";

      doc.text(String(val || "N/A"), currentX + 2, currentY + 4, {
        width: w - 4,
        align,
        ellipsis: true
      });
      currentX += w;
    });

    currentY += rowHeight;
  });

  // Footer on all buffered pages
  const totalPages = doc.bufferedPageRange().count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    doc.fontSize(7).font("Helvetica").fillColor("#94A3B8");
    doc.text(
      `Page ${i + 1} of ${totalPages}  |  Zuna HRMS Confidential Attendance Record`,
      margin,
      pageHeight - margin - 12,
      { width: contentWidth, align: "center" }
    );
  }

  doc.end();
}
