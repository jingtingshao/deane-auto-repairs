/** Workshop stock and the sell-price bands used on quotes.
 * Cost and sell prices are excl. GST, same as quote lines.
 * A cost that lands on a band edge stays in the lower band ($10 uses $0–$10).
 */

const CATEGORIES = [
  { id: "oil_filter", label: "Oil filters", unit: "each", group: "parts" },
  { id: "air_filter", label: "Air filters", unit: "each", group: "parts" },
  { id: "cabin_filter", label: "Cabin filters", unit: "each", group: "parts" },
  { id: "spark_plug", label: "Spark plugs", unit: "each", group: "parts" },
  { id: "brake_pad", label: "Brake pads", unit: "each", group: "parts" },
  { id: "wiper_blade", label: "Wiper blades", unit: "each", group: "parts" },
  { id: "battery", label: "Batteries", unit: "each", group: "parts" },
  { id: "belt", label: "Belts", unit: "each", group: "parts" },
  { id: "bulb", label: "Bulbs", unit: "each", group: "parts" },
  { id: "tyre", label: "Tyres", unit: "each", group: "parts" },
  { id: "engine_oil", label: "Engine oil", unit: "litre", group: "fluids" },
  { id: "coolant", label: "Coolant", unit: "litre", group: "fluids" },
  { id: "brake_fluid", label: "Brake fluid", unit: "litre", group: "fluids" },
  { id: "atf", label: "ATF", unit: "litre", group: "fluids" },
  { id: "power_steering", label: "Power steering fluid", unit: "litre", group: "fluids" },
  { id: "adblue", label: "AdBlue", unit: "litre", group: "fluids" },
];

const BANDS = [
  { max: 10, minPct: 100, maxPct: 150, label: "$0–$10" },
  { max: 25, minPct: 100, maxPct: 120, label: "$10–$25" },
  { max: 50, minPct: 80, maxPct: 100, label: "$25–$50" },
  { max: 100, minPct: 60, maxPct: 80, label: "$50–$100" },
  { max: 250, minPct: 50, maxPct: 60, label: "$100–$250" },
  { max: 500, minPct: 40, maxPct: 50, label: "$250–$500" },
  { max: null, minPct: 25, maxPct: 40, label: "$500+" },
];

const GST_RATE = 0.15;

const GUESS_RULES = [
  ["adblue", "adblue"],
  ["ad blue", "adblue"],
  ["power steering", "power_steering"],
  ["brake fluid", "brake_fluid"],
  ["dot 4", "brake_fluid"],
  ["dot4", "brake_fluid"],
  ["dot 3", "brake_fluid"],
  ["atf", "atf"],
  ["transmission fluid", "atf"],
  ["coolant", "coolant"],
  ["antifreeze", "coolant"],
  ["engine oil", "engine_oil"],
  ["5w-30", "engine_oil"],
  ["5w30", "engine_oil"],
  ["5w-40", "engine_oil"],
  ["10w-40", "engine_oil"],
  ["10w40", "engine_oil"],
  ["0w-20", "engine_oil"],
  ["0w20", "engine_oil"],
  ["15w-40", "engine_oil"],
  ["cabin filter", "cabin_filter"],
  ["pollen filter", "cabin_filter"],
  ["air filter", "air_filter"],
  ["oil filter", "oil_filter"],
  ["spark plug", "spark_plug"],
  ["brake pad", "brake_pad"],
  ["disc pad", "brake_pad"],
  ["wiper", "wiper_blade"],
  ["battery", "battery"],
  ["belt", "belt"],
  ["bulb", "bulb"],
  ["globe", "bulb"],
  ["tyre", "tyre"],
  ["tire", "tyre"],
];

function stockError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function roundQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function categoryById(id) {
  return CATEGORIES.find((row) => row.id === id) || null;
}

function bandFor(cost) {
  const c = roundMoney(cost);
  for (const band of BANDS) {
    if (band.max == null || c <= band.max) return band;
  }
  return BANDS[BANDS.length - 1];
}

function suggestPrice(cost) {
  const c = roundMoney(Math.max(0, Number(cost) || 0));
  const band = bandFor(c);
  const sellMin = c > 0 ? roundMoney(c * (1 + band.minPct / 100)) : 0;
  const sellMax = c > 0 ? roundMoney(c * (1 + band.maxPct / 100)) : 0;
  return {
    cost: c,
    band: band.label,
    markupMin: band.minPct,
    markupMax: band.maxPct,
    sellMin,
    sellMax,
    sell: sellMin,
    sellMinIncl: roundMoney(sellMin * (1 + GST_RATE)),
    sellMaxIncl: roundMoney(sellMax * (1 + GST_RATE)),
    sellIncl: roundMoney(sellMin * (1 + GST_RATE)),
  };
}

function guessCategory(text) {
  const hay = String(text || "").toLowerCase();
  for (const [needle, id] of GUESS_RULES) {
    if (hay.includes(needle)) return id;
  }
  if (/\b\d{3}\s*\/\s*\d{2}\s*r\s*\d{2}\b/i.test(hay) || /\b\d{3}\s*r\s*\d{2}\s*c?\b/i.test(hay)) return "tyre";
  return "";
}

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function normalizeItem(raw) {
  const category = categoryById(raw?.category);
  const costPrice = roundMoney(Math.max(0, Number(raw?.costPrice) || 0));
  const suggested = suggestPrice(costPrice);
  const sellRaw = raw?.sellPrice;
  const sellPrice =
    sellRaw == null || sellRaw === ""
      ? suggested.sell
      : roundMoney(Math.max(0, Number(sellRaw) || 0));
  return {
    id: cleanText(raw?.id, 80),
    category: category ? category.id : "",
    name: cleanText(raw?.name, 160),
    partNumber: cleanText(raw?.partNumber, 80),
    brand: cleanText(raw?.brand, 80),
    supplier: cleanText(raw?.supplier, 120),
    fitment: cleanText(raw?.fitment, 240),
    unit: category ? category.unit : "each",
    qtyOnHand: Math.max(0, roundQty(raw?.qtyOnHand)),
    costPrice,
    sellPrice,
    notes: cleanText(raw?.notes, 400),
    createdAt: cleanText(raw?.createdAt, 40),
    updatedAt: cleanText(raw?.updatedAt, 40),
  };
}

function presentItem(item) {
  const category = categoryById(item.category);
  return {
    ...item,
    categoryLabel: category ? category.label : "",
    unit: category ? category.unit : item.unit || "each",
    price: suggestPrice(item.costPrice),
  };
}

function partKey(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function nameKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function findMatch(items, input) {
  const category = input.category;
  const key = partKey(input.partNumber);
  const name = nameKey(input.name);
  if (key) {
    const hits = items.filter((row) => {
      if (row.category !== category || partKey(row.partNumber) !== key) return false;
      if (name && nameKey(row.name) !== name) return false;
      return true;
    });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      const supplier = nameKey(input.supplier);
      return hits.find((row) => nameKey(row.supplier) === supplier) || hits[0];
    }
    return null;
  }
  const supplier = nameKey(input.supplier);
  if (!name) return null;
  return (
    items.find(
      (row) =>
        row.category === category &&
        nameKey(row.name) === name &&
        nameKey(row.supplier) === supplier
    ) || null
  );
}

function assertItem(item) {
  if (!categoryById(item.category)) throw stockError("Choose a category.");
  if (!item.name) throw stockError("Enter a part name.");
  if (!(item.costPrice >= 0)) throw stockError("Enter a cost price.");
}

function searchItems(items, query, category) {
  const cat = String(category || "").trim();
  let rows = items.filter((row) => row.category && row.name);
  if (cat) rows = rows.filter((row) => row.category === cat);
  const q = String(query || "").trim().toLowerCase();
  if (!q) {
    return rows.sort((a, b) => a.name.localeCompare(b.name) || a.partNumber.localeCompare(b.partNumber));
  }
  const terms = q.split(/\s+/).filter(Boolean);
  const qFlat = q.replace(/\s+/g, "");
  const scored = [];
  for (const item of rows) {
    const label = categoryById(item.category)?.label || "";
    const hay = [item.name, item.partNumber, item.brand, item.supplier, item.fitment, item.notes, label]
      .join(" ")
      .toLowerCase();
    if (!terms.every((term) => hay.includes(term))) continue;
    const pn = partKey(item.partNumber).toLowerCase();
    let score = 0;
    if (pn && pn === qFlat) score += 100;
    else if (pn && pn.includes(qFlat)) score += 40;
    if (item.name.toLowerCase().includes(q)) score += 20;
    if (String(item.fitment || "").toLowerCase().includes(q)) score += 15;
    if (label.toLowerCase().includes(q)) score += 5;
    scored.push({ item, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)
  );
  return scored.map((row) => row.item);
}

function applyReceive(items, movements, input, now) {
  const guessed = guessCategory(`${input?.name || ""} ${input?.partNumber || ""} ${input?.notes || ""}`);
  const draft = normalizeItem({
    ...input,
    category: input?.category || guessed,
    qtyOnHand: 0,
  });
  assertItem(draft);
  const qty = roundQty(input?.qty);
  if (!(qty > 0)) throw stockError("Enter a quantity greater than 0.");
  const candidateId = cleanText(input?.candidateId, 80);
  const priorReceipt = liveInvoiceReceipt(items, movements, input);
  if (priorReceipt) {
    return {
      item: priorReceipt.item,
      created: false,
      already: true,
      movement: priorReceipt.movement,
    };
  }
  let item = findMatch(items, draft);
  let created = false;
  if (!item) {
    created = true;
    item = {
      ...draft,
      id: cleanText(input?.id, 80),
      qtyOnHand: 0,
      createdAt: now,
    };
    if (!item.id) throw stockError("Could not create this stock line.");
    items.push(item);
  }
  item.name = draft.name || item.name;
  item.partNumber = draft.partNumber || item.partNumber;
  item.brand = draft.brand || item.brand;
  item.supplier = draft.supplier || item.supplier;
  if (draft.fitment) item.fitment = draft.fitment;
  item.costPrice = draft.costPrice;
  if (input?.sellPrice != null && input.sellPrice !== "") item.sellPrice = draft.sellPrice;
  else if (created) item.sellPrice = draft.sellPrice;
  item.unit = categoryById(item.category)?.unit || item.unit;
  item.qtyOnHand = roundQty(item.qtyOnHand + qty);
  item.updatedAt = now;
  const movement = {
    id: cleanText(input?.movementId, 80),
    itemId: item.id,
    qtyDelta: qty,
    qtyAfter: item.qtyOnHand,
    costPrice: item.costPrice,
    supplier: item.supplier,
    invoiceNo: cleanText(input?.invoiceNo, 80),
    supplierInvoiceId: cleanText(input?.supplierInvoiceId, 80),
    candidateId,
    note: cleanText(input?.note, 160) || "Received",
    createdAt: now,
  };
  return { item, created, already: false, movement };
}

function liveInvoiceReceipt(items, movements, input) {
  const candidateId = cleanText(input?.candidateId, 80);
  const invoiceId = cleanText(input?.supplierInvoiceId, 80);
  const part = partKey(input?.partNumber);
  const name = nameKey(input?.name);
  const live = new Map((items || []).map((row) => [row.id, row]));
  for (const movement of movements || []) {
    const item = live.get(movement.itemId);
    if (!item) continue;
    if (candidateId && String(movement.candidateId || "") === candidateId) {
      const itemPart = partKey(item.partNumber);
      const itemName = nameKey(item.name);
      const samePart = !part || itemPart === part;
      const sameName = !name || itemName === name;
      if (samePart && sameName) return { item, movement };
      continue;
    }
    if (!invoiceId || String(movement.supplierInvoiceId || "") !== invoiceId) continue;
    const itemPart = partKey(item.partNumber);
    const itemName = nameKey(item.name);
    if (part && itemPart === part && (!name || itemName === name)) return { item, movement };
    if (!part && !itemPart && name && itemName === name) return { item, movement };
  }
  return null;
}

function stockedCandidateIdSet(candidates, items, movements) {
  const live = new Map((items || []).map((row) => [row.id, row]));
  const receipts = [];
  for (const movement of movements || []) {
    const item = live.get(movement.itemId);
    if (!item) continue;
    receipts.push({
      candidateId: String(movement.candidateId || "").trim(),
      invoiceId: String(movement.supplierInvoiceId || "").trim(),
      part: partKey(item.partNumber),
      name: nameKey(item.name),
    });
  }
  const ids = new Set();
  for (const row of candidates || []) {
    const invoiceId = String(row.supplierInvoiceId || "").trim();
    const part = partKey(row.partNumberCandidate);
    const name = nameKey(row.descriptionCandidate);
    const hit = receipts.some((receipt) => {
      const samePart = Boolean(part) && receipt.part === part && receipt.name === name;
      const sameBlankPart = !part && !receipt.part && Boolean(name) && receipt.name === name;
      if (!samePart && !sameBlankPart) return false;
      if (receipt.candidateId && receipt.candidateId === row.id) return true;
      return Boolean(receipt.invoiceId) && receipt.invoiceId === invoiceId;
    });
    if (hit) ids.add(row.id);
  }
  return ids;
}

function findByPartNumber(items, partNumber, supplier) {
  const key = partKey(partNumber);
  if (!key) return null;
  const hits = (items || []).filter((row) => partKey(row.partNumber) === key);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    const supplierKey = nameKey(supplier);
    return hits.find((row) => nameKey(row.supplier) === supplierKey) || null;
  }
  return null;
}

/** Lines ignored or marked as tools stay off the shelf. */
function lineCountsAsStock(decision) {
  const value = String(decision || "pending");
  return value !== "rejected" && value !== "tool";
}

/**
 * Receive supplier-invoice lines into stock.
 * The same candidate is only added once, so saving the invoice again does not double the qty.
 */
function receiveSupplierInvoice(items, movements, invoice, candidates, now, newId) {
  const added = [];
  const already = [];
  const skipped = [];
  const overrides = new Map(
    (invoice?.lines || []).map((row) => [String(row.id || ""), row])
  );
  for (const line of candidates || []) {
    const id = String(line?.id || "");
    const decision = String(line?.decision || "pending");
    const override = overrides.get(id) || {};
    const name = String(override.name || line?.descriptionCandidate || "").trim();
    const partNumber = String(override.partNumber || line?.partNumberCandidate || "").trim();
    if (!lineCountsAsStock(decision)) continue;
    const qty = roundQty(override.qty != null ? override.qty : line?.qtyCandidate);
    if (!name || !(qty > 0)) {
      skipped.push({ id, name: name || partNumber || "Line", reason: "Missing part name or qty" });
      continue;
    }
    const supplier = String(invoice?.supplier || line?.supplierCandidate || "").trim();
    const category =
      guessCategory(`${name} ${partNumber}`) ||
      findByPartNumber(items, partNumber, supplier)?.category ||
      "";
    if (!category) {
      skipped.push({ id, name, reason: "Category not recognised" });
      continue;
    }
    let result;
    try {
      result = applyReceive(
        items,
        movements,
        {
          id: newId(),
          movementId: newId(),
          category,
          name,
          partNumber,
          supplier,
          qty,
          costPrice: override.costPrice != null ? override.costPrice : line?.costPriceCandidate,
          candidateId: id,
          supplierInvoiceId: String(invoice?.id || ""),
          invoiceNo: String(invoice?.invoiceNo || ""),
          note: invoice?.invoiceNo ? `Invoice ${invoice.invoiceNo}` : "Supplier invoice",
        },
        now
      );
    } catch (err) {
      skipped.push({ id, name, reason: err.message || "Could not add to stock" });
      continue;
    }
    if (result.already) {
      already.push({ id, name: result.item?.name || name });
      continue;
    }
    if (result.movement) movements.push(result.movement);
    added.push({
      id,
      name: result.item?.name || name,
      qty,
      created: result.created,
    });
  }
  return { added, already, skipped };
}

function applyAdjust(item, input, now) {
  const delta = roundQty(input?.qtyDelta);
  if (!delta) throw stockError("Enter a quantity change.");
  const next = roundQty(item.qtyOnHand + delta);
  if (next < 0) {
    const onHand = item.unit === "litre" ? `${item.qtyOnHand} L` : String(item.qtyOnHand);
    throw stockError(`Only ${onHand} on hand.`);
  }
  item.qtyOnHand = next;
  item.updatedAt = now;
  return {
    id: cleanText(input?.movementId, 80),
    itemId: item.id,
    qtyDelta: delta,
    qtyAfter: item.qtyOnHand,
    costPrice: item.costPrice,
    supplier: item.supplier,
    invoiceNo: "",
    supplierInvoiceId: "",
    candidateId: "",
    note: cleanText(input?.note, 160) || (delta < 0 ? "Used" : "Added"),
    createdAt: now,
  };
}

module.exports = {
  CATEGORIES,
  BANDS,
  GST_RATE,
  stockError,
  roundMoney,
  categoryById,
  suggestPrice,
  guessCategory,
  normalizeItem,
  presentItem,
  searchItems,
  applyReceive,
  stockedCandidateIdSet,
  applyAdjust,
  lineCountsAsStock,
  receiveSupplierInvoice,
};
