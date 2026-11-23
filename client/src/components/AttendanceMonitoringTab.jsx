import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Users,
  Clock,
  Calendar,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  MapPin,
  Eye,
  Download,
  Filter,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  BarChart3,
  CalendarCheck,
  UserCheck,
  UserX,
  Briefcase,
  Play,
  Square,
  Lock,
  Unlock,
  Edit3,
  FileSpreadsheet,
  AlertTriangle,
  ExternalLink,
  Compass
} from "lucide-react";
import {
  getAttendanceMonitoringSummary,
  getAttendanceMonitoringRecords,
  getAttendanceMonitoringLive,
  getEmployeeAttendanceProfile,
  getAttendanceMonitoringAnalytics,
  reviewRegularizationRequest,
  unlockEmployeeAttendance,
  manualCorrectAttendanceRecord
} from "../firebase";

export default function AttendanceMonitoringTab({ currentUser, users = [], showToast = () => {} }) {
  // Navigation sub-tabs
  const [subTab, setSubTab] = useState("records"); // "records" | "live" | "regularization" | "analytics"

  // Date filters
  const [preset, setPreset] = useState("today"); // "today" | "yesterday" | "this_week" | "this_month" | "custom"
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().split("T")[0]);
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);

  // Attribute filters
  const [selectedDept, setSelectedDept] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Pagination & Sorting
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(15);
  const [sortBy, setSortBy] = useState("checkIn");
  const [sortOrder, setSortOrder] = useState("desc");

  // Data states
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [records, setRecords] = useState([]);
  const [recordsError, setRecordsError] = useState(null);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 15, totalPages: 1 });
  const [liveData, setLiveData] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(() => new Date().toLocaleTimeString());

  // Modal states
  const [selectedProfileUserId, setSelectedProfileUserId] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Attendance location details modal
  const [selectedLocationRecord, setSelectedLocationRecord] = useState(null);

  // Regularization review modal
  const [selectedReg, setSelectedReg] = useState(null);
  const [regRemarks, setRegRemarks] = useState("");
  const [actionSubmitting, setActionSubmitting] = useState(false);

  // Manual correction modal
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualForm, setManualForm] = useState({
    userId: "",
    date: new Date().toISOString().split("T")[0],
    checkIn: "",
    checkOut: "",
    status: "present",
    reason: ""
  });

  // Unlock modal
  const [unlockRecord, setUnlockRecord] = useState(null);
  const [unlockNotes, setUnlockNotes] = useState("");

  // Unique departments from staff list
  const departments = useMemo(() => {
    const set = new Set();
    users.forEach(u => {
      if (u.department) set.add(u.department);
    });
    return Array.from(set).sort();
  }, [users]);

  // Fetch summary
  const fetchSummary = useCallback(async () => {
    try {
      setSummaryError(null);
      const params = { preset, department: selectedDept };
      if (preset === "custom") {
        params.dateFrom = dateFrom;
        params.dateTo = dateTo;
      }
      const data = await getAttendanceMonitoringSummary(params);
      setSummary(data?.summary || data || null);
    } catch (err) {
      console.warn("fetchSummary error:", err);
      setSummaryError(err.message || "Failed to fetch attendance summary.");
    }
  }, [preset, dateFrom, dateTo, selectedDept]);

  // Fetch records
  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setRecordsError(null);
    try {
      const params = {
        preset,
        department: selectedDept,
        status: selectedStatus,
        search: searchQuery,
        page,
        limit,
        sortBy,
        sortOrder
      };
      if (preset === "custom") {
        params.dateFrom = dateFrom;
        params.dateTo = dateTo;
      }
      const res = await getAttendanceMonitoringRecords(params);
      setRecords(res.records || []);
      setPagination(res.pagination || { total: 0, page: 1, limit, totalPages: 1 });
      setLastRefreshed(new Date().toLocaleTimeString());
      setRecordsError(null);
    } catch (err) {
      console.error("fetchRecords error:", err);
      const errMsg = err?.message || "Failed to fetch attendance records.";
      setRecordsError(errMsg);
      setRecords([]);
      showToast(errMsg, "error");
    } finally {
      setLoading(false);
    }
  }, [preset, dateFrom, dateTo, selectedDept, selectedStatus, searchQuery, page, limit, sortBy, sortOrder, showToast]);

  // Fetch live
  const fetchLive = useCallback(async () => {
    try {
      const data = await getAttendanceMonitoringLive();
      setLiveData(data);
    } catch (err) {
      console.warn("fetchLive error:", err);
    }
  }, []);

  // Fetch analytics
  const fetchAnalytics = useCallback(async () => {
    try {
      const params = { preset, department: selectedDept };
      if (preset === "custom") {
        params.dateFrom = dateFrom;
        params.dateTo = dateTo;
      }
      const data = await getAttendanceMonitoringAnalytics(params);
      setAnalyticsData(data);
    } catch (err) {
      console.warn("fetchAnalytics error:", err);
    }
  }, [preset, dateFrom, dateTo, selectedDept]);

  // Master refresh
  const handleRefresh = useCallback(() => {
    fetchSummary();
    if (subTab === "records") fetchRecords();
    else if (subTab === "live") fetchLive();
    else if (subTab === "analytics") fetchAnalytics();
  }, [fetchSummary, fetchRecords, fetchLive, fetchAnalytics, subTab]);

  useEffect(() => {
    handleRefresh();
  }, [handleRefresh]);

  // Open profile drawer
  const handleOpenProfile = async (userId) => {
    setSelectedProfileUserId(userId);
    setProfileLoading(true);
    try {
      const data = await getEmployeeAttendanceProfile(userId);
      setProfileData(data);
    } catch (err) {
      console.error("handleOpenProfile error:", err);
      showToast("Failed to load employee profile.", "error");
    } finally {
      setProfileLoading(false);
    }
  };

  // Close profile drawer
  const handleCloseProfile = () => {
    setSelectedProfileUserId(null);
    setProfileData(null);
  };

  // Approve / Reject Regularization
  const handleReviewRegularization = async (decision) => {
    if (!selectedReg) return;
    setActionSubmitting(true);
    try {
      await reviewRegularizationRequest(selectedReg.id, decision, regRemarks);
      showToast(`Regularization request ${decision} successfully.`, "success");
      setSelectedReg(null);
      setRegRemarks("");
      handleRefresh();
    } catch (err) {
      console.error("reviewRegularization error:", err);
      showToast("Failed to review regularization request.", "error");
    } finally {
      setActionSubmitting(false);
    }
  };

  // Unlock Attendance
  const handleUnlockAttendance = async () => {
    if (!unlockRecord) return;
    setActionSubmitting(true);
    try {
      await unlockEmployeeAttendance(unlockRecord.attendanceId || unlockRecord.id, unlockNotes);
      showToast("Attendance unlocked successfully.", "success");
      setUnlockRecord(null);
      setUnlockNotes("");
      handleRefresh();
    } catch (err) {
      console.error("unlockAttendance error:", err);
      showToast("Failed to unlock attendance.", "error");
    } finally {
      setActionSubmitting(false);
    }
  };

  // Manual Correction Submit
  const handleManualCorrectSubmit = async (e) => {
    e.preventDefault();
    if (!manualForm.userId || !manualForm.date) {
      return showToast("Employee and date are required.", "warning");
    }
    setActionSubmitting(true);
    try {
      await manualCorrectAttendanceRecord({
        userId: manualForm.userId,
        date: manualForm.date,
        checkIn: manualForm.checkIn ? `${manualForm.date}T${manualForm.checkIn}:00` : null,
        checkOut: manualForm.checkOut ? `${manualForm.date}T${manualForm.checkOut}:00` : null,
        status: manualForm.status,
        reason: manualForm.reason
      });
      showToast("Attendance updated successfully.", "success");
      setShowManualModal(false);
      setManualForm({
        userId: "",
        date: new Date().toISOString().split("T")[0],
        checkIn: "",
        checkOut: "",
        status: "present",
        reason: ""
      });
      handleRefresh();
    } catch (err) {
      console.error("manualCorrect error:", err);
      showToast("Failed to save manual attendance correction.", "error");
    } finally {
      setActionSubmitting(false);
    }
  };

  // Export CSV
  const handleExportCsv = () => {
    const params = new URLSearchParams({
      preset,
      dateFrom,
      dateTo,
      department: selectedDept
    }).toString();
    window.open(`/api/attendance/monitoring/export?${params}`, "_blank");
  };

  // Format Helper for Status Badges
  const renderStatusBadge = (status) => {
    const s = String(status || "").toLowerCase();
    if (s.includes("locked")) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
          <Lock size={10} /> Locked
        </span>
      );
    }
    if (s.includes("leave")) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
          <Calendar size={10} /> On Leave
        </span>
      );
    }
    if (s.includes("absent")) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">
          <UserX size={10} /> Absent
        </span>
      );
    }
    if (s.includes("late")) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <AlertCircle size={10} /> {status}
        </span>
      );
    }
    if (s.includes("half day")) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
          <Clock size={10} /> Half Day
        </span>
      );
    }
    if (s.includes("working") || s.includes("present")) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <UserCheck size={10} /> {status}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-500/10 text-slate-400 border border-slate-500/20">
        {status || "Pending"}
      </span>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in text-left">
      {/* ── Top Header Bar ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-bg-card border border-border-card rounded-[24px] p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-[14px] bg-brand-primary/10 text-brand-primary flex items-center justify-center">
              <CalendarCheck size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-text-main tracking-tight">Attendance Monitoring</h1>
              <p className="text-xs text-text-sec mt-0.5 font-medium">
                Comprehensive workforce presence, shift compliance, GPS and biometric intelligence
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="text-[11px] font-mono text-text-mut bg-bg-base/60 px-3 py-1.5 rounded-[10px] border border-border-card">
            Updated: <span className="text-text-main font-bold">{lastRefreshed}</span>
          </div>
          <button
            onClick={handleRefresh}
            className="p-2 bg-bg-base/80 hover:bg-bg-base text-text-sec hover:text-text-main rounded-[12px] border border-border-card transition-all"
            title="Refresh Attendance Data"
          >
            <RefreshCw size={15} className={loading ? "animate-spin text-brand-primary" : ""} />
          </button>
          <button
            onClick={() => setShowManualModal(true)}
            className="px-3.5 py-2 bg-bg-base/80 hover:bg-bg-base text-text-main text-xs font-bold rounded-[12px] border border-border-card flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Edit3 size={14} className="text-brand-primary" />
            <span>Manual Correction</span>
          </button>
          <button
            onClick={handleExportCsv}
            className="px-3.5 py-2 bg-brand-primary/10 hover:bg-brand-primary text-brand-primary hover:text-white text-xs font-bold rounded-[12px] border border-brand-primary/20 flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <FileSpreadsheet size={14} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* ── Filter & Navigation Bar ── */}
      <div className="bg-bg-card border border-border-card rounded-[20px] p-4 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Preset Tabs */}
        <div className="flex items-center gap-1.5 bg-bg-base/60 p-1 rounded-[14px] border border-border-card overflow-x-auto">
          {[
            { id: "today", label: "Today" },
            { id: "yesterday", label: "Yesterday" },
            { id: "this_week", label: "This Week" },
            { id: "this_month", label: "This Month" },
            { id: "custom", label: "Custom Range" }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { setPreset(tab.id); setPage(1); }}
              className={`px-3 py-1.5 rounded-[10px] text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                preset === tab.id
                  ? "bg-brand-primary text-white shadow-sm"
                  : "text-text-sec hover:text-text-main hover:bg-bg-base"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Custom Date Pickers (if Custom preset selected) */}
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-bg-base text-xs font-medium text-text-main px-3 py-1.5 rounded-[10px] border border-border-card focus:outline-none focus:border-brand-primary"
            />
            <span className="text-text-mut text-xs">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-bg-base text-xs font-medium text-text-main px-3 py-1.5 rounded-[10px] border border-border-card focus:outline-none focus:border-brand-primary"
            />
          </div>
        )}

        {/* Department & Status Filters */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <select
            value={selectedDept}
            onChange={(e) => { setSelectedDept(e.target.value); setPage(1); }}
            className="bg-bg-base text-xs font-medium text-text-main px-3 py-1.5 rounded-[10px] border border-border-card focus:outline-none focus:border-brand-primary"
          >
            <option value="all">All Departments</option>
            {departments.map(dept => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => { setSelectedStatus(e.target.value); setPage(1); }}
            className="bg-bg-base text-xs font-medium text-text-main px-3 py-1.5 rounded-[10px] border border-border-card focus:outline-none focus:border-brand-primary"
          >
            <option value="all">All Statuses</option>
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="late">Late Arrival</option>
            <option value="half day">Half Day</option>
            <option value="on leave">On Leave</option>
            <option value="locked">Attendance Locked</option>
          </select>

          {/* Search Box */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-2.5 text-text-mut" />
            <input
              type="text"
              placeholder="Search staff..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="bg-bg-base text-xs font-medium text-text-main pl-8 pr-3 py-1.5 rounded-[10px] border border-border-card focus:outline-none focus:border-brand-primary w-40 sm:w-48"
            />
          </div>
        </div>
      </div>

      {/* ── Section 3: Overview Stat Cards (8 Cards) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {/* 1. Total Employees */}
        <div
          onClick={() => setSelectedStatus("all")}
          className={`bg-bg-card border rounded-[16px] p-3.5 flex flex-col justify-between shadow-sm cursor-pointer transition-all hover:scale-[1.02] ${
            selectedStatus === "all" ? "border-brand-primary/50 bg-brand-primary/5" : "border-border-card"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-text-mut uppercase tracking-wider">TOTAL STAFF</span>
            <Users size={15} className="text-brand-primary" />
          </div>
          <div className="text-2xl font-extrabold text-text-main mt-2">
            {summary?.totalEmployees ?? "--"}
          </div>
        </div>

        {/* 2. Present Employees */}
        <div
          onClick={() => setSelectedStatus("present")}
          className={`bg-bg-card border rounded-[16px] p-3.5 flex flex-col justify-between shadow-sm cursor-pointer transition-all hover:scale-[1.02] border-l-4 border-l-emerald-500 ${
            selectedStatus === "present" ? "border-emerald-500/50 bg-emerald-500/5" : "border-border-card"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-text-mut uppercase tracking-wider">PRESENT</span>
            <UserCheck size={15} className="text-emerald-500" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-400 mt-2">
            {summary?.presentEmployees ?? "--"}
          </div>
        </div>

        {/* 3. Absent Employees */}
        <div
          onClick={() => setSelectedStatus("absent")}
          className={`bg-bg-card border rounded-[16px] p-3.5 flex flex-col justify-between shadow-sm cursor-pointer transition-all hover:scale-[1.02] border-l-4 border-l-red-500 ${
            selectedStatus === "absent" ? "border-red-500/50 bg-red-500/5" : "border-border-card"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-text-mut uppercase tracking-wider">ABSENT</span>
            <UserX size={15} className="text-red-500" />
          </div>
          <div className="text-2xl font-extrabold text-red-400 mt-2">
            {summary?.absentEmployees ?? "--"}
          </div>
        </div>

        {/* 4. Late Arrivals */}
        <div
          onClick={() => setSelectedStatus("late")}
          className={`bg-bg-card border rounded-[16px] p-3.5 flex flex-col justify-between shadow-sm cursor-pointer transition-all hover:scale-[1.02] border-l-4 border-l-amber-500 ${
            selectedStatus === "late" ? "border-amber-500/50 bg-amber-500/5" : "border-border-card"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-text-mut uppercase tracking-wider">LATE</span>
            <Clock size={15} className="text-amber-500" />
          </div>
          <div className="text-2xl font-extrabold text-amber-400 mt-2">
            {summary?.lateArrivals ?? "--"}
          </div>
        </div>

        {/* 5. Currently Working */}
        <div
          onClick={() => setSubTab("live")}
          className="bg-bg-card border border-border-card rounded-[16px] p-3.5 flex flex-col justify-between shadow-sm cursor-pointer transition-all hover:scale-[1.02]"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-text-mut uppercase tracking-wider">WORKING</span>
            <Play size={13} className="text-emerald-400 animate-pulse" fill="currentColor" />
          </div>
          <div className="text-2xl font-extrabold text-text-main mt-2">
            {summary?.currentlyWorking ?? "--"}
          </div>
        </div>

        {/* 6. Checked Out */}
        <div className="bg-bg-card border border-border-card rounded-[16px] p-3.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-text-mut uppercase tracking-wider">CHECKED OUT</span>
            <Square size={13} className="text-text-sec" fill="currentColor" />
          </div>
          <div className="text-2xl font-extrabold text-text-main mt-2">
            {summary?.checkedOut ?? "--"}
          </div>
        </div>

        {/* 7. On Leave */}
        <div
          onClick={() => setSelectedStatus("on leave")}
          className={`bg-bg-card border rounded-[16px] p-3.5 flex flex-col justify-between shadow-sm cursor-pointer transition-all hover:scale-[1.02] ${
            selectedStatus === "on leave" ? "border-blue-500/50 bg-blue-500/5" : "border-border-card"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-text-mut uppercase tracking-wider">ON LEAVE</span>
            <Calendar size={15} className="text-blue-400" />
          </div>
          <div className="text-2xl font-extrabold text-blue-400 mt-2">
            {summary?.onLeave ?? "--"}
          </div>
        </div>

        {/* 8. Pending Regularizations */}
        <div
          onClick={() => setSubTab("regularization")}
          className="bg-bg-card border border-border-card rounded-[16px] p-3.5 flex flex-col justify-between shadow-sm cursor-pointer transition-all hover:scale-[1.02] border-l-4 border-l-purple-500"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-text-mut uppercase tracking-wider">REGULARIZATION</span>
            <Edit3 size={15} className="text-purple-400" />
          </div>
          <div className="text-2xl font-extrabold text-purple-400 mt-2">
            {summary?.pendingRegularizations ?? "--"}
          </div>
        </div>
      </div>

      {/* ── View Selector Navigation Tabs ── */}
      <div className="flex items-center gap-2 border-b border-border-card pb-2">
        {[
          { id: "records", label: "Attendance Table", icon: FileSpreadsheet },
          { id: "live", label: "Live Monitoring", icon: Play },
          { id: "regularization", label: "Regularization Reviews", icon: Edit3, badge: summary?.pendingRegularizations },
          { id: "analytics", label: "Analytics & Reports", icon: BarChart3 }
        ].map(t => {
          const Icon = t.icon;
          const isActive = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-[12px] text-xs font-bold transition-all cursor-pointer ${
                isActive
                  ? "bg-brand-primary text-white shadow-sm"
                  : "text-text-sec hover:text-text-main hover:bg-bg-base/70"
              }`}
            >
              <Icon size={14} />
              <span>{t.label}</span>
              {t.badge > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-red-500 text-white font-mono">
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── SubTab 1: Attendance Table (Section 4) ── */}
      {subTab === "records" && (
        <div className="bg-bg-card border border-border-card rounded-[24px] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-base/60 text-text-mut uppercase tracking-wider font-extrabold border-b border-border-card">
                <tr>
                  <th className="py-3.5 px-3">Emp ID</th>
                  <th className="py-3.5 px-3">Date</th>
                  <th className="py-3.5 px-3">Employee Name</th>
                  <th className="py-3.5 px-3">Department</th>
                  <th className="py-3.5 px-3">Shift</th>
                  <th className="py-3.5 px-3">Check-In</th>
                  <th className="py-3.5 px-3">Check-Out</th>
                  <th className="py-3.5 px-3">Working Hours</th>
                  <th className="py-3.5 px-3">Late Arrival</th>
                  <th className="py-3.5 px-3">Early Dep.</th>
                  <th className="py-3.5 px-3">GPS</th>
                  <th className="py-3.5 px-3">Face Biometric</th>
                  <th className="py-3.5 px-3">Status</th>
                  <th className="py-3.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-card">
                {loading ? (
                  <tr>
                    <td colSpan={14} className="py-12 text-center text-text-mut font-semibold">
                      <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-brand-primary" />
                      Loading attendance records...
                    </td>
                  </tr>
                ) : recordsError ? (
                  <tr>
                    <td colSpan={14} className="py-12 text-center">
                      <div className="max-w-md mx-auto p-5 rounded-[16px] bg-red-500/10 border border-red-500/20 text-center">
                        <AlertCircle size={28} className="mx-auto mb-2 text-red-400" />
                        <h4 className="text-sm font-bold text-text-main mb-1">Failed to fetch attendance records</h4>
                        <p className="text-xs text-text-mut mb-4">{recordsError}</p>
                        <button
                          onClick={() => { setRecordsError(null); fetchRecords(); }}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] bg-brand-primary text-white text-xs font-bold hover:bg-brand-primary/90 transition-all shadow-sm cursor-pointer"
                        >
                          <RefreshCw size={13} /> Retry Loading
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="py-12 text-center text-text-mut font-medium">
                      No attendance records match the selected criteria.
                    </td>
                  </tr>
                ) : (
                  records.map((rec) => (
                    <tr key={rec.id} className="hover:bg-bg-base/40 transition-colors">
                      {/* 1. Employee ID */}
                      <td className="py-3.5 px-3 font-mono font-semibold text-text-mut">
                        {rec.employeeId || rec.userId?.substring(0, 8)}
                      </td>

                      {/* 2. Date */}
                      <td className="py-3.5 px-3 font-semibold text-text-main whitespace-nowrap">
                        {rec.dateFormatted || rec.date}
                      </td>

                      {/* 3. Employee Name */}
                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center font-bold text-xs overflow-hidden flex-shrink-0">
                            {rec.avatarUrl ? (
                              <img src={rec.avatarUrl} alt={rec.employeeName} className="w-full h-full object-cover" />
                            ) : (
                              (rec.employeeName || "E").charAt(0).toUpperCase()
                            )}
                          </div>
                          <div>
                            <div className="font-extrabold text-text-main flex items-center gap-1">
                              <span>{rec.employeeName}</span>
                              {rec.isAdminLocked && <Lock size={11} className="text-red-400" />}
                            </div>
                            <span className="text-[10px] text-text-mut block">
                              {rec.employeeEmail}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* 4. Department */}
                      <td className="py-3.5 px-3 text-text-sec font-semibold">{rec.department}</td>

                      {/* 5. Shift */}
                      <td className="py-3.5 px-3 text-text-mut font-mono text-[11px]">{rec.shift}</td>

                      {/* 6. Check-in */}
                      <td className="py-3.5 px-3">
                        {rec.checkInFormatted !== "--:--" ? (
                          <span className="font-bold font-mono text-emerald-400">{rec.checkInFormatted}</span>
                        ) : (
                          <span className="text-text-mut font-mono">--:--</span>
                        )}
                      </td>

                      {/* 7. Check-out */}
                      <td className="py-3.5 px-3">
                        {rec.checkOutFormatted && rec.checkOutFormatted !== "--:--" ? (
                          <span className="font-bold font-mono text-text-sec">{rec.checkOutFormatted}</span>
                        ) : rec.checkInFormatted !== "--:--" ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-brand-primary font-bold animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-brand-primary"></span> Working
                          </span>
                        ) : (
                          <span className="text-text-mut font-mono">--:--</span>
                        )}
                      </td>

                      {/* 8. Working Hours */}
                      <td className="py-3.5 px-3 font-bold font-mono text-text-main">
                        {rec.workingHoursFormatted}
                      </td>

                      {/* 9. Late Arrival */}
                      <td className="py-3.5 px-3">
                        {rec.lateByMinutes > 0 ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400">
                            +{rec.lateByMinutes}m
                          </span>
                        ) : (
                          <span className="text-text-mut">On time</span>
                        )}
                      </td>

                      {/* 10. Early Departure */}
                      <td className="py-3.5 px-3">
                        {rec.earlyDepartureMinutes > 0 ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-500/10 text-yellow-400">
                            -{rec.earlyDepartureMinutes}m
                          </span>
                        ) : (
                          <span className="text-text-mut">--</span>
                        )}
                      </td>

                      {/* 11. GPS Verification */}
                      <td className="py-3.5 px-3">
                        <button
                          type="button"
                          onClick={() => setSelectedLocationRecord(rec)}
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full transition-all cursor-pointer hover:opacity-80 ${
                            rec.gpsVerification === "Verified" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                            rec.gpsVerification === "Location Captured" ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" :
                            rec.gpsVerification === "Outside Geofence" ? "bg-red-500/10 text-red-400 border border-red-500/20" :
                            rec.gpsVerification === "Accuracy Insufficient" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                            rec.gpsVerification === "Not Required" ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" :
                            "bg-slate-500/10 text-slate-400 border border-slate-500/20"
                          }`}
                          title="Click to view Attendance Location Details"
                        >
                          <MapPin size={10} /> {rec.gpsVerification || "Not Available"}
                        </button>
                      </td>

                      {/* 12. Face Biometric */}
                      <td className="py-3.5 px-3">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          (rec.faceBiometricStatus || rec.faceVerification) === "Verified" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                          (rec.faceBiometricStatus || rec.faceVerification) === "Face Mismatch" ? "bg-red-500/10 text-red-400 border border-red-500/20" :
                          (rec.faceBiometricStatus || rec.faceVerification) === "Liveness Failed" ? "bg-red-500/10 text-red-400 border border-red-500/20" :
                          (rec.faceBiometricStatus || rec.faceVerification) === "Verification Failed" ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" :
                          (rec.faceBiometricStatus || rec.faceVerification) === "Not Enrolled" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                          (rec.faceBiometricStatus || rec.faceVerification) === "Pending" ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20" :
                          "bg-slate-500/10 text-slate-400 border border-slate-500/20"
                        }`}>
                          <ShieldCheck size={10} /> {rec.faceBiometricStatus || rec.faceVerification || "Not Available"}
                        </span>
                      </td>

                      {/* 13. Attendance Status */}
                      <td className="py-3.5 px-3">
                        {renderStatusBadge(rec.attendanceStatus)}
                      </td>

                      {/* 14. Actions */}
                      <td className="py-3.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedLocationRecord(rec)}
                            className="p-1.5 bg-bg-base/70 hover:bg-bg-base text-text-sec hover:text-cyan-400 rounded-[8px] transition-colors cursor-pointer"
                            title="View Attendance Location Details"
                          >
                            <MapPin size={13} />
                          </button>
                          <button
                            onClick={() => handleOpenProfile(rec.userId)}
                            className="p-1.5 bg-bg-base/70 hover:bg-bg-base text-text-sec hover:text-brand-primary rounded-[8px] transition-colors cursor-pointer"
                            title="View Full Profile"
                          >
                            <Eye size={13} />
                          </button>
                          {rec.isAdminLocked && (
                            <button
                              onClick={() => setUnlockRecord(rec)}
                              className="p-1.5 bg-red-500/10 hover:bg-red-500 hover:text-white text-red-400 rounded-[8px] transition-colors cursor-pointer"
                              title="Unlock Attendance"
                            >
                              <Unlock size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="flex items-center justify-between p-4 bg-bg-base/30 border-t border-border-card text-xs">
            <div>
              {recordsError ? (
                <span className="text-red-400 font-semibold flex items-center gap-1.5">
                  <AlertCircle size={13} /> Error loading attendance records
                </span>
              ) : (
                <span className="text-text-mut">
                  Showing {records.length === 0 ? 0 : (page - 1) * limit + 1} to{" "}
                  {Math.min(page * limit, pagination.total)} of {pagination.total} records
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="px-2.5 py-1.5 rounded-[8px] border border-border-card disabled:opacity-30 hover:bg-bg-base text-text-sec cursor-pointer"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="font-mono text-text-main font-bold">
                Page {page} of {pagination.totalPages || 1}
              </span>
              <button
                disabled={page >= pagination.totalPages}
                onClick={() => setPage(p => p + 1)}
                className="px-2.5 py-1.5 rounded-[8px] border border-border-card disabled:opacity-30 hover:bg-bg-base text-text-sec cursor-pointer"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SubTab 2: Live Monitoring (Section 7) ── */}
      {subTab === "live" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Live 1: Currently Working */}
            <div className="bg-bg-card border border-border-card rounded-[24px] p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-border-card">
                <div className="flex items-center gap-2 font-extrabold text-sm text-text-main">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Currently Working ({liveData?.counts?.working || 0})
                </div>
              </div>
              <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                {!liveData?.currentlyWorking?.length ? (
                  <div className="text-center py-8 text-xs text-text-mut">No staff currently clocked in.</div>
                ) : (
                  liveData.currentlyWorking.map(w => (
                    <div key={w.userId} className="p-3 bg-bg-base/40 rounded-[14px] border border-border-card flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-brand-primary/10 text-brand-primary font-bold text-xs flex items-center justify-center">
                          {w.name.charAt(0)}
                        </div>
                        <div>
                          <span className="text-xs font-bold text-text-main block">{w.name}</span>
                          <span className="text-[10px] text-text-mut">{w.department}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-mono font-bold text-emerald-400 block">{w.checkInFormatted}</span>
                        <span className="text-[10px] text-text-mut font-mono">{Math.floor(w.durationMinutes / 60)}h {w.durationMinutes % 60}m</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Live 2: Not Checked In */}
            <div className="bg-bg-card border border-border-card rounded-[24px] p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-border-card">
                <div className="flex items-center gap-2 font-extrabold text-sm text-text-main">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                  Not Checked In ({liveData?.counts?.notCheckedIn || 0})
                </div>
              </div>
              <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                {!liveData?.notCheckedIn?.length ? (
                  <div className="text-center py-8 text-xs text-text-mut">All staff have checked in today.</div>
                ) : (
                  liveData.notCheckedIn.map(n => (
                    <div key={n.userId} className="p-3 bg-bg-base/40 rounded-[14px] border border-border-card flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-slate-500/10 text-slate-400 font-bold text-xs flex items-center justify-center">
                          {n.name.charAt(0)}
                        </div>
                        <div>
                          <span className="text-xs font-bold text-text-main block">{n.name}</span>
                          <span className="text-[10px] text-text-mut">{n.department}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[11px] font-mono text-text-mut">Shift: {n.shiftStart}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Live 3: Late Arrivals Today */}
            <div className="bg-bg-card border border-border-card rounded-[24px] p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-border-card">
                <div className="flex items-center gap-2 font-extrabold text-sm text-text-main">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                  Late Arrivals ({liveData?.counts?.late || 0})
                </div>
              </div>
              <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                {!liveData?.lateToday?.length ? (
                  <div className="text-center py-8 text-xs text-text-mut">No late arrivals reported today!</div>
                ) : (
                  liveData.lateToday.map(l => (
                    <div key={l.userId} className="p-3 bg-amber-500/5 rounded-[14px] border border-amber-500/20 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-500 font-bold text-xs flex items-center justify-center">
                          {l.name.charAt(0)}
                        </div>
                        <div>
                          <span className="text-xs font-bold text-text-main block">{l.name}</span>
                          <span className="text-[10px] text-text-mut">{l.department}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-mono font-bold text-amber-400 block">+{l.lateByMinutes}m late</span>
                        <span className="text-[10px] text-text-mut font-mono">In at {l.checkInFormatted}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SubTab 3: Regularization Reviews (Section 8) ── */}
      {subTab === "regularization" && (
        <div className="bg-bg-card border border-border-card rounded-[24px] p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-base font-extrabold text-text-main">Attendance Correction Requests</h2>
              <p className="text-xs text-text-sec">Review employee requests to rectify missing check-in/out stamps</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-base/60 text-text-mut uppercase tracking-wider font-extrabold border-b border-border-card">
                <tr>
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Attendance Date</th>
                  <th className="py-3 px-4">Requested Times</th>
                  <th className="py-3 px-4">Reason</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-card">
                {records.filter(r => r.isRegularized).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-text-mut">
                      No active pending regularization requests in this period.
                    </td>
                  </tr>
                ) : (
                  records.filter(r => r.isRegularized).map(reg => (
                    <tr key={reg.id} className="hover:bg-bg-base/40">
                      <td className="py-3 px-4 font-bold text-text-main">{reg.employeeName}</td>
                      <td className="py-3 px-4 font-mono text-text-sec">{reg.date}</td>
                      <td className="py-3 px-4 font-mono text-emerald-400">
                        {reg.checkInFormatted} - {reg.checkOutFormatted}
                      </td>
                      <td className="py-3 px-4 text-text-sec max-w-xs truncate">{reg.penaltyReason || "Correction requested"}</td>
                      <td className="py-3 px-4">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          Regularized
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => setSelectedReg(reg)}
                          className="px-2.5 py-1 bg-brand-primary text-white text-[11px] font-bold rounded-[8px] cursor-pointer"
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
        </div>
      )}

      {/* ── SubTab 4: Analytics & Visual Reports (Section 10) ── */}
      {subTab === "analytics" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Department Breakdown Bar */}
            <div className="bg-bg-card border border-border-card rounded-[24px] p-6 shadow-sm space-y-4">
              <h3 className="font-extrabold text-sm text-text-main flex items-center gap-2">
                <BarChart3 size={16} className="text-brand-primary" />
                Department Attendance Standing
              </h3>
              <div className="space-y-3">
                {analyticsData?.departmentBreakdown?.map(dept => (
                  <div key={dept.department}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-bold text-text-main">{dept.department}</span>
                      <span className="font-mono text-text-sec">{dept.present}/{dept.total} ({dept.percentage}%)</span>
                    </div>
                    <div className="w-full h-2.5 bg-bg-base rounded-full overflow-hidden border border-border-card">
                      <div
                        className="h-full bg-brand-primary rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, dept.percentage)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Attendance Analytics Metrics */}
            <div className="bg-bg-card border border-border-card rounded-[24px] p-6 shadow-sm flex flex-col justify-between">
              <div>
                <h3 className="font-extrabold text-sm text-text-main flex items-center gap-2 mb-4">
                  <TrendingUp size={16} className="text-emerald-400" />
                  Key Attendance Indicators
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-bg-base/60 rounded-[18px] border border-border-card">
                    <span className="text-[10px] font-bold text-text-mut uppercase tracking-wider block">AVG WORKING TIME</span>
                    <span className="text-3xl font-extrabold text-text-main block mt-1">
                      {analyticsData?.avgWorkingHours || "8.0"}h
                    </span>
                    <span className="text-[10px] text-text-mut mt-1 block">per logged shift</span>
                  </div>
                  <div className="p-4 bg-bg-base/60 rounded-[18px] border border-border-card">
                    <span className="text-[10px] font-bold text-text-mut uppercase tracking-wider block">PUNCTUALITY RATE</span>
                    <span className="text-3xl font-extrabold text-emerald-400 block mt-1">
                      {summary?.totalEmployees > 0
                        ? Math.max(0, Math.round(((summary.presentEmployees - summary.lateArrivals) / summary.totalEmployees) * 100))
                        : 100}%
                    </span>
                    <span className="text-[10px] text-text-mut mt-1 block">on-time shifts</span>
                  </div>
                </div>
              </div>
              <div className="mt-6 p-4 rounded-[16px] bg-brand-primary/5 border border-brand-primary/20 text-xs text-text-sec flex items-center justify-between">
                <span>Download full detailed executive attendance dossier</span>
                <button
                  onClick={handleExportCsv}
                  className="px-3 py-1.5 bg-brand-primary text-white rounded-[10px] font-bold text-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Download size={13} /> Export CSV
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal 1: Individual Employee Profile Drawer (Section 5) ── */}
      {selectedProfileUserId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end animate-fade-in">
          <div className="w-full max-w-2xl bg-bg-card border-l border-border-card h-full overflow-y-auto p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-border-card pb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center font-extrabold text-base overflow-hidden">
                  {profileData?.employee?.avatar_url ? (
                    <img src={profileData.employee.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    profileData?.employee?.name?.charAt(0) || "E"
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-text-main">{profileData?.employee?.name || "Employee Profile"}</h3>
                  <p className="text-xs text-text-sec">
                    {profileData?.employee?.department} • {profileData?.employee?.designation} • Shift: {profileData?.employee?.shift_start} - {profileData?.employee?.shift_end}
                  </p>
                </div>
              </div>
              <button onClick={handleCloseProfile} className="p-2 text-text-sec hover:text-text-main rounded-full hover:bg-bg-base cursor-pointer">
                <X size={18} />
              </button>
            </div>

            {profileLoading ? (
              <div className="py-20 text-center text-text-mut font-semibold">
                <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-brand-primary" />
                Loading profile intelligence...
              </div>
            ) : (
              <div className="space-y-6">
                {/* Historical Log */}
                <div>
                  <h4 className="text-xs font-extrabold text-text-main uppercase tracking-wider mb-3">Recent 30-Day Attendance</h4>
                  <div className="border border-border-card rounded-[16px] overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-bg-base/60 text-text-mut font-bold">
                        <tr>
                          <th className="py-2 px-3">Date</th>
                          <th className="py-2 px-3">In</th>
                          <th className="py-2 px-3">Out</th>
                          <th className="py-2 px-3">Duration</th>
                          <th className="py-2 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-card">
                        {profileData?.attendanceHistory?.map(a => (
                          <tr key={a.id} className="hover:bg-bg-base/30">
                            <td className="py-2 px-3 font-mono">{String(a.date).split("T")[0]}</td>
                            <td className="py-2 px-3 font-mono text-emerald-400">{a.check_in ? new Date(a.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "--:--"}</td>
                            <td className="py-2 px-3 font-mono text-text-sec">{a.check_out ? new Date(a.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "--:--"}</td>
                            <td className="py-2 px-3 font-mono">{a.duration_minutes ? `${Math.floor(a.duration_minutes / 60)}h ${a.duration_minutes % 60}m` : "--"}</td>
                            <td className="py-2 px-3">{renderStatusBadge(a.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Biometric & Verification Attempts */}
                <div>
                  <h4 className="text-xs font-extrabold text-text-main uppercase tracking-wider mb-3">Verification Logs</h4>
                  <div className="space-y-2">
                    {!profileData?.verificationAttempts?.length ? (
                      <div className="p-4 border border-dashed border-border-card rounded-[14px] text-center text-xs text-text-mut">
                        No biometric failure or review attempts recorded.
                      </div>
                    ) : (
                      profileData.verificationAttempts.map(v => (
                        <div key={v.id} className="p-3 bg-bg-base/40 rounded-[12px] border border-border-card flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-text-main block">{v.failure_category || "Session Attempt"}</span>
                            <span className="text-[10px] text-text-mut">{new Date(v.created_at).toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-bold">
                              GPS: {v.gps_result || "Verified"}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary font-bold">
                              Face: {v.face_result || "Verified"}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal 2: Regularization Review Confirmation ── */}
      {selectedReg && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border-card rounded-[24px] p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-lg font-extrabold text-text-main">Review Regularization</h3>
            <p className="text-xs text-text-sec">
              Employee <strong className="text-text-main">{selectedReg.employeeName}</strong> has requested to regularize attendance for <strong className="text-text-main">{selectedReg.date}</strong>.
            </p>
            <div className="p-3 bg-bg-base rounded-[12px] text-xs font-mono space-y-1">
              <div>Requested Check-In: <span className="text-emerald-400">{selectedReg.checkInFormatted}</span></div>
              <div>Requested Check-Out: <span className="text-text-main">{selectedReg.checkOutFormatted}</span></div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-text-mut block mb-1">Admin Remarks</label>
              <textarea
                value={regRemarks}
                onChange={e => setRegRemarks(e.target.value)}
                placeholder="Enter remarks or justification..."
                className="w-full bg-bg-base text-xs text-text-main p-2.5 rounded-[12px] border border-border-card focus:outline-none focus:border-brand-primary h-20"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                disabled={actionSubmitting}
                onClick={() => setSelectedReg(null)}
                className="px-4 py-2 bg-bg-base hover:bg-bg-base/70 text-text-sec text-xs font-bold rounded-[10px] cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={actionSubmitting}
                onClick={() => handleReviewRegularization("rejected")}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white text-xs font-bold rounded-[10px] cursor-pointer"
              >
                Reject
              </button>
              <button
                disabled={actionSubmitting}
                onClick={() => handleReviewRegularization("approved")}
                className="px-4 py-2 bg-brand-primary hover:bg-brand-hover text-white text-xs font-bold rounded-[10px] cursor-pointer"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal 3: Unlock Attendance Confirmation ── */}
      {unlockRecord && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border-card rounded-[24px] p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mx-auto">
              <Unlock size={24} />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-extrabold text-text-main">Unlock Attendance</h3>
              <p className="text-xs text-text-sec mt-1">
                Unlock attendance standing for <strong className="text-text-main">{unlockRecord.employeeName}</strong> ({unlockRecord.date}).
              </p>
            </div>
            {unlockRecord.penaltyReason && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-[12px] text-xs font-mono text-red-400">
                {unlockRecord.penaltyReason}
              </div>
            )}
            <div>
              <label className="text-[11px] font-bold text-text-mut block mb-1">Resolution Justification</label>
              <textarea
                value={unlockNotes}
                onChange={e => setUnlockNotes(e.target.value)}
                placeholder="e.g. Employee was on customer call or approved exception"
                className="w-full bg-bg-base text-xs text-text-main p-2.5 rounded-[12px] border border-border-card focus:outline-none focus:border-brand-primary h-20"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                disabled={actionSubmitting}
                onClick={() => setUnlockRecord(null)}
                className="px-4 py-2 bg-bg-base text-text-sec text-xs font-bold rounded-[10px] cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={actionSubmitting}
                onClick={handleUnlockAttendance}
                className="px-4 py-2 bg-brand-primary hover:bg-brand-hover text-white text-xs font-bold rounded-[10px] cursor-pointer"
              >
                Confirm Unlock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal 4: Manual Attendance Correction ── */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleManualCorrectSubmit} className="bg-bg-card border border-border-card rounded-[24px] p-6 max-w-lg w-full shadow-2xl space-y-4">
            <h3 className="text-lg font-extrabold text-text-main">Manual Attendance Correction</h3>
            <p className="text-xs text-text-sec">
              Admin adjustment of attendance record. All changes are logged to the permanent audit trail.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-text-mut block mb-1">Select Employee</label>
                <select
                  required
                  value={manualForm.userId}
                  onChange={e => setManualForm({ ...manualForm, userId: e.target.value })}
                  className="w-full bg-bg-base text-xs text-text-main p-2.5 rounded-[12px] border border-border-card focus:outline-none focus:border-brand-primary"
                >
                  <option value="">-- Choose Staff Member --</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.employee_id || u.email})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-text-mut block mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={manualForm.date}
                    onChange={e => setManualForm({ ...manualForm, date: e.target.value })}
                    className="w-full bg-bg-base text-xs text-text-main p-2.5 rounded-[12px] border border-border-card focus:outline-none focus:border-brand-primary"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-text-mut block mb-1">Status</label>
                  <select
                    value={manualForm.status}
                    onChange={e => setManualForm({ ...manualForm, status: e.target.value })}
                    className="w-full bg-bg-base text-xs text-text-main p-2.5 rounded-[12px] border border-border-card focus:outline-none focus:border-brand-primary"
                  >
                    <option value="present">Present</option>
                    <option value="absent">Absent</option>
                    <option value="half-day">Half Day</option>
                    <option value="on-leave">On Leave</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-text-mut block mb-1">Check-In Time</label>
                  <input
                    type="time"
                    value={manualForm.checkIn}
                    onChange={e => setManualForm({ ...manualForm, checkIn: e.target.value })}
                    className="w-full bg-bg-base text-xs text-text-main p-2.5 rounded-[12px] border border-border-card focus:outline-none focus:border-brand-primary font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-text-mut block mb-1">Check-Out Time</label>
                  <input
                    type="time"
                    value={manualForm.checkOut}
                    onChange={e => setManualForm({ ...manualForm, checkOut: e.target.value })}
                    className="w-full bg-bg-base text-xs text-text-main p-2.5 rounded-[12px] border border-border-card focus:outline-none focus:border-brand-primary font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-text-mut block mb-1">Correction Reason (Required for Audit)</label>
                <textarea
                  required
                  value={manualForm.reason}
                  onChange={e => setManualForm({ ...manualForm, reason: e.target.value })}
                  placeholder="State the reason for this manual correction..."
                  className="w-full bg-bg-base text-xs text-text-main p-2.5 rounded-[12px] border border-border-card focus:outline-none focus:border-brand-primary h-16"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={actionSubmitting}
                onClick={() => setShowManualModal(false)}
                className="px-4 py-2 bg-bg-base text-text-sec text-xs font-bold rounded-[10px] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionSubmitting}
                className="px-4 py-2 bg-brand-primary hover:bg-brand-hover text-white text-xs font-bold rounded-[10px] cursor-pointer"
              >
                Apply Correction
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Modal 4: Attendance Location Details (Part 1 Section 5) ── */}
      {selectedLocationRecord && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border-card rounded-[24px] max-w-lg w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-border-card mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                  <MapPin size={18} />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-text-main">Attendance Location Details</h3>
                  <p className="text-xs text-text-mut">Verified check-in coordinates and resolved place</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedLocationRecord(null)}
                className="p-1 text-text-mut hover:text-text-main rounded-lg hover:bg-bg-base transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="space-y-4 text-xs">
              {/* Employee & Check-in Summary */}
              <div className="bg-bg-base/60 rounded-[16px] p-4 border border-border-card space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-text-mut font-semibold">Employee:</span>
                  <span className="font-extrabold text-text-main">{selectedLocationRecord.employeeName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-mut font-semibold">Employee ID:</span>
                  <span className="font-mono font-bold text-text-sec">
                    {selectedLocationRecord.employeeId || selectedLocationRecord.userId?.substring(0, 8)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-mut font-semibold">Attendance Date:</span>
                  <span className="font-bold text-text-main">
                    {selectedLocationRecord.dateLongFormatted || selectedLocationRecord.dateFormatted || selectedLocationRecord.date}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-mut font-semibold">Check-in Time:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {selectedLocationRecord.checkInFormatted !== "--:--" ? selectedLocationRecord.checkInFormatted : "Not Checked In"}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-border-card/60">
                  <span className="text-text-mut font-semibold">Location Status:</span>
                  <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                    selectedLocationRecord.gpsVerification === "Verified" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                    selectedLocationRecord.gpsVerification === "Location Captured" ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" :
                    selectedLocationRecord.gpsVerification === "Outside Geofence" ? "bg-red-500/10 text-red-400 border border-red-500/20" :
                    selectedLocationRecord.gpsVerification === "Accuracy Insufficient" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                    selectedLocationRecord.gpsVerification === "Not Required" ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" :
                    "bg-slate-500/10 text-slate-400 border border-slate-500/20"
                  }`}>
                    <MapPin size={11} /> {selectedLocationRecord.locationStatus || selectedLocationRecord.gpsVerification || "Not Available"}
                  </span>
                </div>
              </div>

              {/* Location Information Details */}
              <div className="bg-bg-base/60 rounded-[16px] p-4 border border-border-card space-y-2.5">
                <div className="text-[11px] font-extrabold uppercase tracking-wider text-text-mut mb-1 flex items-center gap-1.5">
                  <Compass size={13} className="text-brand-primary" /> Location Information
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-bg-card/70 p-2.5 rounded-[12px] border border-border-card">
                    <span className="text-[10px] text-text-mut font-bold uppercase block mb-0.5">Latitude</span>
                    <span className="font-mono font-bold text-text-main text-xs">
                      {selectedLocationRecord.latitude != null ? Number(selectedLocationRecord.latitude).toFixed(6) : "—"}
                    </span>
                  </div>
                  <div className="bg-bg-card/70 p-2.5 rounded-[12px] border border-border-card">
                    <span className="text-[10px] text-text-mut font-bold uppercase block mb-0.5">Longitude</span>
                    <span className="font-mono font-bold text-text-main text-xs">
                      {selectedLocationRecord.longitude != null ? Number(selectedLocationRecord.longitude).toFixed(6) : "—"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-text-mut font-semibold">GPS Accuracy:</span>
                  <span className="font-mono font-bold text-text-sec">
                    {selectedLocationRecord.accuracyFormatted || (selectedLocationRecord.accuracy != null ? `${Math.round(selectedLocationRecord.accuracy)} metres` : "Not Available")}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <span className="text-text-mut font-semibold whitespace-nowrap">Place:</span>
                  <span className="font-bold text-text-main text-right">
                    {selectedLocationRecord.place || selectedLocationRecord.resolvedAddress || "Not Available"}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-border-card/60">
                  <span className="text-text-mut font-semibold">Geofence Enforcement:</span>
                  <span className={`font-bold px-2 py-0.5 rounded-md text-[10px] ${
                    selectedLocationRecord.geofenceEnforcement === "Enabled" 
                      ? "bg-emerald-500/10 text-emerald-400" 
                      : "bg-slate-500/10 text-slate-400"
                  }`}>
                    {selectedLocationRecord.geofenceEnforcement || "Disabled"}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions / Google Maps Button */}
            <div className="flex flex-col gap-2 mt-6">
              {selectedLocationRecord.latitude != null && selectedLocationRecord.longitude != null ? (
                <a
                  href={selectedLocationRecord.mapsUrl || `https://www.google.com/maps?q=${selectedLocationRecord.latitude},${selectedLocationRecord.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-[12px] bg-brand-primary text-white font-bold text-xs hover:bg-brand-primary/90 transition-all shadow-md cursor-pointer"
                >
                  <ExternalLink size={14} /> View Location on Google Maps
                </a>
              ) : (
                <button
                  disabled
                  className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-[12px] bg-bg-base text-text-mut font-bold text-xs cursor-not-allowed opacity-60 border border-border-card"
                >
                  <MapPin size={14} /> Google Maps Unavailable (No GPS coordinates)
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedLocationRecord(null)}
                className="w-full py-2 text-center text-xs font-bold text-text-sec hover:text-text-main transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
