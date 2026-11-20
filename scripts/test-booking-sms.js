/**
 * Booking confirmation SMS body: price + Hayr Road address.
 *   node scripts/test-booking-sms.js
 */
const assert = require("assert");
const catalog = require("../data/catalog");
const bookingSms = require("../data/booking-sms");

assert.strictEqual(catalog.advertisedPriceFromWorkSummary("WOF"), 79);
assert.strictEqual(catalog.advertisedPriceFromWorkSummary("WOF inspection"), 79);
assert.strictEqual(catalog.advertisedPriceFromWorkSummary("Basic Service"), 99);
assert.strictEqual(catalog.advertisedPriceFromWorkSummary("Standard Service"), 199);
assert.strictEqual(catalog.advertisedPriceFromWorkSummary("Premium Service"), 299);
assert.strictEqual(catalog.advertisedPriceFromWorkSummary("European Service"), 299);
assert.strictEqual(catalog.advertisedPriceFromWorkSummary("Diesel / 4WD Service"), 299);
assert.strictEqual(catalog.advertisedPriceFromWorkSummary("Standard Service + WOF"), 278);
assert.strictEqual(catalog.advertisedPriceFromWorkSummary("Premium / European + WOF"), 378);
assert.strictEqual(catalog.advertisedPriceFromWorkSummary("Pre-purchase inspection"), 199);
assert.strictEqual(catalog.advertisedPriceFromWorkSummary("PPI"), 199);
assert.strictEqual(catalog.advertisedPriceFromWorkSummary("Service"), 0);
assert.strictEqual(catalog.advertisedPriceFromWorkSummary("Service + WOF"), 0);
assert.strictEqual(catalog.advertisedPriceFromWorkSummary("Brake noise"), 0);

assert.strictEqual(bookingSms.formatSmsClock("09:30"), "9:30am");
assert.strictEqual(bookingSms.formatSmsClock("14:00"), "2pm");
assert.strictEqual(bookingSms.formatSmsMoney(79), "$79");
assert.strictEqual(bookingSms.formatSmsMoney(79.5), "$79.50");

const wofBody = bookingSms.buildBookingConfirmSmsBody({
  customerName: "John SMITH",
  registration: "abc123",
  startTime: "09:30",
  workSummary: "WOF",
});
assert.strictEqual(
  wofBody,
  "Hi John, your vehicle ABC123 is booked in tomorrow at 9:30am. Price $79. We are at 63 Hayr Road, Mt Roskill (next to BP station). Reply YES to confirm or NO to reschedule. Deane Auto 08006259827"
);

const repairBody = bookingSms.buildBookingConfirmSmsBody({
  customerName: "Amy",
  registration: "XYZ999",
  startTime: "11:00",
  workSummary: "Brake noise",
});
assert.ok(!/Price \$/.test(repairBody), "unknown jobs should omit price");
assert.match(repairBody, /We are at 63 Hayr Road, Mt Roskill \(next to BP station\)\./);

const quotedBody = bookingSms.buildBookingConfirmSmsBody(
  {
    customerName: "Amy",
    registration: "XYZ999",
    startTime: "11:00",
    workSummary: "Brake noise",
    quotedPriceIncl: 0,
  },
  { priceIncl: 246.5 }
);
assert.match(quotedBody, /Price \$246\.50\./);

assert.strictEqual(
  bookingSms.resolveBookingSmsPriceIncl({ quotedPriceIncl: 199, workSummary: "WOF" }),
  199
);
assert.strictEqual(bookingSms.resolveBookingSmsPriceIncl({ workSummary: "WOF" }, 50), 79);
assert.strictEqual(bookingSms.resolveBookingSmsPriceIncl({ workSummary: "Repair" }, 246), 246);

console.log("test-booking-sms: ok");
