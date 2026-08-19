const Admin = window.DeaneAdmin;

const customersSection = document.getElementById("customers-section");
const customersList = document.getElementById("customers-list");
const customersSearch = document.getElementById("customers-search");
const customersFilter = document.getElementById("customers-filter");
const customerForm = document.getElementById("customer-form");
const customerDeleteBtn = document.getElementById("btn-customer-delete");

let customerRows = [];
let customerFilter = "all";
let editingCustomerId = "";

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

function matchesCustomerSearch(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const name = String(row.customerName || "").toLowerCase();
  const address = String(row.customerAddress || "").toLowerCase();
  const email = String(row.customerEmail || "").toLowerCase();
  const phone = String(row.customerPhone || "").toLowerCase().replace(/\s+/g, "");
  const plate = String(row.registration || "")
    .toLowerCase()
    .replace(/[\s-]/g, "");
  const plateQuery = q.replace(/[\s-]/g, "");
  const phoneQuery = q.replace(/\s+/g, "");
  return (
    name.includes(q) ||
    address.includes(q) ||
    email.includes(q) ||
    phone.includes(phoneQuery) ||
    plate.includes(plateQuery)
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
  const rows = customerRows.filter((row) => {
    if (customerFilter !== "all" && row.wofStatus !== customerFilter) return false;
    return matchesCustomerSearch(row, query);
  });

  if (!rows.length) {
    customersList.innerHTML = '<div class="empty">No matching customers.</div>';
    return;
  }

  customersList.innerHTML = `
    <div class="billing-table-wrap">
      <table class="billing-table">
        <thead>
          <tr>
            <th>Plate</th>
            <th>Name</th>
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
              <td class="billing-number">${Admin.escapeHtml(row.registration || "—")}</td>
              <td>${Admin.escapeHtml(row.customerName || "—")}</td>
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
  customersList.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", (event) => event.stopPropagation());
  });
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
  const name = document.getElementById("customer-name");
  const address = document.getElementById("customer-address");
  const phone = document.getElementById("customer-phone");
  const email = document.getElementById("customer-email");
  const rego = document.getElementById("customer-rego");
  if (name) name.value = row?.customerName || "";
  if (address) address.value = row?.customerAddress || "";
  if (phone) phone.value = row?.customerPhone || "";
  if (email) email.value = row?.customerEmail || "";
  if (rego) rego.value = row?.registration || "";
  if (customerDeleteBtn) customerDeleteBtn.hidden = !editingCustomerId;
  form.scrollIntoView({ block: "start", behavior: "smooth" });
  if (name) name.focus();
}

function hideCustomerForm() {
  const form = document.getElementById("customer-form");
  if (!form) return;
  form.reset();
  editingCustomerId = "";
  if (customerDeleteBtn) customerDeleteBtn.hidden = true;
  const legend = document.getElementById("customer-form-legend");
  if (legend) legend.textContent = "New customer";
}

async function saveCustomer(event) {
  event?.preventDefault?.();
  const body = {
    customerName: (document.getElementById("customer-name")?.value || "").trim(),
    customerAddress: (document.getElementById("customer-address")?.value || "").trim(),
    customerPhone: (document.getElementById("customer-phone")?.value || "").trim(),
    customerEmail: (document.getElementById("customer-email")?.value || "").trim(),
    registration: (document.getElementById("customer-rego")?.value || "").trim(),
  };
  const status = document.getElementById("customer-save-status");
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
    if (status) {
      status.hidden = false;
      status.textContent = "Saved";
      setTimeout(() => {
        status.hidden = true;
      }, 2500);
    }
  } catch (err) {
    alert(err.message);
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

customerForm?.addEventListener("submit", saveCustomer);
document.getElementById("btn-customer-save")?.addEventListener("click", saveCustomer);

customerDeleteBtn?.addEventListener("click", async () => {
  if (!editingCustomerId || !confirm("Delete this saved customer?")) return;
  try {
    await Admin.api(`/api/customers/${editingCustomerId}`, { method: "DELETE" });
    hideCustomerForm();
    await loadCustomers();
  } catch (err) {
    alert(err.message);
  }
});

window.DeaneCustomers = {
  showList: showCustomers,
  newCustomer() {
    showCustomerForm(null);
  },
};
