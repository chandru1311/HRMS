import React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  PieChart,
  Pie,
  Cell
} from "recharts";
import {
  Download,
  FileSpreadsheet,
  FileText,
  TrendingUp,
  BarChart3,
  PieChart as PieIcon,
  Clock,
  Users
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default function AttendanceAnalyticsPanel({
  analyticsData = null,
  records = [],
  loading = false,
  onExportCsv,
  showToast
}) {
  const dailyTrends = analyticsData?.dailyTrends || [];
  const deptBreakdown = analyticsData?.departmentBreakdown || [];
  const hoursDistribution = analyticsData?.workingHoursDistribution || [];
  const statusDistribution = analyticsData?.statusDistribution || [];

  const COLORS = ["#10b981", "#ef4444", "#f59e0b", "#6366f1", "#3b82f6", "#8b5cf6"];

  // Excel Export Handler
  const handleExportExcel = () => {
    try {
      if (!records || records.length === 0) {
        showToast && showToast("No records available to export.", "warning");
        return;
      }

      const rows = records.map((r) => ({
        "Employee ID": r.empId || r.employeeId || r.userId?.slice(-6) || "",
        "Employee Name": r.employeeName || r.name || "",
        "Email": r.email || "",
        "Department": r.department || "",
        "Shift": r.shift_name || "General Shift",
        "Date": r.date || "",
        "Check In": r.check_in_formatted || r.checkIn || "",
        "Check Out": r.check_out_formatted || r.checkOut || "",
        "Working Hours": r.working_hours || 0,
        "Late (Mins)": r.late_minutes || 0,
        "Early Departure (Mins)": r.early_departure_minutes || 0,
        "GPS Verification": r.gps_verification_status || "N/A",
        "Face Verification": r.face_verification_status || "N/A",
        "Attendance Status": r.attendance_status || r.status || "Present",
        "Admin Remarks": r.admin_remarks || ""
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance_Report");

      const today = new Date().toISOString().split("T")[0];
      XLSX.writeFile(workbook, `Zuna_Attendance_Report_${today}.xlsx`);

      showToast && showToast("Excel report exported successfully!", "success");
    } catch (err) {
      console.error(err);
      showToast && showToast("Failed to export Excel report: " + err.message, "error");
    }
  };

  // CSV Export Handler
  const handleExportCsv = () => {
    try {
      if (!records || records.length === 0) {
        showToast && showToast("No records available to export.", "warning");
        return;
      }

      const headers = [
        "Employee ID",
        "Employee Name",
        "Email",
        "Department",
        "Shift",
        "Date",
        "Check In",
        "Check Out",
        "Working Hours",
        "Late Minutes",
        "Early Dep Minutes",
        "GPS Status",
        "Face Status",
        "Attendance Status",
        "Admin Remarks"
      ];

      const csvRows = [
        headers.join(","),
        ...records.map((r) => [
          `"${r.empId || r.employeeId || r.userId?.slice(-6) || ""}"`,
          `"${(r.employeeName || r.name || "").replace(/"/g, '""')}"`,
          `"${r.email || ""}"`,
          `"${r.department || ""}"`,
          `"${r.shift_name || "General Shift"}"`,
          `"${r.date || ""}"`,
          `"${r.check_in_formatted || r.checkIn || ""}"`,
          `"${r.check_out_formatted || r.checkOut || ""}"`,
          `"${r.working_hours || 0}"`,
          `"${r.late_minutes || 0}"`,
          `"${r.early_departure_minutes || 0}"`,
          `"${r.gps_verification_status || "N/A"}"`,
          `"${r.face_verification_status || "N/A"}"`,
          `"${r.attendance_status || r.status || "Present"}"`,
          `"${(r.admin_remarks || "").replace(/"/g, '""')}"`
        ].join(","))
      ];

      const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const today = new Date().toISOString().split("T")[0];
      link.setAttribute("href", url);
      link.setAttribute("download", `Zuna_Attendance_Report_${today}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      showToast && showToast("CSV report exported successfully!", "success");
    } catch (err) {
      console.error(err);
      showToast && showToast("Failed to export CSV: " + err.message, "error");
    }
  };

  // PDF Export Handler
  const handleExportPdf = () => {
    try {
      if (!records || records.length === 0) {
        showToast && showToast("No records available to export.", "warning");
        return;
      }

      const doc = new jsPDF("landscape", "pt", "a4");

      // Title & Branding
      doc.setFontSize(16);
      doc.setTextColor(50, 40, 100);
      doc.text("Zuna HRMS - Attendance Audit & Monitoring Report", 40, 40);

      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      const today = new Date().toISOString().split("T")[0];
      doc.text(`Generated on: ${new Date().toLocaleString()} | Total Logs: ${records.length}`, 40, 58);

      const tableData = records.slice(0, 250).map((r) => [
        r.empId || r.employeeId || r.userId?.slice(-6) || "",
        r.employeeName || r.name || "",
        r.department || "",
        r.date || "",
        r.check_in_formatted || r.checkIn || "--",
        r.check_out_formatted || r.checkOut || "--",
        r.working_hours ? `${r.working_hours}h` : "--",
        r.late_minutes > 0 ? `${r.late_minutes}m` : "--",
        r.gps_verification_status || "N/A",
        r.face_verification_status || "N/A",
        r.attendance_status || r.status || "Present"
      ]);

      autoTable(doc, {
        startY: 75,
        head: [
          [
            "ID",
            "Name",
            "Dept",
            "Date",
            "Check-In",
            "Check-Out",
            "Hours",
            "Late",
            "GPS",
            "Face",
            "Status"
          ]
        ],
        body: tableData,
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [88, 28, 135], textColor: 255 },
        alternateRowStyles: { fillColor: [248, 248, 252] }
      });

      doc.save(`Zuna_Attendance_Report_${today}.pdf`);
      showToast && showToast("PDF report generated successfully!", "success");
    } catch (err) {
      console.error(err);
      showToast && showToast("Failed to export PDF: " + err.message, "error");
    }
  };

  return (
    <div className="space-y-6">
      {/* Export Bar */}
      <div className="bg-[#12131A] border border-zinc-800/80 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4 shadow-xl">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-purple-400" />
            Attendance Analytics & Formal Export
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Statistical aggregation of workforce presence, department health, and regulatory export.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white border border-emerald-500/30 text-xs font-semibold transition-all shadow-sm"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Export Excel (.xlsx)
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white border border-blue-500/30 text-xs font-semibold transition-all shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-all shadow-md shadow-purple-950/40"
          >
            <FileText className="w-3.5 h-3.5" />
            Export PDF (.pdf)
          </button>
        </div>
      </div>

      {/* Grid of Visual Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Daily Presence vs Absence Trends */}
        <div className="bg-[#12131A] border border-zinc-800/80 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-purple-400" />
                Daily Attendance Trend
              </h4>
              <p className="text-[11px] text-zinc-500 mt-0.5">Present, Late, and Absent rates over time</p>
            </div>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorPresent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorAbsent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorLate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" stroke="#71717a" fontSize={10} />
                <YAxis stroke="#71717a" fontSize={10} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    borderColor: "#3f3f46",
                    borderRadius: "8px",
                    fontSize: "11px",
                    color: "#f4f4f5"
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                <Area type="monotone" dataKey="present" stroke="#10b981" fillOpacity={1} fill="url(#colorPresent)" name="Present" />
                <Area type="monotone" dataKey="absent" stroke="#ef4444" fillOpacity={1} fill="url(#colorAbsent)" name="Absent" />
                <Area type="monotone" dataKey="late" stroke="#f59e0b" fillOpacity={1} fill="url(#colorLate)" name="Late" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Department Attendance Rate Breakdown */}
        <div className="bg-[#12131A] border border-zinc-800/80 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-purple-400" />
                Department Attendance Breakdown
              </h4>
              <p className="text-[11px] text-zinc-500 mt-0.5">Present vs Absent headcount by department</p>
            </div>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deptBreakdown} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="department" stroke="#71717a" fontSize={10} />
                <YAxis stroke="#71717a" fontSize={10} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    borderColor: "#3f3f46",
                    borderRadius: "8px",
                    fontSize: "11px",
                    color: "#f4f4f5"
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                <Bar dataKey="present" fill="#10b981" name="Present" radius={[4, 4, 0, 0]} />
                <Bar dataKey="absent" fill="#ef4444" name="Absent" radius={[4, 4, 0, 0]} />
                <Bar dataKey="late" fill="#f59e0b" name="Late" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 3: Working Hours Distribution */}
        <div className="bg-[#12131A] border border-zinc-800/80 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
                <Clock className="w-4 h-4 text-purple-400" />
                Working Hours Distribution
              </h4>
              <p className="text-[11px] text-zinc-500 mt-0.5">Shift completion and overtime clustering</p>
            </div>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hoursDistribution} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="bracket" stroke="#71717a" fontSize={10} />
                <YAxis stroke="#71717a" fontSize={10} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    borderColor: "#3f3f46",
                    borderRadius: "8px",
                    fontSize: "11px",
                    color: "#f4f4f5"
                  }}
                />
                <Bar dataKey="count" fill="#8b5cf6" name="Employees" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 4: Status Composition */}
        <div className="bg-[#12131A] border border-zinc-800/80 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
                <PieIcon className="w-4 h-4 text-purple-400" />
                Overall Attendance Share
              </h4>
              <p className="text-[11px] text-zinc-500 mt-0.5">Ratio of present, leave, absent, and pending</p>
            </div>
          </div>
          <div className="h-64 w-full flex items-center justify-center">
            {statusDistribution.length === 0 ? (
              <span className="text-xs text-zinc-500">No distribution data available</span>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusDistribution}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {statusDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      borderColor: "#3f3f46",
                      borderRadius: "8px",
                      fontSize: "11px",
                      color: "#f4f4f5"
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
