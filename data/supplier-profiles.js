/**
 * Known supplier invoice layouts.
 * A supplier is recognised from details printed on every invoice (name, GST number,
 * bank account, website), so a misread letter in one of them still finds the right one.
 * Topstar and Repco are read by the general parser in server.js.
 */

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function moneyFrom(text, regex) {
  const raw = (String(text || "").match(regex) || [])[1];
  const n = Number(String(raw || "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

/** Lines like: 205/60R16 LL GREEN-MAX HP010 92V  LL20566GM/HP010 1 58.90 58.90 (Discount column optional). */
function valueTyresLines(lines) {
  const items = [];
  lines.forEach((line, index) => {
    const match = String(line || "").match(
      /^(.+)\s+(\S*\d\S*)\s+(\d{1,3})\s+(\d+\.\d{2})(?:\s+\d+(?:\.\d+)?%?)?\s+(\d+\.\d{2})\s*$/
    );
    if (!match) return;
    const qty = Number(match[3]) || 0;
    const amount = Number(match[5]) || 0;
    if (!(qty > 0) || !(amount > 0)) return;
    const description = match[1].replace(/\s+/g, " ").trim();
    items.push({
      lineNo: index + 1,
      rawLineText: String(line).replace(/\s+/g, " ").trim(),
      descriptionCandidate: description,
      partNumberCandidate: match[2].toUpperCase(),
      qtyCandidate: qty,
      costPriceCandidate: round2(amount / qty),
      confidence: /stewardship/i.test(description) ? 0.98 : 0.95,
    });
  });
  return items;
}

/** Total and GST are printed as bare numbers near "Invoice Total Including GST"; pick the pair that adds up. */
function valueTyresTotals(text, lines) {
  const subtotal = moneyFrom(text, /total\s*net\s*\$?\s*([\d,]+\.\d{2})/i);
  const bare = lines
    .filter((line) => /^\$?\s*[\d,]+\.\d{2}$/.test(line))
    .map((line) => Number(line.replace(/[$,\s]/g, "")));
  for (const total of bare) {
    for (const tax of bare) {
      if (tax === total || !subtotal) continue;
      if (Math.abs(subtotal + tax - total) <= 0.02 && Math.abs(subtotal * 0.15 - tax) <= 0.05) {
        return { subtotal, tax: round2(tax), total: round2(total) };
      }
    }
  }
  return { subtotal, tax: 0, total: 0 };
}

/** Maka tax invoice books are numbered 01xxxxx in red; OCR often turns the leading 0 into a symbol. */
function makaInvoiceNo(text) {
  const clean = String(text || "").match(/\b(01\d{5})\b/);
  if (clean) return clean[1];
  for (const line of String(text || "").split(/\r?\n/)) {
    const after = line.split(/number/i);
    if (after.length < 2) continue;
    let digits = digitsOnly(after[after.length - 1]);
    if (digits.length === 6 && digits.startsWith("1")) digits = `0${digits}`;
    if (/^01\d{5}$/.test(digits)) return digits;
  }
  return "";
}

const PROFILES = [
  {
    name: "Value Tyres",
    names: [/value\s*tyres/i, /valuetyres\.co\.nz/i],
    numbers: ["20-238-062", "02-0816-0421094-000"],
    invoiceNo: (text) => (String(text).match(/packing\s*slip\s*-\s*(\d{5,})/i) || [])[1] || "",
    invoiceDate: (text) => {
      const m = String(text).match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS})[a-z]*\\s+(\\d{4})\\b`, "i"));
      return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
    },
    totals: valueTyresTotals,
    lines: valueTyresLines,
  },
  {
    name: "Maka Auto Parts",
    names: [/maka\s*auto/i],
    numbers: ["140-349-119", "03-1322-0346287-00"],
    invoiceNo: makaInvoiceNo,
    handwrittenLines: true,
  },
];

function matchesName(profile, value) {
  return profile.names.some((rx) => rx.test(String(value || "")));
}

function matchesNumber(profile, lines) {
  const wanted = profile.numbers.map(digitsOnly).filter((d) => d.length >= 8);
  return lines.some((line) => {
    const digits = digitsOnly(line);
    return wanted.some((d) => digits.includes(d));
  });
}

/** Find the supplier profile for this invoice text, or null. */
function detectSupplierProfile(text, supplierHint = "") {
  const lines = String(text || "").split(/\r?\n/);
  return (
    PROFILES.find((p) => matchesName(p, supplierHint)) ||
    PROFILES.find((p) => matchesName(p, text)) ||
    PROFILES.find((p) => matchesNumber(p, lines)) ||
    null
  );
}

module.exports = {
  PROFILES,
  detectSupplierProfile,
  valueTyresLines,
  makaInvoiceNo,
};
