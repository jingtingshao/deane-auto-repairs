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
let billingDocs = [];
let customerDirectory = [];
const billingSearch = document.getElementById("billing-search");
const customerSuggestEl = document.getElementById("billing-customer-suggest");

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

function hideCustomerSuggest() {
  if (!customerSuggestEl) return;
  customerSuggestEl.hidden = true;
  customerSuggestEl.innerHTML = "";
}

function applyCustomerToForm(row) {
  if (!row || isLocked(currentBill)) return;
  const setIf = (name, value) => {
    const el = billingInput(name);
    if (!el) return;
    const next = String(value || "").trim();
    if (next) el.value = next;
  };
  setIf("customerName", row.customerName);
  setIf("customerEmail", row.customerEmail);
  setIf("customerPhone", row.customerPhone);
  setIf("registration", row.registration);
  setIf("vehicle", row.vehicle);
  hideCustomerSuggest();
  Admin.showBillingStatus("Customer details filled");
}

function matchCustomers(query, field) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const plateQuery = q.replace(/[\s-]/g, "");
  return customerDirectory
    .filter((row) => {
      if (field === "registration") {
        return normalizeSearch(row.registration).includes(plateQuery);
      }
      const name = String(row.customerName || "").toLowerCase();
      return name.includes(q);
    })
    .slice(0, 8);
}

function renderCustomerSuggest(matches) {
  if (!customerSuggestEl) return;
  if (!matches.length) {
    hideCustomerSuggest();
    return;
  }
  customerSuggestEl.hidden = false;
  customerSuggestEl.innerHTML = matches
    .map((row, index) => {
      const line = [row.customerName, row.registration, row.customerPhone].filter(Boolean).join(" · ");
      return `<button type="button" data-match="${index}">${Admin.escapeHtml(line || "Customer")}</button>`;
    })
    .join("");
  customerSuggestEl.querySelectorAll("[data-match]").forEach((btn) => {
    btn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applyCustomerToForm(matches[Number(btn.dataset.match)]);
    });
  });
}

async function openDoc(id) {
  if (!customerDirectory.length) await loadCustomerDirectory();
  currentBill = await Admin.api(`/api/billing/${id}`);
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
  set("customerName", doc.customerName);
  set("customerEmail", doc.customerEmail);
  set("customerPhone", doc.customerPhone);
  set("registration", doc.registration);
  set("vehicle", doc.vehicle);
  set("odometer", doc.odometer);
  set("notes", doc.notes);
  hideCustomerSuggest();

  document.getElementById("billing-legend").textContent =
    doc.kind === "invoice" ? "Tax invoice" : "Quote";

  const validLabel = billingInput("validUntil")?.closest("label");
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
  const value = (name) => String(billingInput(name)?.value || "").trim();
  return {
    customerName: value("customerName"),
    customerEmail: value("customerEmail"),
    customerPhone: value("customerPhone"),
    registration: value("registration"),
    vehicle: value("vehicle"),
    odometer: value("odometer"),
    notes: String(billingInput("notes")?.value || "").trim(),
    validUntil: billingInput("validUntil")?.value || "",
    lines: lineRows.map((line) => ({ ...line })),
  };
}

async function saveBill() {
  if (!currentBill) return null;
  currentBill = await Admin.api(`/api/billing/${currentBill.id}`, {
    method: "PUT",
    body: JSON.stringify(collectBill()),
  });
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
  const jobBtn = document.getElementById("btn-billing-job");
  const canJob =
    (doc.kind === "quote" && (doc.status === "accepted" || doc.status === "invoiced")) ||
    (doc.kind === "invoice" && doc.quoteId);
  if (jobBtn) {
    jobBtn.hidden = !canJob;
    jobBtn.textContent = doc.jobId ? "Open job card" : "Create job card";
  }
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

document.getElementById("billing-customer-name")?.addEventListener("input", () => {
  if (isLocked(currentBill)) return;
  renderCustomerSuggest(matchCustomers(billingInput("customerName")?.value, "name"));
});

document.getElementById("billing-customer-name")?.addEventListener("blur", () => {
  const name = String(billingInput("customerName")?.value || "").trim().toLowerCase();
  const exact = customerDirectory.filter(
    (row) => String(row.customerName || "").trim().toLowerCase() === name
  );
  if (exact.length === 1 && !isLocked(currentBill)) {
    applyCustomerToForm(exact[0]);
    return;
  }
  setTimeout(() => {
    if (customerSuggestEl && !customerSuggestEl.contains(document.activeElement)) {
      hideCustomerSuggest();
    }
  }, 150);
});

document.getElementById("billing-registration")?.addEventListener("blur", () => {
  if (isLocked(currentBill)) return;
  const matches = matchCustomers(billingInput("registration")?.value, "registration");
  const plate = normalizeSearch(billingInput("registration")?.value);
  const exact = matches.filter((row) => normalizeSearch(row.registration) === plate);
  if (exact.length === 1) applyCustomerToForm(exact[0]);
});

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

document.getElementById("btn-billing-job")?.addEventListener("click", async () => {
  if (!currentBill) return;
  try {
    if (currentBill.jobId) {
      Admin.setSection("jobs");
      await window.DeaneJobs.openJob(currentBill.jobId);
      return;
    }
    const job = await Admin.api(`/api/jobs/from-quote/${currentBill.id}`, {
      method: "POST",
      body: "{}",
    });
    currentBill.jobId = job.id;
    updateActionButtons();
    Admin.setSection("jobs");
    await window.DeaneJobs.openJob(job.id);
  } catch (err) {
    alert(err.message);
  }
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
})();
