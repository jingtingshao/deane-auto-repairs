/** Quick checks for Google review kind + QR helpers. */
const assert = require("assert");
const {
  reviewKindForInvoice,
  reviewMessage,
  reviewPayloadForInvoice,
  reviewQrPngBuffer,
  googleReviewUrl,
} = require("../data/google-review");
const { buildBillingPdf } = require("../data/billing-pdf");

function check(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

check("wof preset → wof message", () => {
  assert.equal(reviewKindForInvoice({ preset: "wof", lines: [] }), "wof");
  assert.match(reviewMessage("wof"), /Thanks for visiting/);
});

check("standard / premium / combo → service", () => {
  assert.equal(reviewKindForInvoice({ preset: "standard" }), "service");
  assert.equal(reviewKindForInvoice({ preset: "premium_wof" }), "service");
  assert.match(reviewMessage("service"), /vehicle service/);
});

check("custom repair lines → repair", () => {
  assert.equal(
    reviewKindForInvoice({
      preset: "custom_invoice",
      lines: [{ description: "Replace front brake pads", qty: 1, unitPriceIncl: 120 }],
    }),
    "repair"
  );
  assert.match(reviewMessage("repair"), /quick Google review/);
});

check("custom wof-only lines → wof", () => {
  assert.equal(
    reviewKindForInvoice({
      preset: "custom_invoice",
      lines: [{ description: "WOF inspection", qty: 1, unitPriceIncl: 68.7 }],
    }),
    "wof"
  );
});

check("review URL configured", () => {
  assert.ok(googleReviewUrl(), "expected google review URL");
});

check("invoice payload includes CTA", () => {
  const payload = reviewPayloadForInvoice({
    kind: "invoice",
    preset: "wof",
    lines: [{ description: "WOF inspection", qty: 1, unitPriceIncl: 68.7 }],
  });
  assert.ok(payload);
  assert.equal(payload.kind, "wof");
  assert.ok(payload.url);
});

check("quotes get no review payload", () => {
  assert.equal(
    reviewPayloadForInvoice({ kind: "quote", preset: "custom", lines: [] }),
    null
  );
});

(async () => {
  await checkAsync("QR png buffer", async () => {
    const png = await reviewQrPngBuffer(googleReviewUrl(), 120);
    assert.ok(Buffer.isBuffer(png));
    assert.ok(png.length > 100);
    assert.equal(png[0], 0x89);
  });

  await checkAsync("invoice PDF includes review footer", async () => {
    const pdf = await buildBillingPdf({
      kind: "invoice",
      number: "INV-TEST-001",
      preset: "standard",
      customerName: "Test Customer",
      customerEmail: "test@example.com",
      registration: "ABC123",
      vehicle: "Toyota Corolla",
      lines: [{ description: "Standard Service (petrol)", qty: 1, unitPriceIncl: 173.04 }],
      notes: "",
    });
    assert.ok(Buffer.isBuffer(pdf));
    assert.ok(pdf.length > 1000);
    assert.equal(String(pdf.slice(0, 4)), "%PDF");
  });

  console.log("google-review checks passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
