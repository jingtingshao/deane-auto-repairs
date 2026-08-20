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
const billingSearch = document.getElementById("billing-search");
const customerSuggestEl = document.getElementById("billing-customer-suggest");
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
  return doc.status === "draft";
}

function canEditCustomer(doc) {
  if (!doc || doc.status === "void") return false;
  if (doc.kind === "quote") return true;
  return canEditLines(doc);
}

function setBillingFieldsEditable(editable) {
  [
    "customerName",
    "customerEmail",
    "customerPhone",
    "registration",
    "vehicle",
    "notes",
    "validUntil",
  ].forEach((name) => {
    const el = billingInput(name);
    if (!el) return;
    el.readOnly = !editable;
    el.disabled = false;
  });
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

function paymentLabel(status) {
  const map = { unpaid: "Unpaid", deposit: "Deposit", paid: "Paid", overdue: "Overdue" };
  return map[status] || "";
}

function formatListDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
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
    .map((d) => {
      const payStatus = d.overdue ? "overdue" : d.paymentStatus;
      const payBadge =
        d.kind === "invoice" && payStatus
          ? `<span class="badge pay-${Admin.escapeAttr(payStatus)}">${Admin.escapeHtml(paymentLabel(payStatus))}</span>`
          : "";
      const payHint =
        d.kind === "invoice" && d.overdue
          ? ` · overdue ${money(d.balanceDue)}`
          : d.kind === "invoice" && d.paymentStatus && d.paymentStatus !== "paid"
            ? ` · due ${money(d.balanceDue)}`
            : d.kind === "invoice" && d.paymentStatus === "paid"
              ? ` · paid ${money(d.amountPaid)}`
              : "";
      const viewedBadge =
        d.kind === "quote" && d.viewedAt
          ? `<span class="badge viewed" title="${Admin.escapeAttr(
              d.lastViewedAt || d.viewedAt
            )}">Viewed</span>`
          : "";
      const when = formatListDate(d.sortAt || d.sentAt || d.createdAt || d.updatedAt);
      return `
      <article class="report-card billing-card" data-id="${d.id}">
        <div class="billing-number">${Admin.escapeHtml(d.number)}</div>
        <div>
          <h2>${Admin.escapeHtml(d.customerName || "Customer")}</h2>
          <p class="muted">${when ? `${Admin.escapeHtml(when)} · ` : ""}${Admin.escapeHtml(d.registration || "No plate")} · ${Admin.escapeHtml(kindLabel(d.kind))} · ${Admin.escapeHtml(d.vehicle || "")} · ${money(d.totalIncl)}${payHint}</p>
        </div>
        <div class="job-card-meta">
          <span class="badge ${d.status}">${Admin.escapeHtml(d.status)}</span>
          ${viewedBadge}
          ${payBadge}
        </div>
      </article>`;
    })
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
  if (!row || !canEditCustomer(currentBill)) return;
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
  set("notes", doc.notes);
  hideCustomerSuggest();

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
      if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);
      renderPayments();
    } else {
      paymentRows = [];
    }
  }

  // Customer details stay editable on quotes until void; lines only while draft/sent.
  setBillingFieldsEditable(canEditCustomer(doc));

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
  renderHistory(doc);
  updateActionButtons();
}

function formatHistoryWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
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
  const net = round2(
    lineRows.reduce(
      (sum, line) => sum + (Number(line.qty) || 0) * (Number(line.unitPriceIncl) || 0),
      0
    )
  );
  const gst = round2(net * 0.15);
  const totalIncl = round2(net + gst);
  billingTotalsEl.innerHTML = `
    <p><span>Subtotal excl. GST</span><span>${money(net)}</span></p>
    <p><span>GST (15%)</span><span>${money(gst)}</span></p>
    <p><span>Total (plus GST)</span><span>${money(totalIncl)}</span></p>
  `;
}

function collectBill() {
  const value = (name) => String(billingInput(name)?.value || "").trim();
  const payload = {
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
  }
  return payload;
}

function invoiceTotalIncl() {
  const net = round2(
    lineRows.reduce(
      (sum, line) => sum + (Number(line.qty) || 0) * (Number(line.unitPriceIncl) || 0),
      0
    )
  );
  return round2(net + round2(net * 0.15));
}

function paymentsTotal() {
  return round2(paymentRows.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
}

function updatePaymentSummary() {
  const el = document.getElementById("billing-payment-summary");
  if (!el || currentBill?.kind !== "invoice") return;
  const total = Number(currentBill.totals?.totalIncl) || invoiceTotalIncl();
  const paid = paymentsTotal();
  const due = round2(Math.max(0, total - paid));
  let status =
    paid <= 0 ? "Unpaid" : due <= 0 ? "Paid" : "Deposit / partial";
  if (due > 0 && currentBill.overdue) status = "Overdue";
  el.textContent = `Status: ${status} · Paid ${money(paid)} · Balance due ${money(due)} · Invoice ${money(total)}`;
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
          <td>${Admin.escapeHtml(p.paidAt || "—")}</td>
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
      });
    });
  }
  updatePaymentSummary();
}

function addPaymentRow(amount, note) {
  const amt = round2(Number(amount) || 0);
  if (amt <= 0) {
    alert("Enter a payment amount greater than zero.");
    return false;
  }
  const dateEl = document.getElementById("billing-pay-date");
  const noteEl = document.getElementById("billing-pay-note");
  paymentRows.push({
    id: crypto.randomUUID(),
    amount: amt,
    paidAt: dateEl?.value || new Date().toISOString().slice(0, 10),
    note: String(note != null ? note : noteEl?.value || "").trim(),
  });
  if (noteEl) noteEl.value = "";
  const amountEl = document.getElementById("billing-pay-amount");
  if (amountEl) amountEl.value = "";
  renderPayments();
  return true;
}

async function saveBill() {
  if (!currentBill) return null;
  if (currentBill.status === "void") {
    throw new Error("This document has been voided.");
  }
  currentBill = await Admin.api(`/api/billing/${currentBill.id}`, {
    method: "PUT",
    body: JSON.stringify(collectBill()),
  });
  fillForm(currentBill);
  const msg =
    currentBill.kind === "quote" && currentBill.status === "sent"
      ? "Saved — send email again if the customer needs the update"
      : "Saved";
  Admin.showBillingStatus(msg);
  updateActionButtons();
  return currentBill;
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
  openInvBtn.hidden = !(doc.kind === "quote" && doc.status === "invoiced" && doc.invoiceId);
  if (reviseBtn) reviseBtn.hidden = !quoteLocked;
  const jobBtn = document.getElementById("btn-billing-job");
  const canJob =
    (doc.kind === "quote" && (doc.status === "accepted" || doc.status === "invoiced")) ||
    (doc.kind === "invoice" && doc.quoteId);
  if (jobBtn) {
    jobBtn.hidden = !canJob;
    jobBtn.textContent = doc.jobId ? "Open job card" : "Create job card";
  }
  emailBtn.textContent = "Send email";
  emailBtn.hidden = doc.status === "void" || doc.status === "invoiced";
  emailBtn.classList.toggle("primary", !linesEditable || doc.status === "sent");
  emailBtn.classList.toggle("ghost", linesEditable && doc.status === "draft");
  voidBtn.hidden = doc.status === "void" || doc.status === "invoiced" || doc.status === "draft";
  deleteBtn.hidden = doc.status !== "draft";
  addLineBtn.hidden = !linesEditable;
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
  if (!canEditCustomer(currentBill)) return;
  renderCustomerSuggest(matchCustomers(billingInput("customerName")?.value, "name"));
});

document.getElementById("billing-customer-name")?.addEventListener("blur", () => {
  const name = String(billingInput("customerName")?.value || "").trim().toLowerCase();
  const exact = customerDirectory.filter(
    (row) => String(row.customerName || "").trim().toLowerCase() === name
  );
  if (exact.length === 1 && canEditCustomer(currentBill)) {
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
  if (!canEditCustomer(currentBill)) return;
  const matches = matchCustomers(billingInput("registration")?.value, "registration");
  const plate = normalizeSearch(billingInput("registration")?.value);
  const exact = matches.filter((row) => normalizeSearch(row.registration) === plate);
  if (exact.length === 1) applyCustomerToForm(exact[0]);
});

document.getElementById("btn-billing-back").addEventListener("click", showList);

document.getElementById("btn-add-line").addEventListener("click", () => {
  if (!canEditLines(currentBill)) return;
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

document.getElementById("btn-add-payment")?.addEventListener("click", () => {
  if (currentBill?.kind !== "invoice") return;
  const amountEl = document.getElementById("billing-pay-amount");
  addPaymentRow(amountEl?.value);
});

document.getElementById("btn-add-deposit-30")?.addEventListener("click", () => {
  if (currentBill?.kind !== "invoice") return;
  const total = Number(currentBill.totals?.totalIncl) || invoiceTotalIncl();
  addPaymentRow(round2(total * 0.3), "30% deposit");
});

document.getElementById("btn-add-balance")?.addEventListener("click", () => {
  if (currentBill?.kind !== "invoice") return;
  const total = Number(currentBill.totals?.totalIncl) || invoiceTotalIncl();
  const due = round2(Math.max(0, total - paymentsTotal()));
  if (due <= 0) {
    alert("Nothing left to pay.");
    return;
  }
  addPaymentRow(due, "Balance");
});

window.DeaneBilling = { showList, openDoc };
})();
