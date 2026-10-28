(function () {
  const Admin = window.DeaneAdmin;

  const statusEl = document.getElementById("tyre-prices-status");
  const searchEl = document.getElementById("tyre-size-search");
  const summaryEl = document.getElementById("tyre-search-summary");
  const resultsEl = document.getElementById("tyre-search-results");
  const tierFiltersEl = document.getElementById("tyre-tier-filters");
  const settingsForm = document.getElementById("tyre-settings-form");
  const markupEl = document.getElementById("tyre-markup");
  const fittingEl = document.getElementById("tyre-fitting");
  const tyrewiseEl = document.getElementById("tyre-tyrewise");
  const publishInfoEl = document.getElementById("tyre-publish-info");
  const publishBtn = document.getElementById("btn-tyre-publish");
  const dataInfoEl = document.getElementById("tyre-data-info");
  const uploadBtn = document.getElementById("btn-tyre-upload");
  const uploadInput = document.getElementById("tyre-upload-input");

  let meta = null;
  let lastResult = null;
  let tierFilter = "all";
  let searchTimer = null;
  let statusTimer = null;

  function showStatus(msg) {
    if (!statusEl) return;
    statusEl.hidden = !msg;
    statusEl.textContent = msg || "";
    if (statusTimer) clearTimeout(statusTimer);
    if (msg) statusTimer = setTimeout(() => (statusEl.hidden = true), 4000);
  }

  function money(value, decimals = 2) {
    if (value === null || value === undefined || value === "") return "—";
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return `$${n.toLocaleString("en-NZ", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  }

  function settingsLabel(s) {
    if (!s) return "";
    return `markup ${s.markupPct}%, fitting ${money(s.fittingIncl, 0)}, Tyrewise ${s.includeTyrewise ? "included" : "left out"}`;
  }

  function sameSettings(a, b) {
    return (
      a && b &&
      Number(a.markupPct) === Number(b.markupPct) &&
      Number(a.fittingIncl) === Number(b.fittingIncl) &&
      Boolean(a.includeTyrewise) === Boolean(b.includeTyrewise)
    );
  }

  function renderPublishInfo() {
    if (!publishInfoEl || !meta) return;
    const p = meta.published;
    if (publishBtn) publishBtn.disabled = !meta.rowCount;
    if (!p) {
      publishInfoEl.textContent = "Not published yet. The website shows the built-in price list until you publish.";
      return;
    }
    const stale =
      !sameSettings(p.settings, meta.settings) || (meta.scrapedOn && p.scrapedOn !== meta.scrapedOn)
        ? " Settings or price data have changed since then — publish again to update the website."
        : "";
    publishInfoEl.textContent =
      `Website prices published ${Admin.formatDateTimeShort(p.at)} (${p.sizes} sizes, ${settingsLabel(p.settings)}, supplier prices from ${Admin.formatDateShort(p.scrapedOn)}).${stale}`;
  }

  function renderMeta() {
    if (!meta) return;
    renderPublishInfo();
    const s = meta.settings;
    if (markupEl) markupEl.value = s.markupPct;
    if (fittingEl) fittingEl.value = s.fittingIncl;
    if (tyrewiseEl) tyrewiseEl.value = s.includeTyrewise ? "yes" : "no";
    if (dataInfoEl) {
      const sources = (meta.sources || [])
        .map((src) => `${src.supplier} ${src.count}`)
        .join(" · ");
      dataInfoEl.textContent = meta.rowCount
        ? `${meta.rowCount.toLocaleString("en-NZ")} tyres, supplier prices from ${Admin.formatDateShort(meta.scrapedOn)}. ${sources}. A reminder email goes out every Monday at 8am; uploading new data emails you any price changes.`
        : "No price data yet. Upload tyre-price-data.json from the price list folder on the office computer.";
    }
  }

  async function loadMeta() {
    try {
      meta = await Admin.api("/api/tyre-prices/meta");
      renderMeta();
    } catch (err) {
      showStatus(err?.message || "Could not load tyre prices.");
    }
  }

  function renderSizeChoices(data) {
    const sizes = data.sizes;
    const shown = sizes.slice(0, 80);
    if (summaryEl) {
      summaryEl.textContent = `${sizes.length} sizes match "${data.size}". Pick one.${sizes.length > shown.length ? " Type more of the size to narrow it down." : ""}`;
    }
    resultsEl.innerHTML = `<div class="parts-guide-filters">${shown
      .map((s) => {
        const from = s.fromPrice ? ` · from ${money(s.fromPrice, 0)}` : "";
        return `<button type="button" class="ghost" data-tyre-size="${Admin.escapeAttr(s.size)}">${Admin.escapeHtml(s.size)} <small class="muted">${s.count} tyres${from}</small></button>`;
      })
      .join("")}</div>`;
    resultsEl.querySelectorAll("[data-tyre-size]").forEach((btn) => {
      btn.addEventListener("click", () => {
        searchEl.value = btn.dataset.tyreSize;
        runSearch();
      });
    });
  }

  function renderResults(data) {
    if (!resultsEl) return;
    lastResult = data;
    const all = data?.rows || [];
    if (!all.length && data?.sizes?.length) {
      renderSizeChoices(data);
      return;
    }
    if (!all.length) {
      if (summaryEl) summaryEl.textContent = "";
      resultsEl.innerHTML = `<div class="empty">No tyres found for ${Admin.escapeHtml(data?.size || "that size")}.</div>`;
      return;
    }
    const rows = tierFilter === "all" ? all : all.filter((r) => r.tier === tierFilter);
    const inStock = rows.filter((r) => r.inStock).length;
    const tierNote = tierFilter === "all" ? "" : ` ${tierFilter} only.`;
    if (summaryEl) {
      summaryEl.textContent = `${data.size}: ${rows.length} tyres, ${inStock} in stock.${tierNote} Sell price is per tyre, fitted, incl GST.`;
    }
    if (!rows.length) {
      resultsEl.innerHTML = `<div class="empty">No ${Admin.escapeHtml(tierFilter)} tyres in ${Admin.escapeHtml(data.size)}.</div>`;
      return;
    }
    const body = rows
      .map((r) => {
        const cost = r.special
          ? `${money(r.costEx)} <span class="badge pay-overdue">Special</span><br /><small class="muted">Usual ${money(r.usualEx)}</small>`
          : money(r.costEx);
        const best =
          (r.cheapestInTier ? ' <span class="badge published">Cheapest</span>' : "") +
          (r.onWebsite ? ' <span class="badge quote">On website</span>' : "");
        return `<tr${r.inStock ? "" : ' class="muted"'}>
          <td><strong>${Admin.escapeHtml(r.brand)}</strong> ${Admin.escapeHtml(r.pattern || "")}<br /><small class="muted">${Admin.escapeHtml(r.description || "")}</small></td>
          <td>${Admin.escapeHtml(r.tier)}${best}</td>
          <td>${Admin.escapeHtml(r.loadSpeed)}</td>
          <td>${Admin.escapeHtml(r.supplier)}</td>
          <td>${Admin.escapeHtml(r.stock || "—")}</td>
          <td class="price">${cost}</td>
          <td class="price">${money(r.tyrewiseEx)}</td>
          <td class="price"><strong>${money(r.sellPrice, 0)}</strong></td>
        </tr>`;
      })
      .join("");
    resultsEl.innerHTML = `<div class="line-table-wrap">
      <table class="line-table">
        <thead>
          <tr>
            <th>Tyre</th>
            <th>Tier</th>
            <th>Load / speed</th>
            <th>Supplier</th>
            <th>Stock</th>
            <th>Cost ex GST</th>
            <th>Tyrewise ex GST</th>
            <th>Sell fitted</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  }

  async function runSearch() {
    const q = String(searchEl?.value || "").trim();
    if (!q) {
      lastResult = null;
      if (summaryEl) summaryEl.textContent = "";
      if (resultsEl) resultsEl.innerHTML = "";
      return;
    }
    try {
      renderResults(await Admin.api(`/api/tyre-prices/search?size=${encodeURIComponent(q)}`));
    } catch (err) {
      showStatus(err?.message || "Search failed.");
    }
  }

  searchEl?.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 250);
  });
  searchEl?.addEventListener("search", runSearch);

  tierFiltersEl?.querySelectorAll("[data-tyre-tier]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tierFilter = btn.dataset.tyreTier;
      tierFiltersEl.querySelectorAll("[data-tyre-tier]").forEach((b) => b.classList.toggle("active", b === btn));
      if (lastResult) renderResults(lastResult);
    });
  });

  settingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const res = await Admin.api("/api/tyre-prices/settings", {
        method: "PUT",
        body: JSON.stringify({
          markupPct: Number(markupEl.value),
          fittingIncl: Number(fittingEl.value),
          includeTyrewise: tyrewiseEl.value === "yes",
        }),
      });
      meta = { ...meta, settings: res.settings };
      renderMeta();
      runSearch();
      showStatus(`Saved: ${settingsLabel(res.settings)}. Publish to update the website.`);
    } catch (err) {
      showStatus(err?.message || "Could not save.");
    }
  });

  publishBtn?.addEventListener("click", async () => {
    if (!meta) return;
    if (!confirm(`Publish tyre prices to the website with ${settingsLabel(meta.settings)}?`)) return;
    publishBtn.disabled = true;
    try {
      const res = await Admin.api("/api/tyre-prices/publish", { method: "POST", body: "{}" });
      showStatus(`Published ${res.sizes} sizes to the website.`);
      await loadMeta();
    } catch (err) {
      showStatus(err?.message || "Could not publish.");
    } finally {
      publishBtn.disabled = !meta?.rowCount;
    }
  });

  document.getElementById("btn-tyre-export")?.addEventListener("click", () => {
    window.location.href = "/api/tyre-prices/export.csv";
  });

  uploadBtn?.addEventListener("click", () => uploadInput?.click());
  uploadInput?.addEventListener("change", async () => {
    const file = uploadInput.files?.[0];
    uploadInput.value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    uploadBtn.disabled = true;
    showStatus("Uploading price data…");
    try {
      const res = await Admin.api("/api/tyre-prices/upload", { method: "POST", body: form });
      const c = res.changes;
      const changeText = c
        ? ` ${c.costsChanged} supplier cost${c.costsChanged === 1 ? "" : "s"} changed (${c.up} up, ${c.down} down), ${c.websiteChanged} website price${c.websiteChanged === 1 ? "" : "s"} would change.`
        : "";
      const emailText = res.email?.sent
        ? ` Changes emailed to ${res.email.to}.`
        : res.email?.error
          ? ` Change email failed: ${res.email.error}.`
          : "";
      showStatus(`Loaded ${res.rowCount.toLocaleString("en-NZ")} tyres.${changeText}${emailText} Check a few sizes, then publish to update the website.`);
      await loadMeta();
      runSearch();
    } catch (err) {
      showStatus(err?.message || "Upload failed.");
    } finally {
      uploadBtn.disabled = false;
    }
  });

  window.DeaneTyrePrices = {
    show() {
      loadMeta();
      if (searchEl && !searchEl.value) searchEl.value = "205/55R16";
      runSearch();
    },
  };
})();
