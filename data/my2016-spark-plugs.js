/** My2016 consignment spark plugs (Japanese car), sheet dated on the workshop copy.
 * Each Price on the sheet is the buy price, ex GST.
 * Opening qty is 4 of each sort.
 * Retail is the stock markup band minimum, same as Add to stock.
 */

const inventoryLib = require("./inventory");

const IMPORT_ID = "my2016-spark-plugs-2026-11";
const SUPPLIER = "My2016";
const QTY = 4;

// [part, alloy, buy ex GST]
const PLUGS = [
  ["Z1", "Nickel Alloy", 5.2],
  ["Z2A", "Nickel Alloy", 5.2],
  ["Z2B", "Iridium", 16],
  ["Z3", "Double Iridium", 19.5],
  ["Z4", "Double Iridium", 19.5],
  ["Z5", "Double Iridium", 19.5],
  ["Z6", "Double Iridium", 19.5],
  ["Z7", "Double Iridium", 19.5],
  ["Z8", "Double Iridium", 19.5],
  ["Z9", "Double Iridium", 19.5],
  ["Z10", "Double Iridium", 19.5],
  ["Z11", "Iridium", 16],
  ["Z12", "Double Iridium", 19.5],
  ["Z13", "Iridium Platinum", 19.5],
  ["Z14", "Iridium", 16],
  ["Z15", "Iridium", 16],
  ["Z16", "Double Iridium", 19.5],
  ["Z17", "Iridium", 16],
  ["Z18", "Iridium", 16],
  ["Z19A", "Nickel Alloy", 5.2],
  ["Z19B", "Iridium", 16],
  ["Z20A", "Nickel Alloy", 5.2],
  ["Z20B", "Iridium", 16],
];

function stockLine([part, alloy, buy]) {
  return {
    category: "spark_plug",
    name: `${part} ${alloy} spark plug`,
    partNumber: part,
    brand: "My2016",
    supplier: SUPPLIER,
    fitment: `Japanese car · ${alloy}`,
    costPrice: buy,
    sellPrice: inventoryLib.suggestPrice(buy).sell,
    qtyOnHand: QTY,
    notes: "Consignment",
  };
}

function samePart(item, part) {
  return String(item.partNumber || "").replace(/\s+/g, "").toUpperCase() === part.toUpperCase();
}

/** Add the plugs to stock. A My2016 part already in stock keeps its qty; only prices and details are updated. */
function applyToStock(items, movements, now, newId) {
  const added = [];
  const updated = [];
  for (const row of PLUGS) {
    const line = stockLine(row);
    const existing = items.find(
      (item) =>
        item.category === "spark_plug" &&
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

module.exports = { IMPORT_ID, PLUGS, QTY, stockLine, applyToStock };
