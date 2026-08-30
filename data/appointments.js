/** Workshop appointments — schedule slots that may or may not link to a job. */

const APPOINTMENT_STATUSES = [
  { id: "booked", label: "Booked" },
  { id: "confirmed", label: "Confirmed" },
  { id: "needs_reschedule", label: "Need reschedule" },
  { id: "arrived", label: "Arrived" },
  { id: "job_created", label: "Job created" },
  { id: "cancelled", label: "Cancelled" },
  { id: "no_show", label: "No show" },
];

const APPOINTMENT_SOURCES = ["manual", "website", "quote"];

function isAppointmentStatus(value) {
  return APPOINTMENT_STATUSES.some((s) => s.id === value);
}

function statusLabel(id) {
  return APPOINTMENT_STATUSES.find((s) => s.id === id)?.label || id || "";
}

function normalizeTime(value) {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return "";
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function normalizeDate(value) {
  const raw = String(value || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

/** Auckland calendar date YYYY-MM-DD → weekday (0=Sun … 6=Sat), date-only safe. */
function weekdayUtc(isoDate) {
  const date = normalizeDate(isoDate);
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isSunday(isoDate) {
  return weekdayUtc(isoDate) === 0;
}

function assertBookableDate(isoDate, todayIsoDate) {
  const date = normalizeDate(isoDate);
  if (!date) {
    const err = new Error("Appointment date is required (YYYY-MM-DD).");
    err.status = 400;
    throw err;
  }
  const today = normalizeDate(todayIsoDate);
  if (today && date < today) {
    const err = new Error("Cannot book a past date. Choose today or a future date.");
    err.status = 400;
    throw err;
  }
  if (isSunday(date)) {
    const err = new Error("Sunday is closed. Choose another day.");
    err.status = 400;
    throw err;
  }
  return date;
}

function minutesFromMidnight(time) {
  const t = normalizeTime(time);
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function endTimeFromStart(startTime, durationMinutes) {
  const start = minutesFromMidnight(startTime);
  const duration = Math.max(15, Number(durationMinutes) || 0);
  if (start == null) return "";
  const end = Math.min(24 * 60, start + duration);
  const h = Math.floor(end / 60);
  const m = end % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function rangesOverlap(aStart, aDuration, bStart, bDuration) {
  const a0 = minutesFromMidnight(aStart);
  const b0 = minutesFromMidnight(bStart);
  if (a0 == null || b0 == null) return false;
  const a1 = a0 + Math.max(15, Number(aDuration) || 0);
  const b1 = b0 + Math.max(15, Number(bDuration) || 0);
  return a0 < b1 && b0 < a1;
}

function normalizeAppointment(row = {}, idFallback = "") {
  const durationRaw = Number(row.durationMinutes);
  const durationMinutes =
    Number.isFinite(durationRaw) && durationRaw >= 15 ? Math.round(durationRaw) : 120;
  const status = isAppointmentStatus(row.status) ? String(row.status).trim() : "booked";
  const sourceRaw = String(row.source || "manual").trim().toLowerCase();
  const source = APPOINTMENT_SOURCES.includes(sourceRaw) ? sourceRaw : "manual";
  const startTime = normalizeTime(row.startTime) || "09:00";
  const date = normalizeDate(row.date);

  return {
    id: row.id || idFallback,
    date,
    startTime,
    durationMinutes,
    endTime: endTimeFromStart(startTime, durationMinutes),
    status,
    customerId: String(row.customerId || "").trim(),
    customerName: String(row.customerName || "").trim(),
    customerPhone: String(row.customerPhone || "").trim(),
    customerEmail: String(row.customerEmail || "").trim(),
    registration: String(row.registration || "")
      .trim()
      .toUpperCase(),
    vehicle: String(row.vehicle || "").trim(),
    workSummary: String(row.workSummary || "").trim(),
    notes: String(row.notes || "").trim(),
    jobId: String(row.jobId || "").trim(),
    jobNumber: String(row.jobNumber || "").trim(),
    source,
    bookingSmsReminderSentAt: String(row.bookingSmsReminderSentAt || "").trim(),
    bookingSmsReply: String(row.bookingSmsReply || "").trim(),
    bookingSmsReplyAt: String(row.bookingSmsReplyAt || "").trim(),
    createdAt: String(row.createdAt || "").trim(),
    updatedAt: String(row.updatedAt || "").trim(),
  };
}

function findConflicts(rows, candidate, excludeId = "") {
  const date = normalizeDate(candidate.date);
  const startTime = normalizeTime(candidate.startTime);
  const durationMinutes = Number(candidate.durationMinutes) || 0;
  if (!date || !startTime) return [];
  return (rows || []).filter((row) => {
    if (!row || row.id === excludeId) return false;
    if (row.status === "cancelled" || row.status === "no_show") return false;
    if (normalizeDate(row.date) !== date) return false;
    return rangesOverlap(startTime, durationMinutes, row.startTime, row.durationMinutes);
  });
}

module.exports = {
  APPOINTMENT_STATUSES,
  APPOINTMENT_SOURCES,
  isAppointmentStatus,
  statusLabel,
  normalizeTime,
  normalizeDate,
  weekdayUtc,
  isSunday,
  assertBookableDate,
  minutesFromMidnight,
  endTimeFromStart,
  rangesOverlap,
  normalizeAppointment,
  findConflicts,
};
