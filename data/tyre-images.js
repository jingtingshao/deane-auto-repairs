/**
 * One picture per tyre model (brand + tread pattern) for the website tyre cards.
 * Supplier pictures are downloaded once and shrunk; a picture uploaded in Admin
 * always wins and is never replaced by a supplier download.
 */

const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { nicePattern } = require("./tyre-prices");

const PUBLIC_PREFIX = "/tyre-images/";
const FILE_RE = /^[a-f0-9]{20}\.webp$/;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const RETRY_FAILED_MS = 7 * 24 * 60 * 60 * 1000;
const SIZE_PX = 360;
// Plain product shots first; Wing pictures are often banners with text.
const SUPPLIER_ORDER = ["Value Tyres", "Blairs", "Tyremax", "Wing"];

function modelKey(brand, pattern) {
  return `${brand || ""}|${pattern || ""}`.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Every model shown on the website (curated cards and the Brand menu). */
function websiteModels(published) {
  const models = new Map();
  for (const group of [published?.sizes, published?.brands]) {
    for (const [size, cards] of Object.entries(group || {})) {
      for (const c of cards || []) {
        const key = modelKey(c.brand, c.pattern);
        if (!c.brand || !c.pattern) continue;
        if (!models.has(key)) models.set(key, { key, brand: c.brand, pattern: c.pattern, tier: c.tier, sizes: new Set() });
        models.get(key).sizes.add(size);
      }
    }
  }
  return [...models.values()].map((m) => ({ ...m, sizes: m.sizes.size }));
}

/** Supplier picture links per model, best supplier first. */
function supplierImageUrls(rows) {
  const byKey = new Map();
  for (const r of rows || []) {
    if (!r?.image || !r.brand) continue;
    const key = modelKey(r.brand, nicePattern(r.pattern));
    if (!byKey.has(key)) byKey.set(key, []);
    const list = byKey.get(key);
    if (!list.some((x) => x.url === r.image)) list.push({ url: r.image, supplier: r.supplier });
  }
  const rank = (s) => {
    const i = SUPPLIER_ORDER.indexOf(s);
    return i < 0 ? SUPPLIER_ORDER.length : i;
  };
  for (const list of byKey.values()) list.sort((a, b) => rank(a.supplier) - rank(b.supplier));
  return byKey;
}

function fileName(key) {
  return `${createHash("sha1").update(`${key}|${Date.now()}|${Math.random()}`).digest("hex").slice(0, 20)}.webp`;
}

function publicUrl(entry) {
  return entry?.file ? `${PUBLIC_PREFIX}${entry.file}` : null;
}

/** Square white-background WebP, small enough for a phone. */
async function toCardImage(sharp, buffer) {
  return sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({ width: SIZE_PX, height: SIZE_PX, fit: "contain", background: "#ffffff" })
    .flatten({ background: "#ffffff" })
    .webp({ quality: 80 })
    .toBuffer();
}

async function download(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Deane Auto Repairs tyre pictures)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = String(res.headers.get("content-type") || "");
  if (!type.startsWith("image/")) throw new Error(`not a picture (${type || "unknown type"})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD_BYTES) throw new Error("picture too large");
  if (buf.length < 1500) throw new Error("picture too small");
  return buf;
}

function createStore({ indexFile, dir, readJsonArray, writeJsonArray, sharp }) {
  fs.mkdirSync(dir, { recursive: true });

  const read = () => readJsonArray(indexFile, "tyre pictures").filter((e) => e?.key);
  const write = (rows) => writeJsonArray(indexFile, rows);
  const removeFile = (file) => {
    if (!file || !FILE_RE.test(file)) return;
    try {
      fs.unlinkSync(path.join(dir, file));
    } catch {
      /* already gone */
    }
  };

  function filePath(file) {
    return FILE_RE.test(String(file || "")) ? path.join(dir, file) : null;
  }

  function saveEntry(entry) {
    const rows = read();
    const i = rows.findIndex((e) => e.key === entry.key);
    if (i >= 0) {
      if (rows[i].file && rows[i].file !== entry.file) removeFile(rows[i].file);
      rows[i] = entry;
    } else {
      rows.push(entry);
    }
    write(rows);
    return entry;
  }

  async function saveManual({ brand, pattern, buffer, actor, now }) {
    if (!sharp) throw Object.assign(new Error("Picture tools are not available on this server."), { status: 500 });
    const key = modelKey(brand, pattern);
    if (!brand || !pattern) throw Object.assign(new Error("Missing brand or pattern."), { status: 400 });
    let out;
    try {
      out = await toCardImage(sharp, buffer);
    } catch {
      throw Object.assign(new Error("That file is not a picture we can read."), { status: 400 });
    }
    const file = fileName(key);
    fs.writeFileSync(path.join(dir, file), out);
    return saveEntry({ key, brand, pattern, file, source: "manual", from: "", by: actor || "", updatedAt: now });
  }

  /** Forget a model's picture so the next download uses the supplier picture again. */
  function clear(key) {
    const rows = read();
    const hit = rows.find((e) => e.key === key);
    if (!hit) return false;
    removeFile(hit.file);
    write(rows.filter((e) => e.key !== key));
    return true;
  }

  /**
   * Download supplier pictures for website models that have none yet.
   * Failed links are skipped for a week, then tried again.
   */
  async function downloadMissing({ published, rows, now, onlyKey = "", log = () => {} }) {
    if (!sharp) return { added: 0, failed: 0, noPicture: 0, skipped: "sharp not installed" };
    const urls = supplierImageUrls(rows);
    const have = new Map(read().map((e) => [e.key, e]));
    let added = 0;
    let failed = 0;
    let noPicture = 0;
    for (const m of websiteModels(published)) {
      if (onlyKey && m.key !== onlyKey) continue;
      const existing = have.get(m.key);
      if (existing?.file) continue;
      const links = urls.get(m.key) || [];
      const failedRecently = Date.now() - Date.parse(existing?.updatedAt || "") < RETRY_FAILED_MS;
      const skip = failedRecently ? existing?.failedUrls || [] : [];
      const candidates = links.filter((c) => !skip.includes(c.url));
      if (!candidates.length) {
        if (links.length) failed += 1;
        else noPicture += 1;
        continue;
      }
      let saved = false;
      const failedUrls = [...skip];
      for (const c of candidates) {
        try {
          const out = await toCardImage(sharp, await download(c.url));
          const file = fileName(m.key);
          fs.writeFileSync(path.join(dir, file), out);
          saveEntry({ key: m.key, brand: m.brand, pattern: m.pattern, file, source: "supplier", from: c.supplier, url: c.url, updatedAt: now });
          added += 1;
          saved = true;
          break;
        } catch (err) {
          failedUrls.push(c.url);
          log(`${m.brand} ${m.pattern}: ${c.supplier} picture failed (${err.message})`);
        }
      }
      if (!saved) {
        failed += 1;
        saveEntry({ key: m.key, brand: m.brand, pattern: m.pattern, file: "", source: "", failedUrls: failedUrls.slice(-6), updatedAt: now });
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return { added, failed, noPicture };
  }

  /** Website models with their picture state, for Admin. */
  function list({ published, rows, query = "", missingOnly = false, limit = 120 }) {
    const urls = supplierImageUrls(rows);
    const have = new Map(read().map((e) => [e.key, e]));
    const q = String(query || "").toLowerCase().trim();
    const all = websiteModels(published).map((m) => {
      const e = have.get(m.key);
      return {
        key: m.key,
        brand: m.brand,
        pattern: m.pattern,
        tier: m.tier,
        sizes: m.sizes,
        img: publicUrl(e),
        source: e?.file ? e.source : "",
        from: e?.from || "",
        supplierLinks: (urls.get(m.key) || []).length,
      };
    });
    const total = all.length;
    const withPicture = all.filter((m) => m.img).length;
    const manual = all.filter((m) => m.source === "manual").length;
    const filtered = all
      .filter((m) => (!missingOnly || !m.img) && (!q || `${m.brand} ${m.pattern}`.toLowerCase().includes(q)))
      .sort((a, b) => b.sizes - a.sizes || a.brand.localeCompare(b.brand) || a.pattern.localeCompare(b.pattern));
    return { total, withPicture, manual, matches: filtered.length, models: filtered.slice(0, limit) };
  }

  /** Add img to every website card that has a picture. */
  function attach(publicPrices) {
    const have = new Map(read().filter((e) => e.file).map((e) => [e.key, publicUrl(e)]));
    if (!have.size) return publicPrices;
    const mark = (group) => {
      const out = {};
      for (const [size, cards] of Object.entries(group || {})) {
        out[size] = cards.map((c) => {
          const img = have.get(modelKey(c.brand, c.pattern));
          return img ? { ...c, img } : c;
        });
      }
      return out;
    };
    return {
      ...publicPrices,
      sizes: mark(publicPrices?.sizes),
      ...(publicPrices?.brands ? { brands: mark(publicPrices.brands) } : {}),
    };
  }

  return { filePath, saveManual, clear, downloadMissing, list, attach };
}

module.exports = { PUBLIC_PREFIX, modelKey, websiteModels, supplierImageUrls, createStore };
