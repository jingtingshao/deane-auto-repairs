const appointmentsLib = require("./appointments");
const bookingConfig = require("./booking-config");
const { TIME_ZONE, todayIso, plusDays } = require("./nz-time");

function generateSlotTimes() {
  const start = appointmentsLib.minutesFromMidnight(bookingConfig.firstSlotTime);
  const end = appointmentsLib.minutesFromMidnight(bookingConfig.lastSlotTime);
  const interval = bookingConfig.slotIntervalMinutes;
  if (start == null || end == null || !interval) return [];
  const slots = [];
  for (let minutes = start; minutes <= end; minutes += interval) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return slots;
}

function aucklandMinutesNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function maxBookableDate(fromIso = todayIso()) {
  return plusDays(fromIso, bookingConfig.maxAdvanceWeeks * 7);
}

function isDateInRange(isoDate, today = todayIso()) {
  const date = appointmentsLib.normalizeDate(isoDate);
  if (!date) return false;
  if (date < today) return false;
  if (date > maxBookableDate(today)) return false;
  if (appointmentsLib.isSunday(date)) return false;
  return true;
}

function countAtSlot(rows, date, startTime) {
  const d = appointmentsLib.normalizeDate(date);
  const t = appointmentsLib.normalizeTime(startTime);
  if (!d || !t) return 0;
  return (rows || []).filter((row) => {
    if (!row) return false;
    if (row.status === "cancelled" || row.status === "no_show") return false;
    return appointmentsLib.normalizeDate(row.date) === d && appointmentsLib.normalizeTime(row.startTime) === t;
  }).length;
}

function isSlotPast(date, startTime, today = todayIso(), nowMinutes = aucklandMinutesNow()) {
  const d = appointmentsLib.normalizeDate(date);
  const slotMinutes = appointmentsLib.minutesFromMidnight(startTime);
  if (!d || slotMinutes == null) return true;
  if (d > today) return false;
  if (d < today) return true;
  return slotMinutes <= nowMinutes;
}

function slotCapacityRemaining(rows, date, startTime) {
  const used = countAtSlot(rows, date, startTime);
  return Math.max(0, bookingConfig.maxCarsPerSlot - used);
}

function isSlotBookable(rows, date, startTime, today = todayIso()) {
  if (!isDateInRange(date, today)) return false;
  try {
    appointmentsLib.assertBookableDate(date, today);
  } catch {
    return false;
  }
  if (isSlotPast(date, startTime, today)) return false;
  return slotCapacityRemaining(rows, date, startTime) > 0;
}

function formatClock(time, use24h = false) {
  const t = appointmentsLib.normalizeTime(time);
  if (!t) return "";
  const [hRaw, m] = t.split(":").map(Number);
  if (use24h) return t;
  const suffix = hRaw >= 12 ? "pm" : "am";
  const h12 = hRaw % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

function slotsForDate(rows, date, today = todayIso()) {
  const normalized = appointmentsLib.normalizeDate(date);
  if (!normalized) {
    return { date: "", slots: [], bookable: false };
  }
  const bookableDay = isDateInRange(normalized, today);
  const slots = generateSlotTimes().map((startTime) => {
    const available = bookableDay && isSlotBookable(rows, normalized, startTime, today);
    const remaining = slotCapacityRemaining(rows, normalized, startTime);
    return {
      startTime,
      label12h: formatClock(startTime, false),
      label24h: formatClock(startTime, true),
      available,
      remaining,
    };
  });
  return {
    date: normalized,
    bookable: bookableDay,
    slots,
    hasAvailability: slots.some((s) => s.available),
  };
}

/** YYYY-MM → { "2026-09-02": true, ... } days with at least one open slot. */
function monthAvailability(rows, yearMonth, today = todayIso()) {
  const match = String(yearMonth || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return { month: "", days: {} };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = {};
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${match[1]}-${match[2]}-${String(day).padStart(2, "0")}`;
    if (!isDateInRange(iso, today)) continue;
    const { hasAvailability } = slotsForDate(rows, iso, today);
    days[iso] = hasAvailability;
  }
  return { month: `${match[1]}-${match[2]}`, days };
}

module.exports = {
  generateSlotTimes,
  aucklandMinutesNow,
  maxBookableDate,
  isDateInRange,
  countAtSlot,
  isSlotPast,
  slotCapacityRemaining,
  isSlotBookable,
  formatClock,
  slotsForDate,
  monthAvailability,
};
