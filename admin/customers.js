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
let editingCustomerId = "";
let customerSortKey = "daily";
let customerSortDir = "asc";

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
  const joined = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
  return joined || String(row.customerName || "").trim();
}

function namesFromRow(row) {
  const first = String(row?.firstName || "").trim();
  const last = String(row?.lastName || "").trim();
  if (first || last) return { firstName: first, lastName: last };
  const parts = String(row?.customerName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
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
    const dateCmp = String(b.dailySeqDate || "").localeCompare(String(a.dailySeqDate || ""));
    if (dateCmp) return dateCmp;
    return dir * ((Number(a.dailySeq) || 0) - (Number(b.dailySeq) || 0));
  });
}

function sortHeader(key, label) {
  const active = customerSortKey === key;
  const arrow = active ? (customerSortDir === "desc" ? " ↓" : " ↑") : "";
  return `<th class="sortable${active ? " is-sorted" : ""}" data-sort="${Admin.escapeAttr(key)}">${Admin.escapeHtml(label)}${arrow}</th>`;
}

function matchesCustomerSearch(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const name = displayName(row).toLowerCase();
  const first = String(row.firstName || "").toLowerCase();
  const last = String(row.lastName || "").toLowerCase();
  const address = String(row.customerAddress || "").toLowerCase();
  const email = String(row.customerEmail || "").toLowerCase();
  const phone = String(row.customerPhone || "").toLowerCase().replace(/\s+/g, "");
  const plates = (
    Array.isArray(row.registrations) && row.registrations.length
      ? row.registrations
      : String(row.registration || "").split(",")
  )
    .map((p) =>
      String(p || "")
        .toLowerCase()
        .replace(/[\s-]/g, "")
    )
    .filter(Boolean);
  const plateQuery = q.replace(/[\s-]/g, "");
  const phoneQuery = q.replace(/\s+/g, "");
  return (
    name.includes(q) ||
    first.includes(q) ||
    last.includes(q) ||
    address.includes(q) ||
    email.includes(q) ||
    phone.includes(phoneQuery) ||
    plates.some((p) => p.includes(plateQuery))
  );
}

function renderCustomers() {
  if (!customersList) return;
  if (!customerRows.length) {
    customersList.innerHTML =
      '<div class="empty">No customers yet. Fill in the form above and click Save customer.</div>';
    return;
  }

  const query = customersSearch?.value || "";
  const rows = sortCustomerRows(
    customerRows.filter((row) => {
      if (customerFilter !== "all" && row.wofStatus !== customerFilter) return false;
      return matchesCustomerSearch(row, query);
    })
  );

  if (!rows.length) {
    customersList.innerHTML = '<div class="empty">No matching customers.</div>';
    return;
  }

  customersList.innerHTML = `
    <p class="muted small">${rows.length} customer${rows.length === 1 ? "" : "s"} · new customers number 1, 2, 3 each day (tomorrow starts at 1). Click Plate, First name or Last name to sort.</p>
    <div class="billing-table-wrap">
      <table class="billing-table">
        <thead>
          <tr>
            ${sortHeader("daily", "#")}
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
            .map(
              (row) => `
            <tr class="customer-row" data-key="${Admin.escapeAttr(row.key)}">
              <td class="billing-number customer-index">${Number(row.dailySeq) || "—"}</td>
              <td>${Admin.escapeHtml(
                (Array.isArray(row.registrations) && row.registrations.length
                  ? row.registrations.join(", ")
                  : row.registration) || "—"
              )}</td>
              <td><button type="button" class="customer-name-link" data-invoices="1">${Admin.escapeHtml(namesFromRow(row).firstName || "—")}</button></td>
              <td><button type="button" class="customer-name-link" data-invoices="1">${Admin.escapeHtml(namesFromRow(row).lastName || "—")}</button></td>
              <td>${Admin.escapeHtml(row.customerAddress || "—")}</td>
              <td>
                ${
                  row.customerPhone
                    ? `<a href="tel:${Admin.escapeAttr(row.customerPhone)}">${Admin.escapeHtml(row.customerPhone)}</a>`
                    : "—"
                }
              </td>
              <td>
                ${
                  row.customerEmail
                    ? `<a href="mailto:${Admin.escapeAttr(row.customerEmail)}">${Admin.escapeHtml(row.customerEmail)}</a>`
                    : "—"
                }
              </td>
              <td>
                <span class="badge ${Admin.escapeAttr(row.wofStatus)}">${Admin.escapeHtml(wofLabel(row))}</span>
                <div class="muted small">${Admin.escapeHtml(row.wofExpiry || "—")}</div>
              </td>
              <td class="customer-actions">
                <button type="button" class="ghost" data-edit-key="${Admin.escapeAttr(row.key)}">Edit</button>
                ${
                  row.lastReportId
                    ? `<button type="button" class="ghost" data-open-report="${Admin.escapeAttr(row.lastReportId)}">Report</button>`
                    : ""
                }
                ${
                  row.canDelete
                    ? `<button type="button" class="danger" data-delete-id="${Admin.escapeAttr(row.customerId)}">Delete</button>`
                    : ""
                }
                <button type="button" class="primary" data-remind-key="${Admin.escapeAttr(row.key)}" ${
                  row.customerEmail && row.wofExpiry ? "" : "disabled"
                }>Email reminder</button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  customersList.querySelectorAll("[data-sort]").forEach((th) => {
    th.addEventListener("click", (event) => {
      event.stopPropagation();
      const key = th.dataset.sort;
      if (customerSortKey === key) {
        customerSortDir = customerSortDir === "asc" ? "desc" : "asc";
      } else {
        customerSortKey = key;
        customerSortDir = "asc";
      }
      renderCustomers();
    });
  });

  customersList.querySelectorAll("[data-invoices]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const found = customerRows.find((r) => r.key === btn.closest("tr")?.dataset.key);
      if (found) openCustomerInvoices(found);
    });
  });

  customersList.querySelectorAll("tr.customer-row").forEach((row) => {
    row.addEventListener("click", () => {
      const found = customerRows.find((r) => r.key === row.dataset.key);
      if (found) showCustomerForm(found);
    });
  });

  customersList.querySelectorAll("[data-edit-key]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const found = customerRows.find((r) => r.key === btn.dataset.editKey);
      if (found) showCustomerForm(found);
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
  customersList.querySelectorAll("[data-delete-id]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteCustomerById(btn.dataset.deleteId, btn);
    });
  });
  customersList.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", (event) => event.stopPropagation());
  });
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
  if (!id || !confirm("Delete this customer? Only customers with no reports or invoices can be deleted.")) {
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

function showCustomerForm(row = null) {
  const form = document.getElementById("customer-form");
  if (!form) {
    alert("Customer form did not load. Press Ctrl+F5 to refresh.");
    return;
  }
  editingCustomerId = row?.customerId || "";
  form.removeAttribute("hidden");
  form.hidden = false;
  const legend = document.getElementById("customer-form-legend");
  if (legend) legend.textContent = editingCustomerId ? "Edit customer" : "New customer";
  const names = namesFromRow(row);
  const first = document.getElementById("customer-first-name");
  const last = document.getElementById("customer-last-name");
  const address = document.getElementById("customer-address");
  const phone = document.getElementById("customer-phone");
  const email = document.getElementById("customer-email");
  if (first) first.value = names.firstName;
  if (last) last.value = names.lastName;
  if (address) address.value = row?.customerAddress || "";
  if (phone) phone.value = row?.customerPhone || "";
  if (email) email.value = row?.customerEmail || "";
  const vehicles =
    Array.isArray(row?.vehicles) && row.vehicles.length
      ? row.vehicles
      : row?.registration
        ? [{ registration: row.registration, vehicle: row.vehicle || "" }]
        : [{ registration: "", vehicle: "" }];
  renderVehicleRows(vehicles);
  if (customerDeleteBtn) {
    customerDeleteBtn.hidden = !(editingCustomerId && row?.canDelete);
  }
  const invoicesBtn = document.getElementById("btn-customer-invoices");
  if (invoicesBtn) {
    invoicesBtn.hidden = !row;
    invoicesBtn.onclick = () => openCustomerInvoices(row);
  }
  form.scrollIntoView({ block: "start", behavior: "smooth" });
  if (first) first.focus();
}

function renderVehicleRows(vehicles) {
  const wrap = document.getElementById("customer-vehicles");
  if (!wrap) return;
  const rows = vehicles?.length ? vehicles : [{ registration: "", vehicle: "" }];
  wrap.innerHTML = rows
    .map(
      (v, index) => `
      <div class="vehicle-row" data-index="${index}">
        <label>
          Registration
          <input class="vehicle-rego" value="${Admin.escapeAttr(v.registration || "")}" required />
        </label>
        <label>
          Vehicle
          <input class="vehicle-desc" value="${Admin.escapeAttr(v.vehicle || "")}" placeholder="e.g. Toyota Camry" />
        </label>
        <button type="button" class="ghost vehicle-remove" data-remove="${index}" ${rows.length <= 1 ? "hidden" : ""}>×</button>
      </div>`
    )
    .join("");
  wrap.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = collectVehiclesFromForm();
      next.splice(Number(btn.dataset.remove), 1);
      renderVehicleRows(next.length ? next : [{ registration: "", vehicle: "" }]);
    });
  });
}

function collectVehiclesFromForm() {
  const wrap = document.getElementById("customer-vehicles");
  if (!wrap) return [];
  return [...wrap.querySelectorAll(".vehicle-row")].map((row) => ({
    registration: String(row.querySelector(".vehicle-rego")?.value || "").trim(),
    vehicle: String(row.querySelector(".vehicle-desc")?.value || "").trim(),
  }));
}

function hideCustomerForm() {
  const form = document.getElementById("customer-form");
  if (!form) return;
  form.reset();
  editingCustomerId = "";
  renderVehicleRows([{ registration: "", vehicle: "" }]);
  if (customerDeleteBtn) customerDeleteBtn.hidden = true;
  const legend = document.getElementById("customer-form-legend");
  if (legend) legend.textContent = "New customer";
}

async function saveCustomer(event) {
  event?.preventDefault?.();
  const btn = document.getElementById("btn-customer-save");
  const status = document.getElementById("customer-save-status");
  const vehicles = collectVehiclesFromForm().filter((v) => v.registration);
  const body = {
    firstName: (document.getElementById("customer-first-name")?.value || "").trim(),
    lastName: (document.getElementById("customer-last-name")?.value || "").trim(),
    customerAddress: (document.getElementById("customer-address")?.value || "").trim(),
    customerPhone: (document.getElementById("customer-phone")?.value || "").trim(),
    customerEmail: (document.getElementById("customer-email")?.value || "").trim(),
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
  const nameKey = fullName.toLowerCase();
  const duplicate = customerRows.find((row) => {
    if (editingCustomerId && row.customerId === editingCustomerId) return false;
    return displayName(row).toLowerCase().replace(/\s+/g, " ") === nameKey;
  });
  if (duplicate) {
    alert(`A customer named ${fullName} already exists. Open that record instead.`);
    return;
  }
  if (!vehicles.length) {
    alert("Enter at least one registration / plate.");
    document.querySelector(".vehicle-rego")?.focus();
    return;
  }
  const matches = findContactMatches(body, vehicles);
  if (matches.length) {
    const detail = matches
      .map((hit) => `${hit.name} (${hit.reasons.join(", ")})`)
      .join("\n");
    const ok = confirm(
      `This customer may already exist:\n\n${detail}\n\nSave anyway?`
    );
    if (!ok) return;
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
    editingCustomerId = saved.id || editingCustomerId;
    if (customerDeleteBtn) customerDeleteBtn.hidden = !editingCustomerId;
    const legend = document.getElementById("customer-form-legend");
    if (legend && editingCustomerId) legend.textContent = "Edit customer";
    await loadCustomers();
    const info = await Admin.api("/api/admin/email-status").catch(() => null);
    const hint = document.getElementById("customer-storage-hint");
    if (hint && info?.dataDir) {
      hint.textContent = `Saving to ${info.dataDir} (${info.customersSaved || 0} saved).`;
    }
    const plates = (saved.vehicles || vehicles).map((v) => v.registration).join(", ");
    const msg = `Saved ${saved.customerName || fullName} · ${plates}`;
    if (status) status.textContent = msg;
    alert(msg);
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
  if (!row.customerEmail) {
    alert("Add the customer email first.");
    return;
  }
  if (!row.wofExpiry) {
    alert("Add the WOF expiry date on the service report first.");
    return;
  }
  if (!confirm(`Send a WOF reminder to ${row.customerEmail}?`)) return;
  try {
    btn.disabled = true;
    btn.textContent = "Sending…";
    const result = await Admin.api("/api/customers/wof-reminder", {
      method: "POST",
      body: JSON.stringify({
        to: row.customerEmail,
        customerName: row.customerName,
        registration: row.registration,
        vehicle: row.vehicle,
        wofExpiry: row.wofExpiry,
      }),
    });
    alert(`Reminder sent to ${result.to}`);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Email reminder";
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
    const info = await Admin.api("/api/admin/email-status");
    const hint = document.getElementById("customer-storage-hint");
    if (hint && info?.dataDir) {
      hint.textContent = `Saving to ${info.dataDir} (${info.customersSaved || 0} saved).`;
    }
  } catch (err) {
    alert(err.message);
  }
}

customersSearch?.addEventListener("input", renderCustomers);
customersSearch?.addEventListener("search", renderCustomers);

customersFilter?.querySelectorAll("[data-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    customerFilter = btn.dataset.filter;
    customersFilter.querySelectorAll("[data-filter]").forEach((el) => {
      el.classList.toggle("is-active", el === btn);
    });
    renderCustomers();
  });
});

document.getElementById("btn-customer-cancel")?.addEventListener("click", hideCustomerForm);

document.getElementById("btn-add-vehicle")?.addEventListener("click", () => {
  const next = collectVehiclesFromForm();
  next.push({ registration: "", vehicle: "" });
  renderVehicleRows(next);
  const inputs = document.querySelectorAll(".vehicle-rego");
  inputs[inputs.length - 1]?.focus();
});

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
