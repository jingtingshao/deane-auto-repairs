(function () {
  var Admin = window.DeaneAdmin;

  function money(n) {
    return new Intl.NumberFormat("en-NZ", {
      style: "currency",
      currency: "NZD",
    }).format(Number(n) || 0);
  }

  function moneyShort(n) {
    const v = Number(n) || 0;
    if (v >= 1000) return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
    return `$${Math.round(v)}`;
  }

  let selectedFinancialYear = "";
  let financialWindowStart = null;
  let selectedActivityMonth = "";

  function shiftMonthKey(yearMonth, delta) {
    const [year, month] = String(yearMonth).split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1 + Number(delta), 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function renderFinancialChart(history) {
    const rows = Array.isArray(history?.monthly) ? history.monthly : [];
    if (!rows.length) {
      return '<p class="muted small">No financial history for this year.</p>';
    }
    const windowSize = Math.min(6, rows.length);
    const maxStart = Math.max(0, rows.length - windowSize);
    if (!Number.isInteger(financialWindowStart)) {
      let lastActivity = rows.findLastIndex(
        (row) => Number(row.invoiced) > 0 || Number(row.received) > 0
      );
      if (lastActivity < 0) {
        const currentYear = Admin.todayIso().slice(0, 4);
        lastActivity =
          String(history.year) === currentYear
            ? Number(Admin.todayIso().slice(5, 7)) - 1
            : rows.length - 1;
      }
      financialWindowStart = Math.max(0, Math.min(maxStart, lastActivity - windowSize + 1));
    }
    financialWindowStart = Math.max(0, Math.min(maxStart, financialWindowStart));
    const shown = rows.slice(financialWindowStart, financialWindowStart + windowSize);
    const max = Math.max(
      1,
      ...shown.map((row) =>
        Math.max(Number(row.invoiced) || 0, Number(row.received) || 0)
      )
    );
    const plotWidth = 600;
    const plotHeight = 180;
    const lineTop = 18;
    const lineBottom = 164;
    const points = shown
      .map((row, index) => {
        const x = ((index + 0.5) / shown.length) * plotWidth;
        const y =
          lineBottom -
          ((Number(row.received) || 0) / max) * (lineBottom - lineTop);
        return `${x},${y}`;
      })
      .join(" ");
    const circles = shown
      .map((row, index) => {
        const x = ((index + 0.5) / shown.length) * plotWidth;
        const y =
          lineBottom -
          ((Number(row.received) || 0) / max) * (lineBottom - lineTop);
        return `<circle cx="${x}" cy="${y}" r="5"><title>${Admin.escapeHtml(
          `${row.label}: received ${money(row.received)}`
        )}</title></circle>`;
      })
      .join("");
    const first = shown[0]?.label || "";
    const last = shown[shown.length - 1]?.label || "";
    return `
      <div class="financial-window-toolbar">
        <button type="button" class="ghost" id="financial-window-prev" ${
          financialWindowStart <= 0 ? "disabled" : ""
        } aria-label="Previous month">← Previous</button>
        <strong>${Admin.escapeHtml(`${first}–${last} ${history.year || ""}`)}</strong>
        <button type="button" class="ghost" id="financial-window-next" ${
          financialWindowStart >= maxStart ? "disabled" : ""
        } aria-label="Next month">Next →</button>
      </div>
      <div class="financial-combo-legend">
        <span><i class="financial-dot invoiced"></i>Invoiced — bars</span>
        <span><i class="financial-dot received"></i>Received — line</span>
      </div>
      <div class="financial-combo-scroll">
        <div class="financial-combo-chart">
          <div class="financial-combo-plot">
            <div class="financial-combo-bars">
              ${shown
                .map((row) => {
                  const value = Number(row.invoiced) || 0;
                  const height = Math.max(value > 0 ? 7 : 0, Math.round((value / max) * 140));
                  return `<div class="financial-combo-column" title="${Admin.escapeAttr(
                    `${row.label}: invoiced ${money(value)}`
                  )}">
                    <span>${Admin.escapeHtml(moneyShort(value))}</span>
                    <div class="financial-invoice-bar" style="height:${height}px"></div>
                  </div>`;
                })
                .join("")}
            </div>
            <svg class="financial-received-line" viewBox="0 0 ${plotWidth} ${plotHeight}" preserveAspectRatio="none" aria-label="Payments received line">
              <polyline points="${points}"></polyline>
              ${circles}
            </svg>
          </div>
          <div class="financial-combo-months">
            ${shown.map((row) => `<strong>${Admin.escapeHtml(row.label || "")}</strong>`).join("")}
          </div>
          <div class="financial-combo-received">
            ${shown
              .map(
                (row) =>
                  `<span title="${Admin.escapeAttr(money(row.received))}">${Admin.escapeHtml(
                    moneyShort(row.received)
                  )}</span>`
              )
              .join("")}
          </div>
        </div>
      </div>
      <p class="muted small">Red bars include all invoices, including drafts and converted quotes. The blue line and values show payments received in each month.</p>
    `;
  }

  function renderFinancialWindow(history) {
    const root = document.getElementById("financial-chart-root");
    if (!root) return;
    root.innerHTML = renderFinancialChart(history);
    root.querySelector("#financial-window-prev")?.addEventListener("click", () => {
      financialWindowStart -= 1;
      renderFinancialWindow(history);
    });
    root.querySelector("#financial-window-next")?.addEventListener("click", () => {
      financialWindowStart += 1;
      renderFinancialWindow(history);
    });
  }

  async function load(
    year = selectedFinancialYear,
    activityMonth = selectedActivityMonth
  ) {
    const root = document.getElementById("dashboard-root");
    if (!root || !Admin) return;
    root.innerHTML = '<p class="muted">Loading dashboard…</p>';
    try {
      const params = new URLSearchParams();
      if (year) params.set("year", year);
      if (activityMonth) params.set("month", activityMonth);
      const suffix = params.size ? `?${params.toString()}` : "";
      const data = await Admin.api(`/api/admin/dashboard${suffix}`);
      const jobs = data.jobs || {};
      const quotes = data.quotesAwaitingAcceptance || {};
      const invoices = data.invoicesOutstanding || {};
      const overdue = data.invoicesOverdue || {};
      const paidMonth = data.paymentsThisMonth || {};
      const financial = data.financialHistory || {};
      selectedFinancialYear = String(financial.year || new Date().getFullYear());
      const thisMonth = data.thisMonth || {};
      selectedActivityMonth = String(thisMonth.key || Admin.todayIso().slice(0, 7));
      root.innerHTML = `
        <section class="dash-section-heading dash-section-heading-first">
          <div>
            <p class="dash-eyebrow">Workshop now</p>
            <h2>${Number(jobs.total) || 0} active jobs</h2>
            <p>Vehicles that still need attention today.</p>
          </div>
        </section>
        <section class="dash-kpi-grid dash-kpi-grid-3">
          <button type="button" class="dash-kpi tone-wait" data-jobs="waiting_parts">
            <span class="dash-kpi-label">Waiting parts</span>
            <strong>${Number(jobs.waiting_parts) || 0}</strong>
            <small>Parts still to arrive</small>
          </button>
          <button type="button" class="dash-kpi tone-progress" data-jobs="in_progress">
            <span class="dash-kpi-label">In progress</span>
            <strong>${Number(jobs.in_progress) || 0}</strong>
            <small>Currently being worked on</small>
          </button>
          <button type="button" class="dash-kpi tone-ready" data-jobs="completed">
            <span class="dash-kpi-label">Ready to collect</span>
            <strong>${Number(jobs.completed) || 0}</strong>
            <small>Waiting for the customer</small>
          </button>
        </section>

        <section class="dash-section-heading">
          <div>
            <p class="dash-eyebrow">Money</p>
            <h2>Current receivables</h2>
            <p>What is waiting, overdue, or already received.</p>
          </div>
        </section>
        <section class="dash-kpi-grid dash-kpi-grid-4">
          <button type="button" class="dash-kpi dash-kpi-money tone-quote" data-billing="quotes">
            <span class="dash-kpi-label">Quotes awaiting</span>
            <strong>${money(quotes.totalIncl)}</strong>
            <small>${Number(quotes.count) || 0} quote${Number(quotes.count) === 1 ? "" : "s"} awaiting acceptance</small>
          </button>
          <button type="button" class="dash-kpi dash-kpi-money tone-due" data-billing="invoices">
            <span class="dash-kpi-label">Awaiting payment</span>
            <strong>${money(invoices.totalIncl)}</strong>
            <small>${Number(invoices.count) || 0} invoice${Number(invoices.count) === 1 ? "" : "s"}, including drafts</small>
          </button>
          <button type="button" class="dash-kpi dash-kpi-money tone-overdue" data-billing="overdue">
            <span class="dash-kpi-label">Overdue</span>
            <strong>${money(overdue.totalIncl)}</strong>
            <small>${Number(overdue.count) || 0} invoice${Number(overdue.count) === 1 ? "" : "s"} overdue 7+ days</small>
          </button>
          <button type="button" class="dash-kpi dash-kpi-money tone-paid" data-billing="payments">
            <span class="dash-kpi-label">Received this month</span>
            <strong>${money(paidMonth.totalIncl)}</strong>
            <small>${Number(paidMonth.count) || 0} payment${Number(paidMonth.count) === 1 ? "" : "s"} recorded</small>
          </button>
        </section>

        <section class="dash-section-heading">
          <div>
            <p class="dash-eyebrow">Monthly activity</p>
            <h2>${Admin.escapeHtml(thisMonth.label || "Workshop activity")}</h2>
            <p>Completed work recorded from invoices.</p>
          </div>
          <div class="dash-month-nav" aria-label="Choose activity month">
            <button type="button" class="ghost" id="activity-month-prev">← Previous</button>
            <button type="button" class="ghost" id="activity-month-next" ${
              selectedActivityMonth >= Admin.todayIso().slice(0, 7) ? "disabled" : ""
            }>Next →</button>
          </div>
        </section>
        <section class="dash-kpi-grid dash-kpi-grid-2">
          <button type="button" class="dash-kpi tone-service" data-billing="services" data-activity-month="${Admin.escapeAttr(thisMonth.key || "")}">
            <span class="dash-kpi-label">Services</span>
            <strong>${Number(thisMonth.services) || 0}</strong>
            <small>Open matching invoices</small>
          </button>
          <button type="button" class="dash-kpi tone-wof" data-billing="wofs" data-activity-month="${Admin.escapeAttr(thisMonth.key || "")}">
            <span class="dash-kpi-label">WOFs</span>
            <strong>${Number(thisMonth.wofs) || 0}</strong>
            <small>Open matching invoices</small>
          </button>
        </section>
        <section class="dash-card dash-card-wide">
          <div class="dash-card-heading">
            <h2>Financial history</h2>
            <label class="dash-year-select">
              Year
              <select id="financial-history-year">
                ${(financial.availableYears || [financial.year])
                  .map(
                    (value) =>
                      `<option value="${Admin.escapeAttr(String(value))}"${Number(value) === Number(financial.year) ? " selected" : ""}>${Admin.escapeHtml(String(value))}</option>`
                  )
                  .join("")}
              </select>
            </label>
          </div>
          <div class="dash-month-stats dash-financial-totals">
            <div><strong>${moneyShort(financial.totals?.invoiced)}</strong><span>Invoiced this year</span></div>
            <div><strong>${moneyShort(financial.totals?.received)}</strong><span>Received this year</span></div>
            <div><strong>${moneyShort(financial.totals?.outstanding)}</strong><span>Still outstanding</span></div>
          </div>
          <div id="financial-chart-root"></div>
        </section>
        <section class="dash-backup-bar" id="dash-backup-card">
          <div class="dash-backup-copy">
            <strong>Backup</strong>
            <span class="muted small" id="dash-backup-status">Checking Google Drive backup…</span>
          </div>
          <button type="button" class="ghost" id="btn-backup-now">Backup now</button>
        </section>
      `;
      root.querySelectorAll("[data-jobs]").forEach((btn) => {
        btn.addEventListener("click", () => {
          Admin.setSection("jobs");
          window.DeaneJobs?.showList?.({
            filter: btn.dataset.jobs,
            year: btn.dataset.jobYear || "",
            month: btn.dataset.activityMonth || "",
          });
        });
      });
      root.querySelectorAll("[data-billing]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const key = btn.dataset.billing;
          if (key === "quotes") {
            Admin.setSection("quotes");
            window.DeaneBilling?.showList?.({ kind: "quote", filter: "awaiting" });
            return;
          }
          const filter =
            key === "overdue"
              ? "overdue"
              : key === "payments"
                ? "paid_month"
                : key === "services"
                  ? "service_month"
                  : key === "wofs"
                    ? "wof_month"
                : "outstanding";
          Admin.setSection("invoices");
          window.DeaneBilling?.showList?.({
            kind: "invoice",
            filter,
            month: btn.dataset.activityMonth || "",
          });
        });
      });
      document.getElementById("financial-history-year")?.addEventListener("change", (event) => {
        selectedFinancialYear = event.target.value;
        financialWindowStart = null;
        load(selectedFinancialYear, selectedActivityMonth);
      });
      document.getElementById("activity-month-prev")?.addEventListener("click", () => {
        selectedActivityMonth = shiftMonthKey(selectedActivityMonth, -1);
        load(selectedFinancialYear, selectedActivityMonth);
      });
      document.getElementById("activity-month-next")?.addEventListener("click", () => {
        const next = shiftMonthKey(selectedActivityMonth, 1);
        const current = Admin.todayIso().slice(0, 7);
        selectedActivityMonth = next > current ? current : next;
        load(selectedFinancialYear, selectedActivityMonth);
      });
      renderFinancialWindow(financial);
      wireBackupCard();
    } catch (err) {
      root.innerHTML = `<p class="error">${Admin.escapeHtml(err.message)}</p>`;
    }
  }

  function formatBackupWhen(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return new Intl.DateTimeFormat("en-NZ", {
      timeZone: "Pacific/Auckland",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  }

  async function wireBackupCard() {
    const statusEl = document.getElementById("dash-backup-status");
    const btn = document.getElementById("btn-backup-now");
    if (!statusEl || !btn) return;

    const renderStatus = async () => {
      try {
        const data = await Admin.api("/api/admin/backup-status");
        if (!data.configured) {
          statusEl.textContent =
            "Not configured yet. Add OAuth client ID/secret to .env, then run: npm run backup:auth";
          btn.disabled = true;
          return;
        }
        btn.disabled = false;
        const last = data.last;
        if (!last) {
          statusEl.textContent = `Ready. Auto backup daily from ${data.hourNz}:00 Auckland time. No backup yet.`;
          return;
        }
        if (last.ok) {
          statusEl.textContent = `Last backup OK: ${last.fileName || "zip"} · ${formatBackupWhen(
            last.finishedAt || last.at
          )}`;
        } else {
          statusEl.textContent = `Last backup failed: ${last.error || "unknown error"} · ${formatBackupWhen(
            last.finishedAt || last.at
          )}`;
        }
      } catch (err) {
        const msg = err.message || "Could not load backup status.";
        statusEl.textContent = /Failed to fetch|NetworkError|Load failed/i.test(msg)
          ? "Cannot reach server. In the project folder run: npm start — then refresh this page."
          : msg;
      }
    };

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Backing up…";
      statusEl.textContent = "Uploading zip to Google Drive…";
      try {
        const result = await Admin.api("/api/admin/backup", {
          method: "POST",
          body: "{}",
        });
        statusEl.textContent = `Backup OK: ${result.fileName || "zip"} · ${formatBackupWhen(
          result.finishedAt || result.at
        )}`;
        Admin.showStatus?.("Backup uploaded to Google Drive");
      } catch (err) {
        statusEl.textContent = err.message || "Backup failed.";
        alert(err.message || "Backup failed.");
      } finally {
        btn.disabled = false;
        btn.textContent = "Backup now";
        await renderStatus();
      }
    });

    await renderStatus();
  }

  window.DeaneDashboard = { load };
})();
