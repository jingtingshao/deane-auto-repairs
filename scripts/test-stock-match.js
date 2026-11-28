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

const oilLeftAlone = inventory.findMatch(items, {
  category: "engine_oil",
  name: "BAT Calcium",
  partNumber: "3224",
  supplier: "AA Battery Service",
});
assert.strictEqual(oilLeftAlone, null);

const oilSpelling = inventory.findMatch(items, {
  category: "engine_oil",
  name: "5W30",
  partNumber: "",
  supplier: "Penrite",
});
assert.strictEqual(oilSpelling, null);

const sameOil = inventory.findMatch(items, {
  category: "engine_oil",
  name: "Engine oil 5W-30",
  partNumber: "",
  supplier: "Penrite",
});
assert.strictEqual(sameOil && sameOil.id, "oil-5w30");

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

const shortInvoice = {
  id: "bat-short",
  category: "battery",
  name: "3224 BAT Calcium 1",
  partNumber: "",
  supplier: "AA",
  qtyOnHand: 1,
  notes: "",
  createdAt: "2026-11-28T00:00:00.000Z",
};
const short5344 = {
  id: "bat-5344-short",
  category: "battery",
  name: "5344 BAT Calcium DIN LN1 530 53 90 C 1",
  partNumber: "",
  supplier: "AA",
  qtyOnHand: 1,
  notes: "",
};
const catalog5344 = {
  id: "bat-5344",
  category: "battery",
  name: "AA 5344 Premium Calcium battery",
  partNumber: "5344",
  supplier: "AA Battery Service",
  qtyOnHand: 0,
  notes: "Consignment · AA RRP $352 incl",
};
const liveSplit = inventory.planSamePartMerge([battery, shortInvoice, catalog5344, short5344], []);
const live3224 = liveSplit.find((plan) => plan.keeperId === "bat-3224");
const live5344 = liveSplit.find((plan) => plan.keeperId === "bat-5344");
assert.ok(live3224);
assert.deepStrictEqual(live3224.dropIds, ["bat-short"]);
assert.strictEqual(live3224.qty, 1);
assert.ok(live5344);
assert.deepStrictEqual(live5344.dropIds, ["bat-5344-short"]);
assert.strictEqual(live5344.qty, 1);
assert.strictEqual(
  inventory.findMatch([battery], {
    category: "battery",
    name: "3224 BAT Calcium 1",
    partNumber: "",
    supplier: "AA",
  }).id,
  "bat-3224"
);

const oilCopy = { ...oil, id: "oil-copy", name: "5W30", partNumber: "5W30" };
const oilOriginal = { ...oil, partNumber: "5W30" };
assert.deepStrictEqual(inventory.planSamePartMerge([oilOriginal, oilCopy], []), []);

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

const jobs = require("../data/jobs");
const shelf = jobs.planShelfAlignment({ "bat-2134": 1 }, { "bat-2135": 1 });
assert.deepStrictEqual(shelf, [
  { itemId: "bat-2135", shelfDelta: 1 },
  { itemId: "bat-2134", shelfDelta: -1 },
]);
const followed = jobs.partsFollowInvoiceStock(
  [
    {
      id: "part-old",
      description: "AA 2135N Premium Calcium battery",
      partNumber: "2135N",
      qty: 1,
      stockItemId: "bat-2135",
      stockIssuedQty: 1,
    },
    { id: "labour", description: "Labour", qty: 1, stockItemId: "", stockIssuedQty: 0 },
  ],
  { "bat-2134": 1 },
  ["bat-2135"],
  { "bat-2134": { description: "AA 2134N Premium Calcium battery", partNumber: "2134N", supplier: "AA Battery Service" } }
);
assert.strictEqual(followed.changed, true);
assert.strictEqual(followed.parts.some((part) => part.stockItemId === "bat-2135"), false);
const added = followed.parts.find((part) => part.stockItemId === "bat-2134");
assert.ok(added);
assert.strictEqual(added.qty, 1);
assert.strictEqual(added.stockIssuedQty, 1);
assert.strictEqual(followed.parts.some((part) => part.id === "labour"), true);
const same = jobs.planShelfAlignment({ "bat-2134": 1 }, { "bat-2134": 1 });
assert.deepStrictEqual(same, []);

console.log("stock match ok");
