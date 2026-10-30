/**
 * Check that known supplier invoices are still recognised.
 *   node scripts/test-supplier-profiles.js
 */
const assert = require("assert");
const { detectSupplierProfile, valueTyresLines, makaInvoiceNo } = require("../data/supplier-profiles");

const valueText = [
  "Value Tyres Limited",
  "AUCKLAND",
  "22 Oct 2026 1",
  "TAX INVOICE / PACKING SLIP - 4809691",
  "Invoice Number:",
  "4",
  "GST Number",
  "20-238-062",
  "205/60R16 LL GREEN-MAX HP010 92V\tLL20566GM/HP010 1 58.90 58.90",
  "Tyre Stewardship Fee\t4011.10.09.11E 1 6.65 6.65",
  "Value Tyres Premium Free Delivery\t014 1",
  "75.38",
  "9.83",
  "Invoice Total Including GST",
  "Total Net 65.55",
].join("\n");
const value = detectSupplierProfile(valueText);
assert.strictEqual(value?.name, "Value Tyres");
assert.strictEqual(value.invoiceNo(valueText), "4809691");
assert.strictEqual(value.invoiceDate(valueText), "22-Oct-2026");
assert.deepStrictEqual(value.totals(valueText, valueText.split("\n")), { subtotal: 65.55, tax: 9.83, total: 75.38 });
const lines = valueTyresLines(valueText.split("\n"));
assert.strictEqual(lines.length, 2);
assert.strictEqual(lines[0].partNumberCandidate, "LL20566GM/HP010");
assert.strictEqual(lines[0].descriptionCandidate, "205/60R16 LL GREEN-MAX HP010 92V");
assert.strictEqual(lines[0].costPriceCandidate, 58.9);

// Real OCR of the Maka photo: "FROM:" and the leading 0 of the invoice number are misread.
const makaOcr = [
  "[ [07 224     wy fread       NUMBER (J1 00155  . ¥",
  "|     (EER Maka Auto Parts   TO: VE NE Au",
  "         GST: 140-349-119                       4",
].join("\n");
assert.strictEqual(detectSupplierProfile(makaOcr)?.name, "Maka Auto Parts");
assert.strictEqual(makaInvoiceNo(makaOcr), "0100155");
assert.strictEqual(detectSupplierProfile("GST: 140 349 119")?.name, "Maka Auto Parts");

assert.strictEqual(detectSupplierProfile("REPCO NEW ZEALAND LIMITED\nTax Invoice No: 123"), null);
assert.strictEqual(detectSupplierProfile("anything", "Value Tyres Limited")?.name, "Value Tyres");

console.log("supplier profiles ok");
