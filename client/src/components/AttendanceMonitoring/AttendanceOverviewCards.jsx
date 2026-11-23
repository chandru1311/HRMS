import React from 'react';
import { 
  Users, 
  CheckCircle2, 
  XCircle, 
  ClockAlert, 
  Briefcase, 
  LogOut, 
  CalendarOff, 
  FileClock 
} from 'lucide-react';

export default function AttendanceOverviewCards({ summary = {}, loading = false }) {
  const cards = [
    {
      id: "total",
      label: "Total Employees",
      value: summary.totalEmployees ?? 0,
      icon: Users,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      borderColor: "border-blue-500/20",
      subLabel: "Active workforce"
    },
    {
      id: "present",
      label: "Present Employees",
      value: summary.presentEmployees ?? 0,
      icon: CheckCircle2,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/20",
      subLabel: summary.totalEmployees ? `${Math.round(((summary.presentEmployees || 0) / summary.totalEmployees) * 100)}% attendance rate` : "Logged check-in"
    },
    {
      id: "absent",
      label: "Absent Employees",
      value: summary.absentEmployees ?? 0,
      icon: XCircle,
      color: "text-rose-500",
      bgColor: "bg-rose-500/10",
      borderColor: "border-rose-500/20",
      subLabel: "No check-in recorded"
    },
    {
      id: "late",
      label: "Late Arrivals",
      value: summary.lateArrivals ?? 0,
      icon: ClockAlert,
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/20",
      subLabel: "Past shift start"
    },
    {
      id: "working",
      label: "Currently Working",
      value: summary.currentlyWorking ?? 0,
      icon: Briefcase,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
      borderColor: "border-purple-500/20",
      subLabel: "Active shift session"
    },
    {
      id: "checkout",
      label: "Checked Out",
      value: summary.checkedOut ?? 0,
      icon: LogOut,
      color: "text-indigo-500",
      bgColor: "bg-indigo-500/10",
      borderColor: "border-indigo-500/20",
      subLabel: "Shift completed"
    },
    {
      id: "leave",
      label: "Employees on Leave",
      value: summary.onLeave ?? 0,
      icon: CalendarOff,
      color: "text-cyan-500",
      bgColor: "bg-cyan-500/10",
      borderColor: "border-cyan-500/20",
      subLabel: "Approved time off"
    },
    {
      id: "regularization",
      label: "Pending Regularization",
      value: summary.pendingRegularization ?? 0,
      icon: FileClock,
      color: "text-amber-400",
      bgColor: "bg-amber-400/10",
      borderColor: "border-amber-400/20",
      subLabel: "Awaiting review"
    }
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.id}
            className={`bg-bg-card p-4 sm:p-5 rounded-[20px] border ${c.borderColor} shadow-sm hover:shadow-md transition-all flex flex-col justify-between`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] sm:text-xs font-bold text-text-sec uppercase tracking-wider truncate">
                {c.label}
              </span>
              <div className={`w-8 h-8 rounded-[10px] ${c.bgColor} ${c.color} flex items-center justify-center flex-shrink-0`}>
                <Icon size={18} />
              </div>
            </div>

            <div>
              {loading ? (
                <div className="h-8 w-16 bg-slate-700/30 animate-pulse rounded my-1" />
              ) : (
                <div className="text-2xl sm:text-3xl font-black text-text-main tracking-tight">
                  {c.value}
                </div>
              )}
              <span className="text-[10px] font-semibold text-text-mut mt-1 block truncate">
                {c.subLabel}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
