/** Build a simple A4 quote/invoice PDF for email attachment. */

const PDFDocument = require("pdfkit");
const catalog = require("./catalog");
const business = require("./business");

function money(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
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
  return new Promise((resolve, reject) => {
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

      pdf
        .fillColor("#0d47a1")
        .font("Helvetica-Bold")
        .fontSize(20)
        .text(business.name, left, 48, { width: pageWidth });

      pdf
        .fillColor("#5b6777")
        .font("Helvetica")
        .fontSize(10)
        .text(business.addressLine2, { width: pageWidth })
        .text(`${business.street}, ${business.suburb}, ${business.city}`, {
          width: pageWidth,
        })
        .text(`${business.phoneDisplay}  ·  ${business.email}`, {
          width: pageWidth,
        });

      pdf.moveDown(1.2);
      pdf
        .fillColor("#1a2332")
        .font("Helvetica-Bold")
        .fontSize(16)
        .text(`${title} ${doc.number || ""}`, { width: pageWidth });

      pdf.font("Helvetica").fontSize(10).fillColor("#5b6777");
      if (!isInvoice && doc.validUntil) {
        pdf.text(`Valid until ${doc.validUntil}`);
      }
      if (business.gstNumber) {
        pdf.text(`GST number ${business.gstNumber}`);
      }

      pdf.moveDown(0.8);
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

      const cols = {
        desc: left,
        qty: left + pageWidth * 0.52,
        price: left + pageWidth * 0.64,
        total: left + pageWidth * 0.8,
      };
      const widths = {
        desc: pageWidth * 0.5,
        qty: pageWidth * 0.1,
        price: pageWidth * 0.14,
        total: pageWidth * 0.18,
      };

      function drawHeader() {
        const y = pdf.y;
        pdf
          .fillColor("#0d47a1")
          .font("Helvetica-Bold")
          .fontSize(9)
          .text("Description", cols.desc, y, { width: widths.desc })
          .text("Qty", cols.qty, y, { width: widths.qty, align: "right" })
          .text("Excl. GST", cols.price, y, {
            width: widths.price,
            align: "right",
          })
          .text("Total", cols.total, y, { width: widths.total, align: "right" });
        pdf
          .moveTo(left, y + 14)
          .lineTo(left + pageWidth, y + 14)
          .strokeColor("#d7e0ea")
          .lineWidth(1)
          .stroke();
        pdf.y = y + 20;
      }

      function ensureSpace(needed) {
        if (pdf.y + needed > pdf.page.height - pdf.page.margins.bottom) {
          pdf.addPage();
          drawHeader();
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
        pdf.text(String(qty), cols.qty, y, { width: widths.qty, align: "right" });
        pdf.text(money(unit), cols.price, y, {
          width: widths.price,
          align: "right",
        });
        pdf.text(money(lineTot), cols.total, y, {
          width: widths.total,
          align: "right",
        });
        pdf.y = Math.max(afterDesc, y + 12) + 4;
      }

      pdf.moveDown(0.6);
      ensureSpace(90);
      pdf
        .moveTo(left + pageWidth * 0.55, pdf.y)
        .lineTo(left + pageWidth, pdf.y)
        .strokeColor("#d7e0ea")
        .stroke();
      pdf.moveDown(0.4);

      const totalsX = left + pageWidth * 0.55;
      const totalsW = pageWidth * 0.45;
      const row = (label, value, bold = false) => {
        const y = pdf.y;
        pdf
          .fillColor("#1a2332")
          .font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(bold ? 11 : 10)
          .text(label, totalsX, y, { width: totalsW * 0.55 })
          .text(value, totalsX + totalsW * 0.55, y, {
            width: totalsW * 0.45,
            align: "right",
          });
        pdf.moveDown(0.25);
      };
      row("Subtotal excl. GST", money(totals.net));
      row("GST (15%)", money(totals.gst));
      row("Total (plus GST)", money(totals.totalIncl), true);

      if (doc.notes) {
        pdf.moveDown(0.8);
        ensureSpace(40);
        pdf.fillColor("#5b6777").font("Helvetica-Bold").fontSize(9).text("NOTES");
        pdf
          .fillColor("#1a2332")
          .font("Helvetica")
          .fontSize(10)
          .text(String(doc.notes).trim(), { width: pageWidth });
      }

      pdf.moveDown(1);
      ensureSpace(70);
      pdf.fillColor("#0d47a1").font("Helvetica-Bold").fontSize(11).text("How to pay");
      pdf
        .fillColor("#1a2332")
        .font("Helvetica")
        .fontSize(10)
        .text(`Bank account number: ${business.bankAccount}`)
        .text(business.paymentDueNote || "Payments are due immediately.")
        .fillColor("#5b6777")
        .text(`*${business.depositNote}`);

      if (!isInvoice) {
        pdf.moveDown(0.8);
        pdf
          .fillColor("#5b6777")
          .font("Helvetica")
          .fontSize(9)
          .text(
            "Please open the link in your email to review and accept this quote online before we start work.",
            { width: pageWidth }
          );
      }

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
