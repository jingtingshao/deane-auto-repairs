/** One display name for supplier spellings that are the same company. */

const SUFFIXES = new Set(["ltd", "limited", "pty", "inc", "co", "company", "nz", "nzl"]);

/** Alias match key → the name shown in stock, invoices, and the suppliers list. */
const DISPLAY_NAME = new Map([
  ["wing tyre", "Wing Tyre"],
  ["wing tyres", "Wing Tyre"],
  ["wing of the car", "Wing Tyre"],
  ["value tyres", "Value Tyres"],
  ["value tyre", "Value Tyres"],
]);

const MATCH_KEY = new Map([
  ["wing tyres", "wing tyre"],
  ["wing of the car", "wing tyre"],
  ["value tyre", "value tyres"],
]);

function baseKey(value) {
  let name = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[.'’]/g, "");
  name = name.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  if (!name) return "";
  let parts = name.split(/\s+/).filter(Boolean);
  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];
    if (last === "zealand" && prev === "new") {
      parts = parts.slice(0, -2);
      continue;
    }
    if (SUFFIXES.has(last)) {
      parts.pop();
      continue;
    }
    break;
  }
  return parts.join(" ");
}

/** Comparison key. Wing Tyre and Wing of the Car Ltd share one key. */
function supplierMatchKey(value) {
  const key = baseKey(value);
  return MATCH_KEY.get(key) || key;
}

/** Saved and shown name. Other suppliers keep the spelling already stored. */
function canonicalSupplierName(value) {
  const raw = String(value || "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  return DISPLAY_NAME.get(supplierMatchKey(raw)) || DISPLAY_NAME.get(baseKey(raw)) || raw;
}

module.exports = {
  supplierMatchKey,
  canonicalSupplierName,
};
