/** Workshop job cards — internal only, not customer-facing. */

const JOB_STATUSES = [
  { id: "waiting_parts", label: "Waiting parts" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Ready to collect" },
  { id: "collected", label: "Collected" },
];

const LEGACY_STATUS_MAP = {
  booked: "in_progress",
  waiting_customer: "in_progress",
  ready: "completed",
};

const PART_LINE_STATUSES = ["draft", "matched", "approved", "billed", "rejected"];

function isJobStatus(value) {
  return JOB_STATUSES.some((s) => s.id === value);
}

function isPartLineStatus(value) {
  return PART_LINE_STATUSES.includes(String(value || "").trim());
}

function statusLabel(id) {
  return JOB_STATUSES.find((s) => s.id === id)?.label || id || "";
}

function normalizeJobStatus(status, parts) {
  let next = String(status || "").trim();
  if (LEGACY_STATUS_MAP[next]) next = LEGACY_STATUS_MAP[next];
  if (!isJobStatus(next)) next = "in_progress";
  if (next === "completed" || next === "collected") return next;
  return suggestStatusFromParts(next, parts);
}

function isPackageServiceLine(description) {
  const d = String(description || "")
    .trim()
    .toLowerCase();
  if (!d) return false;
  return (
    /^wof\b/.test(d) ||
    d.includes("wof inspection") ||
    d.includes("basic service") ||
    d.includes("standard service") ||
    d.includes("premium service")
  );
}

function isLabourLine(description) {
  const d = String(description || "")
    .trim()
    .toLowerCase();
  if (!d) return false;
  if (isPackageServiceLine(d)) return false;
  return (
    /\blabou?r\b/.test(d) ||
    /\bdiagnostic\b/.test(d) ||
    /\bper hour\b/.test(d) ||
    /\bhourly\b/.test(d)
  );
}

function isConsumableLine(description) {
  return /\bconsumables?\b/i.test(String(description || "").trim());
}

function isServiceOrLabourLine(description) {
  const d = String(description || "").trim();
  if (!d) return true;
  return isPackageServiceLine(d) || isLabourLine(d);
}

/** Invoice lines that must not become job card parts. */
function isNonPartInvoiceLine(description) {
  const d = String(description || "").trim();
  if (!d) return true;
  return isServiceOrLabourLine(d) || isConsumableLine(d);
}

function normalizePart(part = {}, idFallback = "") {
  const toNumber = (value, fallback = 0) => {
    const next = Number(value);
    return Number.isFinite(next) ? next : fallback;
  };
  const clampMoney = (value) => Math.round(Math.max(0, toNumber(value, 0)) * 100) / 100;
  const clampRatio = (value) => {
    if (value == null || value === "") return null;
    const next = toNumber(value, NaN);
    if (!Number.isFinite(next)) return null;
    if (next < 0) return 0;
    if (next > 1) return 1;
    return Math.round(next * 1000) / 1000;
  };
  const normalizePhotoRefs = (input) => {
    if (!Array.isArray(input)) return [];
    return input.map((row) => String(row || "").trim()).filter(Boolean).slice(0, 12);
  };
  const qtyRaw = toNumber(part.qty, NaN);
  const qty = Number.isFinite(qtyRaw) && qtyRaw >= 0 ? qtyRaw : 1;
  const costPrice = clampMoney(part.costPrice);
  const markupPercent = part.markupPercent == null ? 0 : Math.max(0, toNumber(part.markupPercent, 0));
  const sellPrice =
    part.sellPrice != null && part.sellPrice !== ""
      ? clampMoney(part.sellPrice)
      : clampMoney(costPrice * (1 + markupPercent / 100));
  const received = Boolean(part.received);
  const ordered = received ? true : Boolean(part.ordered);
  const partNumber = String(part.partNumber || "").trim();
  const description = String(part.description || "").trim();
  const supplier = String(part.supplier || "").trim();
  const note = String(part.note || part.notes || "").trim();
  const status = isPartLineStatus(part.status) ? String(part.status).trim() : "draft";
  const source = String(part.source || "").trim().toLowerCase() === "ocr" ? "ocr" : "manual";

  return {
    id: part.id || idFallback,
    partNumber,
    description,
    qty,
    uom: String(part.uom || "ea").trim() || "ea",
    ordered,
    received,
    supplier,
    costPrice,
    markupPercent: Math.round(markupPercent * 100) / 100,
    sellPrice,
    lineCostTotal: clampMoney(qty * costPrice),
    lineSellTotal: clampMoney(qty * sellPrice),
    supplierInvoiceNo: String(part.supplierInvoiceNo || "").trim(),
    supplierInvoiceDate: String(part.supplierInvoiceDate || "").trim(),
    status,
    source,
    ocrConfidence: clampRatio(part.ocrConfidence),
    matchScore: clampRatio(part.matchScore),
    linkedInvoiceId: String(part.linkedInvoiceId || "").trim(),
    photoRefs: normalizePhotoRefs(part.photoRefs),
    note,
    notes: note,
    createdAt: String(part.createdAt || "").trim(),
    createdBy: String(part.createdBy || "").trim(),
    updatedAt: String(part.updatedAt || "").trim(),
    updatedBy: String(part.updatedBy || "").trim(),
  };
}

function normalizeParts(parts, newId) {
  if (!Array.isArray(parts)) return [];
  return parts
    .map((part) => normalizePart(part, newId ? newId() : part.id || ""))
    .filter(
      (part) =>
        part.description ||
        part.partNumber ||
        part.supplier ||
        part.note ||
        Number(part.qty) > 0 ||
        Number(part.costPrice) > 0
    );
}

function lineDescription(line) {
  return String(line?.description || line?.name || "").trim();
}

function partsFromQuoteLines(lines, newId) {
  return (lines || [])
    .filter((line) => lineDescription(line) && !isNonPartInvoiceLine(lineDescription(line)))
    .map((line) =>
      normalizePart(
        {
          description: lineDescription(line),
          qty: line.qty,
          ordered: false,
          received: false,
          supplier: "",
          note: "",
        },
        newId ? newId() : ""
      )
    );
}

function mergeNewParts(job, incoming) {
  if (!job) return false;
  const extra = (incoming || []).filter((p) => {
    const desc = String(p.description || "").trim();
    return desc && !isNonPartInvoiceLine(desc);
  });
  if (!extra.length) return false;
  const parts = Array.isArray(job.parts) ? [...job.parts] : [];
  let changed = false;
  for (const part of extra) {
    const key = String(part.description || "").trim().toLowerCase();
    if (!key) continue;
    const existing = parts.find(
      (p) => String(p.description || "").trim().toLowerCase() === key
    );
    if (existing) {
      const qty = Math.max(0, Number(part.qty) || 0) || existing.qty;
      if (Number(existing.qty) !== Number(qty)) {
        existing.qty = qty;
        changed = true;
      }
      continue;
    }
    parts.push(part);
    changed = true;
  }
  if (!changed) return false;
  job.parts = parts;
  job.status = normalizeJobStatus(job.status, job.parts);
  return true;
}

function workRequestedFromQuote(quote) {
  const notes = String(quote?.notes || "").trim();
  const lines = (quote?.lines || [])
    .filter((line) => {
      const desc = String(line?.description || "").trim();
      return desc && !isPackageServiceLine(desc);
    })
    .map((line) => {
      const qty = Number(line.qty) || 1;
      return `${qty} × ${String(line.description).trim()}`;
    });
  return [notes, lines.join("\n")].filter(Boolean).join("\n\n");
}

function stripPackageWorkRequested(text) {
  const next = String(text || "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      const body = trimmed.replace(/^\d+\s*[x×]\s*/i, "").trim();
      return !isPackageServiceLine(body);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return next;
}

function stripPackageParts(job) {
  if (!job || !Array.isArray(job.parts)) return false;
  const next = job.parts.filter(
    (part) => String(part.description || "").trim() && !isNonPartInvoiceLine(part.description)
  );
  if (next.length === job.parts.length) return false;
  job.parts = next;
  job.status = normalizeJobStatus(job.status, job.parts);
  return true;
}

function partsSummary(parts) {
  const rows = (parts || []).filter((p) => p.description);
  return {
    total: rows.length,
    received: rows.filter((p) => p.received || p.status === "approved" || p.status === "billed")
      .length,
  };
}

/**
 * Keep Waiting parts / In progress in sync with parts ticks.
 * Does not change Ready to collect or Collected.
 * Any listed part not yet received → waiting_parts.
 */
function suggestStatusFromParts(currentStatus, parts) {
  if (currentStatus === "completed" || currentStatus === "collected") {
    return currentStatus;
  }

  const rows = (parts || []).filter((p) => String(p.description || "").trim());
  if (!rows.length) return "in_progress";

  if (rows.some((p) => !p.received)) return "waiting_parts";
  return "in_progress";
}

module.exports = {
  JOB_STATUSES,
  JOB_STATUSES: JOB_STATUSES,
  PART_LINE_STATUSES,
  PART_LINE_STATUSES: PART_LINE_STATUSES,
  isJobStatus,
  isJobStatus: isJobStatus,
  isPartLineStatus,
  isPartLineStatus: isPartLineStatus,
  statusLabel,
  statusLabel: statusLabel,
  normalizeJobStatus,
  isPackageServiceLine,
  isLabourLine,
  isConsumableLine,
  isServiceOrLabourLine,
  isServiceOrLabourLine: isServiceOrLabourLine,
  isNonPartInvoiceLine,
  normalizePart,
  normalizeParts,
  normalizeParts: normalizeParts,
  partsFromQuoteLines,
  partsFromQuoteLines: partsFromQuoteLines,
  partsFromQuoteLines: partsFromQuoteLines,
  mergeNewParts,
  workRequestedFromQuote,
  workRequestedFromQuote: workRequestedFromQuote,
  stripPackageParts,
  stripPackageWorkRequested,
  partsSummary,
  partsSummary: partsSummary,
  suggestStatusFromParts,
  suggestStatusFromParts: suggestStatusFromParts,
};
