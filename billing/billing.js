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

function viewToken() {
  return new URLSearchParams(location.search).get("v") || "";
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
    const params = new URLSearchParams();
    const view = viewToken();
    const token = acceptToken();
    if (view) params.set("v", view);
    if (token) params.set("t", token);
    const query = params.toString();
    const res = await fetch(`/api/billing/${id}${query ? `?${query}` : ""}`);
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

  const shopName = shop.name || "Deane Auto Repairs";
  const shopLandmark = shop.addressLine2 || "(Next to BP Petrol Station)";
  const shopStreet = [shop.street || "63 Hayr Road", shop.suburb || "Three Kings", shop.city || "Auckland"]
    .filter(Boolean)
    .join(", ");
  const shopPhone = shop.phoneDisplay || "0800 625 9827";
  const shopPhoneTel = shop.phoneTel || "08006259827";
  const shopEmail = shop.email || "deaneautonz@gmail.com";

  const letterhead = `
    <header class="letterhead">
      <p class="letterhead-brand"><span class="script">Deane</span> <span class="sans">AUTO REPAIRS</span></p>
      <p class="letterhead-contact">
        ${escapeHtml(shopName)}<br />
        ${escapeHtml(shopLandmark)}<br />
        ${escapeHtml(shopStreet)}<br />
        <a href="tel:${escapeHtml(shopPhoneTel)}">${escapeHtml(shopPhone)}</a>
        · <a href="mailto:${escapeHtml(shopEmail)}">${escapeHtml(shopEmail)}</a>
      </p>
    </header>`;

  docEl.innerHTML = `
    ${letterhead}
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
            <th class="num">Price excl. GST</th>
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
      <div class="pay">
        <h2>How to pay</h2>
        <p>Bank account number: <strong>${escapeHtml(shop.bankAccount || "02-0216-0104554-002")}</strong></p>
        <h3>Payment terms</h3>
        <ul class="pay-terms">
          ${(Array.isArray(shop.paymentTerms) && shop.paymentTerms.length
            ? shop.paymentTerms
            : [
                "A 30% deposit may be required for repairs over $1,000.",
                "Payment is due upon completion of the repair and before the vehicle is released.",
                "Additional work will only be carried out with customer approval.",
                "We may retain possession of the vehicle for unpaid amounts.",
              ]
          )
            .map((line) => `<li>${escapeHtml(line)}</li>`)
            .join("")}
        </ul>
      </div>
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
