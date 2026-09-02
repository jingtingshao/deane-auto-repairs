/** Customer-facing email: inline logo at the end as a signature (CID so Gmail still shows it). */

const fs = require("fs");
const path = require("path");
const business = require("./business");

const LOGO_CID = "deane-logo@deaneauto.co.nz";
const LOGO_FILE = path.join(__dirname, "..", "images", "deane-auto-logo.jpg");

function logoPath() {
  return LOGO_FILE;
}

function logoPublicPath() {
  return "/images/deane-auto-logo.jpg";
}

function logoAttachment() {
  if (!fs.existsSync(LOGO_FILE)) return null;
  return {
    filename: "deane-auto-logo.jpg",
    path: LOGO_FILE,
    cid: LOGO_CID,
    contentType: "image/jpeg",
    contentDisposition: "inline",
  };
}

function withCustomerEmailHtml(innerHtml, { logoWidth = 134 } = {}) {
  const width = Math.max(96, Number(logoWidth) || 134);
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a2332;line-height:1.45;max-width:580px;">
  <div style="padding:8px;">${innerHtml}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" align="left" width="${width}" style="margin-top:16px;border-collapse:collapse;border-top:1px solid #d7e0ea;">
    <tr>
      <td style="padding:16px 0 8px;">
        <img src="cid:${LOGO_CID}" alt="${business.name}" width="${width}" style="display:block;border:0;width:${width}px;max-width:${width}px;height:auto;" />
      </td>
    </tr>
  </table>
  <div style="clear:both;"></div>
</div>`;
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

/** Shop name in black; address, phone and email in grey with no underline (Gmail-safe). */
function emailContactHtml() {
  const grey = "color:#5b6777;text-decoration:none;";
  const maps = business.mapsUrl;
  const link = (href, label) =>
    `<a href="${escapeAttr(href)}" style="${grey}"><span style="${grey}">${escapeHtml(label)}</span></a>`;
  return `<p style="margin:1rem 0 0;font-size:14px;line-height:1.45;color:#5b6777;">
    <span style="color:#1a2332;font-weight:700;">${escapeHtml(business.name)}</span><br/>
    ${link(maps, business.street)}<br/>
    ${link(maps, `${business.suburb}, ${business.city}`)}<br/>
    ${link(`tel:${business.phoneTel}`, business.phoneDisplay)}<br/>
    ${link(`mailto:${business.email}`, business.email)}
  </p>`;
}

function withLogoAttachments(extra = []) {
  const logo = logoAttachment();
  return logo ? [logo, ...extra] : extra;
}

module.exports = {
  LOGO_CID,
  logoPath,
  logoPublicPath,
  logoAttachment,
  withCustomerEmailHtml,
  withLogoAttachments,
  emailContactHtml,
};
