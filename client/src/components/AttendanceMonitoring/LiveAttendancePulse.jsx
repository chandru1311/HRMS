import React, { useState } from "react";
import {
  Activity,
  UserCheck,
  UserX,
  LogOut,
  AlertTriangle,
  ShieldAlert,
  Clock,
  Eye,
  RefreshCw,
  Search,
  MapPin,
  Calendar
} from "lucide-react";

export default function LiveAttendancePulse({
  liveData = null,
  loading = false,
  onRefresh,
  onViewEmployee,
  onReviewRecord
}) {
  const [activeBucket, setActiveBucket] = useState("working");
  const [searchQuery, setSearchQuery] = useState("");

  const buckets = [
    {
      id: "working",
      label: "Currently Working",
      icon: Activity,
      count: liveData?.working?.length || 0,
      badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
      indicatorColor: "bg-emerald-400",
      description: "Active employees on the clock right now"
    },
    {
      id: "not_checked_in",
      label: "Not Checked In",
      icon: UserX,
      count: liveData?.notCheckedIn?.length || 0,
      badgeColor: "bg-rose-500/10 text-rose-400 border-rose-500/30",
      indicatorColor: "bg-rose-400",
      description: "Scheduled employees without check-in"
    },
    {
      id: "checked_out",
      label: "Checked Out",
      icon: LogOut,
      count: liveData?.checkedOut?.length || 0,
      badgeColor: "bg-blue-500/10 text-blue-400 border-blue-500/30",
      indicatorColor: "bg-blue-400",
      description: "Completed attendance for today"
    },
    {
      id: "late_today",
      label: "Late Today",
      icon: AlertTriangle,
      count: liveData?.lateToday?.length || 0,
      badgeColor: "bg-amber-500/10 text-amber-400 border-amber-500/30",
      indicatorColor: "bg-amber-400",
      description: "Arrived after shift grace period"
    },
    {
      id: "pending_review",
      label: "Pending Verification",
      icon: ShieldAlert,
      count: liveData?.pendingVerification?.length || 0,
      badgeColor: "bg-purple-500/10 text-purple-400 border-purple-500/30",
      indicatorColor: "bg-purple-400",
      description: "Flagged GPS or Face verification attempts"
    }
  ];

  // Pick list based on active bucket
  const getListForBucket = () => {
    if (!liveData) return [];
    switch (activeBucket) {
      case "working":
        return liveData.working || [];
      case "not_checked_in":
        return liveData.notCheckedIn || [];
      case "checked_out":
        return liveData.checkedOut || [];
      case "late_today":
        return liveData.lateToday || [];
      case "pending_review":
        return liveData.pendingVerification || [];
      default:
        return [];
    }
  };

  const rawList = getListForBucket();
  const filteredList = rawList.filter((item) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = (item.employeeName || item.name || "").toLowerCase();
    const email = (item.email || "").toLowerCase();
    const dept = (item.department || "").toLowerCase();
    const empId = (item.empId || item.employeeId || "").toLowerCase();
    return name.includes(q) || email.includes(q) || dept.includes(q) || empId.includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Live Header & Pulse Banner */}
      <div className="bg-gradient-to-r from-purple-900/30 via-indigo-900/20 to-zinc-900/40 border border-purple-500/20 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500"></span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              Live Attendance Pulse
              <span className="text-xs font-normal text-purple-300 bg-purple-500/20 px-2.5 py-0.5 rounded-full border border-purple-500/30">
                Today ({liveData?.date || new Date().toISOString().split("T")[0]})
              </span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Real-time snapshot of on-duty workforce, checked out employees, and verification events.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block text-xs">
            <div className="text-zinc-400">Last Synced</div>
            <div className="text-zinc-200 font-mono text-[11px]">
              {liveData?.timestamp ? new Date(liveData.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString()}
            </div>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium shadow-md shadow-purple-900/30 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh Pulse
          </button>
        </div>
      </div>

      {/* Bucket Selector Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {buckets.map((b) => {
          const Icon = b.icon;
          const isSelected = activeBucket === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => setActiveBucket(b.id)}
              className={`p-3.5 rounded-xl border text-left transition-all relative ${
                isSelected
                  ? "bg-zinc-800/90 border-purple-500/50 shadow-lg shadow-purple-950/40"
                  : "bg-[#12131A] border-zinc-800/70 hover:border-zinc-700/80 hover:bg-zinc-800/40"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`p-2 rounded-lg ${isSelected ? "bg-purple-500/20 text-purple-300" : "bg-zinc-800 text-zinc-400"}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <span className={`text-lg font-bold font-mono px-2 py-0.5 rounded-full border text-xs ${b.badgeColor}`}>
                  {b.count}
                </span>
              </div>
              <div className="text-xs font-semibold text-zinc-200 truncate">{b.label}</div>
              <div className="text-[10px] text-zinc-500 truncate mt-0.5">{b.description}</div>
              {isSelected && (
                <div className="absolute bottom-0 left-3 right-3 h-0.5 bg-purple-500 rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Filter and Content Area */}
      <div className="bg-[#12131A] border border-zinc-800/80 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-200">
              {buckets.find((b) => b.id === activeBucket)?.label}
            </span>
            <span className="text-xs text-zinc-500">
              ({filteredList.length} of {rawList.length})
            </span>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search in this list..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700/60 rounded-xl pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
            />
          </div>
        </div>

        {/* Employee Cards Grid */}
        {filteredList.length === 0 ? (
          <div className="py-12 text-center text-zinc-500 text-xs">
            No employees found in this bucket.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredList.map((emp) => {
              const name = emp.employeeName || emp.name || "Employee";
              const id = emp.empId || emp.employeeId || emp.userId?.slice(-6) || "EMP";
              const dept = emp.department || "General";
              const checkIn = emp.check_in_formatted || emp.checkIn || emp.check_in_time || "--";
              const checkOut = emp.check_out_formatted || emp.checkOut || emp.check_out_time || "--";
              const hours = emp.working_hours_formatted || (emp.working_hours ? `${emp.working_hours}h` : null);

              return (
                <div
                  key={emp.userId || emp.id}
                  className="bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700/80 rounded-xl p-3.5 flex flex-col justify-between transition-all group"
                >
                  <div className="flex items-start justify-between gap-3 mb-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold uppercase shadow-sm">
                        {name.charAt(0)}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-zinc-200 group-hover:text-purple-300 transition-colors">
                          {name}
                        </div>
                        <div className="text-[10px] text-zinc-500 flex items-center gap-1.5">
                          <span>#{id}</span>
                          <span>•</span>
                          <span>{dept}</span>
                        </div>
                      </div>
                    </div>

                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-700/50">
                      {emp.shift_name || "General Shift"}
                    </span>
                  </div>

                  {/* Timing & Metric pill */}
                  <div className="grid grid-cols-2 gap-2 my-2 bg-zinc-950/40 p-2 rounded-lg border border-zinc-800/60 text-[11px]">
                    <div>
                      <div className="text-[10px] text-zinc-500">Check In</div>
                      <div className="font-mono text-emerald-400 font-medium">
                        {checkIn}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-500">Check Out</div>
                      <div className="font-mono text-zinc-300">
                        {checkOut}
                      </div>
                    </div>
                    {hours && (
                      <div className="col-span-2 pt-1 border-t border-zinc-800/60 flex items-center justify-between">
                        <span className="text-[10px] text-zinc-500">Current Work Duration:</span>
                        <span className="font-mono font-medium text-purple-300">{hours}</span>
                      </div>
                    )}
                    {emp.late_minutes > 0 && (
                      <div className="col-span-2 text-amber-400 text-[10px] flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Late by {emp.late_minutes} minutes
                      </div>
                    )}
                    {emp.verification_flag && (
                      <div className="col-span-2 text-purple-400 text-[10px] flex items-center gap-1">
                        <ShieldAlert className="w-3 h-3" />
                        {emp.verification_flag}
                      </div>
                    )}
                  </div>

                  {/* Quick Card Actions */}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800/60">
                    <button
                      type="button"
                      onClick={() => onViewEmployee && onViewEmployee(emp.userId, emp)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-zinc-800 hover:bg-purple-600/20 text-zinc-300 hover:text-purple-300 transition-colors flex items-center gap-1"
                    >
                      <Eye className="w-3 h-3" />
                      View Profile
                    </button>
                    {onReviewRecord && (
                      <button
                        type="button"
                        onClick={() => onReviewRecord(emp)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-zinc-800 hover:bg-amber-600/20 text-zinc-300 hover:text-amber-300 transition-colors flex items-center gap-1"
                      >
                        Review
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
