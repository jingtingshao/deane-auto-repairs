/** Google review CTA copy + QR helpers for invoices / emails. */

const QRCode = require("qrcode");
const business = require("./business");
const catalog = require("./catalog");

const REVIEW_MESSAGE =
  "Happy with our service? We’d really appreciate your feedback on Google.";

const MESSAGES = {
  wof: REVIEW_MESSAGE,
  service: REVIEW_MESSAGE,
  repair: REVIEW_MESSAGE,
};

function envTrim(name) {
  return String(process.env[name] || "").trim();
}

function googleReviewUrl() {
  const fromEnv = envTrim("GOOGLE_REVIEW_URL");
  if (fromEnv) return fromEnv;
  const fromBusiness = String(business.googleReviewUrl || "").trim();
  if (fromBusiness) return fromBusiness;
  const placeId =
    envTrim("GOOGLE_PLACE_ID") || String(business.googlePlaceId || "").trim();
  if (placeId) {
    return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
  }
  return "";
}

function reviewConfigured() {
  return Boolean(googleReviewUrl());
}

/**
 * Classify invoice as WoF / Service / Repair for admin tracking.
 * Combined packages (e.g. Standard + WOF) count as Service.
 */
function reviewKindForInvoice(doc) {
  const preset = String(doc?.preset || "").trim();
  if (preset === "wof") return "wof";
  if (
    preset === "standard" ||
    preset === "premium" ||
    preset === "standard_wof" ||
    preset === "premium_wof"
  ) {
    return "service";
  }

  const lines = Array.isArray(doc?.lines) ? doc.lines : [];
  let hasWof = false;
  let hasService = false;
  let hasOther = false;
  for (const line of lines) {
    const desc = String(line?.description || "").trim();
    const qty = Number(line?.qty) || 0;
    if (!desc || qty <= 0) continue;
    if (catalog.lineLooksLikeWof(desc)) {
      hasWof = true;
      continue;
    }
    if (catalog.lineLooksLikeService(desc)) {
      hasService = true;
      continue;
    }
    if (catalog.lineLooksLikeConsumable(desc)) continue;
    hasOther = true;
  }

  if (hasOther) return "repair";
  if (hasService) return "service";
  if (hasWof) return "wof";
  return "repair";
}

function reviewMessage(_kind) {
  return REVIEW_MESSAGE;
}

function reviewPayloadForInvoice(doc) {
  const url = googleReviewUrl();
  if (!url || !doc || doc.kind !== "invoice") return null;
  const kind = reviewKindForInvoice(doc);
  return {
    kind,
    url,
    message: REVIEW_MESSAGE,
    label: "Leave a Google review",
  };
}

async function reviewQrPngBuffer(url, size = 160) {
  const target = String(url || googleReviewUrl() || "").trim();
  if (!target) return null;
  const px = Math.max(96, Math.min(320, Number(size) || 160));
  return QRCode.toBuffer(target, {
    type: "png",
    width: px,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#1a2332", light: "#ffffff" },
  });
}

module.exports = {
  REVIEW_MESSAGE,
  MESSAGES,
  googleReviewUrl,
  reviewConfigured,
  reviewKindForInvoice,
  reviewMessage,
  reviewPayloadForInvoice,
  reviewQrPngBuffer,
};
