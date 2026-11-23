import React, { useState, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Eye,
  Edit3,
  Clock,
  MapPin,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  UserCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Lock,
  Calendar
} from "lucide-react";

export default function EmployeeAttendanceTable({
  records = [],
  loading = false,
  error = null,
  onRetry,
  onViewEmployee,
  onReviewRecord,
  onRegularizeRecord,
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [sortField, setSortField] = useState("date");
  const [sortDirection, setSortDirection] = useState("desc");

  // Sorting
  const sortedRecords = useMemo(() => {
    if (!records || !records.length) return [];
    return [...records].sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (sortField === "name") {
        valA = a.employeeName || a.name || "";
        valB = b.employeeName || b.name || "";
      } else if (sortField === "checkIn") {
        valA = a.check_in_time || a.checkIn || "";
        valB = b.check_in_time || b.checkIn || "";
      } else if (sortField === "workingHours") {
        valA = Number(a.working_hours || a.workingHours || 0);
        valB = Number(b.working_hours || b.workingHours || 0);
      } else if (sortField === "status") {
        valA = a.attendance_status || a.status || "";
        valB = b.attendance_status || b.status || "";
      }

      if (valA === valB) return 0;
      if (valA == null) return 1;
      if (valB == null) return -1;

      const compare = typeof valA === "string" ? valA.localeCompare(String(valB)) : valA > valB ? 1 : -1;
      return sortDirection === "asc" ? compare : -compare;
    });
  }, [records, sortField, sortDirection]);

  // Pagination
  const totalPages = Math.ceil(sortedRecords.length / pageSize) || 1;
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedRecords.slice(start, start + pageSize);
  }, [sortedRecords, currentPage, pageSize]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const renderSortIcon = (field) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-zinc-500 opacity-50 group-hover:opacity-100" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="w-3.5 h-3.5 text-purple-400" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-purple-400" />
    );
  };

  // Status Badge Helper
  const getStatusBadge = (status) => {
    const s = (status || "Unknown").toLowerCase();
    switch (s) {
      case "present":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Present
          </span>
        );
      case "late":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            Late
          </span>
        );
      case "absent":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <XCircle className="w-3 h-3 text-rose-400" />
            Absent
          </span>
        );
      case "half day":
      case "half_day":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Clock className="w-3 h-3 text-indigo-400" />
            Half Day
          </span>
        );
      case "on leave":
      case "on_leave":
      case "leave":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Calendar className="w-3 h-3 text-blue-400" />
            On Leave
          </span>
        );
      case "holiday":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            Holiday
          </span>
        );
      case "weekly off":
      case "weekly_off":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
            Weekly Off
          </span>
        );
      case "pending":
      case "pending verification":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">
            <Clock className="w-3 h-3 text-orange-400" />
            Pending
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-700/40 text-zinc-300 border border-zinc-600/30">
            {status}
          </span>
        );
    }
  };

  // GPS Verification Badge
  const getGpsBadge = (status) => {
    const s = (status || "").toLowerCase();
    if (s.includes("verified")) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" title="GPS Verified within office geofence">
          <ShieldCheck className="w-3 h-3 text-emerald-400" />
          Verified
        </span>
      );
    }
    if (s.includes("fail") || s.includes("outside")) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20" title="GPS location outside authorized office geofence">
          <ShieldAlert className="w-3 h-3 text-rose-400" />
          Failed
        </span>
      );
    }
    if (s.includes("insufficient") || s.includes("accuracy")) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20" title="GPS accuracy insufficient">
          <AlertTriangle className="w-3 h-3 text-amber-400" />
          Accuracy Low
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700/40" title="No GPS data recorded">
        <ShieldX className="w-3 h-3 text-zinc-500" />
        N/A
      </span>
    );
  };

  // Face Verification Badge
  const getFaceBadge = (status) => {
    const s = (status || "").toLowerCase();
    if (s.includes("verified") || s.includes("matched")) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" title="Biometric Face & Liveness Verified">
          <UserCheck className="w-3 h-3 text-emerald-400" />
          Verified
        </span>
      );
    }
    if (s.includes("fail") || s.includes("mismatch")) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20" title="Face mismatch or spoof detected">
          <AlertTriangle className="w-3 h-3 text-rose-400" />
          Failed
        </span>
      );
    }
    if (s.includes("inconclusive")) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20" title="Low lighting or low confidence">
          <HelpCircle className="w-3 h-3 text-amber-400" />
          Inconclusive
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700/40" title="No face biometric verification required/logged">
        <span className="text-zinc-500 font-mono text-[10px]">--</span>
        N/A
      </span>
    );
  };

  return (
    <div className="bg-[#12131A] border border-zinc-800/80 rounded-2xl overflow-hidden shadow-xl">
      {/* Table Header Meta */}
      <div className="px-5 py-3.5 border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-zinc-200">
            Attendance Log Records
          </span>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20">
            {sortedRecords.length} {sortedRecords.length === 1 ? "entry" : "entries"}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span>Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="bg-zinc-800 text-zinc-200 border border-zinc-700/60 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-purple-500"
          >
            <option value={10}>10</option>
            <option value={15}>15</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {/* Table Scroll Area */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400 bg-zinc-900/60 font-semibold uppercase tracking-wider text-[11px]">
              <th
                onClick={() => handleSort("empId")}
                className="py-3.5 px-4 cursor-pointer hover:text-zinc-200 transition-colors select-none"
              >
                <div className="flex items-center gap-1.5">
                  <span>EMP ID</span>
                  {renderSortIcon("empId")}
                </div>
              </th>
              <th
                onClick={() => handleSort("name")}
                className="py-3.5 px-4 cursor-pointer hover:text-zinc-200 transition-colors select-none min-w-[180px]"
              >
                <div className="flex items-center gap-1.5">
                  <span>Employee</span>
                  {renderSortIcon("name")}
                </div>
              </th>
              <th className="py-3.5 px-4">Department</th>
              <th className="py-3.5 px-4">Shift</th>
              <th
                onClick={() => handleSort("date")}
                className="py-3.5 px-4 cursor-pointer hover:text-zinc-200 transition-colors select-none"
              >
                <div className="flex items-center gap-1.5">
                  <span>Date</span>
                  {renderSortIcon("date")}
                </div>
              </th>
              <th
                onClick={() => handleSort("checkIn")}
                className="py-3.5 px-4 cursor-pointer hover:text-zinc-200 transition-colors select-none"
              >
                <div className="flex items-center gap-1.5">
                  <span>Check In</span>
                  {renderSortIcon("checkIn")}
                </div>
              </th>
              <th className="py-3.5 px-4">Check Out</th>
              <th
                onClick={() => handleSort("workingHours")}
                className="py-3.5 px-4 cursor-pointer hover:text-zinc-200 transition-colors select-none"
              >
                <div className="flex items-center gap-1.5">
                  <span>Working Hrs</span>
                  {renderSortIcon("workingHours")}
                </div>
              </th>
              <th className="py-3.5 px-3">Late By</th>
              <th className="py-3.5 px-3">Early Dep.</th>
              <th className="py-3.5 px-3 text-center">GPS</th>
              <th className="py-3.5 px-3 text-center">Face</th>
              <th
                onClick={() => handleSort("status")}
                className="py-3.5 px-4 cursor-pointer hover:text-zinc-200 transition-colors select-none"
              >
                <div className="flex items-center gap-1.5">
                  <span>Status</span>
                  {renderSortIcon("status")}
                </div>
              </th>
              <th className="py-3.5 px-4 text-right">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-800/60">
            {loading ? (
              // Skeleton loading rows
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`skel-${i}`} className="animate-pulse">
                  <td className="py-4 px-4"><div className="h-4 w-12 bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-zinc-800" />
                      <div className="space-y-1.5">
                        <div className="h-3.5 w-28 bg-zinc-800 rounded" />
                        <div className="h-2.5 w-36 bg-zinc-800/60 rounded" />
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-4"><div className="h-4 w-20 bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-4"><div className="h-4 w-16 bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-4"><div className="h-4 w-20 bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-4"><div className="h-4 w-16 bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-4"><div className="h-4 w-16 bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-4"><div className="h-4 w-14 bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-3"><div className="h-4 w-12 bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-3"><div className="h-4 w-12 bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-3 text-center"><div className="h-4 w-14 mx-auto bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-3 text-center"><div className="h-4 w-14 mx-auto bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-4"><div className="h-5 w-18 bg-zinc-800 rounded-full" /></td>
                  <td className="py-4 px-4 text-right"><div className="h-7 w-20 ml-auto bg-zinc-800 rounded" /></td>
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={14} className="py-12 px-4 text-center">
                  <div className="flex flex-col items-center justify-center max-w-md mx-auto text-zinc-400 space-y-3">
                    <div className="p-3 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400">
                      <AlertTriangle className="w-8 h-8" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-base font-bold text-zinc-200">Unable to Load Attendance Records</p>
                      <p className="text-xs text-rose-400/90 font-mono">
                        {typeof error === "string" ? error : (error.message || "Failed to fetch attendance records from server.")}
                      </p>
                    </div>
                    {onRetry && (
                      <button
                        type="button"
                        onClick={onRetry}
                        className="px-4 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white transition-all shadow-md shadow-purple-950/40 cursor-pointer"
                      >
                        Retry Request
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : paginatedRecords.length === 0 ? (
              <tr>
                <td colSpan={14} className="py-12 px-4 text-center">
                  <div className="flex flex-col items-center justify-center max-w-sm mx-auto text-zinc-400">
                    <Clock className="w-10 h-10 text-zinc-600 mb-3" />
                    <p className="text-base font-semibold text-zinc-300">No attendance records match the selected criteria.</p>
                    <p className="text-xs text-zinc-500 mt-1">
                      Try adjusting the date range, status, or search filters above.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedRecords.map((rec) => {
                const empName = rec.employeeName || rec.name || rec.user_name || "Unknown Employee";
                const empId = rec.empId || rec.employeeId || rec.employee_id || rec.userId?.slice(-6) || "EMP";
                const dept = rec.department || "General";
                const shiftName = rec.shift_name || rec.shift || "General Shift";
                const shiftWindow = (rec.shift_start && rec.shift_end)
                  ? `${rec.shift_start} - ${rec.shift_end}`
                  : (rec.shiftStart && rec.shiftEnd ? `${rec.shiftStart} - ${rec.shiftEnd}` : "");
                const dateStr = rec.date_formatted || rec.date || "N/A";
                const checkIn = rec.check_in_formatted || rec.checkIn || rec.check_in_time || rec.check_in || "--";
                const checkOut = rec.check_out_formatted || rec.checkOut || rec.check_out_time || rec.check_out || "--";
                const workHours = rec.working_hours_formatted || rec.workingHours || (rec.working_hours ? `${rec.working_hours}h` : "--");
                const lateBy = rec.late_by_formatted || rec.lateByText || (rec.late_minutes > 0 ? `${rec.late_minutes}m` : (rec.lateByMinutes > 0 ? `${rec.lateByMinutes}m` : "--"));
                const earlyDep = rec.early_departure_formatted || rec.earlyDepartureText || (rec.early_departure_minutes > 0 ? `${rec.early_departure_minutes}m` : (rec.earlyDepartureMinutes > 0 ? `${rec.earlyDepartureMinutes}m` : "--"));
                const status = rec.attendance_status || rec.attendanceStatus || rec.status || "Present";
                const gpsStatus = rec.gps_verification_status || rec.gpsVerification || rec.gpsStatus || "Not Available";
                const faceStatus = rec.face_verification_status || rec.faceVerification || rec.faceStatus || "Not Available";
                const isLocked = Boolean(rec.locked || rec.attendance_locked || rec.isAdminLocked || rec.is_admin_locked);

                return (
                  <tr
                    key={rec.recordId || `${rec.userId}_${rec.date}`}
                    className="hover:bg-zinc-800/30 transition-colors group"
                  >
                    {/* Emp ID */}
                    <td className="py-3.5 px-4 font-mono text-[11px] text-zinc-400 font-medium">
                      #{empId}
                    </td>

                    {/* Employee Profile */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold uppercase shadow-sm">
                          {empName.charAt(0)}
                        </div>
                        <div className="truncate max-w-[150px] sm:max-w-[200px]">
                          <div className="font-semibold text-zinc-200 group-hover:text-purple-300 transition-colors truncate">
                            {empName}
                          </div>
                          <div className="text-[11px] text-zinc-500 truncate">
                            {rec.email || ""}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Department */}
                    <td className="py-3.5 px-4 text-zinc-300 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded bg-zinc-800/80 text-zinc-300 text-[11px]">
                        {dept}
                      </span>
                    </td>

                    {/* Shift */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="text-zinc-300 font-medium">{shiftName}</div>
                      {shiftWindow && (
                        <div className="text-[10px] text-zinc-500 font-mono">{shiftWindow}</div>
                      )}
                    </td>

                    {/* Date */}
                    <td className="py-3.5 px-4 text-zinc-300 font-mono text-[11px] whitespace-nowrap">
                      {dateStr}
                    </td>

                    {/* Check In */}
                    <td className="py-3.5 px-4 whitespace-nowrap font-mono text-zinc-300">
                      {checkIn !== "--" ? (
                        <span className="text-emerald-400 font-medium">{checkIn}</span>
                      ) : (
                        <span className="text-zinc-500">--</span>
                      )}
                    </td>

                    {/* Check Out */}
                    <td className="py-3.5 px-4 whitespace-nowrap font-mono text-zinc-300">
                      {checkOut !== "--" ? (
                        <span className="text-indigo-400 font-medium">{checkOut}</span>
                      ) : (
                        <span className="text-zinc-500">--</span>
                      )}
                    </td>

                    {/* Working Hours */}
                    <td className="py-3.5 px-4 whitespace-nowrap font-mono font-medium text-zinc-200">
                      {workHours}
                    </td>

                    {/* Late By */}
                    <td className="py-3.5 px-3 whitespace-nowrap font-mono text-[11px]">
                      {lateBy !== "--" ? (
                        <span className="text-amber-400 font-medium">{lateBy}</span>
                      ) : (
                        <span className="text-zinc-600">0m</span>
                      )}
                    </td>

                    {/* Early Departure */}
                    <td className="py-3.5 px-3 whitespace-nowrap font-mono text-[11px]">
                      {earlyDep !== "--" ? (
                        <span className="text-rose-400 font-medium">{earlyDep}</span>
                      ) : (
                        <span className="text-zinc-600">0m</span>
                      )}
                    </td>

                    {/* GPS Verification */}
                    <td className="py-3.5 px-3 text-center whitespace-nowrap">
                      {getGpsBadge(gpsStatus)}
                    </td>

                    {/* Face Verification */}
                    <td className="py-3.5 px-3 text-center whitespace-nowrap">
                      {getFaceBadge(faceStatus)}
                    </td>

                    {/* Attendance Status */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {getStatusBadge(status)}
                        {isLocked && (
                          <span title="Attendance record is locked" className="text-amber-400">
                            <Lock className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onViewEmployee && onViewEmployee(rec.userId, rec)}
                          title="View Attendance Details"
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-purple-300 hover:bg-purple-500/10 transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onReviewRecord && onReviewRecord(rec)}
                          title="Review & Adjust Attendance"
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRegularizeRecord && onRegularizeRecord(rec)}
                          title="Regularization Shortcut"
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors"
                        >
                          <Clock className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      {!error && (
        <div className="px-5 py-3.5 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 bg-zinc-900/40 text-xs text-zinc-400">
          <div>
            Showing{" "}
            <span className="font-semibold text-zinc-200">
              {sortedRecords.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
            </span>{" "}
            to{" "}
            <span className="font-semibold text-zinc-200">
              {Math.min(currentPage * pageSize, sortedRecords.length)}
            </span>{" "}
            of <span className="font-semibold text-zinc-200">{sortedRecords.length}</span> records
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span className="px-3 py-1 text-zinc-300 font-medium">
              Page {currentPage} of {totalPages}
            </span>

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
