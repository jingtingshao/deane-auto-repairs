(function () {
var Admin = window.DeaneAdmin;

const billingListView = document.getElementById("billing-list-view");
const billingEditView = document.getElementById("billing-edit-view");
const billingList = document.getElementById("billing-list");
const billingForm = document.getElementById("billing-form");
const billingLinesEl = document.getElementById("billing-lines");
const billingTotalsEl = document.getElementById("billing-totals");
const invoicePresetsEl = document.getElementById("invoice-presets");
const quotePresetsEl = document.getElementById("quote-presets");
const quickAddsEl = document.getElementById("quick-adds");

let catalogMeta = null;
let currentBill = null;
let lineRows = [];
let paymentRows = [];
let billingDocs = [];
let customerDirectory = [];
let listKind = "quote";
let listFilter = "all";
let listMonth = "";
let partyFilter = { customerId: "", customerName: "", customerEmail: "" };
const billingSearch = document.getElementById("billing-search");
const billingFilterEl = document.getElementById("billing-filter");
const quotePresetPanel = document.getElementById("quote-preset-panel");
const invoicePresetPanel = document.getElementById("invoice-preset-panel");
const billingCustomerSelect = document.getElementById("billing-customer-id");
const billingVehicleSelect = document.getElementById("billing-vehicle-id");
const billingPaymentsEl = document.getElementById("billing-payments");

function money(n) {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
  }).format(Number(n) || 0);
}

function toCents(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100 + Number.EPSILON);
}

function fromCents(cents) {
  return Math.round(Number(cents) || 0) / 100;
}

function round2(n) {
  return fromCents(toCents(n));
}

function capitalizeLineDescription(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const lower = text.toLocaleLowerCase("en-NZ");
  return lower.charAt(0).toLocaleUpperCase("en-NZ") + lower.slice(1);
}

function newLine(partial = {}) {
  return {
    id: partial.id || crypto.randomUUID(),
    description: partial.description || "",
    qty: partial.qty != null ? partial.qty : 1,
    unitPriceIncl: partial.unitPriceIncl != null ? partial.unitPriceIncl : 0,
  };
}

function canEditLines(doc) {
  if (!doc || doc.status === "void") return false;
  if (doc.kind === "quote") return doc.status === "draft" || doc.status === "sent";
  return true;
}

function canEditCustomer(doc) {
  if (!doc || doc.status === "void") return false;
  if (doc.kind === "quote") return true;
  return canEditLines(doc);
}

function setBillingFieldsEditable(editable) {
  ["notes", "validUntil"].forEach((name) => {
    const el = billingInput(name);
    if (!el) return;
    el.readOnly = !editable;
    el.disabled = false;
  });
  if (billingCustomerSelect) billingCustomerSelect.disabled = !editable;
  if (billingVehicleSelect) billingVehicleSelect.disabled = !editable;
  const plateFind = document.getElementById("billing-plate-find");
  if (plateFind) plateFind.disabled = !editable;
}

function kindLabel(kind) {
  return kind === "invoice" ? "Invoice" : "Quote";
}

async function loadCatalog() {
  if (catalogMeta) return catalogMeta;
  catalogMeta = await Admin.api("/api/billing/catalog");
  renderPresetButtons();
  return catalogMeta;
}

function renderPresetButtons() {
  const presets = catalogMeta?.presets || [];
  invoicePresetsEl.innerHTML = presets
    .filter((p) => p.kind === "invoice")
    .map(
      (p) =>
        `<button type="button" data-preset="${Admin.escapeAttr(p.id)}">${Admin.escapeHtml(p.label)}</button>`
    )
    .join("");
  quotePresetsEl.innerHTML = presets
    .filter((p) => p.kind === "quote")
    .map(
      (p) =>
        `<button type="button" class="primary" data-preset="${Admin.escapeAttr(p.id)}">${Admin.escapeHtml(p.label)}</button>`
    )
    .join("");

  invoicePresetsEl.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => createDoc(btn.dataset.preset));
  });
  quotePresetsEl.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => createDoc(btn.dataset.preset));
  });
}

async function createDoc(presetId, extras = {}) {
  try {
    await loadCatalog();
    const preset = (catalogMeta?.presets || []).find((p) => p.id === presetId);
    if (!preset) throw new Error("Choose a package or custom quote.");
    const workNotes = String(extras.notes || "").trim();
    const seedDescription = String(extras.lineDescription || workNotes || "").trim();
    const lines = (preset.lines || []).map((line, index) =>
      newLine(
        index === 0 && seedDescription
          ? { ...line, description: seedDescription, unitPriceIncl: Number(line.unitPriceIncl) || 0 }
          : line
      )
    );
    if (!lines.length) lines.push(newLine({ description: seedDescription, qty: 1, unitPriceIncl: 0 }));
    const totals = computeTotals(lines);
    const draft = {
      id: "",
      unsaved: true,
      kind: preset.kind,
      number: "Not saved yet",
      status: "draft",
      preset: preset.id,
      customerId: String(extras.customerId || "").trim(),
      vehicleId: String(extras.vehicleId || "").trim(),
      customerName: String(extras.customerName || "").trim(),
      customerEmail: String(extras.customerEmail || "").trim(),
      customerPhone: String(extras.customerPhone || "").trim(),
      registration: String(extras.registration || "").trim().toUpperCase(),
      vehicle: String(extras.vehicle || "").trim(),
      odometer: extras.odometer || "",
      notes: workNotes,
      validUntil: "",
      lines,
      payments: [],
      paymentStatus: "unpaid",
      amountPaid: 0,
      history: [],
      totals,
      jobId: String(extras.jobId || "").trim(),
      reportId: "",
      quoteId: "",
      invoiceId: "",
    };
    await openUnsavedDoc(draft);
    Admin.showBillingStatus(
      draft.jobId
        ? draft.kind === "invoice"
          ? "Linked to job — add labour/parts, then Save and send"
          : "Linked to job — add quote lines, then Save and send"
        : draft.kind === "invoice"
          ? "Choose a customer, then Save to create the invoice"
          : "Choose a customer, then Save to create the quote"
    );
  } catch (err) {
    alert(err.message);
  }
}

async function createFromJob(job, kind) {
  if (!job?.id) throw new Error("Save the job card first.");
  const wantInvoice = kind === "invoice";
  if (wantInvoice && job.invoiceId) {
    Admin.setSection("invoices");
    await openDoc(job.invoiceId);
    return;
  }
  if (!wantInvoice && job.quoteId) {
    Admin.setSection("quotes");
    await openDoc(job.quoteId);
    return;
  }
  if (!wantInvoice && job.invoiceId) {
    throw new Error("This job already has an invoice. Open it from the job card.");
  }
  const work = String(job.workRequested || "").trim();
  await createDoc(wantInvoice ? "custom_invoice" : "custom", {
    jobId: job.id,
    customerId: job.customerId || "",
    customerName: job.customerName || "",
    customerEmail: job.customerEmail || "",
    customerPhone: job.customerPhone || "",
    registration: job.registration || "",
    vehicle: job.vehicle || "",
    odometer: job.odometer || "",
    notes: work,
    lineDescription: work,
  });
}

async function openUnsavedDoc(doc) {
  await loadCustomerDirectory();
  currentBill = doc;
  listKind = currentBill.kind === "invoice" ? "invoice" : "quote";
  Admin.setSection(listKind === "invoice" ? "invoices" : "quotes");
  updateListChrome();
  billingListView.hidden = true;
  billingEditView.hidden = false;
  Admin.setViewTitle(currentBill.number || "New");
  fillForm(currentBill);
}

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s-]/g, "");
}

function matchesBillingSearch(doc, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const name = String(doc.customerName || "").toLowerCase();
  const number = String(doc.number || "").toLowerCase();
  const quoted = String(doc.quotedNumber || "").toLowerCase();
  const plate = normalizeSearch(doc.registration);
  const plateQuery = q.replace(/[\s-]/g, "");
  return (
    name.includes(q) ||
    number.includes(q) ||
    quoted.includes(q) ||
    plate.includes(plateQuery)
  );
}

function paymentLabel(status) {
  const map = { unpaid: "Unpaid", deposit: "Deposit", paid: "Paid", overdue: "Overdue" };
  return map[status] || "";
}

function formatListDate(iso) {
  return Admin.formatDateShort(iso);
}

function quoteFilters() {
  return [
    { id: "all", label: "All quotes" },
    { id: "awaiting", label: "Awaiting acceptance" },
    { id: "accepted", label: "Accepted" },
    { id: "draft", label: "Drafts" },
  ];
}

function invoiceFilters() {
  const monthLabel = billingMonthLabel();
  return [
    { id: "all", label: "All invoices" },
    { id: "outstanding", label: "Awaiting payment" },
    { id: "overdue", label: "Overdue" },
    { id: "paid_month", label: "Payments this month" },
    { id: "service_month", label: `Services · ${monthLabel}` },
    { id: "wof_month", label: `WOFs · ${monthLabel}` },
    { id: "paid", label: "Paid" },
  ];
}

function billingMonthLabel() {
  const key = listMonth || Admin.todayIso().slice(0, 7);
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleString("en-NZ", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function matchesPartyFilter(d) {
  const id = String(partyFilter.customerId || "").trim();
  const name = String(partyFilter.customerName || "").trim().toLowerCase();
  const email = String(partyFilter.customerEmail || "").trim().toLowerCase();
  if (!id && !name && !email) return true;
  if (id && String(d.customerId || "") === id) return true;
  const docEmail = String(d.customerEmail || "").trim().toLowerCase();
  const docName = String(d.customerName || "").trim().toLowerCase();
  if (email && docEmail && email === docEmail) return true;
  if (name && docName && name === docName) return true;
  return false;
}

function partyFilterActive() {
  return Boolean(partyFilter.customerId || partyFilter.customerName || partyFilter.customerEmail);
}

function applyPartyOpts(opts) {
  if (opts.customerId != null || opts.customerName != null || opts.customerEmail != null) {
    partyFilter = {
      customerId: opts.customerId || "",
      customerName: opts.customerName || "",
      customerEmail: opts.customerEmail || "",
    };
    return;
  }
  if (opts.kind || opts.resetParty) {
    partyFilter = { customerId: "", customerName: "", customerEmail: "" };
  }
}

function listTitle() {
  const base = listKind === "invoice" ? "Invoices" : "Quotes";
  if (!partyFilterActive()) return base;
  const name = partyFilter.customerName || "customer";
  return `${base} · ${name}`;
}

function renderPartyChip() {
  const el = document.getElementById("billing-party-chip");
  if (!el) return;
  if (!partyFilterActive()) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const who = partyFilter.customerName || "this customer";
  const kind = listKind === "invoice" ? "invoices" : "quotes";
  el.hidden = false;
  el.innerHTML = `Showing ${kind} for <strong></strong> <button type="button" class="ghost" id="btn-clear-party">Show all</button>`;
  el.querySelector("strong").textContent = who;
  el.querySelector("#btn-clear-party")?.addEventListener("click", () => {
    partyFilter = { customerId: "", customerName: "", customerEmail: "" };
    Admin.setViewTitle(listTitle());
    renderPartyChip();
    renderBillingList();
  });
}

function matchesListFilter(d) {
  if (d.kind !== listKind) return false;
  if (listKind === "quote") {
    if (listFilter === "all") return d.status !== "void";
    if (listFilter === "awaiting") return d.status === "sent";
    if (listFilter === "accepted") return d.status === "accepted" || d.status === "invoiced";
    if (listFilter === "draft") return d.status === "draft";
  }
  if (listKind === "invoice") {
    if (d.status === "void") return false;
    if (listFilter === "all") return true;
    if (listFilter === "outstanding") {
      return (
        (d.paymentStatus === "unpaid" || d.paymentStatus === "deposit") &&
        Number(d.balanceDue) > 0
      );
    }
    if (listFilter === "overdue") return Boolean(d.overdue);
    if (listFilter === "paid_month") {
      const month = Admin.todayIso().slice(0, 7);
      return (d.paymentDates || []).some((day) => String(day).startsWith(month));
    }
    if (listFilter === "service_month" || listFilter === "wof_month") {
      const month = listMonth || Admin.todayIso().slice(0, 7);
      const issuedMonth = String(d.sentAt || d.createdAt || d.updatedAt || "").slice(0, 7);
      if (issuedMonth !== month) return false;
      return listFilter === "service_month" ? Boolean(d.hasService) : Boolean(d.hasWof);
    }
    if (listFilter === "paid") return d.paymentStatus === "paid";
  }
  return false;
}

function updateListChrome() {
  const isInvoice = listKind === "invoice";
  if (quotePresetPanel) quotePresetPanel.hidden = isInvoice;
  if (invoicePresetPanel) invoicePresetPanel.hidden = !isInvoice;
  const searchLabel = document.getElementById("billing-search-label");
  if (searchLabel) searchLabel.textContent = isInvoice ? "Search invoices" : "Search quotes";
  const back = document.getElementById("btn-billing-back");
  if (back) back.textContent = isInvoice ? "← All invoices" : "← All quotes";
  renderBillingFilters();
  renderPartyChip();
}

function renderBillingFilters() {
  if (!billingFilterEl) return;
  const filters = listKind === "invoice" ? invoiceFilters() : quoteFilters();
  if (!filters.some((f) => f.id === listFilter)) listFilter = "all";
  billingFilterEl.innerHTML = filters
    .map(
      (f) =>
        `<button type="button" class="ghost${f.id === listFilter ? " is-active" : ""}" data-filter="${Admin.escapeAttr(f.id)}">${Admin.escapeHtml(f.label)}</button>`
    )
    .join("");
  billingFilterEl.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      listFilter = btn.dataset.filter;
      if (listFilter === "service_month" || listFilter === "wof_month") {
        listMonth = Admin.todayIso().slice(0, 7);
      }
      renderBillingFilters();
      renderBillingList();
    });
  });
}

function renderBillingList() {
  const kindDocs = billingDocs.filter((d) => matchesListFilter(d) && matchesPartyFilter(d));
  const query = billingSearch?.value || "";
  const docs = kindDocs.filter((d) => matchesBillingSearch(d, query));

  if (listKind === "invoice") {
    billingList.innerHTML = `
      <div class="billing-table-wrap">
        <table class="billing-table invoice-list-table">
          <thead>
            <tr>
              <th>Invoice no</th>
              <th>Date</th>
              <th>Customer name</th>
              <th class="invoice-money">Invoice amount</th>
              <th class="invoice-money">Payment made</th>
              <th class="invoice-money">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${
              docs.length
                ? docs
                    .map((d) => {
                      const when =
                        formatListDate(d.sortAt || d.sentAt || d.createdAt || d.updatedAt) || "—";
                      return `<tr class="invoice-row" data-id="${Admin.escapeAttr(d.id)}">
                        <td class="billing-number">${Admin.escapeHtml(d.number || "—")}</td>
                        <td>${Admin.escapeHtml(when)}</td>
                        <td>${Admin.escapeHtml(d.customerName || "—")}</td>
                        <td class="invoice-money">${money(d.totalIncl)}</td>
                        <td class="invoice-money invoice-payment">${money(d.amountPaid)}</td>
                        <td class="invoice-money invoice-due">${money(d.balanceDue)}</td>
                      </tr>`;
                    })
                    .join("")
                : '<tr><td colspan="6" class="empty-table-cell">No matching invoices.</td></tr>'
            }
          </tbody>
        </table>
      </div>`;
    billingList.querySelectorAll(".invoice-row").forEach((row) => {
      row.addEventListener("click", () => openDoc(row.dataset.id));
    });
    return;
  }

  billingList.innerHTML = `
    <div class="billing-table-wrap">
      <table class="billing-table quote-list-table">
        <thead>
          <tr>
            <th>Quote no</th>
            <th>Date</th>
            <th>Customer name</th>
            <th>Vehicle</th>
            <th class="invoice-money">Quote amount</th>
          </tr>
        </thead>
        <tbody>
          ${
            docs.length
              ? docs
                  .map((d) => {
                    const when =
                      formatListDate(d.sortAt || d.sentAt || d.createdAt || d.updatedAt) || "—";
                    return `<tr class="quote-row" data-id="${Admin.escapeAttr(d.id)}">
                      <td class="billing-number">${Admin.escapeHtml(d.number || "—")}</td>
                      <td>${Admin.escapeHtml(when)}</td>
                      <td><button type="button" class="customer-name-link" data-party-id="${Admin.escapeAttr(d.customerId || "")}" data-party-name="${Admin.escapeAttr(d.customerName || "")}" data-party-email="${Admin.escapeAttr(d.customerEmail || "")}">${Admin.escapeHtml(d.customerName || "—")}</button></td>
                      <td>${Admin.escapeHtml([d.registration, d.vehicle].filter(Boolean).join(" · ") || "—")}</td>
                      <td class="invoice-money invoice-due">${money(d.totalIncl)}</td>
                    </tr>`;
                  })
                  .join("")
              : '<tr><td colspan="5" class="empty-table-cell">No matching quotes.</td></tr>'
          }
        </tbody>
      </table>
    </div>`;
  billingList.querySelectorAll(".quote-row").forEach((row) => {
    row.addEventListener("click", () => openDoc(row.dataset.id));
  });
  billingList.querySelectorAll(".customer-name-link").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      showList({
        kind: listKind,
        filter: "all",
        customerId: btn.dataset.partyId || "",
        customerName: btn.dataset.partyName || "",
        customerEmail: btn.dataset.partyEmail || "",
      });
    });
  });
}

async function loadBillingList() {
  await loadCatalog();
  await loadCustomerDirectory();
  billingDocs = await Admin.api("/api/billing");
  renderBillingList();
}

async function loadCustomerDirectory() {
  try {
    customerDirectory = await Admin.api("/api/customers");
  } catch {
    customerDirectory = [];
  }
}

function partyDisplayName(row) {
  return (
    [row?.firstName, row?.lastName].filter(Boolean).join(" ").trim() ||
    String(row?.customerName || "").trim()
  );
}

function plateKey(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
}

function setBillingPlateFind(value) {
  const el = document.getElementById("billing-plate-find");
  if (el) el.value = String(value || "").toUpperCase();
}

function setBillingPlateStatus(text, ok = false) {
  const el = document.getElementById("billing-plate-find-status");
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("is-ok");
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle("is-ok", Boolean(ok));
}

function billingPlateHits(query) {
  const q = plateKey(query);
  if (!q) return [];
  const hits = [];
  for (const row of customerDirectory) {
    if (!row.customerId) continue;
    for (const vehicle of Admin.customerVehicles(row)) {
      const plate = plateKey(vehicle.registration);
      if (!plate) continue;
      if (plate === q || plate.startsWith(q) || plate.includes(q)) {
        hits.push({ row, vehicle, plate });
      }
    }
  }
  hits.sort((a, b) => {
    const aq = a.plate === q ? 0 : a.plate.startsWith(q) ? 1 : 2;
    const bq = b.plate === q ? 0 : b.plate.startsWith(q) ? 1 : 2;
    if (aq !== bq) return aq - bq;
    return a.plate.localeCompare(b.plate);
  });
  return hits;
}

function applyBillingPlateHit(hit) {
  if (!hit?.row) return;
  Admin.fillCustomerSelect(billingCustomerSelect, customerDirectory, hit.row.customerId);
  Admin.fillVehicleSelect(
    billingVehicleSelect,
    hit.row,
    hit.vehicle.id || hit.vehicle.registration
  );
  Admin.applyPartyToForm(billingForm, hit.row, hit.vehicle);
  setBillingPlateFind(hit.vehicle.registration);
  const name = partyDisplayName(hit.row) || "Customer";
  const plate = String(hit.vehicle.registration || "").toUpperCase();
  setBillingPlateStatus(`${name} · ${plate}`, true);
  scheduleBillAutosave();
}

function onBillingPlateFindInput() {
  const input = document.getElementById("billing-plate-find");
  if (!input || !canEditCustomer(currentBill)) return;
  const start = input.selectionStart;
  const next = String(input.value || "").toUpperCase();
  if (next !== input.value) {
    input.value = next;
    try {
      input.setSelectionRange(start, start);
    } catch {
      /* ignore */
    }
  }
  const q = plateKey(input.value);
  if (!q) {
    setBillingPlateStatus("");
    return;
  }
  if (!customerDirectory.length) {
    setBillingPlateStatus("No customers yet. Add them under Customers first.");
    return;
  }
  const hits = billingPlateHits(input.value);
  const exact = hits.filter((h) => h.plate === q);
  let chosen = null;
  if (exact.length === 1) chosen = exact[0];
  else if (q.length >= 3) {
    const prefix = hits.filter((h) => h.plate.startsWith(q));
    if (prefix.length === 1) chosen = prefix[0];
  }
  if (chosen) {
    applyBillingPlateHit(chosen);
    return;
  }
  if (hits.length > 1) {
    setBillingPlateStatus(`${hits.length} matches — keep typing the plate`);
    return;
  }
  setBillingPlateStatus("No customer with this plate. Add them under Customers first.");
}

function selectedBillingCustomer() {
  const id = billingCustomerSelect?.value || "";
  return customerDirectory.find((row) => row.customerId === id) || null;
}

function selectedBillingVehicle(row) {
  const id = billingVehicleSelect?.value || "";
  const vehicles = Admin.customerVehicles(row);
  const key = String(id)
    .toUpperCase()
    .replace(/[\s-]/g, "");
  return (
    vehicles.find(
      (v) =>
        v.id === id ||
        v.registration === id ||
        (key &&
          String(v.registration || "")
            .toUpperCase()
            .replace(/[\s-]/g, "") === key)
    ) || null
  );
}

function syncBillingPartyFields() {
  const row = selectedBillingCustomer();
  const vehicle = selectedBillingVehicle(row);
  Admin.applyPartyToForm(billingForm, row || {}, vehicle);
  setBillingPlateFind(vehicle?.registration || "");
  if (row && vehicle?.registration) {
    setBillingPlateStatus(`${partyDisplayName(row)} · ${String(vehicle.registration).toUpperCase()}`, true);
  } else {
    setBillingPlateStatus("");
  }
}

function refreshBillingPartySelects(doc = currentBill) {
  const matched = Admin.matchCustomer(customerDirectory, doc);
  const trustMatch = matched && Admin.sameParty(matched, doc);
  const linkedId = trustMatch
    ? matched.customerId
    : String(doc?.customerId || "").trim();
  Admin.fillCustomerSelect(billingCustomerSelect, customerDirectory, linkedId);
  const row = trustMatch
    ? matched
    : linkedId
      ? customerDirectory.find((r) => r.customerId === linkedId) || null
      : null;
  Admin.fillVehicleSelect(
    billingVehicleSelect,
    row,
    doc?.vehicleId || doc?.registration || ""
  );
  if (row && trustMatch) {
    const vehicle =
      selectedBillingVehicle(row) ||
      Admin.customerVehicles(row).find(
        (v) =>
          String(v.registration || "")
            .toUpperCase()
            .replace(/[\s-]/g, "") ===
          String(doc?.registration || "")
            .toUpperCase()
            .replace(/[\s-]/g, "")
      ) ||
      (Admin.customerVehicles(row).length === 1 ? Admin.customerVehicles(row)[0] : null);
    Admin.applyPartyToForm(billingForm, row, vehicle);
    // Keep job/appointment text when directory vehicle blank but doc has values.
    if (doc?.registration && !billingInput("registration")?.value) {
      const el = billingInput("registration");
      if (el) el.value = doc.registration;
    }
    if (doc?.vehicle && !billingInput("vehicle")?.value) {
      const el = billingInput("vehicle");
      if (el) el.value = doc.vehicle;
    }
  } else if (billingForm && doc) {
    Admin.applyPartyToForm(billingForm, null, null);
    const set = (name, value) => {
      const el = billingInput(name);
      if (el) el.value = value || "";
    };
    const listed = String(doc.customerId || "").trim()
      ? customerDirectory.find((r) => r.customerId === doc.customerId) || null
      : null;
    const keepId = listed && Admin.sameParty(listed, doc) ? listed.customerId : "";
    set("customerId", keepId);
    set("customerName", doc.customerName || "");
    set("customerEmail", doc.customerEmail || "");
    set("customerPhone", doc.customerPhone || "");
    set("vehicleId", keepId ? doc.vehicleId || "" : "");
    set("registration", doc.registration || "");
    set("vehicle", doc.vehicle || "");
  }
}

function resetBillingPartyFields() {
  Admin.fillCustomerSelect(billingCustomerSelect, customerDirectory, "");
  Admin.fillVehicleSelect(billingVehicleSelect, null, "");
  Admin.applyPartyToForm(billingForm, null, null);
  setBillingPlateFind("");
  setBillingPlateStatus("");
  document.querySelectorAll("[data-pay-method]").forEach((btn) => {
    btn.classList.remove("is-active");
  });
}

async function openDoc(id) {
  await loadCustomerDirectory();
  currentBill = await Admin.api(`/api/billing/${id}`);
  listKind = currentBill.kind === "invoice" ? "invoice" : "quote";
  Admin.setSection(listKind === "invoice" ? "invoices" : "quotes");
  updateListChrome();
  billingListView.hidden = true;
  billingEditView.hidden = false;
  Admin.setViewTitle(currentBill.number);
  fillForm(currentBill);
}

function billingInput(name) {
  return (
    document.getElementById(`billing-field-${name}`) ||
    document.querySelector(`#billing-form [name="${name}"]`) ||
    document.querySelector(`#billing-edit-view [name="${name}"]`)
  );
}

function fillForm(doc) {
  const set = (name, value) => {
    const el = billingInput(name);
    if (!el) return;
    el.value = value ?? "";
  };
  set("number", doc.number);
  set("validUntil", doc.validUntil || "");
  set("notes", doc.notes);
  refreshBillingPartySelects(doc);

  document.getElementById("billing-legend").textContent =
    doc.kind === "invoice" ? "Tax invoice" : "Quote";

  const validLabel = billingInput("validUntil")?.closest("label");
  if (validLabel) validLabel.hidden = doc.kind !== "quote";

  const paymentFs = document.getElementById("billing-payment-fieldset");
  if (paymentFs) {
    paymentFs.hidden = doc.kind !== "invoice" || doc.status === "void";
    if (doc.kind === "invoice") {
      paymentRows = (doc.payments || []).map((p) => ({
        id: p.id || crypto.randomUUID(),
        amount: Number(p.amount) || 0,
        paidAt: p.paidAt || "",
        note: p.note || "",
      }));
      if (!paymentRows.length && Number(doc.amountPaid) > 0) {
        paymentRows = [
          {
            id: crypto.randomUUID(),
            amount: Number(doc.amountPaid) || 0,
            paidAt: doc.paidAt || "",
            note: doc.paymentNote || "",
          },
        ];
      }
      const dateEl = document.getElementById("billing-pay-date");
      if (dateEl) dateEl.value = Admin.todayIso();
      document.querySelectorAll("[data-pay-method]").forEach((btn) => {
        btn.classList.remove("is-active");
      });
      renderPayments();
      renderReferralCredits();
    } else {
      paymentRows = [];
      const refBox = document.getElementById("billing-referral-credits");
      if (refBox) refBox.hidden = true;
    }
  }

  // Customer details stay editable on quotes until void; lines only while draft/sent.
  setBillingFieldsEditable(canEditCustomer(doc));
  setBillingPlateFind(doc.registration || selectedBillingVehicle(selectedBillingCustomer())?.registration || "");
  if (doc.customerName && doc.registration) {
    setBillingPlateStatus(`${doc.customerName} · ${String(doc.registration).toUpperCase()}`, true);
  } else {
    setBillingPlateStatus("");
  }
  const plateFind = document.getElementById("billing-plate-find");
  if (plateFind && canEditCustomer(doc) && !doc.customerId && !doc.customerName) {
    plateFind.focus();
  }

  const hint = document.getElementById("billing-edit-hint");
  if (hint) {
    if (doc.kind === "quote" && (doc.status === "draft" || doc.status === "sent")) {
      hint.hidden = false;
      if (doc.status === "sent" && doc.viewedAt) {
        hint.textContent = `Customer has opened this quote${
          doc.lastViewedAt ? ` (${formatHistoryWhen(doc.lastViewedAt)})` : ""
        }. You can still change it, then Save and email again if needed.`;
      } else if (doc.status === "sent") {
        hint.textContent =
          "You can change this quote, then click Save changes. Send email again if the customer needs the update.";
      } else {
        hint.textContent =
          "Edit customer details and line items, then Save changes.";
      }
    } else if (doc.kind === "quote" && (doc.status === "accepted" || doc.status === "invoiced")) {
      hint.hidden = false;
      hint.textContent =
        "This quote is locked after accept. Use Revise quote to make a new editable copy.";
    } else if (doc.kind === "invoice" && doc.viewedAt) {
      hint.hidden = false;
      const reviewBit = doc.reviewRequestSentAt
        ? ` Google review request sent${
            doc.reviewRequestSentAt
              ? ` (${formatHistoryWhen(doc.reviewRequestSentAt)})`
              : ""
          }.`
        : "";
      hint.textContent = `Customer has opened this invoice${
        doc.lastViewedAt ? ` (${formatHistoryWhen(doc.lastViewedAt)})` : ""
      }.${reviewBit}`;
    } else if (doc.kind === "invoice" && doc.reviewRequestSentAt) {
      hint.hidden = false;
      hint.textContent = `Google review request sent (${formatHistoryWhen(
        doc.reviewRequestSentAt
      )}).`;
    } else {
      hint.hidden = true;
      hint.textContent = "";
    }
  }

  lineRows = (doc.lines || []).map((line) => newLine(line));
  if (!lineRows.length) lineRows = [newLine()];
  renderLines();
  renderQuickAdds();
  const wofInput = document.getElementById("billing-wof-expiry");
  if (wofInput) {
    const fromVehicle = selectedBillingVehicle(selectedBillingCustomer())?.wofExpiry || "";
    wofInput.value = doc.wofExpiry || fromVehicle || "";
  }
  syncWofExpiryField();
  renderHistory(doc);
  updateActionButtons();
}

function formatHistoryWhen(iso) {
  return Admin.formatDateTimeShort(iso);
}

function renderHistory(doc) {
  const list = document.getElementById("billing-history");
  const fs = document.getElementById("billing-history-fieldset");
  const reviewStatus = document.getElementById("billing-review-status");
  if (!list) return;
  if (fs) fs.hidden = doc.status === "void" && !(doc.history || []).length;
  if (reviewStatus) {
    if (doc.kind === "invoice") {
      reviewStatus.hidden = false;
      if (doc.reviewRequestSentAt) {
        const kindLabel =
          doc.reviewRequestKind === "wof"
            ? "WoF"
            : doc.reviewRequestKind === "service"
              ? "Service"
              : doc.reviewRequestKind === "repair"
                ? "Repair"
                : "";
        reviewStatus.textContent = `Review request: sent ${formatHistoryWhen(
          doc.reviewRequestSentAt
        )}${kindLabel ? ` · ${kindLabel} message` : ""}`;
      } else {
        reviewStatus.textContent =
          "Review request: not sent yet (included when you email this invoice).";
      }
    } else {
      reviewStatus.hidden = true;
      reviewStatus.textContent = "";
    }
  }
  const rows = Array.isArray(doc.history) ? doc.history : [];
  if (!rows.length) {
    list.innerHTML = '<li class="muted">No history yet.</li>';
    return;
  }
  list.innerHTML = rows
    .map((ev) => {
      const amount =
        ev.amount != null && ev.amount !== ""
          ? `<span class="history-amount">${money(ev.amount)}</span>`
          : "";
      const detail = ev.detail
        ? `<p class="history-detail">${Admin.escapeHtml(ev.detail)}</p>`
        : "";
      const labels = {
        sent: doc.kind === "invoice" ? "Invoice emailed to customer" : "Quote emailed to customer",
        viewed: doc.kind === "invoice" ? "Customer opened invoice" : "Customer opened quote",
        created: doc.kind === "invoice" ? "Invoice created" : "Quote created",
        review_request: "Google review request emailed",
      };
      const summaryText = ev.summary || labels[ev.type] || ev.type || "Update";
      return `<li class="history-item history-${Admin.escapeAttr(ev.type || "note")}">
        <div class="history-when">${Admin.escapeHtml(formatHistoryWhen(ev.at))}</div>
        <div class="history-body">
          <p class="history-summary">${Admin.escapeHtml(summaryText)}${amount}</p>
          ${detail}
        </div>
      </li>`;
    })
    .join("");
}

function lineLooksLikeWof(description) {
  return /\bwof\b/i.test(String(description || "").trim());
}

function lineLooksLikePackageService(description) {
  return /(standard|premium|full)\s+service/i.test(String(description || "").trim());
}

function lineLooksLikeConsumable(description) {
  return /\bconsumables?\b/i.test(String(description || "").trim());
}

function repairExclForConsumable(lines) {
  let total = 0;
  for (const line of lines || []) {
    if (
      lineLooksLikeWof(line.description) ||
      lineLooksLikePackageService(line.description) ||
      lineLooksLikeConsumable(line.description)
    ) {
      continue;
    }
    total = round2(total + lineAmounts(line).net);
  }
  return total;
}

function consumableDefaultExcl(repairExclTotal) {
  const n = Number(repairExclTotal) || 0;
  if (n <= 100) return 5;
  if (n <= 300) return 10;
  if (n <= 500) return 15;
  return 20;
}

function suggestedConsumablePrice() {
  return consumableDefaultExcl(repairExclForConsumable(lineRows));
}

function plusCalendarMonths(iso, months) {
  const parts = String(iso || "")
    .slice(0, 10)
    .split("-")
    .map(Number);
  if (parts.length < 3 || !parts[0]) return "";
  let year = parts[0];
  let month = parts[1] + Number(months || 0);
  let day = parts[2];
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  const last = new Date(year, month, 0).getDate();
  if (day > last) day = last;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function invoiceLinesHaveWof() {
  return lineRows.some((line) => lineLooksLikeWof(line.description));
}

function syncWofExpiryField() {
  const fieldset = document.getElementById("billing-wof-expiry-fieldset");
  const input = document.getElementById("billing-wof-expiry");
  const plusBtns = document.querySelectorAll("[data-wof-months]");
  const show = currentBill?.kind === "invoice" && currentBill.status !== "void" && invoiceLinesHaveWof();
  if (fieldset) fieldset.hidden = !show;
  const editable = show && canEditCustomer(currentBill);
  if (input) input.disabled = !editable;
  plusBtns.forEach((btn) => {
    btn.hidden = !editable;
  });
}

function renderQuickAdds() {
  const adds = catalogMeta?.quickAdds || [];
  const locked = !canEditLines(currentBill);
  const suggestedConsumable = suggestedConsumablePrice();
  quickAddsEl.innerHTML = locked
    ? ""
    : adds
        .map((a, i) => {
          const label =
            a.id === "consumable" ? `+ Consumable $${suggestedConsumable}` : a.label;
          return `<button type="button" data-quick="${i}">${Admin.escapeHtml(label)}</button>`;
        })
        .join("");
  quickAddsEl.querySelectorAll("[data-quick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = adds[Number(btn.dataset.quick)];
      if (!item) return;
      if (item.id === "consumable") {
        const price = suggestedConsumablePrice();
        const existing = lineRows.findIndex((line) =>
          lineLooksLikeConsumable(line.description)
        );
        if (existing >= 0) {
          lineRows[existing].description = "Consumable";
          lineRows[existing].qty = 1;
          lineRows[existing].unitPriceIncl = price;
        } else {
          lineRows.push(
            newLine({
              description: "Consumable",
              qty: 1,
              unitPriceIncl: price,
            })
          );
        }
      } else {
        lineRows.push(newLine(item));
      }
      renderLines();
      scheduleBillAutosave();
    });
  });
}

function renderLines() {
  const locked = !canEditLines(currentBill);
  billingLinesEl.innerHTML = lineRows
    .map((line, index) => {
      const total = lineAmounts(line).net;
      return `<tr data-index="${index}">
        <td><input data-field="description" value="${Admin.escapeAttr(line.description)}" ${locked ? "readonly" : ""} /></td>
        <td><input class="qty" data-field="qty" type="number" min="0" step="0.25" value="${Admin.escapeAttr(String(line.qty))}" ${locked ? "readonly" : ""} /></td>
        <td><input class="price" data-field="unitPriceIncl" type="number" min="0" step="0.01" value="${Admin.escapeAttr(String(line.unitPriceIncl))}" ${locked ? "readonly" : ""} /></td>
        <td class="total">${money(total)}</td>
        <td>${locked ? "" : `<button type="button" class="ghost" data-remove="${index}">×</button>`}</td>
      </tr>`;
    })
    .join("");

  billingLinesEl.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      const row = input.closest("tr");
      const index = Number(row.dataset.index);
      const field = input.dataset.field;
      let value = input.value;
      if (field === "qty" || field === "unitPriceIncl") value = Number(value) || 0;
      lineRows[index][field] = value;
      const total = lineAmounts(lineRows[index]).net;
      row.querySelector(".total").textContent = money(total);
      renderTotals();
      if (field === "description") syncWofExpiryField();
      updateConsumableQuickLabel();
      scheduleBillAutosave();
    });
  });
  billingLinesEl.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.remove);
      lineRows.splice(index, 1);
      if (!lineRows.length) lineRows = [newLine()];
      renderLines();
      scheduleBillAutosave();
    });
  });
  renderTotals();
  syncWofExpiryField();
  updateConsumableQuickLabel();
}

function updateConsumableQuickLabel() {
  const adds = catalogMeta?.quickAdds || [];
  const consumableIndex = adds.findIndex((a) => a.id === "consumable");
  if (consumableIndex < 0 || !quickAddsEl) return;
  const btn = quickAddsEl.querySelector(`[data-quick="${consumableIndex}"]`);
  if (btn) btn.textContent = `+ Consumable $${suggestedConsumablePrice()}`;
}

function advertisedInclFromExcl(excl) {
  const n = Number(excl);
  if (!Number.isFinite(n) || n <= 0) return null;
  for (const incl of [79, 199, 279, 125]) {
    const exact = incl / 1.15;
    if (Math.abs(n - exact) < 0.0005 || round2(n) === round2(exact)) return incl;
  }
  return null;
}

function lineAmounts(line) {
  const qty = Number(line?.qty) || 0;
  const unit = Number(line?.unitPriceIncl) || 0;
  const advertised = advertisedInclFromExcl(unit);
  if (advertised != null) {
    const totalInclCents = Math.round(qty * advertised * 100);
    const gstCents = Math.round(totalInclCents * (3 / 23));
    const netCents = totalInclCents - gstCents;
    return {
      net: fromCents(netCents),
      gst: fromCents(gstCents),
      totalIncl: fromCents(totalInclCents),
    };
  }
  const netCents = Math.round(qty * toCents(unit));
  const totalInclCents = Math.round(netCents * 1.15);
  const gstCents = totalInclCents - netCents;
  return {
    net: fromCents(netCents),
    gst: fromCents(gstCents),
    totalIncl: fromCents(totalInclCents),
  };
}

function computeTotals(lines) {
  let netCents = 0;
  let gstCents = 0;
  let totalInclCents = 0;
  for (const line of lines || []) {
    const amounts = lineAmounts(line);
    netCents += toCents(amounts.net);
    gstCents += toCents(amounts.gst);
    totalInclCents += toCents(amounts.totalIncl);
  }
  return {
    net: fromCents(netCents),
    gst: fromCents(gstCents),
    totalIncl: fromCents(totalInclCents),
  };
}

function renderTotals() {
  const { net, gst, totalIncl } = computeTotals(lineRows);
  billingTotalsEl.innerHTML = `
    <p><span>Subtotal excl. GST</span><span>${money(net)}</span></p>
    <p><span>GST (15%)</span><span>${money(gst)}</span></p>
    <p><span>Total incl. GST</span><span>${money(totalIncl)}</span></p>
  `;
}

function collectBill() {
  const value = (name) => String(billingInput(name)?.value || "").trim();
  const payload = {
    customerId: value("customerId"),
    vehicleId: value("vehicleId"),
    customerName: value("customerName"),
    customerEmail: value("customerEmail"),
    customerPhone: value("customerPhone"),
    registration: value("registration"),
    vehicle: value("vehicle"),
    notes: capitalizeLineDescription(billingInput("notes")?.value || ""),
    validUntil: billingInput("validUntil")?.value || "",
    lines: lineRows.map((line) => ({
      ...line,
      description: capitalizeLineDescription(line.description),
    })),
  };
  if (currentBill?.jobId) payload.jobId = currentBill.jobId;
  if (currentBill?.kind === "invoice") {
    payload.payments = paymentRows.map((p) => ({ ...p }));
    payload.wofExpiry = invoiceLinesHaveWof()
      ? String(document.getElementById("billing-wof-expiry")?.value || "").trim()
      : "";
  }
  return payload;
}

function invoiceTotalIncl() {
  return computeTotals(lineRows).totalIncl;
}

function paymentsTotal() {
  return round2(paymentRows.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
}

function invoiceBalanceDue() {
  const total = Number(currentBill?.totals?.totalIncl) || invoiceTotalIncl();
  const credits = Number(currentBill?.referralCreditTotal) || 0;
  return round2(Math.max(0, total - paymentsTotal() - credits));
}

function selectedPayMethod() {
  return (
    document.querySelector("[data-pay-method].is-active")?.dataset.payMethod || ""
  );
}

function requirePayMethod() {
  const method = selectedPayMethod();
  if (method) return method;
  alert("Choose Cash or EFTPOS.");
  return "";
}

function updatePaymentSummary() {
  const el = document.getElementById("billing-payment-summary");
  if (!el || currentBill?.kind !== "invoice") return;
  const total = Number(currentBill.totals?.totalIncl) || invoiceTotalIncl();
  const paid = paymentsTotal();
  const credits = Number(currentBill.referralCreditTotal) || 0;
  const due = invoiceBalanceDue();
  let status =
    paid + credits <= 0 ? "Unpaid" : due <= 0 ? "Paid" : "Deposit / partial";
  if (due > 0 && currentBill.overdue) status = "Overdue";
  const creditBit =
    credits > 0 ? ` · Referral credit ${money(credits)}` : "";
  el.textContent = `Status: ${status} · Paid ${money(paid)}${creditBit} · Balance due ${money(due)} · Invoice ${money(total)}`;
  const hint = document.getElementById("billing-pay-full-hint");
  if (hint) {
    hint.textContent =
      due > 0
        ? `Add payment records the full balance due (${money(due)}).`
        : "Nothing left to pay.";
  }
}

async function renderReferralCredits() {
  const box = document.getElementById("billing-referral-credits");
  const summaryEl = document.getElementById("billing-referral-summary");
  const actionsEl = document.getElementById("billing-referral-actions");
  if (!box || !summaryEl || !actionsEl) return;
  if (!currentBill || currentBill.kind !== "invoice" || currentBill.status === "void") {
    box.hidden = true;
    return;
  }

  const applied = Number(currentBill.referralCreditTotal) || 0;
  const customerId = String(currentBill.customerId || "").trim();
  let available = 0;
  let creditCount = 0;
  if (customerId) {
    try {
      const bal = await Admin.api(
        `/api/referral-credits?customerId=${encodeURIComponent(customerId)}`
      );
      available = Number(bal.balance) || 0;
      creditCount = Number(bal.creditCount) || 0;
    } catch {
      available = 0;
    }
  }

  const total = Number(currentBill.totals?.totalIncl) || invoiceTotalIncl();
  const canApply =
    customerId &&
    available >= 20 &&
    total + 0.001 >= 50 &&
    invoiceBalanceDue() + 0.001 >= 20;

  box.hidden = false;
  summaryEl.textContent =
    applied > 0
      ? `Applied on this invoice: ${money(applied)}. Available wallet: ${money(available)} (${creditCount} credit${creditCount === 1 ? "" : "s"}).`
      : available > 0
        ? `Available wallet: ${money(available)} (${creditCount} credit${creditCount === 1 ? "" : "s"}). Min spend $50 · whole $20 only.`
        : "No referral credits on this customer.";

  actionsEl.innerHTML = "";
  if (canApply) {
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "primary";
    applyBtn.id = "btn-apply-referral-credits";
    const due = invoiceBalanceDue();
    const maxApply = Math.min(available, Math.floor(due / 20) * 20);
    applyBtn.textContent =
      maxApply > 20
        ? `Apply referral credits (up to ${money(maxApply)})`
        : "Apply referral credit ($20)";
    applyBtn.addEventListener("click", async () => {
      try {
        const result = await Admin.api(
          `/api/billing/${currentBill.id}/apply-referral-credits`,
          { method: "POST", body: "{}" }
        );
        currentBill = result.doc;
        paymentRows = (currentBill.payments || []).map((p) => ({
          id: p.id || crypto.randomUUID(),
          amount: Number(p.amount) || 0,
          paidAt: p.paidAt || "",
          note: p.note || "",
        }));
        renderPayments();
        await renderReferralCredits();
        Admin.showStatus?.(
          `Applied ${money(result.appliedAmount)} referral credit.`
        );
      } catch (err) {
        alert(err.message || "Could not apply referral credits.");
      }
    });
    actionsEl.appendChild(applyBtn);
  }
  if (applied > 0) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "ghost";
    removeBtn.id = "btn-remove-referral-credits";
    removeBtn.textContent = "Remove referral credits";
    removeBtn.addEventListener("click", async () => {
      if (!confirm("Remove referral credits from this invoice?")) return;
      try {
        const result = await Admin.api(
          `/api/billing/${currentBill.id}/remove-referral-credits`,
          { method: "POST", body: "{}" }
        );
        currentBill = result.doc;
        paymentRows = (currentBill.payments || []).map((p) => ({
          id: p.id || crypto.randomUUID(),
          amount: Number(p.amount) || 0,
          paidAt: p.paidAt || "",
          note: p.note || "",
        }));
        renderPayments();
        await renderReferralCredits();
      } catch (err) {
        alert(err.message || "Could not remove referral credits.");
      }
    });
    actionsEl.appendChild(removeBtn);
  }
}

function renderPayments() {
  if (!billingPaymentsEl) return;
  if (!paymentRows.length) {
    billingPaymentsEl.innerHTML =
      '<tr><td colspan="4" class="muted">No payments yet.</td></tr>';
  } else {
    billingPaymentsEl.innerHTML = paymentRows
      .map(
        (p, index) => `<tr data-index="${index}">
          <td>${Admin.escapeHtml(Admin.formatDateShort(p.paidAt) || "—")}</td>
          <td>${money(p.amount)}</td>
          <td>${Admin.escapeHtml(p.note || "")}</td>
          <td><button type="button" class="ghost" data-remove-pay="${index}">×</button></td>
        </tr>`
      )
      .join("");
    billingPaymentsEl.querySelectorAll("[data-remove-pay]").forEach((btn) => {
      btn.addEventListener("click", () => {
        paymentRows.splice(Number(btn.dataset.removePay), 1);
        renderPayments();
        scheduleBillAutosave();
      });
    });
  }
  updatePaymentSummary();
}

function addPaymentRow(amount, note) {
  const amt = round2(Number(amount) || 0);
  if (amt <= 0) {
    alert("Nothing left to pay.");
    return false;
  }
  const dateEl = document.getElementById("billing-pay-date");
  paymentRows.push({
    id: crypto.randomUUID(),
    amount: amt,
    paidAt: dateEl?.value || Admin.todayIso(),
    note: String(note || "").trim(),
  });
  renderPayments();
  scheduleBillAutosave();
  return true;
}

async function saveBill(opts = {}) {
  if (!currentBill) return null;
  if (currentBill.status === "void") {
    throw new Error("This document has been voided.");
  }
  const payload = collectBill();
  const hasCustomer = Boolean(
    payload.customerId ||
      String(payload.customerName || "").trim() ||
      String(payload.registration || "").trim()
  );
  if (currentBill.unsaved || !currentBill.id) {
    if (!hasCustomer) {
      throw new Error("Choose a customer (or enter a name / plate) before saving.");
    }
    currentBill = await Admin.api("/api/billing", {
      method: "POST",
      body: JSON.stringify({
        preset: currentBill.preset || "custom",
        ...payload,
      }),
    });
  } else {
    currentBill = await Admin.api(`/api/billing/${currentBill.id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }
  if (opts.refresh !== false) fillForm(currentBill);
  updateActionButtons();
  const msg =
    opts.autosave
      ? "Autosaved"
      : currentBill.kind === "quote" && currentBill.status === "sent"
        ? "Saved — send email again if the customer needs the update"
        : currentBill.number
          ? `Saved ${currentBill.number}`
          : "Saved";
  Admin.showBillingStatus(msg);
  return currentBill;
}

const billAutosave = Admin.createAutosave({
  isReady: () =>
    Boolean(
      currentBill &&
        !currentBill.unsaved &&
        currentBill.id &&
        billingEditView &&
        !billingEditView.hidden &&
        currentBill.status !== "void" &&
        billingCustomerSelect?.value &&
        billingVehicleSelect?.value
    ),
  save: () => saveBill({ autosave: true, refresh: false }),
  onSaving: (msg) => {
    if (msg) Admin.showBillingStatus(msg);
  },
  onError: (err) => Admin.showBillingStatus(err.message || "Save failed"),
});

function scheduleBillAutosave() {
  billAutosave.schedule();
}

function updateActionButtons() {
  const doc = currentBill;
  const saveBtn = document.getElementById("btn-billing-save");
  const convertBtn = document.getElementById("btn-billing-convert");
  const openInvBtn = document.getElementById("btn-billing-open-invoice");
  const emailBtn = document.getElementById("btn-billing-email");
  const reviseBtn = document.getElementById("btn-billing-revise");
  const voidBtn = document.getElementById("btn-billing-void");
  const deleteBtn = document.getElementById("btn-billing-delete");
  const addLineBtn = document.getElementById("btn-add-line");

  const linesEditable = canEditLines(doc);
  const quoteLocked =
    doc.kind === "quote" && (doc.status === "accepted" || doc.status === "invoiced");

  if (saveBtn) {
    if (doc.kind === "quote") {
      saveBtn.hidden = doc.status === "void";
      saveBtn.textContent = "Save changes";
      saveBtn.classList.toggle("primary", linesEditable);
      saveBtn.classList.toggle("ghost", !linesEditable);
    } else {
      // Invoices: always allow Save for payment updates (even when lines are locked).
      saveBtn.hidden = doc.status === "void";
      saveBtn.textContent = "Save";
      saveBtn.classList.add("primary");
      saveBtn.classList.remove("ghost");
    }
  }

  convertBtn.hidden = !(doc.kind === "quote" && doc.status === "accepted" && !doc.invoiceId);
  if (openInvBtn) {
    openInvBtn.hidden = !(
      doc.kind === "quote" &&
      doc.invoiceId &&
      doc.invoiceId !== doc.id
    );
  }
  if (reviseBtn) reviseBtn.hidden = !quoteLocked;
  const unsaved = Boolean(doc.unsaved || !doc.id);
  const previewBtn = document.getElementById("btn-billing-preview");
  if (previewBtn) {
    previewBtn.hidden = doc.status === "void";
  }
  const jobBtn = document.getElementById("btn-billing-job");
  const canJob =
    !unsaved &&
    ((doc.kind === "quote" && (doc.status === "accepted" || doc.status === "invoiced")) ||
      (doc.kind === "invoice" && doc.status !== "void"));
  if (jobBtn) {
    jobBtn.hidden = !canJob;
    jobBtn.textContent = doc.jobId ? "Open job card" : "Create job card";
  }
  const reportBtn = document.getElementById("btn-billing-report");
  if (reportBtn) {
    const canReport = !unsaved && doc.kind === "invoice" && doc.status !== "void";
    reportBtn.hidden = !canReport;
    reportBtn.textContent = doc.reportId ? "Open report" : "Create report";
  }
  emailBtn.textContent = "Send email";
  emailBtn.hidden =
    unsaved ||
    doc.status === "void" ||
    (doc.kind === "quote" && (doc.status === "accepted" || doc.status === "invoiced"));
  emailBtn.classList.toggle("primary", !linesEditable || doc.status === "sent");
  emailBtn.classList.toggle("ghost", linesEditable && doc.status === "draft");
  voidBtn.hidden =
    unsaved || doc.status === "void" || doc.status === "invoiced" || doc.status === "draft";
  deleteBtn.hidden = doc.status !== "draft" && !unsaved;
  addLineBtn.hidden = !linesEditable;
}

async function showList(opts = {}) {
  try {
    await billAutosave.flush();
  } catch {
    /* still leave the editor */
  }
  billAutosave.cancel();
  currentBill = null;
  if (opts.kind === "invoice" || opts.kind === "quote") listKind = opts.kind;
  if (opts.filter) listFilter = opts.filter;
  else if (opts.kind) listFilter = "all";
  if (opts.month) listMonth = String(opts.month);
  else if (opts.kind) listMonth = "";
  applyPartyOpts(opts);
  if (opts.kind) {
    if (billingSearch) billingSearch.value = "";
    resetBillingPartyFields();
  }
  billingEditView.hidden = true;
  billingListView.hidden = false;
  Admin.setSection(listKind === "invoice" ? "invoices" : "quotes");
  updateListChrome();
  Admin.setViewTitle(listTitle());
  try {
    await loadBillingList();
  } catch (err) {
    alert(err.message);
  }
}

billingSearch?.addEventListener("input", renderBillingList);
billingSearch?.addEventListener("search", renderBillingList);

billingCustomerSelect?.addEventListener("change", async () => {
  if (!canEditCustomer(currentBill)) return;
  const customerId = billingCustomerSelect.value;
  await loadCustomerDirectory();
  Admin.fillCustomerSelect(billingCustomerSelect, customerDirectory, customerId);
  Admin.fillVehicleSelect(billingVehicleSelect, selectedBillingCustomer(), "");
  syncBillingPartyFields();
  scheduleBillAutosave();
});
billingVehicleSelect?.addEventListener("change", () => {
  if (!canEditCustomer(currentBill)) return;
  syncBillingPartyFields();
  scheduleBillAutosave();
});

document.getElementById("billing-plate-find")?.addEventListener("input", onBillingPlateFindInput);
document.getElementById("billing-plate-find")?.addEventListener("search", onBillingPlateFindInput);
document.getElementById("billing-plate-find")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") event.preventDefault();
});
billingForm?.addEventListener("submit", (event) => event.preventDefault());

document.getElementById("billing-wof-expiry")?.addEventListener("change", () => {
  if (!canEditCustomer(currentBill)) return;
  scheduleBillAutosave();
});
document.querySelectorAll("[data-wof-months]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!canEditCustomer(currentBill)) return;
    const input = document.getElementById("billing-wof-expiry");
    if (!input) return;
    input.value = plusCalendarMonths(Admin.todayIso(), Number(btn.dataset.wofMonths) || 12);
    scheduleBillAutosave();
  });
});

document.getElementById("btn-billing-back").addEventListener("click", () => showList());

document.getElementById("btn-add-line").addEventListener("click", () => {
  if (!canEditLines(currentBill)) return;
  lineRows.push(newLine());
  renderLines();
  scheduleBillAutosave();
});

document.getElementById("btn-billing-save").addEventListener("click", async () => {
  try {
    await saveBill();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("btn-billing-revise")?.addEventListener("click", async () => {
  if (!currentBill || currentBill.kind !== "quote") return;
  if (
    !confirm(
      `Create a new draft quote from ${currentBill.number}? The original stays as-is; you can edit the new one and send it.`
    )
  ) {
    return;
  }
  try {
    const doc = await Admin.api(`/api/billing/${currentBill.id}/revise`, {
      method: "POST",
      body: "{}",
    });
    await openDoc(doc.id);
    Admin.showBillingStatus(`${doc.number} created — edit and Save changes`);
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("btn-billing-preview")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-billing-preview");
  try {
    if (btn) btn.disabled = true;
    await saveBill();
    const doc = currentBill;
    if (!doc?.id || doc.status === "void") {
      throw new Error("Save this invoice or quote first.");
    }
    const params = new URLSearchParams();
    if (doc.viewToken) params.set("v", doc.viewToken);
    if (doc.kind === "quote" && doc.acceptToken) params.set("t", doc.acceptToken);
    params.set("preview", "1");
    const url = `${location.origin}/b/${doc.id}?${params.toString()}`;
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      throw new Error("Allow pop-ups to open the customer preview.");
    }
  } catch (err) {
    alert(err.message);
  } finally {
    if (btn) btn.disabled = false;
    updateActionButtons();
  }
});

document.getElementById("btn-billing-email").addEventListener("click", async () => {
  const btn = document.getElementById("btn-billing-email");
  try {
    await saveBill();
    if (!currentBill.customerEmail) {
      throw new Error("Add the customer email first.");
    }
    if (!Admin.confirmPublicCustomerLink("quote / invoice")) return;
    btn.disabled = true;
    btn.textContent = "Sending…";
    const result = await Admin.api(`/api/billing/${currentBill.id}/email`, {
      method: "POST",
      body: JSON.stringify({ baseUrl: location.origin }),
    });
    currentBill = result.doc || currentBill;
    fillForm(currentBill);
    Admin.showBillingStatus(`Email sent to ${result.to}`);
    alert(`Email sent to ${result.to}`);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    updateActionButtons();
  }
});

document.getElementById("btn-billing-convert").addEventListener("click", async () => {
  try {
    const invoice = await Admin.api(`/api/billing/${currentBill.id}/convert`, {
      method: "POST",
      body: "{}",
    });
    await openDoc(invoice.id);
    Admin.showBillingStatus(`${invoice.number} is now the invoice`);
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("btn-billing-open-invoice").addEventListener("click", async () => {
  if (currentBill?.invoiceId) await openDoc(currentBill.invoiceId);
});

document.getElementById("btn-billing-job")?.addEventListener("click", async () => {
  if (!currentBill) return;
  try {
    await billAutosave.flush();
    if (!currentBill.jobId) {
      const job = await Admin.api(`/api/jobs/from-quote/${currentBill.id}`, {
        method: "POST",
        body: "{}",
      });
      currentBill.jobId = job.id;
      updateActionButtons();
    }
    Admin.setSection("jobs");
    if (!window.DeaneJobs?.openJob) {
      throw new Error("Jobs page did not load. Refresh Admin and try Open job card again.");
    }
    await window.DeaneJobs.openJob(currentBill.jobId);
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("btn-billing-report")?.addEventListener("click", async () => {
  if (!currentBill || currentBill.kind !== "invoice") return;
  try {
    await billAutosave.flush();
    if (currentBill.reportId && window.DeaneAdmin?.openReport) {
      Admin.setSection("reports");
      await window.DeaneAdmin.openReport(currentBill.reportId);
      return;
    }
    const report = await Admin.api(`/api/reports/from-invoice/${currentBill.id}`, {
      method: "POST",
      body: "{}",
    });
    currentBill.reportId = report.id;
    updateActionButtons();
    Admin.setSection("reports");
    await window.DeaneAdmin.openReport(report.id);
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("btn-billing-void").addEventListener("click", async () => {
  if (!currentBill || !confirm("Void this document? It will stay in the list but cannot be used.")) {
    return;
  }
  billAutosave.cancel();
  try {
    currentBill = await Admin.api(`/api/billing/${currentBill.id}/void`, {
      method: "POST",
      body: "{}",
    });
    fillForm(currentBill);
    Admin.showBillingStatus("Voided");
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("btn-billing-delete").addEventListener("click", async () => {
  if (!currentBill) return;
  if (currentBill.unsaved || !currentBill.id) {
    billAutosave.cancel();
    currentBill = null;
    await showList();
    return;
  }
  if (!confirm("Delete this draft permanently?")) return;
  billAutosave.cancel();
  try {
    await Admin.api(`/api/billing/${currentBill.id}`, { method: "DELETE" });
    currentBill = null;
    await showList();
  } catch (err) {
    alert(err.message);
  }
});

document.querySelectorAll("[data-pay-method]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-pay-method]").forEach((other) => {
      other.classList.toggle("is-active", other === btn);
    });
  });
});

document.getElementById("btn-add-payment")?.addEventListener("click", () => {
  if (currentBill?.kind !== "invoice") return;
  const method = requirePayMethod();
  if (!method) return;
  addPaymentRow(invoiceBalanceDue(), method);
});

document.getElementById("btn-add-deposit-30")?.addEventListener("click", () => {
  if (currentBill?.kind !== "invoice") return;
  const method = requirePayMethod();
  if (!method) return;
  const total = Number(currentBill.totals?.totalIncl) || invoiceTotalIncl();
  addPaymentRow(round2(total * 0.3), method);
});

window.addEventListener("beforeunload", () => {
  billAutosave.flush();
});
billingForm?.addEventListener("input", scheduleBillAutosave);
billingForm?.addEventListener("change", scheduleBillAutosave);

window.DeaneBilling = { showList, openDoc, createFromJob };
})();
