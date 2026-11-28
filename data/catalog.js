/** Fixed-price packages aligned to the public website.
 * Advertised package prices ($79 / $99 / $199 / $299 / $125) are GST-inclusive.
 * Line unitPriceIncl fields are stored excl. GST.
 * GST on advertised packages uses IRD 3/23 of the inclusive amount so totals
 * match the website ($79, $99, $125, $199, $299, $278, $378).
 * Invoice WOF can run a temporary special without changing the website price.
 */

const GST_RATE = 0.15;
const GST_FRACTION = 3 / 23;
const QUOTE_VALID_DAYS = 7;

/** Regular website / after-special invoice price. */
const WOF_REGULAR_INCL = 79;
/** Current invoice special — same end as the website WOF SPECIAL popup. */
const WOF_SPECIAL_INCL = 49;
const WOF_SPECIAL_UNTIL = "2027-01-01T00:00:00+13:00";

function wofSpecialActive(now = Date.now()) {
  return now < new Date(WOF_SPECIAL_UNTIL).getTime();
}

/** Incl. GST WOF used on new invoices / quotes. Website stays on WOF_REGULAR_INCL. */
function invoiceWofIncl(now = Date.now()) {
  return wofSpecialActive(now) ? WOF_SPECIAL_INCL : WOF_REGULAR_INCL;
}

const ADVERTISED_INCL = {
  wof: WOF_REGULAR_INCL,
  basic: 99,
  standard: 199,
  premium: 299,
  diesel: 299,
  european: 299,
  labourHour: 125,
};

/** Older / special totals still recognised so past invoices keep exact GST figures. */
const LEGACY_ADVERTISED_INCL = [49, 248, 278, 279, 348, 378];

const ADVERTISED_INCL_LIST = [...new Set([...Object.values(ADVERTISED_INCL), ...LEGACY_ADVERTISED_INCL])];

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

function invoiceWofExcl(now = Date.now()) {
  return exclFromIncl(invoiceWofIncl(now));
}

const PRICE = {
  get wof() {
    return invoiceWofExcl();
  },
  basic: exclFromIncl(ADVERTISED_INCL.basic),
  standard: exclFromIncl(ADVERTISED_INCL.standard),
  premium: exclFromIncl(ADVERTISED_INCL.premium),
  diesel: exclFromIncl(ADVERTISED_INCL.diesel),
  european: exclFromIncl(ADVERTISED_INCL.european),
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

/** Stock retail set incl GST (e.g. a $288 battery) is kept ex GST to the cent; recover the whole-dollar price. */
function wholeDollarInclFromExcl(excl) {
  const incl = (Number(excl) || 0) * (1 + GST_RATE);
  const dollars = Math.round(incl);
  return dollars > 0 && Math.abs(incl - dollars) < 0.01 ? dollars : 0;
}

/** Invoice line price fields for a stock sell price (ex GST). */
function stockLinePrice(sellExcl) {
  const incl = wholeDollarInclFromExcl(sellExcl);
  return incl
    ? { unitPriceIncl: exclFromIncl(incl), gstInclUnit: incl }
    : { unitPriceIncl: round2(Math.max(0, Number(sellExcl) || 0)), gstInclUnit: 0 };
}

const TYRE_STEWARDSHIP_EXCL = 6.65;

/**
 * The stock sell price already includes the Tyrewise fee.
 * Split it into the tyre line and a $6.65 ex GST stewardship line so the invoice total stays the same.
 */
function tyreSaleSplit(sellExcl) {
  const priced = stockLinePrice(sellExcl);
  const feeIncl = round2(TYRE_STEWARDSHIP_EXCL * (1 + GST_RATE));
  const fee = { unitPriceIncl: exclFromIncl(feeIncl), gstInclUnit: feeIncl };
  if (priced.gstInclUnit > feeIncl) {
    const tyreIncl = round2(priced.gstInclUnit - feeIncl);
    return {
      tyre: { unitPriceIncl: exclFromIncl(tyreIncl), gstInclUnit: tyreIncl },
      fee,
    };
  }
  return {
    tyre: {
      unitPriceIncl: round2(Math.max(0, Number(priced.unitPriceIncl) - TYRE_STEWARDSHIP_EXCL)),
      gstInclUnit: 0,
    },
    fee: { unitPriceIncl: TYRE_STEWARDSHIP_EXCL, gstInclUnit: 0 },
  };
}

function lineAmounts(line) {
  const qty = Number(line?.qty) || 0;
  const inclUnit = round2(Number(line?.gstInclUnit) || 0);
  if (inclUnit > 0) {
    const totalInclCents = Math.round(qty * toCents(inclUnit));
    const gstCents = gstFromInclCents(totalInclCents);
    const netCents = totalInclCents - gstCents;
    return {
      net: fromCents(netCents),
      gst: fromCents(gstCents),
      totalIncl: fromCents(totalInclCents),
    };
  }
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

/** Unit price including GST. A typed inclusive price stays on that amount. */
function unitPriceGstIncl(line) {
  const stored = round2(Number(line?.gstInclUnit) || 0);
  if (stored > 0) return stored;
  const qty = Number(line?.qty) || 0;
  if (!(qty > 0)) return 0;
  const totalInclCents = toCents(lineAmounts(line).totalIncl);
  return fromCents(Math.round(totalInclCents / qty));
}

/** GST-inclusive discount $, capped at the lines total. */
function normalizeDiscountIncl(value, maxIncl = Infinity) {
  const n = round2(Math.abs(Number(value) || 0));
  const max = round2(Math.max(0, Number(maxIncl) || 0));
  if (!(n > 0)) return 0;
  if (!(max > 0)) return 0;
  return n > max ? max : n;
}

function normalizeDiscountNote(note) {
  return String(note || "").trim().slice(0, 120);
}

/**
 * Line totals, then optional GST-inclusive discount.
 * Discount reduces the inclusive total; GST is re-split with IRD 3/23.
 */
function computeTotals(lines, discountIncl = 0) {
  let netCents = 0;
  let gstCents = 0;
  let totalInclCents = 0;
  for (const line of lines || []) {
    const amounts = lineAmounts(line);
    netCents += toCents(amounts.net);
    gstCents += toCents(amounts.gst);
    totalInclCents += toCents(amounts.totalIncl);
  }
  const linesNet = fromCents(netCents);
  const linesGst = fromCents(gstCents);
  const linesTotalIncl = fromCents(totalInclCents);
  const discount = normalizeDiscountIncl(discountIncl, linesTotalIncl);
  if (!(discount > 0)) {
    return {
      totalIncl: linesTotalIncl,
      net: linesNet,
      gst: linesGst,
      gstRate: GST_RATE,
      discountIncl: 0,
      discountNet: 0,
      discountGst: 0,
      linesNet,
      linesGst,
      linesTotalIncl,
    };
  }
  const discountCents = toCents(discount);
  const discountGstCents = gstFromInclCents(discountCents);
  const discountNetCents = discountCents - discountGstCents;
  const newTotalInclCents = totalInclCents - discountCents;
  const newGstCents = gstFromInclCents(newTotalInclCents);
  const newNetCents = newTotalInclCents - newGstCents;
  return {
    totalIncl: fromCents(newTotalInclCents),
    net: fromCents(newNetCents),
    gst: fromCents(newGstCents),
    gstRate: GST_RATE,
    discountIncl: discount,
    discountNet: fromCents(discountNetCents),
    discountGst: fromCents(discountGstCents),
    linesNet,
    linesGst,
    linesTotalIncl,
  };
}

function computeDocTotals(doc) {
  return computeTotals(doc?.lines || [], doc?.discountIncl);
}

function cloneLines(lines) {
  return (lines || []).map((line) => ({
    description: line.description,
    qty: line.qty,
    unitPriceIncl: line.unitPriceIncl,
    gstInclUnit: round2(Number(line.gstInclUnit) || 0),
  }));
}

function buildPresets(now = Date.now()) {
  const wofIncl = invoiceWofIncl(now);
  const wofExcl = invoiceWofExcl(now);
  const wofLabel = wofSpecialActive(now) ? `WOF $${wofIncl} special` : `WOF $${wofIncl}`;
  const withWof = (serviceIncl) => serviceIncl + wofIncl;
  return [
    {
      id: "wof",
      kind: "invoice",
      label: wofLabel,
      title: "WOF inspection",
      lines: [{ description: "WOF inspection", qty: 1, unitPriceIncl: wofExcl }],
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
      label: "Premium / European $299",
      title: "Premium / European Service",
      lines: [
        { description: "Premium / European Service", qty: 1, unitPriceIncl: PRICE.premium },
      ],
    },
    {
      id: "diesel",
      kind: "invoice",
      label: "Diesel / 4WD $299",
      title: "Diesel / 4WD Service",
      lines: [
        { description: "Diesel / 4WD Service", qty: 1, unitPriceIncl: PRICE.diesel },
      ],
    },
    {
      id: "european",
      kind: "invoice",
      label: "European $299",
      title: "European Service",
      lines: [
        { description: "European Service", qty: 1, unitPriceIncl: PRICE.european },
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
      label: `Standard + WOF $${withWof(ADVERTISED_INCL.standard)}`,
      title: "Standard Service + WOF",
      lines: [
        { description: "Standard Service (petrol)", qty: 1, unitPriceIncl: PRICE.standard },
        { description: "WOF inspection", qty: 1, unitPriceIncl: wofExcl },
      ],
    },
    {
      id: "premium_wof",
      kind: "invoice",
      label: `Premium / European + WOF $${withWof(ADVERTISED_INCL.premium)}`,
      title: "Premium / European Service + WOF",
      lines: [
        { description: "Premium / European Service", qty: 1, unitPriceIncl: PRICE.premium },
        { description: "WOF inspection", qty: 1, unitPriceIncl: wofExcl },
      ],
    },
    {
      id: "diesel_wof",
      kind: "invoice",
      label: `Diesel / 4WD + WOF $${withWof(ADVERTISED_INCL.diesel)}`,
      title: "Diesel / 4WD Service + WOF",
      lines: [
        { description: "Diesel / 4WD Service", qty: 1, unitPriceIncl: PRICE.diesel },
        { description: "WOF inspection", qty: 1, unitPriceIncl: wofExcl },
      ],
    },
    {
      id: "european_wof",
      kind: "invoice",
      label: `European + WOF $${withWof(ADVERTISED_INCL.european)}`,
      title: "European Service + WOF",
      lines: [
        { description: "European Service", qty: 1, unitPriceIncl: PRICE.european },
        { description: "WOF inspection", qty: 1, unitPriceIncl: wofExcl },
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
      label: "Other repair (blank)",
      title: "Tax invoice",
      lines: [{ description: "", qty: 1, unitPriceIncl: 0 }],
    },
  ];
}

function buildQuickAdds(now = Date.now()) {
  const wofIncl = invoiceWofIncl(now);
  const wofExcl = invoiceWofExcl(now);
  const wofQuick = wofSpecialActive(now) ? `+ WOF $${wofIncl} special` : `+ WOF $${wofIncl}`;
  return [
  {
    id: "blank",
    label: "+ Other repair (blank)",
    description: "",
    qty: 1,
    unitPriceIncl: 0,
  },
  {
    id: "wof",
    label: wofQuick,
    description: "WOF inspection",
    qty: 1,
    unitPriceIncl: wofExcl,
    gstInclUnit: wofIncl,
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
    label: "+ Premium / European $299",
    description: "Premium / European Service",
    qty: 1,
    unitPriceIncl: PRICE.premium,
  },
  {
    label: "+ Diesel / 4WD $299",
    description: "Diesel / 4WD Service",
    qty: 1,
    unitPriceIncl: PRICE.diesel,
  },
  {
    label: "+ European $299",
    description: "European Service",
    qty: 1,
    unitPriceIncl: PRICE.european,
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
    id: "tyre_stewardship",
    label: "+ Tyre stewardship $6.65",
    description: "Tyre stewardship fee",
    qty: 1,
    unitPriceIncl: exclFromIncl(round2(TYRE_STEWARDSHIP_EXCL * (1 + GST_RATE))),
    gstInclUnit: round2(TYRE_STEWARDSHIP_EXCL * (1 + GST_RATE)),
  },
  {
    id: "consumable",
    label: "+ Consumable",
    description: "Consumable",
    qty: 1,
    unitPriceIncl: 5,
  },
  ];
}

function presetById(id) {
  return buildPresets().find((p) => p.id === id) || null;
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

/** Customer invoice lines like 205/60R16 or 185R14C — not the stewardship fee itself. */
function lineLooksLikeTyreSize(description) {
  const text = String(description || "").trim();
  if (!text || /stewardship/i.test(text)) return false;
  return (
    /\b\d{3}\s*\/\s*\d{2}\s*(?:[Rr]\s*\/?\s*|-)?\s*\d{2}[Cc]?\b/.test(text) ||
    /\b\d{3}\s*[Rr]\s*\d{2}[Cc]?\b/.test(text)
  );
}

function tyreStewardshipFeeLine(qty = 1) {
  const feeIncl = round2(TYRE_STEWARDSHIP_EXCL * (1 + GST_RATE));
  return {
    description: "Tyre stewardship fee",
    qty: Number(qty) > 0 ? Number(qty) : 1,
    unitPriceIncl: exclFromIncl(feeIncl),
    gstInclUnit: feeIncl,
  };
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
  WOF_REGULAR_INCL,
  WOF_SPECIAL_INCL,
  WOF_SPECIAL_UNTIL,
  wofSpecialActive,
  invoiceWofIncl,
  invoiceWofExcl,
  ADVERTISED_INCL,
  PRICE,
  get PRESETS() {
    return buildPresets();
  },
  get QUICK_ADDS() {
    return buildQuickAdds();
  },
  buildPresets,
  buildQuickAdds,
  toCents,
  fromCents,
  round2,
  gstFromIncl,
  exclFromIncl,
  advertisedInclFromExcl,
  wholeDollarInclFromExcl,
  stockLinePrice,
  TYRE_STEWARDSHIP_EXCL,
  tyreSaleSplit,
  lineAmounts,
  lineTotal,
  unitPriceGstIncl,
  normalizeDiscountIncl,
  normalizeDiscountNote,
  computeTotals,
  computeDocTotals,
  cloneLines,
  presetById,
  lineLooksLikeWof,
  lineLooksLikeService,
  lineLooksLikePackageService,
  lineLooksLikeConsumable,
  lineLooksLikeTyreSize,
  tyreStewardshipFeeLine,
  lineExcludedFromConsumableBase,
  consumableDefaultExcl,
  repairExclForConsumable,
  capitalizeLineDescription,
};
