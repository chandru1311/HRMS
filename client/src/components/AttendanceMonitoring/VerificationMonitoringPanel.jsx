import React, { useState } from "react";
import {
  MapPin,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  UserCheck,
  AlertTriangle,
  HelpCircle,
  Eye,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Info
} from "lucide-react";

export default function VerificationMonitoringPanel({
  records = [],
  loading = false,
  onReviewRecord,
  onViewEmployee
}) {
  const [filterType, setFilterType] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Filter records that have verification info
  const verificationList = records.filter((r) => {
    // Only records with GPS or Face info or checkin
    if (filterType === "gps_failed") {
      const g = (r.gps_verification_status || "").toLowerCase();
      if (!g.includes("fail") && !g.includes("outside") && !g.includes("insufficient")) return false;
    } else if (filterType === "face_failed") {
      const f = (r.face_verification_status || "").toLowerCase();
      if (!f.includes("fail") && !f.includes("mismatch") && !f.includes("inconclusive")) return false;
    } else if (filterType === "verified_only") {
      const g = (r.gps_verification_status || "").toLowerCase();
      const f = (r.face_verification_status || "").toLowerCase();
      if (!g.includes("verified") && !f.includes("verified")) return false;
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const name = (r.employeeName || r.name || "").toLowerCase();
      const dept = (r.department || "").toLowerCase();
      return name.includes(q) || dept.includes(q);
    }

    return true;
  });

  // Calculate stats
  const totalVerifiedGps = records.filter((r) => (r.gps_verification_status || "").toLowerCase().includes("verified")).length;
  const totalFailedGps = records.filter((r) => {
    const s = (r.gps_verification_status || "").toLowerCase();
    return s.includes("fail") || s.includes("outside") || s.includes("insufficient");
  }).length;
  const totalVerifiedFace = records.filter((r) => (r.face_verification_status || "").toLowerCase().includes("verified")).length;
  const totalFailedFace = records.filter((r) => {
    const s = (r.face_verification_status || "").toLowerCase();
    return s.includes("fail") || s.includes("mismatch");
  }).length;

  return (
    <div className="space-y-6">
      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* GPS Success */}
        <div className="bg-[#12131A] border border-emerald-500/20 rounded-2xl p-4 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-400">GPS In-Fence Passes</span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-400">{totalVerifiedGps}</div>
          <p className="text-[11px] text-zinc-500 mt-1">Verified within authorized office geofence</p>
        </div>

        {/* GPS Flags */}
        <div className="bg-[#12131A] border border-rose-500/20 rounded-2xl p-4 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-400">GPS Geofence Flags</span>
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400">
              <ShieldAlert className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono text-rose-400">{totalFailedGps}</div>
          <p className="text-[11px] text-zinc-500 mt-1">Check-in attempts outside authorized radius</p>
        </div>

        {/* Face Matches */}
        <div className="bg-[#12131A] border border-purple-500/20 rounded-2xl p-4 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-400">Biometric Passes</span>
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
              <UserCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono text-purple-400">{totalVerifiedFace}</div>
          <p className="text-[11px] text-zinc-500 mt-1">Face & liveness verification successful</p>
        </div>

        {/* Biometric Flags */}
        <div className="bg-[#12131A] border border-amber-500/20 rounded-2xl p-4 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-400">Biometric Flags</span>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono text-amber-400">{totalFailedFace}</div>
          <p className="text-[11px] text-zinc-500 mt-1">Low confidence or mismatch detections</p>
        </div>
      </div>

      {/* Verification Privacy Notice */}
      <div className="bg-purple-950/20 border border-purple-800/40 rounded-xl p-3.5 flex items-start gap-3">
        <Info className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
        <p className="text-xs text-purple-200">
          <strong className="font-semibold">Privacy & Security Guard:</strong> Raw biometric templates, facial embeddings, and coordinate vectors are strictly encrypted and evaluated at the verification gateway. Only verification outcomes, distance measurements, and compliance flags are presented in the monitoring interface.
        </p>
      </div>

      {/* Main Table */}
      <div className="bg-[#12131A] border border-zinc-800/80 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-5 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-4 bg-zinc-900/40">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <MapPin className="w-4 h-4 text-purple-400" />
              Verification Audit Stream
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Live inspection of GPS geofencing accuracy and biometric facial verification results.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-700/60 p-1 rounded-xl text-xs">
              {[
                { id: "all", label: "All Logs" },
                { id: "gps_failed", label: "GPS Failed" },
                { id: "face_failed", label: "Face Failed" },
                { id: "verified_only", label: "Verified Only" }
              ].map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setFilterType(b.id)}
                  className={`px-3 py-1 rounded-lg transition-colors font-medium ${
                    filterType === b.id
                      ? "bg-purple-600 text-white shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search employee..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-zinc-900 border border-zinc-700/60 rounded-xl pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500 w-44 sm:w-52"
              />
            </div>
          </div>
        </div>

        {/* Verification Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400 bg-zinc-900/60 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4">Employee</th>
                <th className="py-3.5 px-4">Date & Time</th>
                <th className="py-3.5 px-4">GPS Geofence Status</th>
                <th className="py-3.5 px-4">Distance / Accuracy</th>
                <th className="py-3.5 px-4">Face Verification</th>
                <th className="py-3.5 px-4">Liveness Check</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={`v-skel-${i}`} className="animate-pulse">
                    <td className="py-4 px-4"><div className="h-4 w-32 bg-zinc-800 rounded" /></td>
                    <td className="py-4 px-4"><div className="h-4 w-24 bg-zinc-800 rounded" /></td>
                    <td className="py-4 px-4"><div className="h-4 w-24 bg-zinc-800 rounded" /></td>
                    <td className="py-4 px-4"><div className="h-4 w-20 bg-zinc-800 rounded" /></td>
                    <td className="py-4 px-4"><div className="h-4 w-24 bg-zinc-800 rounded" /></td>
                    <td className="py-4 px-4"><div className="h-4 w-20 bg-zinc-800 rounded" /></td>
                    <td className="py-4 px-4 text-right"><div className="h-7 w-20 ml-auto bg-zinc-800 rounded" /></td>
                  </tr>
                ))
              ) : verificationList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 px-4 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto text-zinc-400">
                      <ShieldCheck className="w-10 h-10 text-zinc-600 mb-3" />
                      <p className="text-base font-semibold text-zinc-300">No verification events found</p>
                      <p className="text-xs text-zinc-500 mt-1">
                        Try changing the filter or search parameters.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                verificationList.map((rec) => {
                  const empName = rec.employeeName || rec.name || "Employee";
                  const dept = rec.department || "General";
                  const dateStr = rec.date || "N/A";
                  const timeStr = rec.check_in_formatted || rec.checkIn || "--";
                  const gpsStatus = rec.gps_verification_status || "Not Available";
                  const faceStatus = rec.face_verification_status || "Not Available";
                  const dist = rec.distance_from_office_meters != null ? `${rec.distance_from_office_meters}m` : "--";
                  const accuracy = rec.gps_accuracy != null ? `±${rec.gps_accuracy}m` : null;

                  return (
                    <tr key={rec.recordId || `${rec.userId}_${rec.date}`} className="hover:bg-zinc-800/30 transition-colors">
                      {/* Employee */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-zinc-200">{empName}</div>
                        <div className="text-[11px] text-zinc-500">{dept}</div>
                      </td>

                      {/* Date & Time */}
                      <td className="py-3.5 px-4 font-mono text-zinc-300 whitespace-nowrap">
                        <div>{dateStr}</div>
                        <div className="text-[11px] text-zinc-500">{timeStr}</div>
                      </td>

                      {/* GPS Geofence */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {gpsStatus.toLowerCase().includes("verified") ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Inside Geofence
                          </span>
                        ) : gpsStatus.toLowerCase().includes("fail") || gpsStatus.toLowerCase().includes("outside") ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            <ShieldAlert className="w-3.5 h-3.5" />
                            Outside Geofence
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs text-zinc-400 bg-zinc-800 border border-zinc-700/50">
                            Not Configured
                          </span>
                        )}
                      </td>

                      {/* Distance / Accuracy */}
                      <td className="py-3.5 px-4 whitespace-nowrap font-mono text-[11px]">
                        <div className="text-zinc-200 font-medium">{dist}</div>
                        {accuracy && <div className="text-zinc-500 text-[10px]">{accuracy}</div>}
                      </td>

                      {/* Face Verification */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {faceStatus.toLowerCase().includes("verified") ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <UserCheck className="w-3.5 h-3.5" />
                            Face Matched
                          </span>
                        ) : faceStatus.toLowerCase().includes("fail") ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            <XCircle className="w-3.5 h-3.5" />
                            Mismatch
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs text-zinc-400 bg-zinc-800 border border-zinc-700/50">
                            N/A
                          </span>
                        )}
                      </td>

                      {/* Liveness Check */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-[11px]">
                        {faceStatus.toLowerCase().includes("verified") ? (
                          <span className="text-emerald-400 font-medium flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Liveness Passed
                          </span>
                        ) : (
                          <span className="text-zinc-500">--</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onViewEmployee && onViewEmployee(rec.userId, rec)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-purple-300 hover:bg-purple-500/10 transition-colors"
                            title="View Employee History"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onReviewRecord && onReviewRecord(rec)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-amber-600/20 text-zinc-300 hover:text-amber-300 border border-zinc-700/60 transition-colors"
                          >
                            Review
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
      </div>
    </div>
  );
}
