(function () {
  const Admin = window.DeaneAdmin;

  const statusEl = document.getElementById("tyre-prices-status");
  const searchEl = document.getElementById("tyre-size-search");
  const summaryEl = document.getElementById("tyre-search-summary");
  const resultsEl = document.getElementById("tyre-search-results");
  const tierFiltersEl = document.getElementById("tyre-tier-filters");
  const settingsForm = document.getElementById("tyre-settings-form");
  const fittingEl = document.getElementById("tyre-fitting");
  const tyrewiseEl = document.getElementById("tyre-tyrewise");
  const publishInfoEl = document.getElementById("tyre-publish-info");
  const publishBtn = document.getElementById("btn-tyre-publish");
  const dataInfoEl = document.getElementById("tyre-data-info");
  const refreshInfoEl = document.getElementById("tyre-refresh-info");
  const refreshBtn = document.getElementById("btn-tyre-refresh");
  let refreshPoll = null;
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
    return `markup on the tyre by cost (40% under $100 down to 15% from $400), supplier specials used, fitting ${money(s.fittingIncl, 0)}, Tyrewise ${s.includeTyrewise ? "included" : "left out"}`;
  }

  function sameSettings(a, b) {
    return (
      a && b &&
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
    if (fittingEl) fittingEl.value = s.fittingIncl;
    if (tyrewiseEl) tyrewiseEl.value = s.includeTyrewise ? "yes" : "no";
    if (dataInfoEl) {
      const sources = (meta.sources || [])
        .map((src) => `${src.supplier} ${src.count}`)
        .join(" · ");
      dataInfoEl.textContent = meta.rowCount
        ? `${meta.rowCount.toLocaleString("en-NZ")} tyres, supplier prices from ${Admin.formatDateShort(meta.scrapedOn)}. ${sources}.`
        : "No price data yet. Upload tyre-price-data.json from the price list folder on the office computer.";
    }
    renderRefreshInfo();
  }

  function renderRefreshInfo() {
    if (!refreshInfoEl || !meta) return;
    const suppliers = meta.suppliers || [];
    const saved = suppliers.filter((s) => s.configured).map((s) => s.supplier);
    const missing = suppliers.filter((s) => !s.configured).map((s) => s.supplier);
    const parts = [];
    parts.push(
      saved.length
        ? `Every Monday at 8am the server logs in and refreshes ${saved.join(", ")} automatically, then emails any price changes.`
        : "No supplier logins saved on the server, so every Monday at 8am you get a reminder email instead."
    );
    if (saved.length && missing.length) parts.push(`No login saved for ${missing.join(", ")}.`);
    const last = meta.lastRefresh;
    if (meta.refreshing) {
      parts.push("Refreshing now… this takes a few minutes.");
    } else if (last) {
      const ok = (last.ok || []).map((o) => `${o.supplier} ${o.count}`).join(", ");
      const failed = (last.failures || []).map((f) => `${f.supplier} (${f.error})`).join("; ");
      parts.push(
        `Last refresh ${Admin.formatDateTimeShort(last.at)}: ${ok || "nothing downloaded"}${failed ? `. Failed: ${failed}` : ""}.`
      );
    }
    refreshInfoEl.textContent = parts.join(" ");
    if (refreshBtn) {
      refreshBtn.disabled = Boolean(meta.refreshing) || !saved.length;
      refreshBtn.textContent = meta.refreshing ? "Refreshing…" : "Refresh prices now";
    }
    if (meta.refreshing && !refreshPoll) {
      refreshPoll = setInterval(async () => {
        await loadMeta();
        if (!meta?.refreshing) {
          clearInterval(refreshPoll);
          refreshPoll = null;
          runSearch();
          showStatus("Price refresh finished. Any changes have been emailed.");
        }
      }, 10_000);
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
          ? `${money(r.costEx)} <span class="badge pay-overdue">Special</span>${r.usualEx ? `<br /><small class="muted">Usual ${money(r.usualEx)}</small>` : ""}`
          : money(r.costEx);
        const best =
          (r.cheapestInTier ? ' <span class="badge published">Cheapest</span>' : "") +
          (r.onWebsite ? ' <span class="badge quote">On website</span>' : "");
        return `<tr${r.inStock ? "" : ' class="muted"'}>
          <td><strong>${Admin.escapeHtml(r.brand)}</strong> ${Admin.escapeHtml(r.pattern || "")}<br /><small class="muted">${Admin.escapeHtml(r.description || "")}</small></td>
          <td>${Admin.escapeHtml(r.tier)}${best}</td>
          <td>${Admin.escapeHtml(r.loadSpeed)}</td>
          <td>${Admin.escapeHtml(r.supplier)}</td>
          <td>${r.workshopQty ? `<span class="badge published">Workshop ${Admin.escapeHtml(String(r.workshopQty))}</span><br />` : ""}${Admin.escapeHtml(r.stock || "—")}</td>
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

  refreshBtn?.addEventListener("click", async () => {
    if (!confirm("Log in to the suppliers and download new prices now? This takes a few minutes.")) return;
    try {
      await Admin.api("/api/tyre-prices/refresh", { method: "POST", body: "{}" });
      await loadMeta();
    } catch (err) {
      showStatus(err?.message || "Could not start the refresh.");
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

  const imagesInfoEl = document.getElementById("tyre-images-info");
  const imagesListEl = document.getElementById("tyre-images-list");
  const imagesSearchEl = document.getElementById("tyre-images-search");
  const imagesFilterEl = document.getElementById("tyre-images-filter");
  const imagesFileEl = document.getElementById("tyre-images-file");
  const imagesDownloadBtn = document.getElementById("btn-tyre-images-download");
  let imagesTimer = null;
  let imagesPoll = null;
  let uploadTarget = null;

  function renderImagesInfo(data) {
    if (!imagesInfoEl) return;
    if (!data.published) {
      imagesInfoEl.textContent = "Publish tyre prices first. Pictures are fetched for the tyres the website shows.";
      if (imagesDownloadBtn) imagesDownloadBtn.disabled = true;
      return;
    }
    const parts = [
      `${data.withPicture} of ${data.total} tyre models on the website have a picture${data.manual ? ` (${data.manual} uploaded by you)` : ""}.`,
    ];
    if (!data.supplierLinks) {
      parts.push("The saved supplier prices have no picture links yet. Press Refresh prices now (below), then Publish, and pictures will download.");
    }
    if (data.downloading) parts.push("Downloading supplier pictures now… this can take several minutes.");
    else if (data.lastRun) {
      const r = data.lastRun;
      parts.push(
        `Last download ${Admin.formatDateTimeShort(r.at)}: ${r.added || 0} new, ${r.failed || 0} failed, ${r.noPicture || 0} with no supplier picture.`
      );
    }
    imagesInfoEl.textContent = parts.join(" ");
    if (imagesDownloadBtn) {
      imagesDownloadBtn.disabled = Boolean(data.downloading);
      imagesDownloadBtn.textContent = data.downloading ? "Downloading…" : "Download missing supplier pictures";
    }
    if (data.downloading && !imagesPoll) {
      imagesPoll = setInterval(async () => {
        const next = await loadImages();
        if (!next?.downloading) {
          clearInterval(imagesPoll);
          imagesPoll = null;
        }
      }, 10_000);
    }
  }

  function renderImages(data) {
    if (!imagesListEl) return;
    if (!data.published) {
      imagesListEl.innerHTML = "";
      return;
    }
    if (!data.models.length) {
      imagesListEl.innerHTML = `<div class="empty">${
        imagesFilterEl?.value === "missing" && !imagesSearchEl?.value.trim() ? "Every tyre model on the website has a picture." : "No matching tyre models."
      }</div>`;
      return;
    }
    const more = data.matches > data.models.length ? `<p class="muted small">Showing ${data.models.length} of ${data.matches}. Type a brand or pattern to narrow it down.</p>` : "";
    imagesListEl.innerHTML =
      more +
      data.models
        .map((m) => {
          const pic = m.img
            ? `<img src="${Admin.escapeAttr(m.img)}" alt="" loading="lazy" />`
            : `<span class="tyre-image-none">No picture</span>`;
          const source =
            m.source === "manual" ? "Your picture" : m.source === "supplier" ? `From ${m.from || "supplier"}` : m.supplierLinks ? "Supplier picture not downloaded yet" : "Supplier has no picture";
          return `<div class="tyre-image-row" data-key="${Admin.escapeAttr(m.key)}">
            <div class="tyre-image-thumb">${pic}</div>
            <div class="tyre-image-text">
              <strong>${Admin.escapeHtml(m.brand)} ${Admin.escapeHtml(m.pattern)}</strong>
              <small class="muted">${Admin.escapeHtml(m.tier || "")} · ${m.sizes} size${m.sizes === 1 ? "" : "s"} · ${Admin.escapeHtml(source)}</small>
            </div>
            <div class="tyre-image-actions">
              <button type="button" class="ghost" data-upload="1">${m.img ? "Replace" : "Upload"}</button>
              ${m.source === "manual" ? '<button type="button" class="ghost" data-reset="1">Use supplier picture</button>' : ""}
            </div>
          </div>`;
        })
        .join("");
    imagesListEl.querySelectorAll(".tyre-image-row").forEach((row) => {
      const model = data.models.find((m) => m.key === row.dataset.key);
      row.querySelector("[data-upload]")?.addEventListener("click", () => {
        uploadTarget = model;
        imagesFileEl?.click();
      });
      row.querySelector("[data-reset]")?.addEventListener("click", async () => {
        if (!confirm(`Remove your picture for ${model.brand} ${model.pattern} and use the supplier picture?`)) return;
        try {
          const res = await Admin.api(`/api/tyre-images?key=${encodeURIComponent(model.key)}`, { method: "DELETE" });
          showStatus(res.downloaded ? "Supplier picture is back." : "Your picture was removed. The supplier has no picture for this tyre.");
          loadImages();
        } catch (err) {
          showStatus(err?.message || "Could not remove the picture.");
        }
      });
    });
  }

  async function loadImages() {
    if (!imagesListEl) return null;
    const q = String(imagesSearchEl?.value || "").trim();
    const missing = imagesFilterEl?.value !== "all";
    try {
      const data = await Admin.api(`/api/tyre-images?missing=${missing ? "1" : "0"}&q=${encodeURIComponent(q)}`);
      renderImagesInfo(data);
      renderImages(data);
      return data;
    } catch (err) {
      showStatus(err?.message || "Could not load tyre pictures.");
      return null;
    }
  }

  imagesSearchEl?.addEventListener("input", () => {
    if (imagesTimer) clearTimeout(imagesTimer);
    imagesTimer = setTimeout(loadImages, 250);
  });
  imagesFilterEl?.addEventListener("change", loadImages);

  imagesDownloadBtn?.addEventListener("click", async () => {
    try {
      await Admin.api("/api/tyre-images/download", { method: "POST", body: "{}" });
      showStatus("Downloading supplier pictures. This page updates when it is done.");
      loadImages();
    } catch (err) {
      showStatus(err?.message || "Could not start the download.");
    }
  });

  imagesFileEl?.addEventListener("change", async () => {
    const file = imagesFileEl.files?.[0];
    imagesFileEl.value = "";
    if (!file || !uploadTarget) return;
    const form = new FormData();
    form.append("brand", uploadTarget.brand);
    form.append("pattern", uploadTarget.pattern);
    form.append("file", file);
    showStatus("Uploading picture…");
    try {
      await Admin.api("/api/tyre-images/upload", { method: "POST", body: form });
      showStatus(`Picture saved for ${uploadTarget.brand} ${uploadTarget.pattern}. The website shows it straight away.`);
      loadImages();
    } catch (err) {
      showStatus(err?.message || "Upload failed.");
    } finally {
      uploadTarget = null;
    }
  });

  publishBtn?.addEventListener("click", () => setTimeout(loadImages, 1500));

  window.DeaneTyrePrices = {
    show() {
      loadMeta();
      loadImages();
      if (searchEl && !searchEl.value) searchEl.value = "205/55R16";
      runSearch();
    },
  };
})();
