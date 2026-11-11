(function () {
  const Admin = window.DeaneAdmin;
  const form = document.getElementById("cash-expense-form");
  const dateInput = document.getElementById("cash-expense-date");
  const nameInput = document.getElementById("cash-expense-name");
  const amountInput = document.getElementById("cash-expense-amount");
  const errorEl = document.getElementById("cash-expense-error");
  const submitBtn = document.getElementById("cash-expense-submit");
  const searchEl = document.getElementById("cash-expense-search");
  const totalEl = document.getElementById("cash-expense-total");
  const listEl = document.getElementById("cash-expense-list");

  const moneyFormat = new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
  });

  let expenses = [];
  let loadToken = 0;

  function money(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "";
    return moneyFormat.format(amount);
  }

  function showError(message) {
    if (!errorEl) return;
    errorEl.hidden = !message;
    errorEl.textContent = message || "";
  }

  function matches(row, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    const hay = [row.name, row.date, Admin.formatDateShort(row.date), Number(row.amount).toFixed(2)]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }

  function visibleRows() {
    const query = searchEl?.value || "";
    return expenses.filter((row) => matches(row, query));
  }

  function render() {
    if (!listEl) return;
    const query = String(searchEl?.value || "").trim();
    const rows = visibleRows();
    const total = Math.round(rows.reduce((sum, row) => sum + Number(row.amount), 0) * 100) / 100;
    if (totalEl) {
      const countLabel = query
        ? `${rows.length} matching`
        : `${rows.length} expense${rows.length === 1 ? "" : "s"}`;
      totalEl.textContent = rows.length ? `${countLabel} · ${money(total)}` : query ? "No matching expenses." : "";
    }
    if (!expenses.length) {
      listEl.innerHTML = '<div class="empty">No cash expenses yet.</div>';
      return;
    }
    if (!rows.length) {
      listEl.innerHTML = '<div class="empty">No matching name, date, or amount.</div>';
      return;
    }
    const body = rows
      .map(
        (row) => `<tr>
          <td>${Admin.escapeHtml(Admin.formatDateShort(row.date))}</td>
          <td>${Admin.escapeHtml(row.name)}</td>
          <td class="invoice-money">${Admin.escapeHtml(money(row.amount))}</td>
          <td class="cash-expense-actions">
            <button type="button" class="danger" data-cash-delete="${Admin.escapeAttr(row.id)}">Delete</button>
          </td>
        </tr>`
      )
      .join("");
    listEl.innerHTML = `<div class="billing-table-wrap">
      <table class="billing-table cash-expense-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Paid to</th>
            <th class="invoice-money">Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
    listEl.querySelectorAll("[data-cash-delete]").forEach((button) => {
      button.addEventListener("click", () => removeExpense(button.getAttribute("data-cash-delete")));
    });
  }

  async function load() {
    const token = ++loadToken;
    try {
      const rows = await Admin.api("/api/cash-expenses");
      if (token !== loadToken) return;
      expenses = Array.isArray(rows) ? rows : [];
      render();
    } catch (err) {
      if (token !== loadToken) return;
      if (listEl) listEl.innerHTML = `<div class="empty">${Admin.escapeHtml(err.message || "Could not load cash expenses.")}</div>`;
    }
  }

  async function removeExpense(id) {
    const row = expenses.find((item) => item.id === id);
    if (!row) return;
    const label = `${money(row.amount)} paid to ${row.name} on ${Admin.formatDateShort(row.date)}`;
    if (!confirm(`Delete ${label}?`)) return;
    showError("");
    try {
      await Admin.api(`/api/cash-expenses/${encodeURIComponent(id)}`, { method: "DELETE" });
      expenses = expenses.filter((item) => item.id !== id);
      render();
    } catch (err) {
      showError(err.message || "Could not delete that expense.");
    }
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");
    const payload = {
      date: dateInput?.value || "",
      name: nameInput?.value || "",
      amount: amountInput?.value || "",
    };
    if (submitBtn) submitBtn.disabled = true;
    try {
      const saved = await Admin.api("/api/cash-expenses", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      loadToken += 1;
      expenses = [saved, ...expenses.filter((row) => row.id !== saved.id)];
      expenses.sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return String(a.createdAt) < String(b.createdAt) ? 1 : -1;
      });
      if (nameInput) nameInput.value = "";
      if (amountInput) amountInput.value = "";
      render();
      nameInput?.focus();
    } catch (err) {
      showError(err.message || "Could not save that expense.");
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  searchEl?.addEventListener("input", render);

  function show() {
    if (dateInput && !dateInput.value) dateInput.value = Admin.todayIso();
    load();
  }

  window.DeaneCashExpenses = { show };
})();
