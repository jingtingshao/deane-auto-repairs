(function () {
var Admin = window.DeaneAdmin;

const customersSection = document.getElementById("customers-section");
const customersList = document.getElementById("customers-list");
const customersSearch = document.getElementById("customers-search");
const customersFilter = document.getElementById("customers-filter");
const customerForm = document.getElementById("customer-form");
const customerDeleteBtn = document.getElementById("btn-customer-delete");

let customerRows = [];
let customerFilter = "all";
let customerLetter = "";
let customerShowAll = false;
let editingCustomerId = "";
let editingListKey = "";
let editingVehicleId = "";
let customerSortKey = "lastName";
let customersListBound = false;
let customerSortDir = "asc";
const RECENT_CUSTOMER_LIMIT = 25;

function formatReminderSent(iso) {
  return Admin.formatDateShort(iso);
}

function canSendWofReminder(row) {
  return Boolean(
    row?.customerId &&
      row.customerEmail &&
      (row.canWofReminder || (row.wofStatus === "due_soon" && !row.wofReminderSentAt))
  );
}

function canSendWofSmsReminder(row) {
  return Boolean(row?.customerId && row.canWofSmsReminder);
}

function eligibleWofReminderRows() {
  const seen = new Set();
  const out = [];
  for (const row of customerRows) {
    if (!canSendWofReminder(row)) continue;
    const key = `${row.customerId}|${row.wofReminderVehicleId || row.registration || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function eligibleWofSmsReminderRows() {
  const seen = new Set();
  const out = [];
  for (const row of customerRows) {
    if (!canSendWofSmsReminder(row)) continue;
    const key = `${row.customerId}|${row.wofSmsReminderVehicleId || row.registration || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function updateBulkRemindButton() {
  const btn = document.getElementById("btn-wof-remind-all");
  if (btn) {
    const n = eligibleWofReminderRows().length;
    if (!n) {
      btn.hidden = true;
      btn.disabled = false;
      btn.textContent = "Remind all due soon";
    } else {
      btn.hidden = false;
      btn.disabled = false;
      btn.textContent = `Remind all due soon (${n})`;
    }
  }
  const smsBtn = document.getElementById("btn-wof-sms-remind-all");
  if (smsBtn) {
    const n = eligibleWofSmsReminderRows().length;
    if (!n) {
      smsBtn.hidden = true;
      smsBtn.disabled = false;
      smsBtn.textContent = "SMS all due soon";
    } else {
      smsBtn.hidden = false;
      smsBtn.disabled = false;
      smsBtn.textContent = `SMS all due soon (${n})`;
    }
  }
}

function wofLabel(row) {
  if (row.wofStatus === "overdue") {
    return `Overdue ${Math.abs(row.daysUntil)}d`;
  }
  if (row.wofStatus === "due_soon") {
    return `Due in ${row.daysUntil}d`;
  }
  if (row.wofStatus === "ok") return "OK";
  return "No date";
}

function displayName(row) {
  const names = namesFromRow(row);
  const joined = [names.firstName, names.lastName].filter(Boolean).join(" ").trim();
  return joined || capitalizePersonName(String(row.customerName || "").trim());
}

function capitalizePersonName(value) {
  return String(value || "").replace(
    /(^|[\s-])(\S)/g,
    (_, sep, ch) => sep + ch.toLocaleUpperCase("en-NZ")
  );
}

function applyLiveTransform(input, transform) {
  if (!input) return;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const next = transform(input.value);
  if (next === input.value) return;
  input.value = next;
  try {
    input.setSelectionRange(start, end);
  } catch {
    /* some input types do not support selection */
  }
}

function namesFromRow(row) {
  const first = String(row?.firstName || "").trim();
  const last = String(row?.lastName || "").trim();
  if (first || last) {
    return {
      firstName: capitalizePersonName(first),
      lastName: capitalizePersonName(last),
    };
  }
  const parts = String(row?.customerName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    firstName: capitalizePersonName(parts[0] || ""),
    lastName: capitalizePersonName(parts.slice(1).join(" ")),
  };
}

function plateKey(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
}

function phoneKey(value) {
  return String(value || "").replace(/[\s()+-]/g, "");
}

function rowPlates(row) {
  const fromVehicles = Admin.customerVehicles(row)
    .map((v) => plateKey(v.registration))
    .filter(Boolean);
  if (fromVehicles.length) return fromVehicles;
  return String(row.registration || "")
    .split(",")
    .map((p) => plateKey(p))
    .filter(Boolean);
}

function findContactMatches(body, vehicles) {
  const email = String(body.customerEmail || "").trim().toLowerCase();
  const phone = phoneKey(body.customerPhone);
  const plates = new Set(vehicles.map((v) => plateKey(v.registration)).filter(Boolean));
  const hits = [];
  for (const row of customerRows) {
    if (editingCustomerId && row.customerId === editingCustomerId) continue;
    const reasons = [];
    if (phone && phoneKey(row.customerPhone) === phone) reasons.push("phone");
    if (email && String(row.customerEmail || "").trim().toLowerCase() === email) {
      reasons.push("email");
    }
    const overlap = rowPlates(row).filter((p) => plates.has(p));
    if (overlap.length) reasons.push(`plate ${overlap.join(", ")}`);
    if (reasons.length) {
      hits.push({ name: displayName(row) || "Customer", reasons });
    }
  }
  return hits;
}

function rowPlateSortValue(row) {
  const plates =
    Array.isArray(row.registrations) && row.registrations.length
      ? row.registrations
      : String(row.registration || "").split(",");
  return String(plates[0] || "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
}

function uniqueDisplaySeq(rows) {
  const saved = rows.filter((row) => row.customerId);
  const ordered = [...saved].sort((a, b) => {
    const byDate = String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    if (byDate) return byDate;
    return String(a.customerId).localeCompare(String(b.customerId));
  });
  const seen = new Set();
  const needsFix = ordered.some((row) => {
    const n = Number(row.customerSeq || row.dailySeq) || 0;
    if (!(n > 0) || seen.has(n)) return true;
    seen.add(n);
    return false;
  });
  const seqById = new Map();
  if (needsFix) {
    ordered.forEach((row, index) => seqById.set(row.customerId, index + 1));
  } else {
    for (const row of ordered) {
      seqById.set(row.customerId, Number(row.customerSeq || row.dailySeq));
    }
  }
  return rows.map((row) => {
    const n = row.customerId ? seqById.get(row.customerId) : 0;
    if (!n) return { ...row, customerSeq: 0, dailySeq: 0 };
    return { ...row, customerSeq: n, dailySeq: n };
  });
}

function sortCustomerRows(rows) {
  const dir = customerSortDir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (customerSortKey === "plate") {
      return dir * rowPlateSortValue(a).localeCompare(rowPlateSortValue(b), "en");
    }
    if (customerSortKey === "firstName") {
      return (
        dir *
        namesFromRow(a).firstName.localeCompare(namesFromRow(b).firstName, "en", {
          sensitivity: "base",
        })
      );
    }
    if (customerSortKey === "lastName") {
      return (
        dir *
        namesFromRow(a).lastName.localeCompare(namesFromRow(b).lastName, "en", {
          sensitivity: "base",
        })
      );
    }
    return dir * ((Number(a.customerSeq || a.dailySeq) || 0) - (Number(b.customerSeq || b.dailySeq) || 0));
  });
}

function sortHeader(key, label) {
  const active = customerSortKey === key;
  const arrow = active ? (customerSortDir === "desc" ? " ↓" : " ↑") : "";
  return `<th class="sortable${active ? " is-sorted" : ""}" data-sort="${Admin.escapeAttr(key)}">${Admin.escapeHtml(label)}${arrow}</th>`;
}

function matchesCustomerSearch(row, query) {
  const raw = String(query || "").trim().toLowerCase();
  if (!raw) return true;
  const names = namesFromRow(row);
  const plates = (
    Array.isArray(row.registrations) && row.registrations.length
      ? row.registrations
      : String(row.registration || "").split(",")
  )
    .map((p) => String(p || "").toUpperCase().replace(/[\s-]/g, ""))
    .filter(Boolean);
  const hay = [
    displayName(row),
    names.firstName,
    names.lastName,
    row.customerAddress,
    row.customerEmail,
    row.customerPhone,
    String(row.customerSeq || row.dailySeq || ""),
    plates.join(" "),
  ]
    .join(" ")
    .toLowerCase();
  const compactHay = hay.replace(/[\s()-]/g, "");
  return raw.split(/\s+/).filter(Boolean).every((token) => {
    const compact = token.replace(/[\s-]/g, "");
    return hay.includes(token) || (compact && compactHay.includes(compact));
  });
}

function lastNameInitial(row) {
  const ch = namesFromRow(row).lastName.charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : "#";
}

function recentCustomerRows(rows) {
  return [...rows]
    .sort((a, b) => {
      const byVisit = String(b.lastVisit || "").localeCompare(String(a.lastVisit || ""));
      if (byVisit) return byVisit;
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    })
    .slice(0, RECENT_CUSTOMER_LIMIT);
}

function renderLetterBar() {
  const el = document.getElementById("customers-letters");
  if (!el) return;
  const keys = ["", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), "#"];
  el.innerHTML = keys
    .map((key) => {
      const label = key || "All";
      const active = customerLetter === key ? " is-active" : "";
      return `<button type="button" class="ghost letter-btn${active}" data-letter="${Admin.escapeAttr(key)}">${label}</button>`;
    })
    .join("");
  el.querySelectorAll("[data-letter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      customerLetter = btn.dataset.letter || "";
      customerShowAll = false;
      if (customersSearch) customersSearch.value = "";
      renderLetterBar();
      renderCustomers();
    });
  });
}

function renderCustomers() {
  if (!customersList) return;
  if (!customerRows.length) {
    customersList.innerHTML =
      '<div class="empty">No customers yet. Click <strong>New customer</strong> (top right).</div>';
    updateBulkRemindButton();
    return;
  }

  const query = customersSearch?.value || "";
  const filtered = uniqueDisplaySeq(customerRows).filter((row) => {
    if (customerFilter !== "all" && row.wofStatus !== customerFilter) return false;
    if (customerLetter && lastNameInitial(row) !== customerLetter) return false;
    return matchesCustomerSearch(row, query);
  });
  const browsingRecent =
    !String(query).trim() && !customerLetter && customerFilter === "all" && !customerShowAll;
  const rows = browsingRecent ? recentCustomerRows(filtered) : sortCustomerRows(filtered);

  if (!filtered.length) {
    customersList.innerHTML = '<div class="empty">No matching customers. Try another name, plate, or letter.</div>';
    updateBulkRemindButton();
    return;
  }

  const total = uniqueDisplaySeq(customerRows).length;
  let summary = `${rows.length} customer${rows.length === 1 ? "" : "s"}`;
  if (browsingRecent && total > rows.length) {
    summary = `Showing the ${rows.length} most recent of ${total}. Type a name or plate, or tap a letter.`;
  } else if (customerLetter) {
    summary = `${rows.length} customer${rows.length === 1 ? "" : "s"} · last name ${customerLetter}`;
  } else if (String(query).trim()) {
    summary = `${rows.length} match${rows.length === 1 ? "" : "es"}`;
  } else if (customerShowAll) {
    summary = `All ${rows.length} customers · sorted by last name`;
  }

  customersList.innerHTML = `
    <p class="muted small">${Admin.escapeHtml(summary)}${
      browsingRecent && total > rows.length
        ? ` <button type="button" id="btn-customers-show-all" class="ghost">Show all</button>`
        : ""
    }</p>
    <div class="billing-table-wrap">
      <table class="billing-table customer-list-table">
        <thead>
          <tr>
            ${sortHeader("seq", "#")}
            ${sortHeader("plate", "Plate")}
            ${sortHeader("firstName", "First name")}
            ${sortHeader("lastName", "Last name")}
            <th>Address</th>
            <th>Phone</th>
            <th>Email</th>
            <th>WOF expiry</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => {
              const names = namesFromRow(row);
              const editing = Boolean(row.key) && editingListKey === row.key;
              const plates = String(row.registration || "")
                .split(",")
                .map((p) => String(p || "").trim().toUpperCase())
                .filter(Boolean)
                .join(", ") || "—";
              return `
            <tr class="customer-row${editing ? " is-editing-inline" : ""}" data-key="${Admin.escapeAttr(row.key)}" data-customer-id="${Admin.escapeAttr(row.customerId || "")}" data-vehicle-id="${Admin.escapeAttr(row.vehicleId || "")}">
              <td class="billing-number customer-index">${Number(row.customerSeq || row.dailySeq) || "—"}</td>
              <td class="customer-plate">${Admin.escapeHtml(plates)}</td>
              <td class="customer-first">
                ${
                  editing
                    ? `<input data-inline="firstName" value="${Admin.escapeAttr(names.firstName)}" autocomplete="given-name" />`
                    : Admin.escapeHtml(names.firstName || "—")
                }
              </td>
              <td class="customer-last">
                ${
                  editing
                    ? `<input data-inline="lastName" value="${Admin.escapeAttr(names.lastName)}" autocomplete="family-name" />`
                    : Admin.escapeHtml(names.lastName || "—")
                }
              </td>
              <td class="customer-address">
                ${
                  editing
                    ? `<textarea data-inline="customerAddress" rows="2">${Admin.escapeHtml(row.customerAddress || "")}</textarea>`
                    : `<span class="customer-address-text">${Admin.escapeHtml(row.customerAddress || "—")}</span>`
                }
              </td>
              <td class="customer-phone">
                ${
                  editing
                    ? `<input data-inline="customerPhone" type="tel" value="${Admin.escapeAttr(row.customerPhone || "")}" />`
                    : row.customerPhone
                      ? `<a href="tel:${Admin.escapeAttr(row.customerPhone)}">${Admin.escapeHtml(row.customerPhone)}</a>`
                      : "—"
                }
              </td>
              <td class="customer-email">
                ${
                  editing
                    ? `<input data-inline="customerEmail" type="email" value="${Admin.escapeAttr(row.customerEmail || "")}" />`
                    : row.customerEmail
                      ? `<a href="mailto:${Admin.escapeAttr(row.customerEmail)}">${Admin.escapeHtml(row.customerEmail)}</a>`
                      : "—"
                }
              </td>
              <td class="customer-wof">
                <span class="badge ${Admin.escapeAttr(row.wofStatus)}">${Admin.escapeHtml(wofLabel(row))}</span>
                <div class="muted small">${Admin.escapeHtml(Admin.formatDateShort(row.wofExpiry) || "—")}</div>
              </td>
              <td class="customer-actions">
                ${
                  editing
                    ? `<button type="button" class="primary compact" data-inline-save="${Admin.escapeAttr(row.customerId)}">Save</button>
                  <button type="button" class="ghost compact" data-inline-cancel="1">Cancel</button>
                  <button type="button" class="ghost compact" data-plate-id="${Admin.escapeAttr(row.customerId)}" data-plate-key="${Admin.escapeAttr(row.key)}">Plate</button>`
                    : `<button type="button" class="ghost" data-edit-id="${Admin.escapeAttr(row.customerId || "")}" data-edit-key="${Admin.escapeAttr(row.key)}">${
                        row.customerId ? "Edit" : "Open"
                      }</button>
                  <button type="button" class="ghost" data-invoices="1">Invoices</button>`
                }
                ${
                  !editing && row.lastReportId
                    ? `<button type="button" class="ghost" data-open-report="${Admin.escapeAttr(row.lastReportId)}">Report</button>`
                    : ""
                }
                ${
                  !editing && row.canDelete
                    ? `<button type="button" class="danger" data-delete-id="${Admin.escapeAttr(row.customerId)}">Delete</button>`
                    : ""
                }
                ${
                  !editing && (row.canWofReminder || canSendWofReminder(row))
                    ? `<button type="button" class="primary compact" data-remind-key="${Admin.escapeAttr(row.key)}">Email</button>`
                    : !editing && row.wofReminderSentAt
                    ? `<span class="reminder-sent">Email ${Admin.escapeHtml(formatReminderSent(row.wofReminderSentAt))}</span>`
                    : ""
                }
                ${
                  !editing && (row.canWofSmsReminder || canSendWofSmsReminder(row))
                    ? `<button type="button" class="ghost compact" data-sms-remind-key="${Admin.escapeAttr(row.key)}">SMS</button>`
                    : !editing && row.wofSmsReminderSentAt
                    ? `<span class="reminder-sent">SMS ${Admin.escapeHtml(formatReminderSent(row.wofSmsReminderSentAt))}</span>`
                    : ""
                }
              </td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;

  bindCustomersListOnce();

  customersList.querySelectorAll("tr.customer-row.is-editing-inline input, tr.customer-row.is-editing-inline textarea").forEach((el) => {
    el.addEventListener("click", (event) => event.stopPropagation());
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && el.tagName !== "TEXTAREA") {
        event.preventDefault();
        const id = el.closest("tr")?.getAttribute("data-customer-id") || "";
        if (id) saveInlineCustomer(id, el.closest("tr")?.querySelector("[data-inline-save]"));
      }
      if (event.key === "Escape") {
        editingListKey = "";
        renderCustomers();
      }
    });
  });

  customersList.querySelectorAll("[data-open-report]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      Admin.setSection("reports");
      await Admin.openReport(btn.dataset.openReport);
    });
  });

  customersList.querySelectorAll("[data-remind-key]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      sendReminder(btn.dataset.remindKey, btn);
    });
  });
  customersList.querySelectorAll("[data-sms-remind-key]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      sendSmsReminder(btn.dataset.smsRemindKey, btn);
    });
  });
  customersList.querySelectorAll("[data-delete-id]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteCustomerById(btn.dataset.deleteId, btn);
    });
  });
  customersList.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", (event) => event.stopPropagation());
  });
  updateBulkRemindButton();
}

function bindCustomersListOnce() {
  if (!customersList || customersListBound) return;
  customersListBound = true;
  customersList.addEventListener("click", (event) => {
    const showAll = event.target.closest("#btn-customers-show-all");
    if (showAll) {
      customerShowAll = true;
      renderCustomers();
      return;
    }

    const sortTh = event.target.closest("[data-sort]");
    if (sortTh && customersList.contains(sortTh)) {
      event.stopPropagation();
      const key = sortTh.getAttribute("data-sort");
      if (customerSortKey === key) {
        customerSortDir = customerSortDir === "asc" ? "desc" : "asc";
      } else {
        customerSortKey = key;
        customerSortDir = "asc";
      }
      renderCustomers();
      return;
    }

    const invoicesBtn = event.target.closest("[data-invoices]");
    if (invoicesBtn) {
      event.stopPropagation();
      const key = invoicesBtn.closest("tr")?.getAttribute("data-key") || "";
      const found = customerRows.find((r) => r.key === key);
      if (found) openCustomerInvoices(found);
      return;
    }

    const editBtn = event.target.closest("[data-edit-id], [data-edit-key]");
    if (editBtn) {
      event.stopPropagation();
      const id = editBtn.getAttribute("data-edit-id") || "";
      const found = id
        ? customerRows.find((r) => r.customerId === id)
        : customerRows.find((r) => r.key === editBtn.getAttribute("data-edit-key"));
      if (!found) return;
      if (found.customerId) {
        editingListKey = found.key;
        hideCustomerForm();
        renderCustomers();
        const editRow = [...customersList.querySelectorAll("tr.customer-row")].find(
          (tr) => tr.getAttribute("data-key") === found.key
        );
        editRow?.querySelector('[data-inline="firstName"]')?.focus();
        return;
      }
      showCustomerForm(found);
      return;
    }

    const cancelBtn = event.target.closest("[data-inline-cancel]");
    if (cancelBtn) {
      event.stopPropagation();
      editingListKey = "";
      renderCustomers();
      return;
    }

    const saveBtn = event.target.closest("[data-inline-save]");
    if (saveBtn) {
      event.stopPropagation();
      const id = saveBtn.getAttribute("data-inline-save") || "";
      saveInlineCustomer(id, saveBtn);
      return;
    }

    const plateBtn = event.target.closest("[data-plate-id], [data-vehicles-id]");
    if (plateBtn) {
      event.stopPropagation();
      const key = plateBtn.getAttribute("data-plate-key") || "";
      const id = plateBtn.getAttribute("data-plate-id") || plateBtn.getAttribute("data-vehicles-id") || "";
      const found =
        (key && customerRows.find((r) => r.key === key)) ||
        customerRows.find((r) => r.customerId === id);
      if (!found) return;
      editingListKey = "";
      showCustomerForm(found);
    }
  });
}

async function saveInlineCustomer(customerId, btn) {
  const id = String(customerId || "").trim();
  const row = customerRows.find((r) => r.customerId === id);
  const rowEl =
    btn?.closest?.("tr[data-customer-id]") ||
    [...(customersList?.querySelectorAll("tr.customer-row") || [])].find(
      (tr) => tr.getAttribute("data-customer-id") === id
    );
  if (!id || !row || !rowEl) {
    alert("Could not find this customer row. Press Ctrl+F5 and try again.");
    return;
  }
  const read = (field) => String(rowEl.querySelector(`[data-inline="${field}"]`)?.value || "").trim();
  const firstName = capitalizePersonName(read("firstName"));
  const lastName = capitalizePersonName(read("lastName"));
  const customerPhone = read("customerPhone");
  const customerEmail = read("customerEmail");
  const customerAddress = read("customerAddress");
  if (!firstName) {
    alert("Enter the first name.");
    rowEl.querySelector('[data-inline="firstName"]')?.focus();
    return;
  }
  if (!lastName) {
    alert("Enter the last name.");
    rowEl.querySelector('[data-inline="lastName"]')?.focus();
    return;
  }
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving…";
    }
    // Contact-only: omit vehicles so the server keeps the stored plate list.
    await Admin.api(`/api/customers/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({
        firstName,
        lastName,
        customerPhone,
        customerEmail,
        customerAddress,
      }),
    });
    editingListKey = "";
    await loadCustomers();
    if (typeof Admin.showStatus === "function") Admin.showStatus("Customer saved");
    else alert("Customer saved.");
  } catch (err) {
    console.error("Inline customer save failed:", err);
    alert(err.message || "Could not save.");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Save";
    }
  }
}

function openCustomerInvoices(row) {
  if (!row) return;
  window.DeaneBilling?.showList({
    kind: "invoice",
    filter: "all",
    customerId: row.customerId || "",
    customerName: displayName(row),
    customerEmail: row.customerEmail || "",
  });
}

async function deleteCustomerById(id, btn) {
  if (!id || !confirm("Delete this customer? Only customers with no invoice can be deleted.")) {
    return;
  }
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Deleting…";
    }
    await Admin.api(`/api/customers/${id}`, { method: "DELETE" });
    if (editingCustomerId === id) hideCustomerForm();
    await loadCustomers();
  } catch (err) {
    alert(err.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Delete";
    }
  }
}

async function openCustomer(rowEl) {
  const found = customerRows.find((r) => r.key === rowEl.dataset.key);
  if (found) showCustomerForm(found);
}

function clearCustomerSaveStatus() {
  const status = document.getElementById("customer-save-status");
  if (!status) return;
  status.textContent = "";
  status.hidden = true;
}

function showCustomerForm(row = null) {
  const form = document.getElementById("customer-form");
  if (!form) {
    alert("Customer form did not load. Press Ctrl+F5 to refresh.");
    return;
  }
  editingCustomerId = row?.customerId || "";
  editingVehicleId = row?.vehicleId || row?.vehicles?.[0]?.id || "";
  form.removeAttribute("hidden");
  form.hidden = false;
  clearCustomerSaveStatus();
  const legend = document.getElementById("customer-form-legend");
  if (legend) legend.textContent = editingCustomerId ? "Edit customer" : "New customer";
  const names = namesFromRow(row);
  const first = document.getElementById("customer-first-name");
  const last = document.getElementById("customer-last-name");
  const address = document.getElementById("customer-address");
  const phone = document.getElementById("customer-phone");
  const email = document.getElementById("customer-email");
  if (first) first.value = capitalizePersonName(names.firstName);
  if (last) last.value = capitalizePersonName(names.lastName);
  if (address) address.value = row?.customerAddress || "";
  if (phone) phone.value = row?.customerPhone || "";
  if (email) email.value = row?.customerEmail || "";
  const focusId = editingVehicleId;
  let vehicles =
    Array.isArray(row?.vehicles) && row.vehicles.length
      ? row.vehicles
      : row?.registration
        ? [{ registration: row.registration, vehicle: row.vehicle || "", id: focusId }]
        : [{ registration: "", vehicle: "" }];
  if (focusId && vehicles.length > 1) {
    vehicles = vehicles.filter((v) => v.id === focusId);
  }
  if (vehicles.length > 1) vehicles = [vehicles[0]];
  renderVehicleRows(vehicles);
  if (customerDeleteBtn) {
    customerDeleteBtn.hidden = !(editingCustomerId && row?.canDelete);
  }
  const invoicesBtn = document.getElementById("btn-customer-invoices");
  if (invoicesBtn) {
    invoicesBtn.hidden = !row;
    invoicesBtn.onclick = () => openCustomerInvoices(row);
  }
  const balanceEl = document.getElementById("customer-referral-balance");
  if (balanceEl) {
    balanceEl.hidden = true;
    balanceEl.textContent = "";
    if (editingCustomerId) {
      Admin.api(`/api/referral-credits?customerId=${encodeURIComponent(editingCustomerId)}`)
        .then((summary) => {
          const bal = Number(summary?.balance) || 0;
          const count = Number(summary?.creditCount) || 0;
          if (bal > 0) {
            balanceEl.hidden = false;
            balanceEl.textContent = `Referral balance: $${bal.toFixed(2)} (${count} credit${
              count === 1 ? "" : "s"
            }). Apply on the customer’s next invoice (min $50, whole $20).`;
          } else {
            balanceEl.hidden = false;
            balanceEl.textContent = "Referral balance: $0.00";
          }
        })
        .catch(() => {
          balanceEl.hidden = true;
        });
    }
  }
  form.scrollIntoView({ block: "start", behavior: "smooth" });
  if (first) first.focus();
}

function renderVehicleRows(vehicles) {
  const wrap = document.getElementById("customer-vehicles");
  if (!wrap) return;
  const row = vehicles?.[0] || { registration: "", vehicle: "" };
  wrap.innerHTML = `
      <div class="vehicle-row" data-index="0" data-id="${Admin.escapeAttr(row.id || "")}">
        <label>
          Registration
          <input class="vehicle-rego" value="${Admin.escapeAttr(String(row.registration || "").toUpperCase())}" required autocapitalize="characters" spellcheck="false" />
        </label>
        <label>
          Vehicle
          <input class="vehicle-desc" value="${Admin.escapeAttr(capitalizePersonName(row.vehicle || ""))}" placeholder="e.g. Toyota Camry" autocapitalize="words" />
        </label>
      </div>`;
}

function collectVehiclesFromForm() {
  const wrap = document.getElementById("customer-vehicles");
  if (!wrap) return [];
  return [...wrap.querySelectorAll(".vehicle-row")].map((row) => ({
    id: String(row.dataset.id || "").trim(),
    registration: String(row.querySelector(".vehicle-rego")?.value || "")
      .trim()
      .toUpperCase(),
    vehicle: capitalizePersonName(String(row.querySelector(".vehicle-desc")?.value || "").trim()),
  }));
}

function hideCustomerForm() {
  const form = document.getElementById("customer-form");
  if (!form) return;
  form.reset();
  editingCustomerId = "";
  editingVehicleId = "";
  clearCustomerSaveStatus();
  renderVehicleRows([{ registration: "", vehicle: "" }]);
  if (customerDeleteBtn) customerDeleteBtn.hidden = true;
  const invoicesBtn = document.getElementById("btn-customer-invoices");
  if (invoicesBtn) invoicesBtn.hidden = true;
  const balanceEl = document.getElementById("customer-referral-balance");
  if (balanceEl) {
    balanceEl.hidden = true;
    balanceEl.textContent = "";
  }
  const legend = document.getElementById("customer-form-legend");
  if (legend) legend.textContent = "New customer";
  form.hidden = true;
}

async function saveCustomer(event) {
  event?.preventDefault?.();
  const btn = document.getElementById("btn-customer-save");
  const status = document.getElementById("customer-save-status");
  const vehicles = collectVehiclesFromForm().filter((v) => v.registration).slice(0, 1);
  const body = {
    firstName: capitalizePersonName(
      (document.getElementById("customer-first-name")?.value || "").trim()
    ),
    lastName: capitalizePersonName(
      (document.getElementById("customer-last-name")?.value || "").trim()
    ),
    customerAddress: (document.getElementById("customer-address")?.value || "").trim(),
    customerPhone: (document.getElementById("customer-phone")?.value || "").trim(),
    customerEmail: (document.getElementById("customer-email")?.value || "").trim(),
    vehicleId: editingVehicleId || vehicles[0]?.id || "",
    vehicles,
  };
  if (!body.firstName) {
    alert("Enter the first name.");
    document.getElementById("customer-first-name")?.focus();
    return;
  }
  if (!body.lastName) {
    alert("Enter the last name.");
    document.getElementById("customer-last-name")?.focus();
    return;
  }
  const fullName = `${body.firstName} ${body.lastName}`.replace(/\s+/g, " ").trim();
  if (!vehicles.length) {
    alert("Enter a registration / plate.");
    document.querySelector(".vehicle-rego")?.focus();
    return;
  }
  const matches = findContactMatches(body, vehicles);
  const plateHits = matches.filter((hit) =>
    hit.reasons.some((reason) => String(reason).startsWith("plate"))
  );
  if (plateHits.length) {
    alert(
      `This plate is already on ${plateHits[0].name}. Open that record instead.`
    );
    return;
  }
  if (status) {
    status.hidden = false;
    status.textContent = "Saving…";
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving…";
  }
  try {
    const saved = editingCustomerId
      ? await Admin.api(`/api/customers/${editingCustomerId}`, {
          method: "PUT",
          body: JSON.stringify(body),
        })
      : await Admin.api("/api/customers", {
          method: "POST",
          body: JSON.stringify(body),
        });
    await loadCustomers();
    const plates = (saved.vehicles || vehicles).map((v) => v.registration).join(", ");
    const msg = `Saved ${saved.customerName || fullName} · ${plates}`;
    alert(msg);
    hideCustomerForm();
    customerLetter = "";
    customerShowAll = false;
    if (customersSearch) {
      customersSearch.value = [body.lastName, vehicles[0]?.registration].filter(Boolean).join(" ");
    }
    renderLetterBar();
    renderCustomers();
    customersSearch?.focus();
  } catch (err) {
    const msg = err?.name === "AbortError" ? "Save timed out. Check the Render disk at /data." : err.message;
    if (status) {
      status.hidden = false;
      status.textContent = msg;
    }
    alert(msg);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Save customer";
    }
  }
}

async function sendReminder(key, btn) {
  const row = customerRows.find((r) => r.key === key);
  if (!row) return;
  if (!canSendWofReminder(row)) {
    if (row.wofReminderSentAt) {
      alert(`Reminder already sent on ${formatReminderSent(row.wofReminderSentAt)}.`);
      return;
    }
    alert("Email reminder is only for customers whose WOF expires in the next 30 days, with an email on file.");
    return;
  }
  if (!confirm(`Send a WOF reminder to ${row.customerEmail}?`)) return;
  try {
    btn.disabled = true;
    btn.textContent = "Sending…";
    const result = await Admin.api("/api/customers/wof-reminder", {
      method: "POST",
      body: JSON.stringify({
        customerId: row.customerId,
        vehicleId: row.wofReminderVehicleId || "",
      }),
    });
    if (result.alreadySent) {
      alert(`Reminder already sent on ${formatReminderSent(result.sentAt)}.`);
    } else {
      alert(`Reminder sent to ${result.to}`);
    }
    await loadCustomers();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Email";
  }
}

async function sendSmsReminder(key, btn) {
  const row = customerRows.find((r) => r.key === key);
  if (!row) return;
  if (!canSendWofSmsReminder(row)) {
    if (row.wofSmsReminderSentAt) {
      alert(`SMS reminder already sent on ${formatReminderSent(row.wofSmsReminderSentAt)}.`);
      return;
    }
    alert(
      "SMS reminder is only for customers whose WOF expires in the next 30 days, with a NZ mobile on file. Check WebSMS keys if the button never appears."
    );
    return;
  }
  if (!confirm(`Send a WOF SMS reminder to ${row.customerPhone}?`)) return;
  try {
    btn.disabled = true;
    btn.textContent = "Sending…";
    const result = await Admin.api("/api/customers/wof-sms-reminder", {
      method: "POST",
      body: JSON.stringify({
        customerId: row.customerId,
        vehicleId: row.wofSmsReminderVehicleId || "",
      }),
    });
    if (result.alreadySent) {
      alert(`SMS reminder already sent on ${formatReminderSent(result.sentAt)}.`);
    } else {
      alert(
        `SMS sent to ${result.to}${result.sandbox ? " (sandbox — not billed)" : ""}`
      );
    }
    await loadCustomers();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "SMS";
  }
}

async function sendBulkReminders() {
  const eligible = eligibleWofReminderRows();
  const btn = document.getElementById("btn-wof-remind-all");
  if (!eligible.length) {
    alert("No due-soon customers with an email are waiting for a reminder.");
    updateBulkRemindButton();
    return;
  }
  if (
    !confirm(
      `Send WOF reminder emails to ${eligible.length} customer${eligible.length === 1 ? "" : "s"}?\n\nOnly Due in 30 days, with email, not already reminded.`
    )
  ) {
    return;
  }
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = `Sending ${eligible.length}…`;
    }
    const result = await Admin.api("/api/customers/wof-reminder-bulk", {
      method: "POST",
      body: "{}",
    });
    await loadCustomers();
    const failed = Array.isArray(result.failed) ? result.failed : [];
    let msg = `Bulk reminder done.\nSent: ${result.sent || 0}\nAlready sent: ${result.alreadySent || 0}\nFailed: ${failed.length}`;
    if (failed.length) {
      const sample = failed
        .slice(0, 3)
        .map((f) => `${f.customerName || f.to || "Customer"}: ${f.error}`)
        .join("\n");
      msg += `\n\n${sample}`;
    }
    alert(msg);
  } catch (err) {
    alert(err.message);
  } finally {
    updateBulkRemindButton();
  }
}

async function sendBulkSmsReminders() {
  const eligible = eligibleWofSmsReminderRows();
  const btn = document.getElementById("btn-wof-sms-remind-all");
  if (!eligible.length) {
    alert("No due-soon customers with a NZ mobile are waiting for an SMS reminder.");
    updateBulkRemindButton();
    return;
  }
  if (
    !confirm(
      `Send WOF SMS reminders to ${eligible.length} customer${eligible.length === 1 ? "" : "s"}?\n\nOnly Due in 30 days, with mobile, not already SMS-reminded.`
    )
  ) {
    return;
  }
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = `Sending SMS ${eligible.length}…`;
    }
    const result = await Admin.api("/api/customers/wof-sms-reminder-bulk", {
      method: "POST",
      body: "{}",
    });
    await loadCustomers();
    const failed = Array.isArray(result.failed) ? result.failed : [];
    let msg = `Bulk SMS done.\nSent: ${result.sent || 0}\nAlready sent: ${result.alreadySent || 0}\nFailed: ${failed.length}`;
    if (failed.length) {
      const sample = failed
        .slice(0, 3)
        .map((f) => `${f.customerName || f.to || "Customer"}: ${f.error}`)
        .join("\n");
      msg += `\n\n${sample}`;
    }
    alert(msg);
  } catch (err) {
    alert(err.message);
  } finally {
    updateBulkRemindButton();
  }
}

async function loadCustomers() {
  customerRows = await Admin.api("/api/customers");
  renderCustomers();
}

async function showCustomers() {
  Admin.setSection("customers");
  Admin.setViewTitle("Customers");
  try {
    await loadCustomers();
    renderLetterBar();
    if (!customerForm || customerForm.hidden) customersSearch?.focus();
    const info = await Admin.api("/api/admin/email-status");
    const hint = document.getElementById("customer-storage-hint");
    if (hint && info?.dataDir) {
      hint.textContent = `Saving to ${info.dataDir} (${info.customersSaved || 0} saved).`;
    }
  } catch (err) {
    alert(err.message);
  }
}

function onCustomerSearchInput() {
  customerShowAll = false;
  if (String(customersSearch?.value || "").trim() && customerLetter) {
    customerLetter = "";
    renderLetterBar();
  }
  renderCustomers();
}

customersSearch?.addEventListener("input", onCustomerSearchInput);
customersSearch?.addEventListener("search", onCustomerSearchInput);

customersFilter?.querySelectorAll("[data-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    customerFilter = btn.dataset.filter;
    customersFilter.querySelectorAll("[data-filter]").forEach((el) => {
      el.classList.toggle("is-active", el === btn);
    });
    renderCustomers();
  });
});

document.getElementById("btn-wof-remind-all")?.addEventListener("click", () => {
  sendBulkReminders();
});
document.getElementById("btn-wof-sms-remind-all")?.addEventListener("click", () => {
  sendBulkSmsReminders();
});

document.getElementById("customer-first-name")?.addEventListener("input", (e) => {
  applyLiveTransform(e.target, capitalizePersonName);
});
document.getElementById("customer-last-name")?.addEventListener("input", (e) => {
  applyLiveTransform(e.target, capitalizePersonName);
});
document.getElementById("customer-vehicles")?.addEventListener("input", (e) => {
  if (e.target.classList.contains("vehicle-rego")) {
    applyLiveTransform(e.target, (value) => String(value || "").toUpperCase());
    return;
  }
  if (e.target.classList.contains("vehicle-desc")) {
    applyLiveTransform(e.target, capitalizePersonName);
  }
});

document.getElementById("btn-customer-cancel")?.addEventListener("click", hideCustomerForm);

renderLetterBar();
renderVehicleRows([{ registration: "", vehicle: "" }]);

customerForm?.addEventListener("submit", saveCustomer);
document.getElementById("btn-customer-save")?.addEventListener("click", saveCustomer);

customerDeleteBtn?.addEventListener("click", async () => {
  if (!editingCustomerId) return;
  await deleteCustomerById(editingCustomerId, customerDeleteBtn);
});

window.DeaneCustomers = {
  showList: showCustomers,
  save: saveCustomer,
  newCustomer() {
    showCustomerForm(null);
  },
};
})();
