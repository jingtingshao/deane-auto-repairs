(function () {
  const Admin = window.DeaneAdmin;
  const listEl = document.getElementById("reorder-list");
  const statusEl = document.getElementById("reorder-status");
  let suppliers = [];

  function qtyText(qty, unit) {
    const n = Number(qty);
    if (!Number.isFinite(n)) return "—";
    const text = Math.abs(n - Math.round(n)) < 0.0005 ? String(Math.round(n)) : String(n);
    return unit === "litre" ? `${text} L` : text;
  }

  function sinceText(iso) {
    if (!iso) return "Everything taken off the shelf so far.";
    const when = Admin.formatDateTimeShort(iso);
    return when ? `Since the last order, ${when}.` : "Since the last order.";
  }

  function showStatus(message) {
    if (!statusEl) return;
    statusEl.hidden = !message;
    statusEl.textContent = message || "";
  }

  function render() {
    if (!listEl) return;
    if (!suppliers.length) {
      listEl.innerHTML =
        '<p class="today-empty">Nothing to order yet. Parts show here after they are taken off the shelf for a job.</p>';
      return;
    }
    listEl.innerHTML = suppliers
      .map((row) => {
        const lines = Array.isArray(row.lines) ? row.lines : [];
        const body = lines.length
          ? `<div class="line-table-wrap"><table class="line-table reorder-table">
              <thead><tr><th>Part</th><th>Number</th><th>Used</th><th>On hand</th></tr></thead>
              <tbody>${lines
                .map(
                  (line) => `<tr>
                    <td>${Admin.escapeHtml(line.name || "Part")}</td>
                    <td>${Admin.escapeHtml(line.partNumber || "—")}</td>
                    <td><strong>${Admin.escapeHtml(qtyText(line.qtyUsed, line.unit))}</strong></td>
                    <td>${Admin.escapeHtml(line.qtyOnHand == null ? "—" : qtyText(line.qtyOnHand, line.unit))}</td>
                  </tr>`
                )
                .join("")}</tbody>
            </table></div>`
          : `<p class="muted small">Nothing used since this list was cleared.</p>`;
        return `<article class="reorder-card">
          <header>
            <div>
              <h2>${Admin.escapeHtml(row.supplier || "No supplier")}</h2>
              <p>${Admin.escapeHtml(sinceText(row.lastOrderedAt))}</p>
            </div>
            <button type="button" class="primary" data-reorder-clear="${Admin.escapeAttr(row.supplier || "")}" ${
              lines.length ? "" : "disabled"
            }>Ordered — clear</button>
          </header>
          ${body}
        </article>`;
      })
      .join("");
    listEl.querySelectorAll("[data-reorder-clear]").forEach((btn) => {
      btn.addEventListener("click", () => clearSupplier(btn.dataset.reorderClear, btn));
    });
  }

  async function load() {
    if (!listEl) return;
    showStatus("");
    listEl.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const data = await Admin.api("/api/reorder");
      suppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
      render();
    } catch (err) {
      listEl.innerHTML = `<p class="error">${Admin.escapeHtml(err.message || "Could not load the order list.")}</p>`;
    }
  }

  async function clearSupplier(supplier, button) {
    const name = String(supplier || "").trim();
    if (!name) return;
    if (!confirm(`Clear the order list for ${name}? Parts used after this show the next time they come. Stock on hand is not changed.`)) {
      return;
    }
    const previous = button?.textContent || "";
    if (button) {
      button.disabled = true;
      button.textContent = "Clearing…";
    }
    try {
      const data = await Admin.api("/api/reorder/clear", {
        method: "POST",
        body: JSON.stringify({ supplier: name }),
      });
      suppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
      render();
      showStatus(`${name} cleared. The list stays empty until those parts are used again.`);
    } catch (err) {
      alert(err.message || "Could not clear the order list.");
      if (button) {
        button.disabled = false;
        button.textContent = previous;
      }
    }
  }

  window.DeaneReorder = { show: load };
})();
