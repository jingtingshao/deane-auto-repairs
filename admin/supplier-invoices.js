(function () {
const Admin = window.DeaneAdmin;

const section = document.getElementById("supplier-invoices-section");
const listView = document.getElementById("supplier-invoices-list-view");
const editView = document.getElementById("supplier-invoices-edit-view");
const listEl = document.getElementById("supplier-invoices-list");
const searchEl = document.getElementById("supplier-invoices-search");
const form = document.getElementById("supplier-invoice-form");
const jobsSelect = document.getElementById("supplier-invoice-job-select");
const importFileInput = document.getElementById("supplier-invoice-import-file");
const photosEl = document.getElementById("supplier-invoice-photos");
const imagesInput = document.getElementById("supplier-invoice-images");
const rawTextEl = document.getElementById("supplier-invoice-raw-text");
const candidatesEl = document.getElementById("supplier-candidates-list");
const saveStatus = document.getElementById("supplier-invoice-save-status");

let rows = [];
let jobs = [];
let current = null;
let candidates = [];
let selectedCandidateIds = new Set();
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

function invoiceMatchesSearch(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return (
    String(row.supplier || "").toLowerCase().includes(q) ||
    String(row.invoiceNo || "").toLowerCase().includes(q)
  );
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
  };
}

function fillJobsSelect(selected = "") {
  if (!jobsSelect) return;
  const opts = jobs
    .slice()
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .map((job) => {
      const label = `${job.number || "Job"} · ${job.registration || "No plate"} · ${job.customerName || ""}`;
      return `<option value="${Admin.escapeAttr(job.id)}">${Admin.escapeHtml(label)}</option>`;
    })
    .join("");
  jobsSelect.innerHTML = `<option value="">Not linked</option>${opts}`;
  jobsSelect.value = selected || "";
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
  fillJobsSelect(invoice.linkedJobId || "");
  renderPhotos(invoice);
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
    linkedJobId: String(form.elements.namedItem("linkedJobId")?.value || "").trim(),
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
      if (sameRecord) {
        setDuplicateHint("Same invoice record.", "ok");
      } else {
        setDuplicateHint(`Duplicate detected (invoice id ${res.supplierInvoiceId}).`, "warn");
      }
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
  duplicateCheckTimer = setTimeout(() => {
    checkDuplicateNow();
  }, 350);
}

function renderList() {
  if (!listEl) return;
  if (!rows.length) {
    listEl.innerHTML = '<div class="empty">No supplier invoices yet.</div>';
    return;
  }
  const query = searchEl?.value || "";
  const filtered = rows.filter((row) => invoiceMatchesSearch(row, query));
  if (!filtered.length) {
    listEl.innerHTML = '<div class="empty">No matching supplier or invoice number.</div>';
    return;
  }
  listEl.innerHTML = filtered
    .map((row) => {
      const totals = `${formatMoney(row.total)} · ${row.currency || "NZD"}`;
      const match = `${row.candidatesAccepted || 0}/${row.candidatesTotal || 0} accepted`;
      return `<article class="report-card billing-card supplier-invoice-card" data-id="${Admin.escapeAttr(row.id)}">
        <div class="billing-number">${Admin.escapeHtml(row.invoiceNo || "No invoice #")}</div>
        <div>
          <h2>${Admin.escapeHtml(row.supplier || "Supplier")}</h2>
          <p class="muted">${Admin.escapeHtml(Admin.formatDateShort(row.invoiceDate) || "No date")} · ${Admin.escapeHtml(totals)} · ${Admin.escapeHtml(match)}</p>
        </div>
        <span class="badge ${Admin.escapeAttr(row.status)}">${Admin.escapeHtml(statusBadge(row.status))}</span>
      </article>`;
    })
    .join("");
  listEl.querySelectorAll("[data-id]").forEach((card) => {
    card.addEventListener("click", () => openInvoice(card.dataset.id));
  });
}

function renderPhotos(invoice) {
  if (!photosEl) return;
  const items = Array.isArray(invoice.imageRefs) ? invoice.imageRefs : [];
  if (!items.length) {
    photosEl.innerHTML = "";
    return;
  }
  photosEl.innerHTML = items
    .map(
      (src) => `<span class="photo-thumb"><img src="${Admin.escapeAttr(src)}" alt="Supplier invoice photo" /></span>`
    )
    .join("");
}

function renderCandidates() {
  if (!candidatesEl) return;
  if (!candidates.length) {
    selectedCandidateIds = new Set();
    candidatesEl.innerHTML = '<div class="empty">No candidates yet. Paste OCR text and click Parse OCR text.</div>';
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
  candidatesEl.innerHTML = candidates
    .map((row, idx) => ({ row, idx }))
    .map(({ row, idx }) => {
      if (idx === 0) {
        return `
          <div class="supplier-candidate-bulk">
            <label class="check">
              <input type="checkbox" id="supplier-candidates-select-all" ${allPendingSelected ? "checked" : ""} />
              Select all pending
            </label>
            <span class="muted small">${selectedCount} selected</span>
            <button type="button" class="ghost" id="btn-candidates-bulk-accept"${selectedCount ? "" : " disabled"}>Bulk accept</button>
            <button type="button" class="ghost" id="btn-candidates-bulk-edit-accept"${selectedCount ? "" : " disabled"}>Bulk edit & accept</button>
            <button type="button" class="danger" id="btn-candidates-bulk-reject"${selectedCount ? "" : " disabled"}>Bulk reject</button>
          </div>
        `;
      }
      return "";
    })
    .join("") + candidates
    .map((row) => {
      const status = row.decision === "pending" ? "Pending" : row.decision.replaceAll("_", " ");
      const suggestedJob = row.suggestedJobId || current?.linkedJobId || "";
      const selectable = row.decision === "pending";
      return `<article class="supplier-candidate-card" data-id="${Admin.escapeAttr(row.id)}">
        <div class="supplier-candidate-head">
          <label class="check candidate-select">
            <input type="checkbox" data-select-candidate ${selectedCandidateIds.has(row.id) ? "checked" : ""}${selectable ? "" : " disabled"} />
            Pick
          </label>
          <strong>Line ${Number(row.lineNo) || "?"}</strong>
          <span class="badge ${Admin.escapeAttr(row.decision === "pending" ? "draft" : "accepted")}">${Admin.escapeHtml(status)}</span>
        </div>
        <p class="muted small">${Admin.escapeHtml(row.rawLineText || "")}</p>
        <div class="supplier-candidate-grid">
          <label>Job
            <select data-field="jobId">
              <option value="">Choose job…</option>
              ${jobs
                .map((job) => {
                  const label = `${job.number || "Job"} · ${job.registration || "No plate"}`;
                  const selected = suggestedJob === job.id ? " selected" : "";
                  return `<option value="${Admin.escapeAttr(job.id)}"${selected}>${Admin.escapeHtml(label)}</option>`;
                })
                .join("")}
            </select>
          </label>
          <label>Part #
            <input data-field="partNumber" value="${Admin.escapeAttr(row.partNumberCandidate || "")}" />
          </label>
          <label>Description
            <input data-field="description" value="${Admin.escapeAttr(row.descriptionCandidate || "")}" />
          </label>
          <label>Qty
            <input data-field="qty" type="number" min="0" step="0.01" value="${Admin.escapeAttr(String(row.qtyCandidate ?? 1))}" />
          </label>
          <label>Cost
            <input data-field="costPrice" type="number" min="0" step="0.01" value="${Admin.escapeAttr(String(row.costPriceCandidate ?? 0))}" />
          </label>
          <label>Markup %
            <input data-field="markupPercent" type="number" min="0" step="0.01" value="25" />
          </label>
        </div>
        <p class="muted small">Match: ${Admin.escapeHtml(row.matchReason || "—")} · score ${(Number(row.matchScore) || 0).toFixed(2)} · confidence ${(Number(row.confidence) || 0).toFixed(2)}</p>
        <div class="line-actions">
          <button type="button" class="ghost" data-action="accept"${row.decision !== "pending" ? " disabled" : ""}>Accept</button>
          <button type="button" class="ghost" data-action="edit-accept"${row.decision !== "pending" ? " disabled" : ""}>Edit & accept</button>
          <button type="button" class="danger" data-action="reject"${row.decision !== "pending" ? " disabled" : ""}>Reject</button>
        </div>
      </article>`;
    })
    .join("");

  candidatesEl.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest("[data-id]");
      if (!card || !current?.id) return;
      const id = card.dataset.id;
      const values = {
        jobId: card.querySelector('[data-field="jobId"]')?.value || "",
        part: {
          partNumber: card.querySelector('[data-field="partNumber"]')?.value || "",
          description: card.querySelector('[data-field="description"]')?.value || "",
          qty: Number(card.querySelector('[data-field="qty"]')?.value || 0),
          costPrice: Number(card.querySelector('[data-field="costPrice"]')?.value || 0),
          markupPercent: Number(card.querySelector('[data-field="markupPercent"]')?.value || 0),
          supplier: current.supplier,
          supplierInvoiceNo: current.invoiceNo,
          supplierInvoiceDate: current.invoiceDate,
        },
      };
      try {
        if (btn.dataset.action === "reject") {
          await Admin.api(`/api/invoice-candidates/${id}/reject`, {
            method: "POST",
            body: JSON.stringify({ reason: "Rejected from admin UI" }),
          });
          showStatus("Candidate rejected");
        } else if (btn.dataset.action === "edit-accept") {
          await Admin.api(`/api/invoice-candidates/${id}/edit-accept`, {
            method: "POST",
            body: JSON.stringify(values),
          });
          showStatus("Candidate edited and accepted");
        } else {
          await Admin.api(`/api/invoice-candidates/${id}/accept`, {
            method: "POST",
            body: JSON.stringify(values),
          });
          showStatus("Candidate accepted");
        }
        await loadInvoice(current.id);
      } catch (err) {
        alert(err.message);
      }
    });
  });
  const selectAll = document.getElementById("supplier-candidates-select-all");
  selectAll?.addEventListener("change", () => {
    if (selectAll.checked) {
      candidates
        .filter((row) => row.decision === "pending")
        .forEach((row) => selectedCandidateIds.add(row.id));
    } else {
      candidates
        .filter((row) => row.decision === "pending")
        .forEach((row) => selectedCandidateIds.delete(row.id));
    }
    renderCandidates();
  });
  candidatesEl.querySelectorAll("[data-select-candidate]").forEach((box) => {
    box.addEventListener("change", () => {
      const card = box.closest("[data-id]");
      if (!card) return;
      if (box.checked) selectedCandidateIds.add(card.dataset.id);
      else selectedCandidateIds.delete(card.dataset.id);
      renderCandidates();
    });
  });
  document.getElementById("btn-candidates-bulk-accept")?.addEventListener("click", async () => {
    await runBulkAction("accept");
  });
  document.getElementById("btn-candidates-bulk-edit-accept")?.addEventListener("click", async () => {
    await runBulkAction("edit-accept");
  });
  document.getElementById("btn-candidates-bulk-reject")?.addEventListener("click", async () => {
    await runBulkAction("reject");
  });
}

function payloadFromCandidateCard(card) {
  return {
    jobId: card.querySelector('[data-field="jobId"]')?.value || "",
    part: {
      partNumber: card.querySelector('[data-field="partNumber"]')?.value || "",
      description: card.querySelector('[data-field="description"]')?.value || "",
      qty: Number(card.querySelector('[data-field="qty"]')?.value || 0),
      costPrice: Number(card.querySelector('[data-field="costPrice"]')?.value || 0),
      markupPercent: Number(card.querySelector('[data-field="markupPercent"]')?.value || 0),
      supplier: current?.supplier || "",
      supplierInvoiceNo: current?.invoiceNo || "",
      supplierInvoiceDate: current?.invoiceDate || "",
    },
  };
}

async function runBulkAction(action) {
  if (!current?.id) return;
  const targetIds = [...selectedCandidateIds].filter((id) => {
    const row = candidates.find((c) => c.id === id);
    return row && row.decision === "pending";
  });
  if (!targetIds.length) return;
  let ok = 0;
  const failures = [];
  for (const id of targetIds) {
    const card = candidatesEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!card) continue;
    try {
      if (action === "reject") {
        await Admin.api(`/api/invoice-candidates/${id}/reject`, {
          method: "POST",
          body: JSON.stringify({ reason: "Bulk rejected from admin UI" }),
        });
      } else if (action === "edit-accept") {
        await Admin.api(`/api/invoice-candidates/${id}/edit-accept`, {
          method: "POST",
          body: JSON.stringify(payloadFromCandidateCard(card)),
        });
      } else {
        await Admin.api(`/api/invoice-candidates/${id}/accept`, {
          method: "POST",
          body: JSON.stringify(payloadFromCandidateCard(card)),
        });
      }
      ok += 1;
      selectedCandidateIds.delete(id);
    } catch (err) {
      failures.push(err.message || "Request failed");
    }
  }
  await loadInvoice(current.id);
  await loadList();
  if (!failures.length) {
    showStatus(`Batch complete: ${ok} updated`);
    return;
  }
  showStatus(`Batch partial: ${ok} updated, ${failures.length} failed`);
  alert(`Bulk action finished.\n\nSuccess: ${ok}\nFailed: ${failures.length}\n\nFirst error: ${failures[0]}`);
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
  await loadJobs();
  await loadList();
  listView.hidden = false;
  editView.hidden = true;
  Admin.setViewTitle("Supplier invoices");
}

function openNew() {
  current = emptyInvoice();
  candidates = [];
  fillForm(current);
  renderCandidates();
  if (rawTextEl) rawTextEl.value = "";
  selectedCandidateIds = new Set();
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

async function uploadImages() {
  if (!current?.id) {
    alert("Save supplier invoice first.");
    return;
  }
  if (!imagesInput?.files?.length) return;
  const body = new FormData();
  for (const file of imagesInput.files) body.append("images", file);
  current = await Admin.api(`/api/supplier-invoices/${current.id}/images`, {
    method: "POST",
    body,
  });
  renderPhotos(current);
  imagesInput.value = "";
  showStatus("Invoice images uploaded");
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
  showStatus("OCR text parsed");
  await loadInvoice(current.id);
  await loadList();
}

async function autoMatch() {
  if (!current?.id) return;
  await Admin.api(`/api/supplier-invoices/${current.id}/auto-match`, { method: "POST", body: "{}" });
  showStatus("Auto-match complete");
  await loadInvoice(current.id);
}

async function importPdf(file) {
  if (!file) return;
  const body = new FormData();
  body.append("file", file);
  const result = await Admin.api("/api/supplier-invoices/import-file", {
    method: "POST",
    body,
  });
  current = result.invoice || null;
  candidates = result.candidates || [];
  if (!current?.id) {
    throw new Error("Import succeeded but invoice id missing.");
  }
  fillForm(current);
  renderCandidates();
  listView.hidden = true;
  editView.hidden = false;
  Admin.setSection("supplier_invoices");
  Admin.setViewTitle(current.invoiceNo || "Supplier invoice");
  await loadList();
  showStatus("PDF imported and parsed");
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
imagesInput?.addEventListener("change", async () => {
  try {
    await uploadImages();
  } catch (err) {
    alert(err.message);
  }
});
importFileInput?.addEventListener("change", async () => {
  try {
    const file = importFileInput.files?.[0];
    if (!file) return;
    await importPdf(file);
  } catch (err) {
    alert(err.message);
  } finally {
    importFileInput.value = "";
  }
});

window.DeaneSupplierInvoices = {
  showList,
  openInvoice,
  openNew,
};
})();
