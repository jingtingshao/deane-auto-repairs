/** Vitora consignment tyres from Tyremax (order of 8 Nov 2026, 4 of each).
 * Buy = Tyremax trade special price on 8 Nov 2026, ex GST; stewardship $6.65 ex GST on top.
 * Retail = website fitted price that day (special cost × 1.15 × markup + stewardship × 1.15 + $30 fitting) less fitting, incl GST.
 */

const inventoryLib = require("./inventory");
const catalog = require("./catalog");

// "b": website prices now follow the special cost; re-running only updates prices, qty stays.
const IMPORT_ID = "vitora-consignment-2026-11b";
const SUPPLIER = "Tyremax";
const STEWARDSHIP_EX = 6.65;
const FITTING_INCL = 30;

// [Tyremax code, size, pattern, load / speed, tyre buy ex GST, website fitted price incl GST, qty]
const TYRES = [
  ["1328V", "175/65R14", "Citylife", "82H", 44.5, 110, 4],
  ["20189", "175/65R15", "Citylife", "84H", 53.9, 125, 4],
  ["2033V", "185/65R15", "Sportlife", "88H", 52.9, 123, 4],
  ["2141", "195/65R15", "Sportlife", "91V", 53.9, 125, 4],
  ["4610", "205/55R16", "Sportlife", "94W", 55.9, 128, 4],
  ["6644V", "215/50R17", "Sportlife", "95W", 75.7, 160, 4],
  ["6662V", "225/45R17", "Sportlife", "94W", 72.9, 156, 4],
  ["66755", "225/65R17", "Streetlife", "102H", 93.9, 189, 4],
  ["701270", "265/65R17", "Trail Life", "112Q", 188.9, 310, 4],
  ["7012", "225/40R18", "Sportlife", "92W", 71.9, 154, 4],
  ["7028V", "225/55R18", "Highlife", "98V", 90.9, 184, 4],
  ["2055", "195R15C", "Worklife", "106/104R", 79.9, 167, 4],
];

function stockLine([code, size, pattern, load, buy, websiteIncl, qty]) {
  return {
    category: "tyre",
    name: `${size} Vitora ${pattern} ${load}`,
    partNumber: code,
    brand: "Vitora",
    supplier: SUPPLIER,
    fitment: `${size} ${load}`,
    tyrePrice: buy,
    stewardshipFee: STEWARDSHIP_EX,
    costPrice: inventoryLib.roundMoney(buy + STEWARDSHIP_EX),
    sellPrice: catalog.exclFromIncl(websiteIncl - FITTING_INCL),
    qtyOnHand: qty,
    notes: "Consignment",
  };
}

/** Add the tyres to stock. A code already in stock keeps its qty; only its prices and details are updated. */
function applyToStock(items, movements, now, newId) {
  const added = [];
  const updated = [];
  for (const row of TYRES) {
    const line = stockLine(row);
    const existing = items.find(
      (item) =>
        item.category === "tyre" &&
        String(item.partNumber || "").replace(/\s+/g, "").toUpperCase() === line.partNumber.toUpperCase() &&
        /vitora/i.test(`${item.brand} ${item.name}`)
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

module.exports = { IMPORT_ID, TYRES, stockLine, applyToStock };
