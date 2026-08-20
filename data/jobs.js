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

function isServiceOrLabourLine(description) {
  const d = String(description || "")
    .trim()
    .toLowerCase();
  if (!d) return true;
  return (
    /wof inspection/.test(d) ||
    /standard service/.test(d) ||
    /premium service/.test(d) ||
    /workshop labour/.test(d) ||
    /diagnostic labour/.test(d)
  );
}

function normalizePart(part = {}, idFallback = "") {
  const received = Boolean(part.received);
  return {
    id: part.id || idFallback,
    description: String(part.description || "").trim(),
    qty: Math.max(0, Number(part.qty) || 0) || (String(part.description || "").trim() ? 1 : 1),
    ordered: received ? true : Boolean(part.ordered),
    received,
    note: String(part.note || "").trim(),
  };
}

function normalizeParts(parts, newId) {
  if (!Array.isArray(parts)) return [];
  return parts
    .map((part) => normalizePart(part, newId ? newId() : part.id || ""))
    .filter((part) => part.description || part.note);
}

function partsFromQuoteLines(lines, newId) {
  return (lines || [])
    .filter((line) => line?.description && !isServiceOrLabourLine(line.description))
    .map((line) =>
      normalizePart(
        {
          description: line.description,
          qty: line.qty,
          ordered: false,
          received: false,
          note: "",
        },
        newId ? newId() : ""
      )
    );
}

function workRequestedFromQuote(quote) {
  const notes = String(quote?.notes || "").trim();
  const lines = (quote?.lines || [])
    .filter((line) => String(line?.description || "").trim())
    .map((line) => {
      const qty = Number(line.qty) || 1;
      return `${qty} × ${String(line.description).trim()}`;
    });
  return [notes, lines.join("\n")].filter(Boolean).join("\n\n");
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
  isJobStatus,
  statusLabel,
  normalizeJobStatus,
  isServiceOrLabourLine,
  normalizePart,
  normalizeParts,
  partsFromQuoteLines,
  workRequestedFromQuote,
  partsSummary,
  suggestStatusFromParts,
};
