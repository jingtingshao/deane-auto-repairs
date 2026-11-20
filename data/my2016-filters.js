/** My2016 consignment filters.
 * Sheet buy prices are ex GST. Opening qty is 1 of each sort.
 * Retail is a flat sell (ex GST): air $50, cabin $55 — not the usual filter markup.
 */

const inventoryLib = require("./inventory");

const IMPORT_ID = "my2016-cabin-filters-2026-11";
const FLAT_SELL_IMPORT_ID = "my2016-filter-flat-sell-2026-11";
const SUPPLIER = "My2016";
const QTY = 1;
const BUY_EX = 14.8;
const CABIN_SELL = 55;
const AIR_SELL = 50;

const PARTS = [
  "C102",
  "C104",
  "C105",
  "C106",
  "C201",
  "C202",
  "C203",
  "C204",
  "C205",
  "C207",
  "C208",
  "C209",
  "C301",
  "C304",
  "C307",
  "C308",
  "C309",
  "C401",
  "C403",
  "C404",
  "C406",
  "C502",
  "C702",
];

function stockLine(part) {
  return {
    category: "cabin_filter",
    name: `${part} cabin filter`,
    partNumber: part,
    brand: "My2016",
    supplier: SUPPLIER,
    fitment: "Cabin filter",
    costPrice: BUY_EX,
    sellPrice: CABIN_SELL,
    qtyOnHand: QTY,
    notes: "Consignment",
  };
}

function samePart(item, part) {
  return String(item.partNumber || "").replace(/\s+/g, "").toUpperCase() === part.toUpperCase();
}

/** Add the filters to stock. A My2016 part already in stock keeps its qty; only prices and details are updated. */
function applyToStock(items, movements, now, newId) {
  const added = [];
  const updated = [];
  for (const part of PARTS) {
    const line = stockLine(part);
    const existing = items.find(
      (item) =>
        item.category === "cabin_filter" &&
        samePart(item, line.partNumber) &&
        String(item.supplier || "").trim().toLowerCase() === SUPPLIER.toLowerCase()
    );
    if (existing) {
      Object.assign(existing, { ...line, qtyOnHand: existing.qtyOnHand, updatedAt: now });
      updated.push(line.partNumber);
      continue;
    }
    const item = inventoryLib.normalizeItem({ ...line, id: newId(), createdAt: now, updatedAt: now });
    items.push(item);
    added.push(line.partNumber);
    if (item.qtyOnHand > 0) {
      movements.push({
        id: newId(),
        itemId: item.id,
        qtyDelta: item.qtyOnHand,
        qtyAfter: item.qtyOnHand,
        costPrice: item.costPrice,
        supplier: item.supplier,
        invoiceNo: "",
        supplierInvoiceId: "",
        candidateId: "",
        note: "Opening stock (consignment)",
        createdAt: now,
      });
    }
  }
  return { added, updated };
}

const AIR_IMPORT_ID = "my2016-air-filters-2026-11";

// [part, buy ex GST]
const AIR_PARTS = [
  ["S107", 9.85],
  ["S112", 13.3],
  ["S113", 13.3],
  ["S117", 16],
  ["S127", 16],
  ["S128", 16.8],
  ["S137", 15.05],
  ["S203", 13.3],
  ["S206", 10.7],
  ["S208", 12.5],
  ["S217", 12.45],
  ["S218", 15.05],
  ["S219", 14.2],
  ["S220", 13.3],
  ["S222", 15.05],
  ["S223", 15.05],
  ["S224", 14.2],
  ["S226", 10.7],
  ["S227", 17.65],
  ["S228", 14.2],
  ["S229", 16.8],
  ["S230", 15.05],
  ["S231", 16.8],
  ["S232", 14.2],
  ["S233", 16],
  ["S234", 15.05],
  ["S235", 16],
  ["S236", 17.65],
  ["S237", 22],
  ["S301", 7.25],
  ["S304", 13.3],
  ["S305", 15.05],
  ["S308", 15.05],
  ["S309", 17.65],
  ["S405", 13.3],
  ["S408", 15.05],
  ["S409", 13.3],
  ["S411", 16.8],
  ["S412", 16],
  ["S414", 17.65],
  ["S415", 16.8],
  ["S417", 15.05],
  ["S418", 16.8],
  ["S419", 26.5],
  ["S420", 14.2],
  ["S511", 16],
  ["S513", 16],
  ["S514", 16],
  ["S702", 13.3],
  ["S703", 15.05],
  ["S4001", 14.2],
  ["S4003", 15.05],
  ["S4004", 16],
  ["S4006", 16],
];

function airStockLine([part, buy]) {
  return {
    category: "air_filter",
    name: `${part} air filter`,
    partNumber: part,
    brand: "My2016",
    supplier: SUPPLIER,
    fitment: "Air filter",
    costPrice: buy,
    sellPrice: AIR_SELL,
    qtyOnHand: QTY,
    notes: "Consignment",
  };
}

/** Add the air filters to stock. A My2016 part already in stock keeps its qty; only prices and details are updated. */
function applyAirToStock(items, movements, now, newId) {
  const added = [];
  const updated = [];
  for (const row of AIR_PARTS) {
    const line = airStockLine(row);
    const existing = items.find(
      (item) =>
        item.category === "air_filter" &&
        samePart(item, line.partNumber) &&
        String(item.supplier || "").trim().toLowerCase() === SUPPLIER.toLowerCase()
    );
    if (existing) {
      Object.assign(existing, { ...line, qtyOnHand: existing.qtyOnHand, updatedAt: now });
      updated.push(line.partNumber);
      continue;
    }
    const item = inventoryLib.normalizeItem({ ...line, id: newId(), createdAt: now, updatedAt: now });
    items.push(item);
    added.push(line.partNumber);
    if (item.qtyOnHand > 0) {
      movements.push({
        id: newId(),
        itemId: item.id,
        qtyDelta: item.qtyOnHand,
        qtyAfter: item.qtyOnHand,
        costPrice: item.costPrice,
        supplier: item.supplier,
        invoiceNo: "",
        supplierInvoiceId: "",
        candidateId: "",
        note: "Opening stock (consignment)",
        createdAt: now,
      });
    }
  }
  return { added, updated };
}

function isMy2016(item) {
  return String(item?.supplier || "").trim().toLowerCase() === SUPPLIER.toLowerCase();
}

/** Flat retail for My2016 filters already in stock (runs after the general filter markup pass). */
function applyFlatSellPrices(items, _movements, now) {
  const updated = [];
  for (const item of items || []) {
    if (!isMy2016(item)) continue;
    let sell = null;
    if (item.category === "air_filter") sell = AIR_SELL;
    else if (item.category === "cabin_filter") sell = CABIN_SELL;
    if (sell == null || item.sellPrice === sell) continue;
    item.sellPrice = sell;
    item.updatedAt = now;
    updated.push(item.partNumber || item.name);
  }
  return { added: [], updated };
}

module.exports = {
  IMPORT_ID,
  FLAT_SELL_IMPORT_ID,
  PARTS,
  QTY,
  CABIN_SELL,
  AIR_SELL,
  stockLine,
  applyToStock,
  AIR_IMPORT_ID,
  AIR_PARTS,
  applyAirToStock,
  applyFlatSellPrices,
};
