import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  User,
  Clock,
  Calendar,
  MapPin,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  UserCheck,
  AlertTriangle,
  History,
  Lock,
  CheckCircle2,
  XCircle,
  FileText,
  Activity,
  Download,
  FileSpreadsheet,
  Coffee,
  Timer,
  ChevronRight,
  Info,
  CalendarRange,
  ArrowRight
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { getEmployeeAttendanceProfile, getEmployeeAttendanceReportApi } from "../../firebase";

export default function EmployeeAttendanceDetailsModal({
  userId,
  initialRecord = null,
  isOpen = false,
  allRecords = [],
  onClose,
  onReviewRecord,
  showToast
}) {
  const [selectedUserId, setSelectedUserId] = useState(userId);
  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedDayRecord, setSelectedDayRecord] = useState(initialRecord);
  const [activeTab, setActiveTab] = useState("overview"); // overview, history, verifications, regularizations, audit

  // Date filtering inside modal
  const [dateRange, setDateRange] = useState({
    startDate: "",
    endDate: ""
  });

  // Export Dialog State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportTargetUserId, setExportTargetUserId] = useState(userId);
  const [exportStartDate, setExportStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [exportEndDate, setExportEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [exportFormat, setExportFormat] = useState("xlsx");
  const [exporting, setExporting] = useState(false);

  // Extract unique employees for selector dropdown
  const uniqueEmployees = useMemo(() => {
    const map = new Map();
    if (allRecords && allRecords.length > 0) {
      allRecords.forEach((r) => {
        const id = r.userId || r.user_id;
        const name = r.employeeName || r.name || r.user_name;
        if (id && !map.has(id)) {
          map.set(id, { id, name, employeeId: r.empId || r.employeeId || id });
        }
      });
    }
    return Array.from(map.values());
  }, [allRecords]);

  useEffect(() => {
    if (isOpen && userId) {
      setSelectedUserId(userId);
      setExportTargetUserId(userId);
      setSelectedDayRecord(initialRecord);
    }
  }, [isOpen, userId, initialRecord]);

  useEffect(() => {
    if (isOpen && selectedUserId) {
      loadProfile(selectedUserId, dateRange);
    }
  }, [isOpen, selectedUserId, dateRange]);

  const loadProfile = async (targetId, range) => {
    setLoading(true);
    try {
      const params = {};
      if (range?.startDate && range?.endDate) {
        params.startDate = range.startDate;
        params.endDate = range.endDate;
      } else {
        params.days = 60;
      }
      const res = await getEmployeeAttendanceProfile(targetId, params);
      if (res) {
        const data = res.data || res;
        setProfileData(data);
        // If no day record is selected or user changed, default to the most recent record
        if (!selectedDayRecord || selectedDayRecord.userId !== targetId) {
          if (data.history && data.history.length > 0) {
            setSelectedDayRecord(data.history[0]);
          }
        }
      }
    } catch (err) {
      console.error("Failed to load employee attendance profile:", err);
      showToast && showToast("Failed to load employee attendance details.", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const user = profileData?.employee || initialRecord || {};
  const summary = profileData?.summary || {
    totalWorkingDays: 0,
    presentDays: 0,
    lateDays: 0,
    absentDays: 0,
    halfDays: 0,
    onLeaveDays: 0,
    totalBreakDuration: "00h 00m",
    totalNetWorkingHours: "00h 00m",
    avgDailyWorkingHours: "00h 00m"
  };
  const historyList = profileData?.history || [];
  const verifications = profileData?.verificationAttempts || [];
  const regularizations = profileData?.regularizationHistory || [];
  const auditLogs = profileData?.auditHistory || [];

  // Active record to display in Section A - E
  const activeRecord = selectedDayRecord || historyList[0] || initialRecord || {};

  // Breaks for active record
  const break1 = activeRecord.break1 || { duration: "Not Taken", start: "—", end: "—", status: "Not Taken" };
  const break2 = activeRecord.break2 || { duration: "Not Taken", start: "—", end: "—", status: "Not Taken" };
  const break3 = activeRecord.break3 || { duration: "Not Taken", start: "—", end: "—", status: "Not Taken" };
  const allRecordedBreaks = activeRecord.breaks || activeRecord.allBreaks || [];
  const totalBreaksTaken = activeRecord.totalBreaksCount || allRecordedBreaks.length || 0;
  const totalBreakDuration = activeRecord.totalBreakDuration || activeRecord.total_break_duration || "00h 00m";
  const hasOngoingBreak = Boolean(activeRecord.hasOngoingBreak);

  // Locations & GPS
  const checkInLocation = activeRecord.checkInLocation || activeRecord.check_in_location || "GPS unavailable";
  const checkInCoords = activeRecord.checkInCoordinates;
  const checkOutLocation = activeRecord.checkOutLocation || activeRecord.check_out_location || "GPS unavailable";
  const checkOutCoords = activeRecord.checkOutCoordinates;
  const gpsVerificationStatus = activeRecord.gpsStatus || activeRecord.gpsVerification || "Not Available";
  const faceVerificationStatus = activeRecord.faceVerification || (activeRecord.biometricVerified ? "Verified" : "Not Available");

  // Working Hours calculation
  const totalAttendanceDuration = activeRecord.totalAttendanceDuration || activeRecord.total_attendance_duration || "00h 00m";
  const netWorkingHours = activeRecord.netWorkingHours || activeRecord.net_working_hours || "00h 00m";
  const attendanceStatus = activeRecord.attendanceStatus || activeRecord.status || "Present";

  // Handle Individual Report Download
  const handleDownloadReport = async () => {
    setExporting(true);
    try {
      const res = await getEmployeeAttendanceReportApi(exportTargetUserId, {
        startDate: exportStartDate,
        endDate: exportEndDate
      });

      if (!res || !res.records) {
        throw new Error(res?.error || "Failed to retrieve employee attendance records for export.");
      }

      const reportEmp = res.employee || user;
      const reportSummary = res.summary || summary;
      const records = res.records || [];

      const empNameClean = (reportEmp.employeeName || reportEmp.name || "Employee").replace(/\s+/g, "_");
      const filenameBase = `Attendance_Report_${empNameClean}_${exportStartDate}_${exportEndDate}`;

      if (exportFormat === "xlsx") {
        // Build Excel Workbook
        const aoaData = [
          ["INDIVIDUAL EMPLOYEE ATTENDANCE REPORT"],
          ["Generated On", new Date().toLocaleString()],
          ["Reporting Period", `${exportStartDate} to ${exportEndDate}`],
          [],
          ["EMPLOYEE INFORMATION"],
          ["Employee Name", reportEmp.employeeName || reportEmp.name || "—"],
          ["Employee ID", reportEmp.employeeId || "—"],
          ["Department", reportEmp.department || "—"],
          ["Designation", reportEmp.designation || "—"],
          [],
          ["SUMMARY INFORMATION"],
          ["Total Working Days", reportSummary.totalWorkingDays ?? records.length],
          ["Total Present Days", reportSummary.totalPresentDays ?? 0],
          ["Total Absent Days", reportSummary.totalAbsentDays ?? 0],
          ["Total Late Arrivals", reportSummary.totalLateArrivals ?? 0],
          ["Total Break Duration", reportSummary.totalBreakDuration || "00h 00m"],
          ["Total Net Working Hours", reportSummary.totalNetWorkingHours || "00h 00m"],
          ["Average Daily Working Hours", reportSummary.averageDailyWorkingHours || "00h 00m"],
          [],
          [
            "Attendance Date",
            "Check-in Time",
            "Check-in Location",
            "Break 1 Start",
            "Break 1 End",
            "Break 1 Duration",
            "Break 2 Start",
            "Break 2 End",
            "Break 2 Duration",
            "Break 3 Start",
            "Break 3 End",
            "Break 3 Duration",
            "Total Break Duration",
            "Check-out Time",
            "Check-out Location",
            "Total Attendance Duration",
            "Net Working Hours",
            "Attendance Status"
          ]
        ];

        records.forEach((r) => {
          aoaData.push([
            r.date || "",
            r.checkInTime || "--",
            r.checkInLocation || "GPS unavailable",
            r.break1Start || "—",
            r.break1End || "—",
            r.break1Duration || "Not Taken",
            r.break2Start || "—",
            r.break2End || "—",
            r.break2Duration || "Not Taken",
            r.break3Start || "—",
            r.break3End || "—",
            r.break3Duration || "Not Taken",
            r.totalBreakDuration || "00h 00m",
            r.checkOutTime || "--",
            r.checkOutLocation || "GPS unavailable",
            r.totalAttendanceDuration || "00h 00m",
            r.netWorkingHours || "00h 00m",
            r.attendanceStatus || "Present"
          ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(aoaData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Attendance Report");
        XLSX.writeFile(wb, `${filenameBase}.xlsx`);

        showToast && showToast(`Excel report downloaded for ${reportEmp.employeeName || "employee"}`, "success");
      } else if (exportFormat === "csv") {
        // Build CSV string
        const escapeCsv = (val) => {
          if (val == null) return '""';
          const str = String(val).replace(/"/g, '""');
          return `"${str}"`;
        };

        const csvLines = [
          `"INDIVIDUAL EMPLOYEE ATTENDANCE REPORT"`,
          `"Generated On",${escapeCsv(new Date().toLocaleString())}`,
          `"Reporting Period",${escapeCsv(`${exportStartDate} to ${exportEndDate}`)}`,
          `""`,
          `"EMPLOYEE INFORMATION"`,
          `"Employee Name",${escapeCsv(reportEmp.employeeName || reportEmp.name || "")}`,
          `"Employee ID",${escapeCsv(reportEmp.employeeId || "")}`,
          `"Department",${escapeCsv(reportEmp.department || "")}`,
          `"Designation",${escapeCsv(reportEmp.designation || "")}`,
          `""`,
          `"SUMMARY INFORMATION"`,
          `"Total Working Days",${reportSummary.totalWorkingDays ?? records.length}`,
          `"Total Present Days",${reportSummary.totalPresentDays ?? 0}`,
          `"Total Absent Days",${reportSummary.totalAbsentDays ?? 0}`,
          `"Total Late Arrivals",${reportSummary.totalLateArrivals ?? 0}`,
          `"Total Break Duration",${escapeCsv(reportSummary.totalBreakDuration || "00h 00m")}`,
          `"Total Net Working Hours",${escapeCsv(reportSummary.totalNetWorkingHours || "00h 00m")}`,
          `"Average Daily Working Hours",${escapeCsv(reportSummary.averageDailyWorkingHours || "00h 00m")}`,
          `""`,
          [
            "Attendance Date",
            "Check-in Time",
            "Check-in Location",
            "Break 1 Start",
            "Break 1 End",
            "Break 1 Duration",
            "Break 2 Start",
            "Break 2 End",
            "Break 2 Duration",
            "Break 3 Start",
            "Break 3 End",
            "Break 3 Duration",
            "Total Break Duration",
            "Check-out Time",
            "Check-out Location",
            "Total Attendance Duration",
            "Net Working Hours",
            "Attendance Status"
          ].map(escapeCsv).join(",")
        ];

        records.forEach((r) => {
          csvLines.push([
            r.date || "",
            r.checkInTime || "--",
            r.checkInLocation || "GPS unavailable",
            r.break1Start || "—",
            r.break1End || "—",
            r.break1Duration || "Not Taken",
            r.break2Start || "—",
            r.break2End || "—",
            r.break2Duration || "Not Taken",
            r.break3Start || "—",
            r.break3End || "—",
            r.break3Duration || "Not Taken",
            r.totalBreakDuration || "00h 00m",
            r.checkOutTime || "--",
            r.checkOutLocation || "GPS unavailable",
            r.totalAttendanceDuration || "00h 00m",
            r.netWorkingHours || "00h 00m",
            r.attendanceStatus || "Present"
          ].map(escapeCsv).join(","));
        });

        const blob = new Blob([csvLines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `${filenameBase}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast && showToast(`CSV report downloaded for ${reportEmp.employeeName || "employee"}`, "success");
      } else if (exportFormat === "pdf") {
        // Build PDF document
        const doc = new jsPDF("landscape", "pt", "a4");

        // Header Title
        doc.setFontSize(16);
        doc.setTextColor(30, 27, 75); // Deep Indigo
        doc.text("Zuna HRMS - Individual Employee Attendance Report", 40, 40);

        // Subtitle
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text(`Generated On: ${new Date().toLocaleString()} | Period: ${exportStartDate} to ${exportEndDate}`, 40, 56);

        // Employee Card Box
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(40, 68, 762, 45, 6, 6, "FD");

        doc.setFontSize(9);
        doc.setTextColor(15, 23, 42);
        doc.text(`Employee Name: ${reportEmp.employeeName || reportEmp.name || "—"}`, 50, 85);
        doc.text(`Employee ID: ${reportEmp.employeeId || "—"}`, 250, 85);
        doc.text(`Department: ${reportEmp.department || "—"}`, 450, 85);
        doc.text(`Designation: ${reportEmp.designation || "—"}`, 620, 85);

        doc.text(`Working Days: ${reportSummary.totalWorkingDays ?? records.length} | Present: ${reportSummary.totalPresentDays ?? 0} | Absent: ${reportSummary.totalAbsentDays ?? 0} | Late: ${reportSummary.totalLateArrivals ?? 0}`, 50, 102);
        doc.text(`Total Breaks: ${reportSummary.totalBreakDuration || "00h 00m"} | Net Work Hours: ${reportSummary.totalNetWorkingHours || "00h 00m"} | Daily Avg: ${reportSummary.averageDailyWorkingHours || "00h 00m"}`, 450, 102);

        // Table
        const tableBody = records.map((r) => [
          r.date || "",
          r.checkInTime || "--",
          r.checkInLocation || "GPS unavailable",
          r.break1Duration || "Not Taken",
          r.break2Duration || "Not Taken",
          r.break3Duration || "Not Taken",
          r.totalBreakDuration || "00h 00m",
          r.checkOutTime || "--",
          r.checkOutLocation || "GPS unavailable",
          r.totalAttendanceDuration || "00h 00m",
          r.netWorkingHours || "00h 00m",
          r.attendanceStatus || "Present"
        ]);

        autoTable(doc, {
          startY: 122,
          head: [
            [
              "Date",
              "Check In",
              "In Location",
              "Break 1",
              "Break 2",
              "Break 3",
              "Total Brk",
              "Check Out",
              "Out Location",
              "Total Att.",
              "Net Hours",
              "Status"
            ]
          ],
          body: tableBody,
          theme: "grid",
          styles: {
            fontSize: 7.5,
            cellPadding: 4,
            textColor: [30, 41, 59]
          },
          headStyles: {
            fillColor: [79, 70, 229],
            textColor: [255, 255, 255],
            fontStyle: "bold"
          },
          columnStyles: {
            0: { cellWidth: 55 },
            1: { cellWidth: 48 },
            2: { cellWidth: 80 },
            3: { cellWidth: 55 },
            4: { cellWidth: 55 },
            5: { cellWidth: 55 },
            6: { cellWidth: 55 },
            7: { cellWidth: 48 },
            8: { cellWidth: 80 },
            9: { cellWidth: 58 },
            10: { cellWidth: 58, fontStyle: "bold" },
            11: { cellWidth: 55 }
          }
        });

        doc.save(`${filenameBase}.pdf`);
        showToast && showToast(`PDF report downloaded for ${reportEmp.employeeName || "employee"}`, "success");
      }

      setShowExportModal(false);
    } catch (err) {
      console.error("Export error:", err);
      showToast && showToast(err.message || "Failed to download attendance report.", "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#12131A] border border-zinc-700/80 rounded-2xl w-full max-w-5xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-4 bg-zinc-900/70">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white text-lg font-black shadow-lg shadow-purple-950/40 shrink-0">
              {(user.employeeName || user.name || "U").charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  {user.employeeName || user.name || "Employee Attendance"}
                </h3>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-300 border border-purple-500/30">
                  #{user.empId || user.employeeId || selectedUserId?.slice(-6) || "EMP"}
                </span>
                {user.role && (
                  <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                    {user.role}
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-400 flex flex-wrap items-center gap-2 mt-1">
                <span className="text-purple-300 font-medium">{user.department || "General"}</span>
                <span>•</span>
                <span className="text-zinc-300">{user.designation || "Staff"}</span>
                <span>•</span>
                <span className="text-zinc-400 font-mono text-[11px]">
                  Shift: {user.shift || user.shift_name || (user.shift_start ? `${user.shift_start} - ${user.shift_end}` : "09:00 - 18:00")}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Download Attendance Button */}
            <button
              type="button"
              onClick={() => {
                setExportTargetUserId(selectedUserId);
                setShowExportModal(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-950/40 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download Attendance</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Close Profile"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab & Day Picker Toolbar */}
        <div className="px-6 py-2.5 bg-zinc-900/40 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-1 overflow-x-auto">
            {[
              { id: "overview", label: "Attendance & Break Details" },
              { id: "history", label: `Daily Log History (${historyList.length})` },
              { id: "verifications", label: `GPS & Face Telemetry (${verifications.length})` },
              { id: "regularizations", label: `Regularization (${regularizations.length})` },
              { id: "audit", label: `Audit Trail (${auditLogs.length})` }
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  activeTab === t.id
                    ? "bg-purple-600 text-white shadow-md shadow-purple-950/30"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Quick Day Selector for detailed view */}
          {historyList.length > 0 && activeTab === "overview" && (
            <div className="flex items-center gap-2">
              <span className="text-zinc-400 text-[11px] font-medium">Viewing Date:</span>
              <select
                value={activeRecord.date || activeRecord.date_formatted || ""}
                onChange={(e) => {
                  const targetDate = e.target.value;
                  const found = historyList.find((h) => (h.date || h.date_formatted) === targetDate);
                  if (found) setSelectedDayRecord(found);
                }}
                className="bg-zinc-800 border border-zinc-700/80 text-zinc-200 text-xs rounded-lg px-2.5 py-1 focus:outline-none focus:border-purple-500 font-mono"
              >
                {historyList.map((h) => (
                  <option key={h.id || h.date} value={h.date || h.date_formatted}>
                    {h.date || h.date_formatted} ({h.attendanceStatus || h.status || "Present"})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Modal Scroll Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {loading ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-8 h-8 mx-auto border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-zinc-400">Loading verified employee attendance, breaks, and telemetry...</p>
            </div>
          ) : activeTab === "overview" ? (
            <div className="space-y-5">
              {/* Summary KPIs Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3 text-xs">
                <div className="bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
                  <div className="text-[10px] text-zinc-400 uppercase font-semibold">Total Logs</div>
                  <div className="text-lg font-bold font-mono text-zinc-200 mt-0.5">{summary.totalWorkingDays || historyList.length}</div>
                </div>
                <div className="bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
                  <div className="text-[10px] text-zinc-400 uppercase font-semibold">Present</div>
                  <div className="text-lg font-bold font-mono text-emerald-400 mt-0.5">{summary.presentDays || summary.totalPresentDays || 0}</div>
                </div>
                <div className="bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
                  <div className="text-[10px] text-zinc-400 uppercase font-semibold">Late</div>
                  <div className="text-lg font-bold font-mono text-amber-400 mt-0.5">{summary.lateDays || summary.totalLateArrivals || 0}</div>
                </div>
                <div className="bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
                  <div className="text-[10px] text-zinc-400 uppercase font-semibold">Absent</div>
                  <div className="text-lg font-bold font-mono text-rose-400 mt-0.5">{summary.absentDays || summary.totalAbsentDays || 0}</div>
                </div>
                <div className="bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
                  <div className="text-[10px] text-zinc-400 uppercase font-semibold">Total Break</div>
                  <div className="text-lg font-bold font-mono text-amber-300 mt-0.5">{summary.totalBreakDuration || "00h 00m"}</div>
                </div>
                <div className="bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
                  <div className="text-[10px] text-zinc-400 uppercase font-semibold">Net Work Hours</div>
                  <div className="text-lg font-bold font-mono text-purple-300 mt-0.5">{summary.totalNetWorkingHours || "00h 00m"}</div>
                </div>
                <div className="bg-zinc-900/60 p-3 rounded-xl border border-zinc-800 col-span-2 sm:col-span-1">
                  <div className="text-[10px] text-zinc-400 uppercase font-semibold">Daily Avg</div>
                  <div className="text-lg font-bold font-mono text-indigo-300 mt-0.5">{summary.avgDailyWorkingHours || "00h 00m"}</div>
                </div>
              </div>

              {/* Day Details Banner */}
              <div className="flex items-center justify-between p-3.5 bg-purple-600/10 border border-purple-500/20 rounded-xl text-xs">
                <div className="flex items-center gap-2.5">
                  <Calendar className="w-4 h-4 text-purple-400" />
                  <span className="font-semibold text-zinc-200">
                    Inspection For: <span className="font-mono text-purple-300">{activeRecord.date || activeRecord.date_formatted || "Current Session"}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">Status:</span>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-purple-500/20 text-purple-200 border border-purple-500/30">
                    {attendanceStatus}
                  </span>
                </div>
              </div>

              {/* Grid Layout: Check-in, Breaks, Check-out, and Working Hours */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Employee Info Card (Section A) */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4.5 space-y-3">
                  <div className="flex items-center justify-between pb-2.5 border-b border-zinc-800">
                    <div className="flex items-center gap-2 text-zinc-200 font-bold text-xs uppercase tracking-wider">
                      <User className="w-4 h-4 text-purple-400" />
                      <span>Employee Information</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] text-zinc-400 uppercase font-semibold block">Employee Name</span>
                      <span className="font-semibold text-zinc-200">{user.employeeName || user.name || "—"}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-400 uppercase font-semibold block">Employee ID</span>
                      <span className="font-mono text-purple-300">#{user.empId || user.employeeId || "EMP"}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-400 uppercase font-semibold block">Department</span>
                      <span className="text-zinc-200">{user.department || "General"}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-400 uppercase font-semibold block">Designation</span>
                      <span className="text-zinc-200">{user.designation || "Staff"}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-400 uppercase font-semibold block">Assigned Shift</span>
                      <span className="font-mono text-zinc-300 text-[11px]">
                        {user.shift || (user.shift_start ? `${user.shift_start} - ${user.shift_end}` : "09:00 - 18:00")}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-400 uppercase font-semibold block">Attendance Date</span>
                      <span className="font-mono text-emerald-400 text-[11px] font-semibold">{activeRecord.date || activeRecord.date_formatted || "—"}</span>
                    </div>
                  </div>
                </div>

                {/* 2. Check-in Details Card (Section B) */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4.5 space-y-3">
                  <div className="flex items-center justify-between pb-2.5 border-b border-zinc-800">
                    <div className="flex items-center gap-2 text-zinc-200 font-bold text-xs uppercase tracking-wider">
                      <Clock className="w-4 h-4 text-emerald-400" />
                      <span>Check-in Details</span>
                    </div>
                    <span className="text-[11px] font-mono text-emerald-400 font-bold">
                      {activeRecord.checkIn || activeRecord.check_in || "--"}
                    </span>
                  </div>

                  <div className="space-y-2.5 text-xs">
                    <div>
                      <span className="text-[10px] text-zinc-400 uppercase font-semibold block">Check-in Location / Address</span>
                      <div className="flex items-start gap-1.5 mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
                        <span className="text-zinc-300 font-medium">{checkInLocation}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-zinc-800/60">
                      <div>
                        <span className="text-[10px] text-zinc-400 uppercase font-semibold block">GPS Coordinates</span>
                        <span className="font-mono text-zinc-400">
                          {checkInCoords ? `${checkInCoords.latitude?.toFixed(4)}, ${checkInCoords.longitude?.toFixed(4)}` : "GPS unavailable"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-zinc-400 uppercase font-semibold block">GPS Verification</span>
                        <span className={`font-semibold ${gpsVerificationStatus === "Verified" ? "text-emerald-400" : "text-zinc-400"}`}>
                          {gpsVerificationStatus}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <span className="text-[10px] text-zinc-400 uppercase font-semibold block">Geofence Status</span>
                        <span className={`font-semibold ${gpsVerificationStatus === "Verified" ? "text-emerald-400" : "text-amber-400"}`}>
                          {gpsVerificationStatus === "Verified" ? "Within office radius" : "Outside / Not logged"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-zinc-400 uppercase font-semibold block">Face Verification</span>
                        <span className={`font-semibold ${faceVerificationStatus === "Verified" ? "text-purple-300" : "text-zinc-400"}`}>
                          {faceVerificationStatus}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Break Tracking Card (Section C) */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4.5 space-y-3.5 md:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-zinc-800">
                    <div className="flex items-center gap-2 text-zinc-200 font-bold text-xs uppercase tracking-wider">
                      <Coffee className="w-4 h-4 text-amber-400" />
                      <span>Break Tracking</span>
                    </div>

                    <div className="flex items-center gap-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-zinc-400">Total Breaks Taken:</span>
                        <span className="font-mono font-bold text-zinc-200 px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">
                          {totalBreaksTaken}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-zinc-400">Total Duration:</span>
                        <span className="font-mono font-bold text-amber-300 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30">
                          {totalBreakDuration}
                        </span>
                      </div>
                      {hasOngoingBreak && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                          Break Ongoing
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Break 1, Break 2, Break 3 Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Break 1 */}
                    <div className="bg-zinc-900/80 border border-zinc-800 p-3.5 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-zinc-300">Break 1</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          break1.status === "Ongoing" ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse" :
                          break1.status === "Completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                          "bg-zinc-800 text-zinc-500"
                        }`}>
                          {break1.status}
                        </span>
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between text-zinc-400 text-[11px]">
                          <span>Start Time:</span>
                          <span className="font-mono text-zinc-200">{break1.start || "—"}</span>
                        </div>
                        <div className="flex justify-between text-zinc-400 text-[11px]">
                          <span>End Time:</span>
                          <span className="font-mono text-zinc-200">{break1.end || "—"}</span>
                        </div>
                        <div className="flex justify-between text-zinc-400 text-[11px] pt-1 border-t border-zinc-800">
                          <span>Duration:</span>
                          <span className="font-mono font-bold text-amber-300">{break1.duration}</span>
                        </div>
                      </div>
                    </div>

                    {/* Break 2 */}
                    <div className="bg-zinc-900/80 border border-zinc-800 p-3.5 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-zinc-300">Break 2</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          break2.status === "Ongoing" ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse" :
                          break2.status === "Completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                          "bg-zinc-800 text-zinc-500"
                        }`}>
                          {break2.status}
                        </span>
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between text-zinc-400 text-[11px]">
                          <span>Start Time:</span>
                          <span className="font-mono text-zinc-200">{break2.start || "—"}</span>
                        </div>
                        <div className="flex justify-between text-zinc-400 text-[11px]">
                          <span>End Time:</span>
                          <span className="font-mono text-zinc-200">{break2.end || "—"}</span>
                        </div>
                        <div className="flex justify-between text-zinc-400 text-[11px] pt-1 border-t border-zinc-800">
                          <span>Duration:</span>
                          <span className="font-mono font-bold text-amber-300">{break2.duration}</span>
                        </div>
                      </div>
                    </div>

                    {/* Break 3 */}
                    <div className="bg-zinc-900/80 border border-zinc-800 p-3.5 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-zinc-300">Break 3</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          break3.status === "Ongoing" ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse" :
                          break3.status === "Completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                          "bg-zinc-800 text-zinc-500"
                        }`}>
                          {break3.status}
                        </span>
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between text-zinc-400 text-[11px]">
                          <span>Start Time:</span>
                          <span className="font-mono text-zinc-200">{break3.start || "—"}</span>
                        </div>
                        <div className="flex justify-between text-zinc-400 text-[11px]">
                          <span>End Time:</span>
                          <span className="font-mono text-zinc-200">{break3.end || "—"}</span>
                        </div>
                        <div className="flex justify-between text-zinc-400 text-[11px] pt-1 border-t border-zinc-800">
                          <span>Duration:</span>
                          <span className="font-mono font-bold text-amber-300">{break3.duration}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* If more than 3 breaks exist */}
                  {allRecordedBreaks.length > 3 && (
                    <div className="pt-2">
                      <span className="text-xs font-semibold text-zinc-400 block mb-2">Additional Recorded Breaks:</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {allRecordedBreaks.slice(3).map((b, i) => (
                          <div key={i} className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between">
                            <span className="font-semibold text-zinc-300">{b.type || `Break ${i + 4}`}</span>
                            <span className="font-mono text-zinc-400">{b.startTimeFormatted || b.start || "—"} - {b.endTimeFormatted || b.end || "Ongoing"}</span>
                            <span className="font-mono font-bold text-amber-300">{b.durationFormatted || `${b.durationMinutes || 0}m`}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. Check-out Details Card (Section D) */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4.5 space-y-3">
                  <div className="flex items-center justify-between pb-2.5 border-b border-zinc-800">
                    <div className="flex items-center gap-2 text-zinc-200 font-bold text-xs uppercase tracking-wider">
                      <Clock className="w-4 h-4 text-indigo-400" />
                      <span>Check-out Details</span>
                    </div>
                    <span className="text-[11px] font-mono text-indigo-400 font-bold">
                      {activeRecord.checkOut || activeRecord.check_out || "--"}
                    </span>
                  </div>

                  <div className="space-y-2.5 text-xs">
                    <div>
                      <span className="text-[10px] text-zinc-400 uppercase font-semibold block">Check-out Location / Address</span>
                      <div className="flex items-start gap-1.5 mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
                        <span className="text-zinc-300 font-medium">{checkOutLocation}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-zinc-800/60">
                      <div>
                        <span className="text-[10px] text-zinc-400 uppercase font-semibold block">GPS Coordinates</span>
                        <span className="font-mono text-zinc-400">
                          {checkOutCoords ? `${checkOutCoords.latitude?.toFixed(4)}, ${checkOutCoords.longitude?.toFixed(4)}` : "GPS unavailable"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-zinc-400 uppercase font-semibold block">GPS Verification</span>
                        <span className={`font-semibold ${checkOutLocation !== "GPS unavailable" ? "text-emerald-400" : "text-zinc-400"}`}>
                          {checkOutLocation !== "GPS unavailable" ? "Logged" : "Not Available"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 5. Working Hours Calculation (Section E) */}
                <div className="bg-gradient-to-br from-purple-900/20 to-zinc-900/60 border border-purple-500/30 rounded-2xl p-4.5 space-y-3">
                  <div className="flex items-center justify-between pb-2.5 border-b border-zinc-800">
                    <div className="flex items-center gap-2 text-zinc-200 font-bold text-xs uppercase tracking-wider">
                      <Timer className="w-4 h-4 text-purple-400" />
                      <span>Working Hours Calculation</span>
                    </div>
                    <span className="text-[10px] font-mono text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                      Exact Net Duration
                    </span>
                  </div>

                  <div className="bg-black/30 p-2.5 rounded-xl border border-zinc-800 text-[11px] text-zinc-400 font-mono">
                    Net Working Hours = Total Attendance Duration - Total Break Duration
                  </div>

                  <div className="space-y-2 text-xs pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">Total Attendance Duration:</span>
                      <span className="font-mono font-bold text-zinc-200">{totalAttendanceDuration}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">Total Break Duration:</span>
                      <span className="font-mono font-bold text-amber-300">- {totalBreakDuration}</span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-purple-500/30 text-sm">
                      <span className="font-bold text-zinc-200">Net Working Hours:</span>
                      <span className="font-mono font-extrabold text-purple-300 text-base">{netWorkingHours}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab === "history" ? (
            /* History Table */
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Showing daily verified attendance records with break tracking:</span>
                <span className="font-mono text-zinc-300">{historyList.length} total logged days</span>
              </div>

              <div className="overflow-x-auto border border-zinc-800 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-zinc-900/80 text-zinc-400 border-b border-zinc-800 text-[11px] uppercase">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Check-In</th>
                      <th className="py-2.5 px-3">In Location</th>
                      <th className="py-2.5 px-3">Break 1</th>
                      <th className="py-2.5 px-3">Break 2</th>
                      <th className="py-2.5 px-3">Break 3</th>
                      <th className="py-2.5 px-3">Total Break</th>
                      <th className="py-2.5 px-3">Check-Out</th>
                      <th className="py-2.5 px-3">Out Location</th>
                      <th className="py-2.5 px-3">Net Work Hours</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Inspect</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {historyList.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="py-8 text-center text-zinc-500 text-xs">
                          No historical attendance records found for this employee.
                        </td>
                      </tr>
                    ) : (
                      historyList.map((row) => {
                        const isCurrent = (row.date || row.date_formatted) === (activeRecord.date || activeRecord.date_formatted);
                        return (
                          <tr
                            key={row.id || `${row.date}`}
                            className={`hover:bg-zinc-800/40 transition-colors ${isCurrent ? "bg-purple-950/20" : ""}`}
                          >
                            <td className="py-2.5 px-3 font-mono text-zinc-200 font-semibold">{row.date || row.date_formatted}</td>
                            <td className="py-2.5 px-3 font-mono text-emerald-400">{row.checkIn || row.check_in_formatted || "--"}</td>
                            <td className="py-2.5 px-3 text-[11px] text-zinc-400 max-w-[100px] truncate" title={row.checkInLocation || row.check_in_location || ""}>
                              {row.checkInLocation || row.check_in_location || "GPS unavailable"}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-300">{row.break1Duration || "Not Taken"}</td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-300">{row.break2Duration || "Not Taken"}</td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-300">{row.break3Duration || "Not Taken"}</td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-amber-300 font-medium">{row.totalBreakDuration || "00h 00m"}</td>
                            <td className="py-2.5 px-3 font-mono text-indigo-400">{row.checkOut || row.check_out_formatted || "--"}</td>
                            <td className="py-2.5 px-3 text-[11px] text-zinc-400 max-w-[100px] truncate" title={row.checkOutLocation || row.check_out_location || ""}>
                              {row.checkOutLocation || row.check_out_location || "GPS unavailable"}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-purple-300 font-bold">{row.netWorkingHours || "--"}</td>
                            <td className="py-2.5 px-3">
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700/60">
                                {row.attendanceStatus || row.status || "Present"}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedDayRecord(row);
                                  setActiveTab("overview");
                                }}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-purple-600/10 hover:bg-purple-600 text-purple-300 hover:text-white transition-colors cursor-pointer"
                              >
                                View Day
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : activeTab === "verifications" ? (
            /* Verifications Tab */
            <div className="space-y-3">
              {verifications.length === 0 ? (
                <div className="py-12 text-center text-zinc-500 text-xs">
                  No GPS or biometric verification attempts recorded.
                </div>
              ) : (
                verifications.map((v, i) => (
                  <div key={i} className="bg-zinc-900/60 border border-zinc-800 p-3.5 rounded-xl flex items-start justify-between gap-3 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-zinc-200 uppercase text-[11px]">{v.action_type || "Verification"}</span>
                        <span className="text-zinc-500 font-mono text-[11px]">{v.timestamp || v.created_at || v.attempted_at}</span>
                      </div>
                      <div className="text-zinc-400 text-[11px]">
                        GPS Geofence: <span className={v.within_fence || v.gps_result === "verified" ? "text-emerald-400" : "text-rose-400 font-medium"}>
                          {v.within_fence || v.gps_result === "verified" ? "Within authorized radius" : "Outside fence boundary"}
                        </span>
                        {v.distance_meters != null && ` (${v.distance_meters}m from office)`}
                      </div>
                      <div className="text-zinc-400 text-[11px]">
                        Biometric Match: <span className="text-purple-300 font-medium">{v.face_result || v.face_status || "Completed"}</span>
                        {v.liveness_result && ` • Liveness: ${v.liveness_result}`}
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                      v.status === "passed" || v.verified ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                    }`}>
                      {v.status === "passed" || v.verified ? "Verified" : "Flagged"}
                    </span>
                  </div>
                ))
              )}
            </div>
          ) : activeTab === "regularizations" ? (
            /* Regularizations Tab */
            <div className="space-y-3">
              {regularizations.length === 0 ? (
                <div className="py-12 text-center text-zinc-500 text-xs">
                  No regularization requests on file for this employee.
                </div>
              ) : (
                regularizations.map((r, i) => (
                  <div key={i} className="bg-zinc-900/60 border border-zinc-800 p-3.5 rounded-xl text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-zinc-300 font-semibold">{r.attendance_date || r.date}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        r.status === "approved" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                        r.status === "rejected" ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" :
                        "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                      }`}>
                        {r.status || "Pending"}
                      </span>
                    </div>
                    <div className="text-zinc-400 text-[11px]">
                      Reason: <span className="text-zinc-300">{r.reason || "None"}</span>
                    </div>
                    {r.managerComment && r.managerComment !== "—" && (
                      <div className="text-purple-300 text-[11px]">
                        Reviewer Remark: <span className="text-zinc-300">{r.managerComment}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            /* Audit Log Tab */
            <div className="space-y-3">
              {auditLogs.length === 0 ? (
                <div className="py-12 text-center text-zinc-500 text-xs">
                  No administrative modifications logged for this employee.
                </div>
              ) : (
                auditLogs.map((log, i) => (
                  <div key={i} className="bg-zinc-900/60 border border-zinc-800 p-3 rounded-xl text-xs space-y-1">
                    <div className="flex items-center justify-between text-zinc-400 text-[11px]">
                      <span className="font-semibold text-purple-300">{log.action || "ATTENDANCE_MODIFIED"}</span>
                      <span className="font-mono text-zinc-500">{log.created_at || log.timestamp}</span>
                    </div>
                    <div className="text-zinc-300 text-[11px]">
                      Performed by: <span className="font-medium text-zinc-200">{log.user_name || "Admin"}</span> ({log.user_role || "admin"})
                    </div>
                    {log.details && (
                      <div className="text-zinc-400 text-[10px] font-mono bg-zinc-950 p-2 rounded border border-zinc-800">
                        {typeof log.details === "object" ? JSON.stringify(log.details) : log.details}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between text-xs">
          <div className="text-zinc-500 text-[11px]">
            * All break durations and working hours computed from verified database telemetry.
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors cursor-pointer"
          >
            Close Details
          </button>
        </div>
      </div>

      {/* Download Attendance Modal Dialog */}
      {showExportModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
          <div className="bg-[#12131A] border border-purple-500/40 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-5 text-left">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/30">
                  <Download className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">Download Employee Attendance</h4>
                  <p className="text-[11px] text-zinc-400">Generate verified report with breaks & hours.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Employee Selection */}
              <div>
                <label className="text-[11px] font-semibold text-zinc-300 block mb-1">
                  Selected Employee
                </label>
                <select
                  value={exportTargetUserId}
                  onChange={(e) => setExportTargetUserId(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl px-3 py-2 text-zinc-200 text-xs focus:outline-none focus:border-purple-500"
                >
                  {uniqueEmployees.length > 0 ? (
                    uniqueEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} (#{emp.employeeId})
                      </option>
                    ))
                  ) : (
                    <option value={user.id || selectedUserId}>
                      {user.employeeName || user.name || "Current Employee"} (#{user.empId || "EMP"})
                    </option>
                  )}
                </select>
              </div>

              {/* Date Range Selection */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-zinc-300 block mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={exportStartDate}
                    onChange={(e) => setExportStartDate(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl px-3 py-2 text-zinc-200 text-xs focus:outline-none focus:border-purple-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-zinc-300 block mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={exportEndDate}
                    onChange={(e) => setExportEndDate(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl px-3 py-2 text-zinc-200 text-xs focus:outline-none focus:border-purple-500 font-mono"
                  />
                </div>
              </div>

              {/* Export Format Selection */}
              <div>
                <label className="text-[11px] font-semibold text-zinc-300 block mb-2">
                  Select Export Format
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setExportFormat("xlsx")}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all cursor-pointer ${
                      exportFormat === "xlsx"
                        ? "bg-purple-600/20 border-purple-500 text-purple-200 font-bold shadow-md shadow-purple-950/40"
                        : "bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    <FileSpreadsheet className="w-5 h-5 mb-1 text-emerald-400" />
                    <span className="text-[11px]">Excel (.xlsx)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportFormat("csv")}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all cursor-pointer ${
                      exportFormat === "csv"
                        ? "bg-purple-600/20 border-purple-500 text-purple-200 font-bold shadow-md shadow-purple-950/40"
                        : "bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    <FileText className="w-5 h-5 mb-1 text-cyan-400" />
                    <span className="text-[11px]">CSV (.csv)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportFormat("pdf")}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all cursor-pointer ${
                      exportFormat === "pdf"
                        ? "bg-purple-600/20 border-purple-500 text-purple-200 font-bold shadow-md shadow-purple-950/40"
                        : "bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    <FileText className="w-5 h-5 mb-1 text-rose-400" />
                    <span className="text-[11px]">PDF (.pdf)</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={handleDownloadReport}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white transition-all shadow-md shadow-purple-950/40 cursor-pointer disabled:opacity-50"
              >
                {exporting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Exporting...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Report</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
