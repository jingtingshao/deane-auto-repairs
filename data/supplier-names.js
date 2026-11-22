/** One display name for supplier spellings that are the same company.
 * Invoice OCR often changes spaces, Ltd, a trailing dash, or a slogan line.
 */

const SUFFIXES = new Set(["ltd", "limited", "pty", "inc", "co", "company", "nz", "nzl"]);
const GENERIC = new Set(["auto", "parts", "part", "automotive", "spares", "spare", "service", "services"]);
const PLACEHOLDERS = new Set([
  "paymentadvice",
  "auckland",
  "thankyou",
  "thankyouforusing",
  "taxinvoice",
  "invoice",
  "statement",
]);

/** Match key → the name saved on stock, invoices, and the order list. */
const DISPLAY_NAME = new Map([
  ["wingtyre", "Wing Tyre"],
  ["valuetyres", "Value Tyres"],
  ["my2016", "My2016"],
  ["repcomtroskill", "REPCO MT ROSKILL"],
  ["repcoonehunga", "REPCO ONEHUNGA"],
  ["repco", "REPCO"],
  ["topstar", "Topstar New Zealand"],
  ["aabattery", "AA Battery Service"],
  ["maka", "MAKA"],
]);

/** Spaced key → spaced key, applied before spaces are removed. */
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

/** A footer like "Thank you for using Repco Onehunga" is that Repco branch. */
function foldSlogan(value) {
  const text = String(value || "");
  if (/repco/i.test(text) && /onehunga/i.test(text)) return "REPCO ONEHUNGA";
  if (/repco/i.test(text) && /ros?kill/i.test(text)) return "REPCO MT ROSKILL";
  return text.replace(/thank\s*you\s*for\s*using/gi, " ").replace(/\s+/g, " ").trim();
}

/** Comparison key. Spacing, Ltd, and a trailing store number do not make a new supplier. */
function supplierMatchKey(value) {
  let parts = baseKey(foldSlogan(value)).split(/\s+/).filter(Boolean);
  if (parts.length > 1 && /^\d{1,3}$/.test(parts[parts.length - 1])) parts.pop();
  let key = MATCH_KEY.get(parts.join(" ")) || parts.join(" ");
  parts = key.split(/\s+/).filter(Boolean);
  while (parts.length > 1 && GENERIC.has(parts[parts.length - 1])) parts.pop();
  key = MATCH_KEY.get(parts.join(" ")) || parts.join(" ");
  return key.replace(/\s+/g, "");
}

function tidyDisplay(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[!.,;:]+$/g, "")
    .replace(/\s+-\s*\d{1,3}$/g, "")
    .trim();
}

/** Saved and shown name. A known company keeps one spelling. */
function canonicalSupplierName(value) {
  const folded = foldSlogan(value);
  const key = supplierMatchKey(folded);
  if (!key) return "";
  if (PLACEHOLDERS.has(key)) return tidyDisplay(folded);
  return DISPLAY_NAME.get(key) || tidyDisplay(folded);
}

/** Lines such as "PAYMENT ADVICE" or a city are not a supplier. */
function isPlaceholderSupplierName(value) {
  const key = supplierMatchKey(value);
  return !key || PLACEHOLDERS.has(key);
}

module.exports = {
  supplierMatchKey,
  canonicalSupplierName,
  isPlaceholderSupplierName,
};
