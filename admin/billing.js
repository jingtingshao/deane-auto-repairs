const Admin = window.DeaneAdmin;

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
let billingDocs = [];
const billingSearch = document.getElementById("billing-search");

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

function isLocked(doc) {
  return ["accepted", "invoiced", "void"].includes(doc?.status);
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
  const plate = normalizeSearch(doc.registration);
  const plateQuery = q.replace(/[\s-]/g, "");
  return name.includes(q) || plate.includes(plateQuery);
}

function renderBillingList() {
  if (!billingDocs.length) {
    billingList.innerHTML =
      '<div class="empty">No quotes or invoices yet. Use the buttons above to start.</div>';
    return;
  }

  const query = billingSearch?.value || "";
  const docs = billingDocs.filter((d) => matchesBillingSearch(d, query));
  if (!docs.length) {
    billingList.innerHTML =
      '<div class="empty">No matching customer name or plate.</div>';
    return;
  }

  billingList.innerHTML = docs
    .map(
      (d) => `
      <article class="report-card billing-card" data-id="${d.id}">
        <div class="billing-number">${Admin.escapeHtml(d.number)}</div>
        <div>
          <h2>${Admin.escapeHtml(d.customerName || "Customer")}</h2>
          <p class="muted">${Admin.escapeHtml(d.registration || "No plate")} · ${Admin.escapeHtml(kindLabel(d.kind))} · ${Admin.escapeHtml(d.vehicle || "")} · ${money(d.totalIncl)}</p>
        </div>
        <span class="badge ${d.status}">${Admin.escapeHtml(d.status)}</span>
      </article>`
    )
    .join("");
  billingList.querySelectorAll(".report-card").forEach((card) => {
    card.addEventListener("click", () => openDoc(card.dataset.id));
  });
}

async function loadBillingList() {
  await loadCatalog();
  billingDocs = await Admin.api("/api/billing");
  renderBillingList();
}

async function openDoc(id) {
  currentBill = await Admin.api(`/api/billing/${id}`);
  billingListView.hidden = true;
  billingEditView.hidden = false;
  Admin.setViewTitle(currentBill.number);
  fillForm(currentBill);
}

function fillForm(doc) {
  const set = (name, value) => {
    const el = billingForm.elements.namedItem(name);
    if (!el) return;
    el.value = value ?? "";
  };
  set("number", doc.number);
  set("kind", kindLabel(doc.kind));
  set("status", doc.status);
  set("validUntil", doc.validUntil || "");
  set("customerName", doc.customerName);
  set("customerEmail", doc.customerEmail);
  set("customerPhone", doc.customerPhone);
  set("registration", doc.registration);
  set("vehicle", doc.vehicle);
  set("odometer", doc.odometer);
  set("notes", doc.notes);

  document.getElementById("billing-legend").textContent =
    doc.kind === "invoice" ? "Tax invoice" : "Quote";

  const validLabel = billingForm.elements.namedItem("validUntil")?.closest("label");
  if (validLabel) validLabel.hidden = doc.kind !== "quote";

  lineRows = (doc.lines || []).map((line) => newLine(line));
  if (!lineRows.length) lineRows = [newLine()];
  renderLines();
  renderQuickAdds();
  updateActionButtons();
}

function renderQuickAdds() {
  const adds = catalogMeta?.quickAdds || [];
  const locked = isLocked(currentBill);
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
    });
  });
}

function renderLines() {
  const locked = isLocked(currentBill);
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
    });
  });
  billingLinesEl.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.remove);
      lineRows.splice(index, 1);
      if (!lineRows.length) lineRows = [newLine()];
      renderLines();
    });
  });
  renderTotals();
}

function renderTotals() {
  const totalIncl = round2(
    lineRows.reduce(
      (sum, line) => sum + (Number(line.qty) || 0) * (Number(line.unitPriceIncl) || 0),
      0
    )
  );
  const net = round2(totalIncl / 1.15);
  const gst = round2(totalIncl - net);
  billingTotalsEl.innerHTML = `
    <p><span>Subtotal excl. GST</span><span>${money(net)}</span></p>
    <p><span>GST (15%)</span><span>${money(gst)}</span></p>
    <p><span>Total incl. GST</span><span>${money(totalIncl)}</span></p>
  `;
}

function collectBill() {
  const f = billingForm;
  return {
    customerName: f.customerName.value.trim(),
    customerEmail: f.customerEmail.value.trim(),
    customerPhone: f.customerPhone.value.trim(),
    registration: f.registration.value.trim(),
    vehicle: f.vehicle.value.trim(),
    odometer: f.odometer.value.trim(),
    notes: f.notes.value.trim(),
    validUntil: f.validUntil.value,
    lines: lineRows.map((line) => ({ ...line })),
  };
}

async function saveBill() {
  if (!currentBill) return null;
  currentBill = await Admin.api(`/api/billing/${currentBill.id}`, {
    method: "PUT",
    body: JSON.stringify(collectBill()),
  });
  billingForm.elements.namedItem("status").value = currentBill.status;
  Admin.showBillingStatus("Saved");
  updateActionButtons();
  return currentBill;
}

function updateActionButtons() {
  const doc = currentBill;
  const convertBtn = document.getElementById("btn-billing-convert");
  const openInvBtn = document.getElementById("btn-billing-open-invoice");
  const emailBtn = document.getElementById("btn-billing-email");
  const voidBtn = document.getElementById("btn-billing-void");
  const deleteBtn = document.getElementById("btn-billing-delete");
  const addLineBtn = document.getElementById("btn-add-line");

  convertBtn.hidden = !(doc.kind === "quote" && doc.status === "accepted");
  openInvBtn.hidden = !(doc.kind === "quote" && doc.status === "invoiced" && doc.invoiceId);
  emailBtn.textContent = doc.kind === "quote" ? "Email quote" : "Email invoice";
  emailBtn.hidden = doc.status === "void" || doc.status === "invoiced";
  document.getElementById("btn-billing-copy").hidden = doc.status === "void";
  voidBtn.hidden = doc.status === "void" || doc.status === "invoiced" || doc.status === "draft";
  deleteBtn.hidden = doc.status !== "draft";
  addLineBtn.hidden = isLocked(doc);
}

async function showList() {
  currentBill = null;
  billingEditView.hidden = true;
  billingListView.hidden = false;
  Admin.setViewTitle("Quotes & invoices");
  try {
    await loadBillingList();
  } catch (err) {
    alert(err.message);
  }
}

billingSearch?.addEventListener("input", renderBillingList);
billingSearch?.addEventListener("search", renderBillingList);

document.getElementById("btn-billing-back").addEventListener("click", showList);

document.getElementById("btn-add-line").addEventListener("click", () => {
  if (isLocked(currentBill)) return;
  lineRows.push(newLine());
  renderLines();
});

document.getElementById("btn-billing-save").addEventListener("click", async () => {
  try {
    await saveBill();
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
    alert(`Email sent to ${result.to}\n\nCustomer link:\n${result.url}`);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    updateActionButtons();
  }
});

document.getElementById("btn-billing-copy").addEventListener("click", async () => {
  try {
    await saveBill();
    const result = await Admin.api(`/api/billing/${currentBill.id}/issue`, {
      method: "POST",
      body: JSON.stringify({ baseUrl: location.origin }),
    });
    currentBill = result.doc || currentBill;
    fillForm(currentBill);
    await navigator.clipboard.writeText(result.url);
    Admin.showBillingStatus("Link copied");
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("btn-billing-convert").addEventListener("click", async () => {
  try {
    const invoice = await Admin.api(`/api/billing/${currentBill.id}/convert`, {
      method: "POST",
      body: "{}",
    });
    await openDoc(invoice.id);
    Admin.showBillingStatus("Invoice created");
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("btn-billing-open-invoice").addEventListener("click", async () => {
  if (currentBill?.invoiceId) await openDoc(currentBill.invoiceId);
});

document.getElementById("btn-billing-void").addEventListener("click", async () => {
  if (!currentBill || !confirm("Void this document? It will stay in the list but cannot be used.")) {
    return;
  }
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
  try {
    await Admin.api(`/api/billing/${currentBill.id}`, { method: "DELETE" });
    await showList();
  } catch (err) {
    alert(err.message);
  }
});

window.DeaneBilling = { showList, openDoc };
