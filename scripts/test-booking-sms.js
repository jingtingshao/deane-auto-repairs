/**
 * Booking confirmation SMS body includes Hayr Road address, not a price.
 *   node scripts/test-booking-sms.js
 */
const assert = require("assert");
const bookingSms = require("../data/booking-sms");

assert.strictEqual(bookingSms.formatSmsClock("09:30"), "9:30am");
assert.strictEqual(bookingSms.formatSmsClock("14:00"), "2pm");

const body = bookingSms.buildBookingConfirmSmsBody({
  customerName: "John SMITH",
  registration: "abc123",
  startTime: "09:30",
  workSummary: "WOF",
});
assert.strictEqual(
  body,
  "Hi John,\n" +
    "Your vehicle ABC123 is booked in tomorrow at 9:30am.\n" +
    "We are at 63 Hayr Road, Mt Roskill (Next to BP Petrol Station).\n" +
    "Reply YES to confirm or NO to reschedule.\n" +
    "Deane Auto Repairs 08006256249"
);
assert.ok(!/Price \$/.test(body), "booking SMS should not include a price");

console.log("test-booking-sms: ok");
