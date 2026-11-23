const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const WEEKDAY_NAMES_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Extracts pure YYYY-MM-DD from string or Date object without timezone shift.
 */
export const getCleanDateOnly = (val) => {
  if (!val) return "";
  if (typeof val === "string") {
    const match = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(val).substring(0, 10);
};

/**
 * Formats a date string (YYYY-MM-DD) or Date object safely for UI display.
 * Avoids any one-day timezone shifts caused by new Date("YYYY-MM-DD") in UTC.
 */
export const formatDisplayDate = (val, options = {}) => {
  if (!val) return "";
  const dateStr = getCleanDateOnly(val);
  const parts = dateStr.split("-");
  if (parts.length !== 3) {
    return String(val);
  }

  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);

  if (isNaN(y) || isNaN(m) || isNaN(d) || m < 0 || m > 11) {
    return String(val);
  }

  const { includeYear = false, full = false, weekday = false } = options;

  const monthName = full ? MONTH_NAMES_LONG[m] : MONTH_NAMES_SHORT[m];

  let formatted = `${monthName} ${d}`;
  if (includeYear || full) {
    formatted = `${monthName} ${d}, ${y}`;
  }

  if (weekday) {
    // Deterministic weekday using UTC
    const dateObj = new Date(Date.UTC(y, m, d));
    const dayName = WEEKDAY_NAMES_LONG[dateObj.getUTCDay()];
    formatted = `${dayName}, ${formatted}`;
  }

  return formatted;
};

/**
 * Calculates calendar duration (inclusive of start and end dates).
 * Guarantees exact integer days without timezone or daylight-saving anomalies.
 */
export const calculateLeaveDuration = (startDate, endDate) => {
  const startStr = getCleanDateOnly(startDate);
  const endStr = getCleanDateOnly(endDate) || startStr;
  if (!startStr) return 0;
  if (!endStr) return 1;

  const [y1, m1, d1] = startStr.split("-").map(Number);
  const [y2, m2, d2] = endStr.split("-").map(Number);

  if (!y1 || !y2) return 1;

  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);

  const diffDays = Math.round((utc2 - utc1) / (1000 * 60 * 60 * 24)) + 1;
  return diffDays > 0 ? diffDays : 0;
};

/**
 * Checks whether two date ranges overlap.
 * Condition: startA <= endB && endA >= startB
 */
export const hasDateOverlap = (startA, endA, startB, endB) => {
  const sA = getCleanDateOnly(startA);
  const eA = getCleanDateOnly(endA) || sA;
  const sB = getCleanDateOnly(startB);
  const eB = getCleanDateOnly(endB) || sB;

  if (!sA || !sB) return false;
  return sA <= eB && eA >= sB;
};
