/** Fixed-price packages aligned to the public website.
 * Advertised package prices ($79 / $199 / $279 / $125) are GST-inclusive on the website.
 * Quote/invoice line amounts are stored and shown excl. GST; GST is added on the total.
 */

const GST_RATE = 0.15;
const QUOTE_VALID_DAYS = 7;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Convert an advertised GST-inclusive package price to the excl. GST line amount. */
function exclFromIncl(incl) {
  return round2(Number(incl) / (1 + GST_RATE));
}

const PRICE = {
  wof: exclFromIncl(79), // 68.70
  standard: exclFromIncl(199), // 173.04
  premium: exclFromIncl(279), // 242.61
  labourHour: exclFromIncl(125), // 108.70
};

function lineTotal(line) {
  return round2((Number(line.qty) || 0) * (Number(line.unitPriceIncl) || 0));
}

/** Line unitPriceIncl fields hold excl. GST amounts. Totals add GST on top. */
function computeTotals(lines) {
  const net = round2((lines || []).reduce((sum, line) => sum + lineTotal(line), 0));
  const gst = round2(net * GST_RATE);
  const totalIncl = round2(net + gst);
  return { totalIncl, net, gst, gstRate: GST_RATE };
}

function cloneLines(lines) {
  return (lines || []).map((line) => ({
    description: line.description,
    qty: line.qty,
    unitPriceIncl: line.unitPriceIncl,
  }));
}

const PRESETS = [
  {
    id: "wof",
    kind: "invoice",
    label: "WOF $79",
    title: "WOF inspection",
    lines: [{ description: "WOF inspection", qty: 1, unitPriceIncl: PRICE.wof }],
  },
  {
    id: "standard",
    kind: "invoice",
    label: "Standard $199",
    title: "Standard Service",
    lines: [
      { description: "Standard Service (petrol)", qty: 1, unitPriceIncl: PRICE.standard },
    ],
  },
  {
    id: "premium",
    kind: "invoice",
    label: "Premium $279",
    title: "Premium Service",
    lines: [
      { description: "Premium Service (petrol)", qty: 1, unitPriceIncl: PRICE.premium },
    ],
  },
  {
    id: "standard_wof",
    kind: "invoice",
    label: "Standard + WOF $278",
    title: "Standard Service + WOF",
    lines: [
      { description: "Standard Service (petrol)", qty: 1, unitPriceIncl: PRICE.standard },
      { description: "WOF inspection", qty: 1, unitPriceIncl: PRICE.wof },
    ],
  },
  {
    id: "premium_wof",
    kind: "invoice",
    label: "Premium + WOF $358",
    title: "Premium Service + WOF",
    lines: [
      { description: "Premium Service (petrol)", qty: 1, unitPriceIncl: PRICE.premium },
      { description: "WOF inspection", qty: 1, unitPriceIncl: PRICE.wof },
    ],
  },
  {
    id: "custom",
    kind: "quote",
    label: "Custom repair quote",
    title: "Repair quote",
    lines: [{ description: "", qty: 1, unitPriceIncl: 0 }],
  },
];

const QUICK_ADDS = [
  {
    label: "+ WOF $79",
    description: "WOF inspection",
    qty: 1,
    unitPriceIncl: PRICE.wof,
  },
  {
    label: "+ Standard $199",
    description: "Standard Service (petrol)",
    qty: 1,
    unitPriceIncl: PRICE.standard,
  },
  {
    label: "+ Premium $279",
    description: "Premium Service (petrol)",
    qty: 1,
    unitPriceIncl: PRICE.premium,
  },
  {
    label: "+ Labour $125/hr",
    description: "Workshop labour (per hour)",
    qty: 1,
    unitPriceIncl: PRICE.labourHour,
  },
];

function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

module.exports = {
  GST_RATE,
  QUOTE_VALID_DAYS,
  PRICE,
  PRESETS,
  QUICK_ADDS,
  round2,
  exclFromIncl,
  lineTotal,
  computeTotals,
  cloneLines,
  presetById,
};
