/** Customer-facing email chrome: inline logo (CID) so Gmail still shows it. */

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

function withCustomerEmailHtml(innerHtml, { logoWidth = 168 } = {}) {
  const width = Math.max(120, Number(logoWidth) || 168);
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a2332;line-height:1.45;max-width:580px;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0b1c3f;">
    <tr>
      <td style="padding:12px 16px;">
        <img src="cid:${LOGO_CID}" alt="${business.name}" width="${width}" style="display:block;border:0;width:${width}px;max-width:100%;height:auto;" />
      </td>
    </tr>
  </table>
  <div style="padding:18px 8px 8px;">${innerHtml}</div>
</div>`;
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
};
