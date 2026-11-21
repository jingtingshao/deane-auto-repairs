/** Stock taken off the shelf since the last order from each supplier. */

const supplierNames = require("./supplier-names");

function roundQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

/** Job issues and returns. Deliveries and stock-count edits stay out of the order list. */
function isShelfUse(movement) {
  if (!movement || typeof movement !== "object") return false;
  if (movement.jobId) return true;
  return /^Job\b/i.test(String(movement.note || ""));
}

function supplierLabel(value) {
  return supplierNames.canonicalSupplierName(value) || "No supplier";
}

function supplierKey(value) {
  return supplierNames.supplierMatchKey(supplierLabel(value)) || "no supplier";
}

function latestReset(resets, key) {
  let best = null;
  for (const row of resets || []) {
    if (supplierKey(row?.supplier) !== key) continue;
    const at = String(row.at || "");
    if (!at) continue;
    if (!best || at > String(best.at || "")) best = row;
  }
  return best;
}

function afterReset(movement, reset) {
  if (!reset?.at) return true;
  const moveAt = Date.parse(movement?.createdAt || "");
  const resetAt = Date.parse(reset.at);
  if (!Number.isFinite(moveAt) || !Number.isFinite(resetAt)) return true;
  return moveAt > resetAt;
}

/**
 * @param {{ items?: object[], movements?: object[], resets?: object[] }} input
 */
function buildReorderList(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  const movements = Array.isArray(input.movements) ? input.movements : [];
  const resets = Array.isArray(input.resets) ? input.resets : [];
  const itemById = new Map(items.map((item) => [item.id, item]));
  const groups = new Map();

  function bucket(rawSupplier) {
    const supplier = supplierLabel(rawSupplier);
    const key = supplierKey(supplier);
    let group = groups.get(key);
    if (!group) {
      group = { key, supplier, lines: new Map() };
      groups.set(key, group);
    }
    return group;
  }

  for (const movement of movements) {
    if (!isShelfUse(movement)) continue;
    const item = itemById.get(movement.itemId);
    const group = bucket(item?.supplier || movement.supplier || "");
    if (!afterReset(movement, latestReset(resets, group.key))) continue;
    const id = item?.id || String(movement.itemId || "");
    if (!id) continue;
    const line = group.lines.get(id) || {
      id,
      name: item?.name || "Part",
      partNumber: item?.partNumber || "",
      unit: item?.unit || "each",
      qtyOnHand: item ? roundQty(item.qtyOnHand) : null,
      qtyUsed: 0,
    };
    line.qtyUsed = roundQty(line.qtyUsed - (Number(movement.qtyDelta) || 0));
    group.lines.set(id, line);
  }

  for (const reset of resets) {
    const named = String(reset?.supplier || "").trim();
    if (!named) continue;
    bucket(named);
  }

  const suppliers = [...groups.values()].map((group) => {
    const reset = latestReset(resets, group.key);
    const lines = [...group.lines.values()]
      .filter((line) => line.qtyUsed > 0.0005)
      .sort((a, b) => b.qtyUsed - a.qtyUsed || String(a.name).localeCompare(String(b.name)));
    return {
      supplier: group.supplier,
      lastOrderedAt: reset?.at || "",
      lines,
      lineCount: lines.length,
      qtyUsed: roundQty(lines.reduce((sum, line) => sum + line.qtyUsed, 0)),
    };
  });

  suppliers.sort((a, b) => {
    const aHas = a.lineCount > 0 ? 1 : 0;
    const bHas = b.lineCount > 0 ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    if (b.qtyUsed !== a.qtyUsed) return b.qtyUsed - a.qtyUsed;
    return a.supplier.localeCompare(b.supplier);
  });

  return {
    suppliers: suppliers.filter((row) => row.lineCount > 0 || row.lastOrderedAt),
  };
}

module.exports = {
  roundQty,
  isShelfUse,
  supplierLabel,
  supplierKey,
  buildReorderList,
};
