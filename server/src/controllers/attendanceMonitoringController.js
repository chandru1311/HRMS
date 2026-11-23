import crypto from "crypto";
import { query } from "../config/db.js";
import auditService from "../services/auditService.js";
import { formatDateOnly, calculateDaysBetween } from "./leaveController.js";

/**
 * Returns today's date formatted as YYYY-MM-DD in local time
 */
const getTodayDateStr = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

/**
 * Returns yesterday's date formatted as YYYY-MM-DD
 */
const getYesterdayDateStr = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/**
 * Returns date range for this week (Monday to Sunday)
 */
const getThisWeekRange = () => {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 is Sunday, 1 is Monday
  const distanceToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - distanceToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    startDate: formatDateOnly(monday),
    endDate: formatDateOnly(sunday)
  };
};

/**
 * Returns date range for this month (1st to last day of month)
 */
const getThisMonthRange = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const firstDay = new Date(y, m, 1);
  const lastDay = new Date(y, m + 1, 0);

  return {
    startDate: formatDateOnly(firstDay),
    endDate: formatDateOnly(lastDay)
  };
};

/**
 * Parses time string (HH:MM or timestamp) to total minutes from midnight
 */
const parseTimeToMinutes = (timeVal) => {
  if (!timeVal) return null;
  if (timeVal instanceof Date) {
    if (isNaN(timeVal.getTime())) return null;
    return timeVal.getHours() * 60 + timeVal.getMinutes();
  }
  const str = String(timeVal);
  if (str.includes("T")) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.getHours() * 60 + d.getMinutes();
    }
  }
  const m = str.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  return null;
};

/**
 * Formats time (HH:MM AM/PM) safely
 */
const formatTimeDisplay = (timeVal) => {
  if (!timeVal) return "—";
  let d;
  if (timeVal instanceof Date) {
    d = timeVal;
  } else if (typeof timeVal === "string" && timeVal.includes("T")) {
    d = new Date(timeVal);
  } else if (typeof timeVal === "string") {
    const m = timeVal.match(/(\d{1,2}):(\d{2})/);
    if (m) {
      let h = parseInt(m[1], 10);
      const min = m[2];
      const ampm = h >= 12 ? "PM" : "AM";
      h = h % 12 || 12;
      return `${String(h).padStart(2, "0")}:${min} ${ampm}`;
    }
    return timeVal;
  }
  if (!d || isNaN(d.getTime())) return "—";
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${String(h).padStart(2, "0")}:${min} ${ampm}`;
};

/**
 * Helper to get target company ID enforcing tenant isolation
 */
const resolveTargetCompany = (req) => {
  const isSuperAdmin = String(req.user?.role || "").toLowerCase() === "superadmin";
  const targetCompanyId = isSuperAdmin && req.query.companyId ? req.query.companyId : req.user?.companyId;
  return { isSuperAdmin, targetCompanyId };
};

/**
 * 1. Overview Dashboard Summary Statistics
 * Returns: Total Employees, Present, Absent, Late Arrivals, Currently Working,
 * Checked Out, On Leave, Pending Regularization Requests
 */
export const getAttendanceMonitoringSummary = async (req, res) => {
  try {
    const { isSuperAdmin, targetCompanyId } = resolveTargetCompany(req);
    const { filterType = "today", department, employeeId, status } = req.query;

    let startDate = req.query.startDate;
    let endDate = req.query.endDate;

    if (filterType === "today") {
      startDate = getTodayDateStr();
      endDate = startDate;
    } else if (filterType === "yesterday") {
      startDate = getYesterdayDateStr();
      endDate = startDate;
    } else if (filterType === "this_week") {
      const week = getThisWeekRange();
      startDate = week.startDate;
      endDate = week.endDate;
    } else if (filterType === "this_month") {
      const month = getThisMonthRange();
      startDate = month.startDate;
      endDate = month.endDate;
    } else if (!startDate || !endDate) {
      startDate = getTodayDateStr();
      endDate = startDate;
    }

    startDate = formatDateOnly(startDate);
    endDate = formatDateOnly(endDate);

    // 1. Fetch Company Users
    let userSql = `
      SELECT id, name, employee_id, department, role, shift_start, shift_end, status
      FROM users
      WHERE role NOT IN ('superadmin', 'client')
    `;
    const userParams = [];
    if (targetCompanyId) {
      userParams.push(targetCompanyId);
      userSql += ` AND company_id = $${userParams.length}`;
    }
    if (department && department !== "all") {
      userParams.push(department);
      userSql += ` AND department = $${userParams.length}`;
    }
    if (employeeId && employeeId !== "all") {
      userParams.push(employeeId);
      userSql += ` AND id = $${userParams.length}`;
    }

    const usersRes = await query(userSql, userParams);
    const users = usersRes.rows;
    const totalEmployees = users.length;
    const userIds = users.map(u => u.id);

    if (userIds.length === 0) {
      return res.json({
        totalEmployees: 0,
        presentEmployees: 0,
        absentEmployees: 0,
        lateArrivals: 0,
        currentlyWorking: 0,
        checkedOut: 0,
        onLeave: 0,
        pendingRegularization: 0,
        startDate,
        endDate,
        filterType
      });
    }

    // 2. Fetch Attendance Records for this range
    let attSql = `
      SELECT a.*, a.date::text as date_str
      FROM attendance a
      WHERE a.date >= $1 AND a.date <= $2
        AND a.user_id = ANY($3::text[])
    `;
    const attParams = [startDate, endDate, userIds];
    if (targetCompanyId) {
      attParams.push(targetCompanyId);
      attSql += ` AND a.company_id = $${attParams.length}`;
    }

    const attRes = await query(attSql, attParams);
    const attendanceRecords = attRes.rows;

    // 3. Fetch Approved Leaves for this range
    let leaveSql = `
      SELECT l.*
      FROM leave_requests l
      WHERE l.status = 'approved'
        AND l.start_date <= $2 AND l.end_date >= $1
        AND l.user_id = ANY($3::text[])
    `;
    const leaveParams = [startDate, endDate, userIds];
    if (targetCompanyId) {
      leaveParams.push(targetCompanyId);
      leaveSql += ` AND l.company_id = $${leaveParams.length}`;
    }
    const leaveRes = await query(leaveSql, leaveParams);
    const approvedLeaves = leaveRes.rows;

    // 4. Fetch Pending Regularizations
    let regSql = `
      SELECT count(*) as count
      FROM regularization_requests r
      WHERE r.status = 'pending'
        AND r.user_id = ANY($1::text[])
    `;
    const regParams = [userIds];
    if (targetCompanyId) {
      regParams.push(targetCompanyId);
      regSql += ` AND r.company_id = $${regParams.length}`;
    }
    const regRes = await query(regSql, regParams);
    const pendingRegularization = parseInt(regRes.rows[0]?.count || "0", 10);

    // 5. Aggregate metrics
    let presentCount = 0;
    let lateCount = 0;
    let currentlyWorkingCount = 0;
    let checkedOutCount = 0;
    let onLeaveCount = 0;

    // Fast user lookup
    const userMap = new Map();
    users.forEach(u => userMap.set(u.id, u));

    // Group attendance by (user_id + date)
    const attMap = new Map();
    attendanceRecords.forEach(a => {
      const d = formatDateOnly(a.date_str || a.date);
      const key = `${a.user_id}_${d}`;
      attMap.set(key, a);
    });

    // Check approved leaves coverage
    const leaveCoverage = new Set();
    approvedLeaves.forEach(l => {
      const lStart = formatDateOnly(l.start_date);
      const lEnd = formatDateOnly(l.end_date);
      users.forEach(u => {
        if (u.id === l.user_id) {
          leaveCoverage.add(`${l.user_id}`);
        }
      });
    });
    onLeaveCount = leaveCoverage.size;

    // Evaluate each attendance log
    const evaluatedPresentUsers = new Set();

    attendanceRecords.forEach(a => {
      const u = userMap.get(a.user_id);
      const shiftStartStr = u?.shift_start || "09:00";
      const shiftStartMins = parseTimeToMinutes(shiftStartStr) || 540;

      const isLeave = a.status === "on-leave";
      const isLockedOrAbsent = a.is_admin_locked || a.status === "absent" || a.penalty_status;

      if (!isLeave && !isLockedOrAbsent && a.check_in) {
        evaluatedPresentUsers.add(a.user_id);
        presentCount++;

        // Late calculation
        const inMins = parseTimeToMinutes(a.check_in);
        if (inMins !== null && inMins > (shiftStartMins + 5)) { // 5-minute grace threshold
          lateCount++;
        }

        // Currently working vs Checked out
        if (a.check_out) {
          checkedOutCount++;
        } else {
          currentlyWorkingCount++;
        }
      }
    });

    // Absent employees for single-day query or overall active employees without present/leave records
    let absentCount = 0;
    if (startDate === endDate) {
      users.forEach(u => {
        const key = `${u.id}_${startDate}`;
        const hasAtt = attMap.get(key);
        const hasLeave = approvedLeaves.some(l => {
          const lStart = formatDateOnly(l.start_date);
          const lEnd = formatDateOnly(l.end_date);
          return l.user_id === u.id && startDate >= lStart && startDate <= lEnd;
        });

        if (!hasLeave) {
          if (!hasAtt || !hasAtt.check_in || hasAtt.is_admin_locked || hasAtt.status === "absent") {
            absentCount++;
          }
        }
      });
    } else {
      absentCount = Math.max(0, totalEmployees - evaluatedPresentUsers.size - onLeaveCount);
    }

    res.json({
      totalEmployees,
      presentEmployees: presentCount,
      absentEmployees: absentCount,
      lateArrivals: lateCount,
      currentlyWorking: currentlyWorkingCount,
      checkedOut: checkedOutCount,
      onLeave: onLeaveCount,
      pendingRegularization,
      startDate,
      endDate,
      filterType
    });
  } catch (err) {
    console.error("getAttendanceMonitoringSummary error:", err);
    res.status(500).json({ error: "Failed to generate attendance summary." });
  }
};

/**
 * 2. Employee Attendance Monitoring Table Records
 * Returns detailed rows with GPS & biometric verification results,
 * shift info, late by, early departure, and action triggers.
 */
export const getAttendanceMonitoringRecords = async (req, res) => {
  try {
    const { isSuperAdmin, targetCompanyId } = resolveTargetCompany(req);
    const {
      filterType = "today",
      department,
      status,
      search = "",
      page = 1,
      limit = 25,
      sortBy = "check_in",
      sortOrder = "desc"
    } = req.query;

    let targetDate = req.query.date || req.query.startDate;
    if (!targetDate || filterType === "today") {
      targetDate = getTodayDateStr();
    } else if (filterType === "yesterday") {
      targetDate = getYesterdayDateStr();
    }
    targetDate = formatDateOnly(targetDate);

    // Fetch company settings for geofencing
    let allowedRadius = 200;
    if (targetCompanyId) {
      const compRes = await query("SELECT allowed_radius_meters FROM companies WHERE id = $1", [targetCompanyId]);
      if (compRes.rows[0]?.allowed_radius_meters) {
        allowedRadius = Number(compRes.rows[0].allowed_radius_meters);
      }
    }

    // 1. Fetch Users
    let userSql = `
      SELECT id, name, email, employee_id, department, designation, role, shift_start, shift_end, avatar_url, phone, status
      FROM users
      WHERE role NOT IN ('superadmin', 'client')
    `;
    const userParams = [];
    if (targetCompanyId) {
      userParams.push(targetCompanyId);
      userSql += ` AND company_id = $${userParams.length}`;
    }
    if (department && department !== "all") {
      userParams.push(department);
      userSql += ` AND department = $${userParams.length}`;
    }
    if (search.trim()) {
      userParams.push(`%${search.trim()}%`);
      userSql += ` AND (name ILIKE $${userParams.length} OR email ILIKE $${userParams.length} OR employee_id ILIKE $${userParams.length})`;
    }

    userSql += " ORDER BY name ASC";
    const userRes = await query(userSql, userParams);
    const users = userRes.rows;
    const userIds = users.map(u => u.id);

    if (userIds.length === 0) {
      return res.json({
        records: [],
        pagination: {
          total: 0,
          page: Number(page),
          limit: Number(limit),
          totalPages: 0
        }
      });
    }

    // 2. Fetch Attendance for Target Date
    const attSql = `
      SELECT a.*, a.date::text as date_str
      FROM attendance a
      WHERE a.date = $1
        AND a.user_id = ANY($2::text[])
    `;
    const attRes = await query(attSql, [targetDate, userIds]);
    const attMap = new Map();
    attRes.rows.forEach(r => attMap.set(r.user_id, r));

    // 3. Fetch Approved Leaves for Target Date
    const leaveSql = `
      SELECT l.*
      FROM leave_requests l
      WHERE l.status = 'approved'
        AND l.start_date <= $1 AND l.end_date >= $1
        AND l.user_id = ANY($2::text[])
    `;
    const leaveRes = await query(leaveSql, [targetDate, userIds]);
    const leaveMap = new Map();
    leaveRes.rows.forEach(l => leaveMap.set(l.user_id, l));

    // 4. Fetch Regularizations for Target Date
    const regSql = `
      SELECT r.*
      FROM regularization_requests r
      WHERE r.attendance_date = $1
        AND r.user_id = ANY($2::text[])
    `;
    const regRes = await query(regSql, [targetDate, userIds]);
    const regMap = new Map();
    regRes.rows.forEach(r => regMap.set(r.user_id, r));

    // 5. Fetch Verification Attempts for Target Date
    const avaSql = `
      SELECT ava.*
      FROM attendance_verification_attempts ava
      WHERE ava.attempted_at::date = $1::date
        AND ava.user_id = ANY($2::text[])
      ORDER BY ava.attempted_at DESC
    `;
    const avaRes = await query(avaSql, [targetDate, userIds]);
    const avaMap = new Map();
    avaRes.rows.forEach(v => {
      if (!avaMap.has(v.user_id)) avaMap.set(v.user_id, v);
    });

    // 6. Check if targetDate is a weekend or company holiday
    const dateObj = new Date(targetDate);
    const dayOfWeek = dateObj.getDay(); // 0 is Sun, 6 is Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let isHoliday = false;
    let holidayTitle = "";
    if (targetCompanyId) {
      const holRes = await query(
        `SELECT title FROM paid_leaves WHERE status = 'active' AND start_date <= $1 AND end_date >= $1 AND (company_id = $2 OR company_id IS NULL) LIMIT 1`,
        [targetDate, targetCompanyId]
      );
      if (holRes.rows.length > 0) {
        isHoliday = true;
        holidayTitle = holRes.rows[0].title;
      }
    }

    // 7. Assemble Detailed Rows
    let allRecords = users.map(user => {
      const att = attMap.get(user.id);
      const leave = leaveMap.get(user.id);
      const reg = regMap.get(user.id);
      const ava = avaMap.get(user.id);

      const shiftStartStr = user.shift_start || "09:00";
      const shiftEndStr = user.shift_end || "18:00";
      const shiftDisplay = `${formatTimeDisplay(shiftStartStr)} - ${formatTimeDisplay(shiftEndStr)}`;

      const shiftStartMins = parseTimeToMinutes(shiftStartStr) || 540;
      const shiftEndMins = parseTimeToMinutes(shiftEndStr) || 1080;

      let checkInTime = null;
      let checkOutTime = null;
      let workingHoursStr = "0.00 hrs";
      let workingMinutes = 0;
      let lateMinutes = 0;
      let earlyDepartureMinutes = 0;

      if (att && att.check_in) {
        checkInTime = att.check_in;
        checkOutTime = att.check_out || null;

        // Working minutes
        workingMinutes = Number(att.duration_minutes) || Number(att.accumulated_working_minutes) || 0;
        if (workingMinutes <= 0 && checkInTime) {
          const inD = new Date(checkInTime);
          const outD = checkOutTime ? new Date(checkOutTime) : new Date();
          workingMinutes = Math.max(0, Math.floor((outD.getTime() - inD.getTime()) / 60000));
        }
        workingHoursStr = (workingMinutes / 60).toFixed(2) + " hrs";

        // Late By calculation
        const inMins = parseTimeToMinutes(checkInTime);
        if (inMins !== null && inMins > shiftStartMins) {
          lateMinutes = inMins - shiftStartMins;
        }

        // Early departure calculation
        if (checkOutTime) {
          const outMins = parseTimeToMinutes(checkOutTime);
          if (outMins !== null && outMins < shiftEndMins) {
            earlyDepartureMinutes = shiftEndMins - outMins;
          }
        }
      }

      // GPS Verification Result
      let gpsVerification = "Not Available";
      if (att && (att.fence_verified_at || (att.distance_from_office_meters != null && Number(att.distance_from_office_meters) <= allowedRadius))) {
        gpsVerification = "Verified";
      } else if (att && att.distance_from_office_meters != null && Number(att.distance_from_office_meters) > allowedRadius) {
        gpsVerification = "Failed";
      } else if (att?.check_in_location && typeof att.check_in_location === "object" && Object.keys(att.check_in_location).length > 0) {
        const accuracy = Number(att.check_in_location.accuracy);
        if (accuracy > 150) {
          gpsVerification = "Accuracy Insufficient";
        } else {
          gpsVerification = "Verified";
        }
      } else if (ava?.gps_result) {
        if (ava.gps_result === "verified" || ava.gps_result === "within_geofence") gpsVerification = "Verified";
        else if (ava.gps_result === "outside_geofence" || ava.gps_result === "failed") gpsVerification = "Failed";
      }

      // Face Verification Result (NEVER exposing biometric templates or embeddings)
      let faceVerification = "Not Available";
      if (att && att.biometric_verified && att.liveness_passed) {
        faceVerification = "Verified";
      } else if (att && att.biometric_verified === false && att.verification_score != null) {
        faceVerification = "Failed";
      } else if (ava) {
        if (ava.status === "passed" || ava.face_result === "match") faceVerification = "Verified";
        else if (ava.status === "failed" || ava.face_result === "mismatch") faceVerification = "Failed";
        else if (ava.status === "inconclusive") faceVerification = "Inconclusive";
      }

      // Attendance Status Resolution
      let attendanceStatus = "Absent";
      if (att?.is_admin_locked) {
        attendanceStatus = "Attendance Locked";
      } else if (leave) {
        attendanceStatus = "On Leave";
      } else if (att?.status === "on-leave") {
        attendanceStatus = "On Leave";
      } else if (att?.status === "absent" || att?.absence_reason || att?.penalty_status) {
        attendanceStatus = "Absent";
      } else if (checkInTime) {
        if (checkOutTime) {
          if (workingMinutes < 270) { // less than 4.5 hours is half-day
            attendanceStatus = "Half Day";
          } else if (lateMinutes > 5) {
            attendanceStatus = "Late";
          } else {
            attendanceStatus = "Present";
          }
        } else {
          // Still checked in
          const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
          if (targetDate === getTodayDateStr()) {
            if (lateMinutes > 5) {
              attendanceStatus = "Late";
            } else {
              attendanceStatus = "Present";
            }
          } else {
            // Missed checkout on past date
            attendanceStatus = "Incomplete Check-out";
          }
        }
      } else if (isHoliday) {
        attendanceStatus = "Holiday";
      } else if (isWeekend) {
        attendanceStatus = "Weekly Off";
      } else if (targetDate === getTodayDateStr()) {
        const now = new Date();
        const currentMins = now.getHours() * 60 + now.getMinutes();
        if (currentMins < shiftStartMins) {
          attendanceStatus = "Pending";
        } else if (currentMins > shiftStartMins + 15) {
          attendanceStatus = "Late"; // Not checked in and past shift
        } else {
          attendanceStatus = "Pending";
        }
      }

      return {
        id: att?.id || `sim_${user.id}_${targetDate}`,
        attendanceId: att?.id || null,
        userId: user.id,
        employeeId: user.employee_id || `EMP-${user.id.slice(-4).toUpperCase()}`,
        employeeName: user.name || "Employee",
        email: user.email,
        phone: user.phone || "—",
        department: user.department || "General",
        designation: user.designation || "Staff",
        avatarUrl: user.avatar_url || null,
        shift: shiftDisplay,
        shiftStart: shiftStartStr,
        shiftEnd: shiftEndStr,
        date: targetDate,
        checkIn: formatTimeDisplay(checkInTime),
        checkOut: formatTimeDisplay(checkOutTime),
        checkInRaw: checkInTime,
        checkOutRaw: checkOutTime,
        workingHours: workingHoursStr,
        workingMinutes,
        lateByMinutes: lateMinutes,
        lateByText: lateMinutes > 0 ? `${lateMinutes} mins` : "On Time",
        earlyDepartureMinutes,
        earlyDepartureText: earlyDepartureMinutes > 0 ? `${earlyDepartureMinutes} mins` : "None",
        gpsVerification,
        faceVerification,
        attendanceStatus,
        isRegularized: Boolean(att?.is_regularized || reg?.status === "approved"),
        regularizationStatus: reg?.status || null,
        regularizationId: reg?.id || null,
        adminNotes: att?.admin_notes || null,
        isAdminLocked: Boolean(att?.is_admin_locked),
        distanceMeters: (att && att.distance_from_office_meters != null) ? Number(att.distance_from_office_meters) : null,
        location: att?.check_in_location || att?.location || null
      };
    });

    // Filter by status if selected
    if (status && status !== "all") {
      allRecords = allRecords.filter(r => r.attendanceStatus.toLowerCase() === status.toLowerCase());
    }

    // Sorting
    allRecords.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (valA === undefined) valA = "";
      if (valB === undefined) valB = "";
      if (typeof valA === "string") {
        return sortOrder === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortOrder === "asc" ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
    });

    // Pagination
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));
    const totalRecords = allRecords.length;
    const totalPages = Math.ceil(totalRecords / limitNum);
    const paginatedRecords = allRecords.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({
      records: paginatedRecords,
      pagination: {
        total: totalRecords,
        page: pageNum,
        limit: limitNum,
        totalPages
      },
      targetDate
    });
  } catch (err) {
    console.error("getAttendanceMonitoringRecords error:", err);
    res.status(500).json({ error: "Failed to fetch attendance monitoring records." });
  }
};

/**
 * 3. Live Attendance Monitoring Snapshot
 * Real-time view for Today showing:
 * - Employees currently checked in (working)
 * - Employees not checked in
 * - Employees checked out
 * - Employees who are late
 * - Employees whose verification is pending
 */
export const getLiveAttendanceMonitoring = async (req, res) => {
  try {
    const { isSuperAdmin, targetCompanyId } = resolveTargetCompany(req);
    const todayStr = getTodayDateStr();

    // 1. Fetch Users
    let userSql = `
      SELECT id, name, email, employee_id, department, designation, shift_start, shift_end, avatar_url
      FROM users
      WHERE role NOT IN ('superadmin', 'client')
    `;
    const userParams = [];
    if (targetCompanyId) {
      userParams.push(targetCompanyId);
      userSql += ` AND company_id = $${userParams.length}`;
    }
    userSql += " ORDER BY name ASC";
    const userRes = await query(userSql, userParams);
    const users = userRes.rows;
    const userIds = users.map(u => u.id);

    if (userIds.length === 0) {
      return res.json({
        lastRefreshedAt: new Date().toISOString(),
        summary: { working: 0, notCheckedIn: 0, checkedOut: 0, late: 0, pendingReview: 0 },
        categories: { working: [], notCheckedIn: [], checkedOut: [], late: [], pendingReview: [] }
      });
    }

    // 2. Fetch Today's Attendance
    const attSql = `
      SELECT a.*, a.date::text as date_str
      FROM attendance a
      WHERE a.date = $1
        AND a.user_id = ANY($2::text[])
    `;
    const attRes = await query(attSql, [todayStr, userIds]);
    const attMap = new Map();
    attRes.rows.forEach(r => attMap.set(r.user_id, r));

    // 3. Fetch Today's Approved Leaves
    const leaveSql = `
      SELECT l.*
      FROM leave_requests l
      WHERE l.status = 'approved'
        AND l.start_date <= $1 AND l.end_date >= $1
        AND l.user_id = ANY($2::text[])
    `;
    const leaveRes = await query(leaveSql, [todayStr, userIds]);
    const leaveMap = new Map();
    leaveRes.rows.forEach(l => leaveMap.set(l.user_id, l));

    // 4. Fetch Pending Verification Attempts for Today
    const pendingAvaSql = `
      SELECT ava.*, u.name as user_name, u.department
      FROM attendance_verification_attempts ava
      LEFT JOIN users u ON ava.user_id = u.id
      WHERE ava.attempted_at::date = $1::date
        AND ava.review_status = 'pending'
        AND ava.user_id = ANY($2::text[])
    `;
    const pendingAvaRes = await query(pendingAvaSql, [todayStr, userIds]);
    const pendingReviewList = pendingAvaRes.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      name: r.user_name || "Employee",
      department: r.department || "General",
      attemptedAt: r.attempted_at,
      status: r.status,
      failureCategory: r.failure_category,
      gpsResult: r.gps_result,
      faceResult: r.face_result
    }));

    // 5. Categorize Live Status
    const workingList = [];
    const notCheckedInList = [];
    const checkedOutList = [];
    const lateList = [];

    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    users.forEach(user => {
      const att = attMap.get(user.id);
      const leave = leaveMap.get(user.id);

      const shiftStartStr = user.shift_start || "09:00";
      const shiftEndStr = user.shift_end || "18:00";
      const shiftStartMins = parseTimeToMinutes(shiftStartStr) || 540;

      const baseInfo = {
        userId: user.id,
        name: user.name,
        employeeId: user.employee_id || `EMP-${user.id.slice(-4).toUpperCase()}`,
        department: user.department || "General",
        designation: user.designation || "Staff",
        shift: `${formatTimeDisplay(shiftStartStr)} - ${formatTimeDisplay(shiftEndStr)}`,
        avatarUrl: user.avatar_url || null
      };

      if (leave) {
        // Handled as on leave
        return;
      }

      if (att && att.check_in) {
        const inMins = parseTimeToMinutes(att.check_in);
        const isLate = inMins !== null && inMins > (shiftStartMins + 5);

        if (isLate) {
          lateList.push({
            ...baseInfo,
            checkIn: formatTimeDisplay(att.check_in),
            checkInTime: att.check_in,
            lateMinutes: inMins - shiftStartMins
          });
        }

        if (att.check_out) {
          checkedOutList.push({
            ...baseInfo,
            checkIn: formatTimeDisplay(att.check_in),
            checkOut: formatTimeDisplay(att.check_out),
            workingMinutes: att.duration_minutes || 0
          });
        } else {
          workingList.push({
            ...baseInfo,
            checkIn: formatTimeDisplay(att.check_in),
            checkInTime: att.check_in,
            isLate
          });
        }
      } else {
        // Not checked in yet
        const isPastShift = currentMins > (shiftStartMins + 15);
        if (isPastShift) {
          lateList.push({
            ...baseInfo,
            checkIn: "Not Checked In",
            checkInTime: null,
            lateMinutes: currentMins - shiftStartMins
          });
        }
        notCheckedInList.push({
          ...baseInfo,
          isPastShift,
          minutesOverdue: isPastShift ? currentMins - shiftStartMins : 0
        });
      }
    });

    res.json({
      lastRefreshedAt: new Date().toISOString(),
      summary: {
        working: workingList.length,
        notCheckedIn: notCheckedInList.length,
        checkedOut: checkedOutList.length,
        late: lateList.length,
        pendingReview: pendingReviewList.length
      },
      categories: {
        working: workingList,
        notCheckedIn: notCheckedInList,
        checkedOut: checkedOutList,
        late: lateList,
        pendingReview: pendingReviewList
      }
    });
  } catch (err) {
    console.error("getLiveAttendanceMonitoring error:", err);
    res.status(500).json({ error: "Failed to fetch live attendance monitoring." });
  }
};

/**
 * 4. Individual Employee Attendance Profile
 * Detailed profile containing:
 * - Employee info, department, shift
 * - Daily attendance history
 * - Late arrival & early departure metrics
 * - GPS verification records (office coords, geofence radius, user coords, distance)
 * - Biometric verification records (without exposing raw templates)
 * - Regularization history
 * - Admin remarks and audit logs
 */
export const getEmployeeAttendanceProfile = async (req, res) => {
  try {
    const { isSuperAdmin, targetCompanyId } = resolveTargetCompany(req);
    const { userId } = req.params;
    const { days = 60 } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required." });
    }

    // 1. Fetch User Record
    const userRes = await query(
      `SELECT id, company_id, name, email, employee_id, role, department, designation, shift_start, shift_end, avatar_url, phone, status, created_at
       FROM users
       WHERE id = $1 ${!isSuperAdmin && targetCompanyId ? "AND company_id = $2" : ""}`,
      !isSuperAdmin && targetCompanyId ? [userId, targetCompanyId] : [userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found or access denied." });
    }
    const user = userRes.rows[0];

    // 2. Fetch Company Office Location Settings
    let officeLocation = null;
    let allowedRadius = 200;
    if (user.company_id) {
      const compRes = await query(
        `SELECT name, latitude, longitude, allowed_radius_meters FROM companies WHERE id = $1`,
        [user.company_id]
      );
      if (compRes.rows.length > 0) {
        const c = compRes.rows[0];
        officeLocation = {
          name: c.name,
          latitude: c.latitude ? Number(c.latitude) : null,
          longitude: c.longitude ? Number(c.longitude) : null,
          radiusMeters: c.allowed_radius_meters ? Number(c.allowed_radius_meters) : 200
        };
        allowedRadius = officeLocation.radiusMeters;
      }
    }

    // 3. Fetch Attendance History (last N days)
    const attSql = `
      SELECT a.*, a.date::text as date_str
      FROM attendance a
      WHERE a.user_id = $1
      ORDER BY a.date DESC
      LIMIT $2
    `;
    const attRes = await query(attSql, [userId, Math.min(Number(days) || 60, 180)]);
    const attendanceHistory = attRes.rows;

    // 4. Fetch Verification Attempts (Biometric & GPS)
    const avaSql = `
      SELECT id, attempted_at, work_mode, status, failure_category,
             gps_result, face_result, liveness_result, review_status, review_decision, review_note, metadata
      FROM attendance_verification_attempts
      WHERE user_id = $1
      ORDER BY attempted_at DESC
      LIMIT 30
    `;
    const avaRes = await query(avaSql, [userId]);
    const verificationAttempts = avaRes.rows;

    // 5. Fetch Regularization Requests
    const regSql = `
      SELECT r.*, r.attendance_date::text as date_str
      FROM regularization_requests r
      WHERE r.user_id = $1
      ORDER BY r.created_at DESC
      LIMIT 30
    `;
    const regRes = await query(regSql, [userId]);
    const regularizationHistory = regRes.rows.map(r => ({
      id: r.id,
      date: formatDateOnly(r.date_str || r.attendance_date),
      requestedCheckIn: formatTimeDisplay(r.requested_check_in),
      requestedCheckOut: formatTimeDisplay(r.requested_check_out),
      reason: r.reason || "—",
      status: r.status,
      managerComment: r.manager_comment || r.rejection_reason || "—",
      appliedAt: r.created_at
    }));

    // 6. Fetch Audit History regarding this employee
    const auditSql = `
      SELECT id, action, details, created_at, user_name, user_role
      FROM audit_logs
      WHERE resource_id = $1 OR details->>'employeeId' = $1 OR details->>'userId' = $1
      ORDER BY created_at DESC
      LIMIT 20
    `;
    const auditRes = await query(auditSql, [userId]);
    const auditHistory = auditRes.rows;

    // 7. Calculate Aggregates for Profile
    const shiftStartStr = user.shift_start || "09:00";
    const shiftEndStr = user.shift_end || "18:00";
    const shiftStartMins = parseTimeToMinutes(shiftStartStr) || 540;
    const shiftEndMins = parseTimeToMinutes(shiftEndStr) || 1080;

    let presentDays = 0;
    let lateDays = 0;
    let absentDays = 0;
    let halfDays = 0;
    let onLeaveDays = 0;
    let totalWorkingMinutes = 0;

    const formattedHistory = attendanceHistory.map(a => {
      const dStr = formatDateOnly(a.date_str || a.date);
      let mins = Number(a.duration_minutes) || Number(a.accumulated_working_minutes) || 0;
      totalWorkingMinutes += mins;

      let lateMins = 0;
      let earlyMins = 0;

      if (a.check_in) {
        const inMins = parseTimeToMinutes(a.check_in);
        if (inMins !== null && inMins > shiftStartMins) {
          lateMins = inMins - shiftStartMins;
          lateDays++;
        }
        presentDays++;
      }

      if (a.check_out) {
        const outMins = parseTimeToMinutes(a.check_out);
        if (outMins !== null && outMins < shiftEndMins) {
          earlyMins = shiftEndMins - outMins;
        }
      }

      if (a.status === "on-leave") {
        onLeaveDays++;
      } else if (a.status === "absent" || a.is_admin_locked) {
        absentDays++;
      } else if (mins > 0 && mins < 270) {
        halfDays++;
      }

      // GPS verification status
      let gpsStatus = "Not Available";
      if (a.fence_verified_at || (a.distance_from_office_meters != null && Number(a.distance_from_office_meters) <= allowedRadius)) {
        gpsStatus = "Verified";
      } else if (a.distance_from_office_meters != null && Number(a.distance_from_office_meters) > allowedRadius) {
        gpsStatus = "Failed";
      }

      return {
        id: a.id,
        date: dStr,
        checkIn: formatTimeDisplay(a.check_in),
        checkOut: formatTimeDisplay(a.check_out),
        checkInRaw: a.check_in,
        checkOutRaw: a.check_out,
        workingHours: (mins / 60).toFixed(2) + " hrs",
        workingMinutes: mins,
        lateMinutes: lateMins,
        earlyDepartureMinutes: earlyMins,
        status: a.status,
        gpsStatus,
        distanceMeters: a.distance_from_office_meters ? Number(a.distance_from_office_meters) : null,
        biometricVerified: Boolean(a.biometric_verified),
        livenessPassed: Boolean(a.liveness_passed),
        adminNotes: a.admin_notes,
        isLocked: Boolean(a.is_admin_locked)
      };
    });

    const avgHoursPerDay = presentDays > 0 ? (totalWorkingMinutes / presentDays / 60).toFixed(2) : "0.00";

    res.json({
      employee: {
        id: user.id,
        name: user.name,
        email: user.email,
        employeeId: user.employee_id || `EMP-${user.id.slice(-4).toUpperCase()}`,
        role: user.role,
        department: user.department || "General",
        designation: user.designation || "Staff",
        shift: `${formatTimeDisplay(shiftStartStr)} - ${formatTimeDisplay(shiftEndStr)}`,
        shiftStart: shiftStartStr,
        shiftEnd: shiftEndStr,
        avatarUrl: user.avatar_url,
        phone: user.phone || "—",
        status: user.status
      },
      officeLocation,
      summary: {
        totalLoggedDays: formattedHistory.length,
        presentDays,
        lateDays,
        absentDays,
        halfDays,
        onLeaveDays,
        totalWorkingHours: (totalWorkingMinutes / 60).toFixed(2),
        avgHoursPerDay
      },
      history: formattedHistory,
      verificationAttempts,
      regularizationHistory,
      auditHistory
    });
  } catch (err) {
    console.error("getEmployeeAttendanceProfile error:", err);
    res.status(500).json({ error: "Failed to fetch employee attendance profile." });
  }
};

/**
 * 5. Attendance Analytics & Trends
 * Visual summaries for charts:
 * - Daily attendance percentage
 * - Monthly attendance percentage
 * - Department-wise attendance rates
 * - Late arrival trends
 * - Absence trends
 * - Average working hours
 * - Regularization statistics
 */
export const getAttendanceAnalytics = async (req, res) => {
  try {
    const { isSuperAdmin, targetCompanyId } = resolveTargetCompany(req);
    const { days = 14 } = req.query;
    const numDays = Math.min(Math.max(Number(days) || 14, 7), 60);

    // 1. Fetch total employees count
    let uSql = "SELECT count(*) as count FROM users WHERE role NOT IN ('superadmin', 'client')";
    const uParams = [];
    if (targetCompanyId) {
      uParams.push(targetCompanyId);
      uSql += " AND company_id = $1";
    }
    const uRes = await query(uSql, uParams);
    const totalEmployees = parseInt(uRes.rows[0]?.count || "1", 10) || 1;

    // 2. Fetch past N days attendance records
    const startDateObj = new Date();
    startDateObj.setDate(startDateObj.getDate() - (numDays - 1));
    const startStr = formatDateOnly(startDateObj);
    const endStr = getTodayDateStr();

    let attSql = `
      SELECT a.*, a.date::text as date_str, u.department, u.shift_start
      FROM attendance a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE a.date >= $1 AND a.date <= $2
    `;
    const attParams = [startStr, endStr];
    if (targetCompanyId) {
      attParams.push(targetCompanyId);
      attSql += ` AND a.company_id = $${attParams.length}`;
    }

    const attRes = await query(attSql, attParams);
    const records = attRes.rows;

    // 3. Generate Day-by-Day Aggregate Array
    const dailyMap = new Map();
    for (let i = 0; i < numDays; i++) {
      const d = new Date(startDateObj);
      d.setDate(d.getDate() + i);
      const dStr = formatDateOnly(d);
      dailyMap.set(dStr, {
        date: dStr,
        displayDate: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        present: 0,
        late: 0,
        absent: 0,
        workingMinutes: 0
      });
    }

    // Department grouping
    const deptMap = new Map();

    records.forEach(r => {
      const dStr = formatDateOnly(r.date_str || r.date);
      const dayItem = dailyMap.get(dStr);
      const dept = r.department || "General";

      if (!deptMap.has(dept)) {
        deptMap.set(dept, { department: dept, present: 0, late: 0, absent: 0, totalHours: 0, recordsCount: 0 });
      }
      const deptItem = deptMap.get(dept);

      if (r.check_in && r.status !== "absent" && !r.is_admin_locked) {
        if (dayItem) {
          dayItem.present++;
          dayItem.workingMinutes += Number(r.duration_minutes) || 0;
        }
        deptItem.present++;
        deptItem.recordsCount++;
        deptItem.totalHours += (Number(r.duration_minutes) || 0) / 60;

        const shiftStartMins = parseTimeToMinutes(r.shift_start || "09:00") || 540;
        const inMins = parseTimeToMinutes(r.check_in);
        if (inMins !== null && inMins > (shiftStartMins + 5)) {
          if (dayItem) dayItem.late++;
          deptItem.late++;
        }
      } else {
        if (dayItem) dayItem.absent++;
        deptItem.absent++;
      }
    });

    const dailyAttendance = Array.from(dailyMap.values()).map(d => {
      const rate = Math.min(100, Math.round((d.present / totalEmployees) * 100));
      const avgHours = d.present > 0 ? (d.workingMinutes / d.present / 60).toFixed(1) : 0;
      return {
        ...d,
        attendanceRate: rate,
        avgHours: Number(avgHours)
      };
    });

    const departmentBreakdown = Array.from(deptMap.values()).map(dept => {
      const rate = dept.recordsCount > 0 ? Math.round((dept.present / dept.recordsCount) * 100) : 0;
      return {
        department: dept.department,
        present: dept.present,
        late: dept.late,
        absent: dept.absent,
        attendanceRate: rate,
        avgHours: dept.present > 0 ? Number((dept.totalHours / dept.present).toFixed(1)) : 0
      };
    });

    // Regularization Stats
    let regSql = "SELECT status, count(*) as count FROM regularization_requests WHERE 1=1";
    const regParams = [];
    if (targetCompanyId) {
      regParams.push(targetCompanyId);
      regSql += " AND company_id = $1";
    }
    regSql += " GROUP BY status";
    const regRes = await query(regSql, regParams);

    const regStats = { total: 0, approved: 0, rejected: 0, pending: 0 };
    regRes.rows.forEach(r => {
      const st = r.status?.toLowerCase();
      const count = parseInt(r.count, 10);
      regStats.total += count;
      if (st === "approved") regStats.approved = count;
      else if (st === "rejected") regStats.rejected = count;
      else if (st === "pending") regStats.pending = count;
    });

    res.json({
      dailyAttendance,
      departmentBreakdown,
      regularizationStats: regStats,
      totalEmployees
    });
  } catch (err) {
    console.error("getAttendanceAnalytics error:", err);
    res.status(500).json({ error: "Failed to generate attendance analytics." });
  }
};

/**
 * 6. Admin Attendance Record Review / Manual Override
 * Allows administrators to add remarks, unlock attendance, or adjust status with full audit logging.
 */
export const reviewAttendanceRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes, status, unlock, userId, date } = req.body;
    const reviewerId = req.user?.id;
    const { isSuperAdmin, targetCompanyId } = resolveTargetCompany(req);

    if (!id) {
      return res.status(400).json({ error: "Attendance record ID is required." });
    }

    let targetId = id;
    let targetUserId = userId;
    let targetDate = date;

    if (id.startsWith("sim_")) {
      const parts = id.replace("sim_", "").split("_");
      targetDate = parts.pop();
      targetUserId = parts.join("_");
      targetId = `${targetUserId}_${targetDate}`;
    }

    // Check if record exists
    const checkRes = await query("SELECT * FROM attendance WHERE id = $1", [targetId]);
    if (checkRes.rows.length === 0) {
      if (!targetUserId || !targetDate) {
        return res.status(404).json({ error: "Attendance record not found." });
      }
      const newStatus = status || "absent";
      const insertRes = await query(
        `INSERT INTO attendance (id, user_id, company_id, date, status, admin_notes, admin_modified_by, admin_modified_at, is_admin_locked)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8)
         RETURNING *`,
        [targetId, targetUserId, targetCompanyId, targetDate, newStatus, adminNotes || null, reviewerId, unlock ? false : false]
      );

      auditService.logAudit({
        userId: reviewerId,
        action: "ATTENDANCE_RECORD_REVIEWED",
        resourceType: "attendance",
        resourceId: targetId,
        details: {
          employeeId: targetUserId,
          date: targetDate,
          adminNotes,
          status: newStatus,
          created: true
        },
        req
      });

      return res.json({
        success: true,
        record: insertRes.rows[0],
        message: "Attendance record updated successfully."
      });
    }

    const updates = ["admin_modified_by = $1", "admin_modified_at = CURRENT_TIMESTAMP"];
    const params = [reviewerId];

    if (adminNotes !== undefined) {
      params.push(adminNotes);
      updates.push(`admin_notes = $${params.length}`);
    }

    if (unlock) {
      params.push(false);
      updates.push(`is_admin_locked = $${params.length}`);
      params.push(false);
      updates.push(`is_system_penalized = $${params.length}`);
      params.push(null);
      updates.push(`penalty_status = $${params.length}`);
      params.push(null);
      updates.push(`absence_reason = $${params.length}`);
    }

    if (status) {
      params.push(status);
      updates.push(`status = $${params.length}`);
    }

    params.push(targetId);
    let sql = `UPDATE attendance SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length}`;
    if (!isSuperAdmin && targetCompanyId) {
      params.push(targetCompanyId);
      sql += ` AND company_id = $${params.length}`;
    }
    sql += " RETURNING *";

    const result = await query(sql, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Attendance record not found or access denied." });
    }

    const updated = result.rows[0];

    // Audit Log
    auditService.logAudit({
      userId: reviewerId,
      action: "ATTENDANCE_RECORD_REVIEWED",
      resourceType: "attendance",
      resourceId: targetId,
      details: {
        employeeId: updated.user_id,
        date: updated.date,
        adminNotes,
        status,
        unlocked: Boolean(unlock)
      },
      req
    });

    res.json({
      success: true,
      record: updated,
      message: "Attendance record updated successfully."
    });
  } catch (err) {
    console.error("reviewAttendanceRecord error:", err);
    res.status(500).json({ error: "Failed to review attendance record." });
  }
};
