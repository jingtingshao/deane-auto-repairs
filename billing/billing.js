const loading = document.getElementById("loading");
const errorEl = document.getElementById("error");
const docEl = document.getElementById("doc");
const kindEl = document.getElementById("doc-kind");

function docId() {
  const parts = location.pathname.split("/").filter(Boolean);
  const bIndex = parts.indexOf("b");
  if (bIndex >= 0 && parts[bIndex + 1]) return parts[bIndex + 1];
  return new URLSearchParams(location.search).get("id");
}

function acceptToken() {
  return new URLSearchParams(location.search).get("t") || "";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function money(n) {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
  }).format(Number(n) || 0);
}

function statusLabel(doc) {
  if (doc.kind === "invoice") {
    return doc.status === "sent" ? "Tax invoice" : "Tax invoice";
  }
  const map = {
    sent: "Quote — waiting for your approval",
    accepted: "Quote accepted",
    invoiced: "Quote accepted",
  };
  return map[doc.status] || "Quote";
}

async function load() {
  const id = docId();
  if (!id) {
    loading.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = "Link is missing.";
    return;
  }

  try {
    const token = acceptToken();
    const res = await fetch(
      `/api/billing/${id}${token ? `?t=${encodeURIComponent(token)}` : ""}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Not found");
    render(data);
  } catch (err) {
    loading.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent =
      err.message === "Not found"
        ? "This document is not available yet."
        : err.message;
  }
}

function render(doc) {
  loading.hidden = true;
  docEl.hidden = false;
  const isInvoice = doc.kind === "invoice";
  kindEl.textContent = isInvoice ? "Tax invoice" : "Quote";
  document.title = `${doc.number} · Deane Auto Repairs`;

  const shop = doc.shop || {};
  const totals = doc.totals || {};
  const canAccept = doc.kind === "quote" && doc.status === "sent";
  const accepted =
    doc.kind === "quote" && (doc.status === "accepted" || doc.status === "invoiced");

  const gstLine = shop.gstNumber
    ? `<p class="meta">GST number ${escapeHtml(shop.gstNumber)}</p>`
    : "";

  const banner = accepted
    ? `<p class="banner ok">Thanks — this quote has been accepted. We’ll start the work. Your invoice is ready at the workshop.</p>`
    : canAccept
      ? `<p class="banner info">Please review the work and price below. We will not start until you accept.</p>`
      : "";

  const lineRows = (doc.lines || [])
    .map((line) => {
      const total = (Number(line.qty) || 0) * (Number(line.unitPriceIncl) || 0);
      return `<tr>
        <td>${escapeHtml(line.description)}</td>
        <td class="num">${escapeHtml(String(line.qty))}</td>
        <td class="num">${money(line.unitPriceIncl)}</td>
        <td class="num">${money(total)}</td>
      </tr>`;
    })
    .join("");

  const acceptBlock = canAccept
    ? `<div class="actions no-print">
        <button type="button" class="primary" id="btn-accept">Accept this quote</button>
      </div>
      <p class="meta" id="accept-error" hidden></p>`
    : `<div class="actions no-print">
        <button type="button" id="btn-print">Print / save PDF</button>
      </div>`;

  docEl.innerHTML = `
    ${banner}
    <section class="panel">
      <h1>${escapeHtml(isInvoice ? "Tax Invoice" : "Quote")} ${escapeHtml(doc.number)}</h1>
      <p class="meta">${escapeHtml(statusLabel(doc))}</p>
      ${doc.validUntil && !isInvoice ? `<p class="meta">Valid until ${escapeHtml(doc.validUntil)}</p>` : ""}
      ${gstLine}
      <div class="grid-2" style="margin-top:1rem">
        <div>
          <p class="meta">Customer</p>
          <p><strong>${escapeHtml(doc.customerName || "—")}</strong></p>
          ${doc.customerEmail ? `<p class="meta">${escapeHtml(doc.customerEmail)}</p>` : ""}
          ${doc.customerPhone ? `<p class="meta">${escapeHtml(doc.customerPhone)}</p>` : ""}
        </div>
        <div>
          <p class="meta">Vehicle</p>
          <p><strong>${escapeHtml(doc.registration || "—")}</strong></p>
          <p class="meta">${escapeHtml(doc.vehicle || "")}</p>
          ${doc.odometer ? `<p class="meta">${escapeHtml(doc.odometer)} km</p>` : ""}
        </div>
      </div>
    </section>
    <section class="panel">
      <h2>Items</h2>
      <table class="lines">
        <thead>
          <tr>
            <th>Description</th>
            <th class="num">Qty</th>
            <th class="num">Price incl. GST</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
      </table>
      <div class="totals">
        <p><span>Subtotal excl. GST</span><span>${money(totals.net)}</span></p>
        <p><span>GST (15%)</span><span>${money(totals.gst)}</span></p>
        <p class="grand"><span>Total incl. GST</span><span>${money(totals.totalIncl)}</span></p>
      </div>
      ${doc.notes ? `<p class="note" style="margin-top:1rem">${escapeHtml(doc.notes)}</p>` : ""}
      ${acceptBlock}
    </section>
  `;

  const printBtn = document.getElementById("btn-print");
  if (printBtn) printBtn.addEventListener("click", () => window.print());

  const acceptBtn = document.getElementById("btn-accept");
  if (acceptBtn) {
    acceptBtn.addEventListener("click", () => acceptQuote(doc.id, acceptBtn));
  }
}

async function acceptQuote(id, btn) {
  const errEl = document.getElementById("accept-error");
  const token = acceptToken();
  if (!token) {
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = "Open the accept link from your email to confirm this quote.";
    }
    return;
  }
  btn.disabled = true;
  btn.textContent = "Accepting…";
  try {
    const res = await fetch(`/api/billing/${id}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not accept quote");
    render(data.doc);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Accept this quote";
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = err.message;
    }
  }
}

load();
