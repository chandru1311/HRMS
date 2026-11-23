import React, { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar, CheckCircle2, AlertCircle } from 'lucide-react';
import { formatDisplayDate, calculateLeaveDuration, getCleanDateOnly, hasDateOverlap } from '../utils/dateUtils';

export default function CustomDateRangePicker({ startDate, endDate, setStartDate, setEndDate, minDate, existingLeaves = [], onOverlapChange }) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    if (startDate) {
      const parts = String(startDate).split('-');
      if (parts.length === 3) {
        const y = Number(parts[0]);
        const m = Number(parts[1]) - 1;
        if (!isNaN(y) && !isNaN(m)) return new Date(y, m, 1);
      }
    }
    return new Date();
  });
  const [hoverDate, setHoverDate] = useState(null);

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  // Adjust so Monday is 0, Sunday is 6
  const startOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

  const days = useMemo(() => {
    const arr = [];
    // Previous month padding
    const prevMonthDays = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 0).getDate();
    for (let i = startOffset - 1; i >= 0; i--) {
      const dayNum = prevMonthDays - i;
      const prevDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, dayNum, 12, 0, 0);
      const y = prevDate.getFullYear();
      const m = String(prevDate.getMonth() + 1).padStart(2, '0');
      const d = String(prevDate.getDate()).padStart(2, '0');
      arr.push({
        dateStr: `${y}-${m}-${d}`,
        dayNumber: dayNum,
        isCurrentMonth: false
      });
    }
    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      const y = currentMonth.getFullYear();
      const m = String(currentMonth.getMonth() + 1).padStart(2, '0');
      const d = String(i).padStart(2, '0');
      arr.push({
        dateStr: `${y}-${m}-${d}`,
        dayNumber: i,
        isCurrentMonth: true
      });
    }
    // Next month padding
    const remaining = 42 - arr.length; // 6 rows of 7 days
    for (let i = 1; i <= remaining; i++) {
      const nextDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, i, 12, 0, 0);
      const y = nextDate.getFullYear();
      const m = String(nextDate.getMonth() + 1).padStart(2, '0');
      const d = String(nextDate.getDate()).padStart(2, '0');
      arr.push({
        dateStr: `${y}-${m}-${d}`,
        dayNumber: i,
        isCurrentMonth: false
      });
    }
    return arr;
  }, [currentMonth, daysInMonth, startOffset]);

  const handleDateClick = (dateStr) => {
    // Disable past dates if minDate is provided
    if (minDate && dateStr < minDate) return;

    if (!startDate || (startDate && endDate)) {
      setStartDate(dateStr);
      setEndDate('');
    } else if (startDate && !endDate) {
      if (dateStr < startDate) {
        setStartDate(dateStr);
      } else {
        setEndDate(dateStr);
      }
    }
  };

  const isSelected = (dateStr) => {
    return dateStr === startDate || dateStr === endDate;
  };

  const isHoverRange = (dateStr) => {
    if (startDate && !endDate && hoverDate) {
      if (hoverDate > startDate) {
        return dateStr > startDate && dateStr <= hoverDate;
      } else if (hoverDate < startDate) {
        return dateStr < startDate && dateStr >= hoverDate;
      }
    }
    return false;
  };

  const isBetween = (dateStr) => {
    if (startDate && endDate) {
      return dateStr > startDate && dateStr < endDate;
    }
    return false;
  };

  const overlappingLeave = useMemo(() => {
    if (!startDate) return null;
    const newStart = startDate;
    const newEnd = endDate || startDate;

    return (existingLeaves || []).find(leave => {
      const st = String(leave.status || "").toLowerCase();
      if (st !== "pending" && st !== "approved") return false;
      const exStart = getCleanDateOnly(leave.startDate || leave.start_date);
      const exEnd = getCleanDateOnly(leave.endDate || leave.end_date) || exStart;
      if (!exStart) return false;

      return hasDateOverlap(newStart, newEnd, exStart, exEnd);
    });
  }, [startDate, endDate, existingLeaves]);

  const isOverlapping = Boolean(overlappingLeave);

  useEffect(() => {
    if (typeof onOverlapChange === "function") {
      onOverlapChange(isOverlapping);
    }
  }, [isOverlapping, onOverlapChange]);

  const durationDays = useMemo(() => {
    // 1. Before calculating leave duration, check employee's existing leave requests.
    // 4. If an overlap is detected, do not calculate or add duplicate leave days.
    if (!startDate || isOverlapping) return 0;
    return calculateLeaveDuration(startDate, endDate || startDate);
  }, [startDate, endDate, isOverlapping]);

  const getExistingLeaveForDate = (dateStr) => {
    return (existingLeaves || []).find(leave => {
      const st = String(leave.status || "").toLowerCase();
      if (st !== "pending" && st !== "approved") return false;
      const exStart = getCleanDateOnly(leave.startDate || leave.start_date);
      const exEnd = getCleanDateOnly(leave.endDate || leave.end_date) || exStart;
      if (!exStart) return false;
      return dateStr >= exStart && dateStr <= exEnd;
    });
  };

  const includesWeekend = useMemo(() => {
    if (!startDate) return false;
    const finalEnd = endDate || startDate;
    const [y1, m1, d1] = startDate.split('-').map(Number);
    const [y2, m2, d2] = finalEnd.split('-').map(Number);
    if (!y1 || !y2) return false;

    let curr = new Date(y1, m1 - 1, d1, 12, 0, 0);
    const end = new Date(y2, m2 - 1, d2, 12, 0, 0);

    while (curr <= end) {
      const day = curr.getDay();
      if (day === 0 || day === 6) return true;
      curr.setDate(curr.getDate() + 1);
    }
    return false;
  }, [startDate, endDate]);

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  return (
    <div className="flex flex-col sm:flex-row bg-bg-card rounded-[24px] border border-border-card overflow-hidden shadow-sm font-sans w-full max-w-[700px] mx-auto text-left">
      {/* Calendar Grid Section */}
      <div className="p-6 sm:p-8 flex-1">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-xl font-extrabold text-text-main">
            {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </h2>
          <div className="flex items-center gap-4">
            <button 
              type="button" 
              onClick={prevMonth}
              className="text-brand-primary hover:text-brand-hover p-1 cursor-pointer transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
            <button 
              type="button" 
              onClick={nextMonth}
              className="text-brand-primary hover:text-brand-hover p-1 cursor-pointer transition-colors"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 text-center mb-4">
          {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((day) => (
            <div key={day} className="text-[10px] font-extrabold text-text-mut uppercase tracking-wider">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 text-center gap-y-2 relative">
          {days.map((dayObj, i) => {
            const dateStr = dayObj.dateStr;
            const isMinDisabled = minDate && dateStr < minDate;
            const selected = isSelected(dateStr);
            const between = isBetween(dateStr) || isHoverRange(dateStr);
            const isStartNode = dateStr === startDate;
            const isEndNode = dateStr === endDate || (startDate && !endDate && dateStr === hoverDate && hoverDate > startDate);
            const isHoverStartNode = (startDate && !endDate && dateStr === hoverDate && hoverDate < startDate);

            const existingForDay = getExistingLeaveForDate(dateStr);

            return (
              <div 
                key={i} 
                className="relative py-1 flex items-center justify-center cursor-pointer"
                onMouseEnter={() => setHoverDate(dateStr)}
                onClick={() => handleDateClick(dateStr)}
              >
                {/* Connecting Trail Background */}
                {between && (
                  <div className={`absolute inset-y-1 inset-x-0 ${isOverlapping ? "bg-red-500/15" : "bg-brand-primary/15"}`} />
                )}
                {selected && endDate && isStartNode && startDate < endDate && (
                  <div className={`absolute inset-y-1 right-0 left-1/2 ${isOverlapping ? "bg-red-500/15" : "bg-brand-primary/15"}`} />
                )}
                {selected && endDate && isEndNode && endDate > startDate && (
                  <div className={`absolute inset-y-1 left-0 right-1/2 ${isOverlapping ? "bg-red-500/15" : "bg-brand-primary/15"}`} />
                )}

                {/* Hover state for trailing start (when hovering before start date) */}
                {!endDate && startDate && isStartNode && hoverDate && hoverDate < startDate && (
                  <div className={`absolute inset-y-1 left-0 right-1/2 ${isOverlapping ? "bg-red-500/15" : "bg-brand-primary/15"}`} />
                )}
                {!endDate && startDate && isHoverStartNode && (
                  <div className={`absolute inset-y-1 right-0 left-1/2 ${isOverlapping ? "bg-red-500/15" : "bg-brand-primary/15"}`} />
                )}
                {!endDate && startDate && hoverDate > startDate && isStartNode && (
                  <div className={`absolute inset-y-1 right-0 left-1/2 ${isOverlapping ? "bg-red-500/15" : "bg-brand-primary/15"}`} />
                )}

                {/* Node Circle */}
                <div 
                  className={`relative z-10 w-9 h-9 flex items-center justify-center rounded-full text-sm font-bold transition-all ${
                    selected
                      ? (isOverlapping ? "bg-red-500 text-white shadow-md shadow-red-500/30" : "bg-brand-primary text-white shadow-md shadow-brand-primary/30")
                      : (!endDate && startDate && dateStr === hoverDate)
                      ? (isOverlapping ? "bg-red-500 text-white shadow-md shadow-red-500/30 scale-95" : "bg-brand-primary text-white shadow-md shadow-brand-primary/30 scale-95")
                      : between
                      ? (isOverlapping ? "text-red-500 font-extrabold" : "text-brand-primary")
                      : isMinDisabled
                      ? "text-text-mut/30 cursor-not-allowed"
                      : !dayObj.isCurrentMonth
                      ? "text-text-mut"
                      : "text-text-main hover:bg-bg-base"
                  }`}
                >
                  {dayObj.dayNumber}
                  {existingForDay && !selected && (
                    <span 
                      className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${
                        existingForDay.status === "approved" ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                      title={`${existingForDay.leaveType || existingForDay.leave_type || "Leave"} (${existingForDay.status})`}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary Panel */}
      <div className="bg-bg-base/50 p-6 sm:p-8 flex-1 border-t sm:border-t-0 sm:border-l border-border-card flex flex-col justify-center">
        
        <div className="mb-6">
          <span className="text-[11px] font-bold text-text-sec block mb-2">Selected Dates</span>
          {startDate ? (
            <div className={`text-xl sm:text-2xl font-black tracking-tight ${isOverlapping ? "text-red-500" : "text-text-main"}`}>
              {formatDisplayDate(startDate)}
              {endDate && endDate !== startDate ? (
                <>
                  <span className="text-text-mut mx-2">—</span>
                  {formatDisplayDate(endDate, { includeYear: true })}
                </>
              ) : (
                <span className={isOverlapping ? "text-red-500" : "text-text-main"}> {String(startDate).split('-')[0]}</span>
              )}
            </div>
          ) : (
            <div className="text-xl sm:text-2xl font-black text-text-mut tracking-tight">
              Select range...
            </div>
          )}
        </div>

        <div className="h-px bg-border-card w-full mb-6" />

        <div className="mb-6">
          <span className="text-[11px] font-bold text-text-sec block mb-3">Total Duration</span>
          <div className="flex items-center gap-3">
            <div className={isOverlapping ? "text-red-500" : "text-brand-primary"}>
              <Calendar size={28} />
            </div>
            <span className={`text-2xl sm:text-3xl font-black tracking-tight ${isOverlapping ? "text-red-500" : "text-brand-primary"}`}>
              {isOverlapping ? "0 Days" : `${durationDays} ${durationDays === 1 ? 'Day' : 'Days'}`}
            </span>
          </div>
        </div>

        {/* Clear Overlapping Error Message */}
        {isOverlapping && (
          <div className="mb-6 p-3.5 bg-red-500/10 border border-red-500/30 rounded-[14px] text-red-500 dark:text-red-400 text-xs font-bold flex items-start gap-2.5 shadow-sm">
            <AlertCircle size={18} className="flex-shrink-0 mt-0.5 text-red-500" />
            <div className="flex flex-col gap-1 text-left">
              <span className="leading-snug">You already have a leave request for some of these dates. Please select a different date range.</span>
              {overlappingLeave && (
                <span className="text-[10px] font-semibold text-text-mut">
                  Conflict with: <strong className="text-text-main">{overlappingLeave.leaveType || overlappingLeave.leave_type || "Leave"}</strong> ({formatDisplayDate(overlappingLeave.startDate, { includeYear: true })} to {formatDisplayDate(overlappingLeave.endDate, { includeYear: true })}) - <span className="uppercase font-extrabold text-amber-500">{overlappingLeave.status}</span>
                </span>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-sm font-bold text-text-sec">
          Includes weekend
          {includesWeekend ? (
            <CheckCircle2 size={18} className="text-brand-success" />
          ) : (
            <div className="w-[18px] h-[18px] rounded-full border border-border-card bg-bg-card flex items-center justify-center">
              <span className="block w-1.5 h-1.5 rounded-full bg-border-card" />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
