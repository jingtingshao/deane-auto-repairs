/** Website booking enquiries — stored so admin can popup and follow up. */

function blank(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "—" || raw === "–" || raw === "-") return "";
  return raw;
}

function startTimeFromPreferred(value) {
  const raw = blank(value).toLowerCase();
  if (!raw) return "";
  if (raw.includes("afternoon")) return "13:00";
  if (raw.includes("morning")) return "09:00";
  const match = raw.match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = match[2];
  if (/\bpm\b/.test(raw) && hour < 12) hour += 12;
  if (/\bam\b/.test(raw) && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return "";
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function normalizeBookingRequest(row = {}, idFallback = "") {
  return {
    id: String(row.id || idFallback || "").trim(),
    name: blank(row.name),
    email: blank(row.email),
    phone: blank(row.phone),
    vehicle: blank(row.vehicle),
    registration: blank(row.registration || row.rego).toUpperCase(),
    preferredDate: blank(row.preferredDate || row.preferred_date || row.date),
    preferredTime: blank(row.preferredTime || row.preferred_time || row.time),
    helpWith: blank(row.helpWith || row.help_with || row.help),
    notes: blank(row.notes),
    seenAt: blank(row.seenAt),
    handledAt: blank(row.handledAt),
    createdAt: blank(row.createdAt),
  };
}

module.exports = {
  blank,
  startTimeFromPreferred,
  normalizeBookingRequest,
};
