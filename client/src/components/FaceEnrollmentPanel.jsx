import { useEffect, useMemo, useState } from "react";
import CameraCapture from "./CameraCapture";
import {
  authorizeFaceEnrollment,
  enrollFace,
  getFaceEnrollmentStatus
} from "../firebase";
import {
  Shield,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  Camera,
  UserCheck,
  UserX,
  Clock,
  Filter
} from "lucide-react";

export default function FaceEnrollmentPanel({ users, showToast }) {
  const [enrollmentStatuses, setEnrollmentStatuses] = useState({});
  const [selectedId, setSelectedId] = useState("");
  const [consentRecorded, setConsentRecorded] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [replacementTarget, setReplacementTarget] = useState(null);
  const [isReplacementSession, setIsReplacementSession] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const staffList = useMemo(() => Array.isArray(users) ? users : [], [users]);

  // Enrollment Statuses
  useEffect(() => {
    if (!staffList.length) return;

    let cancelled = false;
    const loadEnrollmentStatuses = async () => {
      const nextStatuses = {};

      for (const emp of staffList) {
        const userId = emp.uid || emp.id;
        if (!userId) continue;

        try {
          const status = await getFaceEnrollmentStatus(userId);
          nextStatuses[userId] = status || { enrollment_status: "pending", metadata: {} };
        } catch {
          nextStatuses[userId] = { enrollment_status: "pending", metadata: {} };
        }
      }

      if (!cancelled) {
        setEnrollmentStatuses(nextStatuses);
      }
    };

    loadEnrollmentStatuses();
    return () => {
      cancelled = true;
    };
  }, [staffList]);

  const selectedEmployee = staffList.find(u => (u.uid || u.id) === selectedId);
  const selectedStatus = selectedId ? enrollmentStatuses[selectedId] : null;
  const isAuthorized = Boolean(selectedStatus?.metadata?.selfEnrollmentAuthorized);

  const handleAuthorize = async (empId) => {
    const targetId = empId || selectedId;
    if (!targetId) return showToast("Select an employee first.", "warning");
    setBusy(true);
    try {
      await authorizeFaceEnrollment(targetId, true);
      setEnrollmentStatuses(prev => ({
        ...prev,
        [targetId]: {
          ...(prev[targetId] || {}),
          metadata: {
            ...(prev[targetId]?.metadata || {}),
            selfEnrollmentAuthorized: true,
            reenrollmentAuthorized: true,
            authorizedAt: new Date().toISOString()
          }
        }
      }));
      showToast("Self-enrollment successfully authorized for employee.", "success");
    } catch (err) {
      showToast(err.message || "Unable to authorize enrollment.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleReenrollmentAuth = async (empId, nextState = true, empName = "") => {
    const targetId = empId || selectedId;
    if (!targetId) return showToast("Select an employee first.", "warning");
    setBusy(true);
    try {
      await authorizeFaceEnrollment(targetId, nextState);
      setEnrollmentStatuses(prev => ({
        ...prev,
        [targetId]: {
          ...(prev[targetId] || {}),
          metadata: {
            ...(prev[targetId]?.metadata || {}),
            selfEnrollmentAuthorized: nextState,
            reenrollmentAuthorized: nextState,
            authorizedAt: new Date().toISOString()
          }
        }
      }));
      showToast(
        nextState
          ? `Re-enrollment by employee access enabled for ${empName || "employee"}.`
          : `Re-enrollment by employee access disabled for ${empName || "employee"}.`,
        "success"
      );
    } catch (err) {
      showToast(err.message || "Unable to update re-enrollment authorization.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleInitiateEnrollment = (emp) => {
    if (!emp) return;
    const id = emp.uid || emp.id;
    const isEnrolled = enrollmentStatuses[id]?.enrollment_status === "enrolled";
    setSelectedId(id);
    if (isEnrolled) {
      setReplacementTarget(emp);
    } else {
      setIsReplacementSession(false);
      setConsentRecorded(true);
      setShowCamera(true);
    }
  };

  const handleConfirmReplacement = () => {
    if (!replacementTarget) return;
    const id = replacementTarget.uid || replacementTarget.id;
    setSelectedId(id);
    setIsReplacementSession(true);
    setConsentRecorded(true);
    setReplacementTarget(null);
    setShowCamera(true);
  };

  const handleCaptureComplete = async (imageBase64) => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const res = await enrollFace(imageBase64, consentRecorded, selectedId);
      setShowCamera(false);
      setConsentRecorded(false);

      // Refresh employee's biometric status and enrollment timestamp
      try {
        const refreshedStatus = await getFaceEnrollmentStatus(selectedId);
        setEnrollmentStatuses(prev => ({
          ...prev,
          [selectedId]: refreshedStatus
        }));
      } catch {
        setEnrollmentStatuses(prev => ({
          ...prev,
          [selectedId]: {
            ...(prev[selectedId] || {}),
            enrollment_status: "enrolled",
            enrolled_at: res?.enrolled_at || new Date().toISOString()
          }
        }));
      }

      const empObj = staffList.find(u => (u.uid || u.id) === selectedId) || selectedEmployee;
      const empName = empObj?.name || "Employee";

      if (res?.mode === "replacement" || isReplacementSession) {
        showToast(`Face template successfully replaced and validated for ${empName}.`, "success");
      } else {
        showToast(`Biometric enrollment template saved for ${empName}. Raw image was not stored.`, "success");
      }
    } catch (err) {
      showToast(err.message || "Face enrollment failed.", "error");
    } finally {
      setIsReplacementSession(false);
      setBusy(false);
    }
  };

  // Metrics calculation
  const totalStaff = staffList.length;
  const enrolledCount = Object.values(enrollmentStatuses).filter(s => s?.enrollment_status === "enrolled").length;
  const pendingEnrollment = totalStaff - enrolledCount;
  const authorizedCount = Object.values(enrollmentStatuses).filter(s => s?.metadata?.selfEnrollmentAuthorized).length;

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    return staffList.filter(emp => {
      const matchesSearch =
        !searchQuery ||
        (emp.name && emp.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (emp.email && emp.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (emp.department && emp.department.toLowerCase().includes(searchQuery.toLowerCase()));

      const id = emp.uid || emp.id;
      const status = enrollmentStatuses[id]?.enrollment_status || "pending";
      const isAuth = Boolean(enrollmentStatuses[id]?.metadata?.selfEnrollmentAuthorized);

      if (statusFilter === "enrolled") return matchesSearch && status === "enrolled";
      if (statusFilter === "pending") return matchesSearch && status !== "enrolled";
      if (statusFilter === "authorized") return matchesSearch && isAuth;
      return matchesSearch;
    });
  }, [staffList, searchQuery, statusFilter, enrollmentStatuses]);

  const formatTimestamp = (ts) => {
    if (!ts) return "—";
    try {
      const d = new Date(ts);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return String(ts);
    }
  };

  return (
    <div className="space-y-6">
      {/* Biometric Template Replacement Confirmation Modal */}
      {replacementTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-bg-card border border-border-card rounded-[24px] max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-500 flex-shrink-0">
                <AlertTriangle size={24} />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-text-main">
                  Replace Face Reference Template
                </h3>
                <p className="text-xs text-text-mut">
                  Biometric Reference Update Confirmation
                </p>
              </div>
            </div>

            {/* Employee Quick Summary */}
            <div className="bg-bg-base/60 border border-border-card rounded-2xl p-3.5 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-text-main">{replacementTarget.name}</div>
                <div className="text-[11px] text-text-sec">{replacementTarget.email}</div>
              </div>
              <div className="text-right">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  Currently Enrolled
                </span>
                {enrollmentStatuses[replacementTarget.uid || replacementTarget.id]?.enrolled_at && (
                  <div className="text-[10px] text-text-mut mt-1">
                    Enrolled: {formatTimestamp(enrollmentStatuses[replacementTarget.uid || replacementTarget.id]?.enrolled_at)}
                  </div>
                )}
              </div>
            </div>

            {/* Confirmation Message */}
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400 space-y-2">
              <p className="font-semibold text-text-main">
                This employee already has a registered face template. Continuing will replace the existing reference template with the newly captured face.
              </p>
              <p className="text-[11px] text-text-sec">
                The newly captured selfie will be validated with ArcFace face detection, and the resulting mathematical embedding will replace the existing reference vector. Existing biometric consent, attendance logs, and audit records will remain intact.
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setReplacementTarget(null)}
                disabled={busy}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-border-card text-text-sec hover:text-text-main hover:bg-bg-hover transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReplacement}
                disabled={busy}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-brand-primary text-white hover:bg-brand-hover transition-colors flex items-center gap-2 shadow-sm"
              >
                <Camera size={14} />
                <span>Continue to Camera Capture</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Camera Capture Modal */}
      {showCamera && (
        <CameraCapture
          title={isReplacementSession ? `Replace Face Template: ${selectedEmployee?.name || "Employee"}` : `Enroll Face: ${selectedEmployee?.name || "Employee"}`}
          description={isReplacementSession ? "Position the employee centrally with good lighting. The newly validated face will replace the previous reference template." : "Position the face in good lighting. Only one face should be visible."}
          captureLabel={isReplacementSession ? "Capture & Replace Template" : "Capture Selfie"}
          onCapture={handleCaptureComplete}
          onCancel={() => {
            setShowCamera(false);
            setIsReplacementSession(false);
            setConsentRecorded(false);
          }}
          busy={busy}
        />
      )}

      {/* Main Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border-card pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-brand-primary/10 text-brand-primary">
              <Shield size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-text-main tracking-tight">
                Attendance Verification & Biometrics
              </h1>
              <p className="text-xs text-text-sec mt-0.5">
                ArcFace reference template enrollment, presentation-attack prevention, and biometric management.
              </p>
            </div>
          </div>
        </div>

        {/* Top Badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 text-[11px] font-bold">
            <ShieldAlert size={14} />
            <span>Production Safeguards Gate Active</span>
          </div>
        </div>
      </div>

      {/* BIOMETRIC ENROLLMENT & PROFILES */}
      <div className="space-y-6">
          {/* Selected Employee Quick Action (e.g. from Staff Directory) */}
          {selectedEmployee && (
            <div className="bg-brand-primary/10 border border-brand-primary/30 rounded-[18px] p-4 flex items-center justify-between flex-wrap gap-3 animate-fade-in">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center font-bold text-sm">
                  {selectedEmployee.name ? selectedEmployee.name.charAt(0).toUpperCase() : "U"}
                </div>
                <div>
                  <div className="text-sm font-bold text-text-main flex items-center gap-2">
                    <span>{selectedEmployee.name}</span>
                    <span className="text-[11px] font-normal text-text-mut">({selectedEmployee.department || "General"})</span>
                    {selectedStatus?.enrollment_status === "enrolled" ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-600 border border-emerald-500/30">
                        Enrolled
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-600 border border-amber-500/30">
                        Pending Enrollment
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-text-sec">{selectedEmployee.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selectedStatus?.enrollment_status === "enrolled" && (
                  <button
                    type="button"
                    onClick={() => handleToggleReenrollmentAuth(selectedId, !Boolean(selectedStatus?.metadata?.reenrollmentAuthorized), selectedEmployee.name)}
                    disabled={busy}
                    className={`px-3 py-2 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 border cursor-pointer disabled:opacity-50 ${
                      selectedStatus?.metadata?.reenrollmentAuthorized
                        ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20"
                        : "border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10"
                    }`}
                    title={
                      (selectedStatus?.metadata?.reenrollmentAuthorized || selectedStatus?.hasApprovedReenrollment)
                        ? "Employee has access to re-enroll in their portal. Click to revoke."
                        : "Click to grant this employee access to re-enroll their face template."
                    }
                  >
                    {(selectedStatus?.metadata?.reenrollmentAuthorized || selectedStatus?.hasApprovedReenrollment) ? <CheckCircle2 size={13} /> : <UserCheck size={13} />}
                    <span>{(selectedStatus?.metadata?.reenrollmentAuthorized || selectedStatus?.hasApprovedReenrollment) ? "Re-Enroll Access Enabled" : "Re-Enroll by Employee Access"}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleInitiateEnrollment(selectedEmployee)}
                  disabled={busy}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-brand-primary text-white hover:bg-brand-hover transition-colors flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
                >
                  <Camera size={14} />
                  <span>{selectedStatus?.enrollment_status === "enrolled" ? "Re-Enroll Face" : "Enroll Face"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedId("")}
                  className="px-3 py-2 text-xs font-semibold rounded-xl text-text-mut hover:text-text-main hover:bg-bg-card transition-colors cursor-pointer"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-bg-card border border-border-card rounded-[18px] p-4 shadow-sm">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-mut block">Total Staff</span>
              <span className="text-2xl font-black text-text-main block mt-1">{totalStaff}</span>
              <span className="text-[11px] text-text-mut mt-0.5 block">Eligible active employees</span>
            </div>
            <div className="bg-bg-card border border-border-card rounded-[18px] p-4 shadow-sm">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 block">Enrolled</span>
              <span className="text-2xl font-black text-emerald-600 block mt-1">{enrolledCount}</span>
              <span className="text-[11px] text-text-mut mt-0.5 block">ArcFace templates active</span>
            </div>
            <div className="bg-bg-card border border-border-card rounded-[18px] p-4 shadow-sm">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 block">Pending Enrollment</span>
              <span className="text-2xl font-black text-amber-600 block mt-1">{pendingEnrollment}</span>
              <span className="text-[11px] text-text-mut mt-0.5 block">Awaiting face capture</span>
            </div>
            <div className="bg-bg-card border border-border-card rounded-[18px] p-4 shadow-sm">
              <span className="text-[10px] font-bold uppercase tracking-wider text-brand-primary block">Self-Enroll Authorized</span>
              <span className="text-2xl font-black text-brand-primary block mt-1">{authorizedCount}</span>
              <span className="text-[11px] text-text-mut mt-0.5 block">Authorized for portal capture</span>
            </div>
          </div>

          {/* Controls & Search */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-mut" />
              <input
                type="text"
                placeholder="Search employee by name, email, department..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs bg-bg-card border border-border-card rounded-xl text-text-main placeholder-text-mut focus:outline-none focus:ring-1 focus:ring-brand-primary"
              />
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-bg-card border border-border-card rounded-xl p-1 text-xs">
                <button
                  onClick={() => setStatusFilter("all")}
                  className={`px-3 py-1 rounded-lg font-bold transition-all ${
                    statusFilter === "all" ? "bg-brand-primary text-white" : "text-text-sec hover:text-text-main"
                  }`}
                >
                  All ({staffList.length})
                </button>
                <button
                  onClick={() => setStatusFilter("enrolled")}
                  className={`px-3 py-1 rounded-lg font-bold transition-all ${
                    statusFilter === "enrolled" ? "bg-emerald-600 text-white" : "text-text-sec hover:text-text-main"
                  }`}
                >
                  Enrolled ({enrolledCount})
                </button>
                <button
                  onClick={() => setStatusFilter("pending")}
                  className={`px-3 py-1 rounded-lg font-bold transition-all ${
                    statusFilter === "pending" ? "bg-amber-600 text-white" : "text-text-sec hover:text-text-main"
                  }`}
                >
                  Pending ({pendingEnrollment})
                </button>
                <button
                  onClick={() => setStatusFilter("authorized")}
                  className={`px-3 py-1 rounded-lg font-bold transition-all ${
                    statusFilter === "authorized" ? "bg-indigo-600 text-white" : "text-text-sec hover:text-text-main"
                  }`}
                >
                  Authorized ({authorizedCount})
                </button>
              </div>
            </div>
          </div>

          {/* Employee Directory Table */}
          <div className="bg-bg-card border border-border-card rounded-[20px] overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border-card bg-bg-base/50 text-[10px] font-extrabold uppercase tracking-wider text-text-mut">
                    <th className="py-3 px-4">Employee</th>
                    <th className="py-3 px-4">Department</th>
                    <th className="py-3 px-4">Biometric Status</th>
                    <th className="py-3 px-4">Self-Enrollment</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-card text-xs">
                  {filteredEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-text-mut">
                        No employees found matching the filters.
                      </td>
                    </tr>
                  ) : (
                    filteredEmployees.map(emp => {
                      const id = emp.uid || emp.id;
                      const statusObj = enrollmentStatuses[id];
                      const isEnrolled = statusObj?.enrollment_status === "enrolled";
                      const isAuth = Boolean(statusObj?.metadata?.selfEnrollmentAuthorized || statusObj?.selfEnrollmentAuthorized);
                      const isReenrollAuth = Boolean(statusObj?.metadata?.reenrollmentAuthorized || statusObj?.hasApprovedReenrollment);
                      const isSelected = id === selectedId;

                      return (
                        <tr 
                          key={id} 
                          className={`transition-colors ${
                            isSelected 
                              ? "bg-brand-primary/10 border-l-4 border-brand-primary" 
                              : "hover:bg-bg-base/30"
                          }`}
                        >
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-text-main">{emp.name}</div>
                            <div className="text-[11px] text-text-mut">{emp.email}</div>
                          </td>
                          <td className="py-3.5 px-4 text-text-sec">
                            {emp.department || "General"}
                          </td>
                          <td className="py-3.5 px-4">
                            {isEnrolled ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                <CheckCircle2 size={13} />
                                <span>Enrolled</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                <Clock size={13} />
                                <span>Pending</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            {isEnrolled ? (
                              isReenrollAuth ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                  <CheckCircle2 size={12} />
                                  <span>Re-Enroll Allowed</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-mut">
                                  <UserX size={12} />
                                  <span>Not Authorized</span>
                                </span>
                              )
                            ) : isAuth ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 size={12} />
                                <span>Authorized</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-mut">
                                <UserX size={12} />
                                <span>Not Authorized</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="inline-flex items-center gap-2">
                              {isEnrolled ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleReenrollmentAuth(id, !isReenrollAuth, emp.name)}
                                    disabled={busy}
                                    className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1 border disabled:opacity-50 ${
                                      isReenrollAuth
                                        ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20"
                                        : "border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10"
                                    }`}
                                    title={
                                      isReenrollAuth
                                        ? "Employee has access to re-enroll in their portal. Click to revoke."
                                        : "Click to grant this employee access to re-enroll their face template."
                                    }
                                  >
                                    {isReenrollAuth ? <CheckCircle2 size={12} /> : <UserCheck size={12} />}
                                    <span>{isReenrollAuth ? "Re-Enroll Access Enabled" : "Re-Enroll by Employee Access"}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleInitiateEnrollment(emp)}
                                    disabled={busy}
                                    className="px-3 py-1 text-[11px] font-bold rounded-lg bg-brand-primary text-white hover:bg-brand-hover transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                                  >
                                    <Camera size={13} />
                                    <span>Re-Enroll Face</span>
                                  </button>
                                </>
                              ) : (
                                <>
                                  {!isAuth && (
                                    <button
                                      type="button"
                                      onClick={() => handleAuthorize(id)}
                                      disabled={busy}
                                      className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-brand-primary text-brand-primary hover:bg-brand-primary/10 transition-colors disabled:opacity-50"
                                    >
                                      Authorize Self-Enroll
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleInitiateEnrollment(emp)}
                                    disabled={busy}
                                    className="px-3 py-1 text-[11px] font-bold rounded-lg bg-brand-primary text-white hover:bg-brand-hover transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                                  >
                                    <Camera size={13} />
                                    <span>Enroll Face</span>
                                  </button>
                                </>
                              )}
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
      </div>
  );
}
