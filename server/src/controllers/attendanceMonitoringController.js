import { query } from "../config/db.js";
import auditService from "../services/auditService.js";
import { sendNotificationOnce } from "../services/notificationService.js";
import { reverseGeocode } from "../services/reverseGeocodingService.js";
import {
  fetchExportData,
  sendCsvExport,
  sendExcelExport,
  sendPdfExport
} from "../services/attendanceExportService.js";

/**
 * Attendance Monitoring Controller
 * -------------------------------------------------------------
 * Powers the Admin Attendance Monitoring Module in Zuna HRMS:
 * - Real-time and historical attendance tracking
 * - GPS geofence & Biometric verification outcomes
 * - Shift-based late arrival & early departure calculations
 * - Multi-metric summaries, live presence, and analytics
 * - Regularization approval/rejection and manual corrections
 * - Strict tenant isolation & audit logging
 */

// Helper: Resolve effective company ID for tenant isolation
const resolveCompanyId = async (req) => {
  const role = (req.user?.role || "").toLowerCase();
  const isSuperAdmin = role === "superadmin" || (req.user?.email || "").toLowerCase().includes("superadmin@");

  let compId = req.user?.companyId || req.user?.company_id;

  // Superadmin can query specific company or defaults to requested companyId in query
  if (isSuperAdmin && req.query?.companyId) {
    return req.query.companyId;
  }

  // If companyId is not in token, look it up from the database for this user
  if (!compId && req.user?.id) {
    try {
      const uRes = await query("SELECT company_id FROM users WHERE id = $1 LIMIT 1", [req.user.id]);
      compId = uRes.rows[0]?.company_id;
    } catch (err) {
      console.warn("Could not query user company_id:", err.message);
    }
  }

  // If still not found (e.g. superadmin without explicit query param),
  // fallback to company with most attendance records
  if (!compId) {
    try {
      const fallbackRes = await query(
        `SELECT company_id, COUNT(*) as cnt FROM attendance WHERE company_id IS NOT NULL GROUP BY company_id ORDER BY cnt DESC LIMIT 1`
      );
      if (fallbackRes.rows.length > 0) {
        compId = fallbackRes.rows[0].company_id;
      } else {
        const firstComp = await query("SELECT id FROM companies ORDER BY created_at ASC LIMIT 1");
        compId = firstComp.rows[0]?.id || "carrezza-global-solutions";
      }
    } catch {
      compId = "carrezza-global-solutions";
    }
  }

  return compId;
};

// Helper: Resolve company timezone (defaults to Asia/Kolkata)
const getCompanyTimezone = async (companyId) => {
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

// Helper: Format Date to YYYY-MM-DD
const formatDateStr = (d, tz = "Asia/Kolkata") => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d instanceof Date ? d : new Date(d));
  } catch {
    return (d instanceof Date ? d : new Date(d)).toISOString().split("T")[0];
  }
};

// Helper: Format Date readable, e.g. "23 Nov 2026"
export const formatDateReadable = (dStr) => {
  if (!dStr) return "--";
  try {
    const parts = String(dStr).split("T")[0].split("-").map(Number);
    if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
      const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
      return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
    }
  } catch { }
  return String(dStr);
};

// Helper: Format Date long, e.g. "23 November 2026"
export const formatDateLong = (dStr) => {
  if (!dStr) return "--";
  try {
    const parts = String(dStr).split("T")[0].split("-").map(Number);
    if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
      const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
      return dt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    }
  } catch { }
  return String(dStr);
};

// Helper: Check if company enforces geofencing
export const getCompanyGeofenceEnabled = async (companyId) => {
  if (!companyId) return false;
  try {
    const settingsRes = await query(
      `SELECT key, value FROM environment_settings WHERE company_id = $1 AND key IN ('geofence_settings', 'general')`,
      [companyId]
    );
    let geofenceSettingsRow = null;
    let generalGeoSettings = null;
    for (const row of settingsRes.rows) {
      if (row.key === "geofence_settings" && row.value && typeof row.value === "object") geofenceSettingsRow = row.value;
      if (row.key === "general" && row.value?.geolocationSettings) generalGeoSettings = row.value.geolocationSettings;
    }
    if (geofenceSettingsRow?.enable_geofencing === false || geofenceSettingsRow?.enabled === false || generalGeoSettings?.enabled === false) {
      return false;
    }
    if (geofenceSettingsRow?.enable_geofencing === true || geofenceSettingsRow?.enabled === true || generalGeoSettings?.enabled === true) {
      return true;
    }
    const compRes = await query(`SELECT latitude, longitude, allowed_radius_meters FROM companies WHERE id = $1`, [companyId]);
    const compRow = compRes.rows[0];
    return Boolean(compRow && (compRow.latitude != null || compRow.longitude != null || compRow.allowed_radius_meters != null));
  } catch {
    return false;
  }
};

// Helper: Format Time string HH:MM
const formatTimeHHMM = (val) => {
  if (!val) return "";
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
  } catch { }
  return String(val);
};

// Helper: Parse HH:MM to total minutes from midnight
const parseTimeToMinutes = (timeStr) => {
  if (!timeStr) return null;
  const match = String(timeStr).match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
};

// Helper: Format minutes into "Xh Ym"
const formatDuration = (totalMinutes) => {
  if (!totalMinutes || isNaN(totalMinutes) || totalMinutes <= 0) return "0h 0m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes % 60);
  return `${hours}h ${minutes}m`;
};

// Helper: Resolve date range from request
const resolveDateRange = (reqQuery, tz = "Asia/Kolkata") => {
  const { preset = "today", date, dateFrom, dateTo, startDate, endDate } = reqQuery;
  const now = new Date();
  const todayStr = formatDateStr(now, tz);

  const customStart = startDate || dateFrom;
  const customEnd = endDate || dateTo;

  if (date) {
    return { startDate: date, endDate: date, isTodayRange: date === todayStr };
  }

  if (preset === "yesterday") {
    const yest = new Date(now.getTime() - 24 * 3600 * 1000);
    const yestStr = formatDateStr(yest, tz);
    return { startDate: yestStr, endDate: yestStr, isTodayRange: false };
  }

  if (preset === "this_week") {
    // Current week starting Monday
    const day = now.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const mon = new Date(now.getTime() + diffToMonday * 24 * 3600 * 1000);
    const sun = new Date(mon.getTime() + 6 * 24 * 3600 * 1000);
    return {
      startDate: formatDateStr(mon, tz),
      endDate: formatDateStr(sun, tz),
      isTodayRange: false
    };
  }

  if (preset === "this_month") {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
    return {
      startDate: `${year}-${month}-01`,
      endDate: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
      isTodayRange: false
    };
  }

  if (customStart || customEnd || preset === "custom") {
    const s = customStart || todayStr;
    const e = customEnd || customStart || todayStr;
    return {
      startDate: s,
      endDate: e,
      isTodayRange: s === todayStr && e === todayStr
    };
  }

  // Default: today
  return { startDate: todayStr, endDate: todayStr, isTodayRange: true };
};

// Helper: Calculate late arrival and early departure based on assigned shifts
const calculateLateAndEarly = (checkInIso, checkOutIso, shiftStart, shiftEnd, graceMinutes = 15) => {
  let lateByMinutes = 0;
  let earlyDepartureMinutes = 0;

  const defaultShiftStart = shiftStart || "10:00";
  const defaultShiftEnd = shiftEnd || "19:00";

  const shiftStartMins = parseTimeToMinutes(defaultShiftStart);
  const shiftEndMins = parseTimeToMinutes(defaultShiftEnd);

  if (checkInIso && shiftStartMins !== null) {
    const inDate = new Date(checkInIso);
    const inMins = inDate.getHours() * 60 + inDate.getMinutes();
    const diff = inMins - shiftStartMins;
    if (diff > graceMinutes) {
      lateByMinutes = diff;
    }
  }

  if (checkOutIso && shiftEndMins !== null) {
    const outDate = new Date(checkOutIso);
    const outMins = outDate.getHours() * 60 + outDate.getMinutes();
    const diff = shiftEndMins - outMins;
    if (diff > 0) {
      earlyDepartureMinutes = diff;
    }
  }

  return { lateByMinutes, earlyDepartureMinutes };
};

// Helper: Map GPS verification outcome according to business rules
export const evaluateGpsVerification = (att, attempt, isGeofenceEnabled = false) => {
  const attemptGps = (attempt?.gps_result || "").toLowerCase();
  const loc = att?.check_in_location || att?.location || {};

  const rawLat = att?.latitude ?? loc.latitude;
  const rawLon = att?.longitude ?? loc.longitude;
  const accuracy = att?.accuracy != null ? Number(att.accuracy) : (loc.accuracy != null ? Number(loc.accuracy) : null);
  const hasCoords = rawLat != null && rawLon != null && rawLat !== "" && rawLon !== "" && !isNaN(Number(rawLat)) && !isNaN(Number(rawLon)) && (Number(rawLat) !== 0 || Number(rawLon) !== 0);

  // 1. If no coordinates were captured (e.g. GPS denied or unavailable)
  if (!hasCoords) {
    if (attemptGps === "outside" || (loc.inGeofence === false && isGeofenceEnabled)) {
      return "Outside Geofence";
    }
    return "Not Available";
  }

  // 2. Accuracy threshold exceeded (>500m)
  if (accuracy !== null && accuracy > 500) {
    return "Accuracy Insufficient";
  }

  // 3. Explicit outside geofence failure
  if (attemptGps === "outside" || attemptGps === "failed" || attempt?.failure_category === "geofence_rejected" || (loc.inGeofence === false && isGeofenceEnabled)) {
    return "Outside Geofence";
  }

  // 4. Explicit attempt verified inside geofence
  if (attemptGps === "inside" || attemptGps === "verified" || attemptGps === "pass" || attemptGps === "passed") {
    return "Verified";
  }

  // 5. Stored explicit location_status from check-in
  if (att?.location_status && att.location_status !== "Not Available") {
    return att.location_status;
  }

  // 5. Geofence disabled -> Location Captured
  if (!isGeofenceEnabled || attemptGps === "not_required") {
    return "Location Captured";
  }

  // 6. Geofence enabled -> Verified
  return "Verified";
};

// Helper: Map Biometric & Liveness verification outcome
const evaluateBiometricVerification = (attempt, att) => {
  if (!attempt) {
    if (att?.biometric_verified === true || att?.verification_method === "FACE" || att?.verification_method === "BIOMETRIC") {
      return {
        faceVerification: "Verified",
        faceBiometricStatus: "Verified",
        livenessVerification: "Passed"
      };
    }
    return {
      faceVerification: "Not Available",
      faceBiometricStatus: "Not Available",
      livenessVerification: "Not Available"
    };
  }

  let faceVerification = "Not Available";
  let livenessVerification = "Not Available";

  const status = (attempt.status || "").toLowerCase();
  const faceRes = (attempt.face_result || "").toLowerCase();
  const failureCategory = (attempt.failure_category || "").toLowerCase();
  const livenessRes = (attempt.liveness_result || "").toLowerCase();

  // 1. Face Verification Evaluation
  if (status === "verified" || faceRes === "matched" || faceRes === "verified" || faceRes === "success" || faceRes === "passed") {
    faceVerification = "Verified";
  } else if (failureCategory === "liveness_failed" || livenessRes === "spoof" || livenessRes === "failed") {
    faceVerification = "Liveness Failed";
  } else if (faceRes === "not_matched" || failureCategory === "face_mismatch") {
    faceVerification = "Face Mismatch";
  } else if (failureCategory === "enrollment_missing") {
    faceVerification = "Not Enrolled";
  } else if (failureCategory === "no_face") {
    faceVerification = "No Face Detected";
  } else if (failureCategory === "multiple_faces") {
    faceVerification = "Multiple Faces";
  } else if (status === "failed") {
    faceVerification = "Verification Failed";
  } else if (status === "pending") {
    faceVerification = "Pending";
  } else if (status === "inconclusive") {
    faceVerification = "Inconclusive";
  }

  // 2. Liveness Evaluation
  if (livenessRes === "live" || livenessRes === "passed" || livenessRes === "success" || attempt.metadata?.livenessPassed === true) {
    livenessVerification = "Passed";
  } else if (livenessRes === "spoof" || livenessRes === "failed" || failureCategory === "liveness_failed") {
    livenessVerification = "Failed";
  } else if (livenessRes === "inconclusive") {
    livenessVerification = "Inconclusive";
  } else if (faceVerification === "Verified") {
    livenessVerification = "Passed";
  }

  return {
    faceVerification,
    faceBiometricStatus: faceVerification,
    livenessVerification
  };
};

// Helper: Check admin authorization
const authorizeAdmin = (req, res) => {
  const role = (req.user?.role || "").toLowerCase();
  const isAdmin = role === "admin" || role === "superadmin" || role === "hr manager" || role === "system admin";
  if (!isAdmin) {
    res.status(403).json({ error: "Access denied. Administrator privileges required." });
    return false;
  }
  return true;
};

// Helper: Format single attendance record row item
const formatAttendanceRow = (user, att, attempt, leave, rowDate, tz, isTodayRange, isGeofenceEnabled = false) => {
  const shiftStart = user.shift_start || "10:00";
  const shiftEnd = user.shift_end || "19:00";
  const shiftDisplay = `${shiftStart} - ${shiftEnd}`;

  let checkInTime = att?.check_in || null;
  let checkOutTime = att?.check_out || null;
  let durationMinutes = Number(att?.duration_minutes || att?.accumulated_working_minutes) || 0;

  if (!durationMinutes && checkInTime && checkOutTime) {
    durationMinutes = Math.max(0, Math.floor((new Date(checkOutTime) - new Date(checkInTime)) / 60000));
  } else if (!durationMinutes && checkInTime && !checkOutTime && isTodayRange) {
    durationMinutes = Math.max(0, Math.floor((Date.now() - new Date(checkInTime).getTime()) / 60000));
  }

  const { lateByMinutes, earlyDepartureMinutes } = calculateLateAndEarly(
    checkInTime,
    checkOutTime,
    shiftStart,
    shiftEnd
  );

  const gpsVerification = evaluateGpsVerification(att, attempt, isGeofenceEnabled);
  const { faceVerification, faceBiometricStatus, livenessVerification } = evaluateBiometricVerification(attempt, att);

  const loc = att?.check_in_location || att?.location || {};
  const lat = att?.latitude != null ? Number(att.latitude) : (loc.latitude != null ? Number(loc.latitude) : null);
  const lon = att?.longitude != null ? Number(att.longitude) : (loc.longitude != null ? Number(loc.longitude) : null);
  const accuracy = att?.accuracy != null ? Number(att.accuracy) : (loc.accuracy != null ? Number(loc.accuracy) : null);
  const hasCoords = lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon) && (lat !== 0 || lon !== 0);

  const resolvedAddress = att?.resolved_address || loc.locationName || loc.address || loc.resolved_address || (hasCoords ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : null);
  const place = resolvedAddress || (hasCoords ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : "Not Available");
  const mapsUrl = hasCoords ? `https://www.google.com/maps?q=${lat},${lon}` : null;
  const attDate = att?.date ? formatDateStr(att.date, tz) : rowDate;

  // Determine final comprehensive status
  let attendanceStatus = "Pending";
  if (att?.is_admin_locked) {
    attendanceStatus = "Attendance Locked";
  } else if (leave) {
    attendanceStatus = "On Leave";
  } else if (att?.status === "absent") {
    attendanceStatus = "Absent";
  } else if (checkInTime && !checkOutTime) {
    attendanceStatus = lateByMinutes > 0 ? "Late (Working)" : "Present (Working)";
  } else if (checkInTime && checkOutTime) {
    if (durationMinutes < 240) {
      attendanceStatus = "Half Day";
    } else if (lateByMinutes > 0) {
      attendanceStatus = "Late";
    } else {
      attendanceStatus = "Present";
    }
  } else if (isTodayRange) {
    attendanceStatus = "Not Checked In";
  } else {
    attendanceStatus = "Absent";
  }

  return {
    id: att?.id || `${user.id}_${rowDate}`,
    attendanceId: att?.id || null,
    userId: user.id,
    employeeId: user.employee_id || user.id,
    employeeName: user.name,
    employeeEmail: user.email,
    avatarUrl: user.avatar_url || "",
    department: user.department || "General",
    designation: user.designation || "Staff",
    shift: shiftDisplay,
    shiftStart,
    shiftEnd,
    date: attDate,
    dateFormatted: formatDateReadable(attDate),
    dateLongFormatted: formatDateLong(attDate),
    latitude: hasCoords ? lat : null,
    longitude: hasCoords ? lon : null,
    accuracy: accuracy,
    accuracyFormatted: accuracy != null ? `${Math.round(accuracy)} metres` : "Not Available",
    place,
    resolvedAddress,
    locationStatus: gpsVerification,
    geofenceEnforcement: isGeofenceEnabled ? "Enabled" : "Disabled",
    mapsUrl,
    checkIn: checkInTime,
    checkOut: checkOutTime,
    checkInFormatted: checkInTime ? formatTimeHHMM(checkInTime) : "--:--",
    checkOutFormatted: checkOutTime ? formatTimeHHMM(checkOutTime) : "--:--",
    workingHoursMinutes: durationMinutes,
    workingHoursFormatted: formatDuration(durationMinutes),
    lateByMinutes,
    earlyDepartureMinutes,
    gpsVerification,
    faceVerification,
    faceBiometricStatus,
    livenessVerification,
    attendanceStatus,
    isAdminLocked: Boolean(att?.is_admin_locked),
    penaltyStatus: att?.penalty_status || null,
    penaltyReason: att?.penalty_reason || null,
    autoCheckedOut: Boolean(att?.auto_checked_out),
    isRegularized: Boolean(att?.is_regularized),
    breaks: Array.isArray(att?.breaks) ? att.breaks : []
  };
};

// -------------------------------------------------------------
// 1. GET /api/attendance/monitoring/summary
// -------------------------------------------------------------
export const getMonitoringSummary = async (req, res) => {
  try {
    if (!authorizeAdmin(req, res)) return;

    const companyId = await resolveCompanyId(req);
    const tz = await getCompanyTimezone(companyId);
    const isGeofenceEnabled = await getCompanyGeofenceEnabled(companyId);
    const { startDate, endDate, isTodayRange } = resolveDateRange(req.query, tz);
    const { department, employeeId } = req.query;

    // 1. Query Total Active Employees in Company
    let empSql = `SELECT id, name, department, shift_start, shift_end FROM users WHERE company_id = $1 AND (status IS NULL OR status = 'active') AND role <> 'superadmin'`;
    const empParams = [companyId];
    if (department && department !== "all") {
      empParams.push(department);
      empSql += ` AND department = $${empParams.length}`;
    }
    if (employeeId && employeeId !== "all") {
      empParams.push(employeeId);
      empSql += ` AND (id = $${empParams.length} OR employee_id = $${empParams.length})`;
    }
    const empRes = await query(empSql, empParams);
    const totalEmployees = empRes.rows.length;
    const empIds = empRes.rows.map(e => e.id);

    const emptySummary = {
      totalEmployees: 0,
      presentEmployees: 0,
      absentEmployees: 0,
      lateArrivals: 0,
      currentlyWorking: 0,
      checkedOut: 0,
      onLeave: 0,
      pendingRegularizations: 0,
      startDate,
      endDate
    };

    if (totalEmployees === 0) {
      return res.json({
        summary: emptySummary,
        ...emptySummary
      });
    }

    // 2. Query Attendance in range
    let attSql = `
      SELECT id, user_id, date, status, check_in, check_out, duration_minutes,
             accumulated_working_minutes, is_admin_locked, penalty_status
      FROM attendance
      WHERE company_id = $1 AND date >= $2::date AND date <= $3::date
    `;
    const attParams = [companyId, startDate, endDate];
    const attRes = await query(attSql, attParams);

    // 3. Query Approved Leaves in range
    const leaveRes = await query(
      `SELECT user_id, start_date, end_date FROM leave_requests 
       WHERE company_id = $1 AND status = 'approved' AND start_date <= $2::date AND end_date >= $3::date`,
      [companyId, endDate, startDate]
    );
    const onLeaveUserIds = new Set(leaveRes.rows.map(r => r.user_id));

    // 4. Query Pending Regularizations
    const regRes = await query(
      `SELECT COUNT(*)::int as count FROM regularization_requests 
       WHERE company_id = $1 AND status = 'pending'`,
      [companyId]
    );
    const pendingRegularizations = regRes.rows[0]?.count || 0;

    // Build user shift map
    const userMap = new Map();
    empRes.rows.forEach(u => userMap.set(u.id, u));

    // Aggregate statistics uniquely by user_id to prevent double counting
    const presentUserIds = new Set();
    const absentUserIds = new Set();
    const lateUserIds = new Set();
    const currentlyWorkingUserIds = new Set();
    const checkedOutUserIds = new Set();
    const recordedUsers = new Set();

    attRes.rows.forEach(row => {
      if (!userMap.has(row.user_id)) return;
      recordedUsers.add(row.user_id);
      const user = userMap.get(row.user_id);

      const hasCheckIn = Boolean(row.check_in);
      const hasCheckOut = Boolean(row.check_out);
      const isLocked = Boolean(row.is_admin_locked);
      const isAbsent = row.status === "absent";

      if (isAbsent || isLocked) {
        absentUserIds.add(row.user_id);
      } else if (hasCheckIn) {
        presentUserIds.add(row.user_id);
        if (hasCheckOut) {
          checkedOutUserIds.add(row.user_id);
        } else {
          currentlyWorkingUserIds.add(row.user_id);
        }

        const { lateByMinutes } = calculateLateAndEarly(row.check_in, row.check_out, user.shift_start, user.shift_end);
        if (lateByMinutes > 0) {
          lateUserIds.add(row.user_id);
        }
      }
    });

    // Employees with NO attendance record in range:
    // If on approved leave -> counted as onLeave.
    // If not on leave and date is in past -> absent.
    empIds.forEach(uid => {
      if (!recordedUsers.has(uid)) {
        if (!onLeaveUserIds.has(uid) && !isTodayRange) {
          absentUserIds.add(uid);
        }
      }
    });

    const summaryData = {
      totalEmployees,
      presentEmployees: presentUserIds.size,
      absentEmployees: absentUserIds.size,
      lateArrivals: lateUserIds.size,
      currentlyWorking: currentlyWorkingUserIds.size,
      checkedOut: checkedOutUserIds.size,
      onLeave: onLeaveUserIds.size,
      pendingRegularizations,
      startDate,
      endDate
    };

    res.json({
      summary: summaryData,
      ...summaryData
    });
  } catch (err) {
    console.error("getMonitoringSummary error:", err);
    res.status(500).json({ error: "Failed to fetch attendance monitoring summary." });
  }
};

// -------------------------------------------------------------
// 2. GET /api/attendance/monitoring/records
// -------------------------------------------------------------
export const getMonitoringRecords = async (req, res) => {
  try {
    if (!authorizeAdmin(req, res)) return;

    const companyId = await resolveCompanyId(req);
    const tz = await getCompanyTimezone(companyId);
    const isGeofenceEnabled = await getCompanyGeofenceEnabled(companyId);
    const { startDate, endDate, isTodayRange } = resolveDateRange(req.query, tz);
    const {
      department,
      employeeId,
      status,
      search = "",
      page = 1,
      limit = 20,
      sortBy = "check_in",
      sortOrder = "desc"
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    // Base query for active company employees
    let userSql = `
      SELECT id, name, email, employee_id, department, designation, avatar_url,
             shift_start, shift_end, role, status as user_status
      FROM users
      WHERE company_id = $1 AND (status IS NULL OR status = 'active') AND role <> 'superadmin'
    `;
    const userParams = [companyId];

    if (department && department !== "all") {
      userParams.push(department);
      userSql += ` AND department = $${userParams.length}`;
    }
    if (employeeId && employeeId !== "all") {
      userParams.push(employeeId);
      userSql += ` AND (id = $${userParams.length} OR employee_id = $${userParams.length})`;
    }
    if (search && search.trim()) {
      userParams.push(`%${search.trim().toLowerCase()}%`);
      userSql += ` AND (LOWER(name) LIKE $${userParams.length} OR LOWER(email) LIKE $${userParams.length} OR LOWER(COALESCE(employee_id, '')) LIKE $${userParams.length})`;
    }

    const usersRes = await query(userSql, userParams);
    const users = usersRes.rows;
    if (users.length === 0) {
      return res.json({
        records: [],
        pagination: { total: 0, page: pageNum, limit: pageSize, totalPages: 0 }
      });
    }

    const userMap = new Map();
    users.forEach(u => userMap.set(u.id, u));
    const userIds = users.map(u => u.id);

    // Fetch attendance records for these users in the date range
    const attSql = `
      SELECT a.*, a.id as attendance_id
      FROM attendance a
      WHERE a.company_id = $1
        AND a.user_id = ANY($2::text[])
        AND a.date >= $3::date AND a.date <= $4::date
      ORDER BY a.date DESC, a.check_in DESC NULLS LAST, a.created_at DESC
    `;
    const attRes = await query(attSql, [companyId, userIds, startDate, endDate]);

    // Fetch verification attempts linked specifically to each attendance record
    const attIds = attRes.rows.map(a => a.id);
    const attemptByAttId = new Map();

    if (attIds.length > 0) {
      const matchedAttemptsRes = await query(
        `SELECT DISTINCT ON (a.id)
           a.id as attendance_id,
           ava.id as attempt_id,
           ava.user_id,
           ava.company_id,
           ava.status as attempt_status,
           ava.face_result,
           ava.liveness_result,
           ava.failure_category,
           ava.gps_result,
           ava.model,
           ava.metadata as attempt_metadata,
           ava.attempted_at
         FROM attendance a
         LEFT JOIN attendance_verification_sessions s
           ON s.user_id = a.user_id
          AND s.company_id = a.company_id
          AND s.status = 'consumed'
          AND s.action_type = 'check-in'
          AND (
            (a.metadata->>'verificationSessionId' IS NOT NULL AND s.id = a.metadata->>'verificationSessionId')
            OR
            (a.check_in IS NOT NULL AND ABS(EXTRACT(EPOCH FROM (a.check_in - s.consumed_at))) <= 120)
          )
         LEFT JOIN attendance_verification_attempts ava
           ON (
             (a.metadata->>'verificationAttemptId' IS NOT NULL AND ava.id = a.metadata->>'verificationAttemptId')
             OR
             (s.attempt_id IS NOT NULL AND ava.id = s.attempt_id)
             OR
             (a.check_in IS NOT NULL AND ava.user_id = a.user_id AND ava.company_id = a.company_id AND ABS(EXTRACT(EPOCH FROM (a.check_in - ava.attempted_at))) <= 120)
           )
         WHERE a.company_id = $1
           AND a.id = ANY($2::text[])
           AND ava.id IS NOT NULL
         ORDER BY a.id, ABS(EXTRACT(EPOCH FROM (a.check_in - COALESCE(s.consumed_at, ava.attempted_at)))) ASC`,
        [companyId, attIds]
      ).catch(err => {
        console.warn("Could not match verification attempts:", err.message);
        return { rows: [] };
      });

      matchedAttemptsRes.rows.forEach(row => {
        attemptByAttId.set(row.attendance_id, row);
      });
    }

    // Also fetch latest verification attempt per user for today's attempts (e.g. unclocked staff with verification failures)
    const todayAttemptsRes = await query(
      `SELECT DISTINCT ON (user_id) *
       FROM attendance_verification_attempts
       WHERE company_id = $1 AND user_id = ANY($2::text[]) AND attempted_at >= $3::date
       ORDER BY user_id, attempted_at DESC`,
      [companyId, userIds, startDate]
    ).catch(() => ({ rows: [] }));
    const latestAttemptByUser = new Map();
    todayAttemptsRes.rows.forEach(a => latestAttemptByUser.set(a.user_id, a));

    // Fetch approved leaves in range
    const leaveRes = await query(
      `SELECT user_id, leave_type, reason, start_date, end_date
       FROM leave_requests
       WHERE company_id = $1 AND status = 'approved' AND user_id = ANY($2::text[])
         AND start_date <= $3::date AND end_date >= $4::date`,
      [companyId, userIds, endDate, startDate]
    ).catch(() => ({ rows: [] }));
    const leaveMap = new Map();
    leaveRes.rows.forEach(l => leaveMap.set(l.user_id, l));

    const combinedList = [];

    if (startDate === endDate) {
      // Single day (Today, Yesterday, or specific date): show all company staff status
      const attByUserId = new Map();
      attRes.rows.forEach(att => {
        if (!attByUserId.has(att.user_id)) {
          attByUserId.set(att.user_id, att);
        }
      });

      users.forEach(user => {
        const att = attByUserId.get(user.id);
        const attempt = att ? (attemptByAttId.get(att.id) || null) : (latestAttemptByUser.get(user.id) || null);
        const leave = leaveMap.get(user.id);
        const rowItem = formatAttendanceRow(user, att, attempt, leave, startDate, tz, isTodayRange, isGeofenceEnabled);

        // Status filter
        if (status && status !== "all") {
          const normStatus = status.toLowerCase();
          const normActual = rowItem.attendanceStatus.toLowerCase();
          if (!normActual.includes(normStatus)) return;
        }

        combinedList.push(rowItem);
      });
    } else {
      // Multi-day range (This Week, This Month, Custom):
      // Emit every attendance record present in range
      const addedRowKeys = new Set();

      attRes.rows.forEach(att => {
        const user = userMap.get(att.user_id);
        if (!user) return;
        const attempt = attemptByAttId.get(att.id) || null;
        const attDateStr = formatDateStr(att.date, tz);
        const leave = leaveMap.get(att.user_id);
        const rowItem = formatAttendanceRow(user, att, attempt, leave, attDateStr, tz, attDateStr === formatDateStr(new Date(), tz), isGeofenceEnabled);

        if (status && status !== "all") {
          const normStatus = status.toLowerCase();
          const normActual = rowItem.attendanceStatus.toLowerCase();
          if (!normActual.includes(normStatus)) return;
        }

        addedRowKeys.add(`${user.id}_${attDateStr}`);
        combinedList.push(rowItem);
      });

      // Also include users on approved leave who had no attendance check-in
      leaveRes.rows.forEach(leave => {
        const user = userMap.get(leave.user_id);
        if (!user) return;
        const leaveStart = formatDateStr(leave.start_date, tz);
        const key = `${user.id}_${leaveStart}`;
        if (!addedRowKeys.has(key)) {
          const rowItem = formatAttendanceRow(user, null, null, leave, leaveStart, tz, false, isGeofenceEnabled);
          if (status && status !== "all") {
            const normStatus = status.toLowerCase();
            const normActual = rowItem.attendanceStatus.toLowerCase();
            if (!normActual.includes(normStatus)) return;
          }
          addedRowKeys.add(key);
          combinedList.push(rowItem);
        }
      });
    }

    // Sorting
    combinedList.sort((a, b) => {
      let aVal = a[sortBy] ?? "";
      let bVal = b[sortBy] ?? "";
      if (sortBy === "workingHours" || sortBy === "workingHoursMinutes") {
        aVal = a.workingHoursMinutes;
        bVal = b.workingHoursMinutes;
      }
      if (sortOrder === "asc") {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      }
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
    });

    const total = combinedList.length;
    const startIndex = (pageNum - 1) * pageSize;
    const paginatedRecords = combinedList.slice(startIndex, startIndex + pageSize);

    res.json({
      records: paginatedRecords,
      pagination: {
        total,
        page: pageNum,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (err) {
    console.error("getMonitoringRecords error:", err);
    res.status(500).json({ error: "Failed to fetch attendance monitoring records." });
  }
};

// -------------------------------------------------------------
// 3. GET /api/attendance/monitoring/live
// -------------------------------------------------------------
export const getMonitoringLive = async (req, res) => {
  try {
    if (!authorizeAdmin(req, res)) return;

    const companyId = await resolveCompanyId(req);
    const tz = await getCompanyTimezone(companyId);
    const today = formatDateStr(new Date(), tz);

    // Active employees
    const usersRes = await query(
      `SELECT id, name, email, employee_id, department, designation, avatar_url, shift_start, shift_end 
       FROM users 
       WHERE company_id = $1 AND (status IS NULL OR status = 'active') AND role <> 'superadmin'`,
      [companyId]
    );

    // Today's attendance
    const attRes = await query(
      `SELECT a.* FROM attendance a WHERE a.company_id = $1 AND a.date = $2::date`,
      [companyId, today]
    );

    // Approved leaves for today
    const leaveRes = await query(
      `SELECT user_id, leave_type FROM leave_requests 
       WHERE company_id = $1 AND status = 'approved' AND start_date <= $2::date AND end_date >= $2::date`,
      [companyId, today]
    ).catch(() => ({ rows: [] }));
    const leaveSet = new Set(leaveRes.rows.map(l => l.user_id));

    const attMap = new Map();
    attRes.rows.forEach(a => attMap.set(a.user_id, a));

    const currentlyWorking = [];
    const notCheckedIn = [];
    const checkedOut = [];
    const lateToday = [];
    const onLeaveToday = [];

    usersRes.rows.forEach(u => {
      const att = attMap.get(u.id);
      const isLeave = leaveSet.has(u.id);

      if (isLeave) {
        onLeaveToday.push({
          userId: u.id,
          employeeId: u.employee_id || u.id,
          name: u.name,
          department: u.department,
          avatarUrl: u.avatar_url,
          status: "On Leave"
        });
        return;
      }

      if (!att || !att.check_in) {
        notCheckedIn.push({
          userId: u.id,
          employeeId: u.employee_id || u.id,
          name: u.name,
          department: u.department,
          avatarUrl: u.avatar_url,
          shiftStart: u.shift_start || "10:00",
          shiftEnd: u.shift_end || "19:00",
          status: "Not Checked In"
        });
        return;
      }

      const { lateByMinutes } = calculateLateAndEarly(att.check_in, att.check_out, u.shift_start, u.shift_end);

      const recordItem = {
        userId: u.id,
        attendanceId: att.id,
        employeeId: u.employee_id || u.id,
        name: u.name,
        department: u.department,
        avatarUrl: u.avatar_url,
        checkIn: att.check_in,
        checkInFormatted: formatTimeHHMM(att.check_in),
        checkOut: att.check_out,
        checkOutFormatted: att.check_out ? formatTimeHHMM(att.check_out) : null,
        durationMinutes: att.duration_minutes || Math.max(0, Math.floor((Date.now() - new Date(att.check_in).getTime()) / 60000)),
        lateByMinutes,
        isAdminLocked: Boolean(att.is_admin_locked)
      };

      if (lateByMinutes > 0) {
        lateToday.push(recordItem);
      }

      if (att.check_out) {
        checkedOut.push(recordItem);
      } else {
        currentlyWorking.push(recordItem);
      }
    });

    res.json({
      lastRefreshedAt: new Date().toISOString(),
      today,
      counts: {
        working: currentlyWorking.length,
        notCheckedIn: notCheckedIn.length,
        checkedOut: checkedOut.length,
        late: lateToday.length,
        onLeave: onLeaveToday.length
      },
      currentlyWorking,
      notCheckedIn,
      checkedOut,
      lateToday,
      onLeaveToday
    });
  } catch (err) {
    console.error("getMonitoringLive error:", err);
    res.status(500).json({ error: "Failed to fetch live attendance status." });
  }
};

// -------------------------------------------------------------
// 4. GET /api/attendance/monitoring/employee/:userId
// -------------------------------------------------------------
export const getEmployeeAttendanceProfile = async (req, res) => {
  try {
    if (!authorizeAdmin(req, res)) return;

    const { userId } = req.params;
    const companyId = await resolveCompanyId(req);

    // Verify employee belongs to company (tenant isolation)
    const userRes = await query(
      `SELECT id, name, email, employee_id, department, designation, avatar_url,
              shift_start, shift_end, role, status, created_at
       FROM users WHERE id = $1 AND company_id = $2`,
      [userId, companyId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found." });
    }
    const employee = userRes.rows[0];

    // Attendance records (last 30 days)
    const attRes = await query(
      `SELECT a.* 
       FROM attendance a 
       WHERE a.user_id = $1 AND a.company_id = $2 
       ORDER BY a.date DESC, a.check_in DESC NULLS LAST 
       LIMIT 30`,
      [userId, companyId]
    );

    // Verification attempts for this user (sanitized, no raw biometric data)
    const verifyRes = await query(
      `SELECT id, work_mode, status, failure_category, gps_result, face_result, liveness_result,
              review_status, review_decision, review_note, attempted_at, created_at
       FROM attendance_verification_attempts
       WHERE user_id = $1 AND company_id = $2
       ORDER BY created_at DESC LIMIT 20`,
      [userId, companyId]
    ).catch(() => ({ rows: [] }));

    // Regularization requests for this employee
    const regRes = await query(
      `SELECT id, attendance_date, requested_check_in, requested_check_out, reason,
              status, manager_comment, rejection_reason, reviewed_by, reviewed_at, created_at
       FROM regularization_requests
       WHERE user_id = $1 AND company_id = $2
       ORDER BY created_at DESC LIMIT 20`,
      [userId, companyId]
    ).catch(() => ({ rows: [] }));

    // Audit logs related to this employee's attendance
    const auditRes = await query(
      `SELECT id, action, resource_type, details, ip_address, created_at
       FROM audit_logs
       WHERE company_id = $1 AND (user_id = $2 OR details->>'userId' = $2 OR details->>'employeeId' = $2)
       ORDER BY created_at DESC LIMIT 20`,
      [companyId, userId]
    ).catch(() => ({ rows: [] }));

    res.json({
      employee,
      attendanceHistory: attRes.rows,
      verificationAttempts: verifyRes.rows,
      regularizationRequests: regRes.rows,
      auditHistory: auditRes.rows
    });
  } catch (err) {
    console.error("getEmployeeAttendanceProfile error:", err);
    res.status(500).json({ error: "Failed to fetch employee attendance profile." });
  }
};

// -------------------------------------------------------------
// 5. GET /api/attendance/monitoring/analytics
// -------------------------------------------------------------
export const getMonitoringAnalytics = async (req, res) => {
  try {
    if (!authorizeAdmin(req, res)) return;

    const companyId = await resolveCompanyId(req);
    const tz = await getCompanyTimezone(companyId);
    const { startDate, endDate } = resolveDateRange(req.query, tz);

    // 1. Total active employees count
    const usersRes = await query(
      `SELECT id, department FROM users WHERE company_id = $1 AND (status IS NULL OR status = 'active') AND role <> 'superadmin'`,
      [companyId]
    );
    const totalStaff = usersRes.rows.length;

    // 2. Attendance rows in range
    const attRes = await query(
      `SELECT date, status, duration_minutes, user_id, check_in
       FROM attendance
       WHERE company_id = $1 AND date >= $2::date AND date <= $3::date`,
      [companyId, startDate, endDate]
    );

    // 3. Department breakdown
    const deptMap = new Map();
    usersRes.rows.forEach(u => {
      const d = u.department || "General";
      if (!deptMap.has(d)) deptMap.set(d, { total: 0, present: 0 });
      deptMap.get(d).total++;
    });

    // 4. Daily attendance percentage trend
    const dateMap = new Map();
    let totalWorkingMins = 0;
    let recordsWithHours = 0;

    attRes.rows.forEach(a => {
      const dStr = formatDateStr(a.date, tz);
      if (!dateMap.has(dStr)) {
        dateMap.set(dStr, { date: dStr, present: 0, absent: 0 });
      }
      const entry = dateMap.get(dStr);
      if (a.status === "absent") {
        entry.absent++;
      } else if (a.check_in) {
        entry.present++;
        const u = usersRes.rows.find(x => x.id === a.user_id);
        if (u) {
          const dept = u.department || "General";
          if (deptMap.has(dept)) deptMap.get(dept).present++;
        }
      }

      if (a.duration_minutes > 0) {
        totalWorkingMins += Number(a.duration_minutes);
        recordsWithHours++;
      }
    });

    const dailyTrend = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    const departmentBreakdown = Array.from(deptMap.entries()).map(([dept, data]) => ({
      department: dept,
      total: data.total,
      present: data.present,
      percentage: data.total > 0 ? Math.round((data.present / data.total) * 100) : 0
    }));

    const avgWorkingHours = recordsWithHours > 0 ? (totalWorkingMins / recordsWithHours / 60).toFixed(1) : "8.0";

    res.json({
      totalStaff,
      avgWorkingHours,
      dailyTrend,
      departmentBreakdown,
      startDate,
      endDate
    });
  } catch (err) {
    console.error("getMonitoringAnalytics error:", err);
    res.status(500).json({ error: "Failed to fetch attendance analytics." });
  }
};

// -------------------------------------------------------------
// 6. POST /api/attendance/monitoring/regularize/:id/review
// -------------------------------------------------------------
export const reviewRegularization = async (req, res) => {
  try {
    if (!authorizeAdmin(req, res)) return;

    const { id } = req.params;
    let decision = (req.body.decision || req.body.action || "").toLowerCase();
    if (decision === "approve") decision = "approved";
    if (decision === "reject") decision = "rejected";
    const adminRemarks = req.body.adminRemarks || req.body.remarks || "";
    const reviewerId = req.user.id;
    const companyId = await resolveCompanyId(req);

    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ error: "Decision must be 'approved' or 'rejected'." });
    }

    // Verify regularization request belongs to company (tenant isolation)
    const existingRes = await query(
      `SELECT * FROM regularization_requests WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: "Regularization request not found." });
    }
    const regReq = existingRes.rows[0];

    // Atomically update regularization request
    const result = await query(
      `UPDATE regularization_requests
       SET status = $1, reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP,
           manager_comment = $3, rejection_reason = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [decision, reviewerId, adminRemarks, id]
    );

    // If approved, update or insert attendance record
    if (decision === "approved") {
      const attDate = formatDateStr(regReq.attendance_date);
      let attId = `${regReq.user_id}_${attDate}`;
      const existingAtt = await query(
        `SELECT id FROM attendance WHERE user_id = $1 AND date = $2::date AND company_id = $3`,
        [regReq.user_id, attDate, companyId]
      );
      if (existingAtt.rows.length > 0) {
        attId = existingAtt.rows[0].id;
      }
      const checkInVal = regReq.requested_check_in || `${attDate}T10:00:00Z`;
      const checkOutVal = regReq.requested_check_out || `${attDate}T19:00:00Z`;

      await query(
        `INSERT INTO attendance (id, user_id, company_id, date, check_in, check_out, status, duration_minutes, is_regularized, is_admin_locked, penalty_status)
         VALUES ($1, $2, $3, $4::date, $5, $6, 'present', 480, TRUE, FALSE, NULL)
         ON CONFLICT (id) DO UPDATE SET
           check_in = EXCLUDED.check_in,
           check_out = EXCLUDED.check_out,
           status = 'present',
           duration_minutes = GREATEST(COALESCE(attendance.duration_minutes, 0), 480),
           is_regularized = TRUE,
           is_admin_locked = FALSE,
           penalty_status = NULL,
           penalty_reason = NULL,
           updated_at = CURRENT_TIMESTAMP`,
        [attId, regReq.user_id, companyId, attDate, checkInVal, checkOutVal]
      );
    }

    // Audit logging
    auditService.logAudit({
      userId: reviewerId,
      userEmail: req.user?.email,
      userName: req.user?.name || "Administrator",
      companyId,
      action: decision === "approved" ? "REGULARIZATION_APPROVED" : "REGULARIZATION_REJECTED",
      resourceType: "regularization",
      resourceId: id,
      details: {
        employeeId: regReq.user_id,
        attendanceDate: regReq.attendance_date,
        decision,
        adminRemarks
      },
      req
    });

    // Notify employee
    await sendNotificationOnce({
      userId: regReq.user_id,
      title: `Regularization ${decision === "approved" ? "Approved" : "Rejected"}`,
      message: `Your attendance regularization for ${formatDateStr(regReq.attendance_date)} has been ${decision}. Remarks: ${adminRemarks || "None"}`,
      type: decision === "approved" ? "success" : "warning",
      link: "/history",
      io: req.app?.get("io"),
      activityType: "regularization_reviewed",
      entityId: id
    }).catch(() => { });

    res.json({ message: `Regularization request ${decision} successfully.`, request: result.rows[0] });
  } catch (err) {
    console.error("reviewRegularization error:", err);
    res.status(500).json({ error: "Failed to review regularization request." });
  }
};

// -------------------------------------------------------------
// 7. POST /api/attendance/monitoring/unlock/:attendanceId
// -------------------------------------------------------------
export const unlockAttendance = async (req, res) => {
  try {
    if (!authorizeAdmin(req, res)) return;

    let attendanceId = req.params.attendanceId || req.body.attendanceId;
    const resolutionNotes = req.body.resolutionNotes || req.body.reason || "";
    const companyId = await resolveCompanyId(req);

    if (!attendanceId && req.body.userId && req.body.date) {
      const findRow = await query(
        `SELECT id FROM attendance WHERE user_id = $1 AND date = $2::date AND company_id = $3`,
        [req.body.userId, req.body.date, companyId]
      );
      if (findRow.rows.length > 0) {
        attendanceId = findRow.rows[0].id;
      }
    }

    if (!attendanceId) {
      return res.status(400).json({ error: "attendanceId or (userId and date) is required." });
    }

    const attRes = await query(
      `SELECT * FROM attendance WHERE id = $1 AND company_id = $2`,
      [attendanceId, companyId]
    );

    if (attRes.rows.length === 0) {
      return res.status(404).json({ error: "Attendance record not found." });
    }
    const record = attRes.rows[0];

    const updatedRes = await query(
      `UPDATE attendance
       SET status = CASE WHEN check_in IS NOT NULL THEN (CASE WHEN check_out IS NOT NULL THEN 'checked-out' ELSE 'present' END) ELSE 'not-checked-in' END,
           is_admin_locked = FALSE,
           penalty_status = NULL,
           penalty_reason = NULL,
           penalized_by_task_id = NULL,
           auto_checked_out = FALSE,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [attendanceId]
    );

    // If penalized by task, clear task penalty flag as well
    if (record.penalized_by_task_id) {
      await query(
        `UPDATE tasks SET sla_penalty_applied = FALSE WHERE id = $1`,
        [record.penalized_by_task_id]
      ).catch(() => { });
    }

    // Audit log
    auditService.logAudit({
      userId: req.user.id,
      userEmail: req.user?.email,
      userName: req.user?.name || "Administrator",
      companyId,
      action: "ATTENDANCE_UNLOCK",
      resourceType: "attendance",
      resourceId: attendanceId,
      details: {
        employeeId: record.user_id,
        previousPenalty: record.penalty_status,
        resolutionNotes
      },
      req
    });

    // Notify employee
    await sendNotificationOnce({
      userId: record.user_id,
      title: "Attendance Unlocked",
      message: `Your attendance has been unlocked by Administrator. Notes: ${resolutionNotes || "Resolved"}`,
      type: "success",
      link: "/dashboard",
      io: req.app?.get("io"),
      activityType: "attendance_unlocked",
      entityId: attendanceId
    }).catch(() => { });

    res.json({ message: "Attendance unlocked successfully.", attendance: updatedRes.rows[0] });
  } catch (err) {
    console.error("unlockAttendance error:", err);
    res.status(500).json({ error: "Failed to unlock attendance." });
  }
};

// -------------------------------------------------------------
// 8. POST /api/attendance/monitoring/manual-correct
// -------------------------------------------------------------
export const manualCorrectAttendance = async (req, res) => {
  try {
    if (!authorizeAdmin(req, res)) return;

    const { userId, date, checkIn, checkOut, status, reason = "" } = req.body;
    const companyId = await resolveCompanyId(req);

    if (!userId || !date) {
      return res.status(400).json({ error: "userId and date are required." });
    }

    // Verify employee belongs to company
    const userRes = await query("SELECT id, name FROM users WHERE id = $1 AND company_id = $2", [userId, companyId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found in your organization." });
    }

    const attId = `${userId}_${date}`;
    let durationMins = 0;
    if (checkIn && checkOut) {
      durationMins = Math.max(0, Math.floor((new Date(checkOut) - new Date(checkIn)) / 60000));
    }

    const newStatus = status || (checkIn ? "present" : "absent");

    const result = await query(
      `INSERT INTO attendance (
        id, user_id, company_id, date, check_in, check_out, status,
        duration_minutes, accumulated_working_minutes, is_regularized, is_admin_locked,
        penalty_status, penalty_reason, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $8, TRUE, FALSE, NULL, NULL, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        check_in = COALESCE(EXCLUDED.check_in, attendance.check_in),
        check_out = COALESCE(EXCLUDED.check_out, attendance.check_out),
        status = EXCLUDED.status,
        duration_minutes = EXCLUDED.duration_minutes,
        accumulated_working_minutes = EXCLUDED.accumulated_working_minutes,
        is_regularized = TRUE,
        is_admin_locked = FALSE,
        penalty_status = NULL,
        penalty_reason = NULL,
        updated_at = NOW()
      RETURNING *`,
      [attId, userId, companyId, date, checkIn || null, checkOut || null, newStatus, durationMins]
    );

    // Audit log
    auditService.logAudit({
      userId: req.user.id,
      userEmail: req.user?.email,
      userName: req.user?.name || "Administrator",
      companyId,
      action: "ATTENDANCE_MANUAL_CORRECTION",
      resourceType: "attendance",
      resourceId: attId,
      details: {
        employeeId: userId,
        date,
        checkIn,
        checkOut,
        status: newStatus,
        reason
      },
      req
    });

    res.json({ message: "Attendance record updated successfully.", attendance: result.rows[0] });
  } catch (err) {
    console.error("manualCorrectAttendance error:", err);
    res.status(500).json({ error: "Failed to manually correct attendance." });
  }
};

// -------------------------------------------------------------
// 9. GET /api/attendance/monitoring/export (-csv, -excel, -pdf)
// -------------------------------------------------------------
export const exportAttendanceReport = async (req, res) => {
  try {
    if (!authorizeAdmin(req, res)) return;

    const companyId = await resolveCompanyId(req);
    const tz = await getCompanyTimezone(companyId);
    const isGeofenceEnabled = await getCompanyGeofenceEnabled(companyId);
    const { startDate, endDate } = resolveDateRange(req.query, tz);
    const employeeId = req.query.employeeId || req.query.userId || null;
    const format = String(req.query.format || "csv").toLowerCase();

    const exportData = await fetchExportData({
      companyId,
      employeeId,
      startDate,
      endDate,
      tz,
      isGeofenceEnabled
    });

    if (exportData.error) {
      return res.status(exportData.statusCode || 400).json({ error: exportData.error });
    }

    // Log Audit Event
    auditService.logAudit({
      req,
      action: "ATTENDANCE_REPORT_EXPORTED",
      resourceType: "attendance_monitoring",
      details: {
        format,
        reportType: employeeId ? "individual_employee" : "company_wide",
        employeeId: employeeId || null,
        startDate,
        endDate,
        preset: req.query.preset || "custom",
        recordCount: exportData.records.length
      }
    });

    if (format === "xlsx" || format === "excel") {
      return await sendExcelExport(exportData, res);
    } else if (format === "pdf") {
      return await sendPdfExport(exportData, res);
    } else {
      return sendCsvExport(exportData, res);
    }
  } catch (err) {
    console.error("exportAttendanceReport error:", err);
    res.status(500).json({ error: "Failed to export attendance report." });
  }
};

export const exportAttendanceCsv = async (req, res) => {
  req.query.format = "csv";
  return exportAttendanceReport(req, res);
};

export const exportAttendanceExcel = async (req, res) => {
  req.query.format = "xlsx";
  return exportAttendanceReport(req, res);
};

export const exportAttendanceXlsx = async (req, res) => {
  req.query.format = "xlsx";
  return exportAttendanceReport(req, res);
};

export const exportAttendancePdf = async (req, res) => {
  req.query.format = "pdf";
  return exportAttendanceReport(req, res);
};

// -------------------------------------------------------------
// 10. POST /api/attendance/monitoring/reverse-geocode
// -------------------------------------------------------------
export const resolveAddressEndpoint = async (req, res) => {
  try {
    if (!authorizeAdmin(req, res)) return;
    const { latitude, longitude, attendanceId } = req.body;
    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: "Latitude and longitude are required." });
    }
    const address = await reverseGeocode(latitude, longitude);
    if (address && attendanceId) {
      await query(
        `UPDATE attendance 
         SET resolved_address = $1, 
             check_in_location = jsonb_set(COALESCE(check_in_location, '{}'::jsonb), '{locationName}', to_jsonb($1::text)),
             location = jsonb_set(COALESCE(location, '{}'::jsonb), '{locationName}', to_jsonb($1::text))
         WHERE id = $2`,
        [address, attendanceId]
      ).catch(() => { });
    }
    res.json({
      address: address || `${Number(latitude).toFixed(4)}, ${Number(longitude).toFixed(4)}`,
      formatted: address,
      latitude: Number(latitude),
      longitude: Number(longitude)
    });
  } catch (err) {
    console.error("resolveAddressEndpoint error:", err);
    res.status(500).json({ error: "Failed to reverse geocode coordinates." });
  }
};
