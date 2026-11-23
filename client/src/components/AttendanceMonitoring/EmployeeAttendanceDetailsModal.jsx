import React, { useState, useEffect } from "react";
import {
  X,
  User,
  Clock,
  Calendar,
  MapPin,
  ShieldCheck,
  ShieldAlert,
  UserCheck,
  AlertTriangle,
  History,
  Lock,
  Unlock,
  CheckCircle2,
  XCircle,
  FileText,
  Activity
} from "lucide-react";
import { getEmployeeAttendanceProfile } from "../../firebase";

export default function EmployeeAttendanceDetailsModal({
  userId,
  initialRecord = null,
  isOpen = false,
  onClose,
  onReviewRecord
}) {
  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("history"); // history, verifications, regularizations, audit

  useEffect(() => {
    if (isOpen && userId) {
      loadProfile();
    }
  }, [isOpen, userId]);

  const loadProfile = async () => {
    setLoading(true);
    try {
      const res = await getEmployeeAttendanceProfile(userId, 60);
      if (res) {
        setProfileData(res.data || res);
      }
    } catch (err) {
      console.error("Failed to load employee attendance profile:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const user = profileData?.employee || profileData?.user || initialRecord || {};
  const stats = profileData?.stats || {
    present: 0,
    absent: 0,
    late: 0,
    totalWorkingHours: 0,
    totalRecords: 0
  };
  const historyList = profileData?.attendanceHistory || [];
  const verifications = profileData?.verificationAttempts || [];
  const regularizations = profileData?.regularizations || [];
  const auditLogs = profileData?.auditTrail || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#12131A] border border-zinc-700/80 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white text-base font-bold shadow-md">
              {(user.employeeName || user.name || "U").charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">
                  {user.employeeName || user.name || "Employee Profile"}
                </h3>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700/60">
                  #{user.empId || user.employeeId || userId?.slice(-6) || "EMP"}
                </span>
              </div>
              <div className="text-xs text-zinc-400 flex items-center gap-2 mt-0.5">
                <span>{user.email || ""}</span>
                <span>•</span>
                <span className="text-purple-300 font-medium">{user.department || "General"}</span>
                <span>•</span>
                <span className="text-zinc-500">{user.shift_name || "General Shift"}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 bg-zinc-900/30 border-b border-zinc-800 text-xs">
          <div className="bg-zinc-900/60 p-2.5 rounded-xl border border-zinc-800/80">
            <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Present Days</div>
            <div className="text-lg font-bold font-mono text-emerald-400">{stats.present || 0}</div>
          </div>
          <div className="bg-zinc-900/60 p-2.5 rounded-xl border border-zinc-800/80">
            <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Late Arrivals</div>
            <div className="text-lg font-bold font-mono text-amber-400">{stats.late || 0}</div>
          </div>
          <div className="bg-zinc-900/60 p-2.5 rounded-xl border border-zinc-800/80">
            <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Absent Days</div>
            <div className="text-lg font-bold font-mono text-rose-400">{stats.absent || 0}</div>
          </div>
          <div className="bg-zinc-900/60 p-2.5 rounded-xl border border-zinc-800/80">
            <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Total Work Hours</div>
            <div className="text-lg font-bold font-mono text-purple-300">{stats.totalWorkingHours || 0}h</div>
          </div>
          <div className="bg-zinc-900/60 p-2.5 rounded-xl border border-zinc-800/80 col-span-2 sm:col-span-1">
            <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Assigned Shift</div>
            <div className="text-xs font-semibold text-zinc-200 truncate mt-1">
              {user.shift_name || "General"}
            </div>
            <div className="text-[10px] text-zinc-500 font-mono">
              {user.shift_start && user.shift_end ? `${user.shift_start} - ${user.shift_end}` : "09:00 - 18:00"}
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-zinc-800 bg-zinc-900/20 text-xs">
          {[
            { id: "history", label: "Attendance History", count: historyList.length },
            { id: "verifications", label: "Verification Attempts", count: verifications.length },
            { id: "regularizations", label: "Regularization History", count: regularizations.length },
            { id: "audit", label: "Audit Log Trail", count: auditLogs.length }
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2.5 font-medium border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === t.id
                  ? "border-purple-500 text-purple-300 bg-purple-500/10 rounded-t-lg"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span>{t.label}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-400 font-mono">
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* Modal Scroll Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <div className="py-12 text-center text-zinc-400 animate-pulse text-xs">
              Loading employee attendance history and verification telemetry...
            </div>
          ) : activeTab === "history" ? (
            // Attendance History Table
            <div className="overflow-x-auto border border-zinc-800/80 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-zinc-900/80 text-zinc-400 border-b border-zinc-800 text-[11px] uppercase">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Check-In</th>
                    <th className="py-2.5 px-3">Check-Out</th>
                    <th className="py-2.5 px-3">Work Hours</th>
                    <th className="py-2.5 px-3">Late</th>
                    <th className="py-2.5 px-3">GPS / Face</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {historyList.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-zinc-500 text-xs">
                        No historical attendance records found for this employee.
                      </td>
                    </tr>
                  ) : (
                    historyList.map((row) => (
                      <tr key={row.id || `${row.date}`} className="hover:bg-zinc-800/30 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-zinc-300">{row.date}</td>
                        <td className="py-2.5 px-3 font-mono text-emerald-400">{row.check_in_formatted || row.checkIn || "--"}</td>
                        <td className="py-2.5 px-3 font-mono text-indigo-400">{row.check_out_formatted || row.checkOut || "--"}</td>
                        <td className="py-2.5 px-3 font-mono text-zinc-200">{row.working_hours ? `${row.working_hours}h` : "--"}</td>
                        <td className="py-2.5 px-3 font-mono text-amber-400">{row.late_minutes > 0 ? `${row.late_minutes}m` : "0m"}</td>
                        <td className="py-2.5 px-3 text-[11px]">
                          <span className="text-zinc-400">{row.gps_verification_status || "N/A"}</span>
                          <span className="text-zinc-600 mx-1">/</span>
                          <span className="text-zinc-400">{row.face_verification_status || "N/A"}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700/60">
                            {row.attendance_status || row.status || "Present"}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => onReviewRecord && onReviewRecord(row)}
                            className="px-2 py-1 rounded text-[11px] bg-zinc-800 hover:bg-amber-500/20 text-zinc-300 hover:text-amber-300 transition-colors"
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : activeTab === "verifications" ? (
            // Verification Attempts
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
                        <span className="text-zinc-500 font-mono text-[11px]">{v.timestamp || v.created_at}</span>
                      </div>
                      <div className="text-zinc-400 text-[11px]">
                        GPS Geofence: <span className={v.within_fence ? "text-emerald-400" : "text-rose-400 font-medium"}>{v.within_fence ? "Within authorized radius" : "Outside fence boundary"}</span>
                        {v.distance_meters != null && ` (${v.distance_meters}m from office)`}
                      </div>
                      <div className="text-zinc-400 text-[11px]">
                        Biometric Match: <span className="text-purple-300 font-medium">{v.face_status || "Completed"}</span>
                        {v.liveness_passed != null && ` • Liveness: ${v.liveness_passed ? "Passed" : "Flagged"}`}
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                      v.verified ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                    }`}>
                      {v.verified ? "Verified" : "Flagged"}
                    </span>
                  </div>
                ))
              )}
            </div>
          ) : activeTab === "regularizations" ? (
            // Regularization History
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
                    {r.admin_remarks && (
                      <div className="text-purple-300 text-[11px]">
                        Admin Remark: <span className="text-zinc-300">{r.admin_remarks}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            // Audit Log Trail
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
                      Performed by: <span className="font-medium text-zinc-200">{log.performed_by_name || log.user_name || "Admin"}</span>
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
        <div className="px-6 py-3.5 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
          >
            Close Profile
          </button>
        </div>
      </div>
    </div>
  );
}
