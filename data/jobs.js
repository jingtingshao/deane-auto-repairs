/** Workshop job cards — internal only, not customer-facing. */

const JOB_STATUSES = [
  { id: "waiting_parts", label: "Waiting parts" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
];

const LEGACY_STATUS_MAP = {
  booked: "in_progress",
  waiting_customer: "in_progress",
  ready: "completed",
};

function isJobStatus(value) {
  return JOB_STATUSES.some((s) => s.id === value);
}

function statusLabel(id) {
  return JOB_STATUSES.find((s) => s.id === id)?.label || id || "";
}

function normalizeJobStatus(status, parts) {
  let next = String(status || "").trim();
  if (LEGACY_STATUS_MAP[next]) next = LEGACY_STATUS_MAP[next];
  if (!isJobStatus(next)) next = "in_progress";
  if (next === "completed") return "completed";
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
    d.includes("standard service") ||
    d.includes("premium service")
  );
}

function isServiceOrLabourLine(description) {
  const d = String(description || "").trim();
  if (!d) return true;
  return isPackageServiceLine(d);
}

function normalizePart(part = {}, idFallback = "") {
  const received = Boolean(part.received);
  return {
    id: part.id || idFallback,
    description: String(part.description || "").trim(),
    qty: Math.max(0, Number(part.qty) || 0) || (String(part.description || "").trim() ? 1 : 1),
    ordered: received ? true : Boolean(part.ordered),
    received,
    supplier: String(part.supplier || "").trim(),
    note: String(part.note || "").trim(),
  };
}

function normalizeParts(parts, newId) {
  if (!Array.isArray(parts)) return [];
  return parts
    .map((part) => normalizePart(part, newId ? newId() : part.id || ""))
    .filter((part) => part.description || part.supplier || part.note);
}

function lineDescription(line) {
  return String(line?.description || line?.name || "").trim();
}

function partsFromQuoteLines(lines, newId) {
  return (lines || [])
    .filter((line) => lineDescription(line) && !isServiceOrLabourLine(lineDescription(line)))
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
    return desc && !isPackageServiceLine(desc);
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
    (part) => !isPackageServiceLine(part.description)
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
    received: rows.filter((p) => p.received).length,
  };
}

/**
 * Keep Waiting parts / In progress in sync with parts ticks.
 * Does not change Completed.
 * Any listed part not yet received → waiting_parts.
 */
function suggestStatusFromParts(currentStatus, parts) {
  if (currentStatus === "completed") return "completed";

  const rows = (parts || []).filter((p) => String(p.description || "").trim());
  if (!rows.length) return "in_progress";

  if (rows.some((p) => !p.received)) return "waiting_parts";
  return "in_progress";
}

module.exports = {
  JOB_STATUSES,
  JOB_STATUSES: JOB_STATUSES,
  isJobStatus,
  isJobStatus: isJobStatus,
  statusLabel,
  statusLabel: statusLabel,
  normalizeJobStatus,
  isPackageServiceLine,
  isServiceOrLabourLine,
  isServiceOrLabourLine: isServiceOrLabourLine,
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
