import React, { useState } from "react";
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MessageSquare,
  Search,
  Filter,
  Calendar,
  User
} from "lucide-react";

export default function RegularizationQueuePanel({
  requests = [],
  loading = false,
  onApprove,
  onReject
}) {
  const [filterStatus, setFilterStatus] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [actionModal, setActionModal] = useState({ open: false, type: null, item: null, note: "" });
  const [submitting, setSubmitting] = useState(false);

  // Filtered requests
  const filtered = requests.filter((r) => {
    const s = (r.status || "pending").toLowerCase();
    if (filterStatus !== "all" && s !== filterStatus.toLowerCase()) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const name = (r.user_name || r.userName || r.employee_name || "").toLowerCase();
      const reason = (r.reason || "").toLowerCase();
      const dept = (r.department || "").toLowerCase();
      if (!name.includes(q) && !reason.includes(q) && !dept.includes(q)) return false;
    }
    return true;
  });

  const handleOpenAction = (item, type) => {
    setActionModal({ open: true, type, item, note: "" });
  };

  const handleConfirmAction = async () => {
    if (!actionModal.item) return;
    setSubmitting(true);
    try {
      if (actionModal.type === "approve") {
        await onApprove(actionModal.item.id || actionModal.item.reg_id, actionModal.note);
      } else {
        await onReject(actionModal.item.id || actionModal.item.reg_id, actionModal.note);
      }
      setActionModal({ open: false, type: null, item: null, note: "" });
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-[#12131A] border border-zinc-800/80 rounded-2xl overflow-hidden shadow-xl">
      {/* Header & Controls */}
      <div className="p-5 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-4 bg-zinc-900/40">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-purple-400" />
            Attendance Regularization Requests
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Review and take action on employee time corrections and attendance override requests.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-700/60 p-1 rounded-xl text-xs">
            {["all", "pending", "approved", "rejected"].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setFilterStatus(st)}
                className={`px-3 py-1 rounded-lg capitalize transition-colors font-medium ${
                  filterStatus === st
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search employee / reason..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-zinc-900 border border-zinc-700/60 rounded-xl pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500 w-48 sm:w-60"
            />
          </div>
        </div>
      </div>

      {/* Requests Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400 bg-zinc-900/60 font-semibold uppercase tracking-wider text-[11px]">
              <th className="py-3.5 px-4">Employee</th>
              <th className="py-3.5 px-4">Date</th>
              <th className="py-3.5 px-4">Requested Timing</th>
              <th className="py-3.5 px-4">Reason</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4">Admin Remarks</th>
              <th className="py-3.5 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`reg-skel-${i}`} className="animate-pulse">
                  <td className="py-4 px-4"><div className="h-4 w-32 bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-4"><div className="h-4 w-20 bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-4"><div className="h-4 w-28 bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-4"><div className="h-4 w-40 bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-4"><div className="h-5 w-16 bg-zinc-800 rounded-full" /></td>
                  <td className="py-4 px-4"><div className="h-4 w-24 bg-zinc-800 rounded" /></td>
                  <td className="py-4 px-4 text-right"><div className="h-7 w-24 ml-auto bg-zinc-800 rounded" /></td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 px-4 text-center">
                  <div className="flex flex-col items-center justify-center max-w-sm mx-auto text-zinc-400">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500/40 mb-3" />
                    <p className="text-base font-semibold text-zinc-300">No regularization requests</p>
                    <p className="text-xs text-zinc-500 mt-1">
                      {filterStatus === "pending"
                        ? "Great! All regularization requests have been reviewed."
                        : "No requests found matching your current filter criteria."}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((item) => {
                const empName = item.user_name || item.userName || item.employee_name || "Employee";
                const dept = item.department || "General";
                const reqDate = item.attendance_date || item.date || item.created_at?.split("T")[0] || "N/A";
                const reqCheckIn = item.requested_check_in || item.requestedCheckIn || "--";
                const reqCheckOut = item.requested_check_out || item.requestedCheckOut || "--";
                const st = (item.status || "pending").toLowerCase();
                const isPending = st === "pending";

                return (
                  <tr key={item.id || item.reg_id} className="hover:bg-zinc-800/30 transition-colors">
                    {/* Employee */}
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-zinc-200">{empName}</div>
                      <div className="text-[11px] text-zinc-500">{dept}</div>
                    </td>

                    {/* Date */}
                    <td className="py-3.5 px-4 font-mono text-zinc-300 whitespace-nowrap">
                      {reqDate}
                    </td>

                    {/* Requested Timing */}
                    <td className="py-3.5 px-4 whitespace-nowrap font-mono text-[11px]">
                      <div className="text-emerald-400">In: {reqCheckIn}</div>
                      <div className="text-indigo-400">Out: {reqCheckOut}</div>
                    </td>

                    {/* Reason */}
                    <td className="py-3.5 px-4 max-w-xs">
                      <div className="text-zinc-300 text-xs truncate" title={item.reason}>
                        {item.reason || "No reason specified"}
                      </div>
                      {item.correction_type && (
                        <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                          {item.correction_type}
                        </span>
                      )}
                    </td>

                    {/* Status Badge */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {st === "approved" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          Approved
                        </span>
                      ) : st === "rejected" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          <XCircle className="w-3 h-3 text-rose-400" />
                          Rejected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          <Clock className="w-3 h-3 text-amber-400" />
                          Pending Review
                        </span>
                      )}
                    </td>

                    {/* Admin remarks */}
                    <td className="py-3.5 px-4 text-zinc-400 text-[11px] max-w-xs truncate" title={item.admin_remarks || item.manager_remarks || ""}>
                      {item.admin_remarks || item.manager_remarks || <span className="text-zinc-600">--</span>}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {isPending ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenAction(item, "approve")}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white border border-emerald-500/30 transition-all"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenAction(item, "reject")}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white border border-rose-500/30 transition-all"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-zinc-500">Processed</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Confirmation Modal */}
      {actionModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#181924] border border-zinc-700/80 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <h4 className="text-base font-bold text-white flex items-center gap-2">
              {actionModal.type === "approve" ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  Approve Regularization Request
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-rose-400" />
                  Reject Regularization Request
                </>
              )}
            </h4>

            <p className="text-xs text-zinc-400">
              {actionModal.type === "approve"
                ? "This will update the employee's attendance record with the requested check-in / check-out times and audit log the change."
                : "This will decline the employee's request and notify them with your remark."}
            </p>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Manager / Admin Remarks {actionModal.type === "reject" ? "(Required)" : "(Optional)"}
              </label>
              <textarea
                rows={3}
                value={actionModal.note}
                onChange={(e) => setActionModal({ ...actionModal, note: e.target.value })}
                placeholder="Enter remarks or justification for this decision..."
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setActionModal({ open: false, type: null, item: null, note: "" })}
                className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting || (actionModal.type === "reject" && !actionModal.note.trim())}
                onClick={handleConfirmAction}
                className={`px-4 py-2 rounded-xl text-xs font-bold text-white transition-all shadow-md ${
                  actionModal.type === "approve"
                    ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950/40"
                    : "bg-rose-600 hover:bg-rose-500 shadow-rose-950/40"
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {submitting ? "Processing..." : actionModal.type === "approve" ? "Confirm Approval" : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
