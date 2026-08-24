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

  function renderFinancialChart(history) {
    const rows = Array.isArray(history?.monthly) ? history.monthly : [];
    if (!rows.length) {
      return '<p class="muted small">No financial history for this year.</p>';
    }
    const max = Math.max(
      1,
      ...rows.map((m) =>
        Math.max(
          Number(m.invoiced) || 0,
          Number(m.received) || 0,
          Number(m.outstanding) || 0
        )
      )
    );
    const bars = rows
      .map((m) => {
        const invoiced = Number(m.invoiced) || 0;
        const received = Number(m.received) || 0;
        const outstanding = Number(m.outstanding) || 0;
        const invoicedH = Math.max(
          invoiced > 0 ? 8 : 0,
          Math.round((invoiced / max) * 140)
        );
        const receivedH = Math.max(
          received > 0 ? 8 : 0,
          Math.round((received / max) * 140)
        );
        const outH = Math.max(
          outstanding > 0 ? 8 : 0,
          Math.round((outstanding / max) * 140)
        );
        return `<div class="dash-bar-group" title="${Admin.escapeAttr(
          `${m.label}: invoiced ${money(invoiced)}, received ${money(received)}, outstanding ${money(outstanding)}`
        )}">
          <div class="dash-bars">
            <div class="dash-bar invoiced" style="height:${invoicedH}px"></div>
            <div class="dash-bar received" style="height:${receivedH}px"></div>
            <div class="dash-bar outstanding" style="height:${outH}px"></div>
          </div>
          <div class="dash-bar-values">
            <span>${Admin.escapeHtml(moneyShort(invoiced))}</span>
            <span>${Admin.escapeHtml(moneyShort(received))}</span>
            <span>${Admin.escapeHtml(moneyShort(outstanding))}</span>
          </div>
          <div class="dash-bar-label">${Admin.escapeHtml(m.label)}</div>
        </div>`;
      })
      .join("");

    return `
      <div class="dash-chart-legend">
        <span><i class="swatch invoiced"></i> Invoiced</span>
        <span><i class="swatch received"></i> Payments received</span>
        <span><i class="swatch outstanding"></i> Still outstanding</span>
      </div>
      <div class="dash-chart-scroll">
        <div class="dash-chart financial">${bars}</div>
      </div>
      <p class="muted small">Drafts with no payment are excluded. Received uses each payment date; outstanding is the balance still due on issued invoices.</p>
    `;
  }

  function renderJobYear(monthly) {
    const rows = Array.isArray(monthly) ? monthly : [];
    if (!rows.length) return '<p class="muted small">No collected-job history yet.</p>';
    return `<div class="dash-job-year">${rows
      .map(
        (row) => `<div title="${Admin.escapeAttr(
          `${row.label}: ${Number(row.count) || 0} collected`
        )}">
          <strong>${Number(row.count) || 0}</strong>
          <span>${Admin.escapeHtml(row.label || "")}</span>
        </div>`
      )
      .join("")}</div>`;
  }

  async function load(year = selectedFinancialYear) {
    const root = document.getElementById("dashboard-root");
    if (!root || !Admin) return;
    root.innerHTML = '<p class="muted">Loading dashboard…</p>';
    try {
      const suffix = year ? `?year=${encodeURIComponent(year)}` : "";
      const data = await Admin.api(`/api/admin/dashboard${suffix}`);
      const jobs = data.jobs || {};
      const jobHistory = data.jobHistory || {};
      const quotes = data.quotesAwaitingAcceptance || {};
      const invoices = data.invoicesOutstanding || {};
      const overdue = data.invoicesOverdue || {};
      const paidMonth = data.paymentsThisMonth || {};
      const financial = data.financialHistory || {};
      selectedFinancialYear = String(financial.year || new Date().getFullYear());
      const thisMonth = data.thisMonth || {};
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
            <small>${Number(invoices.count) || 0} issued invoice${Number(invoices.count) === 1 ? "" : "s"}</small>
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
            <p class="dash-eyebrow">This month</p>
            <h2>${Admin.escapeHtml(thisMonth.label || "Workshop activity")}</h2>
            <p>Completed work recorded from invoices and collected job cards.</p>
          </div>
        </section>
        <section class="dash-kpi-grid dash-kpi-grid-3">
          <button type="button" class="dash-kpi tone-service" data-billing="services">
            <span class="dash-kpi-label">Services</span>
            <strong>${Number(thisMonth.services) || 0}</strong>
            <small>Open matching invoices</small>
          </button>
          <button type="button" class="dash-kpi tone-wof" data-billing="wofs">
            <span class="dash-kpi-label">WOFs</span>
            <strong>${Number(thisMonth.wofs) || 0}</strong>
            <small>Open matching invoices</small>
          </button>
          <button type="button" class="dash-kpi tone-collected" data-jobs="collected_month">
            <span class="dash-kpi-label">Collected jobs</span>
            <strong>${Number(jobHistory.month) || 0}</strong>
            <small>Vehicles collected this month</small>
          </button>
        </section>

        <section class="dash-section-heading">
          <div>
            <p class="dash-eyebrow">History</p>
            <h2>Workshop performance</h2>
            <p>Yearly job and financial records.</p>
          </div>
        </section>
        <section class="dash-card dash-card-wide">
          <div class="dash-card-heading">
            <h2>Collected jobs · ${Number(jobHistory.yearLabel) || new Date().getFullYear()}</h2>
            <button type="button" class="ghost" data-jobs="collected" data-job-year="${Number(jobHistory.yearLabel) || new Date().getFullYear()}">View full history</button>
          </div>
          <div class="dash-month-stats dash-job-stats">
            <div>
              <strong>${Number(jobHistory.week) || 0}</strong>
              <span>This week</span>
            </div>
            <div>
              <strong>${Number(jobHistory.month) || 0}</strong>
              <span>This month</span>
            </div>
            <div>
              <strong>${Number(jobHistory.year) || 0}</strong>
              <span>This year</span>
            </div>
          </div>
          ${renderJobYear(jobHistory.monthly)}
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
          ${renderFinancialChart(financial)}
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
          window.DeaneBilling?.showList?.({ kind: "invoice", filter });
        });
      });
      document.getElementById("financial-history-year")?.addEventListener("change", (event) => {
        selectedFinancialYear = event.target.value;
        load(selectedFinancialYear);
      });
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
