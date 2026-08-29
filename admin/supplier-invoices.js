(function () {
const Admin = window.DeaneAdmin;

const section = document.getElementById("supplier-invoices-section");
const listView = document.getElementById("supplier-invoices-list-view");
const editView = document.getElementById("supplier-invoices-edit-view");
const listEl = document.getElementById("supplier-invoices-list");
const searchEl = document.getElementById("supplier-invoices-search");
const form = document.getElementById("supplier-invoice-form");
const importFileInput = document.getElementById("supplier-invoice-import-file");
const importFileInputInline = document.getElementById("supplier-invoice-import-file-inline");
const photosEl = document.getElementById("supplier-invoice-photos");
const lightboxEl = document.getElementById("supplier-invoice-lightbox");
const rawTextEl = document.getElementById("supplier-invoice-raw-text");
const candidatesEl = document.getElementById("supplier-candidates-list");
const saveStatus = document.getElementById("supplier-invoice-save-status");
const ocrStatusLine = document.getElementById("supplier-ocr-status-line");
const monthConsumablesEl = document.getElementById("supplier-month-consumables");

let rows = [];
let jobs = [];
let current = null;
let candidates = [];
let selectedCandidateIds = new Set();
let editingCandidateIds = new Set();
let duplicateCheckTimer = null;
let duplicateCheckNonce = 0;

function showStatus(msg) {
  if (!saveStatus) return;
  saveStatus.hidden = false;
  saveStatus.textContent = msg;
  setTimeout(() => {
    saveStatus.hidden = true;
  }, 2500);
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function formatMoney(value) {
  return `$${money(value).toFixed(2)}`;
}

function aucklandYearMonth(iso) {
  const raw = String(iso || "").trim();
  if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Auckland",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date(raw || Date.now()))
      .slice(0, 7);
  } catch {
    return "";
  }
}

function currentAucklandYearMonth() {
  if (typeof Admin.todayIso === "function") return Admin.todayIso().slice(0, 7);
  return aucklandYearMonth(new Date().toISOString());
}

function monthLabel(ym) {
  const [y, m] = String(ym || "").split("-").map(Number);
  if (!y || !m) return "This month";
  return new Date(y, m - 1, 1).toLocaleString("en-NZ", { month: "short", year: "numeric" });
}

function renderMonthConsumablesSummary() {
  if (!monthConsumablesEl) return;
  const ym = currentAucklandYearMonth();
  let consumableTotal = 0;
  let toolTotal = 0;
  let invoiceCount = 0;
  for (const row of rows) {
    if (aucklandYearMonth(row.invoiceDate) !== ym) continue;
    const c = money(row.consumableCost);
    const t = money(row.toolCost);
    if (!(c > 0) && !(t > 0)) continue;
    consumableTotal += c;
    toolTotal += t;
    invoiceCount += 1;
  }
  consumableTotal = money(consumableTotal);
  toolTotal = money(toolTotal);
  if (!(consumableTotal > 0) && !(toolTotal > 0)) {
    monthConsumablesEl.hidden = true;
    monthConsumablesEl.textContent = "";
    return;
  }
  const parts = [];
  if (consumableTotal > 0) parts.push(`Consumables ${formatMoney(consumableTotal)}`);
  if (toolTotal > 0) parts.push(`Tools ${formatMoney(toolTotal)}`);
  monthConsumablesEl.hidden = false;
  monthConsumablesEl.textContent = `${monthLabel(ym)}: ${parts.join(" · ")} across ${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"}`;
}

function statusBadge(status) {
  const map = {
    uploaded: "Uploaded",
    parsed: "Parsed",
    partially_matched: "Partially matched",
    approved: "Approved",
    archived: "Archived",
  };
  return map[status] || status || "Unknown";
}

function lineSearchText(line) {
  return `${line?.description || ""} ${line?.partNumber || ""}`.toLowerCase();
}

function matchingLines(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  return (row.searchLines || []).filter((line) => lineSearchText(line).includes(q));
}

function invoiceMatchesSearch(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return (
    String(row.supplier || "").toLowerCase().includes(q) ||
    String(row.invoiceNo || "").toLowerCase().includes(q) ||
    matchingLines(row, q).length > 0
  );
}

function collectPriceHistory(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  const seen = new Set();
  for (const row of rows) {
    for (const line of matchingLines(row, q)) {
      const key = `${row.id}|${String(line.partNumber || "").toUpperCase()}|${String(line.description || "").toLowerCase()}|${money(line.cost)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        invoiceId: row.id,
        date: row.invoiceDate || "",
        supplier: row.supplier || "",
        description: line.description || "",
        partNumber: line.partNumber || "",
        qty: Number(line.qty) || 0,
        cost: money(line.cost),
      });
    }
  }
  hits.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return hits;
}

function renderPriceHistory(query) {
  const hits = collectPriceHistory(query);
  if (!hits.length) return "";
  const items = hits
    .slice(0, 8)
    .map((hit) => {
      const name = [hit.description, hit.partNumber].filter(Boolean).join(" · ") || "Part";
      const qty = hit.qty ? ` × ${hit.qty}` : "";
      return `<button type="button" class="supplier-price-hit" data-id="${Admin.escapeAttr(hit.invoiceId)}">
        <strong>${Admin.escapeHtml(formatMoney(hit.cost))}</strong>
        <span>${Admin.escapeHtml(Admin.formatDateShort(hit.date) || "No date")} · ${Admin.escapeHtml(hit.supplier || "Supplier")} · ${Admin.escapeHtml(name)}${Admin.escapeHtml(qty)}</span>
      </button>`;
    })
    .join("");
  return `<div class="supplier-price-history">
    <p>Supplier prices found</p>
    ${items}
  </div>`;
}

function emptyInvoice() {
  return {
    id: "",
    supplier: "",
    invoiceNo: "",
    invoiceDate: "",
    subtotal: 0,
    tax: 0,
    total: 0,
    currency: "NZD",
    linkedJobId: "",
    notes: "",
    imageRefs: [],
    status: "uploaded",
    tracking: { supplierCost: 0, pendingCost: 0, ignoredCost: 0 },
  };
}

function findJob(jobId) {
  return jobs.find((job) => job.id === jobId) || null;
}

function isPackageOrLabourLine(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return true;
  if (/workshop labour/.test(t) || /labour \(per hour\)/.test(t)) return true;
  if (/\bwof\b/.test(t) || /warrant of fitness/.test(t)) return true;
  if (/standard service/.test(t) || /premium service/.test(t) || /full service/.test(t)) return true;
  return false;
}

function jobMatchableLines(job) {
  return jobPreviewLines(job).filter((line) => !isPackageOrLabourLine(line));
}

function samePartFamily(a, b) {
  if (!a || !b || a.id === b.id) return false;
  const aSplit = String(a.splitFromId || a.id || "").trim();
  const bSplit = String(b.splitFromId || b.id || "").trim();
  if (aSplit && bSplit && aSplit === bSplit) return true;
  const aPn = String(a.partNumberCandidate || "").trim().toUpperCase();
  const bPn = String(b.partNumberCandidate || "").trim().toUpperCase();
  return Boolean(aPn && bPn && aPn === bPn);
}

function jobsTakenForSamePart(row) {
  const taken = new Set();
  if (!row) return taken;
  for (const other of candidates) {
    if (other.id === row.id) continue;
    if (other.decision !== "accepted" && other.decision !== "edited_then_accepted") continue;
    if (!samePartFamily(row, other)) continue;
    const jobId = other.appliedJobId || other.suggestedJobId;
    if (jobId) taken.add(jobId);
  }
  return taken;
}

function pickerCandidateRow() {
  const rowId = document.body.dataset.jobPickerRow || "";
  return candidates.find((item) => item.id === rowId) || null;
}

function jobEligibleForPartMatch(job, selectedJobId, currentRow) {
  if (!job) return false;
  if (selectedJobId && job.id === selectedJobId) return true;
  if (!jobMatchableLines(job).length) return false;
  if (currentRow && jobsTakenForSamePart(currentRow).has(job.id)) return false;
  return true;
}

function jobPreviewLines(job) {
  const items = Array.isArray(job?.lineItemsPreview) ? job.lineItemsPreview.filter(Boolean) : [];
  if (items.length) return items;
  if (job?.workRequestedPreview) return [job.workRequestedPreview];
  return [];
}

function jobPickerLabel(job) {
  if (!job) return "— Match Job —";
  return `${job.number || "Job"} · ${job.registration || "No plate"}`;
}

function closeJobPicker() {
  const panel = document.getElementById("supplier-job-picker-panel");
  if (panel) panel.hidden = true;
  delete document.body.dataset.jobPickerRow;
}

function jobPickerRowsHtml(query, selectedJobId, highlightText, currentRow) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  const needle = highlightText ? String(highlightText).toLowerCase() : "";
  return (
    `<button type="button" class="job-picker-option${!selectedJobId ? " is-selected" : ""}" data-job-id="">
      <span class="job-picker-option-title">— Match Job —</span>
      <p class="muted small">Clear this line</p>
    </button>` +
    jobs
    .filter((job) => jobEligibleForPartMatch(job, selectedJobId, currentRow))
    .filter((job) => {
      if (!q) return true;
      const hay = [
        job.number,
        job.registration,
        ...(jobMatchableLines(job)),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    })
    .map((job) => {
      const lines = jobMatchableLines(job);
      const lineHtml = lines.length
        ? `<ul class="job-picker-lines">${lines
            .map((line) => {
              const hit = needle && line.toLowerCase().includes(needle.split(" ")[0] || "");
              return `<li${hit ? ' class="is-hit"' : ""}>${Admin.escapeHtml(line)}</li>`;
            })
            .join("")}</ul>`
        : `<p class="muted small">No parts on this job</p>`;
      const selected = selectedJobId === job.id ? " is-selected" : "";
      return `<button type="button" class="job-picker-option${selected}" data-job-id="${Admin.escapeAttr(job.id)}">
        <span class="job-picker-option-title">${Admin.escapeHtml(jobPickerLabel(job))}</span>
        ${lineHtml}
      </button>`;
    })
    .join("")
  );
}

function ensureJobPickerPanel() {
  let panel = document.getElementById("supplier-job-picker-panel");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = "supplier-job-picker-panel";
  panel.className = "job-picker-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <input type="search" class="job-picker-search" placeholder="Search plate or part" autocomplete="off" />
    <div class="job-picker-list" role="listbox"></div>
  `;
  document.body.appendChild(panel);
  panel.querySelector(".job-picker-search")?.addEventListener("input", (e) => {
    const rowId = document.body.dataset.jobPickerRow || "";
    const rowEl = candidatesEl?.querySelector(`tr[data-id="${CSS.escape(rowId)}"]`);
    const selectedJobId = String(rowEl?.querySelector('[data-field="jobId"]')?.value || "");
    const highlight = String(rowEl?.querySelector('[data-field="description"]')?.value || "");
    const currentRow = pickerCandidateRow();
    const list = panel.querySelector(".job-picker-list");
    if (list) list.innerHTML = jobPickerRowsHtml(e.target.value, selectedJobId, highlight, currentRow) ||
      `<p class="muted small">No jobs with parts to match</p>`;
  });
  panel.addEventListener("click", (e) => {
    const option = e.target.closest("[data-job-id]");
    if (!option) return;
    const rowId = document.body.dataset.jobPickerRow || "";
    const rowEl = candidatesEl?.querySelector(`tr[data-id="${CSS.escape(rowId)}"]`);
    if (!rowEl) return;
    applyJobPickerValue(rowEl, option.dataset.jobId);
    closeJobPicker();
  });
  return panel;
}

function positionJobPickerPanel(toggle) {
  const panel = ensureJobPickerPanel();
  const rect = toggle.getBoundingClientRect();
  const width = Math.min(440, Math.max(300, window.innerWidth - 16));
  panel.style.width = `${Math.min(width, Math.max(320, rect.width + 120))}px`;
  panel.hidden = false;
  const panelRect = panel.getBoundingClientRect();
  let left = rect.left;
  if (left + panelRect.width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - panelRect.width - 8);
  }
  let top = rect.bottom + 4;
  if (top + panelRect.height > window.innerHeight - 8 && rect.top > panelRect.height + 8) {
    top = rect.top - panelRect.height - 4;
  }
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function openJobPicker(rowEl, toggle) {
  const panel = ensureJobPickerPanel();
  const selectedJobId = String(rowEl.querySelector('[data-field="jobId"]')?.value || "");
  const highlight = String(rowEl.querySelector('[data-field="description"]')?.value || "");
  const currentRow = candidates.find((item) => item.id === rowEl.dataset.id) || null;
  document.body.dataset.jobPickerRow = rowEl.dataset.id || "";
  const search = panel.querySelector(".job-picker-search");
  if (search) search.value = "";
  const list = panel.querySelector(".job-picker-list");
  if (list) {
    list.innerHTML = jobPickerRowsHtml("", selectedJobId, highlight, currentRow) ||
      `<p class="muted small">No jobs with parts to match</p>`;
  }
  positionJobPickerPanel(toggle);
  search?.focus();
}

function applyJobPickerValue(rowEl, jobId) {
  const field = rowEl.querySelector('[data-field="jobId"]');
  if (field) field.value = jobId || "";
  const toggle = rowEl.querySelector("[data-job-picker-toggle]");
  if (toggle) toggle.textContent = jobPickerLabel(findJob(jobId));
  refreshRowPreview(rowEl);
}

function bindJobPickers() {
  candidatesEl?.querySelectorAll("[data-job-picker-toggle]").forEach((toggle) => {
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      const rowEl = toggle.closest("tr[data-id]");
      if (!rowEl || toggle.disabled) return;
      const panel = ensureJobPickerPanel();
      const sameRow = document.body.dataset.jobPickerRow === rowEl.dataset.id && !panel.hidden;
      if (sameRow) {
        closeJobPicker();
        return;
      }
      openJobPicker(rowEl, toggle);
    });
  });
}

function fillJobsSelect() {
  /* Whole-invoice linked job removed — match each line to its own job. */
}

function isPdfRef(src) {
  return /\.pdf($|\?)/i.test(String(src || ""));
}

function invoiceFileRefs(invoice) {
  return (Array.isArray(invoice?.imageRefs) ? invoice.imageRefs : [])
    .map((src) => String(src || "").trim())
    .filter(Boolean);
}

function openInvoiceLightbox(src) {
  if (!lightboxEl || !src) return;
  const body = lightboxEl.querySelector(".supplier-invoice-lightbox-body");
  if (!body) return;
  if (isPdfRef(src)) {
    body.innerHTML = `<iframe src="${Admin.escapeAttr(src)}" title="Supplier invoice PDF"></iframe>`;
  } else {
    body.innerHTML = `<img src="${Admin.escapeAttr(src)}" alt="Supplier invoice" />`;
  }
  lightboxEl.hidden = false;
}

function closeInvoiceLightbox() {
  if (!lightboxEl) return;
  lightboxEl.hidden = true;
  const body = lightboxEl.querySelector(".supplier-invoice-lightbox-body");
  if (body) body.innerHTML = "";
}

function renderInvoicePreview(invoice) {
  if (!photosEl) return;
  const items = invoiceFileRefs(invoice);
  if (!items.length) {
    photosEl.innerHTML = "";
    return;
  }
  photosEl.innerHTML = items
    .map((src) => {
      if (isPdfRef(src)) {
        return `<button type="button" class="supplier-preview-tile is-pdf" data-preview-src="${Admin.escapeAttr(src)}">
            <span>PDF</span>
            <small>Tap to open</small>
          </button>`;
      }
      return `<button type="button" class="supplier-preview-tile" data-preview-src="${Admin.escapeAttr(src)}">
          <img src="${Admin.escapeAttr(src)}" alt="Supplier invoice" />
        </button>`;
    })
    .join("");
  photosEl.querySelectorAll("[data-preview-src]").forEach((btn) => {
    btn.addEventListener("click", () => openInvoiceLightbox(btn.dataset.previewSrc));
  });
}

async function attachOriginalFile(file) {
  if (!current?.id) throw new Error("Open a supplier invoice first.");
  if (!file) return;
  const body = new FormData();
  body.append("images", file);
  current = await Admin.api(`/api/supplier-invoices/${current.id}/images`, {
    method: "POST",
    body,
  });
  renderPhotos(current);
  await loadList();
  showStatus("Original file attached for preview");
}

async function importInvoiceFile(file) {
  if (!file) return;
  if (current?.id) {
    await attachOriginalFile(file);
    return;
  }
  const body = new FormData();
  body.append("file", file);
  const result = await Admin.api("/api/supplier-invoices/import-file", {
    method: "POST",
    body,
  });
  if (!result?.invoice?.id) throw new Error("Import finished but invoice is missing.");
  await loadInvoice(result.invoice.id);
  await loadList();
  listView.hidden = true;
  editView.hidden = false;
  Admin.setSection("supplier_invoices");
  Admin.setViewTitle(current.invoiceNo || "Supplier invoice");
  showStatus("Invoice imported and extracted");
}

function renderTracking() {
  const track = current?.tracking || {};
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = formatMoney(value);
  };
  set("track-supplier-cost", track.supplierCost || 0);
  set("track-consumable-cost", track.consumableCost || 0);
  set("track-tool-cost", track.toolCost || 0);
  set("track-pending-cost", track.pendingCost || 0);
  set("track-ignored-cost", track.ignoredCost || 0);
}

function renderOcrStatus() {
  if (!ocrStatusLine) return;
  if (!current?.id) {
    ocrStatusLine.textContent = "OCR pending";
    ocrStatusLine.className = "muted small supplier-ocr-status pending";
    return;
  }
  if (!candidates.length) {
    ocrStatusLine.textContent = "⚠ Please check (no extracted lines yet)";
    ocrStatusLine.className = "muted small supplier-ocr-status warn";
    return;
  }
  const avgConfidence =
    candidates.reduce((sum, row) => sum + (Number(row.confidence) || 0), 0) / candidates.length;
  const criticalOk = Boolean(current.supplier && current.invoiceNo && current.invoiceDate);
  if (criticalOk && avgConfidence >= 0.82) {
    ocrStatusLine.textContent = "✓ OCR verified";
    ocrStatusLine.className = "muted small supplier-ocr-status ok";
  } else {
    ocrStatusLine.textContent = "⚠ Please check";
    ocrStatusLine.className = "muted small supplier-ocr-status warn";
  }
}

function fillForm(invoice) {
  if (!form) return;
  const set = (name, value) => {
    const el = form.elements.namedItem(name);
    if (!el) return;
    el.value = value ?? "";
  };
  set("supplier", invoice.supplier);
  set("invoiceNo", invoice.invoiceNo);
  set("invoiceDate", invoice.invoiceDate);
  set("subtotal", invoice.subtotal);
  set("tax", invoice.tax);
  set("total", invoice.total);
  set("currency", invoice.currency || "NZD");
  set("notes", invoice.notes || "");
  renderPhotos(invoice);
  renderTracking();
  renderOcrStatus();
  ensureDuplicateHint();
  scheduleDuplicateCheck();
}

function collectForm() {
  return {
    supplier: String(form.elements.namedItem("supplier")?.value || "").trim(),
    invoiceNo: String(form.elements.namedItem("invoiceNo")?.value || "").trim(),
    invoiceDate: String(form.elements.namedItem("invoiceDate")?.value || "").trim(),
    subtotal: money(form.elements.namedItem("subtotal")?.value),
    tax: money(form.elements.namedItem("tax")?.value),
    total: money(form.elements.namedItem("total")?.value),
    linkedJobId: "",
    currency: String(form.elements.namedItem("currency")?.value || "NZD").trim().toUpperCase(),
    notes: String(form.elements.namedItem("notes")?.value || "").trim(),
  };
}

function ensureDuplicateHint() {
  if (!form) return;
  let hint = document.getElementById("supplier-invoice-duplicate-hint");
  if (hint) return hint;
  const invoiceInput = form.elements.namedItem("invoiceNo");
  const holder = invoiceInput?.closest("label");
  if (!holder) return null;
  hint = document.createElement("p");
  hint.id = "supplier-invoice-duplicate-hint";
  hint.className = "muted small supplier-duplicate-hint";
  hint.hidden = true;
  holder.appendChild(hint);
  return hint;
}

function setDuplicateHint(text, tone = "muted") {
  const hint = ensureDuplicateHint();
  if (!hint) return;
  if (!text) {
    hint.hidden = true;
    hint.textContent = "";
    hint.classList.remove("warn", "ok");
    return;
  }
  hint.hidden = false;
  hint.textContent = text;
  hint.classList.remove("warn", "ok");
  if (tone === "warn") hint.classList.add("warn");
  if (tone === "ok") hint.classList.add("ok");
}

async function checkDuplicateNow() {
  if (!form) return;
  const supplier = String(form.elements.namedItem("supplier")?.value || "").trim();
  const invoiceNo = String(form.elements.namedItem("invoiceNo")?.value || "").trim();
  if (!supplier || !invoiceNo) {
    setDuplicateHint("");
    return;
  }
  const nonce = ++duplicateCheckNonce;
  try {
    const res = await Admin.api(
      `/api/validation/duplicate-invoice?supplier=${encodeURIComponent(supplier)}&invoiceNo=${encodeURIComponent(invoiceNo)}`
    );
    if (nonce !== duplicateCheckNonce) return;
    if (res.duplicate) {
      const sameRecord = current?.id && res.supplierInvoiceId === current.id;
      if (sameRecord) setDuplicateHint("Same invoice record.", "ok");
      else setDuplicateHint(`Duplicate detected (invoice id ${res.supplierInvoiceId}).`, "warn");
    } else {
      setDuplicateHint("No duplicate found.", "ok");
    }
  } catch {
    if (nonce !== duplicateCheckNonce) return;
    setDuplicateHint("");
  }
}

function scheduleDuplicateCheck() {
  clearTimeout(duplicateCheckTimer);
  duplicateCheckTimer = setTimeout(checkDuplicateNow, 300);
}

function renderList() {
  if (!listEl) return;
  renderMonthConsumablesSummary();
  if (!rows.length) {
    listEl.innerHTML = '<div class="empty">No supplier invoices yet.</div>';
    return;
  }
  const query = searchEl?.value || "";
  const filtered = rows.filter((row) => invoiceMatchesSearch(row, query));
  if (!filtered.length) {
    listEl.innerHTML = '<div class="empty">No matching supplier, invoice number, or part.</div>';
    return;
  }
  const q = String(query).trim().toLowerCase();
  listEl.innerHTML =
    renderPriceHistory(query) +
    filtered
    .map((row) => {
      const totals = `${formatMoney(row.total)} · ${row.currency || "NZD"}`;
      const totalLines = Number(row.candidatesTotal) || 0;
      const resolved = Number(row.candidatesResolved) || 0;
      const match = totalLines
        ? `${resolved}/${totalLines} matched`
        : "No lines";
      const consumableNote =
        money(row.consumableCost) > 0
          ? ` · Consumables ${formatMoney(row.consumableCost)}`
          : "";
      const toolNote =
        money(row.toolCost) > 0 ? ` · Tools ${formatMoney(row.toolCost)}` : "";
      const lineHits = q
        ? matchingLines(row, q)
            .map((line) => {
              const name = [line.description, line.partNumber].filter(Boolean).join(" · ") || "Part";
              const qty = line.qty ? ` × ${line.qty}` : "";
              return `<li>${Admin.escapeHtml(name)}${Admin.escapeHtml(qty)} · ${Admin.escapeHtml(formatMoney(line.cost))}</li>`;
            })
            .join("")
        : "";
      return `<article class="report-card billing-card supplier-invoice-card" data-id="${Admin.escapeAttr(row.id)}">
        <div class="billing-number">${Admin.escapeHtml(row.invoiceNo || "No invoice #")}</div>
        <div>
          <h2>${Admin.escapeHtml(row.supplier || "Supplier")}</h2>
          <p class="muted">${Admin.escapeHtml(Admin.formatDateShort(row.invoiceDate) || "No date")} · ${Admin.escapeHtml(totals)} · ${Admin.escapeHtml(match)}${Admin.escapeHtml(consumableNote)}${Admin.escapeHtml(toolNote)}</p>
        </div>
        <span class="badge ${Admin.escapeAttr(row.status)}">${Admin.escapeHtml(statusBadge(row.status))}</span>
        ${lineHits ? `<ul class="supplier-line-hits">${lineHits}</ul>` : ""}
      </article>`;
    })
    .join("");
  listEl.querySelectorAll("[data-id]").forEach((card) => {
    card.addEventListener("click", () => openInvoice(card.dataset.id));
  });
}

function renderPhotos(invoice) {
  renderInvoicePreview(invoice);
}

function candidateRowStatus(row, selectedJobId) {
  if (row.decision === "accepted" || row.decision === "edited_then_accepted") {
    return { tone: "matched", label: "Matched" };
  }
  if (row.decision === "consumable") {
    return { tone: "consumable", label: "Consumable" };
  }
  if (row.decision === "tool") {
    return { tone: "tool", label: "Tool" };
  }
  if (row.decision === "rejected") {
    return { tone: "ignored", label: "Ignored" };
  }
  if (selectedJobId || row.suggestedJobId) {
    return { tone: "needs-match", label: "Suggested" };
  }
  return { tone: "needs-match", label: "Match" };
}

function normalizeTokenText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function plateKey(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function tokenize(value) {
  const text = normalizeTokenText(value);
  if (!text) return [];
  return text
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function tokenOverlapScore(aText, bText) {
  const a = new Set(tokenize(aText));
  const b = new Set(tokenize(bText));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap / Math.max(a.size, b.size);
}

function smartMatchForRow(row, rowEl) {
  const selected = String(rowEl?.querySelector('[data-field="jobId"]')?.value || "").trim();
  const candidateText = [
    row?.descriptionCandidate,
    row?.partNumberCandidate,
    row?.rawLineText,
    current?.notes,
  ]
    .filter(Boolean)
    .join(" ");
  const candidatePlate = plateKey(candidateText);
  const taken = jobsTakenForSamePart(row);
  let best = { jobId: "", score: 0, reason: "no match" };
  for (const job of jobs) {
    if (!jobMatchableLines(job).length) continue;
    if (taken.has(job.id) && job.id !== selected) continue;
    let score = 0;
    const reasons = [];
    if (job.id === selected) {
      score += 0.18;
      reasons.push("manual");
    }
    if (row?.suggestedJobId && job.id === row.suggestedJobId) {
      score += 0.3 + Math.min(0.25, Number(row.matchScore || 0) * 0.25);
      reasons.push("existing");
    }
    const jobPlate = plateKey(job.registration);
    if (jobPlate && candidatePlate && candidatePlate.includes(jobPlate)) {
      score += 0.6;
      reasons.push("rego");
    }
    const overlap =
      tokenOverlapScore(candidateText, job.workRequestedPreview) +
      tokenOverlapScore(candidateText, job.vehicle) +
      tokenOverlapScore(candidateText, job.customerName);
    if (overlap > 0) {
      score += Math.min(0.55, overlap * 0.55);
      reasons.push("keywords");
    }
    if (score > best.score) {
      best = { jobId: job.id, score: Math.min(1, score), reason: reasons.join("+") || "score" };
    }
  }
  return best;
}

function renderStatusPill(row, selectedJobId) {
  const status = candidateRowStatus(row, selectedJobId);
  return `<span class="supplier-status-pill ${Admin.escapeAttr(status.tone)}"><span class="dot" aria-hidden="true"></span>${Admin.escapeHtml(status.label)}</span>`;
}

function refreshRowPreview(rowEl) {
  const rowId = rowEl?.dataset?.id || "";
  const row = candidates.find((item) => item.id === rowId);
  if (!row) return;
  const selectedJobId = String(rowEl.querySelector('[data-field="jobId"]')?.value || "").trim();
  const statusCell = rowEl.querySelector(".supplier-line-status");
  if (statusCell) statusCell.innerHTML = renderStatusPill(row, selectedJobId);
  const regoCell = rowEl.querySelector(".supplier-rego");
  const job = findJob(selectedJobId);
  if (regoCell) regoCell.textContent = job?.registration || "—";
  const suggestionEl = rowEl.querySelector(".supplier-suggestion");
  if (suggestionEl) suggestionEl.textContent = rowJobCell(row, selectedJobId);
}

function candidatePayloadFromRowEl(rowEl) {
  return {
    jobId: rowEl.querySelector('[data-field="jobId"]')?.value || "",
    part: {
      partNumber: rowEl.querySelector('[data-field="partNumber"]')?.value || "",
      description: rowEl.querySelector('[data-field="description"]')?.value || "",
      qty: Math.max(0, Math.round(Number(rowEl.querySelector('[data-field="qty"]')?.value || 0))),
      costPrice: Number(rowEl.querySelector('[data-field="costPrice"]')?.value || 0),
      markupPercent: 25,
      supplier: current?.supplier || "",
      supplierInvoiceNo: current?.invoiceNo || "",
      supplierInvoiceDate: current?.invoiceDate || "",
    },
  };
}

function rowJobCell(row, selectedJobId) {
  const jobId = selectedJobId || row.suggestedJobId || "";
  const job = findJob(jobId);
  if (!job) return "—";
  const score = Math.round((Number(row.matchScore) || 0) * 100);
  const preview = job.workRequestedPreview ? ` · ${job.workRequestedPreview}` : "";
  const reason = row.matchReason ? ` · ${row.matchReason}` : "";
  return `${job.number || "Job"}${preview} (${score || 0}% match${reason})`;
}

function isMatchedDecision(decision) {
  return decision === "accepted" || decision === "edited_then_accepted";
}

async function applyCandidateAction(id, action, rowEl) {
  if (action === "reject") {
    await Admin.api(`/api/invoice-candidates/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: "Ignored in supplier flow" }),
    });
    return null;
  }
  if (action === "consumable") {
    await Admin.api(`/api/invoice-candidates/${id}/consumable`, {
      method: "POST",
      body: JSON.stringify({ reason: "Shop consumable" }),
    });
    return null;
  }
  if (action === "tool") {
    await Admin.api(`/api/invoice-candidates/${id}/tool`, {
      method: "POST",
      body: JSON.stringify({ reason: "Shop tool" }),
    });
    return null;
  }
  if (action === "unmatch") {
    return Admin.api(`/api/invoice-candidates/${id}/unmatch`, {
      method: "POST",
      body: "{}",
    });
  }
  const payload = candidatePayloadFromRowEl(rowEl);
  if (action === "save-matched") {
    return Admin.api(`/api/invoice-candidates/${id}/edit-matched`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }
  if (action === "edit-accept") {
    return Admin.api(`/api/invoice-candidates/${id}/edit-accept`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
  return Admin.api(`/api/invoice-candidates/${id}/accept`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function runBulkAction(action) {
  if (!current?.id) return;
  const ids = [...selectedCandidateIds].filter((id) => {
    const row = candidates.find((item) => item.id === id);
    return row && row.decision === "pending";
  });
  if (!ids.length) return;
  let ok = 0;
  const failures = [];
  for (const id of ids) {
    const rowEl = candidatesEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!rowEl) continue;
    try {
      await applyCandidateAction(id, action, rowEl);
      selectedCandidateIds.delete(id);
      ok += 1;
    } catch (err) {
      failures.push(err.message || "Request failed");
    }
  }
  await loadInvoice(current.id);
  await loadList();
  if (!failures.length) showStatus(`Batch complete: ${ok} updated`);
  else alert(`Batch partial.\nSuccess: ${ok}\nFailed: ${failures.length}\n${failures[0]}`);
}

function renderCandidates() {
  if (!candidatesEl) return;
  closeJobPicker();
  renderOcrStatus();
  if (!candidates.length) {
    selectedCandidateIds = new Set();
    candidatesEl.innerHTML = '<div class="empty">No extracted items yet. Upload an invoice file first.</div>';
    return;
  }
  const validIds = new Set(candidates.map((row) => row.id));
  selectedCandidateIds = new Set([...selectedCandidateIds].filter((id) => validIds.has(id)));
  const pendingRows = candidates.filter((row) => row.decision === "pending");
  const allPendingSelected =
    pendingRows.length > 0 && pendingRows.every((row) => selectedCandidateIds.has(row.id));
  const selectedCount = [...selectedCandidateIds].filter((id) =>
    pendingRows.some((row) => row.id === id)
  ).length;

  candidatesEl.innerHTML = `
    <div class="supplier-candidate-bulk">
      <label class="check">
        <input type="checkbox" id="supplier-candidates-select-all" ${allPendingSelected ? "checked" : ""} />
        Select all pending
      </label>
      <span class="muted small">${selectedCount} selected</span>
      <button type="button" class="ghost" id="btn-candidates-bulk-accept"${selectedCount ? "" : " disabled"}>Accept</button>
      <button type="button" class="ghost" id="btn-candidates-bulk-edit-accept"${selectedCount ? "" : " disabled"}>Change Job + Accept</button>
      <button type="button" class="ghost" id="btn-candidates-bulk-consumable"${selectedCount ? "" : " disabled"}>Consumable</button>
      <button type="button" class="ghost" id="btn-candidates-bulk-tool"${selectedCount ? "" : " disabled"}>Tool</button>
      <button type="button" class="danger" id="btn-candidates-bulk-reject"${selectedCount ? "" : " disabled"}>Ignore</button>
    </div>
    <div class="line-table-wrap">
      <table class="line-table supplier-lines-table">
        <thead>
          <tr>
            <th></th>
            <th>Qty</th>
            <th><span class="th-two-line">PART<br />NAME</span></th>
            <th><span class="th-two-line">PART<br />NUMBER</span></th>
            <th>Cost ex GST</th>
            <th>Job</th>
            <th>Rego</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${candidates
            .map((row) => {
              const selectedJobId = row.appliedJobId || row.suggestedJobId || "";
              const matched = isMatchedDecision(row.decision);
              const editing = matched && editingCandidateIds.has(row.id);
              const pending = row.decision === "pending";
              const ignored = row.decision === "rejected";
              const consumable = row.decision === "consumable";
              const tool = row.decision === "tool";
              const fieldsLocked = !pending && !editing;
              const disabled = fieldsLocked ? " disabled" : "";
              const rego = findJob(selectedJobId)?.registration || "—";
              const statusHtml = renderStatusPill(row, selectedJobId);
              const unmatchBtn = `<button type="button" class="danger" data-action="unmatch">Unmatch</button>`;
              const actions = matched
                ? editing
                  ? `<button type="button" class="primary" data-action="save-matched">Save</button>
                  <button type="button" class="ghost" data-action="cancel-edit">Cancel</button>`
                  : `${unmatchBtn}
                  <button type="button" class="ghost" data-action="start-edit">Edit</button>`
                : ignored || consumable || tool
                  ? `<button type="button" class="ghost" data-action="unmatch">Restore</button>`
                : `${selectedJobId ? unmatchBtn : ""}
                  <button type="button" class="ghost" data-action="smart-match"${pending ? "" : " disabled"}>Smart Match</button>
                  <button type="button" class="ghost" data-action="accept"${pending ? "" : " disabled"}>Accept</button>
                  <button type="button" class="ghost" data-action="edit-accept"${pending ? "" : " disabled"}>Change Job</button>
                  <button type="button" class="ghost" data-action="consumable"${pending ? "" : " disabled"}>Consumable</button>
                  <button type="button" class="ghost" data-action="tool"${pending ? "" : " disabled"}>Tool</button>
                  <button type="button" class="danger" data-action="reject"${pending ? "" : " disabled"}>Ignore</button>`;
              return `<tr data-id="${Admin.escapeAttr(row.id)}" class="${matched ? "is-matched" : ""} ${editing ? "is-editing" : ""}">
                <td><input type="checkbox" data-select-candidate ${selectedCandidateIds.has(row.id) ? "checked" : ""}${pending ? "" : " disabled"} /></td>
                <td><input data-field="qty" type="number" min="1" step="1" inputmode="numeric" value="${Admin.escapeAttr(String(Math.max(1, Math.round(Number(row.qtyCandidate) || 1))))}"${disabled} /></td>
                <td><input data-field="description" value="${Admin.escapeAttr(row.descriptionCandidate || "")}"${disabled} /></td>
                <td><input data-field="partNumber" value="${Admin.escapeAttr(row.partNumberCandidate || "")}"${disabled} /></td>
                <td><input data-field="costPrice" type="number" min="0" step="0.01" value="${Admin.escapeAttr(String(row.costPriceCandidate ?? 0))}"${disabled} /></td>
                <td class="supplier-job-cell">
                  <div class="job-picker">
                    <input type="hidden" data-field="jobId" value="${Admin.escapeAttr(selectedJobId)}" />
                    <button type="button" class="job-picker-toggle" data-job-picker-toggle${fieldsLocked ? " disabled" : ""}>
                      ${Admin.escapeHtml(jobPickerLabel(findJob(selectedJobId)))}
                    </button>
                  </div>
                  <div class="muted small supplier-suggestion">${Admin.escapeHtml(rowJobCell(row, selectedJobId))}</div>
                </td>
                <td class="supplier-rego">${Admin.escapeHtml(rego)}</td>
                <td class="supplier-line-status">${statusHtml}</td>
                <td class="supplier-line-actions">
                  ${actions}
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById("supplier-candidates-select-all")?.addEventListener("change", (e) => {
    if (e.target.checked) {
      pendingRows.forEach((row) => selectedCandidateIds.add(row.id));
    } else {
      pendingRows.forEach((row) => selectedCandidateIds.delete(row.id));
    }
    renderCandidates();
  });
  document.getElementById("btn-candidates-bulk-accept")?.addEventListener("click", async () => {
    await runBulkAction("accept");
  });
  document.getElementById("btn-candidates-bulk-edit-accept")?.addEventListener("click", async () => {
    await runBulkAction("edit-accept");
  });
  document.getElementById("btn-candidates-bulk-consumable")?.addEventListener("click", async () => {
    await runBulkAction("consumable");
  });
  document.getElementById("btn-candidates-bulk-tool")?.addEventListener("click", async () => {
    await runBulkAction("tool");
  });
  document.getElementById("btn-candidates-bulk-reject")?.addEventListener("click", async () => {
    await runBulkAction("reject");
  });
  candidatesEl.querySelectorAll("[data-select-candidate]").forEach((box) => {
    box.addEventListener("change", () => {
      const rowEl = box.closest("tr[data-id]");
      if (!rowEl) return;
      if (box.checked) selectedCandidateIds.add(rowEl.dataset.id);
      else selectedCandidateIds.delete(rowEl.dataset.id);
      renderCandidates();
    });
  });
  bindJobPickers();
  candidatesEl.querySelectorAll('[data-field="qty"]').forEach((el) => {
    el.addEventListener("change", () => {
      el.value = String(Math.max(1, Math.round(Number(el.value) || 1)));
    });
  });
  candidatesEl.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rowEl = btn.closest("tr[data-id]");
      if (!rowEl || !current?.id) {
        showStatus("Open a saved invoice first.");
        return;
      }
      const id = rowEl.dataset.id;
      if (btn.dataset.action === "smart-match") {
        const row = candidates.find((item) => item.id === id);
        if (!row) return;
        const picked = smartMatchForRow(row, rowEl);
        if (!picked.jobId) {
          showStatus("Smart match did not find a strong candidate.");
          return;
        }
        applyJobPickerValue(rowEl, picked.jobId);
        row.suggestedJobId = picked.jobId;
        row.matchScore = picked.score;
        row.matchReason = `smart:${picked.reason}`;
        refreshRowPreview(rowEl);
        showStatus(`Smart match ${(picked.score * 100).toFixed(0)}%`);
        return;
      }
      if (btn.dataset.action === "edit-accept") {
        const toggle = rowEl.querySelector("[data-job-picker-toggle]");
        if (toggle && !toggle.disabled) openJobPicker(rowEl, toggle);
        showStatus("Pick a job, then click Accept.");
        return;
      }
      if (btn.dataset.action === "start-edit") {
        editingCandidateIds.add(id);
        renderCandidates();
        candidatesEl
          ?.querySelector(`tr[data-id="${CSS.escape(id)}"] [data-field="description"]`)
          ?.focus();
        showStatus("Editing matched line");
        return;
      }
      if (btn.dataset.action === "cancel-edit") {
        editingCandidateIds.delete(id);
        renderCandidates();
        showStatus("Edit cancelled");
        return;
      }
      try {
        btn.disabled = true;
        const decisionBefore = candidates.find((item) => item.id === id)?.decision;
        const wasIgnored = btn.dataset.action === "unmatch" && decisionBefore === "rejected";
        const wasShopClassified =
          btn.dataset.action === "unmatch" &&
          (decisionBefore === "consumable" || decisionBefore === "tool");
        if (btn.dataset.action === "unmatch") {
          showStatus(wasIgnored || wasShopClassified ? "Restoring…" : "Unmatching…");
        }
        const result = await applyCandidateAction(id, btn.dataset.action, rowEl);
        editingCandidateIds.delete(id);
        await loadInvoice(current.id);
        await loadList();
        const leftoverQty = Number(result?.remainderCandidate?.qtyCandidate) || 0;
        const leftover =
          leftoverQty > 0 ? ` · ${leftoverQty} left in list to allocate` : "";
        const done =
          btn.dataset.action === "reject"
            ? "Ignored"
            : btn.dataset.action === "consumable"
              ? "Marked as consumable"
            : btn.dataset.action === "tool"
              ? "Marked as tool"
            : btn.dataset.action === "unmatch"
              ? wasIgnored || wasShopClassified
                ? "Restored — ready to match"
                : "Unmatched — ready to rematch"
              : btn.dataset.action === "save-matched"
                ? `Matched line saved${leftover}`
                : `Accepted${leftover}`;
        showStatus(done);
      } catch (err) {
        btn.disabled = false;
        showStatus(err.message || "Request failed");
      }
    });
  });
}

async function loadJobs() {
  jobs = await Admin.api("/api/jobs");
}

async function loadList() {
  rows = await Admin.api("/api/supplier-invoices");
  renderList();
}

async function loadInvoice(id) {
  current = await Admin.api(`/api/supplier-invoices/${id}`);
  candidates = await Admin.api(`/api/supplier-invoices/${id}/candidates`);
  fillForm(current);
  renderCandidates();
}

async function openInvoice(id) {
  await loadInvoice(id);
  if (section && section.hidden) Admin.setSection("supplier_invoices");
  listView.hidden = true;
  editView.hidden = false;
  Admin.setViewTitle(current.invoiceNo || "Supplier invoice");
}

async function showList() {
  current = null;
  candidates = [];
  await loadJobs();
  await loadList();
  listView.hidden = false;
  editView.hidden = true;
  Admin.setViewTitle("Supplier invoices");
}

function openNew() {
  current = emptyInvoice();
  candidates = [];
  selectedCandidateIds = new Set();
  editingCandidateIds = new Set();
  fillForm(current);
  renderCandidates();
  if (rawTextEl) rawTextEl.value = "";
  setDuplicateHint("");
  listView.hidden = true;
  editView.hidden = false;
  Admin.setViewTitle("New supplier invoice");
}

async function saveInvoice() {
  const payload = collectForm();
  if (!payload.supplier || !payload.invoiceNo) {
    throw new Error("Supplier and invoice number are required.");
  }
  if (!current?.id) {
    current = await Admin.api("/api/supplier-invoices", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    showStatus("Supplier invoice created");
  } else {
    current = await Admin.api(`/api/supplier-invoices/${current.id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    showStatus("Supplier invoice saved");
  }
  await loadInvoice(current.id);
  await loadList();
}

async function parseRawText() {
  if (!current?.id) {
    alert("Save supplier invoice first.");
    return;
  }
  const rawText = String(rawTextEl?.value || "").trim();
  if (!rawText) {
    alert("Paste OCR text first.");
    return;
  }
  await Admin.api(`/api/supplier-invoices/${current.id}/parse`, {
    method: "POST",
    body: JSON.stringify({ rawText }),
  });
  showStatus("OCR text re-parsed");
  await loadInvoice(current.id);
  await loadList();
}

async function autoMatch() {
  if (!current?.id) return;
  await Admin.api(`/api/supplier-invoices/${current.id}/auto-match`, {
    method: "POST",
    body: "{}",
  });
  showStatus("Auto-match complete");
  await loadInvoice(current.id);
}

searchEl?.addEventListener("input", renderList);
searchEl?.addEventListener("search", renderList);
form?.elements.namedItem("supplier")?.addEventListener("input", scheduleDuplicateCheck);
form?.elements.namedItem("invoiceNo")?.addEventListener("input", scheduleDuplicateCheck);
form?.elements.namedItem("supplier")?.addEventListener("change", scheduleDuplicateCheck);
form?.elements.namedItem("invoiceNo")?.addEventListener("change", scheduleDuplicateCheck);

document.getElementById("btn-supplier-invoice-refresh")?.addEventListener("click", async () => {
  try {
    await showList();
  } catch (err) {
    alert(err.message);
  }
});
document.getElementById("btn-supplier-invoice-new")?.addEventListener("click", openNew);
document.getElementById("btn-supplier-invoice-import")?.addEventListener("click", () => {
  importFileInput?.click();
});
document.getElementById("btn-supplier-invoice-import-inline")?.addEventListener("click", () => {
  importFileInputInline?.click();
});
document.getElementById("btn-supplier-invoice-back")?.addEventListener("click", async () => {
  try {
    await showList();
  } catch (err) {
    alert(err.message);
  }
});
document.getElementById("btn-supplier-invoice-save")?.addEventListener("click", async () => {
  try {
    await saveInvoice();
  } catch (err) {
    alert(err.message);
  }
});
document.getElementById("btn-supplier-invoice-parse")?.addEventListener("click", async () => {
  try {
    await parseRawText();
  } catch (err) {
    alert(err.message);
  }
});
document.getElementById("btn-supplier-invoice-auto-match")?.addEventListener("click", async () => {
  try {
    await autoMatch();
  } catch (err) {
    alert(err.message);
  }
});
importFileInput?.addEventListener("change", async () => {
  try {
    const file = importFileInput.files?.[0];
    if (!file) return;
    current = null;
    await importInvoiceFile(file);
  } catch (err) {
    alert(err.message);
  } finally {
    importFileInput.value = "";
  }
});
importFileInputInline?.addEventListener("change", async () => {
  try {
    const file = importFileInputInline.files?.[0];
    if (!file) return;
    await importInvoiceFile(file);
  } catch (err) {
    alert(err.message);
  } finally {
    importFileInputInline.value = "";
  }
});

document.addEventListener("mousedown", (e) => {
  const panel = document.getElementById("supplier-job-picker-panel");
  if (!panel || panel.hidden) return;
  if (panel.contains(e.target) || e.target.closest("[data-job-picker-toggle]")) return;
  closeJobPicker();
});

document.getElementById("btn-supplier-lightbox-close")?.addEventListener("click", closeInvoiceLightbox);
lightboxEl?.addEventListener("click", (e) => {
  if (e.target === lightboxEl) closeInvoiceLightbox();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeInvoiceLightbox();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeJobPicker();
});

window.DeaneSupplierInvoices = {
  showList,
  openInvoice,
  openNew,
};
})();
