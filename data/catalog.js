/** Fixed-price packages aligned to the public website.
 * Advertised package prices ($79 / $199 / $279 / $125) are GST-inclusive.
 * Line unitPriceIncl fields are stored excl. GST.
 * GST on advertised packages uses IRD 3/23 of the inclusive amount so totals
 * match the website ($79, $125, $199, $279, $278, $358).
 */

const GST_RATE = 0.15;
const GST_FRACTION = 3 / 23;
const QUOTE_VALID_DAYS = 7;

const ADVERTISED_INCL = {
  wof: 79,
  standard: 199,
  premium: 279,
  labourHour: 125,
};

const ADVERTISED_INCL_LIST = Object.values(ADVERTISED_INCL);

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function gstFromIncl(incl) {
  return round2(Number(incl) * GST_FRACTION);
}

/** Convert an advertised GST-inclusive price to the excl. GST line amount. */
function exclFromIncl(incl) {
  const inclRounded = round2(incl);
  return round2(inclRounded - gstFromIncl(inclRounded));
}

const PRICE = {
  wof: exclFromIncl(ADVERTISED_INCL.wof),
  standard: exclFromIncl(ADVERTISED_INCL.standard),
  premium: exclFromIncl(ADVERTISED_INCL.premium),
  labourHour: exclFromIncl(ADVERTISED_INCL.labourHour),
};

function advertisedInclFromExcl(excl) {
  const n = Number(excl);
  if (!Number.isFinite(n) || n <= 0) return null;
  for (const incl of ADVERTISED_INCL_LIST) {
    const exact = incl / (1 + GST_RATE);
    if (Math.abs(n - exact) < 0.0005 || round2(n) === round2(exact)) return incl;
  }
  return null;
}

function lineAmounts(line) {
  const qty = Number(line?.qty) || 0;
  const unit = Number(line?.unitPriceIncl) || 0;
  const advertised = advertisedInclFromExcl(unit);
  if (advertised != null) {
    const totalIncl = round2(qty * advertised);
    const gst = gstFromIncl(totalIncl);
    const net = round2(totalIncl - gst);
    return { net, gst, totalIncl };
  }
  const net = round2(qty * unit);
  const totalIncl = round2(net * (1 + GST_RATE));
  const gst = round2(totalIncl - net);
  return { net, gst, totalIncl };
}

function lineTotal(line) {
  return lineAmounts(line).net;
}

function computeTotals(lines) {
  let net = 0;
  let gst = 0;
  let totalIncl = 0;
  for (const line of lines || []) {
    const amounts = lineAmounts(line);
    net = round2(net + amounts.net);
    gst = round2(gst + amounts.gst);
    totalIncl = round2(totalIncl + amounts.totalIncl);
  }
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

function lineLooksLikeWof(description) {
  return /\bwof\b/i.test(String(description || "").trim());
}

module.exports = {
  GST_RATE,
  GST_FRACTION,
  QUOTE_VALID_DAYS,
  ADVERTISED_INCL,
  PRICE,
  PRESETS,
  QUICK_ADDS,
  round2,
  gstFromIncl,
  exclFromIncl,
  advertisedInclFromExcl,
  lineAmounts,
  lineTotal,
  computeTotals,
  cloneLines,
  presetById,
  lineLooksLikeWof,
};
