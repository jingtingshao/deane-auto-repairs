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

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
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

async function createDoc(preset) {
  try {
    const doc = await Admin.api("/api/billing", {
      method: "POST",
      body: JSON.stringify({ preset }),
    });
    await openDoc(doc.id);
    Admin.showBillingStatus(`${doc.number} created`);
  } catch (err) {
    alert(err.message);
  }
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
    if (listFilter === "all") return d.status !== "void" && d.status !== "invoiced";
    if (listFilter === "awaiting") return d.status === "sent";
    if (listFilter === "accepted") return d.status === "accepted";
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
  Admin.fillCustomerSelect(
    billingCustomerSelect,
    customerDirectory,
    matched?.customerId || doc?.customerId || ""
  );
  Admin.fillVehicleSelect(
    billingVehicleSelect,
    selectedBillingCustomer() || matched,
    doc?.vehicleId || doc?.registration || ""
  );
  const row = selectedBillingCustomer() || matched;
  Admin.applyPartyToForm(billingForm, row, selectedBillingVehicle(row));
  if (!row && billingForm && doc) {
    const set = (name, value) => {
      const el = billingInput(name);
      if (el) el.value = value || "";
    };
    set("customerName", doc.customerName);
    set("customerEmail", doc.customerEmail);
    set("customerPhone", doc.customerPhone);
    set("registration", doc.registration);
    set("vehicle", doc.vehicle);
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
    } else {
      paymentRows = [];
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
  if (!list) return;
  if (fs) fs.hidden = doc.status === "void" && !(doc.history || []).length;
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
      return `<li class="history-item history-${Admin.escapeAttr(ev.type || "note")}">
        <div class="history-when">${Admin.escapeHtml(formatHistoryWhen(ev.at))}</div>
        <div class="history-body">
          <p class="history-summary">${Admin.escapeHtml(ev.summary || ev.type || "Update")}${amount}</p>
          ${detail}
        </div>
      </li>`;
    })
    .join("");
}

function lineLooksLikeWof(description) {
  return /\bwof\b/i.test(String(description || "").trim());
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
  quickAddsEl.innerHTML = locked
    ? ""
    : adds
        .map(
          (a, i) =>
            `<button type="button" data-quick="${i}">${Admin.escapeHtml(a.label)}</button>`
        )
        .join("");
  quickAddsEl.querySelectorAll("[data-quick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = adds[Number(btn.dataset.quick)];
      if (!item) return;
      lineRows.push(newLine(item));
      renderLines();
      scheduleBillAutosave();
    });
  });
}

function renderLines() {
  const locked = !canEditLines(currentBill);
  billingLinesEl.innerHTML = lineRows
    .map((line, index) => {
      const total = round2((Number(line.qty) || 0) * (Number(line.unitPriceIncl) || 0));
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
      const total = round2(
        (Number(lineRows[index].qty) || 0) * (Number(lineRows[index].unitPriceIncl) || 0)
      );
      row.querySelector(".total").textContent = money(total);
      renderTotals();
      if (field === "description") syncWofExpiryField();
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

function computeTotals(lines) {
  let net = 0;
  let gst = 0;
  let totalIncl = 0;
  for (const line of lines || []) {
    const qty = Number(line.qty) || 0;
    const unit = Number(line.unitPriceIncl) || 0;
    const advertised = advertisedInclFromExcl(unit);
    let lineNet;
    let lineGst;
    let lineIncl;
    if (advertised != null) {
      lineIncl = round2(qty * advertised);
      lineGst = round2(lineIncl * (3 / 23));
      lineNet = round2(lineIncl - lineGst);
    } else {
      lineNet = round2(qty * unit);
      lineIncl = round2(lineNet * 1.15);
      lineGst = round2(lineIncl - lineNet);
    }
    net = round2(net + lineNet);
    gst = round2(gst + lineGst);
    totalIncl = round2(totalIncl + lineIncl);
  }
  return { net, gst, totalIncl };
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
    notes: String(billingInput("notes")?.value || "").trim(),
    validUntil: billingInput("validUntil")?.value || "",
    lines: lineRows.map((line) => ({ ...line })),
  };
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
  return round2(Math.max(0, total - paymentsTotal()));
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
  const due = invoiceBalanceDue();
  let status =
    paid <= 0 ? "Unpaid" : due <= 0 ? "Paid" : "Deposit / partial";
  if (due > 0 && currentBill.overdue) status = "Overdue";
  el.textContent = `Status: ${status} · Paid ${money(paid)} · Balance due ${money(due)} · Invoice ${money(total)}`;
  const hint = document.getElementById("billing-pay-full-hint");
  if (hint) {
    hint.textContent =
      due > 0
        ? `Add payment records the full balance due (${money(due)}).`
        : "Nothing left to pay.";
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
  currentBill = await Admin.api(`/api/billing/${currentBill.id}`, {
    method: "PUT",
    body: JSON.stringify(collectBill()),
  });
  if (opts.refresh !== false) fillForm(currentBill);
  updateActionButtons();
  const msg =
    opts.autosave
      ? "Autosaved"
      : currentBill.kind === "quote" && currentBill.status === "sent"
        ? "Saved — send email again if the customer needs the update"
        : "Saved";
  Admin.showBillingStatus(msg);
  return currentBill;
}

const billAutosave = Admin.createAutosave({
  isReady: () =>
    Boolean(
      currentBill &&
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

  convertBtn.hidden = !(doc.kind === "quote" && doc.status === "accepted");
  if (openInvBtn) openInvBtn.hidden = true;
  if (reviseBtn) reviseBtn.hidden = !quoteLocked;
  const jobBtn = document.getElementById("btn-billing-job");
  const canJob =
    (doc.kind === "quote" && (doc.status === "accepted" || doc.status === "invoiced")) ||
    (doc.kind === "invoice" && doc.status !== "void");
  if (jobBtn) {
    jobBtn.hidden = !canJob;
    jobBtn.textContent = doc.jobId ? "Open job card" : "Create job card";
  }
  const reportBtn = document.getElementById("btn-billing-report");
  if (reportBtn) {
    const canReport = doc.kind === "invoice" && doc.status !== "void";
    reportBtn.hidden = !canReport;
    reportBtn.textContent = doc.reportId ? "Open report" : "Create report";
  }
  emailBtn.textContent = "Send email";
  emailBtn.hidden =
    doc.status === "void" ||
    (doc.kind === "quote" && (doc.status === "accepted" || doc.status === "invoiced"));
  emailBtn.classList.toggle("primary", !linesEditable || doc.status === "sent");
  emailBtn.classList.toggle("ghost", linesEditable && doc.status === "draft");
  voidBtn.hidden = doc.status === "void" || doc.status === "invoiced" || doc.status === "draft";
  deleteBtn.hidden = doc.status !== "draft";
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
  if (!currentBill || !confirm("Delete this draft permanently?")) return;
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

window.DeaneBilling = { showList, openDoc };
})();
