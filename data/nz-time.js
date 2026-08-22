const TIME_ZONE = "Pacific/Auckland";

function todayIso(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function plusDays(isoDate, days) {
  const raw = String(isoDate || "").slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return plusDays(todayIso(), days);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day + Number(days)));
  return utc.toISOString().slice(0, 10);
}

function aucklandOffsetIso(date = new Date()) {
  const name =
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value || "GMT+12:00";
  const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return "+12:00";
  return `${match[1]}${String(match[2]).padStart(2, "0")}:${match[3] || "00"}`;
}

function nowIso(date = new Date()) {
  const wall = date.toLocaleString("sv-SE", { timeZone: TIME_ZONE }).replace(" ", "T");
  return `${wall}${aucklandOffsetIso(date)}`;
}

function monthKey(date = new Date()) {
  return todayIso(date).slice(0, 7);
}

function shiftMonthKey(yearMonth, delta) {
  const [year, month] = String(yearMonth).split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1 + Number(delta), 1));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthShortLabel(yearMonth) {
  const [year, month] = String(yearMonth).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleString("en-NZ", {
    month: "short",
    timeZone: "UTC",
  });
}

function monthLongLabel(yearMonth) {
  const [year, month] = String(yearMonth).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleString("en-NZ", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

module.exports = {
  TIME_ZONE,
  todayIso,
  plusDays,
  nowIso,
  monthKey,
  shiftMonthKey,
  monthShortLabel,
  monthLongLabel,
};
