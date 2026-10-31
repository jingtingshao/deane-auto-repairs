const GST = 0.15;
const DEFAULT_TYREWISE_EX = 6.65;
const DEFAULT_SETTINGS = Object.freeze({
  markupPct: 40,
  fittingIncl: 30,
  includeTyrewise: true,
});
// Tiers follow tyrehero.co.nz/brands (Oct 2026); anything not listed there is Budget
// unless noted. Giti, Petlas, Cooper, CST and Marshal are not on TyreHero.
const PREMIUM = new Set([
  "alliance", "bfgoodrich", "bridgestone", "continental", "dunlop", "goodyear", "michelin",
  "pirelli", "toyo", "vredestein", "yokohama", "z tyre",
]);
const MID = new Set([
  "amp", "atturo", "davanti", "falken", "general", "general tire", "gt radial", "hankook",
  "kenda", "kumho", "linglong", "maxxis", "minerva", "nexen", "nitto", "otani", "prinx",
  "triangle", "vitora",
  "giti", "petlas", "cooper", "cst", "marshal",
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

function nicePattern(pattern) {
  return String(pattern || "")
    .split(/\s+/)
    .filter((w) => w && !PATTERN_NOISE.test(w))
    .map((w) => (/^[A-Z]{4,}$/.test(w) ? w.charAt(0) + w.slice(1).toLowerCase() : w))
    .join(" ")
    .slice(0, 40);
}

/** How many distinct brands to show per tier on the website (stock preferred, then cheapest). */
const WEBSITE_BRANDS_PER_TIER = 3;

/**
 * Website cards: up to WEBSITE_BRANDS_PER_TIER brands per tier.
 * Budget / Mid-range / Premium all stay available even when a lower tier
 * is not cheaper — guests can still pick those brands from the Brand menu.
 */
function websitePicks(rows, settings) {
  const usable = rows.filter((r) => num(r.cost_ex) && r.brand && r.brand !== "Other");
  const picks = [];
  for (const tier of TIERS) {
    const cands = usable.filter((r) => tierOf(r.brand) === tier);
    if (!cands.length) continue;
    cands.sort(
      (a, b) => Number(inStock(b)) - Number(inStock(a)) || sellPrice(a, settings) - sellPrice(b, settings)
    );
    const seen = new Set();
    for (const row of cands) {
      const brandKey = String(row.brand).toLowerCase();
      if (seen.has(brandKey)) continue;
      seen.add(brandKey);
      picks.push({ tier, row, price: sellPrice(row, settings) });
      if (seen.size >= WEBSITE_BRANDS_PER_TIER) break;
    }
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
  const brands = {};
  const keys = [...groups.keys()].sort((a, b) => {
    const [, aw, ap, ar] = /^(\d+)\/(\d+)R(\d+)$/.exec(a);
    const [, bw, bp, br] = /^(\d+)\/(\d+)R(\d+)$/.exec(b);
    return ar - br || aw - bw || ap - bp;
  });
  const card = (tier, row, price) => ({
    tier,
    brand: row.brand,
    pattern: nicePattern(row.pattern),
    load: row.load_speed || "",
    price,
    inStock: inStock(row),
  });
  for (const size of keys) {
    // Brand filter always lists every brand for this size (including Budget options
    // that are not cheaper than Mid-range), so guests can still choose them.
    const byModel = new Map();
    for (const r of groups.get(size)) {
      if (!num(r.cost_ex) || !r.brand || r.brand === "Other") continue;
      const c = card(tierOf(r.brand), r, sellPrice(r, settings));
      const key = `${c.brand}|${c.pattern}|${c.load}`.toUpperCase();
      const prev = byModel.get(key);
      if (
        !prev ||
        c.price < prev.price ||
        (c.price === prev.price && c.inStock && !prev.inStock)
      ) {
        byModel.set(key, c);
      }
    }
    if (!byModel.size) continue;
    brands[size] = [...byModel.values()].sort(
      (a, b) => a.price - b.price || a.brand.localeCompare(b.brand) || a.pattern.localeCompare(b.pattern)
    );

    const picks = websitePicks(groups.get(size), settings);
    if (picks.length) {
      sizes[size] = picks.map(({ tier, row, price }) => card(tier, row, price));
    }
  }
  return {
    updated: scrapedOn,
    note: "Per tyre, fitted, incl. GST and Tyrewise fee",
    sizes,
    brands,
  };
}

const POPULAR_SIZES = [
  "175/65R14", "185/65R15", "195/65R15", "205/55R16", "205/65R16",
  "215/60R16", "215/55R17", "225/45R17", "225/65R17", "235/55R18",
];

/** Cheapest card and cheapest Premium card for each popular size that has a website price. */
function popularSizes(publicPrices, sizes = POPULAR_SIZES) {
  const out = [];
  for (const size of sizes) {
    const cards = (publicPrices?.sizes?.[size] || []).filter((c) => Number(c.price) > 0);
    if (!cards.length) continue;
    const byPrice = [...cards].sort((a, b) => a.price - b.price);
    const premium = byPrice.find((c) => c.tier === "Premium") || null;
    out.push({ size, from: byPrice[0], premium: premium === byPrice[0] ? null : premium });
  }
  return out;
}

function htmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Static table for /tyres/ so search engines can read fitted prices without running the finder. */
function popularSizesHtml(publicPrices, indent = "          ") {
  const rows = popularSizes(publicPrices);
  if (!rows.length) return "";
  const cell = (card, label) =>
    card
      ? `<td><strong>$${htmlText(card.price)}</strong> <span>${htmlText(label(card))}</span></td>`
      : `<td><span>—</span></td>`;
  const body = rows.map(
    ({ size, from, premium }) =>
      `${indent}      <tr><th scope="row"><a href="#tyre-prices" data-pick-tyre-size="${htmlText(size)}">${htmlText(size)}</a></th>` +
      `${cell(from, (c) => `${c.brand} · ${c.tier}`)}${cell(premium, (c) => c.brand)}</tr>`
  );
  const updated = /^\d{4}-\d{2}-\d{2}$/.test(String(publicPrices?.updated || ""))
    ? new Date(`${publicPrices.updated}T00:00:00Z`).toLocaleDateString("en-NZ", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
  return [
    `${indent}<div class="tyre-popular-wrap">`,
    `${indent}  <table class="tyre-popular-table">`,
    `${indent}    <thead><tr><th scope="col">Tyre size</th><th scope="col">Fitted from</th><th scope="col">Premium from</th></tr></thead>`,
    `${indent}    <tbody>`,
    ...body,
    `${indent}    </tbody>`,
    `${indent}  </table>`,
    `${indent}</div>`,
    `${indent}<p class="tyre-popular-note">Per tyre, fitted and balanced with a new valve, incl. GST and Tyrewise fee.` +
      `${updated ? ` Prices updated ${htmlText(updated)}.` : ""} Subject to stock.</p>`,
  ].join("\n");
}

const STOCK_NOISE = new Set([
  "ND", "ASY", "XL", "RF", "TL", "AS", "HT", "AT", "MT", "SUV", "TYRE", "TYRES", "NON",
  "DIRECTIONAL", "ASYMMETRIC", "ASYMMETRICAL", "PATTERN", "RUNFLAT",
]);

function stockTokens(text) {
  return new Set(
    String(text || "")
      .toUpperCase()
      .split(/[^A-Z0-9+]+/)
      .filter((t) => t.length >= 2 && !STOCK_NOISE.has(t) && !/^\d{2,3}[A-Z]?$/.test(t))
  );
}

/**
 * Workshop tyre stock (Admin → Stock, category Tyres, qty on hand > 0).
 * Returns (size, brand, pattern) => qty, matching size + brand + every tread-pattern word.
 */
function workshopTyreStock(items) {
  const { parseTyreName } = require("./tyre-suppliers");
  const list = [];
  for (const it of items || []) {
    if (it.category !== "tyre" || !(Number(it.qtyOnHand) > 0)) continue;
    const text = `${it.name || ""} ${it.partNumber || ""}`;
    const compact = /\b(\d{3})(\d{2})(\d{2})(C?)\b/i.exec(text);
    const size = parseTyreName(text)?.size || (compact ? `${compact[1]}/${compact[2]}R${compact[3]}${compact[4].toUpperCase()}` : null);
    if (!size) continue;
    list.push({
      size: sizeCmp(size),
      brand: String(it.brand || "").toUpperCase().replace(/\s+/g, ""),
      text: `${text} ${it.brand || ""}`.toUpperCase().replace(/\s+/g, ""),
      tokens: stockTokens(text),
      qty: Number(it.qtyOnHand),
    });
  }
  return (size, brand, pattern) => {
    const key = sizeCmp(size);
    const b = String(brand || "").toUpperCase().replace(/\s+/g, "");
    const want = stockTokens(pattern);
    let qty = 0;
    for (const s of list) {
      if (s.size !== key || !b || !(s.brand === b || s.text.includes(b))) continue;
      if (![...want].every((t) => s.tokens.has(t) || s.text.includes(t))) continue;
      qty += s.qty;
    }
    return qty;
  };
}

/** Public card availability: our own stock, supplier stock (next day), or order in. */
function withAvailability(publicPrices, stockFor) {
  const mark = (all) => {
    const out = {};
    for (const [size, options] of Object.entries(all || {})) {
      out[size] = options.map((o) => ({
        ...o,
        availability: stockFor(size, o.brand, o.pattern) > 0 ? "workshop" : o.inStock ? "supplier" : "order",
      }));
    }
    return out;
  };
  return {
    ...publicPrices,
    sizes: mark(publicPrices?.sizes),
    ...(publicPrices?.brands ? { brands: mark(publicPrices.brands) } : {}),
  };
}

/** Cheapest tyre in each tier for one size, preferring ones in stock. */
function cheapestPerTier(rows, settings) {
  const picks = new Set();
  for (const tier of TIERS) {
    const cands = rows.filter((r) => num(r.cost_ex) && r.brand && r.brand !== "Other" && tierOf(r.brand) === tier);
    if (!cands.length) continue;
    cands.sort((a, b) => Number(inStock(b)) - Number(inStock(a)) || sellPrice(a, settings) - sellPrice(b, settings));
    picks.add(cands[0]);
  }
  return picks;
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

function searchBySize(rows, query, settings, stockFor = () => 0) {
  let size = normalizeSizeQuery(query);
  let matches = rows.filter((r) => sizeCmp(r.size) === sizeCmp(size));
  if (!matches.length) {
    const sizes = sizesByPrefix(rows, query, settings);
    if (sizes.length !== 1) return { size: String(query || "").trim(), rows: [], sizes };
    size = sizes[0].size;
    matches = rows.filter((r) => r.size === size);
  }
  const picks = cheapestPerTier(matches, settings);
  const onWebsite = new Map(websitePicks(matches, settings).map((p) => [p.row, p.tier]));
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
      workshopQty: stockFor(r.size, r.brand, r.pattern),
      sellPrice: sellPrice(r, settings),
      tier: tierOf(r.brand),
      cheapestInTier: picks.has(r),
      onWebsite: onWebsite.has(r),
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

function rowKey(r) {
  return r.sku
    ? `${r.supplier}|${r.sku}`
    : `${r.supplier}|${r.size}|${r.brand}|${r.pattern}|${r.load_speed}`;
}

/** Supplier cost changes between two uploads, matched by supplier + SKU. */
function diffCosts(oldRows, newRows) {
  const before = new Map(oldRows.map((r) => [rowKey(r), r]));
  const after = new Map(newRows.map((r) => [rowKey(r), r]));
  const changed = [];
  for (const [key, r] of after) {
    const prev = before.get(key);
    if (!prev) continue;
    const oldCost = num(prev.cost_ex);
    const newCost = num(r.cost_ex);
    if (oldCost === null || newCost === null || Math.abs(oldCost - newCost) < 0.005) continue;
    changed.push({ row: r, oldCost, newCost });
  }
  changed.sort((a, b) => Math.abs(b.newCost - b.oldCost) - Math.abs(a.newCost - a.oldCost));
  return {
    changed,
    up: changed.filter((c) => c.newCost > c.oldCost).length,
    down: changed.filter((c) => c.newCost < c.oldCost).length,
    added: [...after.keys()].filter((k) => !before.has(k)).length,
    removed: [...before.keys()].filter((k) => !after.has(k)).length,
  };
}

function websiteCardKey(o) {
  return `${o?.tier || ""}|${o?.brand || ""}|${o?.pattern || ""}|${o?.load || ""}`.toLowerCase();
}

/** Website card changes per size (price, brand, or card added / removed). */
function diffWebsite(oldPublic, newPublic) {
  const changes = [];
  const sizes = new Set([...Object.keys(oldPublic.sizes || {}), ...Object.keys(newPublic.sizes || {})]);
  for (const size of sizes) {
    const before = new Map((oldPublic.sizes[size] || []).map((o) => [websiteCardKey(o), o]));
    const after = new Map((newPublic.sizes[size] || []).map((o) => [websiteCardKey(o), o]));
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const a = before.get(key);
      const b = after.get(key);
      if (a && b && a.price === b.price) continue;
      const sample = b || a;
      changes.push({ size, tier: sample.tier, before: a || null, after: b || null });
    }
  }
  const order = Object.keys(newPublic.sizes || {});
  changes.sort(
    (x, y) =>
      order.indexOf(x.size) - order.indexOf(y.size) ||
      TIERS.indexOf(x.tier) - TIERS.indexOf(y.tier) ||
      String(x.after?.brand || x.before?.brand || "").localeCompare(y.after?.brand || y.before?.brand || "")
  );
  return changes;
}

function costChangesCsv(changed) {
  const header = ["Size", "Brand", "Pattern", "Load / speed", "Supplier", "SKU", "Old cost ex GST", "New cost ex GST", "Change"];
  const lines = [header.map(csvCell).join(",")];
  for (const { row: r, oldCost, newCost } of changed) {
    lines.push(
      [r.size, r.brand, r.pattern, r.load_speed, r.supplier, r.sku, oldCost.toFixed(2), newCost.toFixed(2), (newCost - oldCost).toFixed(2)]
        .map(csvCell)
        .join(",")
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function csvCell(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(rows, settings) {
  const header = [
    "Size", "Brand", "Tier", "Pattern", "Load / speed", "Supplier", "SKU", "Category",
    "Cost ex GST", "Special", "Usual cost ex GST", "Tyrewise ex GST", "Stock",
    "Sell price fitted incl GST", "Supplier description",
  ];
  const sorted = [...rows].sort(
    (a, b) => sizeCmp(a.size).localeCompare(sizeCmp(b.size)) || (a.cost_ex ?? 0) - (b.cost_ex ?? 0)
  );
  const lines = [header.map(csvCell).join(",")];
  for (const r of sorted) {
    const price = sellPrice(r, settings);
    lines.push(
      [
        r.size, r.brand, tierOf(r.brand), r.pattern, r.load_speed, r.supplier, r.sku, r.category,
        r.cost_ex, r.special ? "SPECIAL" : "", r.usual_ex, r.tyrewise_ex, r.stock,
        price, r.features,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

module.exports = {
  DEFAULT_SETTINGS,
  WEBSITE_BRANDS_PER_TIER,
  TIERS,
  normalizeSettings,
  normalizeSizeQuery,
  sizeCmp,
  inStock,
  tierOf,
  sellPrice,
  websitePicks,
  buildPublic,
  popularSizes,
  popularSizesHtml,
  workshopTyreStock,
  withAvailability,
  searchBySize,
  validateUpload,
  exportCsv,
  diffCosts,
  diffWebsite,
  costChangesCsv,
};
