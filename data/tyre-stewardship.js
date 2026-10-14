/** Tyre price and the Tyre Stewardship Fee stay separate.
 * The cost that goes into stock is the two added together.
 */

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function isStewardshipText(value) {
  return /stewardship/i.test(String(value || ""));
}

function candidateText(row) {
  return [row?.descriptionCandidate, row?.partNumberCandidate, row?.description, row?.name, row?.rawLineText]
    .filter(Boolean)
    .join(" ");
}

function isStewardshipCandidate(row) {
  return isStewardshipText(candidateText(row));
}

/** A fee still belongs on the tyre unless that fee line was ignored. */
function feeStaysWithTyre(row) {
  const decision = String(row?.decision || "pending");
  return decision === "pending" || decision === "attached";
}

/**
 * Pair each stewardship line with the product line above it.
 * Invoice unit prices are unchanged. stockCostCandidate is tyre + fee.
 */
function pairStewardshipFees(rows) {
  const list = (rows || []).map((row) => ({
    ...row,
    stewardshipLine: false,
    linkedTyreCandidateId: "",
    stewardshipCandidateId: "",
    tyrePriceCandidate: 0,
    stewardshipFeeCandidate: 0,
    stockCostCandidate: roundMoney(row?.costPriceCandidate),
  }));
  const ordered = [...list].sort(
    (a, b) => (Number(a.lineNo) || 0) - (Number(b.lineNo) || 0) || String(a.id || "").localeCompare(String(b.id || ""))
  );
  let previous = null;
  const feeByTyreId = new Map();
  for (const row of ordered) {
    if (isStewardshipCandidate(row)) {
      row.stewardshipLine = true;
      row.stewardshipFeeCandidate = roundMoney(row.costPriceCandidate);
      row.stockCostCandidate = 0;
      if (previous && feeStaysWithTyre(row)) {
        row.linkedTyreCandidateId = previous.id || "";
        if (previous.id) feeByTyreId.set(previous.id, row);
      }
      continue;
    }
    previous = row;
  }
  for (const row of list) {
    if (row.stewardshipLine) continue;
    const fee = row.id ? feeByTyreId.get(row.id) : null;
    const tyrePrice = roundMoney(row.costPriceCandidate);
    const feePrice = fee ? roundMoney(fee.costPriceCandidate) : 0;
    row.tyrePriceCandidate = tyrePrice;
    row.stewardshipFeeCandidate = feePrice;
    row.stockCostCandidate = roundMoney(tyrePrice + feePrice);
    row.stewardshipCandidateId = fee?.id || "";
  }
  return list;
}

/** Use the typed unit when it is already the sum. Otherwise add the fee. */
function landedUnitCost(typed, tyreUnit, feeUnit) {
  const typedN = roundMoney(typed);
  const tyre = roundMoney(tyreUnit);
  const fee = roundMoney(feeUnit);
  if (!(fee > 0)) return typedN;
  const sum = roundMoney(tyre + fee);
  if (Math.abs(typedN - sum) <= 0.02) return sum;
  if (Math.abs(typedN - tyre) <= 0.02) return sum;
  return roundMoney(typedN + fee);
}

/**
 * Lines like: LL75654GM 175/65R14 LL GREEN-MAX ET 82T 2 34.90 69.80
 * Unit price is stored. The last figure is the line total and is not the unit cost.
 */
function parseTyreOrderLines(lines) {
  const items = [];
  for (let i = 0; i < (lines || []).length; i += 1) {
    const line = String(lines[i] || "").replace(/\s+/g, " ").trim();
    if (!line || /split\s*order/i.test(line)) continue;
    const match = line.match(
      /^([A-Z0-9][A-Z0-9./-]{3,})\s+(.+?)\s+(\d{1,3})\s+(\d+\.\d{2})\s+(\d+\.\d{2})\s*$/i
    );
    if (!match) continue;
    const qty = Number(match[3]) || 0;
    const unit = Number(match[4]) || 0;
    const total = Number(match[5]) || 0;
    if (!(qty > 0) || !(unit > 0)) continue;
    if (Math.abs(unit * qty - total) > 0.05) continue;
    const description = String(match[2] || "").trim();
    items.push({
      lineNo: i + 1,
      rawLineText: line,
      partNumberCandidate: String(match[1] || "").toUpperCase(),
      descriptionCandidate: description,
      qtyCandidate: qty,
      costPriceCandidate: roundMoney(unit),
      confidence: isStewardshipText(description) ? 0.98 : 0.93,
    });
  }
  return items;
}

function tyreCostFields(raw) {
  const stewardshipFee = roundMoney(raw?.stewardshipFee);
  const typedCost = roundMoney(raw?.costPrice);
  const typedTyre = roundMoney(raw?.tyrePrice);
  if (!(stewardshipFee > 0)) {
    return { tyrePrice: 0, stewardshipFee: 0, costPrice: typedCost };
  }
  const tyrePrice = typedTyre > 0 ? typedTyre : roundMoney(Math.max(0, typedCost - stewardshipFee));
  return {
    tyrePrice,
    stewardshipFee,
    costPrice: roundMoney(tyrePrice + stewardshipFee),
  };
}

module.exports = {
  isStewardshipText,
  isStewardshipCandidate,
  pairStewardshipFees,
  landedUnitCost,
  parseTyreOrderLines,
  tyreCostFields,
};
