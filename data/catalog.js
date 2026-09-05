/** Fixed-price packages aligned to the public website.
 * Advertised package prices ($79 / $99 / $199 / $279 / $125) are GST-inclusive.
 * Line unitPriceIncl fields are stored excl. GST.
 * GST on advertised packages uses IRD 3/23 of the inclusive amount so totals
 * match the website ($79, $99, $125, $199, $279, $278, $358).
 */

const GST_RATE = 0.15;
const GST_FRACTION = 3 / 23;
const QUOTE_VALID_DAYS = 7;

const ADVERTISED_INCL = {
  wof: 79,
  basic: 99,
  standard: 199,
  premium: 279,
  labourHour: 125,
};

const ADVERTISED_INCL_LIST = Object.values(ADVERTISED_INCL);

function toCents(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100 + Number.EPSILON);
}

function fromCents(cents) {
  return Math.round(Number(cents) || 0) / 100;
}

function round2(n) {
  return fromCents(toCents(n));
}

function gstFromInclCents(inclCents) {
  return Math.round((Number(inclCents) || 0) * GST_FRACTION);
}

function gstFromIncl(incl) {
  return fromCents(gstFromInclCents(toCents(incl)));
}

/** Convert an advertised GST-inclusive price to the excl. GST line amount. */
function exclFromIncl(incl) {
  const inclCents = toCents(incl);
  return fromCents(inclCents - gstFromInclCents(inclCents));
}

const PRICE = {
  wof: exclFromIncl(ADVERTISED_INCL.wof),
  basic: exclFromIncl(ADVERTISED_INCL.basic),
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
    const totalInclCents = Math.round(qty * advertised * 100);
    const gstCents = gstFromInclCents(totalInclCents);
    const netCents = totalInclCents - gstCents;
    return {
      net: fromCents(netCents),
      gst: fromCents(gstCents),
      totalIncl: fromCents(totalInclCents),
    };
  }
  const netCents = Math.round(qty * toCents(unit));
  const totalInclCents = Math.round(netCents * (1 + GST_RATE));
  const gstCents = totalInclCents - netCents;
  return {
    net: fromCents(netCents),
    gst: fromCents(gstCents),
    totalIncl: fromCents(totalInclCents),
  };
}

function lineTotal(line) {
  return lineAmounts(line).net;
}

function computeTotals(lines) {
  let netCents = 0;
  let gstCents = 0;
  let totalInclCents = 0;
  for (const line of lines || []) {
    const amounts = lineAmounts(line);
    netCents += toCents(amounts.net);
    gstCents += toCents(amounts.gst);
    totalInclCents += toCents(amounts.totalIncl);
  }
  return {
    totalIncl: fromCents(totalInclCents),
    net: fromCents(netCents),
    gst: fromCents(gstCents),
    gstRate: GST_RATE,
  };
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
    id: "basic",
    kind: "invoice",
    label: "Basic $99",
    title: "Basic Service",
    lines: [
      { description: "Basic Service (petrol)", qty: 1, unitPriceIncl: PRICE.basic },
    ],
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
    label: "Premium / European $279",
    title: "Premium Service",
    lines: [
      { description: "Premium Service (petrol / European)", qty: 1, unitPriceIncl: PRICE.premium },
    ],
  },
  {
    id: "diesel",
    kind: "invoice",
    label: "Diesel $279",
    title: "Diesel Service",
    lines: [
      { description: "Diesel Service", qty: 1, unitPriceIncl: PRICE.premium },
    ],
  },
  {
    id: "ppi",
    kind: "invoice",
    label: "PPI $199",
    title: "Pre-purchase inspection",
    lines: [
      { description: "Pre-purchase inspection", qty: 1, unitPriceIncl: PRICE.standard },
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
  {
    id: "custom_invoice",
    kind: "invoice",
    label: "Custom invoice",
    title: "Tax invoice",
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
    label: "+ Basic $99",
    description: "Basic Service (petrol)",
    qty: 1,
    unitPriceIncl: PRICE.basic,
  },
  {
    label: "+ Standard $199",
    description: "Standard Service (petrol)",
    qty: 1,
    unitPriceIncl: PRICE.standard,
  },
  {
    label: "+ Premium / European $279",
    description: "Premium Service (petrol / European)",
    qty: 1,
    unitPriceIncl: PRICE.premium,
  },
  {
    label: "+ Diesel $279",
    description: "Diesel Service",
    qty: 1,
    unitPriceIncl: PRICE.premium,
  },
  {
    label: "+ PPI $199",
    description: "Pre-purchase inspection",
    qty: 1,
    unitPriceIncl: PRICE.standard,
  },
  {
    label: "+ Labour $125/hr",
    description: "Workshop labour (per hour)",
    qty: 1,
    unitPriceIncl: PRICE.labourHour,
  },
  {
    id: "consumable",
    label: "+ Consumable",
    description: "Consumable",
    qty: 1,
    unitPriceIncl: 5,
  },
];

function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

function lineLooksLikeWof(description) {
  return /\bwof\b/i.test(String(description || "").trim());
}

function lineLooksLikeService(description) {
  const d = String(description || "").trim();
  return /\bservice\b/i.test(d) || /pre-purchase inspection/i.test(d);
}

/** Fixed website packages (Standard / Premium / Full Service) — not labour or parts. */
function lineLooksLikePackageService(description) {
  return (
    /(basic|standard|premium|full|diesel|european)\s+service/i.test(String(description || "").trim()) ||
    /pre-purchase inspection/i.test(String(description || "").trim())
  );
}

function lineLooksLikeConsumable(description) {
  return /\bconsumables?\b/i.test(String(description || "").trim());
}

function lineExcludedFromConsumableBase(description) {
  return (
    lineLooksLikeWof(description) ||
    lineLooksLikePackageService(description) ||
    lineLooksLikeConsumable(description)
  );
}

/**
 * Default consumable charge (excl. GST) from repair lines excl. WOF / service packages.
 * $0–100 → $5; $101–300 → $10; $301–500 → $15; over $500 → $20.
 */
function consumableDefaultExcl(repairExclTotal) {
  const n = Number(repairExclTotal) || 0;
  if (n <= 100) return 5;
  if (n <= 300) return 10;
  if (n <= 500) return 15;
  return 20;
}

function repairExclForConsumable(lines) {
  let totalCents = 0;
  for (const line of lines || []) {
    if (lineExcludedFromConsumableBase(line?.description)) continue;
    totalCents += toCents(lineAmounts(line).net);
  }
  return fromCents(totalCents);
}

function capitalizeLineDescription(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const lower = text.toLocaleLowerCase("en-NZ");
  return lower.charAt(0).toLocaleUpperCase("en-NZ") + lower.slice(1);
}

module.exports = {
  GST_RATE,
  GST_FRACTION,
  QUOTE_VALID_DAYS,
  ADVERTISED_INCL,
  PRICE,
  PRESETS,
  QUICK_ADDS,
  toCents,
  fromCents,
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
  lineLooksLikeService,
  lineLooksLikePackageService,
  lineLooksLikeConsumable,
  lineExcludedFromConsumableBase,
  consumableDefaultExcl,
  repairExclForConsumable,
  capitalizeLineDescription,
};
