/** Fixed-price packages aligned to the public website. Amounts are GST-inclusive. */

const GST_RATE = 0.15;
const QUOTE_VALID_DAYS = 7;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function lineTotal(line) {
  return round2((Number(line.qty) || 0) * (Number(line.unitPriceIncl) || 0));
}

function computeTotals(lines) {
  const totalIncl = round2((lines || []).reduce((sum, line) => sum + lineTotal(line), 0));
  const net = round2(totalIncl / (1 + GST_RATE));
  const gst = round2(totalIncl - net);
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
    lines: [{ description: "WOF inspection", qty: 1, unitPriceIncl: 79 }],
  },
  {
    id: "standard",
    kind: "invoice",
    label: "Standard $199",
    title: "Standard Service",
    lines: [{ description: "Standard Service (petrol)", qty: 1, unitPriceIncl: 199 }],
  },
  {
    id: "premium",
    kind: "invoice",
    label: "Premium $279",
    title: "Premium Service",
    lines: [{ description: "Premium Service (petrol)", qty: 1, unitPriceIncl: 279 }],
  },
  {
    id: "standard_wof",
    kind: "invoice",
    label: "Standard + WOF $278",
    title: "Standard Service + WOF",
    lines: [
      { description: "Standard Service (petrol)", qty: 1, unitPriceIncl: 199 },
      { description: "WOF inspection", qty: 1, unitPriceIncl: 79 },
    ],
  },
  {
    id: "premium_wof",
    kind: "invoice",
    label: "Premium + WOF $358",
    title: "Premium Service + WOF",
    lines: [
      { description: "Premium Service (petrol)", qty: 1, unitPriceIncl: 279 },
      { description: "WOF inspection", qty: 1, unitPriceIncl: 79 },
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
  { label: "+ WOF $79", description: "WOF inspection", qty: 1, unitPriceIncl: 79 },
  {
    label: "+ Standard $199",
    description: "Standard Service (petrol)",
    qty: 1,
    unitPriceIncl: 199,
  },
  {
    label: "+ Premium $279",
    description: "Premium Service (petrol)",
    qty: 1,
    unitPriceIncl: 279,
  },
  {
    label: "+ Labour $125/hr",
    description: "Workshop labour (per hour)",
    qty: 1,
    unitPriceIncl: 125,
  },
  {
    label: "+ Diagnostic $125/hr",
    description: "Diagnostic labour (per hour)",
    qty: 1,
    unitPriceIncl: 125,
  },
];

function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

module.exports = {
  GST_RATE,
  QUOTE_VALID_DAYS,
  PRESETS,
  QUICK_ADDS,
  round2,
  lineTotal,
  computeTotals,
  cloneLines,
  presetById,
};
