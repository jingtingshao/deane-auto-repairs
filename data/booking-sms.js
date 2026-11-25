const business = require("./business");
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

function buildBookingConfirmSmsBody(appt = {}) {
  const name = firstNameForSms(appt.customerName);
  const plate = String(appt.registration || "").trim().toUpperCase() || "your vehicle";
  const when = formatSmsClock(appt.startTime) || appt.startTime || "your booked time";
  const address = business.smsAddress || `${business.street}, ${business.suburb} (Next to BP Petrol Station)`;
  return (
    `Hi ${name},\n` +
    `Your vehicle ${plate} is booked in tomorrow at ${when}.\n` +
    `We are at ${address}.\n` +
    `Reply YES to confirm or NO to reschedule.\n` +
    `Deane Auto ${business.phoneTel}`
  );
}

module.exports = {
  formatSmsClock,
  firstNameForSms,
  buildBookingConfirmSmsBody,
};
