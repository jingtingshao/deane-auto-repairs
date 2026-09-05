(function () {
  const Admin = window.DeaneAdmin;
  const listEl = document.getElementById("referrals-list");
  const formEl = document.getElementById("referral-form");
  const referrerEl = document.getElementById("referral-referrer");
  const referredEl = document.getElementById("referral-referred");
  const notesEl = document.getElementById("referral-notes");
  const filterEl = document.getElementById("referrals-filter");

  let tab = "referrals";
  let referrals = [];
  let creditOwners = [];
  let creditLedger = [];
  let customers = [];

  function money(n) {
    return `$${Number(n || 0).toFixed(2)}`;
  }

  function statusLabel(status) {
    const map = {
      pending: "Pending",
      qualified: "Qualified",
      rejected: "Rejected",
      cancelled: "Cancelled",
      active: "Active",
      used: "Used",
      expired: "Expired",
      void: "Void",
    };
    return map[status] || status || "—";
  }

  function hideForm() {
    if (formEl) formEl.hidden = true;
    if (notesEl) notesEl.value = "";
  }

  async function loadCustomers() {
    customers = await Admin.api("/api/customers");
    Admin.fillCustomerSelect(referrerEl, customers, "");
    Admin.fillCustomerSelect(referredEl, customers, "");
  }

  async function loadReferrals() {
    referrals = await Admin.api("/api/referrals");
  }

  async function loadCredits() {
    const data = await Admin.api("/api/referral-credits");
    if (Array.isArray(data)) {
      creditOwners = data;
      creditLedger = [];
    } else {
      creditOwners = data?.balances || [];
      creditLedger = data?.ledger || [];
    }
  }

  function invoiceButtons(items) {
    const rows = Array.isArray(items) ? items.filter((u) => u.invoiceId) : [];
    if (!rows.length) return "—";
    return rows
      .map((u) => {
        const label = Admin.escapeHtml(u.invoiceNumber || "Invoice");
        return `<button type="button" class="ghost" data-open-invoice="${Admin.escapeAttr(
          u.invoiceId
        )}">${label}</button>`;
      })
      .join(" ");
  }

  function bindInvoiceOpens(root) {
    root?.querySelectorAll("[data-open-invoice]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        Admin.setSection("invoices");
        window.DeaneBilling?.openDoc?.(btn.dataset.openInvoice);
      });
    });
  }

  function renderReferrals() {
    if (!listEl) return;
    if (!referrals.length) {
      listEl.innerHTML =
        `<p class="muted">No referrals yet. Click <strong>+ Register referral</strong> when an existing customer brings someone new.</p>`;
      return;
    }
    listEl.innerHTML = `
    <div class="billing-table-wrap">
      <table class="billing-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Referrer</th>
            <th>New customer</th>
            <th>Status</th>
            <th>Qualifying invoice</th>
            <th>Credit</th>
            <th>Used on invoice</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${referrals
            .map((row) => {
              const when =
                Admin.formatDateShort?.(row.createdAt) ||
                String(row.createdAt || "").slice(0, 10);
              const reason =
                row.status === "rejected" && row.rejectionReason
                  ? ` <span class="muted small">(${Admin.escapeHtml(
                      row.rejectionReason.replace(/_/g, " ")
                    )})</span>`
                  : "";
              const creditBits = [];
              if (row.creditStatus) creditBits.push(statusLabel(row.creditStatus));
              if (row.creditExpiresAt) {
                creditBits.push(`exp ${Admin.formatDateShort(row.creditExpiresAt)}`);
              }
              const canCancel =
                row.status === "pending" ||
                (row.status === "qualified" && row.creditStatus === "active");
              const qualifyBtn = row.qualifyingInvoiceId
                ? `<button type="button" class="ghost" data-open-invoice="${Admin.escapeAttr(
                    row.qualifyingInvoiceId
                  )}">${Admin.escapeHtml(row.qualifyingInvoiceNumber || "Invoice")}</button>`
                : "—";
              return `
            <tr>
              <td>${Admin.escapeHtml(when || "—")}</td>
              <td>${Admin.escapeHtml(row.referrerName || "—")}</td>
              <td>${Admin.escapeHtml(row.referredName || "—")}</td>
              <td>${Admin.escapeHtml(statusLabel(row.status))}${reason}</td>
              <td>${qualifyBtn}</td>
              <td class="muted small">${Admin.escapeHtml(creditBits.join(" · ") || "—")}</td>
              <td>${invoiceButtons(row.usedOn)}</td>
              <td>${
                canCancel
                  ? `<button type="button" class="ghost" data-cancel-referral="${Admin.escapeAttr(
                      row.id
                    )}">Cancel</button>`
                  : ""
              }</td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;

    bindInvoiceOpens(listEl);
    listEl.querySelectorAll("[data-cancel-referral]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Cancel this referral?")) return;
        try {
          await Admin.api(`/api/referrals/${btn.dataset.cancelReferral}/cancel`, {
            method: "POST",
            body: "{}",
          });
          await loadReferrals();
          render();
        } catch (err) {
          alert(err.message || "Could not cancel referral.");
        }
      });
    });
  }

  function renderCredits() {
    if (!listEl) return;
    const withBalance = (creditOwners || []).filter((row) => Number(row.balance) > 0);
    const usedRows = (creditLedger || []).filter((row) => row.status === "used");
    const otherRows = (creditLedger || []).filter(
      (row) => row.status === "expired" || row.status === "void"
    );
    if (!withBalance.length && !usedRows.length && !otherRows.length) {
      listEl.innerHTML =
        `<p class="muted">No referral credits yet. Credits appear after a referred customer’s first qualifying paid service ($50+).</p>`;
      return;
    }
    const activeTable = withBalance.length
      ? `
    <h3 class="muted small">Available</h3>
    <div class="billing-table-wrap">
      <table class="billing-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Balance</th>
            <th>Credits</th>
            <th>Next expiry</th>
          </tr>
        </thead>
        <tbody>
          ${withBalance
            .map((row) => {
              const nextExp = (row.credits || [])
                .map((c) => c.expiresAt)
                .filter(Boolean)
                .sort()[0];
              return `
            <tr>
              <td>${Admin.escapeHtml(row.customerName || "—")}</td>
              <td>${money(row.balance)}</td>
              <td>${Admin.escapeHtml(String(row.creditCount || 0))}</td>
              <td>${Admin.escapeHtml(
                nextExp ? Admin.formatDateShort(nextExp) : "—"
              )}</td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`
      : `<p class="muted">No unused credits right now.</p>`;

    const usedTable = usedRows.length
      ? `
    <h3 class="muted small">Used on invoices</h3>
    <div class="billing-table-wrap">
      <table class="billing-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Amount</th>
            <th>Used on invoice</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${usedRows
            .map((row) => {
              const when = (row.usedOn || [])
                .map((u) => u.usedAt)
                .filter(Boolean)
                .sort()
                .slice(-1)[0];
              return `
            <tr>
              <td>${Admin.escapeHtml(row.ownerName || "—")}</td>
              <td>${money(row.amount)}</td>
              <td>${invoiceButtons(row.usedOn)}</td>
              <td>${Admin.escapeHtml(
                when ? Admin.formatDateShort(when) : "—"
              )}</td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`
      : "";

    listEl.innerHTML = `${activeTable}${usedTable}`;
    bindInvoiceOpens(listEl);
  }

  function render() {
    if (tab === "credits") renderCredits();
    else renderReferrals();
  }

  async function showList() {
    Admin.setSection("referrals");
    hideForm();
    try {
      await Promise.all([loadCustomers(), loadReferrals(), loadCredits()]);
      render();
    } catch (err) {
      alert(err.message || "Could not load referrals.");
    }
  }

  document.getElementById("btn-referral-new")?.addEventListener("click", async () => {
    try {
      await loadCustomers();
      if (formEl) formEl.hidden = false;
      referrerEl?.focus();
    } catch (err) {
      alert(err.message || "Could not load customers.");
    }
  });

  document.getElementById("btn-referral-cancel")?.addEventListener("click", () => {
    hideForm();
  });

  formEl?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const referrerCustomerId = referrerEl?.value || "";
    const referredCustomerId = referredEl?.value || "";
    if (!referrerCustomerId || !referredCustomerId) {
      alert("Choose both customers.");
      return;
    }
    try {
      const result = await Admin.api("/api/referrals", {
        method: "POST",
        body: JSON.stringify({
          referrerCustomerId,
          referredCustomerId,
          notes: notesEl?.value || "",
        }),
      });
      hideForm();
      await Promise.all([loadReferrals(), loadCredits()]);
      tab = "referrals";
      filterEl?.querySelectorAll("[data-ref-tab]").forEach((el) => {
        el.classList.toggle("is-active", el.getAttribute("data-ref-tab") === "referrals");
      });
      render();
      if (result.rejected) {
        const reason = result.referral?.rejectionReason || "";
        if (reason === "already_referred_before") {
          alert(
            "Saved as rejected — this person was already used as a referral new customer before, so no further $20 credit can be issued."
          );
        } else {
          alert(
            "Saved as rejected — that person is already an existing customer (prior paid service or completed job), so they cannot be treated as a new customer for a referral reward."
          );
        }
      }
    } catch (err) {
      alert(err.message || "Could not save referral.");
    }
  });

  filterEl?.querySelectorAll("[data-ref-tab]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.id === "btn-referral-new") return;
      const next = btn.getAttribute("data-ref-tab");
      if (!next) return;
      tab = next;
      filterEl.querySelectorAll("[data-ref-tab]").forEach((el) => {
        el.classList.toggle("is-active", el === btn);
      });
      hideForm();
      try {
        if (tab === "credits") await loadCredits();
        else await loadReferrals();
        render();
      } catch (err) {
        alert(err.message || "Could not refresh.");
      }
    });
  });

  window.DeaneReferrals = {
    showList,
    load: showList,
  };
})();
