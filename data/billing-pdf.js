/** Build a simple A4 quote/invoice PDF for email attachment. */

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const catalog = require("./catalog");
const business = require("./business");
const { logoPath } = require("./customer-email");
const { todayIso } = require("./nz-time");
const {
  reviewPayloadForInvoice,
  reviewQrPngBuffer,
} = require("./google-review");

function money(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function formatDateShort(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.slice(0, 10);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return iso || raw;
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(d);
}

function safeFilename(number, kind) {
  const base = String(number || kind || "document")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const prefix = kind === "invoice" ? "Invoice" : "Quote";
  return `${prefix}-${base || "document"}.pdf`;
}

function buildBillingPdf(doc) {
  return new Promise(async (resolve, reject) => {
    try {
      const pdf = new PDFDocument({
        size: "A4",
        margin: 48,
        info: {
          Title: `${doc.kind === "invoice" ? "Tax Invoice" : "Quote"} ${doc.number || ""}`,
          Author: business.name,
        },
      });
      const chunks = [];
      pdf.on("data", (chunk) => chunks.push(chunk));
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);

      const pageWidth = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
      const left = pdf.page.margins.left;
      const totals = catalog.computeTotals(doc.lines || []);
      const isInvoice = doc.kind === "invoice";
      const title = isInvoice ? "Tax Invoice" : "Quote";
      const title = isInvoice ? "Tax Invoice" : "Quote";
      const SIGN_NAVY = "#021534";
      const SIGN_YELLOW = "#e9a305";
      const review = isInvoice ? reviewPayloadForInvoice(doc) : null;
      let reviewQr = null;
      if (review?.url) {
        try {
          reviewQr = await reviewQrPngBuffer(review.url, 78);
        } catch (err) {
          console.error("Invoice review QR failed:", err.message || err);
        }
      }
      const file = logoPath();
      const barH = 92;
      const stripeH = 5;
      let headerBottom = barH + stripeH + 16;

      pdf.rect(0, 0, pdf.page.width, barH).fill(SIGN_NAVY);
      const textWidth = pageWidth - 170;
      const textLeft = left + 170;

      if (fs.existsSync(file)) {
        pdf.image(file, left, 0, { fit: [168, barH], align: "left", valign: "center" });
      }
      pdf.fillColor("#ffffff").font("Helvetica").fontSize(9);
      pdf.text(`${business.street}, ${business.suburb}, ${business.city}`, textLeft, 10, {
        width: textWidth,
        align: "right",
      });
      pdf.text(business.phoneDisplay, { width: textWidth, align: "right" });
      pdf.moveDown(0.2);
      pdf.fillColor(SIGN_YELLOW).font("Helvetica-Bold").fontSize(13);
      pdf.text(`${title} ${doc.number || ""}`, { width: textWidth, align: "right" });
      pdf.font("Helvetica").fontSize(9).fillColor("#ffffff");
      if (isInvoice) {
        const issued =
          formatDateShort(doc.issuedAt || doc.sentAt || doc.createdAt) ||
          formatDateShort(todayIso());
        pdf.text(`Issue date ${issued}`, { width: textWidth, align: "right" });
        pdf.text("Due date Immediately", { width: textWidth, align: "right" });
      } else if (doc.validUntil) {
        pdf.text(`Valid until ${formatDateShort(doc.validUntil)}`, {
          width: textWidth,
          align: "right",
        });
      }
      if (business.gstNumber) {
        pdf.text(`GST number ${business.gstNumber}`, {
          width: textWidth,
          align: "right",
        });
      }
      pdf.rect(0, barH, pdf.page.width, stripeH).fill(SIGN_YELLOW);

      pdf.y = headerBottom;
      pdf.moveDown(0.2);
      const colGap = 24;
      const colWidth = (pageWidth - colGap) / 2;
      const blockTop = pdf.y;

      pdf
        .fillColor("#5b6777")
        .font("Helvetica")
        .fontSize(9)
        .text("CUSTOMER", left, blockTop, { width: colWidth });
      pdf
        .fillColor("#1a2332")
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(doc.customerName || "—", left, pdf.y + 2, { width: colWidth });
      pdf.font("Helvetica").fontSize(10).fillColor("#5b6777");
      if (doc.customerEmail) pdf.text(doc.customerEmail, { width: colWidth });
      if (doc.customerPhone) pdf.text(doc.customerPhone, { width: colWidth });
      const leftBottom = pdf.y;

      pdf
        .fillColor("#5b6777")
        .font("Helvetica")
        .fontSize(9)
        .text("VEHICLE", left + colWidth + colGap, blockTop, { width: colWidth });
      pdf
        .fillColor("#1a2332")
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(doc.registration || "—", left + colWidth + colGap, blockTop + 12, {
          width: colWidth,
        });
      pdf
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#5b6777")
        .text(doc.vehicle || "", left + colWidth + colGap, pdf.y + 2, {
          width: colWidth,
        });
      const rightBottom = pdf.y;

      pdf.y = Math.max(leftBottom, rightBottom) + 16;

      const widths = {
        qty: pageWidth * 0.1,
        price: pageWidth * 0.16,
        total: pageWidth * 0.18,
      };
      widths.desc = pageWidth - widths.qty - widths.price - widths.total;
      const cols = {
        desc: left,
        qty: left + widths.desc,
        price: left + widths.desc + widths.qty,
        total: left + widths.desc + widths.qty + widths.price,
      };
      const contentRight = left + pageWidth;

      function drawRight(str, rightX, y) {
        const text = String(str);
        const w = pdf.widthOfString(text);
        pdf.text(text, Math.max(left, rightX - w), y, { lineBreak: false });
      }

      function drawHeader() {
        const y = pdf.y;
        pdf.fillColor("#0d47a1").font("Helvetica-Bold").fontSize(9);
        pdf.text("Description", cols.desc, y, { width: widths.desc, lineBreak: false });
        drawRight("Qty", cols.price, y);
        drawRight("Excl. GST", cols.total, y);
        drawRight("Total", contentRight, y);
        pdf
          .moveTo(left, y + 14)
          .lineTo(left + pageWidth, y + 14)
          .strokeColor("#d7e0ea")
          .lineWidth(1)
          .stroke();
        pdf.y = y + 20;
      }

      function pageBottom() {
        return pdf.page.height - pdf.page.margins.bottom;
      }

      /** How to pay starts three-quarters down the last page only. */
      function payAnchorY() {
        return pdf.page.height * 0.75;
      }

      function reviewBlockHeight() {
        if (!review || !reviewQr) return 0;
        const qrSize = 62;
        const textWidth = pageWidth - qrSize - 11;
        pdf.font("Helvetica-Bold").fontSize(7);
        let h = pdf.currentLineHeight() + 3;
        pdf.font("Helvetica").fontSize(7);
        h += pdf.heightOfString(review.message, { width: textWidth });
        h += 4;
        return Math.max(qrSize + 6, h) + 8;
      }

      function payFooterHeight() {
        const terms = business.paymentTerms || [];
        let h = 8;
        pdf.font("Helvetica-Bold").fontSize(11);
        h += pdf.currentLineHeight() + 4;
        pdf.font("Helvetica").fontSize(10);
        h +=
          pdf.heightOfString(`Bank account name: ${business.bankAccountName}`, {
            width: pageWidth,
          }) + 2;
        h +=
          pdf.heightOfString(`Bank account number: ${business.bankAccount}`, {
            width: pageWidth,
          }) + 8;
        pdf.font("Helvetica-Bold").fontSize(10);
        h += pdf.currentLineHeight() + 4;
        pdf.font("Helvetica").fontSize(10);
        for (const line of terms) {
          h += pdf.heightOfString(`• ${line}`, { width: pageWidth }) + 2;
        }
        if (!isInvoice) {
          pdf.font("Helvetica").fontSize(9);
          h +=
            10 +
            pdf.heightOfString(
              "Please open the link in your email to review and accept this quote online before we start work.",
              { width: pageWidth }
            );
        }
        h += reviewBlockHeight();
        return h;
      }

      const footerHeight = payFooterHeight();

      function drawReviewBlock(startY) {
        if (!review || !reviewQr) return startY;
        const qrSize = 62;
        const gap = 11;
        const textWidth = pageWidth - qrSize - gap;
        let y = startY + 7;
        pdf
          .moveTo(left, y)
          .lineTo(left + pageWidth, y)
          .strokeColor("#d7e0ea")
          .lineWidth(1)
          .stroke();
        y += 7;
        pdf.fillColor("#0d47a1").font("Helvetica-Bold").fontSize(7);
        pdf.text("Google review", left, y, { width: textWidth });
        const titleBottom = pdf.y + 1;
        pdf.fillColor("#1a2332").font("Helvetica").fontSize(7);
        pdf.text(review.message, left, titleBottom, { width: textWidth });
        const textBottom = pdf.y;
        pdf.image(reviewQr, left + textWidth + gap, y, {
          width: qrSize,
          height: qrSize,
        });
        pdf.link(left + textWidth + gap, y, qrSize, qrSize, review.url);
        pdf.y = Math.max(textBottom, y + qrSize) + 3;
        pdf.x = left;
        return pdf.y;
      }

      function drawPayFooter() {
        const minGap = 12;
        let y = Math.min(payAnchorY(), pageBottom() - footerHeight);
        if (pdf.y + minGap > y) {
          pdf.addPage();
          y = Math.min(payAnchorY(), pageBottom() - footerHeight);
        }
        pdf.x = left;
        pdf
          .moveTo(left, y)
          .lineTo(left + pageWidth, y)
          .strokeColor("#d7e0ea")
          .lineWidth(1)
          .stroke();
        y += 8;
        pdf.fillColor("#0d47a1").font("Helvetica-Bold").fontSize(11);
        pdf.text("How to pay", left, y, { width: pageWidth });
        pdf.fillColor("#1a2332").font("Helvetica").fontSize(10);
        pdf.text(`Bank account name: ${business.bankAccountName}`, left, pdf.y, {
          width: pageWidth,
        });
        pdf.text(`Bank account number: ${business.bankAccount}`, left, pdf.y, {
          width: pageWidth,
        });
        pdf.moveDown(0.35);
        pdf.fillColor("#0d47a1").font("Helvetica-Bold").fontSize(10);
        pdf.text("Payment terms", left, pdf.y, { width: pageWidth });
        pdf.fillColor("#1a2332").font("Helvetica").fontSize(10);
        for (const line of business.paymentTerms || []) {
          pdf.text(`• ${line}`, left, pdf.y, { width: pageWidth });
        }
        if (!isInvoice) {
          pdf.moveDown(0.45);
          pdf.fillColor("#5b6777").font("Helvetica").fontSize(9);
          pdf.text(
            "Please open the link in your email to review and accept this quote online before we start work.",
            left,
            pdf.y,
            { width: pageWidth }
          );
        }
        drawReviewBlock(pdf.y);
      }

      function ensureSpace(needed) {
        if (pdf.y + needed > pageBottom()) {
          pdf.addPage();
          drawHeader();
        }
      }

      function ensureSpaceAboveFooter(needed) {
        if (pdf.y + needed > payAnchorY()) {
          pdf.addPage();
        }
      }

      drawHeader();

      const lines = (doc.lines || []).filter((line) =>
        String(line.description || "").trim()
      );
      for (const line of lines) {
        const desc = String(line.description || "").trim();
        const qty = Number(line.qty) || 0;
        const unit = Number(line.unitPriceIncl) || 0;
        const lineTot = catalog.lineTotal(line);
        pdf.font("Helvetica").fontSize(10);
        const descHeight = pdf.heightOfString(desc, { width: widths.desc });
        ensureSpace(descHeight + 12);

        const y = pdf.y;
        pdf.fillColor("#1a2332").text(desc, cols.desc, y, { width: widths.desc });
        const afterDesc = pdf.y;
        pdf.font("Helvetica").fontSize(10).fillColor("#1a2332");
        drawRight(String(qty), cols.price, y);
        drawRight(money(unit), cols.total, y);
        drawRight(money(lineTot), contentRight, y);
        pdf.x = left;
        pdf.y = Math.max(afterDesc, y + 12) + 4;
      }

      pdf.moveDown(0.6);
      let notesHeight = 0;
      if (doc.notes) {
        pdf.font("Helvetica").fontSize(10);
        notesHeight =
          28 +
          pdf.heightOfString(String(doc.notes).trim(), { width: pageWidth });
      }
      ensureSpaceAboveFooter(90 + notesHeight);
      const totalsLabelX = cols.price;
      pdf
        .moveTo(totalsLabelX, pdf.y)
        .lineTo(contentRight, pdf.y)
        .strokeColor("#d7e0ea")
        .stroke();
      pdf.moveDown(0.4);

      const row = (label, value, bold = false) => {
        const y = pdf.y;
        pdf.fillColor("#1a2332").font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
        const labelRight = cols.total - 8;
        const labelW = pdf.widthOfString(label);
        pdf.text(label, Math.max(totalsLabelX, labelRight - labelW), y, {
          lineBreak: false,
        });
        drawRight(value, contentRight, y);
        pdf.x = left;
        pdf.y = y + 14;
      };
      row("Subtotal excl. GST", money(totals.net));
      row("GST (15%)", money(totals.gst));
      row("Total incl. GST", money(totals.totalIncl), true);
      pdf.x = left;

      if (doc.notes) {
        pdf.moveDown(0.8);
        pdf.fillColor("#5b6777").font("Helvetica-Bold").fontSize(9).text("NOTES", left, pdf.y, { width: pageWidth });
        pdf
          .fillColor("#1a2332")
          .font("Helvetica")
          .fontSize(10)
          .text(String(doc.notes).trim(), left, pdf.y, { width: pageWidth });
      }

      drawPayFooter();

      pdf.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  buildBillingPdf,
  safeFilename,
};
