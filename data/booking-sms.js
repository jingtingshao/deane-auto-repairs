const business = require("./business");
const catalog = require("./catalog");
const namesLib = require("./names");
const appointmentsLib = require("./appointments");

function formatSmsClock(time) {
  const t = appointmentsLib.normalizeTime(time);
  if (!t) return "";
  const [hRaw, m] = t.split(":").map(Number);
  const suffix = hRaw >= 12 ? "pm" : "am";
  const h12 = hRaw % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

function firstNameForSms(customerName) {
  const full = namesLib.formatFullCustomerName(String(customerName || "").trim());
  const first = full.split(/\s+/).find(Boolean);
  return first || "there";
}

function formatSmsMoney(n) {
  const v = catalog.round2(n);
  if (!(v > 0)) return "";
  return Math.abs(v - Math.round(v)) < 0.001 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`;
}

function resolveBookingSmsPriceIncl(appt = {}, fallbackIncl = 0) {
  const stored = Number(appt.quotedPriceIncl);
  if (Number.isFinite(stored) && stored > 0) return catalog.round2(stored);
  const fromWork = catalog.advertisedPriceFromWorkSummary(appt.workSummary);
  if (fromWork > 0) return fromWork;
  const fallback = Number(fallbackIncl);
  if (Number.isFinite(fallback) && fallback > 0) return catalog.round2(fallback);
  return 0;
}

function buildBookingConfirmSmsBody(appt = {}, extras = {}) {
  const name = firstNameForSms(appt.customerName);
  const plate = String(appt.registration || "").trim().toUpperCase() || "your vehicle";
  const when = formatSmsClock(appt.startTime) || appt.startTime || "your booked time";
  const price =
    extras.priceIncl != null
      ? catalog.round2(Number(extras.priceIncl) || 0)
      : resolveBookingSmsPriceIncl(appt);
  const priceBit = price > 0 ? ` Price ${formatSmsMoney(price)}.` : "";
  const address = business.smsAddress || `${business.street}, ${business.suburb} (next to BP station)`;
  return (
    `Hi ${name}, your vehicle ${plate} is booked in tomorrow at ${when}.` +
    `${priceBit} We are at ${address}. ` +
    `Reply YES to confirm or NO to reschedule. Deane Auto ${business.phoneTel}`
  );
}

module.exports = {
  formatSmsClock,
  formatSmsMoney,
  firstNameForSms,
  resolveBookingSmsPriceIncl,
  buildBookingConfirmSmsBody,
};
