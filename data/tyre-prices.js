const GST = 0.15;
const DEFAULT_TYREWISE_EX = 6.65;
const DEFAULT_SETTINGS = Object.freeze({
  markupPct: 40,
  fittingIncl: 30,
  includeTyrewise: true,
});
const PREMIUM = new Set([
  "goodyear", "continental", "bridgestone", "michelin", "pirelli", "dunlop",
  "hankook", "kumho", "falken", "yokohama", "toyo",
]);
const MID = new Set([
  "laufenn", "maxxis", "giti", "general tire", "petlas", "triangle", "nankang", "sailun",
  "linglong", "goodride", "westlake", "marshal", "gripmax", "cooper", "nexen",
]);
const TIERS = ["Budget", "Mid-range", "Premium"];
const PATTERN_NOISE = /^(ND|ASY|ASYM\w*|ASS?Y\w*|ASSIMETRICAL|NON|NITRO|\+|-|&)$/i;
const ROW_FIELDS = [
  "supplier", "category", "sku", "size", "brand", "pattern", "variant", "load_speed", "ply",
  "features", "oe_fitments", "cost_ex", "special", "usual_ex", "rrp_incl", "tyrewise_ex", "stock",
];

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSettings(input = {}) {
  const markup = num(input.markupPct);
  const fitting = num(input.fittingIncl);
  return {
    markupPct: markup !== null && markup >= 0 && markup <= 300 ? markup : DEFAULT_SETTINGS.markupPct,
    fittingIncl: fitting !== null && fitting >= 0 && fitting <= 500 ? fitting : DEFAULT_SETTINGS.fittingIncl,
    includeTyrewise:
      input.includeTyrewise === undefined ? DEFAULT_SETTINGS.includeTyrewise : Boolean(input.includeTyrewise),
  };
}

/** "2055516", "205 55 16", "205/55/r16" -> "205/55R16" */
function normalizeSizeQuery(value) {
  const s = String(value || "").toUpperCase().replace(/\s+/g, " ").trim();
  const digits = s.replace(/[^0-9]/g, "");
  let m = /^(\d{3})\D*(\d{2})\D*Z?R?F?\D*(\d{2})(C?)$/.exec(s.replace(/ /g, ""));
  if (m) return `${m[1]}/${m[2]}R${m[3]}${m[4]}`;
  if (/^\d{7}$/.test(digits)) return `${digits.slice(0, 3)}/${digits.slice(3, 5)}R${digits.slice(5)}`;
  return s.replace(/ /g, "");
}

function sizeCmp(size) {
  return String(size || "")
    .toUpperCase()
    .replace(/ZR/g, "R")
    .replace(/\s+/g, "")
    .replace(/(\d+\.\d+)/g, (m) => String(Number(m)));
}

function inStock(row) {
  const s = String(row?.stock ?? "").trim();
  return Boolean(s) && s !== "Out of stock" && !/^0\b/.test(s);
}

function tierOf(brand) {
  const b = String(brand || "").toLowerCase();
  if (PREMIUM.has(b)) return "Premium";
  if (MID.has(b)) return "Mid-range";
  return "Budget";
}

function nicePattern(pattern) {
  return String(pattern || "")
    .split(/\s+/)
    .filter((w) => w && !PATTERN_NOISE.test(w))
    .map((w) => (/^[A-Z]{4,}$/.test(w) ? w.charAt(0) + w.slice(1).toLowerCase() : w))
    .join(" ")
    .slice(0, 40);
}

/** Price basis is the normal (non-special) cost, so an ending special never undercuts. */
function baseCost(row) {
  return row.special && num(row.usual_ex) ? num(row.usual_ex) : num(row.cost_ex);
}

function sellPrice(row, settings) {
  const cost = baseCost(row);
  if (cost === null) return null;
  const fee = num(row.tyrewise_ex) ?? DEFAULT_TYREWISE_EX;
  const tyre = cost * (1 + settings.markupPct / 100) * (1 + GST);
  const tyrewise = settings.includeTyrewise ? fee * (1 + GST) : 0;
  return Math.ceil(tyre + settings.fittingIncl + tyrewise);
}

function websitePicks(rows, settings) {
  const usable = rows.filter((r) => num(r.cost_ex) && r.brand && r.brand !== "Other");
  const byTier = { Budget: [], "Mid-range": [], Premium: [] };
  for (const r of usable) byTier[tierOf(r.brand)].push(r);
  const pools = {
    Budget: [...byTier.Budget, ...byTier["Mid-range"]],
    "Mid-range": byTier["Mid-range"],
    Premium: byTier.Premium,
  };
  const picks = [];
  const used = new Set();
  let floor = 0;
  for (const tier of TIERS) {
    const cands = pools[tier].filter((r) => sellPrice(r, settings) > floor && !used.has(r.brand));
    if (!cands.length) continue;
    cands.sort((a, b) => Number(inStock(b)) - Number(inStock(a)) || sellPrice(a, settings) - sellPrice(b, settings));
    const pick = cands[0];
    floor = sellPrice(pick, settings);
    used.add(pick.brand);
    picks.push({ tier, row: pick, price: floor });
  }
  return picks;
}

function buildPublic(rows, settings, scrapedOn) {
  const groups = new Map();
  for (const r of rows) {
    if (!/^\d{3}\/\d{2}R\d{2}$/.test(r.size)) continue;
    if (!groups.has(r.size)) groups.set(r.size, []);
    groups.get(r.size).push(r);
  }
  const sizes = {};
  const keys = [...groups.keys()].sort((a, b) => {
    const [, aw, ap, ar] = /^(\d+)\/(\d+)R(\d+)$/.exec(a);
    const [, bw, bp, br] = /^(\d+)\/(\d+)R(\d+)$/.exec(b);
    return ar - br || aw - bw || ap - bp;
  });
  for (const size of keys) {
    const picks = websitePicks(groups.get(size), settings);
    if (!picks.length) continue;
    sizes[size] = picks.map(({ tier, row, price }) => ({
      tier,
      brand: row.brand,
      pattern: nicePattern(row.pattern),
      load: row.load_speed || "",
      price,
      inStock: inStock(row),
    }));
  }
  return {
    updated: scrapedOn,
    note: "Per tyre, fitted, incl. GST and Tyrewise fee",
    sizes,
  };
}

/** "205", "205/55r", "20555r" -> sizes that start with that width / profile / rim. */
function sizesByPrefix(rows, query, settings) {
  const digits = String(query || "").replace(/\D/g, "");
  if (digits.length < 3) return [];
  const noProfile = /^\s*\d{3}\s*R/i.test(String(query));
  const want = noProfile
    ? { w: digits.slice(0, 3), p: "", r: digits.slice(3, 5) }
    : { w: digits.slice(0, 3), p: digits.slice(3, 5), r: digits.slice(5, 7) };
  const groups = new Map();
  for (const r of rows) {
    const m =
      /^(\d{3})\/(\d{2})Z?R(\d{2}(?:\.5)?)C?$/.exec(r.size) || /^(\d{3})()R(\d{2})C?$/.exec(r.size);
    if (!m || m[1] !== want.w || !m[2].startsWith(want.p) || !m[3].startsWith(want.r)) continue;
    if (!groups.has(r.size)) groups.set(r.size, { size: r.size, rim: Number(m[3]), profile: Number(m[2]) || 0, rows: [] });
    groups.get(r.size).rows.push(r);
  }
  return [...groups.values()]
    .sort((a, b) => a.rim - b.rim || a.profile - b.profile || a.size.localeCompare(b.size))
    .map((g) => {
      const stocked = g.rows.filter(inStock);
      const prices = (stocked.length ? stocked : g.rows).map((r) => sellPrice(r, settings)).filter((n) => n);
      return {
        size: g.size,
        count: g.rows.length,
        inStock: stocked.length,
        fromPrice: prices.length ? Math.min(...prices) : null,
      };
    });
}

function searchBySize(rows, query, settings) {
  let size = normalizeSizeQuery(query);
  let matches = rows.filter((r) => sizeCmp(r.size) === sizeCmp(size));
  if (!matches.length) {
    const sizes = sizesByPrefix(rows, query, settings);
    if (sizes.length !== 1) return { size: String(query || "").trim(), rows: [], sizes };
    size = sizes[0].size;
    matches = rows.filter((r) => r.size === size);
  }
  const picks = new Map(websitePicks(matches, settings).map((p) => [p.row, p.tier]));
  const list = matches
    .map((r) => ({
      supplier: r.supplier,
      brand: r.brand,
      pattern: r.pattern,
      loadSpeed: r.load_speed || "",
      size: r.size,
      costEx: num(r.cost_ex),
      special: Boolean(r.special),
      usualEx: num(r.usual_ex),
      tyrewiseEx: num(r.tyrewise_ex),
      stock: String(r.stock ?? ""),
      inStock: inStock(r),
      sellPrice: sellPrice(r, settings),
      websiteTier: picks.get(r) || "",
      description: r.features || "",
    }))
    .sort((a, b) => Number(b.inStock) - Number(a.inStock) || (a.costEx ?? 1e9) - (b.costEx ?? 1e9));
  return { size, rows: list, sizes: [] };
}

function validateUpload(payload) {
  const sources = Array.isArray(payload?.sources) ? payload.sources : [];
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) {
    const err = new Error("That file has no tyre rows. Upload tyre-price-data.json from the price list folder.");
    err.status = 400;
    throw err;
  }
  const clean = [];
  for (const raw of rows) {
    const row = {};
    for (const field of ROW_FIELDS) row[field] = raw?.[field] ?? null;
    row.supplier = String(row.supplier || "").trim();
    row.size = String(row.size || "").trim();
    row.brand = String(row.brand || "").trim();
    row.cost_ex = num(row.cost_ex);
    row.usual_ex = num(row.usual_ex);
    row.tyrewise_ex = num(row.tyrewise_ex);
    row.rrp_incl = num(row.rrp_incl);
    row.special = Boolean(row.special);
    row.stock = row.stock === null ? "" : String(row.stock);
    if (!row.supplier || !row.size || row.cost_ex === null) continue;
    clean.push(row);
  }
  if (!clean.length) {
    const err = new Error("No usable tyre rows in that file.");
    err.status = 400;
    throw err;
  }
  const scrapedOn =
    String(payload?.scrapedOn || "").slice(0, 10) ||
    sources.map((s) => String(s?.scrapedOn || "")).sort().pop() ||
    new Date().toISOString().slice(0, 10);
  return {
    rows: clean,
    sources: sources.map((s) => ({
      supplier: String(s?.supplier || "").trim(),
      scrapedOn: String(s?.scrapedOn || "").slice(0, 10),
      count: Number(s?.count) || 0,
    })),
    scrapedOn,
  };
}

function csvCell(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(rows, settings) {
  const header = [
    "Size", "Brand", "Pattern", "Load / speed", "Supplier", "SKU", "Category",
    "Cost ex GST", "Special", "Usual cost ex GST", "Tyrewise ex GST", "Stock",
    "Sell price fitted incl GST", "Set of 4", "Supplier description",
  ];
  const sorted = [...rows].sort(
    (a, b) => sizeCmp(a.size).localeCompare(sizeCmp(b.size)) || (a.cost_ex ?? 0) - (b.cost_ex ?? 0)
  );
  const lines = [header.map(csvCell).join(",")];
  for (const r of sorted) {
    const price = sellPrice(r, settings);
    lines.push(
      [
        r.size, r.brand, r.pattern, r.load_speed, r.supplier, r.sku, r.category,
        r.cost_ex, r.special ? "SPECIAL" : "", r.usual_ex, r.tyrewise_ex, r.stock,
        price, price === null ? "" : price * 4, r.features,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

module.exports = {
  DEFAULT_SETTINGS,
  normalizeSettings,
  normalizeSizeQuery,
  sizeCmp,
  inStock,
  tierOf,
  sellPrice,
  websitePicks,
  buildPublic,
  searchBySize,
  validateUpload,
  exportCsv,
};
