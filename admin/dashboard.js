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

  let selectedBoardId = "";

  function setNavCount(id, count) {
    const el = document.getElementById(id);
    if (!el) return;
    const n = Number(count) || 0;
    el.hidden = n <= 0;
    el.textContent = String(n);
  }

  function timeAgo(iso, fallback) {
    if (fallback) return fallback;
    const raw = String(iso || "").trim();
    if (!raw) return "";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "";
    const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
  }

  function photoSrc(photo) {
    const src = String(photo || "").trim();
    if (!src) return "";
    if (/^https?:\/\//i.test(src) || src.startsWith("/")) return src;
    return `/uploads/${src}`;
  }

  function statusLabel(status) {
    if (status === "waiting_parts") return "Waiting parts";
    if (status === "completed") return "Ready to collect";
    if (status === "collected") return "Collected";
    return "In progress";
  }

  function stepperHtml(status) {
    const waiting = status === "waiting_parts";
    const complete = status === "completed" || status === "collected";
    const collected = status === "collected";
    const cls = waiting ? "stepper parts" : "stepper";
    return `<div class="${cls}">
      <button type="button" class="done" data-job-status="in_progress">Received</button>
      <button type="button" class="${waiting || complete ? "done" : ""}" data-job-status="waiting_parts">Waiting parts</button>
      <button type="button" class="${complete ? "done" : ""}" data-job-status="completed">Complete</button>
      <button type="button" class="${collected ? "done" : ""}" data-job-status="collected">Collected</button>
    </div>`;
  }

  function progressHtml(job) {
    const waiting = job.status === "waiting_parts";
    const complete = job.status === "completed" || job.status === "collected";
    const collected = job.status === "collected";
    const s2 = waiting ? "parts current" : complete ? "complete" : "current";
    const s2label = waiting ? "Waiting on parts" : "Service in progress";
    const s2small = waiting
      ? "Parts still to arrive"
      : job.technicianName
        ? `Technician: ${job.technicianName}`
        : "In the workshop";
    const s2mark = complete ? "✓" : "2";
    return `<ol>
      <li class="complete"><b>✓</b><span>Vehicle received<small>${Admin.escapeHtml(
        job.time || ""
      )}${job.period ? ` ${Admin.escapeHtml(job.period)}` : ""}</small></span></li>
      <li class="${s2}"><b>${s2mark}</b><span>${s2label}<small>${Admin.escapeHtml(s2small)}</small></span></li>
      <li class="${complete ? "complete" : ""}"><b>${complete ? "✓" : "3"}</b><span>Ready for collection</span></li>
      <li class="${collected ? "complete" : ""}"><b>${collected ? "✓" : "4"}</b><span>Vehicle collected</span></li>
    </ol>`;
  }

  function boardRowHtml(job, selected) {
    return `<article class="job-row${selected ? " selected" : ""}" data-job-id="${Admin.escapeAttr(job.id)}">
      <div class="time">${Admin.escapeHtml(job.time || "—")}<br /><small>${Admin.escapeHtml(
        job.period || ""
      )}</small></div>
      <div class="plate">${Admin.escapeHtml(job.registration || "—")}</div>
      <div class="job-name"><strong>${Admin.escapeHtml(
        job.vehicle || "Vehicle"
      )}</strong><span>${Admin.escapeHtml(job.workLabel || "Workshop job")}</span></div>
      ${stepperHtml(job.status)}
      <button type="button" class="row-action" data-open-job="${Admin.escapeAttr(job.id)}">Open →</button>
    </article>`;
  }

  function detailHtml(job) {
    if (!job) return "";
    const src = photoSrc(job.photo);
    return `<section class="detail-panel">
      <div class="detail-top">
        <div>
          <p class="overline">SELECTED JOB · ${Admin.escapeHtml(job.number || "Job")}</p>
          <h2>${Admin.escapeHtml(job.registration || "—")} <span>·</span> ${Admin.escapeHtml(
            job.vehicle || "Vehicle"
          )}</h2>
          <p>${Admin.escapeHtml(job.workLabel || "Workshop job")}${
            job.customerName ? ` · Customer: ${Admin.escapeHtml(job.customerName)}` : ""
          }</p>
        </div>
        <div>
          <button type="button" class="button status ${Admin.escapeAttr(job.status)}">● ${Admin.escapeHtml(
            statusLabel(job.status)
          )}</button>
          <button type="button" class="button dark" data-open-job="${Admin.escapeAttr(job.id)}">Open job card →</button>
        </div>
      </div>
      <div class="detail-grid">
        <div class="car-photo">${
          src
            ? `<img src="${Admin.escapeAttr(src)}" alt="${Admin.escapeAttr(job.registration || "Vehicle")}">`
            : "<span>VEHICLE<br />PHOTO</span>"
        }</div>
        <div class="vehicle-info">
          <p class="overline">VEHICLE SNAPSHOT</p>
          <dl>
            <div><dt>ODO</dt><dd>${Admin.escapeHtml(job.odometer || "—")}${
              job.odometer ? " km" : ""
            }</dd></div>
            <div><dt>LAST SERVICE</dt><dd>${Admin.escapeHtml(job.lastServiceLabel || "—")}</dd></div>
            <div><dt>WOF EXPIRY</dt><dd><b>${Admin.escapeHtml(
              job.wofExpiryLabel || "—"
            )}</b><small>${Admin.escapeHtml(job.wofDaysLabel || "")}</small></dd></div>
            <div><dt>NEXT ACTION</dt><dd>${Admin.escapeHtml(job.nextAction || "")}</dd></div>
          </dl>
        </div>
        <div class="job-progress">
          <p class="overline">JOB PROGRESS</p>
          ${progressHtml(job)}
        </div>
      </div>
    </section>`;
  }

  function openJobCard(id) {
    if (!id) return;
    Admin.setSection("jobs");
    window.DeaneJobs?.openJob?.(id);
  }

  function formatListDate(value) {
    return Admin.formatDateShort(value) || "—";
  }

  function quoteStatusText(doc) {
    if (doc.status === "sent" && doc.viewedAt) return "Viewed";
    return String(doc.status || "draft").replace(/^./, (ch) => ch.toUpperCase());
  }

  function openBillingDoc(id, kind) {
    if (!id) return;
    Admin.setSection(kind === "invoice" ? "invoices" : "quotes");
    window.DeaneBilling?.openDoc?.(id);
  }

  function billingDashboardHtml(docs) {
    const rows = Array.isArray(docs) ? docs.filter((doc) => doc.status !== "void") : [];
    const quoteRows = rows.filter((doc) => doc.kind === "quote").slice(0, 6);
    const invoiceRows = rows.filter((doc) => doc.kind === "invoice").slice(0, 8);
    return `<section class="billing-dashboard-grid" aria-label="Quotes and invoices">
      <div class="panel billing-dashboard-panel">
        <div class="panel-head">
          <div>
            <p class="overline">QUOTE PIPELINE</p>
            <h2>Quotes</h2>
          </div>
          <a href="#quotes" data-billing="quotes">See all quotes →</a>
        </div>
        ${
          quoteRows.length
            ? `<div class="dashboard-table-wrap"><table class="dashboard-money-table">
                <thead><tr><th>Quote no</th><th>Date</th><th>Customer name</th><th>Quote $</th><th>Status</th></tr></thead>
                <tbody>${quoteRows
                  .map(
                    (doc) => `<tr data-open-billing="${Admin.escapeAttr(doc.id)}" data-billing-kind="quote">
                      <td class="number-cell">${Admin.escapeHtml(doc.number || "—")}</td>
                      <td>${Admin.escapeHtml(formatListDate(doc.sortAt || doc.sentAt || doc.createdAt || doc.updatedAt))}</td>
                      <td>${Admin.escapeHtml(doc.customerName || "—")}</td>
                      <td class="money-cell">${money(doc.totalIncl)}</td>
                      <td><span class="status-chip ${Admin.escapeAttr(doc.status || "draft")}">${Admin.escapeHtml(quoteStatusText(doc))}</span></td>
                    </tr>`
                  )
                  .join("")}</tbody>
              </table></div>`
            : `<p class="today-empty">No quotes yet.</p>`
        }
      </div>
      <div class="panel billing-dashboard-panel invoice-dashboard-panel">
        <div class="panel-head">
          <div>
            <p class="overline">INVOICE MONEY</p>
            <h2>Invoices</h2>
          </div>
          <a href="#invoices" data-billing="invoices">See all invoices →</a>
        </div>
        ${
          invoiceRows.length
            ? `<div class="dashboard-table-wrap"><table class="dashboard-money-table invoice-dashboard-table">
                <thead><tr><th>Invoice no</th><th>Date</th><th>Customer name</th><th>Invoice $</th><th>Payment made</th><th>Balance</th></tr></thead>
                <tbody>${invoiceRows
                  .map(
                    (doc) => `<tr data-open-billing="${Admin.escapeAttr(doc.id)}" data-billing-kind="invoice">
                      <td class="number-cell">${Admin.escapeHtml(doc.number || "—")}</td>
                      <td>${Admin.escapeHtml(formatListDate(doc.sortAt || doc.sentAt || doc.createdAt || doc.updatedAt))}</td>
                      <td>${Admin.escapeHtml(doc.customerName || "—")}</td>
                      <td class="money-cell">${money(doc.totalIncl)}</td>
                      <td class="money-cell paid-cell">${money(doc.amountPaid)}</td>
                      <td class="money-cell balance-cell">${money(doc.balanceDue)}</td>
                    </tr>`
                  )
                  .join("")}</tbody>
              </table></div>`
            : `<p class="today-empty">No invoices yet.</p>`
        }
      </div>
    </section>`;
  }

  function paintStepperStatus(row, status) {
    const stepper = row?.querySelector(".stepper");
    if (!stepper) return;
    const buttons = [...stepper.querySelectorAll("[data-job-status]")];
    const done = new Set(["in_progress"]);
    stepper.classList.toggle("parts", status === "waiting_parts");
    if (status === "waiting_parts") done.add("waiting_parts");
    if (status === "completed" || status === "collected") {
      done.add("waiting_parts");
      done.add("completed");
    }
    if (status === "collected") done.add("collected");
    buttons.forEach((btn) => {
      btn.classList.toggle("done", done.has(btn.dataset.jobStatus));
    });
  }

  async function updateJobStatus(id, status, button) {
    if (!id || !status) return;
    if (status === "collected" && !confirm("Mark this vehicle as collected and move it to job history?")) {
      return;
    }
    const previous = button?.textContent || "";
    paintStepperStatus(button?.closest(".job-row"), status);
    if (button) {
      button.disabled = true;
      button.textContent = "Saving";
    }
    try {
      await Admin.api(`/api/jobs/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      selectedBoardId = status === "collected" && selectedBoardId === id ? "" : selectedBoardId;
      await load(selectedFinancialYear, selectedActivityMonth);
    } catch (err) {
      alert(err.message || "Could not update job status.");
      if (button) {
        button.disabled = false;
        button.textContent = previous;
      }
    }
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
      <p class="muted small">Red bars include all invoices (drafts, sent, and converted quotes), GST-inclusive. Voided invoices are excluded. The blue line and values show payments received in each month.</p>
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
      const financial = data.financialHistory || {};
      selectedFinancialYear = String(financial.year || new Date().getFullYear());
      const nav = data.nav || {};
      setNavCount("nav-jobs-count", nav.jobs);
      setNavCount("nav-quotes-count", nav.quotes);
      setNavCount("nav-invoices-count", nav.invoices);
      const boardJobs = data.board?.jobs || [];
      const wofToday = data.wofToday || {};
      const activityItems = data.activity || [];
      if (!boardJobs.some((job) => job.id === selectedBoardId)) {
        selectedBoardId = boardJobs[0]?.id || "";
      }
      const selectedJob = boardJobs.find((job) => job.id === selectedBoardId) || boardJobs[0];
      root.innerHTML = `
        <section class="kpis" aria-label="Today's workshop status">
          <article class="kpi quote" data-billing="quotes">
            <span class="kpi-icon">↗</span>
            <p>QUOTES TO FOLLOW UP</p>
            <strong>${Number(quotes.count) || 0}</strong>
            <small>${money(quotes.totalIncl)} awaiting reply</small>
            <a href="#quotes">View quotes →</a>
          </article>
          <article class="kpi due" data-billing="invoices">
            <span class="kpi-icon">$</span>
            <p>PAYMENT DUE</p>
            <strong>${Number(invoices.count) || 0}</strong>
            <small>${money(invoices.totalIncl)} outstanding</small>
            <a href="#invoices">View invoices →</a>
          </article>
          <article class="kpi wof" data-jobs="active">
            <span class="kpi-icon">✓</span>
            <p>WOF TODAY</p>
            <strong>${Number(wofToday.count) || 0}</strong>
            <small>${Admin.escapeHtml(wofToday.nextLabel || "No WOF jobs on the board")}</small>
            <a href="#jobs">View bookings →</a>
          </article>
          <article class="kpi progress" data-jobs="in_progress">
            <span class="kpi-icon">↻</span>
            <p>IN PROGRESS</p>
            <strong>${Number(jobs.in_progress) || 0}</strong>
            <small>${Number(jobs.waiting_parts) || 0} waiting on parts</small>
            <a href="#jobs">Open job board →</a>
          </article>
        </section>
        <section class="layout">
          <div class="panel jobs-panel">
            <div class="panel-head">
              <div>
                <p class="overline">LIVE JOB BOARD</p>
                <h2>Vehicles in the workshop</h2>
              </div>
              <a href="#jobs" data-jobs="active">See all jobs →</a>
            </div>
            <div class="job-list">
              ${
                boardJobs.length
                  ? boardJobs.map((job) => boardRowHtml(job, job.id === selectedBoardId)).join("")
                  : `<p class="today-empty">No vehicles in the workshop. Saving an invoice creates a job card.</p>`
              }
            </div>
          </div>
          <aside class="panel activity-panel">
            <div class="panel-head">
              <div>
                <p class="overline">AT A GLANCE</p>
                <h2>Today’s activity</h2>
              </div>
            </div>
            ${
              activityItems.length
                ? `<ul class="activity">${activityItems
                    .map(
                      (item) => `<li>
                        <b class="${Admin.escapeAttr(item.tone || "blue")}">${Admin.escapeHtml(
                          item.icon || "•"
                        )}</b>
                        <p><strong>${Admin.escapeHtml(item.title || "")}</strong><br /><span>${Admin.escapeHtml(
                          item.detail || ""
                        )}</span></p>
                        <time>${Admin.escapeHtml(timeAgo(item.at, item.when))}</time>
                      </li>`
                    )
                    .join("")}</ul>`
                : `<p class="today-empty">Nothing new to show yet.</p>`
            }
          </aside>
        </section>
        <div id="today-detail-root">${detailHtml(selectedJob)}</div>
        <section class="dash-card dash-card-wide financial-history-card">
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
      `;
      root.querySelectorAll("[data-jobs]").forEach((el) => {
        el.addEventListener("click", (event) => {
          event.preventDefault();
          Admin.setSection("jobs");
          window.DeaneJobs?.showList?.({
            filter: el.dataset.jobs,
            year: el.dataset.jobYear || "",
            month: el.dataset.activityMonth || "",
          });
        });
      });
      root.querySelectorAll("[data-billing]").forEach((el) => {
        el.addEventListener("click", (event) => {
          event.preventDefault();
          if (el.dataset.openBilling) return;
          const key = el.dataset.billing;
          if (key === "quotes") {
            Admin.setSection("quotes");
            window.DeaneBilling?.showList?.({ kind: "quote", filter: "awaiting" });
            return;
          }
          Admin.setSection("invoices");
          window.DeaneBilling?.showList?.({
            kind: "invoice",
            filter: key === "overdue" ? "overdue" : "outstanding",
            month: el.dataset.activityMonth || "",
          });
        });
      });
      root.querySelectorAll("[data-open-billing]").forEach((row) => {
        row.addEventListener("click", () => {
          openBillingDoc(row.dataset.openBilling, row.dataset.billingKind);
        });
      });
      const bindOpenJob = (scope) => {
        scope.querySelectorAll("[data-open-job]").forEach((btn) => {
          btn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            openJobCard(btn.dataset.openJob);
          });
        });
      };
      root.querySelectorAll("[data-job-status]").forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const row = btn.closest("[data-job-id]");
          updateJobStatus(row?.dataset.jobId, btn.dataset.jobStatus, btn);
        });
      });
      root.querySelectorAll(".job-list .job-row").forEach((row) => {
        row.addEventListener("click", () => {
          selectedBoardId = row.dataset.jobId;
          root.querySelectorAll(".job-list .job-row").forEach((el) => {
            el.classList.toggle("selected", el.dataset.jobId === selectedBoardId);
          });
          const detailRoot = document.getElementById("today-detail-root");
          const job = boardJobs.find((item) => item.id === selectedBoardId);
          if (detailRoot) {
            detailRoot.innerHTML = detailHtml(job);
            bindOpenJob(detailRoot);
          }
        });
      });
      bindOpenJob(root);
      document.getElementById("financial-history-year")?.addEventListener("change", (event) => {
        selectedFinancialYear = event.target.value;
        financialWindowStart = null;
        load(selectedFinancialYear, selectedActivityMonth);
      });
      renderFinancialWindow(financial);
    } catch (err) {
      root.innerHTML = `<p class="error">${Admin.escapeHtml(err.message)}</p>`;
    }
  }

  function formatBackupWhen(iso) {
    return Admin.formatDateTimeShort(iso);
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
