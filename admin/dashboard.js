(function () {
  var Admin = window.DeaneAdmin;

  function money(n) {
    return new Intl.NumberFormat("en-NZ", {
      style: "currency",
      currency: "NZD",
    }).format(Number(n) || 0);
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
      const deposits = data.depositsOutstanding || {};
      const overdue = data.invoicesOverdue || {};
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
            <button type="button" class="dash-money-row" data-billing="deposits">
              <span>Deposits outstanding</span>
              <strong>${money(deposits.totalIncl)}</strong>
            </button>
          </div>
          <p class="muted small">Overdue = sent invoice still unpaid after 7 days. Outstanding = unpaid invoices. Deposits outstanding = balance still due after a deposit.</p>
        </section>
      `;
      root.querySelectorAll("[data-jobs]").forEach((btn) => {
        btn.addEventListener("click", () => {
          Admin.setSection("jobs");
          window.DeaneJobs?.showList?.();
          window.DeaneJobs?.filterBy?.(btn.dataset.jobs);
        });
      });
      root.querySelectorAll("[data-billing]").forEach((btn) => {
        btn.addEventListener("click", () => {
          Admin.setSection("billing");
          window.DeaneBilling?.showList?.();
        });
      });
    } catch (err) {
      root.innerHTML = `<p class="error">${Admin.escapeHtml(err.message)}</p>`;
    }
  }

  window.DeaneDashboard = { load };
})();
