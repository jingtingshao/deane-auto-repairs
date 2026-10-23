/** Customer-facing email layout (contact block; no logo attachment). */

const path = require("path");
const business = require("./business");

const LOGO_FILE = path.join(__dirname, "..", "images", "deane-auto-logo.jpg");

/** Filesystem path for PDF letterhead (emails do not attach this). */
function logoPath() {
  return LOGO_FILE;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("'", "&#39;");
}

function withCustomerEmailHtml(innerHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a2332;line-height:1.45;max-width:580px;">
  <div style="padding:8px;">${innerHtml}</div>
</div>`;
}

/** Shop name in black; address, phone and email in grey with no underline (Gmail-safe). */
function emailContactHtml() {
  const grey = "color:#5b6777;text-decoration:none;";
  const maps = business.mapsUrl;
  const link = (href, label) =>
    `<a href="${escapeAttr(href)}" style="${grey}"><span style="${grey}">${escapeHtml(label)}</span></a>`;
  return `<p style="margin:1rem 0 0;font-size:14px;line-height:1.45;color:#5b6777;">
    <span style="color:#1a2332;font-weight:700;">${escapeHtml(business.name)}</span><br/>
    ${link(maps, `${business.street}, ${business.suburb}`)}<br/>
    ${link(`tel:${business.phoneTel}`, business.phoneDisplay)}<br/>
    ${link(`mailto:${business.email}`, business.email)}
  </p>`;
}

/** Attachments for customer emails — PDF etc. only (no logo file). */
function withLogoAttachments(extra = []) {
  return Array.isArray(extra) ? extra : [];
}

module.exports = {
  logoPath,
  withCustomerEmailHtml,
  withLogoAttachments,
  emailContactHtml,
};
