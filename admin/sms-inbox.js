(function () {
  const Admin = window.DeaneAdmin;
  const listEl = document.getElementById("sms-inbox-list");
  const searchEl = document.getElementById("sms-inbox-search");
  const filterEl = document.getElementById("sms-inbox-filter");

  let rows = [];
  let filter = "all";

  function matchesSearch(row, query) {
    const raw = String(query || "").trim().toLowerCase();
    if (!raw) return true;
    const hay = [
      row.direction,
      row.kind,
      row.phoneDisplay,
      row.from,
      row.to,
      row.customerName,
      row.registration,
      row.body,
    ]
      .join(" ")
      .toLowerCase();
    return raw.split(/\s+/).filter(Boolean).every((token) => hay.includes(token));
  }

  function render() {
    if (!listEl) return;
    const filtered = rows.filter((row) => {
      if (filter === "out" && row.direction !== "out") return false;
      if (filter === "in" && row.direction !== "in") return false;
      return matchesSearch(row, searchEl?.value);
    });

    if (!filtered.length) {
      listEl.innerHTML = `<p class="muted">No SMS yet. Send a WOF SMS from Customers, or wait for a customer reply to the webhook.</p>`;
      return;
    }

    listEl.innerHTML = `
    <div class="billing-table-wrap">
      <table class="billing-table sms-inbox-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Dir</th>
            <th>Phone</th>
            <th>Customer</th>
            <th>Plate</th>
            <th>Message</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          ${filtered
            .map((row) => {
              const dir = row.direction === "in" ? "Reply" : "Sent";
              const dirClass = row.direction === "in" ? "in" : "out";
              const when = Admin.formatDateTimeShort?.(row.at) || Admin.formatDateShort?.(row.at) || row.at || "—";
              const sandbox = row.sandbox ? ` <span class="muted small">(sandbox)</span>` : "";
              const result = row.handleResult
                ? row.handleResult
                : row.handled
                  ? "Handled"
                  : row.direction === "in"
                    ? "—"
                    : "";
              return `
            <tr class="sms-row sms-${dirClass}">
              <td class="sms-when">${Admin.escapeHtml(when)}</td>
              <td><span class="sms-dir ${dirClass}">${dir}</span>${sandbox}</td>
              <td class="sms-phone">${Admin.escapeHtml(row.phoneDisplay || row.from || row.to || "—")}</td>
              <td>${Admin.escapeHtml(row.customerName || "—")}</td>
              <td>${Admin.escapeHtml(row.registration || "—")}</td>
              <td class="sms-body">${Admin.escapeHtml(row.body || "")}</td>
              <td class="muted small">${Admin.escapeHtml(result || "—")}</td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;
  }

  async function load() {
    rows = await Admin.api("/api/sms-inbox");
    render();
  }

  async function showList() {
    Admin.setSection("sms_inbox");
    try {
      await load();
      searchEl?.focus();
    } catch (err) {
      alert(err.message || "Could not load SMS inbox.");
    }
  }

  searchEl?.addEventListener("input", () => render());
  searchEl?.addEventListener("search", () => render());

  filterEl?.querySelectorAll("[data-sms-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      filter = btn.getAttribute("data-sms-filter") || "all";
      filterEl.querySelectorAll("[data-sms-filter]").forEach((el) => {
        el.classList.toggle("is-active", el === btn);
      });
      render();
    });
  });

  window.DeaneSmsInbox = {
    showList,
    load,
  };
})();
