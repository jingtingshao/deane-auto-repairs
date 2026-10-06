(function () {
  const Admin = window.DeaneAdmin;
  const EARLIER_LIMIT = 8;
  const SUFFIXES = new Set(["ltd", "limited", "pty", "inc", "co", "company", "nz", "nzl"]);

  const listView = document.getElementById("suppliers-list-view");
  const detailView = document.getElementById("suppliers-detail-view");
  const listEl = document.getElementById("suppliers-list");
  const detailEl = document.getElementById("suppliers-detail");
  const searchEl = document.getElementById("suppliers-search");
  const statusEl = document.getElementById("suppliers-status");

  let suppliers = [];
  let statusTimer = null;

  function showStatus(msg) {
    if (!statusEl) return;
    statusEl.hidden = !msg;
    statusEl.textContent = msg || "";
    if (statusTimer) clearTimeout(statusTimer);
    if (!msg) return;
    statusTimer = setTimeout(() => {
      statusEl.hidden = true;
    }, 2800);
  }

  function money(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  function formatMoney(value) {
    return `$${money(value).toFixed(2)}`;
  }

  function supplierGroupKey(value) {
    let name = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[.'’]/g, "");
    name = name.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
    if (!name) return "";
    let parts = name.split(/\s+/).filter(Boolean);
    while (parts.length > 1) {
      const last = parts[parts.length - 1];
      const prev = parts[parts.length - 2];
      if (last === "zealand" && prev === "new") {
        parts = parts.slice(0, -2);
        continue;
      }
      if (SUFFIXES.has(last)) {
        parts.pop();
        continue;
      }
      break;
    }
    return parts.join(" ");
  }

  function invoiceWhen(row) {
    const date = String(row?.invoiceDate || "").trim().slice(0, 10);
    const stamp = String(row?.createdAt || row?.updatedAt || "").trim();
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "0000-00-00";
    return `${day}T${stamp}`;
  }

  function visibleLines(row) {
    return (row?.searchLines || []).filter((line) => String(line?.decision || "") !== "rejected");
  }

  function groupSuppliers(rows) {
    const groups = new Map();
    for (const row of rows || []) {
      const key = supplierGroupKey(row?.supplier);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const list = [];
    for (const [key, group] of groups) {
      group.sort((a, b) => invoiceWhen(b).localeCompare(invoiceWhen(a)));
      const latest = group[0];
      const lines = visibleLines(latest);
      list.push({
        key,
        name: String(latest.supplier || "").trim() || key,
        names: group.map((row) => String(row.supplier || "").trim()).filter(Boolean),
        invoices: group,
        latest,
        lineCount: lines.length,
        invoiceCount: group.length,
      });
    }
    list.sort((a, b) => invoiceWhen(b.latest).localeCompare(invoiceWhen(a.latest)) || a.name.localeCompare(b.name));
    return list;
  }

  function matchesQuery(supplier, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    return supplier.names.some((name) => name.toLowerCase().includes(q)) || supplier.name.toLowerCase().includes(q);
  }

  function dateLabel(value) {
    return Admin.formatDateShort(value) || "No date";
  }

  function invoiceSummary(row, lineCount) {
    const number = String(row?.invoiceNo || "").trim() || "No invoice #";
    const count = Number(lineCount);
    const lines = Number.isFinite(count) ? count : visibleLines(row).length;
    return `Invoice ${number} · ${formatMoney(row?.total)} · ${lines} line${lines === 1 ? "" : "s"}`;
  }

  function renderList() {
    if (!listEl) return;
    const query = searchEl?.value || "";
    const filtered = suppliers.filter((row) => matchesQuery(row, query));
    if (!suppliers.length) {
      listEl.innerHTML = '<div class="empty">No suppliers yet. Save a parts invoice and the supplier appears here.</div>';
      return;
    }
    if (!filtered.length) {
      listEl.innerHTML = '<div class="empty">No matching supplier.</div>';
      return;
    }
    listEl.innerHTML = filtered
      .map((row) => {
        const countLabel = `${row.invoiceCount} invoice${row.invoiceCount === 1 ? "" : "s"}`;
        return `<article class="report-card billing-card" data-supplier-key="${Admin.escapeAttr(row.key)}">
          <div class="billing-number">${Admin.escapeHtml(dateLabel(row.latest.invoiceDate))}</div>
          <div>
            <h2>${Admin.escapeHtml(row.name)}</h2>
            <p class="muted">Last delivery · ${Admin.escapeHtml(invoiceSummary(row.latest, row.lineCount))}</p>
          </div>
          <span class="badge">${Admin.escapeHtml(countLabel)}</span>
        </article>`;
      })
      .join("");
    listEl.querySelectorAll("[data-supplier-key]").forEach((card) => {
      card.addEventListener("click", () => openSupplier(card.dataset.supplierKey));
    });
  }

  function lineRows(lines) {
    if (!lines.length) {
      return `<p class="muted small">No parts on this invoice.</p>`;
    }
    const body = lines
      .map((line) => {
        const name = String(line.description || "").trim() || "Part";
        const number = String(line.partNumber || "").trim() || "—";
        const qty = Number(line.qty) || 0;
        return `<tr>
          <td>${Admin.escapeHtml(name)}</td>
          <td>${Admin.escapeHtml(number)}</td>
          <td class="qty">${Admin.escapeHtml(String(qty))}</td>
          <td class="price">${Admin.escapeHtml(formatMoney(line.cost))}</td>
        </tr>`;
      })
      .join("");
    return `<div class="line-table-wrap">
      <table class="line-table">
        <thead>
          <tr>
            <th>Part name</th>
            <th>Part number</th>
            <th>Qty</th>
            <th>Cost ex GST</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  }

  function renderDetail(supplier) {
    if (!detailEl) return;
    const latest = supplier.latest;
    const lines = visibleLines(latest);
    const earlier = supplier.invoices.slice(1, 1 + EARLIER_LIMIT);
    const hiddenEarlier = Math.max(0, supplier.invoices.length - 1 - earlier.length);
    const earlierHtml = earlier.length
      ? earlier
          .map((row) => {
            return `<article class="report-card billing-card" data-invoice-id="${Admin.escapeAttr(row.id)}">
              <div class="billing-number">${Admin.escapeHtml(dateLabel(row.invoiceDate))}</div>
              <div>
                <h2>${Admin.escapeHtml(String(row.invoiceNo || "").trim() || "No invoice #")}</h2>
                <p class="muted">${Admin.escapeHtml(formatMoney(row.total))} · ${Admin.escapeHtml(String(visibleLines(row).length))} line${visibleLines(row).length === 1 ? "" : "s"}</p>
              </div>
            </article>`;
          })
          .join("")
      : `<p class="muted small">No earlier deliveries.</p>`;
    const more =
      hiddenEarlier > 0
        ? `<p class="muted small">+ ${hiddenEarlier} earlier invoice${hiddenEarlier === 1 ? "" : "s"}.</p>`
        : "";
    detailEl.innerHTML = `
      <div class="supplier-detail-block">
        <h2>Last delivery</h2>
        <div class="supplier-detail-meta">
          <p class="muted">${Admin.escapeHtml(dateLabel(latest.invoiceDate))} · ${Admin.escapeHtml(invoiceSummary(latest, lines.length))}</p>
          <button type="button" class="ghost" id="btn-supplier-open-invoice">Open invoice</button>
        </div>
        ${lineRows(lines)}
      </div>
      <div class="supplier-detail-block">
        <h2>Earlier deliveries</h2>
        <div class="report-list">${earlierHtml}</div>
        ${more}
      </div>`;
    detailEl.querySelector("#btn-supplier-open-invoice")?.addEventListener("click", () => {
      openInvoice(latest.id);
    });
    detailEl.querySelectorAll("[data-invoice-id]").forEach((card) => {
      card.addEventListener("click", () => openInvoice(card.dataset.invoiceId));
    });
  }

  function showListView() {
    if (listView) listView.hidden = false;
    if (detailView) detailView.hidden = true;
    Admin.setViewTitle("Suppliers");
  }

  function openSupplier(key) {
    const supplier = suppliers.find((row) => row.key === key);
    if (!supplier) return;
    if (listView) listView.hidden = true;
    if (detailView) detailView.hidden = false;
    Admin.setViewTitle(supplier.name);
    renderDetail(supplier);
  }

  async function openInvoice(id) {
    if (!id || !window.DeaneSupplierInvoices?.openInvoice) {
      showStatus("Could not open that invoice.");
      return;
    }
    try {
      await window.DeaneSupplierInvoices.openInvoice(id);
    } catch (err) {
      showStatus(err?.message || "Could not open that invoice.");
    }
  }

  async function showList() {
    showStatus("");
    showListView();
    try {
      suppliers = groupSuppliers(await Admin.api("/api/supplier-invoices"));
      renderList();
    } catch (err) {
      if (listEl) listEl.innerHTML = '<div class="empty">Could not load suppliers.</div>';
      showStatus(err?.message || "Could not load suppliers.");
    }
  }

  searchEl?.addEventListener("input", renderList);
  searchEl?.addEventListener("search", renderList);
  document.getElementById("btn-suppliers-back")?.addEventListener("click", () => {
    showListView();
    renderList();
  });

  window.DeaneSuppliers = {
    showList,
    supplierGroupKey,
    groupSuppliers,
  };
})();
