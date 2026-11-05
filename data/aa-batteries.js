/** AA Battery Service consignment batteries.
 * Buy = BP Buy Price list (effective 1 Sep 2025), ex GST.
 * Retail = Recommended Retail Price list (effective 1 Jul 2025), incl GST; stock keeps it ex GST.
 * Deep cycle 5503 / 5601 / 5862 are POA and 7702 has no buy price yet, so they are left out.
 */

const inventoryLib = require("./inventory");

const IMPORT_ID = "aa-batteries-2025-09";
const SUPPLIER = "AA Battery Service";

// [part, description, type, warranty years, CCA, RC mins, 20hr Ah, buy ex GST, retail incl GST, qty on hand]
const BATTERIES = [
  ["2134N", "Premium", "Calcium", 3, 430, 71, 45, 101.06, 299, 1],
  ["2135N", "Premium", "Calcium", 3, 430, 71, 45, 110.07, 299, 1],
  ["2136N", "Premium", "Calcium", 3, 430, 71, 45, 110.07, 299, 2],
  ["2382", "Premium", "Calcium", 3, 370, 55, 38, 106.78, 288, 0],
  ["2383", "Premium", "Calcium", 3, 370, 55, 38, 106.78, 288, 0],
  ["2384", "Premium", "Calcium", 3, 370, 55, 38, 106.78, 288, 1],
  ["2386", "Premium", "Calcium", 3, 400, 70, 40, 106.78, 288, 0],
  ["2541", "Premium", "Calcium", 3, 550, 100, 55, 119.72, 324, 0],
  ["2542", "Premium", "Calcium", 3, 550, 100, 55, 119.72, 324, 0],
  ["2543", "Premium", "Calcium", 3, 600, 110, 60, 135.59, 326, 0],
  ["2544", "Premium", "Calcium", 3, 600, 110, 60, 139.6, 326, 2],
  ["3372", "Premium", "Calcium", 3, 430, 71, 45, 120.08, 315, 0],
  ["3374", "Premium", "Calcium", 3, 420, 85, 50, 135.59, 326, 0],
  ["3552", "Premium", "Calcium", 3, 590, 95, 56, 129.78, 358, 0],
  ["3554", "Premium", "Calcium", 3, 600, 100, 60, 162.22, 373, 0],
  ["3662", "Premium", "Calcium", 3, 640, 110, 68, 192.06, 414, 0],
  ["3664", "Premium", "Calcium", 3, 720, 120, 75, 240.6, 496, 0],
  ["3884", "Premium", "Calcium", 3, 850, 170, 100, 232.32, 506, 0],
  ["5344", "Premium", "Calcium", 3, 530, 90, 53, 164.57, 352, 0],
  ["5372", "Extra Heavy Duty", "Calcium", 2, 830, 145, 80, 194.95, 466, 0],
  ["2341", "AGM", "AGM", 2, 340, 57, 35, 246.37, 497, 0],
  ["3888", "AGM", "AGM", 2, 850, 160, 95, 344.41, 815, 0],
  ["5510", "AGM", "AGM", 2, 370, 75, 45, 247.51, 510, 0],
  ["5511", "AGM", "AGM", 2, 370, 75, 45, 247.51, 510, 0],
  ["5526", "AGM", "AGM", 2, 640, 100, 60, 277.42, 636, 0],
  ["5536", "AGM", "AGM", 2, 760, 120, 70, 387.92, 667, 0],
  ["5556", "AGM", "AGM", 2, 800, 160, 80, 335.03, 815, 0],
  ["5566", "AGM", "AGM", 2, 950, 190, 105, 457.46, 898, 0],
  ["4026", "EFB", "EFB", 2, 640, 120, 64, 225.68, 583, 0],
  ["4036", "EFB", "EFB", 2, 700, 140, 70, 277.42, 636, 0],
  ["4031", "EFB", "EFB", 2, 670, 100, 68, 227.91, 576, 0],
  ["4032", "EFB", "EFB", 2, 670, 100, 68, 225.68, 576, 0],
  ["4044", "EFB", "EFB", 2, 780, 125, 77, 288.42, 618, 0],
  ["4082", "EFB", "EFB", 2, 720, 150, 75, 282.97, 627, 0],
  ["4092", "EFB", "EFB", 2, 800, 145, 80, 301.11, 773, 0],
  ["3224", "Hybrid Auxiliary", "Calcium", 2, 320, 55, 40, 135.59, 326, 0],
  ["6615", "Hybrid Auxiliary", "Calcium", 2, 280, 47, 34, 105.73, 288, 0],
  ["4503", "Extra Heavy Duty", "Calcium", 2, 720, 140, 83, 142.65, 358, 1],
  ["4504", "Extra Heavy Duty", "Calcium", 2, 720, 140, 83, 142.65, 358, 1],
  ["4703", "Extra Heavy Duty", "Calcium", 2, 850, 175, 95, 162.74, 422, 0],
  ["4704", "Extra Heavy Duty", "Calcium", 2, 850, 175, 95, 162.74, 422, 0],
  ["4862", "Extra Heavy Duty", "Calcium", 2, 1000, 180, 105, 217.11, 458, 0],
  ["4901", "Commercial", "Calcium", 1, 800, 180, 100, 225.65, 523, 0],
  ["4922", "Commercial", "Calcium", 1, 900, 230, 120, 260.72, 523, 0],
  ["4952", "Commercial", "Calcium", 1, 1000, 300, 150, 275.48, 634, 0],
  ["4052", "Lawn Mower", "Calcium", 1, 300, 40, 30, 98.02, 219, 0],
  ["4061", "Lawn Mower", "Calcium", 1, 300, 40, 30, 98.02, 219, 0],
  ["7501", "Watercraft", "Calcium", 2, 600, 125, 73, 131.62, 352, 0],
];

function stockLine([part, description, type, years, cca, rc, ah, buy, retailIncl, qty]) {
  const kind = description === type ? description : `${description} ${type}`;
  return {
    category: "battery",
    name: `AA ${part} ${kind} battery`,
    partNumber: part,
    brand: "AA Battery Service",
    supplier: SUPPLIER,
    fitment: `${cca} CCA · RC ${rc} min · ${ah}Ah · ${years} year warranty`,
    costPrice: buy,
    sellPrice: inventoryLib.roundMoney(retailIncl / (1 + inventoryLib.GST_RATE)),
    qtyOnHand: qty,
    notes: "Consignment",
  };
}

/** Add the list to stock. A part already in stock keeps its qty; only its prices and details are updated. */
function applyToStock(items, movements, now, newId) {
  const added = [];
  const updated = [];
  for (const row of BATTERIES) {
    const line = stockLine(row);
    const existing = items.find(
      (item) =>
        item.category === "battery" &&
        String(item.partNumber || "").replace(/\s+/g, "").toUpperCase() === line.partNumber.toUpperCase()
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

module.exports = { IMPORT_ID, BATTERIES, stockLine, applyToStock };
