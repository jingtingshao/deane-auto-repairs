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

  function renderMonthlyChart(monthly) {
    const rows = Array.isArray(monthly) ? monthly : [];
    if (!rows.length) {
      return '<p class="muted small">No monthly invoice data yet.</p>';
    }
    const max = Math.max(
      1,
      ...rows.map((m) => Math.max(Number(m.sales) || 0, Number(m.outstanding) || 0))
    );
    const bars = rows
      .map((m) => {
        const sales = Number(m.sales) || 0;
        const outstanding = Number(m.outstanding) || 0;
        const salesH = Math.max(sales > 0 ? 8 : 0, Math.round((sales / max) * 140));
        const outH = Math.max(
          outstanding > 0 ? 8 : 0,
          Math.round((outstanding / max) * 140)
        );
        return `<div class="dash-bar-group" title="${Admin.escapeAttr(
          `${m.label}: sales ${money(sales)}, outstanding ${money(outstanding)}`
        )}">
          <div class="dash-bars">
            <div class="dash-bar sales" style="height:${salesH}px"></div>
            <div class="dash-bar outstanding" style="height:${outH}px"></div>
          </div>
          <div class="dash-bar-values">
            <span>${Admin.escapeHtml(moneyShort(sales))}</span>
            <span>${Admin.escapeHtml(moneyShort(outstanding))}</span>
          </div>
          <div class="dash-bar-label">${Admin.escapeHtml(m.label)}</div>
        </div>`;
      })
      .join("");

    return `
      <div class="dash-chart-legend">
        <span><i class="swatch sales"></i> Sales (invoiced)</span>
        <span><i class="swatch outstanding"></i> Still outstanding</span>
      </div>
      <div class="dash-chart">${bars}</div>
      <p class="muted small">Sales = every invoice (including drafts). Quotes are not sales. Outstanding = unpaid balance on those invoices.</p>
    `;
  }

  async function load() {
    const root = document.getElementById("dashboard-root");
    if (!root || !Admin) return;
    root.innerHTML = '<p class="muted">Loading dashboard…</p>';
    try {
      const data = await Admin.api("/api/admin/dashboard");
      const jobs = data.jobs || {};
      const quotes = data.quotesAwaitingAcceptance || {};
      const invoices = data.invoicesOutstanding || {};
      const overdue = data.invoicesOverdue || {};
      const thisMonth = data.thisMonth || {};
      root.innerHTML = `
        <section class="dash-card">
          <h2>${Number(jobs.total) || 0} Jobs</h2>
          <ul class="dash-tree">
            <li><button type="button" class="dash-link" data-jobs="waiting_parts">${Number(jobs.waiting_parts) || 0} Waiting parts</button></li>
            <li><button type="button" class="dash-link" data-jobs="in_progress">${Number(jobs.in_progress) || 0} In progress</button></li>
            <li><button type="button" class="dash-link" data-jobs="completed">${Number(jobs.completed) || 0} Ready to collect</button></li>
          </ul>
        </section>
        <section class="dash-card">
          <h2>Money</h2>
          <div class="dash-money">
            <button type="button" class="dash-money-row" data-billing="quotes">
              <span>Quotes awaiting acceptance</span>
              <strong>${money(quotes.totalIncl)}</strong>
            </button>
            <button type="button" class="dash-money-row" data-billing="overdue">
              <span>Invoices overdue (7+ days)</span>
              <strong>${money(overdue.totalIncl)}</strong>
            </button>
            <button type="button" class="dash-money-row" data-billing="invoices">
              <span>Invoices outstanding</span>
              <strong>${money(invoices.totalIncl)}</strong>
            </button>
          </div>
          <p class="muted small">Overdue = sent invoice still unpaid after 7 days. Outstanding = unpaid invoices.</p>
        </section>
        <section class="dash-card">
          <h2>${Admin.escapeHtml(thisMonth.label || "This month")}</h2>
          <div class="dash-month-stats">
            <div>
              <strong>${Number(thisMonth.services) || 0}</strong>
              <span>Services</span>
            </div>
            <div>
              <strong>${Number(thisMonth.wofs) || 0}</strong>
              <span>WOFs</span>
            </div>
          </div>
          <p class="muted small">From digital service reports with a service date in this month.</p>
        </section>
        <section class="dash-card dash-card-wide">
          <h2>Last 6 months</h2>
          ${renderMonthlyChart(data.monthly)}
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
          window.DeaneJobs?.showList?.({ filter: btn.dataset.jobs });
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
          const filter = key === "overdue" ? "overdue" : "outstanding";
          Admin.setSection("invoices");
          window.DeaneBilling?.showList?.({ kind: "invoice", filter });
        });
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
