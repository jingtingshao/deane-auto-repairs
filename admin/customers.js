const Admin = window.DeaneAdmin;

const customersSection = document.getElementById("customers-section");
const customersList = document.getElementById("customers-list");
const customersSearch = document.getElementById("customers-search");
const customersFilter = document.getElementById("customers-filter");

let customerRows = [];
let customerFilter = "all";

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
  const plate = String(row.registration || "")
    .toLowerCase()
    .replace(/[\s-]/g, "");
  const plateQuery = q.replace(/[\s-]/g, "");
  return name.includes(q) || plate.includes(plateQuery);
}

function renderCustomers() {
  if (!customersList) return;
  if (!customerRows.length) {
    customersList.innerHTML =
      '<div class="empty">No customers yet. They appear here after you save a report or invoice with a name or plate.</div>';
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
            <th>Customer</th>
            <th>WOF expiry</th>
            <th>Last visit</th>
            <th>Contact</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
            <tr class="customer-row" data-report-id="${Admin.escapeAttr(row.lastReportId || "")}" data-billing-id="${Admin.escapeAttr(row.lastBillingId || "")}">
              <td class="billing-number">${Admin.escapeHtml(row.registration || "—")}</td>
              <td>
                ${Admin.escapeHtml(row.customerName || "—")}
                ${row.vehicle ? `<div class="muted small">${Admin.escapeHtml(row.vehicle)}</div>` : ""}
              </td>
              <td>
                <span class="badge ${Admin.escapeAttr(row.wofStatus)}">${Admin.escapeHtml(wofLabel(row))}</span>
                <div class="muted small">${Admin.escapeHtml(row.wofExpiry || "Add on the report")}</div>
              </td>
              <td>${Admin.escapeHtml(row.lastVisit || "—")}</td>
              <td>
                ${
                  row.customerPhone
                    ? `<a href="tel:${Admin.escapeAttr(row.customerPhone)}">${Admin.escapeHtml(row.customerPhone)}</a><br/>`
                    : ""
                }
                ${
                  row.customerEmail
                    ? `<a href="mailto:${Admin.escapeAttr(row.customerEmail)}">${Admin.escapeHtml(row.customerEmail)}</a>`
                    : '<span class="muted">No email</span>'
                }
              </td>
              <td class="customer-actions">
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
    row.addEventListener("click", () => openCustomer(row));
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
  const reportId = rowEl.dataset.reportId;
  const billingId = rowEl.dataset.billingId;
  try {
    if (reportId) {
      Admin.setSection("reports");
      await Admin.openReport(reportId);
      return;
    }
    if (billingId && window.DeaneBilling?.openDoc) {
      Admin.setSection("billing");
      await window.DeaneBilling.openDoc(billingId);
    }
  } catch (err) {
    alert(err.message);
  }
}

async function sendReminder(key, btn) {
  const row = customerRows.find((r) => r.key === key);
  if (!row) return;
  if (!row.customerEmail) {
    alert("Add the customer email on the service report first.");
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

window.DeaneCustomers = { showList: showCustomers };
