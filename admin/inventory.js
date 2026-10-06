(function () {
  const Admin = window.DeaneAdmin;

  const BANDS = [
    { max: 10, minPct: 100, maxPct: 150, label: "$0–$10" },
    { max: 25, minPct: 100, maxPct: 120, label: "$10–$25" },
    { max: 50, minPct: 80, maxPct: 100, label: "$25–$50" },
    { max: 100, minPct: 60, maxPct: 80, label: "$50–$100" },
    { max: 250, minPct: 50, maxPct: 60, label: "$100–$250" },
    { max: 500, minPct: 40, maxPct: 50, label: "$250–$500" },
    { max: null, minPct: 25, maxPct: 40, label: "$500+" },
  ];

  const GUESS_RULES = [
    ["adblue", "adblue"],
    ["ad blue", "adblue"],
    ["power steering", "power_steering"],
    ["brake fluid", "brake_fluid"],
    ["dot 4", "brake_fluid"],
    ["dot4", "brake_fluid"],
    ["dot 3", "brake_fluid"],
    ["atf", "atf"],
    ["transmission fluid", "atf"],
    ["coolant", "coolant"],
    ["antifreeze", "coolant"],
    ["engine oil", "engine_oil"],
    ["5w-30", "engine_oil"],
    ["5w30", "engine_oil"],
    ["5w-40", "engine_oil"],
    ["10w-40", "engine_oil"],
    ["10w40", "engine_oil"],
    ["0w-20", "engine_oil"],
    ["0w20", "engine_oil"],
    ["15w-40", "engine_oil"],
    ["cabin filter", "cabin_filter"],
    ["pollen filter", "cabin_filter"],
    ["air filter", "air_filter"],
    ["oil filter", "oil_filter"],
    ["spark plug", "spark_plug"],
    ["brake pad", "brake_pad"],
    ["disc pad", "brake_pad"],
    ["wiper", "wiper_blade"],
    ["battery", "battery"],
    ["belt", "belt"],
    ["bulb", "bulb"],
    ["globe", "bulb"],
    ["tyre", "tyre"],
    ["tire", "tyre"],
  ];

  let categories = [];
  let items = [];
  let categoryFilter = "";
  let editingId = "";
  let sellTouched = false;
  let receiveSellTouched = false;

  const searchEl = document.getElementById("stock-search");
  const listEl = document.getElementById("stock-list");
  const form = document.getElementById("stock-form");
  const catsEl = document.getElementById("stock-categories");
  const guideEl = document.getElementById("stock-price-guide");
  const statusEl = document.getElementById("stock-status");
  const receiveDialog = document.getElementById("stock-receive-dialog");
  const receiveForm = document.getElementById("stock-receive-form");
  const receiveGuide = document.getElementById("stock-receive-guide");

  function money(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "$0.00";
    return `$${n.toFixed(2)}`;
  }

  function formatQty(value, unit) {
    const n = Math.round((Number(value) || 0) * 1000) / 1000;
    const text = String(n);
    return unit === "litre" ? `${text} L` : text;
  }

  function suggestPrice(cost) {
    const c = Math.round(Math.max(0, Number(cost) || 0) * 100) / 100;
    const band = BANDS.find((row) => row.max == null || c <= row.max) || BANDS[BANDS.length - 1];
    const sellMin = c > 0 ? Math.round(c * (1 + band.minPct / 100) * 100) / 100 : 0;
    const sellMax = c > 0 ? Math.round(c * (1 + band.maxPct / 100) * 100) / 100 : 0;
    const incl = (amount) => Math.round((amount * 1.15 + Number.EPSILON) * 100) / 100;
    return {
      cost: c,
      band: band.label,
      markupMin: band.minPct,
      markupMax: band.maxPct,
      sellMin,
      sellMax,
      sell: sellMin,
      sellMinIncl: incl(sellMin),
      sellMaxIncl: incl(sellMax),
      sellIncl: incl(sellMin),
    };
  }

  function guessCategory(text) {
    const hay = String(text || "").toLowerCase();
    for (const [needle, id] of GUESS_RULES) {
      if (hay.includes(needle)) return id;
    }
    return "";
  }

  function categoryById(id) {
    return categories.find((row) => row.id === id) || null;
  }

  function flash(msg) {
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = msg;
      setTimeout(() => {
        if (statusEl.textContent === msg) statusEl.hidden = true;
      }, 2800);
    }
    const invoiceStatus = document.getElementById("supplier-invoice-save-status");
    const invoiceOpen = document.getElementById("supplier-invoices-section");
    if (invoiceStatus && invoiceOpen && !invoiceOpen.hidden) {
      invoiceStatus.hidden = false;
      invoiceStatus.textContent = msg;
    }
  }

  function guideText(cost, sell) {
    const guide = suggestPrice(cost);
    const chosen = Number(sell);
    const sellPrice = Number.isFinite(chosen) ? Math.round(chosen * 100) / 100 : guide.sell;
    const incl = Math.round(sellPrice * 1.15 * 100) / 100;
    if (!(guide.cost > 0)) return "Enter the supplier cost to see the suggested sell price.";
    const unit = currentUnit() === "litre" ? " per litre" : "";
    return `Markup ${guide.markupMin}–${guide.markupMax}% (${guide.band}). Suggested sell ${money(guide.sellMin)}–${money(guide.sellMax)} ex GST${unit} (${money(guide.sellMinIncl)}–${money(guide.sellMaxIncl)} incl). This sell price is ${money(sellPrice)} ex GST, ${money(incl)} incl.`;
  }

  function currentUnit() {
    const id = form?.elements?.category?.value || "";
    return categoryById(id)?.unit || "each";
  }

  function fillCategorySelect(select, selected) {
    if (!select) return;
    const groups = [
      ["Parts", categories.filter((row) => row.unit !== "litre")],
      ["Fluids (per litre)", categories.filter((row) => row.unit === "litre")],
    ];
    select.innerHTML =
      `<option value="">Choose</option>` +
      groups
        .map(
          ([label, rows]) =>
            `<optgroup label="${Admin.escapeAttr(label)}">${rows
              .map(
                (row) =>
                  `<option value="${Admin.escapeAttr(row.id)}"${row.id === selected ? " selected" : ""}>${Admin.escapeHtml(row.label)}</option>`
              )
              .join("")}</optgroup>`
        )
        .join("");
  }

  function renderGuide() {
    if (!guideEl || !form) return;
    guideEl.textContent = guideText(form.elements.costPrice.value, form.elements.sellPrice.value);
    const unit = currentUnit();
    const qtyLabel = form.querySelector("[data-qty-label]");
    const costLabel = form.querySelector("[data-cost-label]");
    if (qtyLabel) qtyLabel.textContent = unit === "litre" ? "Litres on hand" : "Qty on hand";
    if (costLabel) costLabel.textContent = unit === "litre" ? "Cost per litre ex GST" : "Cost ex GST";
    const sellLabel = form.querySelector("[data-sell-label]");
    if (sellLabel) sellLabel.textContent = unit === "litre" ? "Sell per litre ex GST" : "Sell price ex GST";
    const qty = form.elements.qtyOnHand;
    if (qty) qty.step = unit === "litre" ? "0.1" : "1";
  }

  function renderReceiveGuide() {
    if (!receiveGuide || !receiveForm) return;
    const unit = categoryById(receiveForm.elements.category.value)?.unit || "each";
    const text = guideText(receiveForm.elements.costPrice.value, receiveForm.elements.sellPrice.value);
    receiveGuide.textContent = unit === "litre" ? text.replace(" ex GST", " per litre ex GST") : text;
  }

  async function loadMeta() {
    const meta = await Admin.api("/api/inventory/meta");
    categories = Array.isArray(meta.categories) ? meta.categories : [];
    fillCategorySelect(form?.elements?.category, form?.elements?.category?.value || "");
    fillCategorySelect(receiveForm?.elements?.category, receiveForm?.elements?.category?.value || "");
    renderCategoryChips();
  }

  async function loadSuppliers() {
    const names = await Admin.api("/api/inventory/suppliers");
    const list = document.getElementById("stock-suppliers");
    if (!list || !Array.isArray(names)) return;
    list.innerHTML = names
      .map((name) => `<option value="${Admin.escapeAttr(name)}"></option>`)
      .join("");
  }

  function renderCategoryChips() {
    if (!catsEl) return;
    const chips = [{ id: "", label: "All" }, ...categories];
    catsEl.innerHTML = chips
      .map(
        (row) =>
          `<button type="button" class="ghost${row.id === categoryFilter ? " is-active" : ""}" data-cat="${Admin.escapeAttr(row.id)}">${Admin.escapeHtml(row.label)}</button>`
      )
      .join("");
    catsEl.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        categoryFilter = btn.dataset.cat || "";
        renderCategoryChips();
        renderList();
      });
    });
  }

  function visibleItems() {
    const q = String(searchEl?.value || "").trim().toLowerCase();
    return items.filter((item) => {
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (!q) return true;
      const hay = [item.name, item.partNumber, item.brand, item.supplier, item.fitment, item.notes, item.categoryLabel]
        .join(" ")
        .toLowerCase();
      return q.split(/\s+/).every((term) => hay.includes(term));
    });
  }

  function renderList() {
    if (!listEl) return;
    const rows = visibleItems();
    if (!rows.length) {
      listEl.innerHTML = `<p class="muted">No stock yet. Add a part, or open a supplier invoice and choose Add to stock.</p>`;
      return;
    }
    listEl.innerHTML = `<div class="line-table-wrap"><table class="line-table stock-table">
      <thead>
        <tr>
          <th>Category</th>
          <th>Part</th>
          <th>Supplier</th>
          <th>On hand</th>
          <th>Cost</th>
          <th>Suggested sell</th>
          <th>Sell ex GST</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((item) => {
            const price = item.price || suggestPrice(item.costPrice);
            const unit = item.unit === "litre" ? " / L" : "";
            const fit = [item.partNumber, item.fitment].filter(Boolean).join(" · ");
            return `<tr data-id="${Admin.escapeAttr(item.id)}">
              <td>${Admin.escapeHtml(item.categoryLabel || "")}</td>
              <td><strong>${Admin.escapeHtml(item.name)}</strong>${fit ? `<div class="muted small">${Admin.escapeHtml(fit)}</div>` : ""}</td>
              <td>${Admin.escapeHtml(item.supplier || "—")}</td>
              <td>${Admin.escapeHtml(formatQty(item.qtyOnHand, item.unit))}</td>
              <td>${money(item.costPrice)}${unit}</td>
              <td>${money(price.sellMin)}–${money(price.sellMax)}</td>
              <td><strong>${money(item.sellPrice)}${unit}</strong><div class="muted small">${money(Math.round(item.sellPrice * 1.15 * 100) / 100)} incl</div></td>
              <td class="supplier-line-actions">
                <button type="button" class="ghost" data-edit="${Admin.escapeAttr(item.id)}">Edit</button>
                <button type="button" class="ghost" data-use="${Admin.escapeAttr(item.id)}"${item.qtyOnHand > 0 ? "" : " disabled"}>${item.unit === "litre" ? "Use 1 L" : "Use 1"}</button>
              </td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table></div>`;
    listEl.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openEditor(btn.dataset.edit));
    });
    listEl.querySelectorAll("[data-use]").forEach((btn) => {
      btn.addEventListener("click", () => useOne(btn.dataset.use));
    });
  }

  function openEditor(id) {
    const item = id ? items.find((row) => row.id === id) : null;
    editingId = item?.id || "";
    sellTouched = Boolean(item);
    if (!form) return;
    form.hidden = false;
    form.elements.name.value = item?.name || "";
    form.elements.partNumber.value = item?.partNumber || "";
    form.elements.brand.value = item?.brand || "";
    form.elements.supplier.value = item?.supplier || "";
    form.elements.fitment.value = item?.fitment || "";
    form.elements.qtyOnHand.value = item ? String(item.qtyOnHand) : "0";
    form.elements.costPrice.value = item ? String(item.costPrice) : "";
    form.elements.sellPrice.value = item ? String(item.sellPrice) : "";
    form.elements.notes.value = item?.notes || "";
    fillCategorySelect(form.elements.category, item?.category || "");
    const title = document.getElementById("stock-form-legend");
    if (title) title.textContent = item ? "Edit stock" : "Add part";
    const del = document.getElementById("btn-stock-delete");
    if (del) del.hidden = !item;
    renderGuide();
    form.elements.name.focus();
  }

  function closeEditor() {
    editingId = "";
    if (form) form.hidden = true;
  }

  async function refresh() {
    items = await Admin.api(
      `/api/inventory${categoryFilter ? `?category=${encodeURIComponent(categoryFilter)}` : ""}`
    );
    if (searchEl?.value.trim()) {
      items = await Admin.api("/api/inventory");
    }
    renderList();
  }

  async function show() {
    try {
      if (!categories.length) await loadMeta();
      await loadSuppliers();
      items = await Admin.api("/api/inventory");
      renderList();
    } catch (err) {
      flash(err.message);
    }
  }

  async function useOne(id) {
    const item = items.find((row) => row.id === id);
    if (!item) return;
    const label = item.unit === "litre" ? "1 L" : "1";
    if (!confirm(`Take ${label} of ${item.name} off the shelf?`)) return;
    try {
      await Admin.api(`/api/inventory/${id}/adjust`, {
        method: "POST",
        body: JSON.stringify({ qtyDelta: -1, note: "Used" }),
      });
      await show();
      flash(`${item.name} updated.`);
    } catch (err) {
      alert(err.message);
    }
  }

  function renderPicks(results, rows, onPick) {
    if (!results) return;
    if (!rows.length) {
      results.hidden = false;
      results.innerHTML = `<p class="muted small stock-result-empty">No matching stock.</p>`;
      return;
    }
    results.hidden = false;
    results.innerHTML = rows
      .slice(0, 8)
      .map((item, index) => {
        const price = item.price || suggestPrice(item.costPrice);
        const unit = item.unit === "litre" ? " / L" : "";
        const meta = [item.partNumber, item.fitment, item.supplier, formatQty(item.qtyOnHand, item.unit) + " on hand"]
          .filter(Boolean)
          .join(" · ");
        return `<button type="button" class="stock-result" data-pick="${index}">
          <span><strong>${Admin.escapeHtml(item.name)}</strong><span class="muted small">${Admin.escapeHtml(meta)}</span></span>
          <span class="stock-sell"><strong>${money(item.sellPrice)}${unit}</strong><span class="muted small">suggested ${money(price.sellMin)}–${money(price.sellMax)} ex GST</span></span>
        </button>`;
      })
      .join("");
    results.querySelectorAll("[data-pick]").forEach((btn) => {
      btn.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const item = rows[Number(btn.dataset.pick)];
        if (!item) return;
        onPick(item);
        results.hidden = true;
        results.innerHTML = "";
      });
    });
  }

  const searchTimers = new WeakMap();

  function bindStockSearch(input, results, onPick) {
    if (!input || !results || input.dataset.stockBound) return;
    input.dataset.stockBound = "1";
    const run = async () => {
      const q = input.value.trim();
      if (q.length < 2) {
        results.hidden = true;
        results.innerHTML = "";
        return;
      }
      try {
        const rows = await Admin.api(`/api/inventory?q=${encodeURIComponent(q)}`);
        renderPicks(results, rows, (item) => {
          input.value = "";
          onPick(item);
        });
      } catch (err) {
        results.hidden = false;
        results.innerHTML = `<p class="muted small stock-result-empty">${Admin.escapeHtml(err.message)}</p>`;
      }
    };
    input.addEventListener("input", () => {
      clearTimeout(searchTimers.get(input));
      searchTimers.set(input, setTimeout(run, 180));
    });
  }

  async function openReceive(prefill = {}) {
    if (!receiveDialog || !receiveForm) return;
    if (!categories.length) {
      try {
        await loadMeta();
      } catch (err) {
        alert(err.message);
        return;
      }
    }
    receiveSellTouched = false;
    const name = String(prefill.name || "").trim();
    const guessed = prefill.category || guessCategory(`${name} ${prefill.partNumber || ""}`);
    fillCategorySelect(receiveForm.elements.category, guessed);
    receiveForm.elements.name.value = name;
    receiveForm.elements.partNumber.value = prefill.partNumber || "";
    receiveForm.elements.supplier.value = prefill.supplier || "";
    receiveForm.elements.fitment.value = prefill.fitment || "";
    receiveForm.elements.qty.value = prefill.qty != null ? String(prefill.qty) : "1";
    receiveForm.elements.costPrice.value = prefill.costPrice != null ? String(prefill.costPrice) : "";
    receiveForm.elements.candidateId.value = prefill.candidateId || "";
    receiveForm.elements.supplierInvoiceId.value = prefill.supplierInvoiceId || "";
    receiveForm.elements.invoiceNo.value = prefill.invoiceNo || "";
    const guide = suggestPrice(prefill.costPrice);
    receiveForm.elements.sellPrice.value = guide.sell ? guide.sell.toFixed(2) : "";
    const summary = document.getElementById("stock-receive-summary");
    if (summary) {
      const bits = [prefill.supplier, prefill.invoiceNo ? `Invoice ${prefill.invoiceNo}` : ""].filter(Boolean);
      summary.textContent = prefill.already
        ? "This invoice line is already in stock. Adding it again will not increase the quantity."
        : `${bits.join(" · ")}${bits.length ? ". " : ""}Qty is what goes on the shelf. If this line is a whole box, type how many pieces are in the box.`;
    }
    receiveDialog.hidden = false;
    renderReceiveGuide();
    if (!guessed) receiveForm.elements.category.focus();
  }

  function closeReceive() {
    if (receiveDialog) receiveDialog.hidden = true;
  }

  form?.elements?.category?.addEventListener("change", renderGuide);
  form?.elements?.costPrice?.addEventListener("input", () => {
    const guide = suggestPrice(form.elements.costPrice.value);
    if (!sellTouched) form.elements.sellPrice.value = guide.sell ? guide.sell.toFixed(2) : "";
    renderGuide();
  });
  form?.elements?.sellPrice?.addEventListener("input", () => {
    sellTouched = true;
    renderGuide();
  });

  document.getElementById("btn-stock-add")?.addEventListener("click", () => openEditor(""));
  document.getElementById("btn-stock-cancel")?.addEventListener("click", closeEditor);
  document.getElementById("btn-stock-delete")?.addEventListener("click", async () => {
    if (!editingId) return;
    const item = items.find((row) => row.id === editingId);
    if (!confirm(`Delete ${item?.name || "this part"} from stock?`)) return;
    try {
      await Admin.api(`/api/inventory/${editingId}`, { method: "DELETE" });
      closeEditor();
      await show();
      flash("Deleted from stock.");
    } catch (err) {
      alert(err.message);
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      category: form.elements.category.value,
      name: form.elements.name.value.trim(),
      partNumber: form.elements.partNumber.value.trim(),
      brand: form.elements.brand.value.trim(),
      supplier: form.elements.supplier.value.trim(),
      fitment: form.elements.fitment.value.trim(),
      qtyOnHand: Number(form.elements.qtyOnHand.value) || 0,
      costPrice: Number(form.elements.costPrice.value) || 0,
      sellPrice: Number(form.elements.sellPrice.value) || 0,
      notes: form.elements.notes.value.trim(),
    };
    if (!body.category) {
      alert("Choose a category.");
      return;
    }
    if (!body.name) {
      alert("Enter a part name.");
      return;
    }
    try {
      if (editingId) {
        await Admin.api(`/api/inventory/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      } else {
        await Admin.api("/api/inventory", { method: "POST", body: JSON.stringify(body) });
      }
      closeEditor();
      await show();
      flash("Stock saved.");
    } catch (err) {
      alert(err.message);
    }
  });

  searchEl?.addEventListener("input", renderList);

  receiveForm?.elements?.category?.addEventListener("change", renderReceiveGuide);
  receiveForm?.elements?.costPrice?.addEventListener("input", () => {
    const guide = suggestPrice(receiveForm.elements.costPrice.value);
    if (!receiveSellTouched) receiveForm.elements.sellPrice.value = guide.sell ? guide.sell.toFixed(2) : "";
    renderReceiveGuide();
  });
  receiveForm?.elements?.sellPrice?.addEventListener("input", () => {
    receiveSellTouched = true;
    renderReceiveGuide();
  });
  document.getElementById("btn-stock-receive-cancel")?.addEventListener("click", closeReceive);
  receiveDialog?.addEventListener("click", (event) => {
    if (event.target === receiveDialog) closeReceive();
  });
  receiveForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      category: receiveForm.elements.category.value,
      name: receiveForm.elements.name.value.trim(),
      partNumber: receiveForm.elements.partNumber.value.trim(),
      supplier: receiveForm.elements.supplier.value.trim(),
      fitment: receiveForm.elements.fitment.value.trim(),
      qty: Number(receiveForm.elements.qty.value) || 0,
      costPrice: Number(receiveForm.elements.costPrice.value) || 0,
      sellPrice: Number(receiveForm.elements.sellPrice.value) || 0,
      candidateId: receiveForm.elements.candidateId.value,
      supplierInvoiceId: receiveForm.elements.supplierInvoiceId.value,
      invoiceNo: receiveForm.elements.invoiceNo.value,
      note: receiveForm.elements.invoiceNo.value
        ? `Invoice ${receiveForm.elements.invoiceNo.value}`
        : "Received",
    };
    if (!body.category) {
      alert("Choose a category. Handwritten lines need a category before they go into stock.");
      return;
    }
    try {
      const result = await Admin.api("/api/inventory/receive", {
        method: "POST",
        body: JSON.stringify(body),
      });
      closeReceive();
      if (!document.getElementById("stock-section")?.hidden) await show();
      if (body.candidateId) window.DeaneSupplierInvoices?.markLineStocked?.(body.candidateId);
      flash(
        result.already
          ? "That invoice line is already in stock."
          : `${result.item?.name || "Part"} added to stock at ${money(result.item?.sellPrice)} ex GST.`
      );
    } catch (err) {
      alert(err.message);
    }
  });

  bindStockSearch(
    document.getElementById("job-stock-search"),
    document.getElementById("job-stock-results"),
    (item) => window.DeaneJobs?.addPartFromStock?.(item)
  );
  bindStockSearch(
    document.getElementById("billing-stock-search"),
    document.getElementById("billing-stock-results"),
    (item) => window.DeaneBilling?.addLineFromStock?.(item)
  );

  window.DeaneInventory = {
    suggestPrice,
    show,
    openReceive,
    bindStockSearch,
  };
})();
