import React, { useState, useEffect } from "react";
import {
  X,
  Edit3,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Clock,
  User
} from "lucide-react";
import { reviewAttendanceRecordApi } from "../../firebase";

export default function ReviewAttendanceModal({
  record = null,
  isOpen = false,
  onClose,
  onSuccess,
  showToast
}) {
  const [status, setStatus] = useState("Present");
  const [adminNotes, setAdminNotes] = useState("");
  const [unlock, setUnlock] = useState(false);
  const [checkInTime, setCheckInTime] = useState("");
  const [checkOutTime, setCheckOutTime] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (record) {
      setStatus(record.attendance_status || record.status || "Present");
      setAdminNotes(record.admin_remarks || record.adminNotes || "");
      setUnlock(false);
      setCheckInTime(record.check_in_time || record.checkIn || "");
      setCheckOutTime(record.check_out_time || record.checkOut || "");
    }
  }, [record]);

  if (!isOpen || !record) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!adminNotes.trim()) {
      showToast && showToast("Please provide an administrative note or justification.", "warning");
      return;
    }

    setSubmitting(true);
    try {
      const recordId = record.recordId || record.id || `sim_${record.userId}_${record.date}`;
      const payload = {
        targetUserId: record.userId,
        targetDate: record.date,
        status,
        adminNotes: adminNotes.trim(),
        unlock,
        checkInTime: checkInTime || null,
        checkOutTime: checkOutTime || null
      };

      const res = await reviewAttendanceRecordApi(recordId, payload);
      if (res && res.success) {
        showToast && showToast("Attendance record reviewed and updated successfully.", "success");
        onSuccess && onSuccess();
        onClose();
      } else {
        throw new Error(res?.message || "Failed to update record");
      }
    } catch (err) {
      console.error(err);
      showToast && showToast(err.message || "Failed to update attendance record.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const empName = record.employeeName || record.name || "Employee";
  const isLocked = Boolean(record.locked || record.attendance_locked);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#151621] border border-zinc-700/80 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Review Attendance Record</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                {empName} • <span className="font-mono text-zinc-300">{record.date}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {/* Record Summary Box */}
          <div className="bg-zinc-900/80 border border-zinc-800 p-3.5 rounded-xl grid grid-cols-2 gap-3 text-zinc-300">
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Department</div>
              <div className="font-medium text-zinc-200">{record.department || "General"}</div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Shift</div>
              <div className="font-medium text-zinc-200">{record.shift_name || "General Shift"}</div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Current Check-In</div>
              <div className="font-mono text-emerald-400">{record.check_in_formatted || record.checkIn || "--"}</div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Current Check-Out</div>
              <div className="font-mono text-indigo-400">{record.check_out_formatted || record.checkOut || "--"}</div>
            </div>
          </div>

          {/* Status Adjustment */}
          <div>
            <label className="block text-zinc-300 font-semibold mb-1.5">
              Attendance Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl px-3.5 py-2.5 text-zinc-200 focus:outline-none focus:border-purple-500 text-xs font-medium"
            >
              <option value="Present">Present</option>
              <option value="Late">Late</option>
              <option value="Half Day">Half Day</option>
              <option value="Absent">Absent</option>
              <option value="On Leave">On Leave</option>
              <option value="Holiday">Holiday</option>
              <option value="Weekly Off">Weekly Off</option>
            </select>
          </div>

          {/* Optional Time Correction */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">
                Check-In Time (HH:MM:SS)
              </label>
              <input
                type="text"
                placeholder="e.g. 09:15:00"
                value={checkInTime}
                onChange={(e) => setCheckInTime(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl px-3 py-2 text-zinc-200 font-mono text-xs focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-zinc-400 text-[11px] mb-1">
                Check-Out Time (HH:MM:SS)
              </label>
              <input
                type="text"
                placeholder="e.g. 18:05:00"
                value={checkOutTime}
                onChange={(e) => setCheckOutTime(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl px-3 py-2 text-zinc-200 font-mono text-xs focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          {/* Unlock Attendance Toggle */}
          {isLocked && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Lock className="w-4 h-4 text-amber-400" />
                <div>
                  <div className="font-semibold text-amber-200">Record is currently locked</div>
                  <div className="text-[11px] text-amber-400/80">Unlock to allow employee further clocking or edits</div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={unlock}
                  onChange={(e) => setUnlock(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
              </label>
            </div>
          )}

          {/* Admin Remarks (Mandatory for audit tracking) */}
          <div>
            <label className="block text-zinc-300 font-semibold mb-1.5 flex items-center justify-between">
              <span>Admin Remarks / Justification</span>
              <span className="text-[10px] text-purple-400 font-normal">Audit Logged</span>
            </label>
            <textarea
              rows={3}
              required
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="State the reason for this manual review or status adjustment..."
              className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl p-3 text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold shadow-md shadow-purple-950/40 transition-all disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save Adjustments"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
