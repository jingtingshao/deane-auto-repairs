/**
 * Same product with a different invoice name must join the existing stock line.
 *   node scripts/test-stock-match.js
 */
const assert = require("assert");
const inventory = require("../data/inventory");
const { detectSupplierProfile } = require("../data/supplier-profiles");

const battery = {
  id: "bat-3224",
  category: "battery",
  name: "AA 3224 Hybrid Auxiliary Calcium battery",
  partNumber: "3224",
  supplier: "AA Battery Service",
  qtyOnHand: 0,
  notes: "Consignment · AA RRP $326 incl",
  createdAt: "2026-11-01T00:00:00.000Z",
};
const oil = {
  id: "oil-5w30",
  category: "engine_oil",
  name: "Engine oil 5W-30",
  partNumber: "",
  supplier: "Penrite",
  qtyOnHand: 20,
  notes: "Consignment",
  createdAt: "2026-11-01T00:00:00.000Z",
};
const items = [battery, oil];

const fromInvoice = inventory.findMatch(items, {
  category: "battery",
  name: "BAT Calcium",
  partNumber: "3224",
  supplier: "AA Battery Service",
});
assert.strictEqual(fromInvoice && fromInvoice.id, "bat-3224");

const fromRawLine = inventory.findMatch(items, {
  category: "",
  name: "BAT Calcium",
  partNumber: "",
  supplier: "AA Battery Services Ltd",
  rawLineText: "3224 BAT Calcium 1 $135.59 $135.59",
});
assert.strictEqual(fromRawLine && fromRawLine.id, "bat-3224");

const genericOnly = inventory.findMatch(items, {
  category: "battery",
  name: "BAT Calcium",
  partNumber: "",
  supplier: "AA Battery Service",
});
assert.strictEqual(genericOnly, null);

const wrongCategory = inventory.findMatch(items, {
  category: "engine_oil",
  name: "BAT Calcium",
  partNumber: "3224",
  supplier: "AA Battery Service",
});
assert.strictEqual(wrongCategory && wrongCategory.id, "bat-3224");

const oilMatch = inventory.findMatch(items, {
  category: "engine_oil",
  name: "5W30",
  partNumber: "",
  supplier: "Penrite",
});
assert.strictEqual(oilMatch && oilMatch.id, "oil-5w30");

const otherOil = {
  ...oil,
  id: "oil-penrite",
  name: "Penrite HPR 5 5W-30",
};
const ambiguous = inventory.findMatch([oil, otherOil], {
  category: "engine_oil",
  name: "5W-30",
  supplier: "Penrite",
});
assert.strictEqual(ambiguous, null);

const tyreA = {
  id: "tyre-a",
  category: "tyre",
  name: "225/65R17 Mazzini",
  partNumber: "225/65R17",
  supplier: "Wing Tyre",
};
const tyreB = {
  id: "tyre-b",
  category: "tyre",
  name: "225/65R17 Nexen",
  partNumber: "225/65R17",
  supplier: "Wing Tyre",
};
assert.strictEqual(
  inventory.findMatch([tyreA, tyreB], {
    category: "tyre",
    name: "225/65R17 Nexen",
    partNumber: "225/65R17",
    supplier: "Wing Tyre",
  }).id,
  "tyre-b"
);

const received = inventory.applyReceive(
  items.map((row) => ({ ...row })),
  [],
  {
    id: "new-id",
    movementId: "mov-1",
    category: "battery",
    name: "BAT Calcium",
    partNumber: "3224",
    supplier: "AA Battery Service",
    qty: 1,
    costPrice: 135.59,
  },
  "2026-11-28T00:00:00.000Z"
);
assert.strictEqual(received.created, false);
assert.strictEqual(received.item.id, "bat-3224");
assert.strictEqual(received.item.name, battery.name);
assert.strictEqual(received.item.qtyOnHand, 1);

const duplicate = {
  id: "bat-new",
  category: "battery",
  name: "BAT Calcium",
  partNumber: "3224",
  supplier: "AA Battery Service",
  qtyOnHand: 1,
  notes: "",
  createdAt: "2026-11-28T00:00:00.000Z",
};
const namedOnly = {
  id: "bat-named",
  category: "battery",
  name: "3224 BAT Calcium",
  partNumber: "",
  supplier: "AA Battery Service",
  qtyOnHand: 1,
  notes: "",
  createdAt: "2026-11-28T00:00:00.000Z",
};
const plans = inventory.planSamePartMerge([battery, duplicate, namedOnly], []);
assert.strictEqual(plans.length, 1);
assert.strictEqual(plans[0].keeperId, "bat-3224");
assert.deepStrictEqual(plans[0].dropIds.sort(), ["bat-named", "bat-new"]);
assert.strictEqual(plans[0].qty, 2);

const aaText = [
  "AA Battery Services Ltd TEL: +64 (9) 636 7350",
  "MT WELLINGTON GST: 93 874 161",
  "Tax Invoice",
  "Date Invoice Number Delivery Docket No.",
  "24/11/2026 11:10 AM AABS-002756260 06349978",
  "Item Number Description Quantity Unit Price Amount",
  "2134N BAT Calcium BCI MINIFIT 400 38 65 C 1 $101.06 $101.06",
  "3224 BAT Calcium 1 $135.59 $135.59",
  "5344 BAT Calcium DIN LN1 530 53 90 C 1 $164.57 $164.57",
  "Total (Exc. GST) $401.22",
  "GST $60.18",
  "Total (Inc. GST)",
  "(NZD)",
  "$461.40",
].join("\n");
const profile = detectSupplierProfile(aaText);
assert.strictEqual(profile && profile.name, "AA Battery Service");
assert.strictEqual(profile.invoiceNo(aaText), "AABS-002756260");
assert.strictEqual(profile.invoiceDate(aaText), "24/11/2026");
assert.deepStrictEqual(profile.totals(aaText, aaText.split("\n")), {
  subtotal: 401.22,
  tax: 60.18,
  total: 461.4,
});
const lines = profile.lines(aaText.split("\n"));
assert.strictEqual(lines.length, 3);
const line3224 = lines.find((row) => row.partNumberCandidate === "3224");
assert.ok(line3224);
assert.strictEqual(line3224.descriptionCandidate, "AA 3224 Hybrid Auxiliary Calcium battery");
assert.strictEqual(line3224.qtyCandidate, 1);
assert.strictEqual(line3224.costPriceCandidate, 135.59);
assert.strictEqual(lines[0].partNumberCandidate, "2134N");
assert.strictEqual(lines[2].partNumberCandidate, "5344");

console.log("stock match ok");
