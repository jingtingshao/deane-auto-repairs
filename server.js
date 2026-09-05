require("dotenv").config(
  process.env.DOTENV_CONFIG_PATH
    ? { path: process.env.DOTENV_CONFIG_PATH, override: true }
    : undefined
);

const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const pdfParseModule = require("pdf-parse");
const Tesseract = require("tesseract.js");
const nodemailer = require("nodemailer");
const { randomUUID, randomBytes, createHash, timingSafeEqual } = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");
const {
  ACTIONS,
  STATUSES,
  normalizePackage,
  itemsForPackage,
  emptyChecks,
  BASIC_CHECK_CODES,
} = require("./data/checklist");
const business = require("./data/business");
const catalog = require("./data/catalog");
const namesLib = require("./data/names");
const jobsLib = require("./data/jobs");
const appointmentsLib = require("./data/appointments");
const bookingRequestsLib = require("./data/booking-requests");
const { buildBillingPdf, safeFilename } = require("./data/billing-pdf");
const {
  withCustomerEmailHtml,
  withLogoAttachments,
  emailContactHtml,
} = require("./data/customer-email");
const {
  googleReviewUrl,
  reviewPayloadForInvoice,
  reviewQrPngBuffer,
  reviewConfigured,
} = require("./data/google-review");
const { readJsonArray, writeJsonArray } = require("./data/json-store");
const { blockedStaticPath, safeUploadPath, UPLOAD_EXTS } = require("./data/static-guard");
const { todayIso, plusDays, nowIso, monthKey, monthShortLabel, monthLongLabel } = require("./data/nz-time");
const referralsLib = require("./data/referrals");
const driveBackup = require("./data/drive-backup");
const websms = require("./data/websms");

const PORT = Number(process.env.PORT) || 5173;
const pdfParseLegacy =
  typeof pdfParseModule === "function"
    ? pdfParseModule
    : typeof pdfParseModule?.default === "function"
      ? pdfParseModule.default
      : null;
const PDFParseClass =
  typeof pdfParseModule?.PDFParse === "function" ? pdfParseModule.PDFParse : null;
const KNOWN_WEAK_PINS = new Set(["deane123", "12345678", "password", "admin", "1234", "0000"]);

function isProduction() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.RENDER);
}

function resolveAdminPin() {
  const pin = String(process.env.ADMIN_PIN || "").trim();
  if (!pin) {
    console.error(
      isProduction()
        ? "ADMIN_PIN is not set. Refusing to start in production."
        : "ADMIN_PIN is not set. Copy .env.example to .env, set a strong PIN, then restart."
    );
    process.exit(1);
  }
  if (KNOWN_WEAK_PINS.has(pin.toLowerCase()) || pin.length < 8) {
    console.error(
      "ADMIN_PIN is too weak or matches a published default. Set a strong PIN (8+ characters) in the environment and restart."
    );
    process.exit(1);
  }
  return pin;
}

const ADMIN_PIN = resolveAdminPin();
const TECH_USERNAMES = ["dean01", "dean02"];
const staffContext = new AsyncLocalStorage();

function secretsEqual(a, b) {
  const left = createHash("sha256").update(String(a)).digest();
  const right = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(left, right);
}

function resolveTechUsers() {
  const users = {};
  for (const username of TECH_USERNAMES) {
    const key = `TECH_${username.toUpperCase()}_PASSWORD`;
    const password = String(process.env[key] || "").trim();
    if (!password) continue;
    if (KNOWN_WEAK_PINS.has(password.toLowerCase()) || password.length < 8) {
      console.error(
        `${key} is too weak or matches a published default. Set a strong password (8+ characters).`
      );
      if (isProduction()) process.exit(1);
      continue;
    }
    users[username] = password;
  }
  if (!Object.keys(users).length) {
    console.warn(
      "Technician logins are not configured. Set TECH_DEAN01_PASSWORD and TECH_DEAN02_PASSWORD to enable dean01 / dean02."
    );
  }
  return users;
}

const TECH_USERS = resolveTechUsers();
/** Temporary public-site lock. Empty = unlocked (go-live). Set SITE_PIN on Render until the website is ready. */
const SITE_PIN = String(process.env.SITE_PIN || "").trim();
const ROOT = __dirname;

function isWritableDir(dir) {
  try {
    if (!fs.existsSync(dir)) return false;
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function resolvePersistentDataDir() {
  const raw = String(process.env.DATA_DIR || "").trim();
  const candidates = [];
  const add = (dir) => {
    if (!dir) return;
    const resolved = path.resolve(dir);
    if (!candidates.includes(resolved)) candidates.push(resolved);
  };

  if (raw) {
    add(raw);
    add(path.join(ROOT, raw));
    if (!path.isAbsolute(raw)) add(path.join("/", raw.replace(/^[/\\]+/, "")));
  }
  if (process.platform !== "win32") {
    add("/DATA");
    add("/data");
  }
  add(path.join(ROOT, "DATA"));
  add(path.join(ROOT, "data"));

  const writableExisting = candidates.filter((dir) => isWritableDir(dir));
  const mounted = writableExisting.find((dir) => dir === "/DATA" || dir === "/data");
  if (mounted) return mounted;
  if (writableExisting[0]) return writableExisting[0];
  const fallback = path.join(ROOT, "data");
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

const DATA_DIR = resolvePersistentDataDir();
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");
const BILLING_FILE = path.join(DATA_DIR, "billing.json");
const BILLING_SEQ_FILE = path.join(DATA_DIR, "billing-seq.json");
const CUSTOMERS_FILE = path.join(DATA_DIR, "customers.json");
const CUSTOMERS_SEQ_FILE = path.join(DATA_DIR, "customers-seq.json");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const APPOINTMENTS_FILE = path.join(DATA_DIR, "appointments.json");
const BOOKING_REQUESTS_FILE = path.join(DATA_DIR, "booking-requests.json");
const BOOKING_REQUESTS_MAX = 200;
const SUPPLIER_INVOICES_FILE = path.join(DATA_DIR, "supplier-invoices.json");
const INVOICE_CANDIDATES_FILE = path.join(DATA_DIR, "invoice-candidates.json");
const PART_AUDIT_FILE = path.join(DATA_DIR, "part-audit-log.json");
const SMS_INBOUND_FILE = path.join(DATA_DIR, "sms-inbound.json");
const SMS_LOG_FILE = path.join(DATA_DIR, "sms-log.json");
const REFERRALS_FILE = path.join(DATA_DIR, "referrals.json");
const UPLOADS_DIR = (() => {
  const raw = String(process.env.UPLOADS_DIR || "").trim();
  if (raw && isWritableDir(path.resolve(raw))) return path.resolve(raw);
  const nested = path.join(DATA_DIR, "uploads");
  fs.mkdirSync(nested, { recursive: true });
  return nested;
})();
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const MAIL_FROM =
  process.env.MAIL_FROM ||
  process.env.SMTP_USER ||
  business.email;

function smtpPass() {
  return String(process.env.SMTP_PASS || "")
    .replace(/\s+/g, "")
    .replace(/^["']|["']$/g, "");
}

function smtpConfigured() {
  const pass = smtpPass();
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      pass &&
      !/^(PASTE_APP_PASSWORD_HERE|your-16-char-app-password)$/i.test(pass)
  );
}

function createMailer() {
  if (!smtpConfigured()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true") !== "false",
    auth: {
      user: process.env.SMTP_USER,
      pass: smtpPass(),
    },
  });
}

for (const dir of [DATA_DIR, UPLOADS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
for (const file of [
  REPORTS_FILE,
  BILLING_FILE,
  CUSTOMERS_FILE,
  JOBS_FILE,
  APPOINTMENTS_FILE,
  BOOKING_REQUESTS_FILE,
  SUPPLIER_INVOICES_FILE,
  INVOICE_CANDIDATES_FILE,
  PART_AUDIT_FILE,
  SMS_INBOUND_FILE,
  SMS_LOG_FILE,
  REFERRALS_FILE,
]) {
  if (!fs.existsSync(file)) writeJsonArray(file, []);
}

function readReferrals() {
  const rows = referralsLib.readNormalized(readJsonArray(REFERRALS_FILE, "referrals"));
  if (referralsLib.expireCreditsInPlace(rows)) {
    try {
      writeReferrals(rows);
    } catch (err) {
      console.error("Could not expire referral credits:", err);
    }
  }
  return rows;
}

function writeReferrals(rows) {
  writeJsonArray(REFERRALS_FILE, referralsLib.readNormalized(rows));
}

function customerNameMap() {
  const map = new Map();
  for (const row of readSavedCustomers()) {
    map.set(row.id, row);
  }
  return map;
}

function billingIdMap(docs) {
  const map = new Map();
  for (const doc of docs || []) {
    if (doc?.id) map.set(doc.id, doc);
  }
  return map;
}

function persistQualifiedReferrals(customerId, billingDocs) {
  const id = String(customerId || "").trim();
  if (!id) return [];
  const result = referralsLib.tryQualifyReferrals(
    readReferrals(),
    billingDocs,
    id,
    readJobs()
  );
  if (result.changed) writeReferrals(result.rows);
  return result.qualified || [];
}

function readReports() {
  const reports = readJsonArray(REPORTS_FILE, "reports");
  if (alignLinkedReportNumbers(reports)) {
    try {
      writeReports(reports);
    } catch (err) {
      console.error("Could not align report numbers:", err);
    }
  }
  return reports;
}

function writeReports(reports) {
  writeJsonArray(REPORTS_FILE, reports);
}

function readBilling() {
  const docs = readJsonArray(BILLING_FILE, "quotes and invoices");
  if (repairLegacyConvertedBilling(docs)) {
    try {
      writeBilling(docs);
    } catch (err) {
      console.error("Could not unify quote/invoice numbers:", err);
    }
  }
  return docs;
}

function writeBilling(docs) {
  writeJsonArray(BILLING_FILE, docs);
  bumpBillingHighWater(docs);
}

function readSavedCustomers() {
  const rows = readJsonArray(CUSTOMERS_FILE, "customers");
  if (ensureUniqueCustomerNumbers(rows)) {
    try {
      writeSavedCustomers(rows);
    } catch (err) {
      console.error("Could not save customer numbers:", err);
    }
  }
  return rows;
}

function readJobs() {
  const jobs = readJsonArray(JOBS_FILE, "jobs");
  let changed = false;
  for (const job of jobs) {
    const workPhotos = sanitizePhotoRefs(job.workPhotos);
    if (JSON.stringify(workPhotos) !== JSON.stringify(job.workPhotos || [])) {
      job.workPhotos = workPhotos;
      changed = true;
    }
    const supplierInvoicePhotos = sanitizePhotoRefs(job.supplierInvoicePhotos);
    if (
      JSON.stringify(supplierInvoicePhotos) !==
      JSON.stringify(job.supplierInvoicePhotos || [])
    ) {
      job.supplierInvoicePhotos = supplierInvoicePhotos;
      changed = true;
    }
    const normalizedParts = jobsLib.normalizeParts(job.parts, () => randomUUID());
    if (JSON.stringify(normalizedParts) !== JSON.stringify(job.parts || [])) {
      job.parts = normalizedParts;
      changed = true;
    }
    const next = jobsLib.normalizeJobStatus(job.status, job.parts);
    if (next !== job.status) {
      job.status = next;
      changed = true;
    }
  }
  if (alignLinkedJobNumbers(jobs)) changed = true;
  if (changed) {
    try {
      writeJobs(jobs);
    } catch (err) {
      console.error("Could not migrate jobs:", err);
    }
  }
  return jobs;
}

function ensureJobStatuses(jobs) {
  return jobs;
}

function writeJobs(jobs) {
  writeJsonArray(JOBS_FILE, jobs);
}

function readAppointments() {
  return readJsonArray(APPOINTMENTS_FILE, "appointments").map((row) =>
    appointmentsLib.normalizeAppointment(row, row.id || randomUUID())
  );
}

function writeAppointments(rows) {
  writeJsonArray(APPOINTMENTS_FILE, rows);
}

function readBookingRequests() {
  return readJsonArray(BOOKING_REQUESTS_FILE, "booking requests").map((row) =>
    bookingRequestsLib.normalizeBookingRequest(row, row.id || randomUUID())
  );
}

function writeBookingRequests(rows) {
  const sorted = [...rows].sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
  writeJsonArray(BOOKING_REQUESTS_FILE, sorted.slice(0, BOOKING_REQUESTS_MAX));
}

function syncAppointmentJobMeta(row) {
  if (!row?.jobId) {
    row.jobNumber = "";
    return row;
  }
  const job = readJobs().find((j) => j.id === row.jobId);
  if (!job) return row;
  row.jobNumber = job.number || row.jobNumber || "";
  if (!row.customerName && job.customerName) row.customerName = job.customerName;
  if (!row.customerPhone && job.customerPhone) row.customerPhone = job.customerPhone;
  if (!row.customerEmail && job.customerEmail) row.customerEmail = job.customerEmail;
  if (!row.registration && job.registration) row.registration = job.registration;
  if (!row.vehicle && job.vehicle) row.vehicle = job.vehicle;
  return row;
}

function validateAppointmentInput(body = {}, { partial = false } = {}) {
  const date =
    body.date != null ? appointmentsLib.normalizeDate(body.date) : partial ? undefined : "";
  const startTime =
    body.startTime != null
      ? appointmentsLib.normalizeTime(body.startTime)
      : partial
        ? undefined
        : "";
  if (!partial || body.date != null) {
    appointmentsLib.assertBookableDate(date, todayIso());
  }
  if (!partial || body.startTime != null) {
    if (!startTime) {
      const err = new Error("Start time is required (HH:MM).");
      err.status = 400;
      throw err;
    }
  }
  if (body.status != null && !appointmentsLib.isAppointmentStatus(body.status)) {
    const err = new Error("Choose a valid appointment status.");
    err.status = 400;
    throw err;
  }
  if (body.durationMinutes != null) {
    const duration = Number(body.durationMinutes);
    if (!Number.isFinite(duration) || duration < 15) {
      const err = new Error("Duration must be at least 15 minutes.");
      err.status = 400;
      throw err;
    }
  }
  return { date, startTime };
}

function readSupplierInvoices() {
  return readJsonArray(SUPPLIER_INVOICES_FILE, "supplier invoices");
}

function writeSupplierInvoices(rows) {
  writeJsonArray(SUPPLIER_INVOICES_FILE, rows);
}

function readInvoiceCandidates() {
  return readJsonArray(INVOICE_CANDIDATES_FILE, "invoice candidates");
}

function writeInvoiceCandidates(rows) {
  writeJsonArray(INVOICE_CANDIDATES_FILE, rows);
}

function readPartAuditLogs() {
  return readJsonArray(PART_AUDIT_FILE, "part audit logs");
}

function writePartAuditLogs(rows) {
  writeJsonArray(PART_AUDIT_FILE, rows);
}

function nextJobCardNumber(jobs) {
  const year = todayIso().slice(0, 4);
  const prefix = `JC-${year}-`;
  const nums = jobs
    .map((j) => j.number)
    .filter((n) => typeof n === "string" && n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

function jobNumberFromBilling(number) {
  const parts = billingNumberParts(number);
  if (!parts) return "";
  return `JC-${parts.year}-${String(parts.seq).padStart(4, "0")}`;
}

function reportNumberFromInvoice(number) {
  return String(number || "").trim();
}

function jobTypeFromInvoice(invoice) {
  const id = String(invoice?.preset || "");
  if (id === "wof") return "wof";
  if (id === "basic") return "basic_service";
  if (id === "premium") return "premium_service";
  if (id === "diesel") return "diesel_service";
  if (id === "european") return "european_service";
  if (id === "ppi") return "ppi";
  if (id === "standard") return "standard_service";
  if (id === "standard_wof") return "standard_wof";
  if (id === "premium_wof") return "premium_wof";
  return "repair";
}

function packageFromInvoice(invoice) {
  const id = String(invoice?.preset || "");
  if (id === "premium" || id === "diesel" || id === "european" || id === "ppi" || id === "premium_wof") {
    return "premium";
  }
  if (id === "basic") return "basic";
  return "standard";
}

function alignLinkedReportNumbers(reports) {
  let docs;
  try {
    docs = readJsonArray(BILLING_FILE, "quotes and invoices");
  } catch {
    return false;
  }
  let changed = false;
  for (const report of reports) {
    const invoice =
      (report.invoiceId &&
        docs.find((d) => d.id === report.invoiceId && d.kind === "invoice")) ||
      docs.find((d) => d.reportId === report.id && d.kind === "invoice") ||
      null;
    if (!invoice) continue;
    const preferred = reportNumberFromInvoice(invoice.number);
    if (report.invoiceId !== invoice.id) {
      report.invoiceId = invoice.id;
      changed = true;
    }
    if (report.invoiceNumber !== invoice.number) {
      report.invoiceNumber = invoice.number;
      changed = true;
    }
    if (
      preferred &&
      report.jobNumber !== preferred &&
      !reports.some((row) => row.id !== report.id && row.jobNumber === preferred)
    ) {
      report.jobNumber = preferred;
      changed = true;
    }
  }
  return changed;
}

function assignJobNumber(jobs, billingNumber) {
  const preferred = jobNumberFromBilling(billingNumber);
  if (preferred && !jobs.some((j) => j.number === preferred)) return preferred;
  return nextJobCardNumber(jobs);
}

function alignLinkedJobNumbers(jobs) {
  let docs;
  try {
    docs = readJsonArray(BILLING_FILE, "quotes and invoices");
  } catch {
    return false;
  }
  let changed = false;
  for (const job of jobs) {
    const bill =
      (job.invoiceId && docs.find((d) => d.id === job.invoiceId)) ||
      (job.quoteId && docs.find((d) => d.id === job.quoteId)) ||
      null;
    if (!bill) continue;
    const preferred = jobNumberFromBilling(bill.quotedNumber || bill.number);
    if (!preferred || job.number === preferred) continue;
    if (jobs.some((row) => row.id !== job.id && row.number === preferred)) continue;
    job.number = preferred;
    job.updatedAt = nowIso();
    changed = true;
  }
  return changed;
}

function jobLineItemsPreview(job) {
  const parts = Array.isArray(job?.parts) ? job.parts : [];
  const fromParts = parts
    .map((part) => {
      const description = String(part.description || "").trim();
      if (!description) return "";
      const qty = Number(part.qty);
      const qtyLabel = Number.isFinite(qty) && qty > 0 ? qty : 1;
      const partNumber = String(part.partNumber || "").trim();
      return partNumber ? `${qtyLabel} × ${description} · ${partNumber}` : `${qtyLabel} × ${description}`;
    })
    .filter(Boolean);
  if (fromParts.length) return fromParts.slice(0, 8);
  return String(job?.workRequested || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function summarizeJob(job) {
  const status = jobsLib.normalizeJobStatus(job.status, job.parts);
  const parts = jobsLib.partsSummary(job.parts);
  const workPhotos = sanitizePhotoRefs(job.workPhotos);
  const supplierInvoicePhotos = sanitizePhotoRefs(job.supplierInvoicePhotos);
  return {
    id: job.id,
    number: job.number,
    status,
    customerName: job.customerName,
    customerPhone: job.customerPhone,
    registration: job.registration,
    vehicle: job.vehicle,
    quoteId: job.quoteId || "",
    quoteNumber: job.quoteNumber || "",
    invoiceId: job.invoiceId || "",
    invoiceNumber: job.invoiceNumber || "",
    partsTotal: parts.total,
    partsReceived: parts.received,
    workRequestedPreview: String(job.workRequested || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0] || "",
    lineItemsPreview: jobLineItemsPreview(job),
    workPhotosCount: workPhotos.length,
    supplierInvoicePhotosCount: supplierInvoicePhotos.length,
    readyAt: job.readyAt || "",
    collectedAt: job.collectedAt || "",
    updatedAt: job.updatedAt,
    createdAt: job.createdAt,
  };
}

function supplierInvoiceTrackingSummary(invoice) {
  const jobs = readJobs();
  const supplierKey = normalizeSupplierName(invoice?.supplier);
  const invoiceNoKey = normalizeInvoiceNo(invoice?.invoiceNo);
  let supplierCost = 0;
  let trackedLines = 0;
  for (const job of jobs) {
    const parts = Array.isArray(job.parts) ? job.parts : [];
    for (const part of parts) {
      if (
        normalizeSupplierName(part?.supplier) !== supplierKey ||
        normalizeInvoiceNo(part?.supplierInvoiceNo) !== invoiceNoKey
      ) {
        continue;
      }
      const qty = Number(part.qty) || 0;
      const lineCost = Number(part.lineCostTotal);
      supplierCost += Number.isFinite(lineCost) ? lineCost : qty * (Number(part.costPrice) || 0);
      trackedLines += 1;
    }
  }
  let pendingCost = 0;
  let ignoredCost = 0;
  let consumableCost = 0;
  let toolCost = 0;
  const invoiceId = String(invoice?.id || "").trim();
  for (const row of readInvoiceCandidates()) {
    if (row.supplierInvoiceId !== invoiceId) continue;
    const line = toMoney((Number(row.qtyCandidate) || 0) * (Number(row.costPriceCandidate) || 0));
    if (row.decision === "pending") pendingCost += line;
    if (row.decision === "rejected") ignoredCost += line;
    if (row.decision === "consumable") consumableCost += line;
    if (row.decision === "tool") toolCost += line;
  }
  supplierCost = toMoney(supplierCost);
  pendingCost = toMoney(pendingCost);
  ignoredCost = toMoney(ignoredCost);
  consumableCost = toMoney(consumableCost);
  toolCost = toMoney(toolCost);
  return {
    supplierCost,
    pendingCost,
    ignoredCost,
    consumableCost,
    toolCost,
    trackedLines,
  };
}

function isJobAcceptedCandidateDecision(decision) {
  return decision === "accepted" || decision === "edited_then_accepted";
}

function isShopClassifiedCandidateDecision(decision) {
  return decision === "consumable" || decision === "tool";
}

function isResolvedCandidateDecision(decision) {
  return (
    isJobAcceptedCandidateDecision(decision) ||
    decision === "rejected" ||
    isShopClassifiedCandidateDecision(decision)
  );
}

function billingSourceForJob(docs, id) {
  const doc = docs.find((d) => d.id === id);
  if (!doc) return { error: "Quote not found", status: 404 };
  if (doc.kind === "invoice") {
    if (doc.status === "void") {
      return { error: "This invoice has been voided.", status: 400 };
    }
    const quote =
      (doc.quoteId &&
        docs.find((d) => d.id === doc.quoteId && d.kind === "quote")) ||
      null;
    return { quote: quote || null, invoice: doc, source: quote || doc };
  }
  if (doc.kind !== "quote") {
    return { error: "Only quotes can become job cards.", status: 400 };
  }
  if (doc.status !== "accepted" && doc.status !== "invoiced") {
    return {
      error: "Customer must accept the quote before a job card can be created.",
      status: 400,
    };
  }
  const invoice =
    (doc.invoiceId &&
      docs.find((d) => d.id === doc.invoiceId && d.kind === "invoice")) ||
    null;
  return { quote: doc, invoice, source: doc };
}

function linkJobToBilling(docs, job, quote, invoice) {
  const quoteDoc = quote && quote.kind === "quote" ? quote : null;
  const invoiceDoc =
    invoice && invoice.kind === "invoice"
      ? invoice
      : quote && quote.kind === "invoice"
        ? quote
        : null;
  if (quoteDoc) {
    quoteDoc.jobId = job.id;
    quoteDoc.updatedAt = job.updatedAt;
    job.quoteId = quoteDoc.id;
    job.quoteNumber = quoteDoc.number;
  }
  if (invoiceDoc) {
    invoiceDoc.jobId = job.id;
    invoiceDoc.updatedAt = job.updatedAt;
    job.invoiceId = invoiceDoc.id;
    job.invoiceNumber = invoiceDoc.number;
  }
}

/** Prefer quote/invoice fields, then fill blanks from the customers list. */
function customerFieldsForJob(source = {}) {
  const fields = {
    customerName: String(source.customerName || "").trim(),
    customerEmail: String(source.customerEmail || "").trim(),
    customerPhone: String(source.customerPhone || "").trim(),
    registration: String(source.registration || "").trim().toUpperCase(),
    vehicle: String(source.vehicle || "").trim(),
    odometer: String(source.odometer || "").trim(),
  };

  const plate = plateKey(fields.registration);
  const email = fields.customerEmail.toLowerCase();
  const name = fields.customerName.toLowerCase();

  let match = null;
  let directory = [];
  try {
    directory = listCustomers();
  } catch (err) {
    console.error("Could not match job to customer directory:", err);
  }
  if (plate) {
    match =
      directory.find((row) => {
        const plates = Array.isArray(row.registrations)
          ? row.registrations
          : String(row.registration || "")
              .split(",")
              .map((p) => p.trim());
        const vehiclePlates = (row.vehicles || []).map((v) => v.registration);
        return [...plates, ...vehiclePlates].some((p) => plateKey(p) === plate);
      }) || null;
  }
  if (!match && email && name) {
    match =
      directory.find(
        (row) =>
          String(row.customerEmail || "").trim().toLowerCase() === email &&
          String(row.customerName || "").trim().toLowerCase() === name
      ) || null;
  }
  if (!match && name) {
    const nameMatches = directory.filter(
      (row) => String(row.customerName || "").trim().toLowerCase() === name
    );
    if (nameMatches.length === 1) match = nameMatches[0];
  }

  if (match) {
    if (!fields.customerName) fields.customerName = String(match.customerName || "").trim();
    if (!fields.customerEmail) fields.customerEmail = String(match.customerEmail || "").trim();
    if (!fields.customerPhone) fields.customerPhone = String(match.customerPhone || "").trim();
    if (!fields.registration) {
      fields.registration = String(
        match.registrations?.[0] || match.registration || ""
      )
        .split(",")[0]
        .trim()
        .toUpperCase();
    }
    if (!fields.vehicle) {
      const vehicleRow = (match.vehicles || []).find(
        (v) => plateKey(v.registration) === plate
      );
      fields.vehicle = String(vehicleRow?.vehicle || match.vehicle || "").trim();
    }
  }

  fields.customerName = namesLib.formatFullCustomerName(fields.customerName);
  fields.vehicle = namesLib.capitalizeVehicleDescription(fields.vehicle);
  return fields;
}

function applyCustomerFieldsToJob(job, fields, overwrite = false) {
  let changed = false;
  for (const key of [
    "customerName",
    "customerEmail",
    "customerPhone",
    "registration",
    "vehicle",
    "odometer",
  ]) {
    const next = String(fields[key] || "").trim();
    if (!next) continue;
    const cur = String(job[key] || "").trim();
    if (!overwrite && cur) continue;
    let value = next;
    if (key === "registration") value = next.toUpperCase();
    else if (key === "customerName") value = namesLib.formatFullCustomerName(next);
    else if (key === "vehicle") value = namesLib.capitalizeVehicleDescription(next);
    if (value !== cur) {
      job[key] = value;
      changed = true;
    }
  }
  if (changed) job.updatedAt = nowIso();
  return changed;
}

/** Create a job card from an accepted quote (or return the existing one). */
function ensureJobFromAcceptedQuote(docs, quote, invoice) {
  if (!quote && !invoice) return null;
  const source = quote || invoice;
  const fields = customerFieldsForJob(source);
  const existingId = quote?.jobId || invoice?.jobId || "";
  if (existingId) {
    const jobs = readJobs();
    const index = jobs.findIndex((j) => j.id === existingId);
    if (index >= 0) {
      const existing = jobs[index];
      // Keep appointment/job party details — do not overwrite with a mismatched invoice party.
      const existingName = String(existing.customerName || "").trim().toLowerCase();
      const nextName = String(fields.customerName || "").trim().toLowerCase();
      const existingPlate = plateKey(existing.registration);
      const nextPlate = plateKey(fields.registration);
      const sameParty =
        (!existingName && !existingPlate) ||
        (existingName && nextName && existingName === nextName) ||
        (existingPlate && nextPlate && existingPlate === nextPlate);
      let changed = applyCustomerFieldsToJob(existing, fields, sameParty);
      if (jobsLib.stripPackageParts(existing)) changed = true;
      const cleanedWork = jobsLib.stripPackageWorkRequested(existing.workRequested);
      if (cleanedWork !== String(existing.workRequested || "").trim()) {
        existing.workRequested = cleanedWork;
        changed = true;
      }
      const preferred = jobNumberFromBilling(
        invoice?.number || quote?.quotedNumber || quote?.number || source.number
      );
      if (
        preferred &&
        existing.number !== preferred &&
        !jobs.some((j) => j.id !== existing.id && j.number === preferred)
      ) {
        existing.number = preferred;
        changed = true;
      }
      const quoteParts = jobsLib.partsFromQuoteLines(
        source.lines || quote?.lines || [],
        () => randomUUID()
      );
      if (
        quoteParts.length &&
        !(existing.parts || []).some((p) => String(p.description || "").trim())
      ) {
        existing.parts = quoteParts;
        changed = true;
      }
      if (!String(existing.workRequested || "").trim()) {
        existing.workRequested = jobsLib.workRequestedFromQuote(quote || source);
        if (existing.workRequested) changed = true;
      }
      existing.status = jobsLib.normalizeJobStatus(existing.status, existing.parts);
      if (changed) {
        existing.updatedAt = nowIso();
        jobs[index] = existing;
        writeJobs(jobs);
      }
      return { job: existing, created: false };
    }
  }

  const jobs = readJobs();
  const now = nowIso();
  const parts = jobsLib.partsFromQuoteLines(source.lines || quote?.lines || [], () =>
    randomUUID()
  );
  const job = {
    ...emptyJob(now),
    number: assignJobNumber(
      jobs,
      invoice?.number || quote?.quotedNumber || quote?.number || source.number
    ),
    ...fields,
    workRequested: jobsLib.workRequestedFromQuote(quote || source),
    parts,
    status: jobsLib.normalizeJobStatus("in_progress", parts),
  };
  linkJobToBilling(docs, job, quote || null, invoice || null);
  jobs.push(job);
  writeJobs(jobs);
  return { job, created: true };
}

/** After an invoice is saved: create the job card if needed, then add extra parts. */
function syncJobFromInvoiceExtras(docs, invoice) {
  if (!invoice || invoice.kind !== "invoice" || invoice.status === "void") return null;
  const quote =
    (invoice.quoteId &&
      docs.find((d) => d.id === invoice.quoteId && d.kind === "quote")) ||
    null;
  const ensured = ensureJobFromAcceptedQuote(docs, quote || invoice, invoice);
  if (!ensured?.job) return null;
  const extras = jobsLib.partsFromQuoteLines(invoice.lines || [], () => randomUUID());
  if (!extras.length) return ensured;
  const jobs = readJobs();
  const index = jobs.findIndex((j) => j.id === ensured.job.id);
  if (index < 0) return ensured;
  if (jobsLib.mergeNewParts(jobs[index], extras)) {
    jobs[index].updatedAt = nowIso();
    writeJobs(jobs);
    ensured.job = jobs[index];
  }
  return ensured;
}

function unlinkJobFromBilling(jobId) {
  const docs = readBilling();
  let changed = false;
  for (const doc of docs) {
    if (doc.jobId === jobId) {
      doc.jobId = "";
      doc.updatedAt = nowIso();
      changed = true;
    }
  }
  if (changed) writeBilling(docs);
}

function emptyJob(now) {
  return {
    id: randomUUID(),
    number: "",
    status: "in_progress",
    readyAt: "",
    collectedAt: "",
    createdAt: now,
    updatedAt: now,
    customerId: "",
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    registration: "",
    vehicle: "",
    odometer: "",
    workRequested: "",
    technicianName: "",
    notes: "",
    parts: [],
    workPhotos: [],
    supplierInvoicePhotos: [],
    quoteId: "",
    quoteNumber: "",
    invoiceId: "",
    invoiceNumber: "",
  };
}

function applyJobFields(job, body = {}) {
  const parts =
    body.parts != null
      ? jobsLib.normalizeParts(body.parts, () => randomUUID())
      : job.parts;

  let status = body.status != null ? String(body.status) : job.status;
  if (body.status != null) {
    const known =
      jobsLib.isJobStatus(status) ||
      status === "booked" ||
      status === "waiting_customer" ||
      status === "ready";
    if (!known) {
      const err = new Error("Choose a valid job status.");
      err.status = 400;
      throw err;
    }
  }
  status = jobsLib.normalizeJobStatus(status, parts);
  const previousStatus = jobsLib.normalizeJobStatus(job.status, job.parts || []);
  const changedAt = nowIso();
  const readyAt =
    status === "completed"
      ? previousStatus === "completed"
        ? job.readyAt || job.updatedAt || job.createdAt || changedAt
        : changedAt
      : status === "collected"
        ? job.readyAt || job.updatedAt || job.createdAt || changedAt
        : "";
  const collectedAt =
    status === "collected"
      ? previousStatus === "collected"
        ? job.collectedAt || job.updatedAt || job.createdAt || changedAt
        : changedAt
      : "";

  return {
    ...job,
    status,
    readyAt,
    collectedAt,
    customerName:
      body.customerName != null
        ? namesLib.formatFullCustomerName(String(body.customerName).trim())
        : job.customerName,
    customerEmail:
      body.customerEmail != null ? String(body.customerEmail).trim() : job.customerEmail,
    customerPhone:
      body.customerPhone != null ? String(body.customerPhone).trim() : job.customerPhone,
    registration: String(
      body.registration != null ? body.registration : job.registration
    )
      .trim()
      .toUpperCase(),
    vehicle:
      body.vehicle != null
        ? namesLib.capitalizeVehicleDescription(String(body.vehicle).trim())
        : job.vehicle,
    odometer: body.odometer != null ? String(body.odometer).trim() : job.odometer,
    workRequested:
      body.workRequested != null
        ? catalog.capitalizeLineDescription(body.workRequested)
        : job.workRequested,
    technicianName:
      body.technicianName != null
        ? String(body.technicianName).trim()
        : job.technicianName,
    notes:
      body.notes != null ? catalog.capitalizeLineDescription(body.notes) : job.notes,
    parts,
    updatedAt: changedAt,
  };
}

function toMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100) / 100;
}

function toRatio(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return Math.round(num * 1000) / 1000;
}

function normalizeSupplierName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeInvoiceNo(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizePartNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function sanitizePhotoRefs(input) {
  if (!Array.isArray(input)) return [];
  return input.map((row) => String(row || "").trim()).filter(Boolean).slice(0, 12);
}

function nowActor(req) {
  const staff = staffFromReq(req);
  if (staff?.username) return staff.username;
  const stored = staffContext.getStore();
  if (stored?.staff?.username) return stored.staff.username;
  return "system";
}

function writePartAudit(entityType, entityId, action, beforeSnapshot, afterSnapshot, req, reason) {
  const logs = readPartAuditLogs();
  logs.push({
    id: randomUUID(),
    entityType: String(entityType || "").trim(),
    entityId: String(entityId || "").trim(),
    action: String(action || "").trim(),
    beforeSnapshot: beforeSnapshot || null,
    afterSnapshot: afterSnapshot || null,
    actor: nowActor(req),
    reason: String(reason || "").trim(),
    timestamp: nowIso(),
  });
  if (logs.length > 5000) logs.splice(0, logs.length - 5000);
  writePartAuditLogs(logs);
}

function validateSupplierInvoiceInput(body = {}) {
  const supplier = String(body.supplier || "").trim();
  const invoiceNo = String(body.invoiceNo || "").trim();
  if (!supplier) {
    const err = new Error("Supplier is required.");
    err.status = 400;
    throw err;
  }
  if (!invoiceNo) {
    const err = new Error("Supplier invoice number is required.");
    err.status = 400;
    throw err;
  }
  return {
    supplier,
    invoiceNo,
    invoiceDate: String(body.invoiceDate || "").trim(),
    subtotal: toMoney(body.subtotal),
    tax: toMoney(body.tax),
    total: toMoney(body.total),
    currency: String(body.currency || "NZD").trim().toUpperCase() || "NZD",
    linkedJobId: String(body.linkedJobId || "").trim(),
    notes: String(body.notes || "").trim(),
  };
}

function normalizeSupplierInvoice(row = {}) {
  return {
    id: String(row.id || "").trim(),
    supplier: String(row.supplier || "").trim(),
    invoiceNo: String(row.invoiceNo || "").trim(),
    invoiceDate: String(row.invoiceDate || "").trim(),
    subtotal: toMoney(row.subtotal),
    tax: toMoney(row.tax),
    total: toMoney(row.total),
    currency: String(row.currency || "NZD").trim().toUpperCase() || "NZD",
    status: String(row.status || "uploaded").trim() || "uploaded",
    linkedJobId: String(row.linkedJobId || "").trim(),
    notes: String(row.notes || "").trim(),
    imageRefs: sanitizePhotoRefs(row.imageRefs),
    ocrRawTextRef: String(row.ocrRawTextRef || "").trim(),
    parseVersion: String(row.parseVersion || "v1").trim(),
    createdAt: String(row.createdAt || "").trim(),
    createdBy: String(row.createdBy || "").trim(),
    updatedAt: String(row.updatedAt || "").trim(),
    updatedBy: String(row.updatedBy || "").trim(),
  };
}

function normalizeCandidate(row = {}) {
  const decision = String(row.decision || "pending").trim() || "pending";
  return {
    id: String(row.id || "").trim(),
    supplierInvoiceId: String(row.supplierInvoiceId || "").trim(),
    lineNo: Number(row.lineNo) || 0,
    rawLineText: String(row.rawLineText || "").trim(),
    partNumberCandidate: String(row.partNumberCandidate || "").trim(),
    descriptionCandidate: String(row.descriptionCandidate || "").trim(),
    qtyCandidate: Math.max(0, Math.round(Number(row.qtyCandidate) || 1)),
    costPriceCandidate: toMoney(row.costPriceCandidate),
    supplierCandidate: String(row.supplierCandidate || "").trim(),
    confidence: toRatio(row.confidence),
    suggestedJobId: String(row.suggestedJobId || "").trim(),
    suggestedPartId: String(row.suggestedPartId || "").trim(),
    matchReason: String(row.matchReason || "").trim(),
    matchScore: toRatio(row.matchScore),
    appliedJobId: String(row.appliedJobId || "").trim(),
    appliedPartId: String(row.appliedPartId || "").trim(),
    splitFromId: String(row.splitFromId || "").trim(),
    decision,
    decidedAt: String(row.decidedAt || "").trim(),
    decidedBy: String(row.decidedBy || "").trim(),
    createdAt: String(row.createdAt || "").trim(),
    updatedAt: String(row.updatedAt || "").trim(),
  };
}

function toQty(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.max(0, Math.round(n));
}

function nextCandidateLineNo(rows, invoiceId) {
  return (
    rows
      .filter((row) => row.supplierInvoiceId === invoiceId)
      .reduce((max, row) => Math.max(max, Number(row.lineNo) || 0), 0) + 1
  );
}

function insertRemainderCandidate(candidateRows, sourceIndex, remainderQty, now) {
  const source = candidateRows[sourceIndex];
  if (!(remainderQty > 0)) return null;
  const leftover = normalizeCandidate({
    ...source,
    id: randomUUID(),
    lineNo: nextCandidateLineNo(candidateRows, source.supplierInvoiceId),
    qtyCandidate: remainderQty,
    decision: "pending",
    suggestedJobId: "",
    suggestedPartId: "",
    appliedJobId: "",
    appliedPartId: "",
    decidedAt: "",
    decidedBy: "",
    matchScore: 0,
    matchReason: "remainder to allocate",
    splitFromId: source.splitFromId || source.id,
    createdAt: now,
    updatedAt: now,
  });
  candidateRows.splice(sourceIndex + 1, 0, leftover);
  return leftover;
}

function parseCandidatesFromRawText(rawText, supplier) {
  const rows = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 150);
  const items = [];
  for (let i = 0; i < rows.length; i += 1) {
    const line = rows[i];
    if (line.length < 3) continue;
    const tokens = line.split(/\s+/).filter(Boolean);
    const partNumberCandidate =
      tokens.find((t) => /^[A-Za-z0-9-]{4,}$/.test(t) && /[A-Za-z]/.test(t)) || "";
    const qtyMatch = line.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:x|qty\b)/i);
    const qtyCandidate = qtyMatch ? Math.max(0, Number(qtyMatch[1]) || 0) : 1;
    const moneyMatches = [...line.matchAll(/\$?\s*(\d+(?:\.\d{1,2})?)/g)];
    const costPriceCandidate = moneyMatches.length
      ? toMoney(moneyMatches[moneyMatches.length - 1][1])
      : 0;
    const descriptionCandidate = line
      .replace(partNumberCandidate, "")
      .replace(/(?:^|\s)\d+(?:\.\d+)?\s*(?:x|qty\b)/gi, " ")
      .replace(/\$?\s*\d+(?:\.\d{1,2})?/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    let confidence = 0.3;
    if (partNumberCandidate) confidence += 0.2;
    if (descriptionCandidate) confidence += 0.2;
    if (costPriceCandidate > 0) confidence += 0.2;
    if (qtyCandidate > 0) confidence += 0.1;
    items.push({
      lineNo: i + 1,
      rawLineText: line,
      partNumberCandidate,
      descriptionCandidate,
      qtyCandidate: qtyCandidate || 1,
      costPriceCandidate,
      supplierCandidate: supplier,
      confidence: Math.min(0.99, confidence),
    });
  }
  return items;
}

function parseCandidatesFromPayload(body = {}, supplier) {
  if (Array.isArray(body.lines) && body.lines.length) {
    return body.lines.slice(0, 200).map((line, idx) => ({
      lineNo: Number(line.lineNo) || idx + 1,
      rawLineText: String(line.rawLineText || line.description || "").trim(),
      partNumberCandidate: String(line.partNumberCandidate || line.partNumber || "").trim(),
      descriptionCandidate: String(line.descriptionCandidate || line.description || "").trim(),
      qtyCandidate: Number.isFinite(Number(line.qtyCandidate ?? line.qty))
        ? Number(line.qtyCandidate ?? line.qty)
        : 1,
      costPriceCandidate: toMoney(line.costPriceCandidate ?? line.costPrice),
      supplierCandidate: String(line.supplierCandidate || supplier).trim(),
      confidence: toRatio(line.confidence) ?? 0.6,
    }));
  }
  return parseCandidatesFromRawText(body.rawText || "", supplier);
}

function normalizeInvoiceDateInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return raw;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (!day || !month || !year) return raw;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;
}

function parseSupplierInvoiceText(rawText) {
  const text = String(rawText || "");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const supplierLine =
    lines.find((line) => /repco|bnt|supercheap|napa|partsmaster|autoparts/i.test(line)) ||
    lines.find((line) => /^[A-Z][A-Z\s&.'-]{2,}$/.test(line) && !/invoice|bill to|date/i.test(line)) ||
    "";
  const supplier = supplierLine.replace(/\s+sample.*$/i, "").trim();

  const invoiceNo =
    (text.match(
      /(?:sample\s*no|invoice\s*(?:number|no|#)|tax\s*invoice\s*(?:number|no|#)|inv\s*#)\s*[:\-]?\s*([A-Z0-9-]+)/i
    ) || [])[1] || "";
  const dateRaw = (text.match(/(?:invoice\s*)?date\s*[:\-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i) || [])[1] || "";
  const invoiceDate = normalizeInvoiceDateInput(dateRaw);
  const subtotal = Number((text.match(/subtotal[^\d$]*\$?\s*(\d+(?:\.\d{1,2})?)/i) || [])[1] || 0);
  const tax = Number((text.match(/(?:gst|tax)[^\d$]*\$?\s*(\d+(?:\.\d{1,2})?)/i) || [])[1] || 0);
  const total = Number((text.match(/(?:^|\n)\s*total[^\d$]*\$?\s*(\d+(?:\.\d{1,2})?)/im) || [])[1] || 0);

  let candidates = [];
  const headerIndex = lines.findIndex((line) =>
    /qty.*description.*(?:part\s*no|part\s*number).*unit.*total/i.test(line)
  );
  if (headerIndex >= 0) {
    for (let i = headerIndex + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (/subtotal|gst|tax|total/i.test(line)) break;
      const m = line.match(
        /^(\d+(?:\.\d+)?)\s+(.+?)\s+([A-Za-z0-9-]{3,})\s+\$?\s*(\d+(?:\.\d{1,2})?)\s+\$?\s*(\d+(?:\.\d{1,2})?)$/
      );
      if (!m) continue;
      candidates.push({
        lineNo: i + 1,
        rawLineText: line,
        qtyCandidate: Number(m[1]) || 1,
        descriptionCandidate: String(m[2] || "").trim(),
        partNumberCandidate: String(m[3] || "").trim(),
        costPriceCandidate: toMoney(m[4]),
        supplierCandidate: supplier,
        confidence: 0.92,
      });
    }
  }
  if (!candidates.length) {
    candidates = parseCandidatesFromRawText(text, supplier);
  }
  return {
    supplier,
    invoiceNo: String(invoiceNo || "").trim(),
    invoiceDate,
    subtotal: toMoney(subtotal),
    tax: toMoney(tax),
    total: toMoney(total),
    rawText: text,
    candidates,
  };
}

async function extractTextFromImportFile(file) {
  if (!file?.buffer?.length) return "";
  if (file.mimetype === "application/pdf") {
    if (pdfParseLegacy) {
      const parsed = await pdfParseLegacy(file.buffer);
      return String(parsed?.text || "").trim();
    }
    if (PDFParseClass) {
      const parser = new PDFParseClass({ data: file.buffer });
      try {
        const result = await parser.getText();
        return String(result?.text || "").trim();
      } finally {
        await parser.destroy().catch(() => {});
      }
    }
    if (!pdfParseLegacy && !PDFParseClass) {
      const err = new Error("PDF parser is not available on this server.");
      err.status = 500;
      throw err;
    }
  }
  if (file.mimetype.startsWith("image/")) {
    const result = await Tesseract.recognize(file.buffer, "eng", {
      logger: () => {},
    });
    return String(result?.data?.text || "").trim();
  }
  return "";
}

function suggestCandidateMatch(candidate, jobs, invoice) {
  const partNoKey = normalizePartNumber(candidate.partNumberCandidate);
  const supplierKey = normalizeSupplierName(
    candidate.supplierCandidate || invoice?.supplier || ""
  );
  const invoiceNoKey = normalizeInvoiceNo(invoice?.invoiceNo || "");
  const descKey = String(candidate.descriptionCandidate || "")
    .trim()
    .toLowerCase();
  let best = { jobId: "", partId: "", score: 0, reason: "" };

  for (const job of jobs) {
    const rows = Array.isArray(job.parts) ? job.parts : [];
    for (const part of rows) {
      let score = 0;
      const partSupplierKey = normalizeSupplierName(part.supplier);
      const partInvoiceKey = normalizeInvoiceNo(part.supplierInvoiceNo);
      const partNumberKey = normalizePartNumber(part.partNumber);
      const partDescKey = String(part.description || "").trim().toLowerCase();
      if (supplierKey && supplierKey === partSupplierKey) score += 0.25;
      if (invoiceNoKey && invoiceNoKey === partInvoiceKey) score += 0.35;
      if (partNoKey && partNoKey === partNumberKey) score += 0.35;
      if (
        descKey &&
        partDescKey &&
        (partDescKey.includes(descKey) || descKey.includes(partDescKey))
      ) {
        score += 0.2;
      }
      if (score > best.score) {
        best = {
          jobId: String(job.id || ""),
          partId: String(part.id || ""),
          score: Math.min(1, score),
          reason:
            score >= 0.95
              ? "supplier+invoice+part number match"
              : score >= 0.7
                ? "strong supplier/part match"
                : "description similarity",
        };
      }
    }
  }

  if (!best.jobId && invoice?.linkedJobId) {
    best = {
      jobId: invoice.linkedJobId,
      partId: "",
      score: Math.max(best.score, 0.5),
      reason: "linked supplier invoice job",
    };
  }
  return best;
}

function rematchCandidatesForInvoice(invoiceId) {
  const invoices = readSupplierInvoices();
  const invoice = invoices.find((row) => row.id === invoiceId);
  if (!invoice) {
    const err = new Error("Supplier invoice not found");
    err.status = 404;
    throw err;
  }
  const candidates = readInvoiceCandidates();
  const jobs = readJobs();
  const now = nowIso();
  let changed = false;
  for (const row of candidates) {
    if (row.supplierInvoiceId !== invoiceId) continue;
    if (row.decision && row.decision !== "pending") continue;
    const hit = suggestCandidateMatch(row, jobs, invoice);
    const nextScore = toRatio(hit.score);
    const nextJob = hit.jobId || "";
    const nextPart = hit.partId || "";
    const nextReason = hit.reason || "";
    if (
      row.suggestedJobId !== nextJob ||
      row.suggestedPartId !== nextPart ||
      row.matchReason !== nextReason ||
      row.matchScore !== nextScore
    ) {
      row.suggestedJobId = nextJob;
      row.suggestedPartId = nextPart;
      row.matchReason = nextReason;
      row.matchScore = nextScore;
      row.updatedAt = now;
      changed = true;
    }
  }
  if (changed) writeInvoiceCandidates(candidates);
  return candidates.filter((row) => row.supplierInvoiceId === invoiceId);
}

function refreshSupplierInvoiceStatus(invoiceId) {
  const invoices = readSupplierInvoices();
  const idx = invoices.findIndex((row) => row.id === invoiceId);
  if (idx < 0) return null;
  const invoice = invoices[idx];
  const candidates = readInvoiceCandidates().filter((row) => row.supplierInvoiceId === invoiceId);
  const total = candidates.length;
  const resolved = candidates.filter((row) => isResolvedCandidateDecision(row.decision)).length;
  const accepted = candidates.filter((row) => isJobAcceptedCandidateDecision(row.decision)).length;
  let nextStatus = invoice.status || "uploaded";
  if (!total) nextStatus = invoice.imageRefs?.length ? "uploaded" : "uploaded";
  else if (resolved === total) nextStatus = "approved";
  else if (accepted > 0 || resolved > 0) nextStatus = "partially_matched";
  else nextStatus = "parsed";
  if (nextStatus !== invoice.status) {
    invoice.status = nextStatus;
    invoice.updatedAt = nowIso();
    invoices[idx] = invoice;
    writeSupplierInvoices(invoices);
  }
  return invoice;
}

function acceptInvoiceCandidate(candidateId, req, decisionMode = "accepted") {
  const candidateRows = readInvoiceCandidates();
  const candidateIndex = candidateRows.findIndex((row) => row.id === candidateId);
  if (candidateIndex < 0) {
    const err = new Error("Candidate not found");
    err.status = 404;
    throw err;
  }
  const currentCandidate = normalizeCandidate(candidateRows[candidateIndex]);
  if (currentCandidate.decision !== "pending") {
    const err = new Error("Candidate has already been decided.");
    err.status = 400;
    throw err;
  }
  const invoice = readSupplierInvoices().find((row) => row.id === currentCandidate.supplierInvoiceId);
  if (!invoice) {
    const err = new Error("Supplier invoice not found");
    err.status = 404;
    throw err;
  }
  const jobs = readJobs();
  const body = req.body || {};
  const jobId =
    String(body.jobId || "").trim() ||
    currentCandidate.suggestedJobId ||
    String(invoice.linkedJobId || "").trim();
  const jobIndex = jobs.findIndex((row) => row.id === jobId);
  if (jobIndex < 0) {
    const err = new Error("No target job selected. Provide jobId or run auto-match again.");
    err.status = 400;
    throw err;
  }
  const now = nowIso();
  const incoming = body.part || {};
  const originalQty = toQty(currentCandidate.qtyCandidate, 1);
  const allocatedQty = toQty(incoming.qty ?? originalQty, originalQty);
  if (allocatedQty <= 0) {
    const err = new Error("Qty must be greater than 0. Use Ignore for unused lines.");
    err.status = 400;
    throw err;
  }
  if (allocatedQty > originalQty) {
    const err = new Error(`This line only has ${originalQty} left to allocate.`);
    err.status = 400;
    throw err;
  }
  const remainderQty = toQty(originalQty - allocatedQty, 0);
  const part = jobsLib.normalizePart(
    {
      id: randomUUID(),
      partNumber: incoming.partNumber ?? currentCandidate.partNumberCandidate,
      description: incoming.description ?? currentCandidate.descriptionCandidate,
      supplier: incoming.supplier ?? currentCandidate.supplierCandidate ?? invoice.supplier,
      qty: allocatedQty,
      costPrice: incoming.costPrice ?? currentCandidate.costPriceCandidate ?? 0,
      markupPercent: incoming.markupPercent ?? 25,
      sellPrice: incoming.sellPrice,
      supplierInvoiceNo:
        incoming.supplierInvoiceNo ?? invoice.invoiceNo ?? currentCandidate.supplierInvoiceNo,
      supplierInvoiceDate: incoming.supplierInvoiceDate ?? invoice.invoiceDate,
      ordered: incoming.ordered ?? true,
      received: incoming.received ?? true,
      source: "ocr",
      status: "approved",
      ocrConfidence: incoming.ocrConfidence ?? currentCandidate.confidence,
      matchScore: incoming.matchScore ?? currentCandidate.matchScore,
      photoRefs: sanitizePhotoRefs(invoice.imageRefs),
      createdAt: now,
      createdBy: nowActor(req),
      updatedAt: now,
      updatedBy: nowActor(req),
    },
    randomUUID()
  );
  const beforeJob = { ...(jobs[jobIndex] || {}) };
  const parts = Array.isArray(jobs[jobIndex].parts) ? [...jobs[jobIndex].parts] : [];
  parts.push(part);
  jobs[jobIndex].parts = jobsLib.normalizeParts(parts, () => randomUUID());
  jobs[jobIndex].status = jobsLib.normalizeJobStatus(jobs[jobIndex].status, jobs[jobIndex].parts);
  jobs[jobIndex].updatedAt = now;
  writeJobs(jobs);

  const beforeCandidate = { ...candidateRows[candidateIndex] };
  candidateRows[candidateIndex] = normalizeCandidate({
    ...currentCandidate,
    qtyCandidate: allocatedQty,
    decision: decisionMode === "edited_then_accepted" ? "edited_then_accepted" : "accepted",
    decidedAt: now,
    decidedBy: nowActor(req),
    suggestedJobId: jobs[jobIndex].id,
    appliedJobId: jobs[jobIndex].id,
    appliedPartId: part.id,
    matchReason: currentCandidate.matchReason || "accepted by user",
    updatedAt: now,
  });
  const remainderCandidate = insertRemainderCandidate(
    candidateRows,
    candidateIndex,
    remainderQty,
    now
  );
  writeInvoiceCandidates(candidateRows);
  const invoiceAfter = refreshSupplierInvoiceStatus(currentCandidate.supplierInvoiceId);
  writePartAudit("jobPart", part.id, "approve", null, part, req, "candidate accepted");
  writePartAudit(
    "invoiceCandidate",
    currentCandidate.id,
    "approve",
    beforeCandidate,
    candidateRows[candidateIndex],
    req,
    decisionMode === "edited_then_accepted" ? "candidate edited+accepted" : "candidate accepted"
  );
  writePartAudit(
    "job",
    jobs[jobIndex].id,
    "update",
    beforeJob,
    jobs[jobIndex],
    req,
    "part imported from supplier invoice"
  );
  return {
    candidate: candidateRows[candidateIndex],
    remainderCandidate,
    jobPart: part,
    jobId: jobs[jobIndex].id,
    supplierInvoice: invoiceAfter || invoice,
  };
}

function editMatchedCandidate(candidateId, req) {
  const candidateRows = readInvoiceCandidates();
  const candidateIndex = candidateRows.findIndex((row) => row.id === candidateId);
  if (candidateIndex < 0) {
    const err = new Error("Candidate not found");
    err.status = 404;
    throw err;
  }
  const candidate = normalizeCandidate(candidateRows[candidateIndex]);
  if (candidate.decision !== "accepted" && candidate.decision !== "edited_then_accepted") {
    const err = new Error("Only matched candidates can be edited.");
    err.status = 400;
    throw err;
  }
  if (!candidate.appliedPartId) {
    const err = new Error("Matched part link is missing. Unmatch then re-accept this line.");
    err.status = 400;
    throw err;
  }

  const jobs = readJobs();
  const body = req.body || {};
  const targetJobId = String(body.jobId || "").trim() || candidate.appliedJobId || candidate.suggestedJobId;
  const sourceJobIndex = jobs.findIndex((job) => job.id === candidate.appliedJobId);
  const targetJobIndex = jobs.findIndex((job) => job.id === targetJobId);
  if (sourceJobIndex < 0 || targetJobIndex < 0) {
    const err = new Error("Linked job not found.");
    err.status = 404;
    throw err;
  }
  const sourceParts = Array.isArray(jobs[sourceJobIndex].parts) ? [...jobs[sourceJobIndex].parts] : [];
  const sourcePartIndex = sourceParts.findIndex((part) => part.id === candidate.appliedPartId);
  if (sourcePartIndex < 0) {
    const err = new Error("Linked part not found on job.");
    err.status = 404;
    throw err;
  }

  const existingPart = sourceParts[sourcePartIndex];
  if (existingPart.status === "billed") {
    const err = new Error("This part is already billed and cannot be edited.");
    err.status = 400;
    throw err;
  }
  const incoming = body.part || {};
  const now = nowIso();
  const originalQty = toQty(existingPart.qty ?? candidate.qtyCandidate, 1);
  const allocatedQty = toQty(incoming.qty ?? originalQty, originalQty);
  if (allocatedQty <= 0) {
    const err = new Error("Qty must be greater than 0. Unmatch or Ignore unused lines.");
    err.status = 400;
    throw err;
  }
  if (allocatedQty > originalQty) {
    const err = new Error(`This matched line only has ${originalQty}. Unmatch first to add more.`);
    err.status = 400;
    throw err;
  }
  const remainderQty = toQty(originalQty - allocatedQty, 0);
  const updatedPart = jobsLib.normalizePart(
    {
      ...existingPart,
      partNumber: incoming.partNumber ?? existingPart.partNumber,
      description: incoming.description ?? existingPart.description,
      qty: allocatedQty,
      costPrice: incoming.costPrice ?? existingPart.costPrice,
      markupPercent: incoming.markupPercent ?? existingPart.markupPercent,
      sellPrice: incoming.sellPrice ?? existingPart.sellPrice,
      supplier: incoming.supplier ?? existingPart.supplier,
      supplierInvoiceNo: incoming.supplierInvoiceNo ?? existingPart.supplierInvoiceNo,
      supplierInvoiceDate: incoming.supplierInvoiceDate ?? existingPart.supplierInvoiceDate,
      updatedAt: now,
      updatedBy: nowActor(req),
    },
    existingPart.id
  );

  if (sourceJobIndex === targetJobIndex) {
    sourceParts[sourcePartIndex] = updatedPart;
    jobs[sourceJobIndex].parts = jobsLib.normalizeParts(sourceParts, () => randomUUID());
    jobs[sourceJobIndex].status = jobsLib.normalizeJobStatus(
      jobs[sourceJobIndex].status,
      jobs[sourceJobIndex].parts
    );
    jobs[sourceJobIndex].updatedAt = now;
  } else {
    sourceParts.splice(sourcePartIndex, 1);
    jobs[sourceJobIndex].parts = jobsLib.normalizeParts(sourceParts, () => randomUUID());
    jobs[sourceJobIndex].status = jobsLib.normalizeJobStatus(
      jobs[sourceJobIndex].status,
      jobs[sourceJobIndex].parts
    );
    jobs[sourceJobIndex].updatedAt = now;

    const targetParts = Array.isArray(jobs[targetJobIndex].parts) ? [...jobs[targetJobIndex].parts] : [];
    targetParts.push(updatedPart);
    jobs[targetJobIndex].parts = jobsLib.normalizeParts(targetParts, () => randomUUID());
    jobs[targetJobIndex].status = jobsLib.normalizeJobStatus(
      jobs[targetJobIndex].status,
      jobs[targetJobIndex].parts
    );
    jobs[targetJobIndex].updatedAt = now;
  }
  writeJobs(jobs);

  const beforeCandidate = { ...candidateRows[candidateIndex] };
  candidateRows[candidateIndex] = normalizeCandidate({
    ...candidate,
    decision: "edited_then_accepted",
    partNumberCandidate: updatedPart.partNumber,
    descriptionCandidate: updatedPart.description,
    qtyCandidate: updatedPart.qty,
    costPriceCandidate: updatedPart.costPrice,
    suggestedJobId: jobs[targetJobIndex].id,
    appliedJobId: jobs[targetJobIndex].id,
    appliedPartId: updatedPart.id,
    matchReason: remainderQty > 0 ? "qty split for other jobs" : "edited after match",
    updatedAt: now,
  });
  const remainderCandidate = insertRemainderCandidate(
    candidateRows,
    candidateIndex,
    remainderQty,
    now
  );
  writeInvoiceCandidates(candidateRows);
  const supplierInvoice = refreshSupplierInvoiceStatus(candidate.supplierInvoiceId);
  writePartAudit("jobPart", updatedPart.id, "update", existingPart, updatedPart, req, "matched part edited");
  writePartAudit(
    "invoiceCandidate",
    candidate.id,
    "update",
    beforeCandidate,
    candidateRows[candidateIndex],
    req,
    "matched candidate edited"
  );
  return {
    candidate: candidateRows[candidateIndex],
    remainderCandidate,
    jobPart: updatedPart,
    jobId: jobs[targetJobIndex].id,
    supplierInvoice,
  };
}

function findCandidateLinkedPart(jobs, candidate) {
  const jobId = candidate.appliedJobId || candidate.suggestedJobId;
  const jobIndex = jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) return null;
  const parts = Array.isArray(jobs[jobIndex].parts) ? jobs[jobIndex].parts : [];
  let partIndex = -1;
  if (candidate.appliedPartId) {
    partIndex = parts.findIndex((part) => part.id === candidate.appliedPartId);
  }
  if (partIndex < 0) {
    partIndex = parts.findIndex((part) => {
      const samePartNo =
        candidate.partNumberCandidate &&
        String(part.partNumber || "").trim() === candidate.partNumberCandidate;
      const sameName =
        candidate.descriptionCandidate &&
        String(part.description || "").trim().toLowerCase() ===
          candidate.descriptionCandidate.toLowerCase();
      return samePartNo || sameName;
    });
  }
  if (partIndex < 0) return null;
  return { jobIndex, partIndex, part: parts[partIndex] };
}

function unmatchInvoiceCandidate(candidateId, req) {
  const candidateRows = readInvoiceCandidates();
  const candidateIndex = candidateRows.findIndex((row) => row.id === candidateId);
  if (candidateIndex < 0) {
    const err = new Error("Candidate not found");
    err.status = 404;
    throw err;
  }
  const candidate = normalizeCandidate(candidateRows[candidateIndex]);
  const wasAccepted = isJobAcceptedCandidateDecision(candidate.decision);
  const wasIgnored = candidate.decision === "rejected";
  const wasShopClassified = isShopClassifiedCandidateDecision(candidate.decision);
  if (!wasAccepted && !wasIgnored && !wasShopClassified && candidate.decision !== "pending") {
    const err = new Error("This line cannot be restored.");
    err.status = 400;
    throw err;
  }

  const jobs = readJobs();
  let removedPart = null;
  if (wasAccepted) {
    const linked = findCandidateLinkedPart(jobs, candidate);
    if (linked) {
      if (linked.part.status === "billed") {
        const err = new Error("This part is already billed. Unmatch is not allowed.");
        err.status = 400;
        throw err;
      }
      const parts = [...(jobs[linked.jobIndex].parts || [])];
      removedPart = parts[linked.partIndex];
      parts.splice(linked.partIndex, 1);
      jobs[linked.jobIndex].parts = jobsLib.normalizeParts(parts, () => randomUUID());
      jobs[linked.jobIndex].status = jobsLib.normalizeJobStatus(
        jobs[linked.jobIndex].status,
        jobs[linked.jobIndex].parts
      );
      jobs[linked.jobIndex].updatedAt = nowIso();
      writeJobs(jobs);
    }
  }

  const now = nowIso();
  const beforeCandidate = { ...candidateRows[candidateIndex] };
  candidateRows[candidateIndex] = normalizeCandidate({
    ...candidate,
    decision: "pending",
    suggestedJobId: "",
    suggestedPartId: "",
    appliedJobId: "",
    appliedPartId: "",
    matchScore: 0,
    decidedAt: "",
    decidedBy: "",
    matchReason: wasIgnored
      ? "restored from ignored"
      : wasShopClassified
        ? `restored from ${candidate.decision}`
        : "unmatched for review",
    updatedAt: now,
  });
  writeInvoiceCandidates(candidateRows);
  const supplierInvoice = refreshSupplierInvoiceStatus(candidate.supplierInvoiceId);
  if (removedPart) {
    writePartAudit("jobPart", removedPart.id, "delete", removedPart, null, req, "candidate unmatched");
  }
  writePartAudit(
    "invoiceCandidate",
    candidate.id,
    "update",
    beforeCandidate,
    candidateRows[candidateIndex],
    req,
    wasIgnored
      ? "candidate restored from ignored"
      : wasShopClassified
        ? `candidate restored from ${candidate.decision}`
        : "candidate unmatched"
  );
  return {
    candidate: candidateRows[candidateIndex],
    removedPartId: removedPart?.id || "",
    supplierInvoice,
  };
}

function writeSavedCustomers(rows) {
  writeJsonArray(CUSTOMERS_FILE, rows);
  bumpCustomerHighWater(rows);
}

function nzCalendarDate(iso) {
  const raw = String(iso || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10)) && raw.length <= 10) {
    return raw.slice(0, 10);
  }
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return raw.slice(0, 10);
  return todayIso(new Date(t));
}

function customerSeqOf(row) {
  return Number(row?.customerSeq || row?.dailySeq) || 0;
}

function readCustomerSeqMap() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CUSTOMERS_SEQ_FILE, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    /* first run */
  }
  return { last: 0 };
}

function writeCustomerSeqMap(map) {
  fs.mkdirSync(path.dirname(CUSTOMERS_SEQ_FILE), { recursive: true });
  fs.writeFileSync(CUSTOMERS_SEQ_FILE, `${JSON.stringify(map, null, 2)}\n`);
}

function bumpCustomerHighWater(rows) {
  const map = readCustomerSeqMap();
  let last = Number(map.last) || 0;
  for (const row of rows || []) {
    const n = customerSeqOf(row);
    if (n > last) last = n;
  }
  if (last !== Number(map.last) || !fs.existsSync(CUSTOMERS_SEQ_FILE)) {
    try {
      writeCustomerSeqMap({ last });
    } catch (err) {
      console.error("Could not save customer sequence:", err);
    }
  }
  return last;
}

function nextCustomerSeq(rows) {
  const last = bumpCustomerHighWater(rows);
  const seq = last + 1;
  try {
    writeCustomerSeqMap({ last: seq });
  } catch (err) {
    console.error("Could not save customer sequence:", err);
  }
  return seq;
}

function customerNumbersNeedRenumber(rows) {
  const seen = new Set();
  for (const row of rows || []) {
    const n = customerSeqOf(row);
    if (!(n > 0) || seen.has(n)) return true;
    seen.add(n);
  }
  return false;
}

function ensureUniqueCustomerNumbers(rows) {
  const ordered = [...(rows || [])].sort((a, b) => {
    const byDate = String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    if (byDate) return byDate;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  if (!customerNumbersNeedRenumber(ordered)) {
    bumpCustomerHighWater(ordered);
    return false;
  }
  ordered.forEach((row, index) => {
    const seq = index + 1;
    row.customerSeq = seq;
    row.dailySeq = seq;
    row.dailySeqDate = "";
  });
  try {
    writeCustomerSeqMap({ last: ordered.length });
  } catch (err) {
    console.error("Could not save customer sequence:", err);
  }
  return true;
}

function normalizeVehicles(body = {}, current = {}) {
  let raw = [];
  if (Array.isArray(body.vehicles)) {
    raw = body.vehicles;
  } else if (body.registration != null && String(body.registration).trim()) {
    raw = [
      {
        registration: body.registration,
        vehicle: body.vehicle || "",
      },
    ];
  } else if (Array.isArray(current.vehicles) && current.vehicles.length) {
    raw = current.vehicles;
  } else if (current.registration) {
    raw = [
      {
        registration: current.registration,
        vehicle: current.vehicle || "",
      },
    ];
  }

  const currentByPlate = new Map();
  for (const v of Array.isArray(current.vehicles) ? current.vehicles : []) {
    const k = plateKey(v.registration);
    if (k) currentByPlate.set(k, v);
  }

  const vehicles = [];
  const seen = new Set();
  for (const row of raw) {
    const registration = String(row?.registration || "")
      .trim()
      .toUpperCase();
    if (!registration) continue;
    const key = plateKey(registration);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const prev = currentByPlate.get(key);
    vehicles.push({
      id: row.id || prev?.id || randomUUID(),
      registration,
      vehicle: namesLib.capitalizeVehicleDescription(
        String(row?.vehicle || prev?.vehicle || "").trim()
      ),
      wofExpiry: String(row?.wofExpiry || prev?.wofExpiry || "").trim(),
      wofReminderSentAt: String(row?.wofReminderSentAt || prev?.wofReminderSentAt || "").trim(),
      wofSmsReminderSentAt: String(
        row?.wofSmsReminderSentAt || prev?.wofSmsReminderSentAt || ""
      ).trim(),
    });
  }
  return vehicles;
}

function splitFullName(full) {
  const parts = String(full || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function composeCustomerName(firstName, lastName, fallback = "") {
  const joined = [String(firstName || "").trim(), String(lastName || "").trim()]
    .filter(Boolean)
    .join(" ");
  return joined || String(fallback || "").trim();
}

function namesFromCustomer(row = {}) {
  let firstName = String(row.firstName || "").trim();
  let lastName = String(row.lastName || "").trim();
  if (!firstName && !lastName) {
    const split = splitFullName(row.customerName);
    firstName = split.firstName;
    lastName = split.lastName;
  }
  firstName = namesLib.capitalizeGivenName(firstName);
  lastName = namesLib.uppercaseFamilyName(lastName);
  return {
    firstName,
    lastName,
    customerName: composeCustomerName(firstName, lastName, row.customerName),
  };
}

function normalizeSavedCustomer(body, current = {}) {
  const hasParts =
    (body?.firstName != null && String(body.firstName).trim() !== "") ||
    (body?.lastName != null && String(body.lastName).trim() !== "");
  const hasFullName = body?.customerName != null && String(body.customerName).trim() !== "";
  // If the client only sends customerName (no first/last), re-split it.
  // Otherwise keeping current first/last would ignore the new full name.
  const fromBody = namesFromCustomer(
    hasParts
      ? {
          firstName: body?.firstName ?? current.firstName,
          lastName: body?.lastName ?? current.lastName,
          customerName: body?.customerName ?? current.customerName,
        }
      : hasFullName
        ? { customerName: body.customerName }
        : {
            firstName: current.firstName,
            lastName: current.lastName,
            customerName: current.customerName,
          }
  );
  const firstName = fromBody.firstName;
  const lastName = fromBody.lastName;
  const customerName = fromBody.customerName;
  const customerAddress = String(body?.customerAddress ?? current.customerAddress ?? "").trim();
  const customerPhone = String(body?.customerPhone ?? current.customerPhone ?? "").trim();
  const vehicles = applyCustomerVehicles(body || {}, current || {});
  if (!firstName) {
    const err = new Error("First name is required.");
    err.status = 400;
    throw err;
  }
  if (!lastName) {
    const err = new Error("Last name is required.");
    err.status = 400;
    throw err;
  }
  if (!vehicles.length) {
    const err = new Error("Add at least one registration / plate.");
    err.status = 400;
    throw err;
  }
  return {
    firstName,
    lastName,
    customerName,
    customerAddress,
    customerPhone,
    customerEmail: String(body?.customerEmail ?? current.customerEmail ?? "").trim(),
    vehicles,
    registration: vehicles[0].registration,
  };
}

function plateKey(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
}

function customerNameKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function invoiceBlocksCustomerDelete(customer) {
  const id = String(customer?.id || customer?.customerId || "");
  const plates = new Set(
    normalizeVehicles(customer, customer)
      .map((v) => plateKey(v.registration))
      .filter(Boolean)
  );
  return readBilling().some((d) => {
    if (d.kind !== "invoice" || d.status === "void") return false;
    if (id && d.customerId && d.customerId === id) return true;
    const plate = plateKey(d.registration);
    return Boolean(plate && plates.has(plate));
  });
}

function findCustomerWithSameName(rows, name, exceptId = "") {
  const key = customerNameKey(name);
  if (!key) return null;
  return (
    rows.find(
      (row) =>
        row.id !== exceptId &&
        customerNameKey(namesFromCustomer(row).customerName) === key
    ) || null
  );
}

function emailKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function findCustomerWithSameEmail(rows, email, exceptId = "") {
  const key = emailKey(email);
  if (!key) return null;
  return (
    rows.find((row) => row.id !== exceptId && emailKey(row.customerEmail) === key) ||
    null
  );
}

function findCustomerWithSamePlate(rows, vehicles, exceptId = "") {
  const plates = new Set(
    (vehicles || []).map((v) => plateKey(v.registration)).filter(Boolean)
  );
  if (!plates.size) return null;
  return (
    rows.find((row) => {
      if (row.id === exceptId) return false;
      return normalizeVehicles(row, row).some((v) => plates.has(plateKey(v.registration)));
    }) || null
  );
}

/**
 * Auto-save calendar / job walk-ins into Customers.
 * - New plate + name → create customer
 * - Same plate + same name → link existing
 * - Same plate + different name → do NOT auto-link (husband/wife share a car)
 */
function upsertCustomerFromParty(party = {}) {
  const names = namesFromCustomer({ customerName: party.customerName });
  let firstName = names.firstName;
  let lastName = names.lastName;
  let customerName = names.customerName;
  if (!customerName) {
    return { customerId: String(party.customerId || "").trim(), created: false, linked: false };
  }
  // Customers list requires first + last; single-word walk-ins use "-".
  if (firstName && !lastName) lastName = "-";
  if (!firstName && lastName) {
    firstName = lastName;
    lastName = "-";
  }
  customerName = composeCustomerName(firstName, lastName, customerName);

  const phone = String(party.customerPhone || "").trim();
  const email = String(party.customerEmail || "").trim();
  const registration = String(party.registration || "").trim().toUpperCase();
  const vehicleDesc = namesLib.capitalizeVehicleDescription(String(party.vehicle || "").trim());
  if (!registration) {
    // Need a plate to create a durable customer record.
    return { customerId: String(party.customerId || "").trim(), created: false, linked: false };
  }

  const rows = readSavedCustomers();
  const givenId = String(party.customerId || "").trim();
  const partyNameKey = customerNameKey(customerName);

  const plateOwner = findCustomerWithSamePlate(rows, [{ registration }]);
  if (plateOwner) {
    const ownerNameKey = customerNameKey(namesFromCustomer(plateOwner).customerName);
    // Shared household car: different person, same plate — keep this booking separate.
    if (ownerNameKey && partyNameKey && ownerNameKey !== partyNameKey) {
      return { customerId: "", created: false, linked: false, skippedSharedPlate: true };
    }
    const index = rows.findIndex((c) => c.id === plateOwner.id);
    if (index < 0) {
      return { customerId: "", created: false, linked: false };
    }
    const current = rows[index];
    const vehicles = normalizeVehicles(current, current);
    const pk = plateKey(registration);
    const vIndex = vehicles.findIndex((v) => plateKey(v.registration) === pk);
    let changed = false;
    if (vIndex >= 0) {
      if (vehicleDesc && !String(vehicles[vIndex].vehicle || "").trim()) {
        vehicles[vIndex] = { ...vehicles[vIndex], vehicle: vehicleDesc };
        changed = true;
      }
    } else {
      vehicles.push({
        id: randomUUID(),
        registration,
        vehicle: vehicleDesc,
        wofExpiry: "",
        wofReminderSentAt: "",
        wofSmsReminderSentAt: "",
      });
      changed = true;
    }
    if (phone && !String(current.customerPhone || "").trim()) {
      current.customerPhone = phone;
      changed = true;
    }
    if (email && !String(current.customerEmail || "").trim()) {
      current.customerEmail = email;
      changed = true;
    }
    if (changed) {
      current.vehicles = vehicles;
      current.registration = vehicles[0]?.registration || current.registration || "";
      current.updatedAt = nowIso();
      rows[index] = current;
      writeSavedCustomers(rows);
    }
    return { customerId: current.id, created: false, linked: true };
  }

  if (givenId) {
    const index = rows.findIndex((c) => c.id === givenId);
    if (index >= 0) {
      const current = rows[index];
      const ownerNameKey = customerNameKey(namesFromCustomer(current).customerName);
      if (ownerNameKey && partyNameKey && ownerNameKey !== partyNameKey) {
        // Stale id from a previous search — do not keep linking the wrong person.
        return { customerId: "", created: false, linked: false };
      }
      const vehicles = normalizeVehicles(current, current);
      const pk = plateKey(registration);
      if (vehicles.some((v) => plateKey(v.registration) === pk)) {
        return { customerId: current.id, created: false, linked: true };
      }
      // One plate per customer: another plate → new record (same name allowed).
      // Fall through to create below.
    }
  }

  const now = nowIso();
  const seq = nextCustomerSeq(rows);
  const row = {
    id: randomUUID(),
    firstName,
    lastName,
    customerName,
    customerAddress: "",
    customerPhone: phone,
    customerEmail: email,
    vehicles: [
      {
        id: randomUUID(),
        registration,
        vehicle: vehicleDesc,
        wofExpiry: "",
        wofReminderSentAt: "",
        wofSmsReminderSentAt: "",
      },
    ],
    registration,
    dailySeq: seq,
    customerSeq: seq,
    dailySeqDate: "",
    createdAt: now,
    updatedAt: now,
  };
  rows.push(row);
  writeSavedCustomers(rows);
  return { customerId: row.id, created: true, linked: false };
}

function attachPartyCustomerId(row = {}) {
  try {
    const result = upsertCustomerFromParty(row);
    if (result.skippedSharedPlate) {
      // Same plate, different person — keep this visit's typed name, no shared customerId.
      row.customerId = "";
    } else if (result.customerId) {
      row.customerId = result.customerId;
    }
    return result;
  } catch (err) {
    console.error("Could not auto-save customer from party:", err);
    return { customerId: String(row.customerId || "").trim(), created: false, linked: false };
  }
}

function customerRecordKey(item) {
  if (item.listKey) return item.listKey;
  if (item.customerId) {
    const pk = plateKey(item.registration);
    if (pk) return `id:${item.customerId}:rego:${pk}`;
    if (item.vehicleId) return `id:${item.customerId}:veh:${item.vehicleId}`;
    return `id:${item.customerId}`;
  }
  const plate = plateKey(item.registration);
  if (plate) return `rego:${plate}`;
  const email = String(item.customerEmail || "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const name = String(item.customerName || "").trim().toLowerCase();
  const phone = String(item.customerPhone || "").replace(/\s+/g, "");
  if (name || phone) return `name:${name}|${phone}`;
  return "";
}

function customerIdFromListKey(key) {
  const m = String(key || "").match(/^id:([^:]+)/);
  return m ? m[1] : "";
}

/** One plate per customer going forward; legacy multi-car keeps other plates when editing one. */
function applyCustomerVehicles(body = {}, current = {}) {
  const currentVehicles = normalizeVehicles(current, current);
  if (!Array.isArray(body.vehicles)) {
    return currentVehicles.length ? currentVehicles : normalizeVehicles(body, current);
  }
  const next = normalizeVehicles(body, current);
  const focusId = String(body.vehicleId || body.vehicles[0]?.id || "").trim();
  if (next.length === 1 && currentVehicles.length > 1 && focusId) {
    const idx = currentVehicles.findIndex((v) => v.id === focusId);
    if (idx >= 0) {
      const out = currentVehicles.slice();
      out[idx] = { ...currentVehicles[idx], ...next[0], id: currentVehicles[idx].id };
      return out;
    }
  }
  return next.length ? [next[0]] : [];
}

function wofMeta(expiry) {
  if (!expiry) return { wofStatus: "missing", daysUntil: null };
  const today = todayIso();
  const days = Math.round(
    (new Date(`${expiry}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000
  );
  let wofStatus = "ok";
  if (days < 0) wofStatus = "overdue";
  else if (days <= 30) wofStatus = "due_soon";
  return { wofStatus, daysUntil: days };
}

function nextWofReminderVehicle(vehicles) {
  return (vehicles || [])
    .map((v) => ({ v, meta: wofMeta(v.wofExpiry) }))
    .filter((row) => row.meta.wofStatus === "due_soon" && !row.v.wofReminderSentAt)
    .sort((a, b) => String(a.v.wofExpiry).localeCompare(String(b.v.wofExpiry)))[0]?.v || null;
}

function nextWofSmsReminderVehicle(vehicles) {
  return (vehicles || [])
    .map((v) => ({ v, meta: wofMeta(v.wofExpiry) }))
    .filter((row) => row.meta.wofStatus === "due_soon" && !row.v.wofSmsReminderSentAt)
    .sort((a, b) => String(a.v.wofExpiry).localeCompare(String(b.v.wofExpiry)))[0]?.v || null;
}

function mergeCustomer(map, incoming) {
  const key = customerRecordKey(incoming);
  if (!key) return;
  const cur = map.get(key) || {
    key,
    listKey: key,
    customerName: "",
    firstName: "",
    lastName: "",
    customerEmail: "",
    customerPhone: "",
    registration: "",
    registrations: [],
    vehicles: [],
    vehicle: "",
    vehicleId: "",
    wofExpiry: "",
    wofReminderSentAt: "",
    lastVisit: "",
    lastJobNumber: "",
    lastReportId: "",
    lastBillingId: "",
    customerAddress: "",
    customerId: "",
    dailySeq: 0,
    customerSeq: 0,
    dailySeqDate: "",
    createdAt: "",
  };
  const incomingVisit = incoming.lastVisit || "";
  const isNewerVisit = !cur.lastVisit || incomingVisit >= cur.lastVisit;

  let vehicles = Array.isArray(cur.vehicles) ? [...cur.vehicles] : [];
  if (Array.isArray(incoming.vehicles) && incoming.vehicles.length) {
    for (const v of incoming.vehicles) {
      const pk = plateKey(v.registration);
      if (!pk) continue;
      const idx = vehicles.findIndex((x) => plateKey(x.registration) === pk);
      if (idx >= 0) {
        vehicles[idx] = {
          ...vehicles[idx],
          ...v,
          registration: String(v.registration || vehicles[idx].registration).toUpperCase(),
          vehicle: v.vehicle || vehicles[idx].vehicle || "",
          wofExpiry: v.wofExpiry || vehicles[idx].wofExpiry || "",
          wofReminderSentAt: v.wofReminderSentAt || vehicles[idx].wofReminderSentAt || "",
          wofSmsReminderSentAt:
            v.wofSmsReminderSentAt || vehicles[idx].wofSmsReminderSentAt || "",
        };
      } else {
        vehicles.push({
          id: v.id || randomUUID(),
          registration: String(v.registration || "").toUpperCase(),
          vehicle: String(v.vehicle || "").trim(),
          wofExpiry: v.wofExpiry || "",
          wofReminderSentAt: v.wofReminderSentAt || "",
          wofSmsReminderSentAt: v.wofSmsReminderSentAt || "",
        });
      }
    }
  } else if (incoming.registration) {
    const pk = plateKey(incoming.registration);
    const idx = vehicles.findIndex((x) => plateKey(x.registration) === pk);
    const nextVehicle = {
      id: idx >= 0 ? vehicles[idx].id : randomUUID(),
      registration: String(incoming.registration).toUpperCase(),
      vehicle:
        (isNewerVisit && incoming.vehicle) ||
        (idx >= 0 ? vehicles[idx].vehicle : "") ||
        incoming.vehicle ||
        "",
      wofExpiry:
        incoming.wofExpiry && (isNewerVisit || !(idx >= 0 && vehicles[idx].wofExpiry))
          ? incoming.wofExpiry
          : idx >= 0
            ? vehicles[idx].wofExpiry || ""
            : "",
      wofReminderSentAt: idx >= 0 ? vehicles[idx].wofReminderSentAt || "" : "",
      wofSmsReminderSentAt: idx >= 0 ? vehicles[idx].wofSmsReminderSentAt || "" : "",
    };
    if (idx >= 0) vehicles[idx] = { ...vehicles[idx], ...nextVehicle };
    else vehicles.push(nextVehicle);
  }

  const registrations = vehicles.map((v) => v.registration).filter(Boolean);
  const bestWof = vehicles
    .map((v) => v.wofExpiry)
    .filter(Boolean)
    .sort()[0] || incoming.wofExpiry || cur.wofExpiry || "";

  const names = namesFromCustomer(incoming);
  const curNames = namesFromCustomer(cur);
  // Saved Customers profile wins for contact fields. Reports/billing only fill gaps
  // (otherwise an old invoice phone/name overwrites a successful Save and looks like save failed).
  const savedWins = Boolean(cur.customerId);
  map.set(key, {
    ...cur,
    key,
    listKey: key,
    firstName: savedWins ? curNames.firstName || "" : names.firstName || curNames.firstName || "",
    lastName: savedWins ? curNames.lastName || "" : names.lastName || curNames.lastName || "",
    customerName: savedWins
      ? curNames.customerName || ""
      : names.customerName || curNames.customerName || "",
    customerAddress: savedWins
      ? String(cur.customerAddress || "")
      : incoming.customerAddress || cur.customerAddress || "",
    customerEmail: savedWins
      ? String(cur.customerEmail || "")
      : incoming.customerEmail || cur.customerEmail || "",
    customerPhone: savedWins
      ? String(cur.customerPhone || "")
      : incoming.customerPhone || cur.customerPhone || "",
    vehicles,
    registrations,
    registration: registrations.join(", ") || incoming.registration || cur.registration || "",
    vehicle:
      (isNewerVisit && incoming.vehicle) ||
      vehicles[0]?.vehicle ||
      cur.vehicle ||
      incoming.vehicle ||
      "",
    vehicleId: incoming.vehicleId || vehicles[0]?.id || cur.vehicleId || "",
    wofExpiry: bestWof,
    wofReminderSentAt: incoming.wofReminderSentAt || cur.wofReminderSentAt || "",
    lastVisit: incomingVisit >= (cur.lastVisit || "") ? incomingVisit : cur.lastVisit,
    lastJobNumber:
      isNewerVisit && incoming.lastJobNumber
        ? incoming.lastJobNumber
        : cur.lastJobNumber,
    lastReportId: incoming.lastReportId || cur.lastReportId,
    lastBillingId: incoming.lastBillingId || cur.lastBillingId,
    customerId: incoming.customerId || cur.customerId,
    dailySeq: incoming.dailySeq || incoming.customerSeq || cur.dailySeq || cur.customerSeq || 0,
    customerSeq: incoming.customerSeq || cur.customerSeq || incoming.dailySeq || cur.dailySeq || 0,
    dailySeqDate: incoming.dailySeqDate || cur.dailySeqDate || "",
    createdAt: incoming.createdAt || cur.createdAt || "",
  });
}

function listCustomers() {
  const map = new Map();
  const plateOwner = new Map();
  const seqById = new Map();

  for (const c of readSavedCustomers()) {
    seqById.set(c.id, customerSeqOf(c));
    const vehicles = normalizeVehicles(c, c);
    const list = vehicles.length
      ? vehicles
      : [
          {
            id: "",
            registration: c.registration || "",
            vehicle: "",
            wofExpiry: c.wofExpiry || "",
            wofReminderSentAt: c.wofReminderSentAt || "",
            wofSmsReminderSentAt: "",
          },
        ];
    const names = namesFromCustomer(c);
    for (const v of list) {
      const pk = plateKey(v.registration) || String(v.id || "none");
      const listKey = `id:${c.id}:rego:${pk}`;
      if (plateKey(v.registration)) plateOwner.set(plateKey(v.registration), listKey);
      mergeCustomer(map, {
        listKey,
        firstName: names.firstName,
        lastName: names.lastName,
        customerName: names.customerName,
        customerAddress: c.customerAddress,
        customerPhone: c.customerPhone,
        customerEmail: c.customerEmail || "",
        vehicles: [v],
        registration: v.registration || "",
        vehicle: v.vehicle || "",
        vehicleId: v.id || "",
        wofExpiry: v.wofExpiry || "",
        wofReminderSentAt: v.wofReminderSentAt || "",
        lastVisit: "",
        lastJobNumber: "",
        lastReportId: "",
        lastBillingId: "",
        customerId: c.id,
        dailySeq: c.dailySeq || c.customerSeq || 0,
        customerSeq: c.customerSeq || c.dailySeq || 0,
        dailySeqDate: c.dailySeqDate || "",
        createdAt: c.createdAt || "",
      });
    }
  }

  function mergeIncoming(incoming) {
    const pk = plateKey(incoming.registration);
    const owned = pk ? plateOwner.get(pk) : "";
    mergeCustomer(map, {
      ...incoming,
      listKey: owned || undefined,
      customerId: owned ? customerIdFromListKey(owned) : incoming.customerId || "",
    });
  }

  for (const r of readReports()) {
    mergeIncoming({
      customerName: r.customerName,
      customerEmail: r.customerEmail,
      customerPhone: r.customerPhone,
      registration: r.registration,
      vehicle: r.vehicle,
      wofExpiry: r.wof?.expiry || "",
      lastVisit: (r.serviceDate || r.updatedAt || "").slice(0, 10),
      lastJobNumber: r.jobNumber || "",
      lastReportId: r.id,
      lastBillingId: "",
    });
  }
  for (const d of readBilling()) {
    if (d.status === "void") continue;
    mergeIncoming({
      customerName: d.customerName,
      customerEmail: d.customerEmail,
      customerPhone: d.customerPhone,
      registration: d.registration,
      vehicle: d.vehicle,
      wofExpiry: d.wofExpiry || "",
      lastVisit: (d.updatedAt || d.createdAt || "").slice(0, 10),
      lastJobNumber: d.number || "",
      lastReportId: "",
      lastBillingId: d.id,
    });
  }

  const rank = { overdue: 0, due_soon: 1, ok: 2, missing: 3 };
  return [...map.values()]
    .filter((row) => Boolean(row.customerId))
    .map((row) => {
      const hasReport = Boolean(row.lastReportId);
      const hasBilling = Boolean(row.lastBillingId);
      const canDelete = !invoiceBlocksCustomerDelete({
        id: row.customerId,
        vehicles: row.vehicles,
        registration: row.registration,
      });
      const reminderVehicle = nextWofReminderVehicle(row.vehicles || []);
      const smsReminderVehicle = nextWofSmsReminderVehicle(row.vehicles || []);
      const latestVehicleReminder =
        (row.vehicles || [])
          .map((v) => v.wofReminderSentAt)
          .filter(Boolean)
          .sort()
          .at(-1) || "";
      const latestSmsReminder =
        (row.vehicles || [])
          .map((v) => v.wofSmsReminderSentAt)
          .filter(Boolean)
          .sort()
          .at(-1) || "";
      const seq = row.customerId ? Number(seqById.get(row.customerId)) || 0 : 0;
      const phoneOk = Boolean(websms.normalizeNzMobile(row.customerPhone));
      return {
        ...row,
        ...wofMeta(row.wofExpiry),
        wofReminderSentAt: reminderVehicle
          ? ""
          : latestVehicleReminder || row.wofReminderSentAt || "",
        wofReminderVehicleId: reminderVehicle?.id || "",
        canWofReminder: Boolean(reminderVehicle && row.customerEmail),
        wofSmsReminderSentAt: smsReminderVehicle
          ? ""
          : latestSmsReminder || row.wofSmsReminderSentAt || "",
        wofSmsReminderVehicleId: smsReminderVehicle?.id || "",
        canWofSmsReminder: Boolean(smsReminderVehicle && phoneOk && websms.websmsConfigured()),
        customerSeq: seq,
        dailySeq: seq,
        hasReport,
        hasBilling,
        canDelete,
      };
    })
    .sort((a, b) => {
      const rankDiff = rank[a.wofStatus] - rank[b.wofStatus];
      if (rankDiff) return rankDiff;
      if (a.wofExpiry && b.wofExpiry) return a.wofExpiry.localeCompare(b.wofExpiry);
      return String(a.customerName).localeCompare(String(b.customerName));
    });
}

function billingNumberParts(number) {
  const match = String(number || "").match(/^(Q|INV)-(\d{4})-(\d+)$/i);
  if (!match) return null;
  return {
    kind: match[1].toUpperCase() === "INV" ? "invoice" : "quote",
    year: match[2],
    seq: Number(match[3]),
  };
}

function formatBillingNumber(kind, year, seq) {
  const prefix = kind === "invoice" ? "INV" : "Q";
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}

function toInvoiceNumber(number) {
  const parts = billingNumberParts(number);
  if (!parts) return String(number || "").replace(/^Q-/i, "INV-");
  return formatBillingNumber("invoice", parts.year, parts.seq);
}

function unifyInvoiceNumberFromQuote(docs, invoice, quote) {
  if (!invoice || !quote) return false;
  const unified = toInvoiceNumber(quote.number);
  let changed = false;
  if (!invoice.quotedNumber) {
    invoice.quotedNumber = quote.number;
    changed = true;
  }
  const clash = docs.find((d) => d.id !== invoice.id && d.number === unified);
  if (!clash && invoice.number !== unified) {
    invoice.number = unified;
    changed = true;
  }
  if (invoice.quoteId !== quote.id) {
    invoice.quoteId = quote.id;
    changed = true;
  }
  return changed;
}

function repairLegacyConvertedBilling(docs) {
  let changed = false;
  if (splitInPlaceQuoteInvoices(docs)) changed = true;
  for (const quote of docs) {
    if (quote.kind !== "quote") continue;
    if (!quote.invoiceId || quote.invoiceId === quote.id) continue;
    const invoice = docs.find((d) => d.id === quote.invoiceId);
    if (!invoice || invoice.kind !== "invoice") continue;
    if (unifyInvoiceNumberFromQuote(docs, invoice, quote)) changed = true;
  }
  for (const invoice of docs) {
    if (invoice.kind !== "invoice" || !invoice.quoteId) continue;
    const quote = docs.find((d) => d.id === invoice.quoteId);
    if (!quote || quote.kind !== "quote") continue;
    if (unifyInvoiceNumberFromQuote(docs, invoice, quote)) changed = true;
  }
  return changed;
}

function splitInPlaceQuoteInvoices(docs) {
  const created = [];
  let changed = false;
  for (const invoice of docs) {
    if (!invoice || invoice.kind !== "invoice") continue;
    const quotedNumber = String(invoice.quotedNumber || "").trim();
    if (!quotedNumber) continue;
    const linkedId = String(invoice.quoteId || "").trim();
    const linkedQuote =
      linkedId && linkedId !== invoice.id
        ? docs.find((row) => row.id === linkedId && row.kind === "quote") ||
          created.find((row) => row.id === linkedId)
        : null;
    if (linkedQuote) continue;

    const quoteId = randomUUID();
    const quote = {
      id: quoteId,
      kind: "quote",
      number: quotedNumber,
      status: "invoiced",
      preset: invoice.preset || "custom",
      createdAt: invoice.createdAt,
      updatedAt: nowIso(),
      sentAt: invoice.sentAt || "",
      acceptedAt: invoice.acceptedAt || "",
      validUntil: "",
      customerId: invoice.customerId || "",
      vehicleId: invoice.vehicleId || "",
      customerName: invoice.customerName || "",
      customerEmail: invoice.customerEmail || "",
      customerPhone: invoice.customerPhone || "",
      registration: invoice.registration || "",
      vehicle: invoice.vehicle || "",
      odometer: invoice.odometer || "",
      notes: invoice.notes || "",
      lines: (invoice.lines || []).map((line) => ({
        ...line,
        id: line.id || randomUUID(),
      })),
      acceptToken: invoice.acceptToken || newAcceptToken(),
      viewToken: newViewToken(),
      quoteId: "",
      invoiceId: invoice.id,
      jobId: invoice.jobId || "",
      lastEmailedAt: invoice.lastEmailedAt || "",
      lastEmailedTo: invoice.lastEmailedTo || "",
      firstName: invoice.firstName || "",
      lastName: invoice.lastName || "",
      history: Array.isArray(invoice.history)
        ? invoice.history.filter(
            (row) => row?.type !== "payment" && row?.type !== "payment_removed"
          )
        : [],
    };
    invoice.quoteId = quoteId;
    invoice.acceptToken = "";
    if (invoice.status === "accepted") invoice.status = "sent";
    created.push(quote);
    changed = true;
  }
  if (!created.length) return false;
  docs.push(...created);

  try {
    const jobs = readJobs();
    let jobsChanged = false;
    for (const job of jobs) {
      const invoice =
        (job.invoiceId && docs.find((d) => d.id === job.invoiceId && d.kind === "invoice")) ||
        (job.quoteId && docs.find((d) => d.id === job.quoteId && d.kind === "invoice")) ||
        null;
      if (!invoice) continue;
      const quote = docs.find((d) => d.id === invoice.quoteId && d.kind === "quote");
      if (!quote) continue;
      if (job.quoteId !== quote.id || job.quoteNumber !== quote.number) {
        job.quoteId = quote.id;
        job.quoteNumber = quote.number;
        jobsChanged = true;
      }
      if (job.invoiceId !== invoice.id || job.invoiceNumber !== invoice.number) {
        job.invoiceId = invoice.id;
        job.invoiceNumber = invoice.number;
        jobsChanged = true;
      }
    }
    if (jobsChanged) writeJobs(jobs);
  } catch (err) {
    console.error("Could not relink jobs after splitting quotes:", err);
  }
  return changed;
}

function readBillingSeqMap() {
  try {
    const parsed = JSON.parse(fs.readFileSync(BILLING_SEQ_FILE, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    /* first run or unreadable file */
  }
  return {};
}

function writeBillingSeqMap(map) {
  fs.mkdirSync(path.dirname(BILLING_SEQ_FILE), { recursive: true });
  fs.writeFileSync(BILLING_SEQ_FILE, `${JSON.stringify(map, null, 2)}\n`);
}

function bumpBillingHighWater(docs) {
  const map = readBillingSeqMap();
  let changed = false;
  for (const doc of docs || []) {
    const parts = billingNumberParts(doc.number);
    if (!parts) continue;
    const prev = Number(map[parts.year]) || 0;
    if (parts.seq > prev) {
      map[parts.year] = parts.seq;
      changed = true;
    }
  }
  if (changed || !fs.existsSync(BILLING_SEQ_FILE)) {
    try {
      writeBillingSeqMap(map);
    } catch (err) {
      console.error("Could not save billing sequence:", err);
    }
  }
  return map;
}

function nextBillingNumber(docs, kind) {
  const year = todayIso().slice(0, 4);
  const map = bumpBillingHighWater(docs);
  const max = Number(map[year]) || 0;
  const seq = max + 1;
  map[year] = seq;
  try {
    writeBillingSeqMap(map);
  } catch (err) {
    console.error("Could not reserve billing number:", err);
  }
  return formatBillingNumber(kind === "invoice" ? "invoice" : "quote", year, seq);
}

function isoDateOnly(value) {
  const raw = String(value || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function formatDateShort(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.slice(0, 10);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return iso || raw;
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(new Date(t));
}

function applyInvoiceWofToCustomer(doc) {
  if (!doc || doc.kind !== "invoice" || doc.status === "void") return;
  const expiry = isoDateOnly(doc.wofExpiry);
  if (!expiry) return;
  if (!(doc.lines || []).some((line) => catalog.lineLooksLikeWof(line.description))) return;
  const customerId = String(doc.customerId || "").trim();
  if (!customerId) return;
  const rows = readSavedCustomers();
  const customer = rows.find((c) => c.id === customerId);
  if (!customer) return;
  const vehicles = normalizeVehicles(customer, customer);
  const plate = plateKey(doc.registration);
  const hit =
    (plate && vehicles.find((v) => plateKey(v.registration) === plate)) || vehicles[0];
  if (!hit) return;
  if (hit.wofExpiry !== expiry) {
    hit.wofReminderSentAt = "";
    hit.wofSmsReminderSentAt = "";
    customer.wofReminderSentAt = "";
  }
  hit.wofExpiry = expiry;
  customer.vehicles = vehicles;
  customer.wofExpiry = vehicles.map((v) => v.wofExpiry).filter(Boolean).sort()[0] || expiry;
  customer.updatedAt = nowIso();
  writeSavedCustomers(rows);
}

function requireCustomerSnapshot(body) {
  const customerId = String(body?.customerId || "").trim();
  const vehicleId = String(body?.vehicleId || "").trim();
  if (!customerId) {
    const err = new Error("Select a customer from the Customers list first.");
    err.status = 400;
    throw err;
  }
  const saved = readSavedCustomers().find((c) => c.id === customerId);
  if (!saved) {
    const err = new Error("That customer is not in the Customers list.");
    err.status = 400;
    throw err;
  }
  const vehicles = normalizeVehicles(saved, saved);
  const wantedPlate = plateKey(vehicleId);
  const vehicle =
    (vehicleId &&
      vehicles.find(
        (v) => v.id === vehicleId || (wantedPlate && plateKey(v.registration) === wantedPlate)
      )) ||
    (vehicles.length === 1 ? vehicles[0] : null);
  if (!vehicle) {
    const err = new Error("Select a vehicle for this customer.");
    err.status = 400;
    throw err;
  }
  return {
    customerId: saved.id,
    vehicleId: vehicle.id,
    ...namesFromCustomer(saved),
    customerEmail: saved.customerEmail || "",
    customerPhone: saved.customerPhone || "",
    registration: vehicle.registration,
    vehicle: vehicle.vehicle || "",
  };
}

function newAcceptToken() {
  return randomBytes(24).toString("hex");
}

function newViewToken() {
  return randomBytes(24).toString("hex");
}

function ensureViewToken(doc) {
  if (!doc || typeof doc !== "object") return "";
  if (!doc.viewToken) doc.viewToken = newViewToken();
  return doc.viewToken;
}

function stampInvoiceIssueDate(doc) {
  if (!doc || doc.kind !== "invoice" || doc.status === "void") return;
  if (doc.status === "draft") {
    doc.issuedAt = todayIso();
    return;
  }
  if (!isoDateOnly(doc.issuedAt)) {
    doc.issuedAt = isoDateOnly(doc.sentAt) || isoDateOnly(doc.createdAt) || todayIso();
  }
}

function publicViewTokenOk(doc, raw) {
  const token = String(raw || "");
  if (!doc?.viewToken) return true;
  return Boolean(token && token === doc.viewToken);
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => ({
    id: line.id || randomUUID(),
    description: catalog.capitalizeLineDescription(line.description),
    qty: Math.max(0, Number(line.qty) || 0),
    unitPriceIncl: Math.max(0, Number(line.unitPriceIncl) || 0),
  }));
}

function billableLines(lines) {
  return normalizeLines(lines).filter(
    (line) => line.description && catalog.lineTotal(line) > 0
  );
}

const PAYMENT_STATUSES = ["unpaid", "deposit", "paid"];

function emptyPaymentFields() {
  return {
    payments: [],
    paymentStatus: "unpaid",
    amountPaid: 0,
    paidAt: "",
    paymentNote: "",
  };
}

function normalizePaymentRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      id: row.id || randomUUID(),
      amount: catalog.round2(Math.max(0, Number(row.amount) || 0)),
      paidAt: String(row.paidAt || "").trim(),
      note: String(row.note || "").trim(),
    }))
    .filter((row) => row.amount > 0);
}

/** Migrate legacy single amountPaid into a payments[] list. */
function paymentsFromDoc(doc, body) {
  if (body.payments != null) return normalizePaymentRows(body.payments);
  if (Array.isArray(doc.payments) && doc.payments.length) {
    return normalizePaymentRows(doc.payments);
  }
  const legacy = catalog.round2(Math.max(0, Number(doc.amountPaid) || 0));
  if (legacy > 0) {
    return normalizePaymentRows([
      {
        id: randomUUID(),
        amount: legacy,
        paidAt: doc.paidAt || "",
        note: doc.paymentNote || "",
      },
    ]);
  }
  return [];
}

function derivePaymentStatus(amountPaid, totalIncl) {
  if (amountPaid <= 0) return "unpaid";
  if (totalIncl > 0 && amountPaid + 0.001 >= totalIncl) return "paid";
  return "deposit";
}

function billingAnchorDate(doc) {
  return String(doc?.sentAt || doc?.createdAt || doc?.updatedAt || "");
}

function daysSinceIso(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / (24 * 60 * 60 * 1000);
}

/** Invoice sent/issued 7+ days ago with balance still due. */
function isInvoiceOverdue(doc, payment) {
  if (!doc || doc.kind !== "invoice") return false;
  if (doc.status === "void" || doc.status === "draft") return false;
  if (!payment || payment.paymentStatus === "paid" || !(payment.balanceDue > 0)) {
    return false;
  }
  const days = daysSinceIso(billingAnchorDate(doc));
  return days != null && days >= 7;
}

function normalizeInvoicePayment(doc, body = {}, totals) {
  const totalIncl =
    Number(totals?.totalIncl) || catalog.computeTotals(doc.lines || []).totalIncl;
  const payments = paymentsFromDoc(doc, body);
  const amountPaid = catalog.round2(
    payments.reduce((sum, row) => sum + row.amount, 0)
  );
  const referralCreditTotal = referralsLib.referralCreditTotal(doc);
  const covered = catalog.round2(amountPaid + referralCreditTotal);
  const paymentStatus = derivePaymentStatus(covered, totalIncl);
  const last = payments[payments.length - 1];
  return {
    payments,
    paymentStatus,
    amountPaid,
    paidAt: last?.paidAt || "",
    paymentNote: last?.note || "",
    referralCreditTotal,
    balanceDue: catalog.round2(Math.max(0, totalIncl - covered)),
  };
}

function appendHistory(doc, entry = {}) {
  if (!doc || typeof doc !== "object") return;
  if (!Array.isArray(doc.history)) doc.history = [];
  const stored = staffContext.getStore();
  const actor = String(entry.actor || stored?.staff?.username || "").trim();
  doc.history.push({
    id: randomUUID(),
    at: entry.at || nowIso(),
    type: String(entry.type || "note"),
    summary: String(entry.summary || "").trim(),
    detail: String(entry.detail || "").trim(),
    actor,
    amount:
      entry.amount == null || entry.amount === ""
        ? null
        : catalog.round2(Number(entry.amount) || 0),
  });
  if (doc.history.length > 120) doc.history = doc.history.slice(-120);
}

function ensureHistory(doc) {
  if (!doc) return;
  if (Array.isArray(doc.history) && doc.history.length) return;
  doc.history = [];
  const totals = catalog.computeTotals(doc.lines || []);
  appendHistory(doc, {
    at: doc.createdAt || nowIso(),
    type: "created",
    summary: doc.kind === "invoice" ? "Invoice created" : "Quote created",
    amount: totals.totalIncl,
  });
}

function historyHasType(doc, type) {
  return (doc.history || []).some((row) => row.type === type);
}

function backfillEmailAndViewHistory(doc) {
  if (!doc) return;
  ensureHistory(doc);
  if (doc.lastEmailedAt && !historyHasType(doc, "sent")) {
    appendHistory(doc, {
      at: doc.lastEmailedAt,
      type: "sent",
      summary:
        doc.kind === "invoice" ? "Invoice emailed to customer" : "Quote emailed to customer",
      detail: doc.lastEmailedTo || "",
    });
  }
  const openedAt = doc.lastViewedAt || doc.viewedAt;
  if (openedAt && !historyHasType(doc, "viewed")) {
    appendHistory(doc, {
      at: openedAt,
      type: "viewed",
      summary:
        doc.kind === "invoice" ? "Customer opened invoice" : "Customer opened quote",
    });
  }
}

/** Customer quote/invoice opens — cooldown avoids refresh spam in History. */
const QUOTE_VIEW_COOLDOWN_MS = 30 * 60 * 1000;

function recordCustomerDocumentView(doc) {
  if (!doc || (doc.kind !== "quote" && doc.kind !== "invoice")) return false;
  if (doc.status === "void" || doc.status === "draft") return false;

  backfillEmailAndViewHistory(doc);
  const now = Date.now();
  const lastView = [...(doc.history || [])]
    .reverse()
    .find((h) => h.type === "viewed");
  if (lastView?.at) {
    const last = Date.parse(lastView.at);
    if (Number.isFinite(last) && now - last < QUOTE_VIEW_COOLDOWN_MS) {
      return false;
    }
  }

  const iso = nowIso();
  if (!doc.viewedAt) doc.viewedAt = iso;
  doc.lastViewedAt = iso;
  doc.viewCount = (Number(doc.viewCount) || 0) + 1;
  const kindLabel = doc.kind === "invoice" ? "invoice" : "quote";
  appendHistory(doc, {
    at: iso,
    type: "viewed",
    summary:
      doc.viewCount === 1
        ? `Customer opened ${kindLabel}`
        : `Customer opened ${kindLabel} again`,
    detail: doc.viewCount > 1 ? `View #${doc.viewCount}` : "",
  });
  return true;
}

function describeLineChanges(beforeLines, afterLines) {
  const before = (beforeLines || []).filter((l) => String(l.description || "").trim());
  const after = (afterLines || []).filter((l) => String(l.description || "").trim());
  const details = [];
  const usedBefore = new Set();

  for (const line of after) {
    const prevById = before.find((l) => l.id && line.id && l.id === line.id);
    const prev =
      prevById ||
      before.find(
        (l, i) =>
          !usedBefore.has(i) &&
          String(l.description).trim().toLowerCase() ===
            String(line.description).trim().toLowerCase()
      );
    if (prev) {
      const idx = before.indexOf(prev);
      usedBefore.add(idx);
      if (
        Number(prev.qty) !== Number(line.qty) ||
        Number(prev.unitPriceIncl) !== Number(line.unitPriceIncl)
      ) {
        details.push(`Changed: ${line.description}`);
      }
    } else {
      details.push(`Added: ${line.description}`);
    }
  }
  before.forEach((line, i) => {
    if (usedBefore.has(i)) return;
    const still = after.some(
      (l) =>
        (l.id && line.id && l.id === line.id) ||
        String(l.description).trim().toLowerCase() ===
          String(line.description).trim().toLowerCase()
    );
    if (!still) details.push(`Removed: ${line.description}`);
  });
  return details;
}

function describeFieldChanges(before, after) {
  const labels = [
    ["customerName", "Customer"],
    ["customerEmail", "Email"],
    ["customerPhone", "Phone"],
    ["registration", "Registration"],
    ["vehicle", "Vehicle"],
    ["notes", "Notes"],
    ["validUntil", "Valid until"],
  ];
  const details = [];
  for (const [field, label] of labels) {
    if (String(before[field] || "") !== String(after[field] || "")) {
      details.push(`${label} updated`);
    }
  }
  return details;
}

function paymentMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (row?.id) map.set(row.id, row);
  }
  return map;
}

function withBillingTotals(doc, isAdmin) {
  const totals = catalog.computeTotals(doc.lines);
  const payment =
    doc.kind === "invoice"
      ? normalizeInvoicePayment(doc, {}, totals)
      : null;
  const payload = {
    ...doc,
    lines: (doc.lines || []).map((line) => ({
      ...line,
      amounts: catalog.lineAmounts(line),
    })),
    totals,
    shop: {
      name: business.name,
      addressLine2: business.addressLine2,
      street: business.street,
      suburb: business.suburb,
      city: business.city,
      phoneDisplay: business.phoneDisplay,
      phoneTel: business.phoneTel,
      email: business.email,
      gstNumber: business.gstNumber || "",
      hoursShort: business.hoursShort,
      bankAccountName: business.bankAccountName || "",
      bankAccount: business.bankAccount || "",
      paymentTerms: Array.isArray(business.paymentTerms)
        ? [...business.paymentTerms]
        : [],
    },
  };
  if (doc.kind === "invoice") {
    const review = reviewPayloadForInvoice(doc);
    if (review) {
      payload.googleReview = {
        ...review,
        qrUrl: "/api/google-review-qr.png",
        sentAt: String(doc.reviewRequestSentAt || "").trim(),
        sentKind: String(doc.reviewRequestKind || "").trim(),
      };
    } else if (isAdmin) {
      payload.googleReview = {
        configured: reviewConfigured(),
        sentAt: String(doc.reviewRequestSentAt || "").trim(),
        sentKind: String(doc.reviewRequestKind || "").trim(),
      };
    }
  }
  if (payment) {
    payload.payments = payment.payments;
    payload.paymentStatus = payment.paymentStatus;
    payload.amountPaid = payment.amountPaid;
    payload.paidAt = payment.paidAt;
    payload.paymentNote = payment.paymentNote;
    payload.balanceDue = payment.balanceDue;
    payload.referralCreditsApplied = referralsLib.normalizeAppliedRows(
      doc.referralCreditsApplied
    );
    payload.referralCreditTotal = payment.referralCreditTotal || 0;
  }
  if (!isAdmin) {
    delete payload.acceptToken;
    delete payload.viewToken;
    delete payload.history;
  } else if (Array.isArray(payload.history)) {
    payload.history = [...payload.history].sort((a, b) =>
      String(b.at).localeCompare(String(a.at))
    );
  } else {
    payload.history = [];
  }
  return payload;
}

function publicOrigin(req, body) {
  return (
    PUBLIC_BASE_URL ||
    String(body?.baseUrl || "").replace(/\/$/, "") ||
    `${req.protocol}://${req.get("host")}`
  );
}

function billingPublicUrl(req, body, doc) {
  const origin = publicOrigin(req, body);
  const params = new URLSearchParams();
  const view = ensureViewToken(doc);
  if (view) params.set("v", view);
  if (doc.kind === "quote" && doc.acceptToken) {
    params.set("t", doc.acceptToken);
  }
  const query = params.toString();
  return query ? `${origin}/b/${doc.id}?${query}` : `${origin}/b/${doc.id}`;
}

function reportPublicUrl(req, body, report) {
  const origin = publicOrigin(req, body);
  const view = ensureViewToken(report);
  return view
    ? `${origin}/r/${report.id}?v=${encodeURIComponent(view)}`
    : `${origin}/r/${report.id}`;
}

function isLockedBilling(doc) {
  return ["accepted", "invoiced", "void"].includes(doc.status);
}

function issueBillingDoc(doc, req, body) {
  if (doc.status === "void") {
    const err = new Error("This document has been voided.");
    err.status = 400;
    throw err;
  }
  const lines = billableLines(doc.lines);
  if (!doc.customerId) {
    const err = new Error("Select a customer from the Customers list first.");
    err.status = 400;
    throw err;
  }
  if (!lines.length) {
    const err = new Error("Add at least one priced line before sending.");
    err.status = 400;
    throw err;
  }
  doc.lines = lines;
  if (doc.kind === "quote" && !doc.acceptToken) {
    doc.acceptToken = newAcceptToken();
  }
  ensureViewToken(doc);
  if (doc.kind === "invoice") {
    if (doc.status === "draft") doc.issuedAt = todayIso();
    else stampInvoiceIssueDate(doc);
  }
  if (doc.status === "draft") {
    doc.status = "sent";
    doc.sentAt = nowIso();
    if (doc.kind === "invoice") doc.issuedAt = todayIso();
  }
  doc.updatedAt = nowIso();
  return billingPublicUrl(req, body, doc);
}

function nextJobNumber(reports) {
  const year = new Date().getFullYear();
  const prefix = `DAR-${year}-`;
  const nums = reports
    .map((r) => r.jobNumber)
    .filter((n) => typeof n === "string" && n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

const ADMIN_SESSION_COOKIE = "deane_admin";
const SITE_SESSION_COOKIE = "deane_site";
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
const SITE_SESSION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const adminSessions = new Map();
const siteSessions = new Map();
const loginAttempts = new Map();

function clientIp(req) {
  return String(req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

function cookieSecure(req) {
  return isProduction() || req.secure || req.get("x-forwarded-proto") === "https";
}

function sessionCookieHeader(req, cookieName, token, maxAgeMs) {
  const parts = [`${cookieName}=${token || ""}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (cookieSecure(req)) parts.push("Secure");
  parts.push(`Max-Age=${maxAgeMs > 0 ? Math.floor(maxAgeMs / 1000) : 0}`);
  return parts.join("; ");
}

function adminCookieHeader(req, token, maxAgeMs) {
  return sessionCookieHeader(req, ADMIN_SESSION_COOKIE, token, maxAgeMs);
}

function siteCookieHeader(req, token, maxAgeMs) {
  return sessionCookieHeader(req, SITE_SESSION_COOKIE, token, maxAgeMs);
}

function pruneAdminSessions() {
  const now = Date.now();
  for (const [token, session] of adminSessions) {
    if (!session || session.expiresAt < now) adminSessions.delete(token);
  }
}

function createAdminSession(role = "admin", username = "admin") {
  pruneAdminSessions();
  const token = randomBytes(32).toString("hex");
  adminSessions.set(token, {
    expiresAt: Date.now() + ADMIN_SESSION_MS,
    role: role === "technician" ? "technician" : "admin",
    username: String(username || "admin").trim().toLowerCase() || "admin",
  });
  return token;
}

function staffFromReq(req) {
  const row = readAdminSession(req);
  if (!row) return null;
  const role = row.session.role === "technician" ? "technician" : "admin";
  const username = String(row.session.username || (role === "admin" ? "admin" : "")).trim();
  return { token: row.token, role, username };
}

function isOwnerAdmin(req) {
  return staffFromReq(req)?.role === "admin";
}

function pruneSiteSessions() {
  const now = Date.now();
  for (const [token, session] of siteSessions) {
    if (!session || session.expiresAt < now) siteSessions.delete(token);
  }
}

function createSiteSession() {
  pruneSiteSessions();
  const token = randomBytes(32).toString("hex");
  siteSessions.set(token, { expiresAt: Date.now() + SITE_SESSION_MS });
  return token;
}

function readAdminSession(req) {
  const token = parseCookies(req.headers.cookie)[ADMIN_SESSION_COOKIE];
  if (!token) return null;
  const session = adminSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    adminSessions.delete(token);
    return null;
  }
  return { token, session };
}

function readSiteSession(req) {
  const token = parseCookies(req.headers.cookie)[SITE_SESSION_COOKIE];
  if (!token) return null;
  const session = siteSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    siteSessions.delete(token);
    return null;
  }
  return { token, session };
}

function isAdminRequest(req) {
  return Boolean(readAdminSession(req));
}

function isSiteUnlocked(req) {
  if (!SITE_PIN) return true;
  if (isAdminRequest(req)) return true;
  return Boolean(readSiteSession(req));
}

function siteLockBypassPath(pathname) {
  const p = String(pathname || "");
  if (p === "/api/health") return true;
  if (p === "/api/site-lock/login" || p === "/api/site-lock/status") return true;
  if (p === "/admin" || p.startsWith("/admin/")) return true;
  if (p === "/tech" || p.startsWith("/tech/")) return true;
  if (p.startsWith("/api/admin/")) return true;
  // Keep workshop APIs and customer quote/report links available; only the public site is gated.
  if (p.startsWith("/api/") && p !== "/api/booking" && !p.startsWith("/api/booking/")) return true;
  if (p === "/r" || p.startsWith("/r/")) return true;
  if (p === "/b" || p.startsWith("/b/")) return true;
  if (p === "/report" || p.startsWith("/report/")) return true;
  if (p === "/billing" || p.startsWith("/billing/")) return true;
  if (p.startsWith("/uploads/")) return true;
  return false;
}

function siteLockGateHtml() {
  return `<!DOCTYPE html>
<html lang="en-NZ">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Preview lock · Deane Auto Repairs</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:"Segoe UI",Arial,sans-serif;background:#0f2744;color:#1a2332}
    form{width:min(380px,calc(100% - 2rem));background:#fff;border-radius:14px;padding:1.4rem;display:grid;gap:.7rem}
    h1{margin:0;font-size:1.25rem}
    p{margin:0;color:#5b6777;font-size:.95rem}
    label{display:grid;gap:.3rem;font-weight:700;font-size:.92rem}
    input,button{font:inherit;padding:.65rem .75rem;border-radius:10px;border:1px solid #d7e0ea}
    button{background:#1565c0;border-color:#1565c0;color:#fff;font-weight:700;cursor:pointer}
    .error{color:#c62828;margin:0}
  </style>
</head>
<body>
  <form id="gate">
    <h1>Deane Auto Repairs</h1>
    <p>This website is in preview. Enter the site PIN to continue.</p>
    <label>Site PIN<input id="pin" type="password" autocomplete="current-password" required /></label>
    <button type="submit">Unlock</button>
    <p id="err" class="error" hidden></p>
  </form>
  <script>
    const form=document.getElementById("gate");
    const err=document.getElementById("err");
    form.addEventListener("submit",async(e)=>{
      e.preventDefault();
      err.hidden=true;
      try{
        const res=await fetch("/api/site-lock/login",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          credentials:"include",
          body:JSON.stringify({pin:document.getElementById("pin").value})
        });
        const data=await res.json().catch(()=>({}));
        if(!res.ok) throw new Error(data.error||"Wrong PIN");
        location.reload();
      }catch(ex){
        err.hidden=false;
        err.textContent=ex.message||"Unlock failed";
      }
    });
  </script>
</body>
</html>`;
}

function requireSiteUnlock(req, res, next) {
  if (!SITE_PIN) return next();
  if (siteLockBypassPath(req.path) || isSiteUnlocked(req)) return next();
  const wantsHtml = String(req.headers.accept || "").includes("text/html");
  if (wantsHtml || req.method === "GET" || req.method === "HEAD") {
    res.setHeader("Cache-Control", "no-store");
    return res.status(401).type("html").send(siteLockGateHtml());
  }
  return res.status(401).json({ error: "Site is locked. Enter the preview PIN first." });
}

function requireAdmin(req, res, next) {
  const staff = staffFromReq(req);
  if (!staff) {
    return res.status(401).json({ error: "Please sign in" });
  }
  staffContext.run({ staff }, () => next());
}

function requireOwnerAdmin(req, res, next) {
  const staff = staffFromReq(req);
  if (!staff) {
    return res.status(401).json({ error: "Please sign in" });
  }
  if (staff.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  staffContext.run({ staff }, () => next());
}

function workshopCurrentIndex() {
  const jobs = readJobs();
  const reports = readReports();
  const activeJobIds = new Set();
  const linkedBillingIds = new Set();
  const openReportBillingIds = new Set();
  for (const job of jobs) {
    const status = jobsLib.normalizeJobStatus(job.status, job.parts || []);
    if (status === "collected") continue;
    activeJobIds.add(job.id);
    if (job.quoteId) linkedBillingIds.add(job.quoteId);
    if (job.invoiceId) linkedBillingIds.add(job.invoiceId);
  }
  for (const report of reports) {
    if (String(report.status || "") === "published") continue;
    if (report.invoiceId) openReportBillingIds.add(report.invoiceId);
  }
  return { activeJobIds, linkedBillingIds, openReportBillingIds, reports };
}

function isCurrentWorkshopBilling(doc, index = workshopCurrentIndex()) {
  if (!doc || doc.status === "void") return false;
  if (doc.jobId && index.activeJobIds.has(doc.jobId)) return true;
  if (index.linkedBillingIds.has(doc.id)) return true;
  if (index.openReportBillingIds.has(doc.id)) return true;
  if (doc.reportId) {
    const report = (index.reports || []).find((row) => row.id === doc.reportId);
    if (report && String(report.status || "") !== "published") return true;
  }
  if (doc.kind === "quote") {
    return doc.status === "draft" || doc.status === "sent" || doc.status === "accepted";
  }
  if (doc.kind === "invoice") {
    const totals = catalog.computeTotals(doc.lines || []);
    const payment = normalizeInvoicePayment(doc, {}, totals);
    return Boolean(payment.paymentStatus && payment.paymentStatus !== "paid");
  }
  return false;
}

function requireCurrentBillingIfTech(req, res, next) {
  const staff = staffFromReq(req);
  if (!staff || staff.role !== "technician") return next();
  const docs = readBilling();
  const doc = docs.find((row) => row && row.id === req.params.id);
  if (!doc) return res.status(404).json({ error: billingMissingError() });
  if (!isCurrentWorkshopBilling(doc)) {
    return res.status(403).json({
      error: "This quote/invoice is in history. Ask admin to open it.",
    });
  }
  next();
}

function loginBlockedSeconds(ip) {
  const row = loginAttempts.get(ip);
  if (!row) return 0;
  if (row.blockedUntil && row.blockedUntil > Date.now()) {
    return Math.ceil((row.blockedUntil - Date.now()) / 1000);
  }
  if (row.windowStart && Date.now() - row.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
    return 0;
  }
  return 0;
}

function recordLoginFailure(ip) {
  const now = Date.now();
  let row = loginAttempts.get(ip);
  if (!row || now - row.windowStart > LOGIN_WINDOW_MS) {
    row = { windowStart: now, fails: 0, blockedUntil: 0 };
  }
  row.fails += 1;
  if (row.fails >= LOGIN_MAX_FAILS) {
    row.blockedUntil = now + LOGIN_BLOCK_MS;
  }
  loginAttempts.set(ip, row);
}

function clearLoginFailures(ip) {
  loginAttempts.delete(ip);
}

function patchById(readFn, writeFn, id, patcher) {
  const rows = readFn();
  const index = rows.findIndex((row) => row && row.id === id);
  if (index < 0) return null;
  rows[index] = patcher(rows[index]);
  writeFn(rows);
  return rows[index];
}

const UPLOAD_MIME_EXT = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};
const OCR_IMPORT_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = UPLOAD_MIME_EXT[file.mimetype] || ".jpg";
    cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mimeOk = Boolean(UPLOAD_MIME_EXT[file.mimetype]) && file.mimetype !== "application/pdf";
    const extOk = UPLOAD_EXTS.has(path.extname(file.originalname || "").toLowerCase());
    if (!mimeOk || !extOk) {
      const err = new Error("Please upload a JPEG, PNG, GIF, or WebP photo.");
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});
const invoiceEvidenceUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!OCR_IMPORT_MIME.has(file.mimetype)) {
      const err = new Error("Upload a PDF or image file.");
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});
const ocrImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!OCR_IMPORT_MIME.has(file.mimetype)) {
      const err = new Error("Upload a PDF or image file.");
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));

app.get("/api/site-lock/status", (_req, res) => {
  res.json({ locked: Boolean(SITE_PIN) });
});

app.post("/api/site-lock/login", (req, res) => {
  if (!SITE_PIN) {
    return res.json({ ok: true, locked: false });
  }
  const ip = clientIp(req);
  const wait = loginBlockedSeconds(ip);
  if (wait > 0) {
    res.setHeader("Retry-After", String(wait));
    return res.status(429).json({
      error: "Too many sign-in attempts. Try again in 15 minutes.",
    });
  }
  if (String(req.body?.pin || "") !== SITE_PIN) {
    recordLoginFailure(ip);
    return res.status(401).json({ error: "Wrong PIN" });
  }
  clearLoginFailures(ip);
  const token = createSiteSession();
  res.setHeader("Set-Cookie", siteCookieHeader(req, token, SITE_SESSION_MS));
  res.json({ ok: true, locked: true });
});

app.use(requireSiteUnlock);

app.get("/uploads/:filename", (req, res) => {
  const filePath = safeUploadPath(UPLOADS_DIR, req.params.filename);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).end();
  }
  res.sendFile(
    filePath,
    {
      dotfiles: "deny",
      headers: {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=86400",
      },
    },
    (err) => {
      if (err && !res.headersSent) res.status(404).end();
    }
  );
});
app.use((req, res, next) => {
  if (blockedStaticPath(req.path)) {
    return res.status(404).end();
  }
  next();
});
app.use(
  "/admin",
  express.static(path.join(ROOT, "admin"), {
    etag: false,
    lastModified: false,
    dotfiles: "deny",
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store");
    },
  })
);
app.use(
  "/tech",
  express.static(path.join(ROOT, "tech"), {
    etag: false,
    lastModified: false,
    dotfiles: "deny",
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store");
    },
  })
);
app.use("/report", express.static(path.join(ROOT, "report"), { dotfiles: "deny" }));
app.use("/billing", express.static(path.join(ROOT, "billing"), { dotfiles: "deny" }));
app.use(express.static(ROOT, {
  index: "index.html",
  dotfiles: "deny",
  setHeaders(res, filePath) {
    if (String(filePath || "").replace(/\\/g, "/").includes("/preview/")) {
      res.setHeader("Cache-Control", "no-store");
    }
  },
}));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    shop: business.name,
    dataDir: DATA_DIR,
    restoreWorkshop: true,
    siteLocked: Boolean(SITE_PIN),
    googleReviewConfigured: reviewConfigured(),
  });
});

app.get("/api/google-review-qr.png", async (_req, res) => {
  const url = googleReviewUrl();
  if (!url) {
    return res.status(404).json({ error: "Google review link is not configured." });
  }
  try {
    const png = await reviewQrPngBuffer(url, 180);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(png);
  } catch (err) {
    console.error("Google review QR failed:", err);
    res.status(500).json({ error: "Could not create review QR code." });
  }
});

function findCustomerByMobile(mobile) {
  const want = websms.normalizeNzMobile(mobile);
  if (!want) return null;
  for (const c of readSavedCustomers()) {
    if (websms.normalizeNzMobile(c.customerPhone) === want) {
      const names = namesFromCustomer(c);
      const vehicles = normalizeVehicles(c, c);
      return {
        customerId: c.id,
        customerName: names.customerName || "",
        registration: vehicles[0]?.registration || c.registration || "",
      };
    }
  }
  return null;
}

function formatSmsPhoneDisplay(value) {
  const n = websms.normalizeNzMobile(value) || String(value || "").replace(/\D/g, "");
  if (!n) return "";
  if (n.startsWith("64") && n.length >= 10) return `0${n.slice(2)}`;
  return n;
}

function readSmsLog() {
  const rows = readJsonArray(SMS_LOG_FILE, "sms log");
  const legacy = readJsonArray(SMS_INBOUND_FILE, "sms inbound");
  if (!legacy.length) return rows;
  const seen = new Set(rows.map((r) => r.id).filter(Boolean));
  const seenMsg = new Set(
    rows
      .filter((r) => r.direction === "in" && r.messageId)
      .map((r) => String(r.messageId))
  );
  let changed = false;
  for (const row of legacy) {
    const id = row.id || randomUUID();
    if (seen.has(id)) continue;
    if (row.messageId && seenMsg.has(String(row.messageId))) continue;
    const matched = findCustomerByMobile(row.from);
    rows.push({
      id,
      direction: "in",
      kind: "reply",
      at: row.receivedAt || row.at || nowIso(),
      from: String(row.from || "").trim(),
      to: String(row.to || "").trim(),
      body: String(row.body || "").trim(),
      messageId: String(row.messageId || "").trim(),
      replyTo: String(row.replyTo || "").trim(),
      customerId: matched?.customerId || "",
      customerName: matched?.customerName || "",
      registration: matched?.registration || "",
      sandbox: false,
      handled: Boolean(row.handled),
    });
    seen.add(id);
    changed = true;
  }
  if (changed) {
    rows.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
    writeJsonArray(SMS_LOG_FILE, rows.length > 1000 ? rows.slice(-1000) : rows);
  }
  return rows;
}

function appendSmsLog(entry = {}) {
  const rows = readSmsLog();
  const matched =
    entry.customerId
      ? null
      : findCustomerByMobile(entry.direction === "in" ? entry.from : entry.to);
  const row = {
    id: entry.id || randomUUID(),
    direction: entry.direction === "in" ? "in" : "out",
    kind: String(entry.kind || (entry.direction === "in" ? "reply" : "out")).trim(),
    at: entry.at || nowIso(),
    from: String(entry.from || "").trim(),
    to: String(entry.to || "").trim(),
    body: String(entry.body || "").trim(),
    messageId: String(entry.messageId || "").trim(),
    replyTo: String(entry.replyTo || "").trim(),
    customerId: String(entry.customerId || matched?.customerId || "").trim(),
    customerName: String(entry.customerName || matched?.customerName || "").trim(),
    registration: String(entry.registration || matched?.registration || "").trim(),
    vehicleId: String(entry.vehicleId || "").trim(),
    appointmentId: String(entry.appointmentId || "").trim(),
    sandbox: Boolean(entry.sandbox),
    handled: Boolean(entry.handled),
    handleResult: String(entry.handleResult || "").trim(),
  };
  rows.push(row);
  writeJsonArray(SMS_LOG_FILE, rows.length > 1000 ? rows.slice(-1000) : rows);
  return row;
}

/** Parse short YES/NO booking replies. Returns "yes" | "no" | "". */
function parseBookingSmsReply(body) {
  const text = String(body || "")
    .trim()
    .toLowerCase()
    .replace(/^[^\w]+|[^\w]+$/g, "");
  if (!text) return "";
  const first = text.split(/\s+/)[0] || "";
  if (["yes", "y", "yeah", "yep", "ok", "okay", "confirm", "confirmed"].includes(first)) {
    return "yes";
  }
  if (["no", "n", "nope", "nah", "cancel", "reschedule"].includes(first)) {
    return "no";
  }
  if (/^(yes|y)\b/.test(text)) return "yes";
  if (/^(no|n)\b/.test(text)) return "no";
  return "";
}

function findAppointmentForBookingSmsReply(fromMobile, replyToMessageId = "") {
  const want = websms.normalizeNzMobile(fromMobile);
  if (!want) return null;
  const today = todayIso();
  const tomorrow = plusDays(today, 1);
  const rows = readAppointments().map((row) => syncAppointmentJobMeta({ ...row }));

  if (replyToMessageId) {
    const out = readSmsLog().find(
      (row) =>
        row.direction === "out" &&
        row.kind === "booking_confirm" &&
        String(row.messageId || "") === String(replyToMessageId)
    );
    if (out?.appointmentId) {
      const hit = rows.find((row) => row.id === out.appointmentId);
      if (hit && hit.status !== "cancelled" && hit.status !== "no_show") return hit;
    }
    if (out?.registration || out?.customerId) {
      const byLink = rows.find((row) => {
        if (row.status === "cancelled" || row.status === "no_show") return false;
        if (websms.normalizeNzMobile(row.customerPhone) !== want) return false;
        if (out.customerId && row.customerId && row.customerId === out.customerId) return true;
        if (out.registration && plateKey(row.registration) === plateKey(out.registration)) {
          return true;
        }
        return false;
      });
      if (byLink) return byLink;
    }
  }

  const candidates = rows
    .filter((row) => {
      if (row.status === "cancelled" || row.status === "no_show") return false;
      if (websms.normalizeNzMobile(row.customerPhone) !== want) return false;
      if (!row.date || row.date < today) return false;
      return true;
    })
    .sort((a, b) => {
      const byDate = String(a.date).localeCompare(String(b.date));
      if (byDate) return byDate;
      return String(a.startTime).localeCompare(String(b.startTime));
    });

  const withSms = candidates.filter((row) => row.bookingSmsReminderSentAt);
  const tomorrowSms = withSms.filter((row) => row.date === tomorrow);
  if (tomorrowSms.length) return tomorrowSms[0];
  if (withSms.length) return withSms[0];
  const tomorrowOnly = candidates.filter((row) => row.date === tomorrow);
  if (tomorrowOnly.length === 1) return tomorrowOnly[0];
  if (candidates.length === 1) return candidates[0];
  return null;
}

function applyBookingSmsReply({ from, body, replyTo = "" } = {}) {
  const reply = parseBookingSmsReply(body);
  if (!reply) return { handled: false, reason: "not_yes_no" };
  const appt = findAppointmentForBookingSmsReply(from, replyTo);
  if (!appt) return { handled: false, reason: "no_match", reply };
  const rows = readAppointments();
  const index = rows.findIndex((row) => row.id === appt.id);
  if (index < 0) return { handled: false, reason: "missing", reply };
  const now = nowIso();
  const current = appointmentsLib.normalizeAppointment(rows[index], rows[index].id);
  const mutable = new Set(["booked", "confirmed", "needs_reschedule"]);
  let nextStatus = current.status;
  let noteLine = "";
  let ignored = false;
  if (!mutable.has(current.status)) {
    ignored = true;
    noteLine = `Customer SMS ${formatDateShort(now) || now.slice(0, 10)}: ${reply.toUpperCase()} (ignored — status is ${current.status}).`;
  } else if (reply === "yes") {
    nextStatus = "confirmed";
    noteLine = `Customer SMS ${formatDateShort(now) || now.slice(0, 10)}: YES — confirmed.`;
  } else {
    nextStatus = "needs_reschedule";
    noteLine = `Customer SMS ${formatDateShort(now) || now.slice(0, 10)}: NO — need reschedule.`;
  }
  const notes = [noteLine, current.notes].filter(Boolean).join("\n");
  rows[index] = appointmentsLib.normalizeAppointment(
    {
      ...current,
      status: nextStatus,
      notes,
      bookingSmsReply: reply,
      bookingSmsReplyAt: now,
      updatedAt: now,
    },
    current.id
  );
  writeAppointments(rows);
  console.log(
    `Booking SMS reply ${reply.toUpperCase()} → appointment ${current.id} status=${nextStatus}${
      ignored ? " (ignored)" : ""
    }`
  );
  return {
    handled: true,
    reply,
    appointmentId: current.id,
    status: nextStatus,
    ignored,
    customerName: current.customerName || "",
    registration: current.registration || "",
  };
}

/**
 * WebSMS Connexus webhook — public (no admin login).
 * Set in WebSMS Members Area → API Keys → Webhook URL to:
 *   https://deane-auto-repairs.onrender.com/api/websms/webhook
 * Optional: ?secret=... with WEBSMS_WEBHOOK_SECRET on Render.
 */
app.post("/api/websms/webhook", (req, res) => {
  const expected = String(process.env.WEBSMS_WEBHOOK_SECRET || "").trim();
  if (expected) {
    const got = String(req.query.secret || req.headers["x-websms-secret"] || "").trim();
    if (got !== expected) {
      console.warn("WebSMS webhook rejected: secret mismatch");
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  // ACK quickly so WebSMS does not retry (must be within ~5s).
  res.status(200).json({ ok: true });

  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const type = String(payload.type || "").trim();
  const fromRaw = String(payload.from || "").trim();
  const body = String(payload.body || payload.message || "").trim();
  const looksLikeInbound =
    type === "SMS" ||
    type === "mo" ||
    type === "MO" ||
    (!type && fromRaw && body);
  try {
    if (looksLikeInbound) {
      const from = websms.normalizeNzMobile(fromRaw) || fromRaw.replace(/^\+/, "");
      const replyTo = String(
        payload.replyTo || payload.replyToConnexusId || payload.relatedMessageId || ""
      ).trim();
      const applied = applyBookingSmsReply({ from, body, replyTo });
      const logged = appendSmsLog({
        direction: "in",
        kind: applied.reply ? `reply_${applied.reply}` : "reply",
        from,
        to: String(payload.to || "").trim(),
        body,
        messageId: String(payload.messageId || payload.connexusMessageId || "").trim(),
        replyTo,
        appointmentId: applied.appointmentId || "",
        customerName: applied.customerName || "",
        registration: applied.registration || "",
        handled: Boolean(applied.handled),
        handleResult: applied.handled
          ? `${applied.reply} → ${applied.status}${applied.ignored ? " (ignored)" : ""}`
          : applied.reason || "",
      });
      try {
        const legacy = readJsonArray(SMS_INBOUND_FILE, "sms inbound");
        legacy.push({
          id: logged.id,
          receivedAt: logged.at,
          type: "SMS",
          from,
          to: logged.to,
          body,
          messageId: logged.messageId,
          replyTo: logged.replyTo,
          raw: payload,
          handled: Boolean(applied.handled),
          handleResult: logged.handleResult || "",
        });
        writeJsonArray(SMS_INBOUND_FILE, legacy.length > 500 ? legacy.slice(-500) : legacy);
      } catch (legacyErr) {
        console.error("Legacy sms-inbound write failed:", legacyErr);
      }
      console.log(
        `WebSMS inbound from ${from || "?"}: ${body.slice(0, 80)}${
          applied.handled ? ` [${applied.reply} → ${applied.appointmentId}]` : ""
        }`
      );
    } else if (type === "dlr" || type === "DLR") {
      console.log(
        `WebSMS DLR ${payload.status || "?"} messageId=${payload.messageId || payload.connexusMessageId || ""}`
      );
    } else {
      console.log(
        `WebSMS webhook ignored type=${type || "unknown"} keys=${Object.keys(payload).join(",")}`
      );
    }
  } catch (err) {
    console.error("WebSMS webhook processing failed:", err);
  }
});

app.get("/api/sms-inbox", requireOwnerAdmin, (_req, res) => {
  try {
    const rows = readSmsLog()
      .slice()
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
      .map((row) => ({
        ...row,
        phoneDisplay: formatSmsPhoneDisplay(row.direction === "in" ? row.from : row.to),
      }));
    res.json(rows);
  } catch (err) {
    console.error("SMS inbox failed:", err);
    res.status(500).json({ error: "Could not load SMS inbox." });
  }
});

app.post("/api/booking", async (req, res) => {
  if (String(req.body?._gotcha || "").trim()) {
    return res.json({ ok: true });
  }

  const name = bookingRequestsLib.blank(req.body?.name);
  const email = bookingRequestsLib.blank(req.body?.email);
  const phone = bookingRequestsLib.blank(req.body?.phone);
  const vehicle = bookingRequestsLib.blank(req.body?.vehicle);
  const registration = bookingRequestsLib.blank(req.body?.registration || req.body?.rego);
  const preferredDate = bookingRequestsLib.blank(req.body?.preferred_date || req.body?.date);
  const preferredTime = bookingRequestsLib.blank(req.body?.preferred_time || req.body?.time);
  const helpWith = bookingRequestsLib.blank(req.body?.help_with || req.body?.help);
  const notes = bookingRequestsLib.blank(req.body?.notes);

  if (!name || !email || !phone || !helpWith) {
    return res.status(400).json({ error: "Name, email, phone and service type are required." });
  }

  let saved;
  try {
    const rows = readBookingRequests();
    saved = bookingRequestsLib.normalizeBookingRequest(
      {
        name,
        email,
        phone,
        vehicle,
        registration,
        preferredDate,
        preferredTime,
        helpWith,
        notes,
        createdAt: nowIso(),
      },
      randomUUID()
    );
    rows.unshift(saved);
    writeBookingRequests(rows);
  } catch (err) {
    console.error("Could not save booking request:", err);
    return res.status(500).json({
      error: "Could not save the enquiry. Please call 0800 625 9827.",
    });
  }

  const subject = `Booking enquiry: ${helpWith} — ${name}`;
  const text =
    `New booking enquiry from the website\n\n` +
    `Name: ${name}\n` +
    `Email: ${email}\n` +
    `Phone: ${phone}\n` +
    `Vehicle: ${vehicle || "—"}\n` +
    `Registration: ${registration || "—"}\n` +
    `Preferred date: ${preferredDate || "—"}\n` +
    `Preferred time: ${preferredTime || "—"}\n` +
    `Help with: ${helpWith}\n` +
    `Notes: ${notes || "—"}\n`;

  if (smtpConfigured()) {
    try {
      const mailer = createMailer();
      await mailer.sendMail({
        from: MAIL_FROM,
        to: business.email,
        replyTo: email,
        subject,
        text,
      });
    } catch (err) {
      console.error("Booking email failed (request saved for admin):", err);
    }
  }

  res.json({ ok: true, id: saved.id });
});

function bookingRequestCounts(rows) {
  const unseen = rows.filter((row) => !row.seenAt && !row.handledAt);
  const pending = rows.filter((row) => !row.handledAt);
  return {
    unseen,
    pending,
    unseenCount: unseen.length,
    pendingCount: pending.length,
  };
}

app.get("/api/booking-requests", requireAdmin, (_req, res) => {
  try {
    const rows = readBookingRequests();
    const counts = bookingRequestCounts(rows);
    res.json({
      ...counts,
      recent: rows.slice(0, 30),
    });
  } catch (err) {
    console.error("Booking requests list failed:", err);
    res.status(500).json({ error: "Could not load booking requests." });
  }
});

app.post("/api/booking-requests/ack-all", requireAdmin, (_req, res) => {
  try {
    const now = nowIso();
    const rows = readBookingRequests().map((row) =>
      row.seenAt ? row : { ...row, seenAt: now }
    );
    writeBookingRequests(rows);
    res.json({ ok: true, ...bookingRequestCounts(rows) });
  } catch (err) {
    console.error("Booking requests ack-all failed:", err);
    res.status(500).json({ error: "Could not mark booking requests as seen." });
  }
});

app.post("/api/booking-requests/:id/ack", requireAdmin, (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const rows = readBookingRequests();
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) return res.status(404).json({ error: "Booking request not found." });
    if (!rows[index].seenAt) rows[index] = { ...rows[index], seenAt: nowIso() };
    writeBookingRequests(rows);
    res.json({ ok: true, request: rows[index], ...bookingRequestCounts(rows) });
  } catch (err) {
    console.error("Booking request ack failed:", err);
    res.status(500).json({ error: "Could not mark booking request as seen." });
  }
});

app.post("/api/booking-requests/:id/added", requireAdmin, (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const rows = readBookingRequests();
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) return res.status(404).json({ error: "Booking request not found." });
    const now = nowIso();
    rows[index] = {
      ...rows[index],
      seenAt: rows[index].seenAt || now,
      handledAt: rows[index].handledAt || now,
    };
    writeBookingRequests(rows);
    res.json({ ok: true, request: rows[index], ...bookingRequestCounts(rows) });
  } catch (err) {
    console.error("Booking request added mark failed:", err);
    res.status(500).json({ error: "Could not mark booking request as added." });
  }
});

app.delete("/api/booking-requests/:id", requireAdmin, (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const rows = readBookingRequests();
    const next = rows.filter((row) => row.id !== id);
    if (next.length === rows.length) return res.status(404).json({ error: "Booking request not found." });
    writeBookingRequests(next);
    res.json({ ok: true, ...bookingRequestCounts(next) });
  } catch (err) {
    console.error("Booking request delete failed:", err);
    res.status(500).json({ error: "Could not delete booking request." });
  }
});

app.get("/api/checklist", (req, res) => {
  const pkg = normalizePackage(req.query.package);
  res.json({
    package: pkg,
    statuses: STATUSES,
    groups: itemsForPackage(pkg),
    defaults: emptyChecks(pkg),
    actions: {
      standard: pkg === "basic" ? ACTIONS.basic : ACTIONS.standard,
      premiumExtra: pkg === "premium" ? ACTIONS.premiumExtra : [],
      fullExtra: pkg === "premium" ? ACTIONS.premiumExtra : [],
      either: pkg === "basic" ? [] : ACTIONS.either,
    },
  });
});

app.post("/api/admin/login", (req, res) => {
  const ip = clientIp(req);
  const wait = loginBlockedSeconds(ip);
  if (wait > 0) {
    res.setHeader("Retry-After", String(wait));
    return res.status(429).json({
      error: "Too many sign-in attempts. Try again in 15 minutes.",
    });
  }
  const username = String(req.body?.username || "").trim().toLowerCase();
  const secret = String(req.body?.password || req.body?.pin || "").trim();
  let role = "";
  let loginName = "";
  if (username && TECH_USERS[username] && secretsEqual(secret, TECH_USERS[username])) {
    role = "technician";
    loginName = username;
  } else if ((!username || username === "admin") && secretsEqual(secret, ADMIN_PIN)) {
    role = "admin";
    loginName = "admin";
  } else {
    recordLoginFailure(ip);
    return res.status(401).json({ error: "Wrong username or password" });
  }
  clearLoginFailures(ip);
  const token = createAdminSession(role, loginName);
  res.setHeader("Set-Cookie", adminCookieHeader(req, token, ADMIN_SESSION_MS));
  res.json({ ok: true, role, username: loginName });
});

app.post("/api/admin/logout", (req, res) => {
  const session = readAdminSession(req);
  if (session) adminSessions.delete(session.token);
  res.setHeader("Set-Cookie", adminCookieHeader(req, "", 0));
  res.json({ ok: true });
});

app.get("/api/admin/session", requireAdmin, (req, res) => {
  const staff = staffFromReq(req);
  res.json({
    ok: true,
    role: staff?.role || "admin",
    username: staff?.username || "admin",
  });
});

app.get("/api/reports", requireAdmin, (_req, res) => {
  const reports = readReports()
    .map((r) => ({
      id: r.id,
      jobNumber: r.jobNumber,
      invoiceNumber: r.invoiceNumber || "",
      status: r.status,
      serviceDate: r.serviceDate,
      customerName: r.customerName,
      registration: r.registration,
      vehicle: r.vehicle,
      jobType: r.jobType,
      servicePackage: r.servicePackage,
      updatedAt: r.updatedAt,
    }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json(reports);
});

app.get("/api/customers", requireAdmin, (_req, res) => {
  try {
    res.json(listCustomers());
  } catch (err) {
    console.error("Customers list failed:", err);
    res.status(500).json({ error: "Could not load customers." });
  }
});

app.post("/api/customers", requireAdmin, (req, res) => {
  try {
    const fields = normalizeSavedCustomer(req.body);
    const rows = readSavedCustomers();
    const plateOwner = findCustomerWithSamePlate(rows, fields.vehicles);
    if (plateOwner) {
      const err = new Error(
        `Plate ${fields.vehicles
          .map((v) => v.registration)
          .filter(Boolean)
          .join(", ")} is already on ${plateOwner.customerName}. Open that record instead.`
      );
      err.status = 400;
      throw err;
    }
    // Same name / same email allowed — one customer record = one plate.
    const now = nowIso();
    const seq = nextCustomerSeq(rows);
    const row = {
      id: randomUUID(),
      ...fields,
      dailySeq: seq,
      customerSeq: seq,
      dailySeqDate: "",
      createdAt: now,
      updatedAt: now,
    };
    rows.push(row);
    writeSavedCustomers(rows);
    res.status(201).json(row);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.put("/api/customers/:id", requireAdmin, (req, res) => {
  try {
    const rows = readSavedCustomers();
    const index = rows.findIndex((c) => c.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Customer not found" });
    const current = rows[index];
    const fields = normalizeSavedCustomer(req.body, current);
    // Only re-check plates when the client sent a vehicles array (full edit).
    // Contact-only inline saves omit vehicles and keep the stored list.
    if (Array.isArray(req.body?.vehicles)) {
      const plateOwner = findCustomerWithSamePlate(rows, fields.vehicles, current.id);
      if (plateOwner) {
        const err = new Error(
          `Plate ${fields.vehicles
            .map((v) => v.registration)
            .filter(Boolean)
            .join(", ")} is already on ${plateOwner.customerName}. Open that record instead.`
        );
        err.status = 400;
        throw err;
      }
    }
    rows[index] = {
      ...current,
      ...fields,
      id: current.id,
      createdAt: current.createdAt,
      dailySeq: current.dailySeq,
      customerSeq: current.customerSeq || current.dailySeq,
      dailySeqDate: current.dailySeqDate,
      updatedAt: nowIso(),
    };
    writeSavedCustomers(rows);
    res.json(rows[index]);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.delete("/api/customers/:id", requireOwnerAdmin, (req, res) => {
  const rows = readSavedCustomers();
  const customer = rows.find((c) => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  if (invoiceBlocksCustomerDelete(customer)) {
    return res.status(400).json({
      error: "This customer has an invoice. Delete is not available.",
    });
  }

  writeSavedCustomers(rows.filter((c) => c.id !== req.params.id));
  res.json({ ok: true });
});

app.get("/api/referrals/rules", requireOwnerAdmin, (_req, res) => {
  res.json({ ...referralsLib.rules });
});

app.get("/api/referrals", requireOwnerAdmin, (req, res) => {
  try {
    const rows = readReferrals();
    const status = String(req.query.status || "").trim();
    const customerId = String(req.query.customerId || "").trim();
    let list = referralsLib.enrichReferralList(
      rows,
      customerNameMap(),
      billingIdMap(readBilling())
    );
    if (status) list = list.filter((row) => row.status === status);
    if (customerId) {
      list = list.filter(
        (row) =>
          row.referrerCustomerId === customerId ||
          row.referredCustomerId === customerId
      );
    }
    res.json(list);
  } catch (err) {
    console.error("Referrals list failed:", err);
    res.status(err.status || 500).json({ error: err.message || "Could not load referrals." });
  }
});

app.post("/api/referrals", requireOwnerAdmin, (req, res) => {
  try {
    const result = referralsLib.createReferral({
      referrerCustomerId: req.body?.referrerCustomerId,
      referredCustomerId: req.body?.referredCustomerId,
      notes: req.body?.notes,
      billingDocs: readBilling(),
      jobs: readJobs(),
      storeRows: readReferrals(),
    });
    writeReferrals(result.rows);
    const enriched = referralsLib.enrichReferralList(
      result.rows,
      customerNameMap(),
      billingIdMap(readBilling())
    ).find((row) => row.id === result.referral.id);
    res.status(result.rejected ? 200 : 201).json({
      referral: enriched || result.referral,
      rejected: Boolean(result.rejected),
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/referrals/:id/cancel", requireOwnerAdmin, (req, res) => {
  try {
    const result = referralsLib.cancelReferral(readReferrals(), req.params.id);
    writeReferrals(result.rows);
    res.json({ ok: true, referral: result.referral });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.get("/api/referral-credits", requireAdmin, (req, res) => {
  try {
    const customerId = String(req.query.customerId || "").trim();
    const rows = readReferrals();
    if (customerId) {
      return res.json(referralsLib.creditBalanceSummary(rows, customerId));
    }
    if (staffFromReq(req)?.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }
    const owners = new Map();
    for (const row of rows) {
      if (row.type !== "credit") continue;
      if (!owners.has(row.ownerCustomerId)) owners.set(row.ownerCustomerId, true);
    }
    const names = customerNameMap();
    const billingById = billingIdMap(readBilling());
    const list = [...owners.keys()].map((id) => {
      const summary = referralsLib.creditBalanceSummary(rows, id);
      const customer = names.get(id);
      return {
        ...summary,
        customerName: customer?.customerName || "",
      };
    });
    res.json({
      balances: list,
      ledger: referralsLib.creditLedger(rows, names, billingById),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Could not load credits." });
  }
});

app.post("/api/billing/:id/apply-referral-credits", requireAdmin, (req, res) => {
  try {
    const docs = readBilling();
    const index = docs.findIndex((d) => d.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: billingMissingError() });
    const result = referralsLib.applyCreditsToInvoice({
      storeRows: readReferrals(),
      invoice: docs[index],
      creditIds: req.body?.creditIds,
    });
    writeReferrals(result.rows);
    const totals = catalog.computeTotals(result.invoice.lines || []);
    const payment = normalizeInvoicePayment(result.invoice, {}, totals);
    result.invoice.paymentStatus = payment.paymentStatus;
    result.invoice.amountPaid = payment.amountPaid;
    result.invoice.paidAt = payment.paidAt;
    result.invoice.paymentNote = payment.paymentNote;
    ensureHistory(result.invoice);
    appendHistory(result.invoice, {
      type: "referral_credit",
      summary: "Referral credit applied",
      detail: `${result.appliedAmount.toFixed(2)} from referral credits on ${result.invoice.number || "invoice"}`,
      amount: result.appliedAmount,
    });
    docs[index] = result.invoice;
    writeBilling(docs);
    if (payment.paymentStatus === "paid" && result.invoice.customerId) {
      try {
        persistQualifiedReferrals(result.invoice.customerId, docs);
      } catch (err) {
        console.error("Could not qualify referrals after credit apply:", err);
      }
    }
    res.json({
      ok: true,
      appliedAmount: result.appliedAmount,
      referralCreditTotal: result.referralCreditTotal,
      doc: withBillingTotals(docs[index], true),
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/billing/:id/remove-referral-credits", requireAdmin, (req, res) => {
  try {
    const docs = readBilling();
    const index = docs.findIndex((d) => d.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: billingMissingError() });
    const result = referralsLib.removeCreditsFromInvoice({
      storeRows: readReferrals(),
      invoice: docs[index],
    });
    writeReferrals(result.rows);
    if (result.removedAmount > 0) {
      ensureHistory(result.invoice);
      appendHistory(result.invoice, {
        type: "referral_credit_removed",
        summary: "Referral credit removed",
        amount: result.removedAmount,
      });
    }
    const totals = catalog.computeTotals(result.invoice.lines || []);
    const payment = normalizeInvoicePayment(result.invoice, {}, totals);
    result.invoice.paymentStatus = payment.paymentStatus;
    result.invoice.amountPaid = payment.amountPaid;
    docs[index] = result.invoice;
    writeBilling(docs);
    res.json({
      ok: true,
      removedAmount: result.removedAmount,
      doc: withBillingTotals(docs[index], true),
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.get("/api/reports/:id", (req, res) => {
  const report = readReports().find((r) => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: "Report not found" });

  const isAdmin = isAdminRequest(req);
  if (report.status !== "published" && !isAdmin) {
    return res.status(404).json({ error: "Report not found" });
  }
  if (!isAdmin && !publicViewTokenOk(report, req.query.v)) {
    return res.status(404).json({ error: "Report not found" });
  }
  const payload = withReportPhotos(report);
  if (!isAdmin) delete payload.viewToken;
  res.json(payload);
});

app.post("/api/reports", requireAdmin, (_req, res) => {
  res.status(400).json({
    error: "Create a report from an invoice. Direct reports are not used.",
  });
});

app.post("/api/reports/from-invoice/:id", requireAdmin, (req, res) => {
  try {
    const docs = readBilling();
    const invoice = docs.find((d) => d.id === req.params.id);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    if (staffFromReq(req)?.role === "technician" && !isCurrentWorkshopBilling(invoice)) {
      return res.status(403).json({ error: "This quote/invoice is in history. Ask admin to open it." });
    }
    const ensured = ensureReportFromInvoice(docs, invoice);
    if (ensured.created) writeBilling(docs);
    res.status(ensured.created ? 201 : 200).json(ensured.report);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.put("/api/reports/:id", requireAdmin, (req, res) => {
  const reports = readReports();
  const index = reports.findIndex((r) => r.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Report not found" });

  const current = reports[index];
  const body = req.body || {};
  const nextPackage =
    body.servicePackage != null
      ? normalizePackage(body.servicePackage)
      : normalizePackage(current.servicePackage);

  let checks = body.checks || current.checks;
  if (nextPackage !== current.servicePackage) {
    const fresh = emptyChecks(nextPackage);
    if (nextPackage === "basic") {
      for (const code of BASIC_CHECK_CODES) {
        if (checks[code]) fresh[code] = checks[code];
      }
    } else if (current.servicePackage !== "basic") {
      for (const code of Object.keys(fresh)) {
        if (checks[code]) fresh[code] = checks[code];
      }
    }
    checks = fresh;
  }

  let snapshot;
  try {
    snapshot = requireCustomerSnapshot(body.customerId ? body : current);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  reports[index] = {
    ...current,
    ...body,
    ...snapshot,
    id: current.id,
    jobNumber: current.jobNumber,
    invoiceId: current.invoiceId || "",
    invoiceNumber: current.invoiceNumber || "",
    createdAt: current.createdAt,
    servicePackage: nextPackage,
    checks,
    customerConcern: catalog.capitalizeLineDescription(
      body.customerConcern != null ? body.customerConcern : current.customerConcern
    ),
    actionsOther: catalog.capitalizeLineDescription(
      body.actionsOther != null ? body.actionsOther : current.actionsOther
    ),
    summary: catalog.capitalizeLineDescription(
      body.summary != null ? body.summary : current.summary
    ),
    technicianComments: catalog.capitalizeLineDescription(
      body.technicianComments != null ? body.technicianComments : current.technicianComments
    ),
    updatedAt: nowIso(),
  };

  writeReports(reports);
  res.json(withReportPhotos(reports[index]));
});

app.post("/api/reports/:id/publish", requireAdmin, (req, res) => {
  const reports = readReports();
  const index = reports.findIndex((r) => r.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Report not found" });

  reports[index].status = "published";
  reports[index].publishedAt = nowIso();
  reports[index].updatedAt = reports[index].publishedAt;
  ensureViewToken(reports[index]);
  writeReports(reports);
  res.json(reports[index]);
});

app.get("/api/admin/email-status", requireOwnerAdmin, (_req, res) => {
  let customersSaved = 0;
  try {
    customersSaved = readSavedCustomers().length;
  } catch {
    customersSaved = 0;
  }
  res.json({
    configured: smtpConfigured(),
    from: MAIL_FROM,
    publicBaseUrl: PUBLIC_BASE_URL || null,
    dataDir: DATA_DIR,
    customersSaved,
    websms: websms.publicStatus(),
  });
});

app.get("/api/admin/backup-status", requireOwnerAdmin, (_req, res) => {
  res.json(driveBackup.publicStatus(DATA_DIR));
});

app.get("/api/admin/backup.zip", requireOwnerAdmin, async (_req, res) => {
  let zipPath = "";
  try {
    const { includePhotos } = driveBackup.getConfig();
    const zip = await driveBackup.zipWorkshopData({
      dataDir: DATA_DIR,
      uploadsDir: UPLOADS_DIR,
      includePhotos,
    });
    zipPath = zip.zipPath;
    res.download(zip.zipPath, zip.zipName, (err) => {
      try {
        if (zipPath) fs.unlinkSync(zipPath);
      } catch {
        /* ignore */
      }
      if (err && !res.headersSent) {
        res.status(500).json({ error: err.message || "Download failed" });
      }
    });
  } catch (err) {
    if (zipPath) {
      try {
        fs.unlinkSync(zipPath);
      } catch {
        /* ignore */
      }
    }
    console.error("Backup zip download failed:", err);
    if (!res.headersSent) {
      res.status(err.status || 500).json({ error: err.message || "Backup zip failed" });
    }
  }
});

app.post("/api/admin/backup", requireOwnerAdmin, async (_req, res) => {
  try {
    const result = await driveBackup.runBackup({
      dataDir: DATA_DIR,
      uploadsDir: UPLOADS_DIR,
      reason: "manual",
    });
    res.json(result);
  } catch (err) {
    console.error("Manual backup failed:", err);
    res.status(err.status || 502).json({ error: err.message || "Backup failed" });
  }
});

app.post("/api/admin/restore-workshop", requireOwnerAdmin, (req, res) => {
  try {
    if (req.body?.replace !== true) {
      return res.status(400).json({
        error: "Pass replace: true to overwrite workshop data on this server.",
      });
    }
    const customers = req.body.customers;
    const billing = req.body.billing;
    const jobs = req.body.jobs;
    const reports = req.body.reports;
    if (
      !Array.isArray(customers) ||
      !Array.isArray(billing) ||
      !Array.isArray(jobs) ||
      !Array.isArray(reports)
    ) {
      return res.status(400).json({
        error: "customers, billing, jobs, and reports must be arrays.",
      });
    }
    writeSavedCustomers(customers);
    writeBilling(billing);
    writeJobs(jobs);
    writeJsonArray(REPORTS_FILE, reports);
    if (req.body.billingSeq && typeof req.body.billingSeq === "object" && !Array.isArray(req.body.billingSeq)) {
      writeBillingSeqMap(req.body.billingSeq);
    } else {
      bumpBillingHighWater(billing);
    }
    if (
      req.body.customersSeq &&
      typeof req.body.customersSeq === "object" &&
      !Array.isArray(req.body.customersSeq)
    ) {
      writeCustomerSeqMap(req.body.customersSeq);
    } else {
      bumpCustomerHighWater(customers);
    }

    // Optional extras — used to fully wipe / sync calendar, SMS, parts imports.
    if (Array.isArray(req.body.appointments)) writeAppointments(req.body.appointments);
    if (Array.isArray(req.body.supplierInvoices)) writeSupplierInvoices(req.body.supplierInvoices);
    if (Array.isArray(req.body.invoiceCandidates)) {
      writeJsonArray(INVOICE_CANDIDATES_FILE, req.body.invoiceCandidates);
    }
    if (Array.isArray(req.body.partAuditLog)) writeJsonArray(PART_AUDIT_FILE, req.body.partAuditLog);
    if (Array.isArray(req.body.smsLog)) writeJsonArray(SMS_LOG_FILE, req.body.smsLog);
    if (Array.isArray(req.body.smsInbound)) writeJsonArray(SMS_INBOUND_FILE, req.body.smsInbound);
    if (Array.isArray(req.body.bookingRequests)) writeBookingRequests(req.body.bookingRequests);
    if (Array.isArray(req.body.referrals)) writeReferrals(req.body.referrals);

    res.json({
      ok: true,
      dataDir: DATA_DIR,
      counts: {
        customers: customers.length,
        billing: billing.length,
        jobs: jobs.length,
        reports: reports.length,
        appointments: Array.isArray(req.body.appointments) ? req.body.appointments.length : undefined,
        supplierInvoices: Array.isArray(req.body.supplierInvoices)
          ? req.body.supplierInvoices.length
          : undefined,
        smsLog: Array.isArray(req.body.smsLog) ? req.body.smsLog.length : undefined,
        referrals: Array.isArray(req.body.referrals) ? req.body.referrals.length : undefined,
      },
    });
  } catch (err) {
    console.error("Workshop restore failed:", err);
    res.status(err.status || 500).json({ error: err.message || "Restore failed" });
  }
});

function aucklandClock(iso) {
  const raw = String(iso || "").trim();
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return { time: "—", period: "" };
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value || "";
  const minute = parts.find((part) => part.type === "minute")?.value || "00";
  const period = (parts.find((part) => part.type === "dayPeriod")?.value || "").toUpperCase();
  return { time: `${hour}:${minute}`, period };
}

function billingDocForJob(job, billingDocs) {
  return (
    (job.invoiceId && billingDocs.find((doc) => doc.id === job.invoiceId)) ||
    (job.quoteId && billingDocs.find((doc) => doc.id === job.quoteId)) ||
    null
  );
}

function jobMentionsWof(job, billingDocs) {
  const bill = billingDocForJob(job, billingDocs);
  if ((bill?.lines || []).some((line) => catalog.lineLooksLikeWof(line.description))) return true;
  return /\bwof\b/i.test(
    [job.workRequested, job.notes, bill?.notes].filter(Boolean).join(" ")
  );
}

function workLabelForJob(job, billingDocs) {
  const first = String(job.workRequested || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (first) return first.slice(0, 90);
  const bill = billingDocForJob(job, billingDocs);
  const line = (bill?.lines || []).find((row) => String(row.description || "").trim());
  if (line) return String(line.description).trim().slice(0, 90);
  return "Workshop job";
}

function nextActionForStatus(status) {
  if (status === "waiting_parts") return "Waiting on parts";
  if (status === "completed") return "Ready for collection";
  if (status === "collected") return "Vehicle collected";
  return "Continue workshop work";
}

function snapshotForPlate(plate, reports, customers) {
  const key = plateKey(plate);
  let wofExpiry = "";
  let photo = "";
  let lastService = "";
  let odometer = "";
  if (key) {
    for (const customer of customers) {
      const hit = normalizeVehicles(customer, customer).find(
        (vehicle) => plateKey(vehicle.registration) === key
      );
      if (hit) {
        wofExpiry = hit.wofExpiry || "";
        break;
      }
    }
    const latest = reports
      .filter((report) => plateKey(report.registration) === key)
      .sort((a, b) =>
        String(b.serviceDate || b.updatedAt || "").localeCompare(
          String(a.serviceDate || a.updatedAt || "")
        )
      )[0];
    if (latest) {
      lastService = String(latest.serviceDate || latest.updatedAt || "").slice(0, 10);
      photo = reportPhotoList(latest)[0] || "";
      odometer = String(latest.odometer || "");
    }
  }
  const meta = wofMeta(wofExpiry);
  let wofDaysLabel = "No WOF date";
  if (meta.daysUntil == null) wofDaysLabel = "No WOF date";
  else if (meta.daysUntil < 0) wofDaysLabel = `${Math.abs(meta.daysUntil)} days overdue`;
  else wofDaysLabel = `${meta.daysUntil} days remaining`;
  return {
    wofExpiry,
    wofExpiryLabel: formatDateShort(wofExpiry) || "—",
    wofDays: meta.daysUntil,
    wofDaysLabel,
    wofStatus: meta.wofStatus,
    lastService,
    lastServiceLabel: formatDateShort(lastService) || "—",
    photo,
    odometer,
  };
}

app.get("/api/admin/dashboard", requireOwnerAdmin, (req, res) => {
  try {
    const jobs = readJobs();
    const jobCounts = {
      waiting_parts: 0,
      in_progress: 0,
      completed: 0,
      collected: 0,
    };
    for (const job of jobs) {
      const status = jobsLib.normalizeJobStatus(job.status, job.parts || []);
      if (jobCounts[status] != null) jobCounts[status] += 1;
    }
    const jobTotal =
      jobCounts.waiting_parts + jobCounts.in_progress + jobCounts.completed;
    const today = todayIso();
    const todayUtc = new Date(`${today}T00:00:00Z`);
    const daysSinceMonday = (todayUtc.getUTCDay() + 6) % 7;
    const weekStart = plusDays(today, -daysSinceMonday);
    const thisMonthKey = monthKey();
    const requestedActivityMonth = String(req.query.month || "").trim();
    const activityMonthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedActivityMonth)
      ? requestedActivityMonth
      : thisMonthKey;
    const thisYear = Number(thisMonthKey.slice(0, 4));
    const collectedByMonth = Array.from({ length: 12 }, (_row, index) => {
      const key = `${thisYear}-${String(index + 1).padStart(2, "0")}`;
      return {
        key,
        label: monthShortLabel(key),
        count: 0,
      };
    });
    let collectedThisWeek = 0;
    let collectedThisMonth = 0;
    let collectedThisYear = 0;
    let collectedActivityMonth = 0;
    for (const job of jobs) {
      const status = jobsLib.normalizeJobStatus(job.status, job.parts || []);
      if (status !== "collected") continue;
      const day = String(job.collectedAt || job.updatedAt || job.createdAt || "").slice(0, 10);
      if (!day) continue;
      if (day >= weekStart && day <= today) collectedThisWeek += 1;
      if (day.startsWith(thisMonthKey)) collectedThisMonth += 1;
      if (day.startsWith(activityMonthKey)) collectedActivityMonth += 1;
      if (day.startsWith(`${thisYear}-`)) {
        collectedThisYear += 1;
        const monthIndex = Number(day.slice(5, 7)) - 1;
        if (collectedByMonth[monthIndex]) collectedByMonth[monthIndex].count += 1;
      }
    }

    let quotesAwaiting = 0;
    let quotesAwaitingTotal = 0;
    let invoicesUnpaidTotal = 0;
    let invoicesUnpaidCount = 0;
    let invoicesOverdueTotal = 0;
    let invoicesOverdueCount = 0;
    let paymentsThisMonthTotal = 0;
    let paymentsThisMonthCount = 0;

    const requestedYear = Number(req.query.year);
    const financialYear =
      Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2200
        ? requestedYear
        : thisYear;
    const financialYears = new Set([thisYear, financialYear]);
    const monthBuckets = new Map();
    for (let month = 1; month <= 12; month += 1) {
      const key = `${financialYear}-${String(month).padStart(2, "0")}`;
      monthBuckets.set(key, {
        key,
        label: monthShortLabel(key),
        year: financialYear,
        invoiced: 0,
        received: 0,
        outstanding: 0,
      });
    }

    const billing = readBilling();
    for (const doc of billing) {
      if (doc.status === "void") continue;
      const totals = catalog.computeTotals(doc.lines || []);
      if (doc.kind === "quote" && doc.status === "sent") {
        quotesAwaiting += 1;
        quotesAwaitingTotal = catalog.round2(quotesAwaitingTotal + totals.totalIncl);
      }
      if (doc.kind === "invoice") {
        const payment = normalizeInvoicePayment(doc, {}, totals);
        const isDraft = doc.status === "draft";
        if (!isDraft) {
          if (isInvoiceOverdue(doc, payment)) {
            invoicesOverdueCount += 1;
            invoicesOverdueTotal = catalog.round2(
              invoicesOverdueTotal + payment.balanceDue
            );
          }
          if (
            (payment.paymentStatus === "unpaid" || payment.paymentStatus === "deposit") &&
            payment.balanceDue > 0
          ) {
            invoicesUnpaidCount += 1;
            invoicesUnpaidTotal = catalog.round2(
              invoicesUnpaidTotal + payment.balanceDue
            );
          }
        }

        const anchor = String(doc.sentAt || doc.createdAt || doc.updatedAt || "");
        const docMonthKey = anchor.slice(0, 7);
        const docYear = Number(docMonthKey.slice(0, 4));
        if (Number.isInteger(docYear)) financialYears.add(docYear);
        const invoiceBucket = monthBuckets.get(docMonthKey);
        if (invoiceBucket) {
          invoiceBucket.invoiced = catalog.round2(
            invoiceBucket.invoiced + totals.totalIncl
          );
          if (!isDraft && payment.balanceDue > 0) {
            invoiceBucket.outstanding = catalog.round2(
              invoiceBucket.outstanding + payment.balanceDue
            );
          }
        }
        if (!isDraft) {
          for (const row of payment.payments) {
            const paidMonth = String(row.paidAt || "").slice(0, 7);
            const paidYear = Number(paidMonth.slice(0, 4));
            if (Number.isInteger(paidYear)) financialYears.add(paidYear);
            if (paidMonth === thisMonthKey) {
              paymentsThisMonthCount += 1;
              paymentsThisMonthTotal = catalog.round2(
                paymentsThisMonthTotal + row.amount
              );
            }
            const paymentBucket = monthBuckets.get(paidMonth);
            if (paymentBucket) {
              paymentBucket.received = catalog.round2(
                paymentBucket.received + row.amount
              );
            }
          }
        }
      }
    }

    let servicesThisMonth = 0;
    let wofsThisMonth = 0;
    for (const invoice of billing) {
      if (invoice.kind !== "invoice" || invoice.status === "void") continue;
      if (!(invoice.customerId || invoice.customerName || invoice.registration)) continue;
      const day = String(
        invoice.sentAt || invoice.createdAt || invoice.updatedAt || ""
      ).slice(0, 10);
      if (!day.startsWith(activityMonthKey)) continue;
      const lines = invoice.lines || [];
      const isService = lines.some(
        (line) =>
          Number(line.qty) > 0 && catalog.lineLooksLikeService(line.description)
      );
      const isWof = lines.some(
        (line) => Number(line.qty) > 0 && catalog.lineLooksLikeWof(line.description)
      );
      if (isService) servicesThisMonth += 1;
      if (isWof) wofsThisMonth += 1;
    }

    const financialMonthly = [...monthBuckets.values()];
    const activityMonthLabel = monthLongLabel(activityMonthKey);
    const reports = readReports();
    const customers = readSavedCustomers();
    const activeJobs = jobs
      .map((job) => ({
        job,
        status: jobsLib.normalizeJobStatus(job.status, job.parts || []),
      }))
      .filter((row) => row.status !== "collected")
      .sort((a, b) =>
        String(b.job.updatedAt || b.job.createdAt || "").localeCompare(
          String(a.job.updatedAt || a.job.createdAt || "")
        )
      );
    const boardJobs = activeJobs.slice(0, 8).map(({ job, status }) => {
      const clock = aucklandClock(job.createdAt || job.updatedAt);
      const snap = snapshotForPlate(job.registration, reports, customers);
      return {
        id: job.id,
        number: job.number || "",
        status,
        registration: String(job.registration || "").toUpperCase(),
        vehicle: job.vehicle || "",
        customerName: job.customerName || "",
        technicianName: job.technicianName || "",
        workLabel: workLabelForJob(job, billing),
        createdAt: job.createdAt || "",
        updatedAt: job.updatedAt || "",
        time: clock.time,
        period: clock.period,
        odometer: job.odometer || snap.odometer || "",
        lastServiceLabel: snap.lastServiceLabel,
        wofExpiryLabel: snap.wofExpiryLabel,
        wofDaysLabel: snap.wofDaysLabel,
        wofStatus: snap.wofStatus,
        photo: snap.photo,
        nextAction: nextActionForStatus(status),
        mentionsWof: jobMentionsWof(job, billing),
      };
    });
    const wofBoard = boardJobs.filter((row) => row.mentionsWof);
    const nextWof = wofBoard
      .filter((row) => String(row.createdAt || "").slice(0, 10) === today)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
    const wofToday = {
      count: wofBoard.length,
      nextLabel: nextWof
        ? `Next on the board ${nextWof.time}${nextWof.period ? ` ${nextWof.period}` : ""}`
        : wofBoard.length
          ? "On the job board"
          : "No WOF jobs on the board",
    };
    const activity = jobs.map((job) => ({
        tone: "red",
        icon: "+",
        title: "Job created",
        detail: `${workLabelForJob(job, billing)} · ${
          String(job.registration || "").toUpperCase() || "No plate"
        }`,
        at: job.createdAt || job.updatedAt || "",
      }));
    const activityFeed = activity
      .filter((row) => row.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 8);

    res.json({
      jobs: {
        total: jobTotal,
        waiting_parts: jobCounts.waiting_parts,
        in_progress: jobCounts.in_progress,
        completed: jobCounts.completed,
      },
      jobHistory: {
        week: collectedThisWeek,
        month: collectedThisMonth,
        year: collectedThisYear,
        yearLabel: thisYear,
        monthly: collectedByMonth,
      },
      quotesAwaitingAcceptance: {
        count: quotesAwaiting,
        totalIncl: quotesAwaitingTotal,
      },
      invoicesOutstanding: {
        count: invoicesUnpaidCount,
        totalIncl: invoicesUnpaidTotal,
      },
      invoicesOverdue: {
        count: invoicesOverdueCount,
        totalIncl: invoicesOverdueTotal,
      },
      paymentsThisMonth: {
        count: paymentsThisMonthCount,
        totalIncl: paymentsThisMonthTotal,
      },
      financialHistory: {
        year: financialYear,
        availableYears: [...financialYears].sort((a, b) => b - a),
        monthly: financialMonthly,
        totals: financialMonthly.reduce(
          (sum, row) => ({
            invoiced: catalog.round2(sum.invoiced + row.invoiced),
            received: catalog.round2(sum.received + row.received),
            outstanding: catalog.round2(sum.outstanding + row.outstanding),
          }),
          { invoiced: 0, received: 0, outstanding: 0 }
        ),
      },
      thisMonth: {
        key: activityMonthKey,
        label: activityMonthLabel,
        services: servicesThisMonth,
        wofs: wofsThisMonth,
        collected: collectedActivityMonth,
      },
      wofToday,
      board: {
        total: activeJobs.length,
        jobs: boardJobs,
      },
      activity: activityFeed,
      nav: {
        jobs: jobTotal,
        quotes: quotesAwaiting,
        invoices: invoicesUnpaidCount,
      },
    });
  } catch (err) {
    console.error("Dashboard failed:", err);
    res.status(500).json({ error: "Could not load dashboard." });
  }
});

app.post("/api/customers/wof-reminder", requireOwnerAdmin, async (req, res) => {
  if (!smtpConfigured()) {
    return res.status(503).json({
      error:
        "Email not configured. On Render go to Settings → Environment and add SMTP_HOST, SMTP_USER, SMTP_PASS, then save.",
    });
  }

  const customerId = String(req.body?.customerId || "").trim();
  try {
    const result = await sendWofReminderEmail({
      customerId,
      vehicleId: String(req.body?.vehicleId || "").trim(),
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 502;
    if (status >= 500) console.error("WOF reminder email failed:", err);
    res.status(status).json({
      error: err.response || err.message || "Failed to send email. Check SMTP settings.",
    });
  }
});

app.post("/api/customers/wof-reminder-bulk", requireOwnerAdmin, async (req, res) => {
  if (!smtpConfigured()) {
    return res.status(503).json({
      error:
        "Email not configured. On Render go to Settings → Environment and add SMTP_HOST, SMTP_USER, SMTP_PASS, then save.",
    });
  }

  const customers = readSavedCustomers();
  const targets = [];
  for (const customer of customers) {
    const email = String(customer.customerEmail || "").trim();
    if (!email) continue;
    const vehicle = nextWofReminderVehicle(normalizeVehicles(customer, customer));
    if (!vehicle) continue;
    targets.push({
      customerId: customer.id,
      vehicleId: vehicle.id || "",
      customerName: namesFromCustomer(customer).customerName || "",
      registration: String(vehicle.registration || "").trim().toUpperCase(),
      to: email,
    });
  }

  const summary = {
    ok: true,
    total: targets.length,
    sent: 0,
    alreadySent: 0,
    failed: [],
  };

  for (const target of targets) {
    try {
      const result = await sendWofReminderEmail({
        customerId: target.customerId,
        vehicleId: target.vehicleId,
      });
      if (result.alreadySent) summary.alreadySent += 1;
      else summary.sent += 1;
    } catch (err) {
      console.error("WOF bulk reminder failed:", target.customerId, err.message || err);
      summary.failed.push({
        customerId: target.customerId,
        customerName: target.customerName,
        registration: target.registration,
        to: target.to,
        error: err.message || "Failed to send",
      });
    }
  }

  res.json(summary);
});

app.post("/api/customers/wof-sms-reminder", requireOwnerAdmin, async (req, res) => {
  if (!websms.websmsConfigured()) {
    return res.status(503).json({
      error:
        "WebSMS not configured. Add WEBSMS_CLIENT_ID and WEBSMS_CLIENT_SECRET to .env / Render, then restart.",
    });
  }
  try {
    const result = await sendWofReminderSms({
      customerId: String(req.body?.customerId || "").trim(),
      vehicleId: String(req.body?.vehicleId || "").trim(),
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 502;
    if (status >= 500) console.error("WOF SMS reminder failed:", err);
    res.status(status).json({
      error: err.message || "Failed to send SMS. Check WebSMS settings.",
    });
  }
});

app.post("/api/customers/wof-sms-reminder-bulk", requireOwnerAdmin, async (req, res) => {
  if (!websms.websmsConfigured()) {
    return res.status(503).json({
      error:
        "WebSMS not configured. Add WEBSMS_CLIENT_ID and WEBSMS_CLIENT_SECRET to .env / Render, then restart.",
    });
  }

  const customers = readSavedCustomers();
  const targets = [];
  for (const customer of customers) {
    const phone = websms.normalizeNzMobile(customer.customerPhone);
    if (!phone) continue;
    const vehicle = nextWofSmsReminderVehicle(normalizeVehicles(customer, customer));
    if (!vehicle) continue;
    targets.push({
      customerId: customer.id,
      vehicleId: vehicle.id || "",
      customerName: namesFromCustomer(customer).customerName || "",
      registration: String(vehicle.registration || "").trim().toUpperCase(),
      to: phone,
    });
  }

  const summary = {
    ok: true,
    total: targets.length,
    sent: 0,
    alreadySent: 0,
    failed: [],
  };

  for (const target of targets) {
    try {
      const result = await sendWofReminderSms({
        customerId: target.customerId,
        vehicleId: target.vehicleId,
      });
      if (result.alreadySent) summary.alreadySent += 1;
      else summary.sent += 1;
    } catch (err) {
      console.error("WOF bulk SMS failed:", target.customerId, err.message || err);
      summary.failed.push({
        customerId: target.customerId,
        customerName: target.customerName,
        registration: target.registration,
        to: target.to,
        error: err.message || "Failed to send",
      });
    }
  }

  res.json(summary);
});

async function sendWofReminderSms({ customerId, vehicleId = "" }) {
  const rows = readSavedCustomers();
  const customer = customerId ? rows.find((c) => c.id === customerId) : null;
  if (!customer) {
    const err = new Error("Open a saved customer first.");
    err.status = 400;
    throw err;
  }

  const names = namesFromCustomer(customer);
  const vehicles = normalizeVehicles(customer, customer);
  const requestedId = String(vehicleId || "").trim();
  const target =
    (requestedId && vehicles.find((v) => v.id === requestedId)) ||
    nextWofSmsReminderVehicle(vehicles);
  if (!target) {
    const latestSent = vehicles
      .map((v) => v.wofSmsReminderSentAt)
      .filter(Boolean)
      .sort()
      .at(-1) || "";
    if (latestSent) {
      return {
        ok: true,
        alreadySent: true,
        channel: "sms",
        to: websms.normalizeNzMobile(customer.customerPhone) || customer.customerPhone,
        sentAt: latestSent,
      };
    }
    const err = new Error(
      "SMS reminder is only for a vehicle whose WOF expires in the next 30 days."
    );
    err.status = 400;
    throw err;
  }
  const expiry = String(target.wofExpiry || "").trim();
  const meta = wofMeta(expiry);
  if (meta.wofStatus !== "due_soon") {
    const err = new Error(
      "SMS reminder is only for a vehicle whose WOF expires in the next 30 days."
    );
    err.status = 400;
    throw err;
  }
  if (target.wofSmsReminderSentAt) {
    return {
      ok: true,
      alreadySent: true,
      channel: "sms",
      to: websms.normalizeNzMobile(customer.customerPhone) || customer.customerPhone,
      sentAt: target.wofSmsReminderSentAt,
    };
  }

  const to = websms.normalizeNzMobile(customer.customerPhone);
  if (!to) {
    const err = new Error("Customer needs a valid NZ mobile number for SMS.");
    err.status = 400;
    throw err;
  }

  const registration = String(target.registration || "").trim().toUpperCase();
  const expiryLabel = formatDateShort(expiry) || expiry;
  const body =
    `Deane Auto: WOF for ${registration || "your vehicle"} expires ${expiryLabel}. ` +
    `Reply e.g. 12/09/26 10am to request a booking, or call ${business.phoneTel}`;

  const sent = await websms.sendSms({
    to,
    body,
    messageClass: "transactional",
  });

  const sentAt = nowIso();
  try {
    appendSmsLog({
      direction: "out",
      kind: "wof_reminder",
      at: sentAt,
      from: String(process.env.WEBSMS_FROM || "").trim(),
      to: sent.to,
      body,
      messageId: sent.messageId || "",
      customerId: customer.id,
      customerName: names.customerName || "",
      registration,
      vehicleId: target.id || "",
      sandbox: Boolean(sent.sandbox),
    });
  } catch (logErr) {
    console.error("Could not write SMS inbox outbound log:", logErr);
  }

  const latestRows = readSavedCustomers();
  const latest = latestRows.find((c) => c.id === customer.id);
  if (latest) {
    const latestVehicles = normalizeVehicles(latest, latest);
    const hit =
      latestVehicles.find((v) => v.id === target.id) ||
      latestVehicles.find((v) => plateKey(v.registration) === plateKey(registration));
    if (hit) hit.wofSmsReminderSentAt = sentAt;
    latest.vehicles = latestVehicles;
    latest.updatedAt = sentAt;
    writeSavedCustomers(latestRows);
  }

  return {
    ok: true,
    channel: "sms",
    to: sent.to,
    sentAt,
    vehicleId: target.id || "",
    messageId: sent.messageId || "",
    sandbox: Boolean(sent.sandbox),
    customerName: names.customerName || "",
  };
}

async function sendWofReminderEmail({ customerId, vehicleId = "" }) {
  const rows = readSavedCustomers();
  const customer = customerId ? rows.find((c) => c.id === customerId) : null;
  if (!customer) {
    const err = new Error("Open a saved customer first.");
    err.status = 400;
    throw err;
  }

  const names = namesFromCustomer(customer);
  const vehicles = normalizeVehicles(customer, customer);
  const requestedId = String(vehicleId || "").trim();
  const target =
    (requestedId && vehicles.find((v) => v.id === requestedId)) ||
    nextWofReminderVehicle(vehicles);
  if (!target) {
    const latestSent = vehicles
      .map((v) => v.wofReminderSentAt)
      .filter(Boolean)
      .sort()
      .at(-1) || "";
    if (latestSent) {
      return {
        ok: true,
        alreadySent: true,
        to: customer.customerEmail,
        sentAt: latestSent,
      };
    }
    const err = new Error(
      "Email reminder is only for a vehicle whose WOF expires in the next 30 days."
    );
    err.status = 400;
    throw err;
  }
  const expiry = String(target.wofExpiry || "").trim();
  const meta = wofMeta(expiry);
  if (meta.wofStatus !== "due_soon") {
    const err = new Error(
      "Email reminder is only for a vehicle whose WOF expires in the next 30 days."
    );
    err.status = 400;
    throw err;
  }
  if (target.wofReminderSentAt) {
    return {
      ok: true,
      alreadySent: true,
      to: customer.customerEmail,
      sentAt: target.wofReminderSentAt,
    };
  }

  const to = String(customer.customerEmail || "").trim();
  const name = names.customerName || "there";
  const registration = String(target.registration || "").trim().toUpperCase();
  const vehicle = String(target.vehicle || "").trim();
  if (!to) {
    const err = new Error("Customer email is missing.");
    err.status = 400;
    throw err;
  }

  const vehicleBit = `${vehicle || "your vehicle"}${registration ? ` (${registration})` : ""}`;
  const site = PUBLIC_BASE_URL || business.website;
  const subject = `WOF reminder for ${registration || vehicle || "your vehicle"} — ${business.name}`;
  const expiryLabel = formatDateShort(expiry) || expiry;
  const text =
    `Hi ${name},\n\n` +
    `This is a reminder from ${business.name} that the WOF for ${vehicleBit} expires on ${expiryLabel}.\n\n` +
    `Book a WOF with us:\n` +
    `Phone ${business.phoneDisplay}\n` +
    `${business.email}\n` +
    `${business.fullAddress()}\n` +
    `${business.hoursShort}; ${business.hoursSunday}\n` +
    (site ? `\nWebsite: ${site}\n` : "") +
    `\nThank you,\n${business.name}\n`;
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>This is a reminder from <strong>${escapeHtml(business.name)}</strong> that the WOF for <strong>${escapeHtml(vehicleBit)}</strong> expires on <strong>${escapeHtml(expiryLabel)}</strong>.</p>
    <p>Book a WOF with us:</p>
    <p>
      Phone <a href="tel:${escapeAttr(business.phoneTel)}">${escapeHtml(business.phoneDisplay)}</a><br/>
      <a href="mailto:${escapeAttr(business.email)}">${escapeHtml(business.email)}</a><br/>
      ${escapeHtml(business.addressLine2)}<br/>
      ${escapeHtml(business.street)}<br/>
      ${escapeHtml(business.suburb)}, ${escapeHtml(business.city)}<br/>
      ${escapeHtml(business.hoursShort)}; ${escapeHtml(business.hoursSunday)}
    </p>
    ${site ? `<p><a href="${escapeAttr(site)}">${escapeHtml(site)}</a></p>` : ""}
    <p>Thank you,<br/>${escapeHtml(business.name)}</p>
  `;

  try {
    const mailer = createMailer();
    await mailer.sendMail({
      from: MAIL_FROM,
      to,
      replyTo: process.env.SMTP_USER || MAIL_FROM,
      subject,
      text,
      html: withCustomerEmailHtml(html),
      attachments: withLogoAttachments(),
    });
  } catch (err) {
    err.status = 502;
    throw err;
  }

  const sentAt = nowIso();
  const latestRows = readSavedCustomers();
  const latest = latestRows.find((c) => c.id === customer.id);
  if (latest) {
    const latestVehicles = normalizeVehicles(latest, latest);
    const hit =
      latestVehicles.find((v) => v.id === target.id) ||
      latestVehicles.find((v) => plateKey(v.registration) === plateKey(registration));
    if (hit) hit.wofReminderSentAt = sentAt;
    latest.vehicles = latestVehicles;
    latest.updatedAt = sentAt;
    writeSavedCustomers(latestRows);
  }
  return { ok: true, to, sentAt, vehicleId: target.id || "" };
}

app.post("/api/reports/:id/email", requireAdmin, async (req, res) => {
  if (!smtpConfigured()) {
    return res.status(503).json({
      error:
        "Email not configured. Add SMTP settings to .env (see .env.example), then restart npm start.",
    });
  }

  const reports = readReports();
  const index = reports.findIndex((r) => r.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Report not found" });

  const report = reports[index];
  const to = String(req.body?.to || report.customerEmail || "").trim();
  if (!to) {
    return res.status(400).json({ error: "Customer email is missing on this report." });
  }

  if (report.status !== "published") {
    report.status = "published";
    report.publishedAt = nowIso();
    report.updatedAt = report.publishedAt;
  }
  ensureViewToken(report);
  writeReports(reports);

  const url = reportPublicUrl(req, req.body, report);
  const name = report.customerName || "there";
  const vehicle = report.vehicle || "your vehicle";
  const rego = report.registration || "";

  const subject =
    req.body?.subject ||
    `Your service report — ${rego || vehicle} — ${business.name}`;

  const text =
    `Hi ${name},\n\n` +
    `Your digital service report for ${vehicle}${rego ? ` (${rego})` : ""} is ready:\n\n` +
    `${url}\n\n` +
    `${business.fullAddress()}\n${business.phoneDisplay}\n${business.email}\n`;

  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your digital service report for <strong>${escapeHtml(vehicle)}${
      rego ? ` (${escapeHtml(rego)})` : ""
    }</strong> is ready.</p>
    <p><a href="${escapeAttr(url)}">View your service report</a></p>
    ${emailContactHtml()}
  `;

  try {
    const mailer = createMailer();
    const info = await mailer.sendMail({
      from: MAIL_FROM,
      to,
      replyTo: process.env.SMTP_USER || MAIL_FROM,
      subject,
      text,
      html: withCustomerEmailHtml(html),
      attachments: withLogoAttachments(),
    });

    const emailedAt = nowIso();
    const updated = patchById(readReports, writeReports, report.id, (latest) => ({
      ...latest,
      lastEmailedAt: emailedAt,
      lastEmailedTo: to,
      updatedAt: emailedAt,
    }));

    res.json({
      ok: true,
      to,
      messageId: info.messageId,
      reportUrl: url,
      report: updated || report,
    });
  } catch (err) {
    console.error("Email send failed:", err);
    res.status(502).json({
      error:
        err.response || err.message || "Failed to send email. Check SMTP settings.",
    });
  }
});

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("'", "&#39;");
}

app.post("/api/reports/:id/unpublish", requireAdmin, (req, res) => {
  const reports = readReports();
  const index = reports.findIndex((r) => r.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Report not found" });

  reports[index].status = "draft";
  reports[index].updatedAt = nowIso();
  writeReports(reports);
  res.json(reports[index]);
});

app.post(
  "/api/reports/:id/photo",
  requireAdmin,
  upload.array("photos", 12),
  (req, res) => {
    const reports = readReports();
    const index = reports.findIndex((r) => r.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Report not found" });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No photo uploaded" });

    const added = files.map((file) => `/uploads/${file.filename}`);
    const photos = [...reportPhotoList(reports[index]), ...added].slice(0, 12);
    reports[index].vehiclePhotos = photos;
    reports[index].vehiclePhoto = photos[0] || "";
    reports[index].updatedAt = nowIso();
    writeReports(reports);
    res.json(withReportPhotos(reports[index]));
  }
);

app.delete("/api/reports/:id/photo", requireAdmin, (req, res) => {
  const reports = readReports();
  const index = reports.findIndex((r) => r.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Report not found" });
  const url = String(req.body?.url || req.query.url || "").trim();
  const photos = reportPhotoList(reports[index]).filter((src) => src !== url);
  reports[index].vehiclePhotos = photos;
  reports[index].vehiclePhoto = photos[0] || "";
  reports[index].updatedAt = nowIso();
  writeReports(reports);
  res.json(withReportPhotos(reports[index]));
});

app.delete("/api/reports/:id", requireAdmin, (req, res) => {
  const reports = readReports();
  const next = reports.filter((r) => r.id !== req.params.id);
  if (next.length === reports.length) {
    return res.status(404).json({ error: "Report not found" });
  }
  writeReports(next);
  res.json({ ok: true });
});

app.get("/api/billing/catalog", requireAdmin, (_req, res) => {
  res.json({
    presets: catalog.PRESETS.map((p) => ({
      id: p.id,
      kind: p.kind,
      label: p.label,
      title: p.title,
      lines: catalog.cloneLines(p.lines),
    })),
    quickAdds: catalog.QUICK_ADDS,
    gstNumber: business.gstNumber || "",
  });
});

app.get("/api/billing", requireAdmin, (req, res) => {
  const staff = staffFromReq(req);
  const currentIndex = staff?.role === "technician" ? workshopCurrentIndex() : null;
  const docs = readBilling()
    .filter((d) => !currentIndex || isCurrentWorkshopBilling(d, currentIndex))
    .map((d) => {
      const totals = catalog.computeTotals(d.lines);
      const payment =
        d.kind === "invoice" ? normalizeInvoicePayment(d, {}, totals) : null;
      const sortAt = billingAnchorDate(d);
      const overdue = Boolean(payment && isInvoiceOverdue(d, payment));
      return {
        id: d.id,
        kind: d.kind,
        number: d.number,
        quotedNumber: d.quotedNumber || "",
        status: d.status,
        preset: d.preset,
        customerName: d.customerName,
        customerEmail: d.customerEmail,
        customerId: d.customerId || "",
        vehicleId: d.vehicleId || "",
        registration: d.registration,
        vehicle: d.vehicle,
        totalIncl: totals.totalIncl,
        createdAt: d.createdAt || "",
        updatedAt: d.updatedAt,
        sentAt: d.sentAt,
        sortAt,
        overdue,
        acceptedAt: d.acceptedAt,
        viewedAt: d.viewedAt || "",
        lastViewedAt: d.lastViewedAt || "",
        viewCount: Number(d.viewCount) || 0,
        invoiceId: d.invoiceId || "",
        quoteId: d.quoteId || "",
        jobId: d.jobId || "",
        reportId: d.reportId || "",
        hasService: (d.lines || []).some(
          (line) =>
            Number(line.qty) > 0 && catalog.lineLooksLikeService(line.description)
        ),
        hasWof: (d.lines || []).some(
          (line) => Number(line.qty) > 0 && catalog.lineLooksLikeWof(line.description)
        ),
        paymentStatus: payment?.paymentStatus || "",
        amountPaid: payment?.amountPaid ?? null,
        balanceDue: payment?.balanceDue ?? null,
        referralCreditTotal: payment?.referralCreditTotal ?? 0,
        paymentDates: payment?.payments.map((row) => row.paidAt).filter(Boolean) || [],
        lastEmailedAt: d.lastEmailedAt || "",
        reviewRequestSentAt: d.reviewRequestSentAt || "",
        reviewRequestKind: d.reviewRequestKind || "",
      };
    })
    .sort((a, b) => {
      // Overdue unpaid invoices first, then newest by issue/send date.
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return String(b.sortAt || "").localeCompare(String(a.sortAt || ""));
    });
  res.json(docs);
});

app.post("/api/billing", requireAdmin, (req, res) => {
  const preset = catalog.presetById(req.body?.preset);
  if (!preset) {
    return res.status(400).json({ error: "Choose a package or custom quote." });
  }

  const customerName = String(req.body?.customerName || "").trim();
  const customerId = String(req.body?.customerId || "").trim();
  const registration = String(req.body?.registration || "").trim();
  if (!customerName && !customerId && !registration) {
    return res.status(400).json({
      error: "Choose a customer (or enter a name / plate) before saving.",
    });
  }

  const docs = readBilling();
  const now = nowIso();
  const today = todayIso();
  const linkJobId = String(req.body?.jobId || "").trim();
  let linkJob = null;
  if (linkJobId) {
    linkJob = readJobs().find((j) => j.id === linkJobId) || null;
    if (!linkJob) {
      return res.status(400).json({ error: "Linked job not found." });
    }
    if (preset.kind === "quote" && linkJob.quoteId) {
      return res.status(400).json({ error: "This job already has a quote. Open it from the job card." });
    }
    if (preset.kind === "invoice" && linkJob.invoiceId) {
      return res.status(400).json({ error: "This job already has an invoice. Open it from the job card." });
    }
  }
  const bodyLines = Array.isArray(req.body?.lines) ? req.body.lines : null;
  const lines = (bodyLines && bodyLines.length
    ? bodyLines
    : catalog.cloneLines(preset.lines)
  ).map((line) => ({
    id: line.id || randomUUID(),
    description: catalog.capitalizeLineDescription
      ? catalog.capitalizeLineDescription(line.description)
      : String(line.description || "").trim(),
    qty: Number(line.qty) || 0,
    unitPriceIncl: Math.max(0, Number(line.unitPriceIncl) || 0),
  }));
  const doc = {
    id: randomUUID(),
    kind: preset.kind,
    number: nextBillingNumber(docs, preset.kind),
    status: "draft",
    preset: preset.id,
    createdAt: now,
    updatedAt: now,
    sentAt: "",
    acceptedAt: "",
    issuedAt: preset.kind === "invoice" ? today : "",
    validUntil:
      preset.kind === "quote"
        ? String(req.body?.validUntil || "").trim() ||
          plusDays(today, catalog.QUOTE_VALID_DAYS)
        : "",
    customerId,
    vehicleId: String(req.body?.vehicleId || "").trim(),
    customerName,
    customerEmail: String(req.body?.customerEmail || "").trim(),
    customerPhone: String(req.body?.customerPhone || "").trim(),
    registration,
    vehicle: String(req.body?.vehicle || "").trim(),
    odometer: req.body?.odometer || "",
    notes: String(req.body?.notes || "").trim(),
    lines,
    acceptToken: preset.kind === "quote" ? newAcceptToken() : "",
    viewToken: newViewToken(),
    quoteId: "",
    invoiceId: "",
    jobId: linkJob ? linkJob.id : "",
    lastEmailedAt: "",
    lastEmailedTo: "",
    history: [],
    ...(preset.kind === "invoice" ? emptyPaymentFields() : {}),
  };
  appendHistory(doc, {
    type: "created",
    summary: doc.kind === "invoice" ? "Invoice created" : "Quote created",
    amount: catalog.computeTotals(doc.lines).totalIncl,
  });

  docs.push(doc);
  if (linkJob) {
    const jobs = readJobs();
    const jobIndex = jobs.findIndex((j) => j.id === linkJob.id);
    if (jobIndex >= 0) {
      linkJobToBilling(
        docs,
        jobs[jobIndex],
        doc.kind === "quote" ? doc : null,
        doc.kind === "invoice" ? doc : null
      );
      jobs[jobIndex].updatedAt = now;
      writeJobs(jobs);
    }
  } else if (doc.kind === "invoice" && (doc.customerName || doc.registration)) {
    try {
      syncJobFromInvoiceExtras(docs, doc);
    } catch (err) {
      console.error("Could not add invoice extras to job card:", err);
    }
  }
  writeBilling(docs);
  res.status(201).json(withBillingTotals(doc, true));
});

app.get("/api/billing/:id", (req, res) => {
  const docs = readBilling();
  const index = docs.findIndex((d) => d.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Not found" });
  const doc = docs[index];
  const staff = staffFromReq(req);
  if (staff?.role === "technician" && !isCurrentWorkshopBilling(doc)) {
    return res.status(404).json({ error: "Not found" });
  }

  const isAdmin = isAdminRequest(req);
  const viewOk = publicViewTokenOk(doc, req.query.v);
  const acceptToken = String(req.query.t || "");
  const acceptOk = Boolean(doc.acceptToken && acceptToken && acceptToken === doc.acceptToken);

  if (!isAdmin) {
    if (doc.status === "void") return res.status(404).json({ error: "Not found" });
    if (doc.status === "draft") {
      if (!acceptOk && !(doc.viewToken && viewOk)) {
        return res.status(404).json({ error: "Not found" });
      }
    } else if (!viewOk) {
      return res.status(404).json({ error: "Not found" });
    }
  }

  const skipCustomerView =
    isAdmin || String(req.query.preview || "") === "1";

  if (isAdmin) {
    const before = Array.isArray(doc.history) ? doc.history.length : 0;
    backfillEmailAndViewHistory(doc);
    if ((doc.history || []).length > before) writeBilling(docs);
  } else if (!skipCustomerView && recordCustomerDocumentView(doc)) {
    docs[index] = doc;
    try {
      writeBilling(docs);
    } catch (err) {
      console.error("Could not save customer document view:", err);
    }
  }

  res.json(withBillingTotals(doc, isAdmin));
});

function billingMissingError() {
  const freeHint =
    process.env.NODE_ENV === "production"
      ? " On Render Free, quotes and invoices are erased when the service sleeps. Open the list and create it again, or upgrade to Starter with a disk before emailing customers."
      : "";
  return `Invoice/quote not found.${freeHint}`;
}

app.put("/api/billing/:id", requireAdmin, requireCurrentBillingIfTech, (req, res) => {
  const docs = readBilling();
  const index = docs.findIndex((d) => d.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: billingMissingError() });

  const current = docs[index];
  if (current.status === "void") {
    return res.status(400).json({ error: "This document has been voided." });
  }

  const body = req.body || {};
  let snapshot;
  try {
    snapshot = requireCustomerSnapshot(
      body.customerId || current.customerId ? { ...current, ...body } : body
    );
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const locked = isLockedBilling(current);
  const incomingLines = body.lines != null ? body.lines : body.lines;
  const nextLines =
    current.kind === "invoice" && current.status !== "void"
      ? normalizeLines(incomingLines != null ? incomingLines : current.lines)
      : locked
        ? current.lines
        : normalizeLines(incomingLines != null ? incomingLines : current.lines);

  const next = {
    ...current,
    ...snapshot,
    odometer: body.odometer != null ? String(body.odometer).trim() : current.odometer,
    notes:
      body.notes != null ? catalog.capitalizeLineDescription(body.notes) : current.notes,
    validUntil:
      current.kind === "quote" && body.validUntil != null
        ? String(body.validUntil)
        : current.validUntil,
    lines: nextLines,
    wofExpiry:
      current.kind === "invoice" && body.wofExpiry != null
        ? isoDateOnly(body.wofExpiry)
        : current.wofExpiry || "",
    updatedAt: nowIso(),
  };

  if (current.kind === "invoice") {
    const totals = catalog.computeTotals(nextLines);
    // Preserve referral credits on normal saves — only apply/remove APIs change them.
    next.referralCreditsApplied = referralsLib.normalizeAppliedRows(
      current.referralCreditsApplied
    );
    next.referralCreditTotal = referralsLib.referralCreditTotal(next);
    const payment = normalizeInvoicePayment(next, body, totals);
    const maxCash = catalog.round2(
      Math.max(0, totals.totalIncl - payment.referralCreditTotal)
    );
    if (payment.amountPaid > maxCash + 0.009) {
      return res.status(400).json({
        error: `Payment cannot exceed invoice total minus referral credits ($${maxCash.toFixed(2)}).`,
      });
    }
    next.payments = payment.payments;
    next.paymentStatus = payment.paymentStatus;
    next.amountPaid = payment.amountPaid;
    next.paidAt = payment.paidAt;
    next.paymentNote = payment.paymentNote;
  }

  if (!Array.isArray(next.history)) next.history = Array.isArray(current.history) ? [...current.history] : [];
  backfillEmailAndViewHistory(next);

  const beforePayments = normalizePaymentRows(current.payments || []);
  const afterPayments =
    current.kind === "invoice" ? normalizePaymentRows(next.payments || []) : [];
  if (current.kind === "invoice") {
    const beforeMap = paymentMap(beforePayments);
    const afterMap = paymentMap(afterPayments);
    for (const [id, row] of afterMap) {
      if (!beforeMap.has(id)) {
        appendHistory(next, {
          type: "payment",
          summary: "Payment received",
          detail: row.note || "",
          amount: row.amount,
        });
      }
    }
    for (const [id, row] of beforeMap) {
      if (!afterMap.has(id)) {
        appendHistory(next, {
          type: "payment_removed",
          summary: "Payment removed",
          detail: row.note || "",
          amount: row.amount,
        });
      }
    }
  }

  const fieldDetails = describeFieldChanges(current, next);
  const lineDetails =
    locked && body.lines == null
      ? []
      : describeLineChanges(current.lines, next.lines);
  const editDetails = [...fieldDetails, ...lineDetails];
  if (editDetails.length) {
    appendHistory(next, {
      type: "edited",
      summary: current.kind === "invoice" ? "Invoice edited" : "Quote edited",
      detail: editDetails.slice(0, 8).join("; "),
      amount: catalog.computeTotals(next.lines).totalIncl,
    });
  }

  ensureViewToken(next);
  stampInvoiceIssueDate(next);
  docs[index] = next;

  if (next.kind === "invoice") {
    try {
      applyInvoiceWofToCustomer(next);
    } catch (err) {
      console.error("Could not save WOF expiry on customer:", err);
    }
    try {
      syncJobFromInvoiceExtras(docs, next);
    } catch (err) {
      console.error("Could not add invoice extras to job card:", err);
    }
  }

  writeBilling(docs);

  if (next.kind === "invoice" && next.customerId) {
    try {
      const payment = normalizeInvoicePayment(
        next,
        {},
        catalog.computeTotals(next.lines || [])
      );
      if (payment.paymentStatus === "paid") {
        persistQualifiedReferrals(next.customerId, docs);
      }
    } catch (err) {
      console.error("Could not qualify referrals:", err);
    }
  }

  res.json(withBillingTotals(docs[index], true));
});

app.post("/api/billing/:id/issue", requireAdmin, requireCurrentBillingIfTech, (req, res) => {
  const docs = readBilling();
  const index = docs.findIndex((d) => d.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: billingMissingError() });
  try {
    const url = issueBillingDoc(docs[index], req, req.body);
    writeBilling(docs);
    res.json({ ok: true, url, doc: withBillingTotals(docs[index], true) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/billing/:id/email", requireAdmin, requireCurrentBillingIfTech, async (req, res) => {
  if (!smtpConfigured()) {
    return res.status(503).json({
      error:
        "Email not configured. On Render go to Settings → Environment and add SMTP_HOST, SMTP_USER, SMTP_PASS, then save.",
    });
  }

  const docs = readBilling();
  const index = docs.findIndex((d) => d.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: billingMissingError() });

  const doc = docs[index];
  const to = String(req.body?.to || doc.customerEmail || "").trim();
  if (!to) {
    return res.status(400).json({ error: "Customer email is missing." });
  }

  let url;
  const wasResend = Boolean(doc.lastEmailedAt);
  try {
    url = issueBillingDoc(doc, req, req.body);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  writeBilling(docs);

  const name = doc.customerName || "there";
  const vehicle = doc.vehicle || "your vehicle";
  const rego = doc.registration || "";
  const totals = catalog.computeTotals(doc.lines);
  const money = totals.totalIncl.toFixed(2);
  const vehicleBit = `${vehicle}${rego ? ` (${rego})` : ""}`;
  const validUntilLabel = formatDateShort(doc.validUntil) || doc.validUntil;

  let subject;
  let text;
  let html;
  if (doc.kind === "quote") {
    subject = `Quote ${doc.number} for ${rego || vehicle} — ${business.name}`;
    text =
      `Hi ${name},\n\n` +
      `Here is your quote for ${vehicleBit}: ${doc.number}.\n` +
      `Total incl. GST: $${money}\n\n` +
      `Please review and accept this quote before we start work:\n${url}\n\n` +
      `A PDF copy is attached for your records.\n\n` +
      (doc.validUntil ? `This quote is valid until ${validUntilLabel}.\n\n` : "") +
      `${business.paymentText()}\n\n` +
      `${business.name}\n${business.street}, ${business.suburb}, ${business.city}\n${business.phoneDisplay}\n${business.email}\n`;
    html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Here is your quote for <strong>${escapeHtml(vehicleBit)}</strong> — ${escapeHtml(doc.number)}.</p>
      <p>Total incl. GST: <strong>$${escapeHtml(money)}</strong></p>
      <p>Please review and accept this quote before we start work.</p>
      <p><a href="${escapeAttr(url)}" style="display:inline-block;background:#1565c0;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700;">Review &amp; accept quote</a></p>
      <p>Or open this link:<br/><a href="${escapeAttr(url)}">${escapeHtml(url)}</a></p>
      <p>A PDF copy is attached for your records.</p>
      ${doc.validUntil ? `<p>This quote is valid until ${escapeHtml(validUntilLabel)}.</p>` : ""}
      <p><strong>How to pay</strong><br/>
      Bank account name: <strong>${escapeHtml(business.bankAccountName)}</strong><br/>
      Bank account number: <strong>${escapeHtml(business.bankAccount)}</strong></p>
      <p><strong>Payment terms</strong></p>
      <ul style="margin:0.25rem 0 1rem;padding-left:1.2rem;color:#1a2332;font-size:14px;">
        ${(business.paymentTerms || [])
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join("")}
      </ul>
      ${emailContactHtml()}
    `;
  } else {
    const review = reviewPayloadForInvoice(doc);
    subject = `Tax Invoice ${doc.number} for ${rego || vehicle} — ${business.name}`;
    text =
      `Hi ${name},\n\n` +
      `Here is your tax invoice for ${vehicleBit}: ${doc.number}.\n` +
      `Total incl. GST: $${money}\n\n` +
      `View / print your invoice:\n${url}\n\n` +
      (review
        ? `${review.message}\nLeave a Google review:\n${review.url}\n\n`
        : "") +
      `A PDF copy is attached for your records.\n\n` +
      `${business.paymentText()}\n\n` +
      `${business.name}\n${business.street}, ${business.suburb}, ${business.city}\n${business.phoneDisplay}\n${business.email}\n`;
    html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Here is your tax invoice for <strong>${escapeHtml(vehicleBit)}</strong> — ${escapeHtml(doc.number)}.</p>
      <p>Total incl. GST: <strong>$${escapeHtml(money)}</strong></p>
      <p><a href="${escapeAttr(url)}">View / print your invoice</a></p>
      ${
        review
          ? `<p style="margin:0.75rem 0 0.4rem;font-size:13px;line-height:1.4;">${escapeHtml(review.message)}</p>
      <p><a href="${escapeAttr(review.url)}" style="display:inline-block;background:#1565c0;color:#fff;padding:7px 11px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;">Leave a Google review</a></p>`
          : ""
      }
      <p>A PDF copy is attached for your records.</p>
      <p><strong>How to pay</strong><br/>
      Bank account name: <strong>${escapeHtml(business.bankAccountName)}</strong><br/>
      Bank account number: <strong>${escapeHtml(business.bankAccount)}</strong></p>
      <p><strong>Payment terms</strong></p>
      <ul style="margin:0.25rem 0 1rem;padding-left:1.2rem;color:#1a2332;font-size:14px;">
        ${(business.paymentTerms || [])
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join("")}
      </ul>
      ${emailContactHtml()}
    `;
  }

  let pdfAttachment;
  try {
    const pdfBuffer = await buildBillingPdf(doc);
    pdfAttachment = {
      filename: safeFilename(doc.number, doc.kind),
      content: pdfBuffer,
      contentType: "application/pdf",
    };
  } catch (err) {
    console.error("Billing PDF failed:", err);
    return res.status(500).json({
      error: "Could not create the PDF attachment. Email was not sent.",
    });
  }

  try {
    const mailer = createMailer();
    const info = await mailer.sendMail({
      from: MAIL_FROM,
      to,
      replyTo: process.env.SMTP_USER || MAIL_FROM,
      subject,
      text,
      html: withCustomerEmailHtml(html, { logoWidth: 134 }),
      attachments: withLogoAttachments([pdfAttachment]),
    });

    const emailedAt = nowIso();
    const historySummary = wasResend
      ? doc.kind === "invoice"
        ? "Updated invoice sent to customer"
        : "Updated quote sent to customer"
      : doc.kind === "invoice"
        ? "Invoice emailed to customer"
        : "Quote emailed to customer";
    const invoiceReview =
      doc.kind === "invoice" ? reviewPayloadForInvoice(doc) : null;
    const updated = patchById(readBilling, writeBilling, doc.id, (latest) => {
      const next = { ...latest };
      next.lastEmailedAt = emailedAt;
      next.lastEmailedTo = to;
      next.updatedAt = emailedAt;
      ensureHistory(next);
      appendHistory(next, {
        type: "sent",
        summary: historySummary,
        detail: to,
        amount: totals.totalIncl,
      });
      if (invoiceReview) {
        const firstReviewRequest = !next.reviewRequestSentAt;
        next.reviewRequestSentAt = next.reviewRequestSentAt || emailedAt;
        next.reviewRequestKind = invoiceReview.kind;
        if (firstReviewRequest) {
          appendHistory(next, {
            type: "review_request",
            summary: "Google review request emailed",
            detail: `${invoiceReview.kind} · ${to}`,
          });
        } else {
          appendHistory(next, {
            type: "review_request",
            summary: "Google review request emailed again",
            detail: `${invoiceReview.kind} · ${to}`,
          });
        }
      }
      return next;
    });

    res.json({
      ok: true,
      to,
      messageId: info.messageId,
      url,
      doc: withBillingTotals(updated || doc, true),
    });
  } catch (err) {
    console.error("Billing email failed:", err);
    res.status(502).json({
      error:
        err.response || err.message || "Failed to send email. Check SMTP settings.",
    });
  }
});

function convertQuoteToInvoice(docs, quote) {
  if (quote.kind === "invoice") return quote;
  if (quote.kind !== "quote") {
    const err = new Error("Only quotes convert to invoices.");
    err.status = 400;
    throw err;
  }
  if (quote.status === "void") {
    const err = new Error("This quote is no longer valid.");
    err.status = 400;
    throw err;
  }
  if (quote.status !== "accepted" && quote.status !== "invoiced") {
    const err = new Error("Customer must accept the quote first.");
    err.status = 400;
    throw err;
  }

  const lines = billableLines(quote.lines);
  if (!lines.length) {
    const err = new Error("Quote has no billable lines.");
    err.status = 400;
    throw err;
  }

  if (quote.invoiceId && quote.invoiceId !== quote.id) {
    const existing = docs.find((d) => d.id === quote.invoiceId);
    if (existing && existing.kind === "invoice") {
      unifyInvoiceNumberFromQuote(docs, existing, quote);
      if (quote.status !== "invoiced") {
        quote.status = "invoiced";
        quote.updatedAt = nowIso();
      }
      return existing;
    }
  }

  const now = nowIso();
  const previousNumber = quote.number;
  let invoiceNumber = toInvoiceNumber(previousNumber);
  const clash = docs.find(
    (d) => d.kind === "invoice" && d.id !== quote.id && d.number === invoiceNumber
  );
  if (clash) invoiceNumber = nextBillingNumber(docs, "invoice");

  const invoice = {
    id: randomUUID(),
    kind: "invoice",
    number: invoiceNumber,
    quotedNumber: previousNumber,
    status: "sent",
    preset: quote.preset || "custom",
    createdAt: now,
    updatedAt: now,
    sentAt: quote.sentAt || now,
    acceptedAt: quote.acceptedAt || now,
    issuedAt: todayIso(),
    validUntil: "",
    customerId: quote.customerId || "",
    vehicleId: quote.vehicleId || "",
    customerName: quote.customerName || "",
    customerEmail: quote.customerEmail || "",
    customerPhone: quote.customerPhone || "",
    registration: quote.registration || "",
    vehicle: quote.vehicle || "",
    odometer: quote.odometer || "",
    notes: quote.notes || "",
    lines: lines.map((line) => ({
      ...line,
      id: randomUUID(),
    })),
    acceptToken: "",
    viewToken: newViewToken(),
    quoteId: quote.id,
    invoiceId: "",
    jobId: quote.jobId || "",
    lastEmailedAt: "",
    lastEmailedTo: "",
    firstName: quote.firstName || "",
    lastName: quote.lastName || "",
    wofExpiry: quote.wofExpiry || "",
    history: [],
    ...emptyPaymentFields(),
  };
  invoice.invoiceId = invoice.id;
  appendHistory(invoice, {
    type: "created",
    summary: "Invoice created from quote",
    detail: previousNumber,
    amount: catalog.computeTotals(invoice.lines).totalIncl,
  });
  appendHistory(invoice, {
    type: "invoiced",
    summary: "Converted from quote",
    detail: `${previousNumber} → ${invoice.number}`,
    amount: catalog.computeTotals(invoice.lines).totalIncl,
  });

  quote.status = "invoiced";
  quote.invoiceId = invoice.id;
  quote.updatedAt = now;
  ensureHistory(quote);
  appendHistory(quote, {
    type: "invoiced",
    summary: "Converted to invoice",
    detail: `${previousNumber} → ${invoice.number}`,
    amount: catalog.computeTotals(invoice.lines).totalIncl,
  });

  docs.push(invoice);

  if (quote.jobId) {
    const jobs = readJobs();
    const job = jobs.find((j) => j.id === quote.jobId);
    if (job) {
      job.invoiceId = invoice.id;
      job.invoiceNumber = invoice.number;
      job.quoteId = quote.id;
      job.quoteNumber = quote.number;
      const preferred = jobNumberFromBilling(invoice.number);
      if (
        preferred &&
        job.number !== preferred &&
        !jobs.some((row) => row.id !== job.id && row.number === preferred)
      ) {
        job.number = preferred;
      }
      job.updatedAt = now;
      writeJobs(jobs);
    }
  }
  try {
    syncJobFromInvoiceExtras(docs, invoice);
  } catch (err) {
    console.error("Could not add invoice extras to job card:", err);
  }
  return invoice;
}

function reportPhotoList(report = {}) {
  const listed = Array.isArray(report.vehiclePhotos)
    ? report.vehiclePhotos.map((p) => String(p || "").trim()).filter(Boolean)
    : [];
  if (listed.length) return [...new Set(listed)];
  const single = String(report.vehiclePhoto || "").trim();
  return single ? [single] : [];
}

function withReportPhotos(report) {
  if (!report) return report;
  const photos = reportPhotoList(report);
  return {
    ...report,
    vehiclePhotos: photos,
    vehiclePhoto: photos[0] || "",
  };
}

function emptyReportRecord(now, extra = {}) {
  const servicePackage = normalizePackage(extra.servicePackage || "standard");
  let jobType = extra.jobType || "standard_service";
  if (jobType === "full_service") jobType = "premium_service";
  if (jobType === "full_wof") jobType = "premium_wof";
  return {
    id: extra.id || randomUUID(),
    jobNumber: extra.jobNumber || "",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    serviceDate: extra.serviceDate || now.slice(0, 10),
    technicianName: extra.technicianName || "",
    customerId: extra.customerId || "",
    vehicleId: extra.vehicleId || "",
    customerName: extra.customerName || "",
    customerEmail: extra.customerEmail || "",
    customerPhone: extra.customerPhone || "",
    registration: extra.registration || "",
    vehicle: extra.vehicle || "",
    odometer: extra.odometer || "",
    vin: extra.vin || "",
    jobType,
    servicePackage,
    customerConcern: extra.customerConcern || "",
    invoiceId: extra.invoiceId || "",
    invoiceNumber: extra.invoiceNumber || "",
    checks: extra.checks || emptyChecks(servicePackage),
    actionsDone: extra.actionsDone || {},
    actionsOther: extra.actionsOther || "",
    oilSpec: extra.oilSpec || "",
    oilFilter: extra.oilFilter || "",
    wof: extra.wof || {
      performed: jobType.includes("wof"),
      result: "not_completed",
      expiry: "",
      reference: "",
      failNotes: "",
      repairsForPass: "",
      recheckRequired: false,
    },
    summary: extra.summary || "",
    nextServiceDue: extra.nextServiceDue || "",
    technicianComments: extra.technicianComments || "",
    vehiclePhoto: extra.vehiclePhoto || "",
    vehiclePhotos: Array.isArray(extra.vehiclePhotos) ? extra.vehiclePhotos : extra.vehiclePhoto ? [extra.vehiclePhoto] : [],
    viewToken: extra.viewToken || newViewToken(),
  };
}

function ensureReportFromInvoice(docs, invoice) {
  if (!invoice || invoice.kind !== "invoice") {
    const err = new Error("Create the invoice first.");
    err.status = 400;
    throw err;
  }
  if (invoice.status === "void") {
    const err = new Error("This invoice has been voided.");
    err.status = 400;
    throw err;
  }
  if (!invoice.number) {
    const err = new Error("This invoice has no number yet.");
    err.status = 400;
    throw err;
  }

  const reports = readReports();
  let existing =
    (invoice.reportId && reports.find((r) => r.id === invoice.reportId)) ||
    reports.find((r) => r.invoiceId === invoice.id) ||
    reports.find((r) => r.jobNumber === invoice.number) ||
    null;
  if (existing) {
    existing.invoiceId = invoice.id;
    existing.invoiceNumber = invoice.number;
    if (existing.jobNumber !== invoice.number) {
      const taken = reports.some(
        (r) => r.id !== existing.id && r.jobNumber === invoice.number
      );
      if (!taken) existing.jobNumber = invoice.number;
    }
    invoice.reportId = existing.id;
    existing.updatedAt = nowIso();
    writeReports(reports);
    return { report: existing, created: false };
  }

  let snapshot = {
    customerId: invoice.customerId || "",
    vehicleId: invoice.vehicleId || "",
    customerName: invoice.customerName || "",
    customerEmail: invoice.customerEmail || "",
    customerPhone: invoice.customerPhone || "",
    registration: invoice.registration || "",
    vehicle: invoice.vehicle || "",
  };
  try {
    snapshot = { ...snapshot, ...requireCustomerSnapshot(invoice) };
  } catch {
    /* keep invoice fields */
  }

  const now = nowIso();
  const report = emptyReportRecord(now, {
    jobNumber: invoice.number,
    ...snapshot,
    jobType: jobTypeFromInvoice(invoice),
    servicePackage: packageFromInvoice(invoice),
    customerConcern: invoice.notes || "",
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
  });
  invoice.reportId = report.id;
  invoice.updatedAt = now;
  reports.push(report);
  writeReports(reports);
  return { report, created: true };
}

async function notifyWorkshopQuoteAccepted(quote, invoice, job, req) {
  if (!smtpConfigured()) {
    console.warn("Quote accepted but SMTP is not configured — workshop was not emailed.");
    return;
  }
  const totals = catalog.computeTotals(quote.lines);
  const money = totals.totalIncl.toFixed(2);
  const vehicle = quote.vehicle || "vehicle";
  const rego = quote.registration || "";
  const vehicleBit = `${vehicle}${rego ? ` (${rego})` : ""}`;
  const quoteUrl = billingPublicUrl(req, {}, quote);
  const invoiceNumber = invoice?.number || "";
  const jobNumber = job?.number || "";
  const subject = `Quote ${quote.number} accepted — ${rego || vehicle} — ${business.name}`;
  const text =
    `${quote.customerName || "A customer"} accepted quote ${quote.number}.\n` +
    (invoiceNumber ? `Invoice created: ${invoiceNumber}\n` : "") +
    (jobNumber ? `Job card created: ${jobNumber}\n` : "") +
    `\nVehicle: ${vehicleBit}\n` +
    `Total incl. GST: $${money}\n` +
    (quote.customerEmail ? `Email: ${quote.customerEmail}\n` : "") +
    (quote.customerPhone ? `Phone: ${quote.customerPhone}\n` : "") +
    `\nView quote:\n${quoteUrl}\n` +
    `\nNext: open Jobs in admin to start work, and Quotes & invoices to email the invoice.\n`;
  const html = `
    <p><strong>${escapeHtml(quote.customerName || "A customer")}</strong> accepted quote <strong>${escapeHtml(quote.number)}</strong>.</p>
    ${invoiceNumber ? `<p>Invoice created: <strong>${escapeHtml(invoiceNumber)}</strong></p>` : ""}
    ${jobNumber ? `<p>Job card created: <strong>${escapeHtml(jobNumber)}</strong></p>` : ""}
    <p>
      Vehicle: ${escapeHtml(vehicleBit)}<br/>
      Total incl. GST: <strong>$${escapeHtml(money)}</strong><br/>
      ${quote.customerEmail ? `Email: ${escapeHtml(quote.customerEmail)}<br/>` : ""}
      ${quote.customerPhone ? `Phone: ${escapeHtml(quote.customerPhone)}` : ""}
    </p>
    <p><a href="${escapeAttr(quoteUrl)}">View accepted quote</a></p>
    <p>Next: open <strong>Jobs</strong> to start work, and <strong>Quotes &amp; invoices</strong> to email the invoice.</p>
  `;
  const mailer = createMailer();
  await mailer.sendMail({
    from: MAIL_FROM,
    to: business.email,
    replyTo: quote.customerEmail || business.email,
    subject,
    text,
    html,
  });
}

app.post("/api/billing/:id/accept", async (req, res) => {
  const docs = readBilling();
  const index = docs.findIndex((d) => d.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Quote not found" });

  const doc = docs[index];
  if (doc.kind !== "quote") {
    return res.status(400).json({ error: "Only quotes can be accepted." });
  }
  if (doc.status === "void") {
    return res.status(400).json({ error: "This quote is no longer valid." });
  }
  const token = String(req.body?.token || req.query.t || "");
  if (!doc.acceptToken || token !== doc.acceptToken) {
    return res.status(403).json({
      error: "Open the accept link from your email to confirm this quote.",
    });
  }

  if (doc.status === "invoiced" || doc.status === "accepted") {
    const invoice =
      (doc.invoiceId && docs.find((d) => d.id === doc.invoiceId)) || null;
    let job = null;
    try {
      const ensured = ensureJobFromAcceptedQuote(docs, doc, invoice);
      job = ensured?.job || null;
      if (ensured?.created) writeBilling(docs);
    } catch (err) {
      console.error("Could not create job card for already-accepted quote:", err);
    }
    return res.json({
      ok: true,
      already: true,
      doc: withBillingTotals(doc, false),
      invoiceId: invoice?.id || "",
      invoiceNumber: invoice?.number || "",
      jobNumber: job?.number || "",
    });
  }
  if (doc.status !== "sent" && doc.status !== "draft") {
    return res.status(400).json({ error: "This quote is not ready to accept." });
  }

  if (doc.validUntil && todayIso() > doc.validUntil) {
    return res.status(400).json({
      error: "This quote has expired. Please contact the workshop for a new quote.",
    });
  }

  doc.status = "accepted";
  doc.acceptedAt = nowIso();
  doc.updatedAt = doc.acceptedAt;
  ensureHistory(doc);
  appendHistory(doc, {
    type: "accepted",
    summary: "Quote accepted by customer",
    amount: catalog.computeTotals(doc.lines).totalIncl,
  });

  let invoice = null;
  try {
    invoice = convertQuoteToInvoice(docs, doc);
  } catch (err) {
    writeBilling(docs);
    return res.status(err.status || 400).json({ error: err.message });
  }

  let job = null;
  try {
    const ensured = ensureJobFromAcceptedQuote(docs, doc, invoice);
    job = ensured?.job || null;
  } catch (err) {
    console.error("Quote accepted but job card failed:", err);
  }

  writeBilling(docs);

  try {
    await notifyWorkshopQuoteAccepted(doc, invoice, job, req);
  } catch (err) {
    console.error("Workshop accept-notify email failed:", err);
  }

  res.json({
    ok: true,
    already: false,
    doc: withBillingTotals(doc, false),
    invoiceId: invoice?.id || "",
    invoiceNumber: invoice?.number || "",
    jobNumber: job?.number || "",
  });
});

app.post("/api/billing/:id/convert", requireAdmin, requireCurrentBillingIfTech, (req, res) => {
  const docs = readBilling();
  const index = docs.findIndex((d) => d.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Not found" });

  const quote = docs[index];
  if (quote.kind !== "quote") {
    return res.status(400).json({ error: "Only quotes convert to invoices." });
  }
  if (quote.status !== "accepted" && quote.status !== "invoiced") {
    return res.status(400).json({ error: "Customer must accept the quote first." });
  }
  try {
    requireCustomerSnapshot(quote);
    const invoice = convertQuoteToInvoice(docs, quote);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    try {
      ensureJobFromAcceptedQuote(docs, quote, invoice);
      syncJobFromInvoiceExtras(docs, invoice);
    } catch (err) {
      console.error("Could not create job card from converted invoice:", err);
    }
    writeBilling(docs);
    res.json(withBillingTotals(invoice, true));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/billing/:id/revise", requireAdmin, requireCurrentBillingIfTech, (req, res) => {
  const docs = readBilling();
  const source = docs.find((d) => d.id === req.params.id);
  if (!source) return res.status(404).json({ error: billingMissingError() });
  if (source.kind !== "quote") {
    return res.status(400).json({ error: "Only quotes can be revised." });
  }
  if (source.status !== "accepted" && source.status !== "invoiced") {
    return res.status(400).json({
      error: "Edit this quote and click Save changes. Revise is only for accepted or invoiced quotes.",
    });
  }

  const now = nowIso();
  const today = todayIso();
  const revisedNote = `Revised from ${source.number}`;
  const notes = String(source.notes || "").trim();
  const doc = {
    id: randomUUID(),
    kind: "quote",
    number: nextBillingNumber(docs, "quote"),
    status: "draft",
    preset: source.preset || "custom",
    createdAt: now,
    updatedAt: now,
    sentAt: "",
    acceptedAt: "",
    validUntil: plusDays(today, catalog.QUOTE_VALID_DAYS),
    customerId: source.customerId || "",
    vehicleId: source.vehicleId || "",
    customerName: source.customerName || "",
    customerEmail: source.customerEmail || "",
    customerPhone: source.customerPhone || "",
    registration: String(source.registration || "").toUpperCase(),
    vehicle: source.vehicle || "",
    odometer: source.odometer || "",
    notes: notes ? `${notes}\n\n(${revisedNote})` : revisedNote,
    lines: (source.lines || []).map((line) => ({
      ...line,
      id: randomUUID(),
    })),
    acceptToken: newAcceptToken(),
    viewToken: newViewToken(),
    quoteId: "",
    invoiceId: "",
    jobId: "",
    lastEmailedAt: "",
    lastEmailedTo: "",
    revisedFromId: source.id,
    revisedFromNumber: source.number,
    history: [],
  };
  appendHistory(doc, {
    type: "created",
    summary: "Quote created",
    detail: `Revised from ${source.number}`,
    amount: catalog.computeTotals(doc.lines).totalIncl,
  });
  ensureHistory(source);
  appendHistory(source, {
    type: "revised",
    summary: "Revised quote created",
    detail: doc.number,
  });

  docs.push(doc);
  writeBilling(docs);
  res.status(201).json(withBillingTotals(doc, true));
});

app.post("/api/billing/:id/void", requireOwnerAdmin, (req, res) => {
  const docs = readBilling();
  const index = docs.findIndex((d) => d.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Not found" });
  if (docs[index].status === "invoiced") {
    return res.status(400).json({ error: "This quote already has an invoice." });
  }
  const doc = docs[index];
  if (doc.kind === "invoice" && referralsLib.referralCreditTotal(doc) > 0) {
    try {
      const removed = referralsLib.removeCreditsFromInvoice({
        storeRows: readReferrals(),
        invoice: doc,
      });
      writeReferrals(removed.rows);
      docs[index] = removed.invoice;
    } catch (err) {
      console.error("Could not restore referral credits on void:", err);
    }
  }
  docs[index].status = "void";
  docs[index].voidedAt = nowIso();
  docs[index].updatedAt = docs[index].voidedAt;
  ensureHistory(docs[index]);
  appendHistory(docs[index], {
    type: "voided",
    summary: "Document voided",
  });
  writeBilling(docs);
  res.json(withBillingTotals(docs[index], true));
});

app.delete("/api/billing/:id", requireAdmin, requireCurrentBillingIfTech, (req, res) => {
  const docs = readBilling();
  const doc = docs.find((d) => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: "Not found" });
  if (doc.status !== "draft") {
    return res.status(400).json({ error: "Only drafts can be deleted. Void it instead." });
  }
  writeBilling(docs.filter((d) => d.id !== req.params.id));
  res.json({ ok: true });
});

app.get("/api/appointments/meta", requireAdmin, (_req, res) => {
  res.json({
    statuses: appointmentsLib.APPOINTMENT_STATUSES,
    sources: appointmentsLib.APPOINTMENT_SOURCES,
    durationPresets: [
      { minutes: 60, label: "1 hour" },
      { minutes: 120, label: "2 hours" },
      { minutes: 180, label: "3 hours" },
      { minutes: 240, label: "Half day (4h)" },
    ],
    websmsConfigured: websms.websmsConfigured(),
    tomorrow: plusDays(todayIso(), 1),
  });
});

function formatSmsClock(time) {
  const t = appointmentsLib.normalizeTime(time);
  if (!t) return "";
  const [hRaw, m] = t.split(":").map(Number);
  const suffix = hRaw >= 12 ? "pm" : "am";
  const h12 = hRaw % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

function appointmentBookingSmsEligible(row, tomorrow = plusDays(todayIso(), 1)) {
  if (!row) return false;
  if (appointmentsLib.normalizeDate(row.date) !== tomorrow) return false;
  if (row.status === "cancelled" || row.status === "no_show") return false;
  if (row.bookingSmsReminderSentAt) return false;
  if (!websms.normalizeNzMobile(row.customerPhone)) return false;
  return websms.websmsConfigured();
}

function withAppointmentSmsMeta(row) {
  const next = syncAppointmentJobMeta({ ...row });
  return {
    ...next,
    canBookingSms: appointmentBookingSmsEligible(next),
  };
}

async function sendBookingConfirmSms(appointmentId) {
  if (!websms.websmsConfigured()) {
    const err = new Error(
      "WebSMS not configured. Add WEBSMS_CLIENT_ID and WEBSMS_CLIENT_SECRET to .env / Render, then restart."
    );
    err.status = 503;
    throw err;
  }
  const rows = readAppointments();
  const index = rows.findIndex((row) => row.id === appointmentId);
  if (index < 0) {
    const err = new Error("Appointment not found");
    err.status = 404;
    throw err;
  }
  const appt = syncAppointmentJobMeta({ ...rows[index] });
  const tomorrow = plusDays(todayIso(), 1);
  if (appointmentsLib.normalizeDate(appt.date) !== tomorrow) {
    const err = new Error("Booking SMS is only for appointments scheduled tomorrow.");
    err.status = 400;
    throw err;
  }
  if (appt.status === "cancelled" || appt.status === "no_show") {
    const err = new Error("Cannot SMS a cancelled or no-show appointment.");
    err.status = 400;
    throw err;
  }
  if (appt.bookingSmsReminderSentAt) {
    return {
      ok: true,
      alreadySent: true,
      channel: "sms",
      to: websms.normalizeNzMobile(appt.customerPhone) || appt.customerPhone,
      sentAt: appt.bookingSmsReminderSentAt,
      appointmentId: appt.id,
    };
  }
  const to = websms.normalizeNzMobile(appt.customerPhone);
  if (!to) {
    const err = new Error("Appointment needs a valid NZ mobile number for SMS.");
    err.status = 400;
    throw err;
  }

  const name =
    namesFromCustomer({ customerName: appt.customerName }).firstName ||
    String(appt.customerName || "there").trim() ||
    "there";
  const plate = String(appt.registration || "").trim().toUpperCase() || "your vehicle";
  const when = formatSmsClock(appt.startTime) || appt.startTime || "your booked time";
  const body =
    `Hi ${name}, your vehicle ${plate} is booked in tomorrow at ${when}. ` +
    `Reply YES to confirm or NO to reschedule. Deane Auto ${business.phoneTel}`;

  const sent = await websms.sendSms({
    to,
    body,
    messageClass: "transactional",
  });
  const sentAt = nowIso();
  rows[index] = appointmentsLib.normalizeAppointment(
    {
      ...appt,
      bookingSmsReminderSentAt: sentAt,
      updatedAt: sentAt,
    },
    appt.id
  );
  writeAppointments(rows);

  try {
    appendSmsLog({
      direction: "out",
      kind: "booking_confirm",
      at: sentAt,
      from: String(process.env.WEBSMS_FROM || "").trim(),
      to: sent.to,
      body,
      messageId: sent.messageId || "",
      customerId: appt.customerId || "",
      customerName: appt.customerName || "",
      registration: plate === "your vehicle" ? "" : plate,
      appointmentId: appt.id,
      sandbox: Boolean(sent.sandbox),
    });
  } catch (logErr) {
    console.error("Could not write booking SMS to inbox:", logErr);
  }

  return {
    ok: true,
    channel: "sms",
    to: sent.to,
    sentAt,
    appointmentId: appt.id,
    messageId: sent.messageId || "",
    sandbox: Boolean(sent.sandbox),
    customerName: appt.customerName || "",
  };
}

app.get("/api/appointments/booking-sms-tomorrow", requireOwnerAdmin, (_req, res) => {
  try {
    const tomorrow = plusDays(todayIso(), 1);
    const eligible = readAppointments()
      .map((row) => withAppointmentSmsMeta(row))
      .filter((row) => row.canBookingSms)
      .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
    res.json({
      tomorrow,
      count: eligible.length,
      appointments: eligible,
      websmsConfigured: websms.websmsConfigured(),
    });
  } catch (err) {
    console.error("Booking SMS tomorrow list failed:", err);
    res.status(500).json({ error: "Could not load tomorrow booking SMS list." });
  }
});

app.post("/api/appointments/booking-sms-reminder", requireOwnerAdmin, async (req, res) => {
  try {
    const id = String(req.body?.appointmentId || "").trim();
    if (!id) return res.status(400).json({ error: "appointmentId is required." });
    const result = await sendBookingConfirmSms(id);
    res.json(result);
  } catch (err) {
    const status = err.status || 400;
    if (status >= 500) console.error("Booking SMS reminder failed:", err);
    res.status(status).json({
      error: err.message || "Failed to send booking SMS. Check WebSMS settings.",
    });
  }
});

app.post("/api/appointments/booking-sms-reminder-bulk", requireOwnerAdmin, async (req, res) => {
  try {
    if (!websms.websmsConfigured()) {
      return res.status(503).json({
        error:
          "WebSMS not configured. Add WEBSMS_CLIENT_ID and WEBSMS_CLIENT_SECRET to .env / Render, then restart.",
      });
    }
    const tomorrow = plusDays(todayIso(), 1);
    const targets = readAppointments()
      .map((row) => withAppointmentSmsMeta(row))
      .filter((row) => row.canBookingSms);
    const summary = {
      tomorrow,
      sent: 0,
      alreadySent: 0,
      failed: [],
    };
    for (const target of targets) {
      try {
        const result = await sendBookingConfirmSms(target.id);
        if (result.alreadySent) summary.alreadySent += 1;
        else summary.sent += 1;
      } catch (err) {
        console.error("Booking bulk SMS failed:", target.id, err.message || err);
        summary.failed.push({
          appointmentId: target.id,
          customerName: target.customerName || "",
          registration: target.registration || "",
          error: err.message || "Failed",
        });
      }
    }
    res.json(summary);
  } catch (err) {
    console.error("Booking bulk SMS failed:", err);
    res.status(500).json({ error: err.message || "Bulk booking SMS failed." });
  }
});

app.get("/api/appointments", requireAdmin, (req, res) => {
  const from = appointmentsLib.normalizeDate(req.query.from);
  const to = appointmentsLib.normalizeDate(req.query.to);
  const jobId = String(req.query.jobId || "").trim();
  let rows = readAppointments().map((row) => withAppointmentSmsMeta(row));
  if (from) rows = rows.filter((row) => row.date >= from);
  if (to) rows = rows.filter((row) => row.date <= to);
  if (jobId) rows = rows.filter((row) => row.jobId === jobId);
  rows.sort((a, b) => {
    const byDate = String(a.date).localeCompare(String(b.date));
    if (byDate) return byDate;
    return String(a.startTime).localeCompare(String(b.startTime));
  });
  res.json(rows);
});

app.get("/api/appointments/:id", requireAdmin, (req, res) => {
  const row = readAppointments().find((item) => item.id === req.params.id);
  if (!row) return res.status(404).json({ error: "Appointment not found" });
  res.json(withAppointmentSmsMeta(row));
});

app.post("/api/appointments", requireAdmin, (req, res) => {
  try {
    validateAppointmentInput(req.body || {});
    const now = nowIso();
    const row = appointmentsLib.normalizeAppointment(
      {
        ...req.body,
        id: randomUUID(),
        status: req.body?.status || "booked",
        source: req.body?.source || "manual",
        createdAt: now,
        updatedAt: now,
      },
      randomUUID()
    );
    if (row.jobId) {
      const job = readJobs().find((j) => j.id === row.jobId);
      if (!job) {
        return res.status(400).json({ error: "Linked job not found." });
      }
      syncAppointmentJobMeta(row);
      if (row.status === "booked" || row.status === "confirmed" || row.status === "arrived") {
        row.status = "job_created";
      }
    }
    attachPartyCustomerId(row);
    const rows = readAppointments();
    rows.push(row);
    writeAppointments(rows);
    res.status(201).json(row);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.put("/api/appointments/:id", requireAdmin, (req, res) => {
  try {
    const rows = readAppointments();
    const index = rows.findIndex((row) => row.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Appointment not found" });
    validateAppointmentInput(req.body || {}, { partial: true });
    const merged = appointmentsLib.normalizeAppointment(
      {
        ...rows[index],
        ...req.body,
        id: rows[index].id,
        createdAt: rows[index].createdAt,
        updatedAt: nowIso(),
      },
      rows[index].id
    );
    if (merged.jobId) {
      const job = readJobs().find((j) => j.id === merged.jobId);
      if (!job) return res.status(400).json({ error: "Linked job not found." });
      syncAppointmentJobMeta(merged);
      if (merged.status === "booked" || merged.status === "confirmed" || merged.status === "arrived") {
        merged.status = "job_created";
      }
    } else {
      merged.jobNumber = "";
    }
    attachPartyCustomerId(merged);
    rows[index] = merged;
    writeAppointments(rows);
    res.json(merged);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.delete("/api/appointments/:id", requireAdmin, (req, res) => {
  const rows = readAppointments();
  const next = rows.filter((row) => row.id !== req.params.id);
  if (next.length === rows.length) {
    return res.status(404).json({ error: "Appointment not found" });
  }
  writeAppointments(next);
  res.json({ ok: true });
});

app.post("/api/appointments/:id/create-job", requireAdmin, (req, res) => {
  try {
    const rows = readAppointments();
    const index = rows.findIndex((row) => row.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Appointment not found" });
    const appt = rows[index];
    if (appt.jobId) {
      const existing = readJobs().find((j) => j.id === appt.jobId);
      if (existing) {
        return res.json({ appointment: appt, job: existing, created: false });
      }
    }

    const now = nowIso();
    attachPartyCustomerId(appt);
    const jobs = readJobs();
    const job = {
      ...emptyJob(now),
      number: nextJobCardNumber(jobs),
      customerId: appt.customerId || "",
      customerName: appt.customerName,
      customerEmail: appt.customerEmail,
      customerPhone: appt.customerPhone,
      registration: appt.registration,
      vehicle: appt.vehicle,
      workRequested: appt.workSummary,
      notes: appt.notes,
      status: "in_progress",
    };
    jobs.push(job);
    writeJobs(jobs);

    const nextAppt = appointmentsLib.normalizeAppointment(
      {
        ...appt,
        customerId: appt.customerId || "",
        jobId: job.id,
        jobNumber: job.number,
        status: "job_created",
        updatedAt: now,
      },
      appt.id
    );
    rows[index] = nextAppt;
    writeAppointments(rows);
    res.status(201).json({ appointment: nextAppt, job, created: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.get("/api/jobs/meta", requireAdmin, (_req, res) => {
  res.json({ statuses: jobsLib.JOB_STATUSES });
});

app.get("/api/jobs", requireAdmin, (_req, res) => {
  const jobs = readJobs()
    .map(summarizeJob)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json(jobs);
});

app.post("/api/jobs", requireAdmin, (_req, res) => {
  res.status(400).json({
    error: "Create a job card from an accepted quote or invoice. Direct job cards are not used.",
  });
});

app.post("/api/jobs/from-quote/:id", requireAdmin, (req, res) => {
  try {
    const docs = readBilling();
    const found = billingSourceForJob(docs, req.params.id);
    if (found.error) {
      return res.status(found.status || 400).json({ error: found.error });
    }

    const { quote, invoice } = found;
    const ensured = ensureJobFromAcceptedQuote(docs, quote, invoice);
    if (!ensured?.job) {
      return res.status(400).json({ error: "Could not create job card." });
    }
    if (invoice) {
      try {
        syncJobFromInvoiceExtras(docs, invoice);
      } catch (err) {
        console.error("Could not sync invoice parts onto job card:", err);
      }
    }
    if (ensured.created) writeBilling(docs);
    const job = readJobs().find((j) => j.id === ensured.job.id) || ensured.job;
    res.status(ensured.created ? 201 : 200).json(job);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.get("/api/jobs/:id", requireAdmin, (req, res) => {
  const jobs = readJobs();
  const index = jobs.findIndex((j) => j.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Job not found" });

  const job = jobs[index];
  if (job.quoteId || job.invoiceId) {
    const docs = readBilling();
    const quote = job.quoteId ? docs.find((d) => d.id === job.quoteId) : null;
    const invoice = job.invoiceId ? docs.find((d) => d.id === job.invoiceId) : null;
    const fields = customerFieldsForJob(quote || invoice || {});
    if (applyCustomerFieldsToJob(job, fields, true)) {
      jobs[index] = job;
      writeJobs(jobs);
    }
    if (invoice && invoice.kind === "invoice") {
      try {
        syncJobFromInvoiceExtras(docs, invoice);
        const latest = readJobs().find((j) => j.id === job.id);
        if (latest) return res.json(latest);
      } catch (err) {
        console.error("Could not sync invoice parts onto job card:", err);
      }
    }
  }
  res.json({
    ...job,
    workPhotos: sanitizePhotoRefs(job.workPhotos),
    supplierInvoicePhotos: sanitizePhotoRefs(job.supplierInvoicePhotos),
  });
});

app.post("/api/jobs/:id/work-photos", requireAdmin, upload.array("photos", 12), (req, res) => {
  const jobs = readJobs();
  const index = jobs.findIndex((j) => j.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Job not found" });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: "No photo uploaded" });
  const added = files.map((file) => `/uploads/${file.filename}`);
  const next = sanitizePhotoRefs([...(jobs[index].workPhotos || []), ...added]);
  jobs[index].workPhotos = next;
  jobs[index].updatedAt = nowIso();
  writeJobs(jobs);
  res.json({ workPhotos: next });
});

app.delete("/api/jobs/:id/work-photos", requireAdmin, (req, res) => {
  const jobs = readJobs();
  const index = jobs.findIndex((j) => j.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Job not found" });
  const url = String(req.body?.url || req.query.url || "").trim();
  if (!url) return res.status(400).json({ error: "Photo URL is required." });
  const next = sanitizePhotoRefs((jobs[index].workPhotos || []).filter((src) => src !== url));
  jobs[index].workPhotos = next;
  jobs[index].updatedAt = nowIso();
  writeJobs(jobs);
  res.json({ workPhotos: next });
});

app.post(
  "/api/jobs/:id/supplier-invoice-photos",
  requireAdmin,
  upload.array("photos", 12),
  (req, res) => {
    const jobs = readJobs();
    const index = jobs.findIndex((j) => j.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Job not found" });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No photo uploaded" });
    const added = files.map((file) => `/uploads/${file.filename}`);
    const next = sanitizePhotoRefs([...(jobs[index].supplierInvoicePhotos || []), ...added]);
    jobs[index].supplierInvoicePhotos = next;
    jobs[index].updatedAt = nowIso();
    writeJobs(jobs);
    res.json({ supplierInvoicePhotos: next });
  }
);

app.delete("/api/jobs/:id/supplier-invoice-photos", requireAdmin, (req, res) => {
  const jobs = readJobs();
  const index = jobs.findIndex((j) => j.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Job not found" });
  const url = String(req.body?.url || req.query.url || "").trim();
  if (!url) return res.status(400).json({ error: "Photo URL is required." });
  const next = sanitizePhotoRefs(
    (jobs[index].supplierInvoicePhotos || []).filter((src) => src !== url)
  );
  jobs[index].supplierInvoicePhotos = next;
  jobs[index].updatedAt = nowIso();
  writeJobs(jobs);
  res.json({ supplierInvoicePhotos: next });
});

app.put("/api/jobs/:id", requireAdmin, (req, res) => {
  try {
    const jobs = readJobs();
    const index = jobs.findIndex((j) => j.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Job not found" });
    const current = jobs[index];
    jobs[index] = applyJobFields(current, req.body || {});
    jobs[index].id = current.id;
    jobs[index].number = current.number;
    jobs[index].createdAt = current.createdAt;
    jobs[index].quoteId = current.quoteId;
    jobs[index].quoteNumber = current.quoteNumber;
    jobs[index].invoiceId = current.invoiceId;
    jobs[index].invoiceNumber = current.invoiceNumber;
    writeJobs(jobs);
    res.json(jobs[index]);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.delete("/api/jobs/:id", requireAdmin, (req, res) => {
  const jobs = readJobs();
  const next = jobs.filter((j) => j.id !== req.params.id);
  if (next.length === jobs.length) {
    return res.status(404).json({ error: "Job not found" });
  }
  try {
    writeJobs(next);
    unlinkJobFromBilling(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.get("/api/jobs/:jobId/parts", requireAdmin, (req, res) => {
  const jobs = readJobs();
  const job = jobs.find((row) => row.id === req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(jobsLib.normalizeParts(job.parts, () => randomUUID()));
});

app.post("/api/jobs/:jobId/parts", requireAdmin, (req, res) => {
  const jobs = readJobs();
  const index = jobs.findIndex((row) => row.id === req.params.jobId);
  if (index < 0) return res.status(404).json({ error: "Job not found" });
  const before = { ...(jobs[index] || {}) };
  const now = nowIso();
  const payload = jobsLib.normalizePart(
    {
      ...req.body,
      source: req.body?.source || "manual",
      status: req.body?.status || "draft",
      createdAt: req.body?.createdAt || now,
      createdBy: req.body?.createdBy || nowActor(req),
      updatedAt: now,
      updatedBy: nowActor(req),
    },
    randomUUID()
  );
  const rows = Array.isArray(jobs[index].parts) ? [...jobs[index].parts] : [];
  rows.push(payload);
  jobs[index].parts = jobsLib.normalizeParts(rows, () => randomUUID());
  jobs[index].status = jobsLib.normalizeJobStatus(jobs[index].status, jobs[index].parts);
  jobs[index].updatedAt = now;
  writeJobs(jobs);
  writePartAudit(
    "jobPart",
    payload.id,
    "create",
    null,
    { jobId: jobs[index].id, part: payload },
    req,
    "manual part create"
  );
  writePartAudit(
    "job",
    jobs[index].id,
    "update",
    before,
    jobs[index],
    req,
    "part added to job"
  );
  res.status(201).json(payload);
});

app.patch("/api/jobs/:jobId/parts/:partId", requireAdmin, (req, res) => {
  const jobs = readJobs();
  const index = jobs.findIndex((row) => row.id === req.params.jobId);
  if (index < 0) return res.status(404).json({ error: "Job not found" });
  const parts = Array.isArray(jobs[index].parts) ? [...jobs[index].parts] : [];
  const partIndex = parts.findIndex((row) => row.id === req.params.partId);
  if (partIndex < 0) return res.status(404).json({ error: "Part not found" });
  const existing = parts[partIndex];
  const now = nowIso();
  const merged = jobsLib.normalizePart(
    {
      ...existing,
      ...req.body,
      id: existing.id,
      updatedAt: now,
      updatedBy: nowActor(req),
    },
    existing.id
  );
  parts[partIndex] = merged;
  jobs[index].parts = jobsLib.normalizeParts(parts, () => randomUUID());
  jobs[index].status = jobsLib.normalizeJobStatus(jobs[index].status, jobs[index].parts);
  jobs[index].updatedAt = now;
  writeJobs(jobs);
  writePartAudit("jobPart", merged.id, "update", existing, merged, req, "part patched");
  res.json(merged);
});

app.delete("/api/jobs/:jobId/parts/:partId", requireAdmin, (req, res) => {
  const jobs = readJobs();
  const index = jobs.findIndex((row) => row.id === req.params.jobId);
  if (index < 0) return res.status(404).json({ error: "Job not found" });
  const parts = Array.isArray(jobs[index].parts) ? [...jobs[index].parts] : [];
  const partIndex = parts.findIndex((row) => row.id === req.params.partId);
  if (partIndex < 0) return res.status(404).json({ error: "Part not found" });
  const removed = parts[partIndex];
  parts.splice(partIndex, 1);
  jobs[index].parts = jobsLib.normalizeParts(parts, () => randomUUID());
  jobs[index].status = jobsLib.normalizeJobStatus(jobs[index].status, jobs[index].parts);
  jobs[index].updatedAt = nowIso();
  writeJobs(jobs);
  writePartAudit("jobPart", removed.id, "delete", removed, null, req, "part deleted");
  res.json({ ok: true });
});

app.post("/api/jobs/:jobId/parts/recalculate", requireAdmin, (req, res) => {
  const jobs = readJobs();
  const index = jobs.findIndex((row) => row.id === req.params.jobId);
  if (index < 0) return res.status(404).json({ error: "Job not found" });
  const rows = Array.isArray(jobs[index].parts) ? jobs[index].parts : [];
  const updated = rows.map((part) => {
    const incomingMarkup = req.body?.markupPercent;
    const markupPercent =
      incomingMarkup != null && incomingMarkup !== ""
        ? Math.max(0, Number(incomingMarkup) || 0)
        : Number(part.markupPercent) || 0;
    const qty = Number(part.qty) || 0;
    const cost = toMoney(part.costPrice);
    const sell = toMoney(cost * (1 + markupPercent / 100));
    return jobsLib.normalizePart(
      {
        ...part,
        markupPercent,
        sellPrice: sell,
        lineCostTotal: toMoney(qty * cost),
        lineSellTotal: toMoney(qty * sell),
        updatedAt: nowIso(),
        updatedBy: nowActor(req),
      },
      part.id
    );
  });
  jobs[index].parts = updated;
  jobs[index].updatedAt = nowIso();
  writeJobs(jobs);
  res.json(updated);
});

app.post("/api/jobs/:jobId/parts/:partId/mark-billed", requireAdmin, (req, res) => {
  const jobs = readJobs();
  const index = jobs.findIndex((row) => row.id === req.params.jobId);
  if (index < 0) return res.status(404).json({ error: "Job not found" });
  const parts = Array.isArray(jobs[index].parts) ? [...jobs[index].parts] : [];
  const partIndex = parts.findIndex((row) => row.id === req.params.partId);
  if (partIndex < 0) return res.status(404).json({ error: "Part not found" });
  const previous = parts[partIndex];
  const next = jobsLib.normalizePart(
    {
      ...previous,
      linkedInvoiceId: String(req.body?.linkedInvoiceId || jobs[index].invoiceId || "").trim(),
      status: "billed",
      updatedAt: nowIso(),
      updatedBy: nowActor(req),
    },
    previous.id
  );
  parts[partIndex] = next;
  jobs[index].parts = jobsLib.normalizeParts(parts, () => randomUUID());
  jobs[index].updatedAt = nowIso();
  writeJobs(jobs);
  writePartAudit("jobPart", next.id, "update", previous, next, req, "mark billed");
  const invoiceId = next.linkedInvoiceId;
  if (invoiceId) {
    const docs = readBilling();
    const invoice = docs.find((d) => d.id === invoiceId && d.kind === "invoice");
    if (invoice && addJobPartsToInvoiceLines(invoice, [next])) writeBilling(docs);
  }
  res.json(next);
});

function invoiceLineKey(description) {
  return String(description || "")
    .trim()
    .toLowerCase();
}

function addJobPartsToInvoiceLines(invoice, parts) {
  if (!invoice || invoice.kind !== "invoice" || invoice.status === "void") return 0;
  const lines = Array.isArray(invoice.lines) ? [...invoice.lines] : [];
  let added = 0;
  for (const part of parts || []) {
    const description = String(part.description || "").trim();
    if (!description || jobsLib.isServiceOrLabourLine(description)) continue;
    const key = invoiceLineKey(description);
    if (lines.some((line) => invoiceLineKey(line.description) === key)) continue;
    const qty = Number(part.qty);
    lines.push({
      id: randomUUID(),
      description: catalog.capitalizeLineDescription(description),
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      unitPriceIncl: catalog.round2(Math.max(0, Number(part.sellPrice) || 0)),
    });
    added += 1;
  }
  if (!added) return 0;
  invoice.lines = lines;
  invoice.updatedAt = nowIso();
  ensureHistory(invoice);
  appendHistory(invoice, {
    type: "edited",
    summary: "Job parts added to invoice",
    detail: `${added} line${added === 1 ? "" : "s"}`,
    amount: catalog.computeTotals(invoice.lines).totalIncl,
  });
  return added;
}

app.post("/api/jobs/:jobId/invoices/:invoiceId/attach-parts", requireAdmin, (req, res) => {
  const jobs = readJobs();
  const index = jobs.findIndex((row) => row.id === req.params.jobId);
  if (index < 0) return res.status(404).json({ error: "Job not found" });
  const docs = readBilling();
  const invoice = docs.find((d) => d.id === req.params.invoiceId && d.kind === "invoice");
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  if (staffFromReq(req)?.role === "technician" && !isCurrentWorkshopBilling(invoice)) {
    return res.status(403).json({ error: "This quote/invoice is in history. Ask admin to open it." });
  }
  if (invoice.status === "void") {
    return res.status(400).json({ error: "This invoice has been voided." });
  }

  const onlyApproved = req.body?.onlyApproved !== false;
  const toBill = [];
  let attached = 0;
  const rows = (jobs[index].parts || []).map((part) => {
    if (jobsLib.isServiceOrLabourLine(part.description)) return part;
    const alreadyOnThisInvoice =
      String(part.linkedInvoiceId || "") === req.params.invoiceId;
    if (alreadyOnThisInvoice) {
      toBill.push(part);
      return part;
    }
    if (onlyApproved && part.status !== "approved") return part;
    attached += 1;
    const next = jobsLib.normalizePart(
      {
        ...part,
        linkedInvoiceId: req.params.invoiceId,
        status: "billed",
        updatedAt: nowIso(),
        updatedBy: nowActor(req),
      },
      part.id
    );
    toBill.push(next);
    return next;
  });
  jobs[index].parts = rows;
  jobs[index].invoiceId = jobs[index].invoiceId || req.params.invoiceId;
  jobs[index].invoiceNumber = jobs[index].invoiceNumber || invoice.number;
  jobs[index].updatedAt = nowIso();
  const linesAdded = addJobPartsToInvoiceLines(invoice, toBill);
  writeJobs(jobs);
  writeBilling(docs);
  res.json({
    ok: true,
    attached,
    linesAdded,
    invoiceId: req.params.invoiceId,
    invoice: withBillingTotals(invoice, true),
  });
});

app.post(
  "/api/supplier-invoices/import-file",
  requireOwnerAdmin,
  ocrImportUpload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const rawText = await extractTextFromImportFile(file);
      if (!rawText) {
        return res.status(400).json({
          error: "Could not read text from file. Try a clearer image or higher resolution photo.",
        });
      }

      const parsedInvoice = parseSupplierInvoiceText(rawText);
      const supplier = String(req.body?.supplier || parsedInvoice.supplier || "").trim();
      const invoiceNo = String(req.body?.invoiceNo || parsedInvoice.invoiceNo || "").trim();
      if (!supplier) {
        return res.status(400).json({ error: "Could not detect supplier. Enter supplier manually." });
      }
      if (!invoiceNo) {
        return res
          .status(400)
          .json({ error: "Could not detect invoice number. Enter invoice number manually." });
      }

      const invoices = readSupplierInvoices();
      const duplicate = invoices.find(
        (row) =>
          normalizeSupplierName(row.supplier) === normalizeSupplierName(supplier) &&
          normalizeInvoiceNo(row.invoiceNo) === normalizeInvoiceNo(invoiceNo)
      );
      if (duplicate) {
        return res.status(409).json({
          error: "Duplicate supplier invoice number for this supplier.",
          duplicateInvoiceId: duplicate.id,
        });
      }

      const now = nowIso();
      const imageRefs = [];
      if (file.buffer) {
        const mime = String(file.mimetype || "");
        const ext =
          UPLOAD_MIME_EXT[mime] ||
          (mime === "application/pdf" ? ".pdf" : mime.startsWith("image/") ? ".jpg" : "");
        if (ext) {
          const filename = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
          fs.writeFileSync(path.join(UPLOADS_DIR, filename), file.buffer);
          imageRefs.push(`/uploads/${filename}`);
        }
      }
      const created = normalizeSupplierInvoice({
        id: randomUUID(),
        supplier,
        invoiceNo,
        invoiceDate: normalizeInvoiceDateInput(req.body?.invoiceDate || parsedInvoice.invoiceDate),
        subtotal: toMoney(req.body?.subtotal ?? parsedInvoice.subtotal),
        tax: toMoney(req.body?.tax ?? parsedInvoice.tax),
        total: toMoney(req.body?.total ?? parsedInvoice.total),
        currency: String(req.body?.currency || "NZD").trim().toUpperCase() || "NZD",
        linkedJobId: String(req.body?.linkedJobId || "").trim(),
        notes: String(req.body?.notes || "").trim(),
        status: "parsed",
        imageRefs,
        ocrRawTextRef: "",
        parseVersion: "pdf-v1",
        createdAt: now,
        createdBy: nowActor(req),
        updatedAt: now,
        updatedBy: nowActor(req),
      });
      invoices.push(created);
      writeSupplierInvoices(invoices);

      const allCandidates = readInvoiceCandidates();
      const parsedCandidates = (parsedInvoice.candidates || []).slice(0, 200).map((line) =>
        normalizeCandidate({
          id: randomUUID(),
          supplierInvoiceId: created.id,
          lineNo: line.lineNo,
          rawLineText: line.rawLineText,
          partNumberCandidate: line.partNumberCandidate,
          descriptionCandidate: line.descriptionCandidate,
          qtyCandidate: line.qtyCandidate,
          costPriceCandidate: line.costPriceCandidate,
          supplierCandidate: line.supplierCandidate || created.supplier,
          confidence: line.confidence ?? 0.7,
          decision: "pending",
          createdAt: now,
          updatedAt: now,
        })
      );
      for (const row of parsedCandidates) allCandidates.push(row);
      writeInvoiceCandidates(allCandidates);

      const rematched = rematchCandidatesForInvoice(created.id).map((row) => normalizeCandidate(row));
      const invoiceAfter = refreshSupplierInvoiceStatus(created.id) || created;
      writePartAudit(
        "supplierInvoice",
        invoiceAfter.id,
        "create",
        null,
        invoiceAfter,
        req,
        "imported from pdf"
      );
      res.status(201).json({
        invoice: invoiceAfter,
        candidates: rematched,
        parsed: {
          sourceType: file.mimetype === "application/pdf" ? "pdf" : "image",
          supplier: parsedInvoice.supplier,
          invoiceNo: parsedInvoice.invoiceNo,
          invoiceDate: parsedInvoice.invoiceDate,
        },
      });
    } catch (err) {
      console.error("Could not import supplier invoice file:", err);
      res.status(err.status || 400).json({ error: err.message || "Failed to import file." });
    }
  }
);

app.post("/api/supplier-invoices", requireOwnerAdmin, (req, res) => {
  try {
    const payload = validateSupplierInvoiceInput(req.body || {});
    const rows = readSupplierInvoices();
    const duplicate = rows.find(
      (row) =>
        normalizeSupplierName(row.supplier) === normalizeSupplierName(payload.supplier) &&
        normalizeInvoiceNo(row.invoiceNo) === normalizeInvoiceNo(payload.invoiceNo)
    );
    if (duplicate) {
      return res.status(409).json({
        error: "Duplicate supplier invoice number for this supplier.",
        duplicateInvoiceId: duplicate.id,
      });
    }
    const now = nowIso();
    const invoice = normalizeSupplierInvoice({
      id: randomUUID(),
      ...payload,
      status: "uploaded",
      imageRefs: [],
      ocrRawTextRef: "",
      parseVersion: "v1",
      createdAt: now,
      createdBy: nowActor(req),
      updatedAt: now,
      updatedBy: nowActor(req),
    });
    rows.push(invoice);
    writeSupplierInvoices(rows);
    writePartAudit("supplierInvoice", invoice.id, "create", null, invoice, req, "invoice created");
    res.status(201).json(invoice);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.get("/api/supplier-invoices", requireOwnerAdmin, (_req, res) => {
  const candidateRows = readInvoiceCandidates();
  const rows = readSupplierInvoices()
    .map((row) => normalizeSupplierInvoice(row))
    .map((row) => {
      const candidates = candidateRows.filter((c) => c.supplierInvoiceId === row.id);
      const accepted = candidates.filter((c) => isJobAcceptedCandidateDecision(c.decision)).length;
      const consumable = candidates.filter((c) => c.decision === "consumable").length;
      const tool = candidates.filter((c) => c.decision === "tool").length;
      const rejected = candidates.filter((c) => c.decision === "rejected").length;
      const pending = candidates.filter((c) => c.decision === "pending").length;
      const resolved = candidates.filter((c) => isResolvedCandidateDecision(c.decision)).length;
      let consumableCost = 0;
      let toolCost = 0;
      for (const c of candidates) {
        const line = toMoney((Number(c.qtyCandidate) || 0) * (Number(c.costPriceCandidate) || 0));
        if (c.decision === "consumable") consumableCost += line;
        if (c.decision === "tool") toolCost += line;
      }
      return {
        ...row,
        candidatesTotal: candidates.length,
        candidatesAccepted: accepted,
        candidatesConsumable: consumable,
        candidatesTool: tool,
        candidatesRejected: rejected,
        candidatesResolved: resolved,
        candidatesPending: pending,
        consumableCost: toMoney(consumableCost),
        toolCost: toMoney(toolCost),
        searchLines: candidates.map((c) => ({
          description: String(c.descriptionCandidate || "").trim(),
          partNumber: String(c.partNumberCandidate || "").trim(),
          qty: Number(c.qtyCandidate) || 0,
          cost: toMoney(c.costPriceCandidate),
          decision: String(c.decision || "pending"),
        })),
      };
    })
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  res.json(rows);
});

app.get("/api/supplier-invoices/:invoiceId", requireOwnerAdmin, (req, res) => {
  const rows = readSupplierInvoices();
  const invoice = rows.find((row) => row.id === req.params.invoiceId);
  if (!invoice) return res.status(404).json({ error: "Supplier invoice not found" });
  const candidates = readInvoiceCandidates().filter(
    (row) => row.supplierInvoiceId === req.params.invoiceId
  );
  const normalized = normalizeSupplierInvoice(invoice);
  res.json({
    ...normalized,
    candidatesTotal: candidates.length,
    candidatesPending: candidates.filter((row) => row.decision === "pending").length,
    candidatesAccepted: candidates.filter((row) => isJobAcceptedCandidateDecision(row.decision))
      .length,
    candidatesConsumable: candidates.filter((row) => row.decision === "consumable").length,
    candidatesTool: candidates.filter((row) => row.decision === "tool").length,
    candidatesResolved: candidates.filter((row) => isResolvedCandidateDecision(row.decision)).length,
    tracking: supplierInvoiceTrackingSummary(normalized),
  });
});

app.put("/api/supplier-invoices/:invoiceId", requireOwnerAdmin, (req, res) => {
  try {
    const rows = readSupplierInvoices();
    const index = rows.findIndex((row) => row.id === req.params.invoiceId);
    if (index < 0) return res.status(404).json({ error: "Supplier invoice not found" });
    const payload = validateSupplierInvoiceInput(req.body || {});
    const duplicate = rows.find(
      (row) =>
        row.id !== req.params.invoiceId &&
        normalizeSupplierName(row.supplier) === normalizeSupplierName(payload.supplier) &&
        normalizeInvoiceNo(row.invoiceNo) === normalizeInvoiceNo(payload.invoiceNo)
    );
    if (duplicate) {
      return res.status(409).json({
        error: "Duplicate supplier invoice number for this supplier.",
        duplicateInvoiceId: duplicate.id,
      });
    }
    const before = normalizeSupplierInvoice(rows[index]);
    const next = normalizeSupplierInvoice({
      ...rows[index],
      ...payload,
      updatedAt: nowIso(),
      updatedBy: nowActor(req),
    });
    rows[index] = next;
    writeSupplierInvoices(rows);
    writePartAudit("supplierInvoice", next.id, "update", before, next, req, "invoice updated");
    res.json(next);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post(
  "/api/supplier-invoices/:invoiceId/images",
  requireOwnerAdmin,
  invoiceEvidenceUpload.array("images", 12),
  (req, res) => {
    const rows = readSupplierInvoices();
    const index = rows.findIndex((row) => row.id === req.params.invoiceId);
    if (index < 0) return res.status(404).json({ error: "Supplier invoice not found" });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No file uploaded" });
    const added = files.map((file) => `/uploads/${file.filename}`);
    const prev = normalizeSupplierInvoice(rows[index]);
    const next = normalizeSupplierInvoice({
      ...rows[index],
      imageRefs: [...(rows[index].imageRefs || []), ...added].slice(0, 12),
      updatedAt: nowIso(),
      updatedBy: nowActor(req),
    });
    rows[index] = next;
    writeSupplierInvoices(rows);
    writePartAudit("supplierInvoice", next.id, "update", prev, next, req, "original file attached");
    res.json(next);
  }
);

app.post("/api/supplier-invoices/:invoiceId/parse", requireOwnerAdmin, (req, res) => {
  const invoices = readSupplierInvoices();
  const invoiceIndex = invoices.findIndex((row) => row.id === req.params.invoiceId);
  if (invoiceIndex < 0) return res.status(404).json({ error: "Supplier invoice not found" });
  const invoice = normalizeSupplierInvoice(invoices[invoiceIndex]);
  const parsedRows = parseCandidatesFromPayload(req.body || {}, invoice.supplier);
  if (!parsedRows.length) {
    return res.status(400).json({
      error:
        "No candidate rows parsed. Provide body.lines[] or body.rawText from OCR output.",
    });
  }
  const allCandidates = readInvoiceCandidates();
  const now = nowIso();
  const created = parsedRows.map((row) =>
    normalizeCandidate({
      id: randomUUID(),
      supplierInvoiceId: invoice.id,
      lineNo: row.lineNo,
      rawLineText: row.rawLineText,
      partNumberCandidate: row.partNumberCandidate,
      descriptionCandidate: row.descriptionCandidate,
      qtyCandidate: row.qtyCandidate,
      costPriceCandidate: row.costPriceCandidate,
      supplierCandidate: row.supplierCandidate || invoice.supplier,
      confidence: row.confidence,
      decision: "pending",
      createdAt: now,
      updatedAt: now,
    })
  );
  for (const row of created) allCandidates.push(row);
  writeInvoiceCandidates(allCandidates);
  invoices[invoiceIndex] = normalizeSupplierInvoice({
    ...invoice,
    status: "parsed",
    ocrRawTextRef: String(req.body?.ocrRawTextRef || req.body?.rawTextRef || "").trim(),
    parseVersion: "v1",
    updatedAt: now,
    updatedBy: nowActor(req),
  });
  writeSupplierInvoices(invoices);
  const matched = rematchCandidatesForInvoice(invoice.id).map((row) => normalizeCandidate(row));
  const refreshed = refreshSupplierInvoiceStatus(invoice.id);
  writePartAudit(
    "supplierInvoice",
    invoice.id,
    "update",
    invoice,
    refreshed || invoice,
    req,
    "invoice parsed"
  );
  res.status(201).json({ invoice: refreshed || invoices[invoiceIndex], candidates: matched });
});

app.get("/api/supplier-invoices/:invoiceId/candidates", requireOwnerAdmin, (req, res) => {
  const invoice = readSupplierInvoices().find((row) => row.id === req.params.invoiceId);
  if (!invoice) return res.status(404).json({ error: "Supplier invoice not found" });
  const rows = readInvoiceCandidates()
    .filter((row) => row.supplierInvoiceId === req.params.invoiceId)
    .map((row) => normalizeCandidate(row))
    .sort((a, b) => Number(a.lineNo) - Number(b.lineNo));
  res.json(rows);
});

app.post("/api/supplier-invoices/:invoiceId/auto-match", requireOwnerAdmin, (req, res) => {
  try {
    const rows = rematchCandidatesForInvoice(req.params.invoiceId).map((row) =>
      normalizeCandidate(row)
    );
    const invoice = refreshSupplierInvoiceStatus(req.params.invoiceId);
    res.json({ invoice, candidates: rows });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/invoice-candidates/:candidateId/accept", requireOwnerAdmin, (req, res) => {
  try {
    res.json(acceptInvoiceCandidate(req.params.candidateId, req, "accepted"));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/invoice-candidates/:candidateId/edit-accept", requireOwnerAdmin, (req, res) => {
  try {
    const nextReq = {
      ...req,
      body: {
        ...(req.body || {}),
        part: { ...(req.body?.part || {}), ...(req.body || {}) },
      },
    };
    res.json(acceptInvoiceCandidate(req.params.candidateId, nextReq, "edited_then_accepted"));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.patch("/api/invoice-candidates/:candidateId/edit-matched", requireOwnerAdmin, (req, res) => {
  try {
    res.json(editMatchedCandidate(req.params.candidateId, req));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/invoice-candidates/:candidateId/unmatch", requireOwnerAdmin, (req, res) => {
  try {
    res.json(unmatchInvoiceCandidate(req.params.candidateId, req));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/invoice-candidates/:candidateId/reject", requireOwnerAdmin, (req, res) => {
  const rows = readInvoiceCandidates();
  const index = rows.findIndex((row) => row.id === req.params.candidateId);
  if (index < 0) return res.status(404).json({ error: "Candidate not found" });
  const previous = normalizeCandidate(rows[index]);
  if (previous.decision !== "pending") {
    return res.status(400).json({ error: "Candidate has already been decided." });
  }
  const next = normalizeCandidate({
    ...previous,
    decision: "rejected",
    decidedAt: nowIso(),
    decidedBy: nowActor(req),
    matchReason: String(req.body?.reason || previous.matchReason || "rejected by user"),
    updatedAt: nowIso(),
  });
  rows[index] = next;
  writeInvoiceCandidates(rows);
  const invoice = refreshSupplierInvoiceStatus(next.supplierInvoiceId);
  writePartAudit("invoiceCandidate", next.id, "reject", previous, next, req, next.matchReason);
  res.json({ candidate: next, supplierInvoice: invoice });
});

app.post("/api/invoice-candidates/:candidateId/consumable", requireOwnerAdmin, (req, res) => {
  try {
    res.json(classifyShopCandidate(req.params.candidateId, req, "consumable"));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.post("/api/invoice-candidates/:candidateId/tool", requireOwnerAdmin, (req, res) => {
  try {
    res.json(classifyShopCandidate(req.params.candidateId, req, "tool"));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

function classifyShopCandidate(candidateId, req, decision) {
  if (!isShopClassifiedCandidateDecision(decision)) {
    const err = new Error("Invalid shop classification.");
    err.status = 400;
    throw err;
  }
  const rows = readInvoiceCandidates();
  const index = rows.findIndex((row) => row.id === candidateId);
  if (index < 0) {
    const err = new Error("Candidate not found");
    err.status = 404;
    throw err;
  }
  const previous = normalizeCandidate(rows[index]);
  if (previous.decision !== "pending") {
    const err = new Error("Candidate has already been decided.");
    err.status = 400;
    throw err;
  }
  const defaultReason = decision === "tool" ? "shop tool" : "shop consumable";
  const next = normalizeCandidate({
    ...previous,
    decision,
    suggestedJobId: "",
    suggestedPartId: "",
    appliedJobId: "",
    appliedPartId: "",
    matchScore: 0,
    decidedAt: nowIso(),
    decidedBy: nowActor(req),
    matchReason: String(req.body?.reason || previous.matchReason || defaultReason),
    updatedAt: nowIso(),
  });
  rows[index] = next;
  writeInvoiceCandidates(rows);
  const invoice = refreshSupplierInvoiceStatus(next.supplierInvoiceId);
  writePartAudit(
    "invoiceCandidate",
    next.id,
    "update",
    previous,
    next,
    req,
    `candidate classified as ${decision}`
  );
  return { candidate: next, supplierInvoice: invoice };
}

app.get("/api/match/part-suggestions", requireOwnerAdmin, (req, res) => {
  const invoiceId = String(req.query.invoiceId || "").trim();
  if (!invoiceId) return res.status(400).json({ error: "invoiceId is required" });
  const invoice = readSupplierInvoices().find((row) => row.id === invoiceId);
  if (!invoice) return res.status(404).json({ error: "Supplier invoice not found" });
  const jobs = readJobs();
  const rows = readInvoiceCandidates()
    .filter((row) => row.supplierInvoiceId === invoiceId && row.decision === "pending")
    .map((row) => {
      const hit = suggestCandidateMatch(row, jobs, invoice);
      return {
        candidateId: row.id,
        supplierInvoiceId: row.supplierInvoiceId,
        lineNo: row.lineNo,
        suggestedJobId: hit.jobId || row.suggestedJobId || "",
        suggestedPartId: hit.partId || row.suggestedPartId || "",
        score: toRatio(hit.score || row.matchScore || 0),
        reason: hit.reason || row.matchReason || "",
      };
    });
  res.json(rows);
});

app.get("/api/validation/duplicate-invoice", requireOwnerAdmin, (req, res) => {
  const supplier = normalizeSupplierName(req.query.supplier);
  const invoiceNo = normalizeInvoiceNo(req.query.invoiceNo);
  if (!supplier || !invoiceNo) {
    return res.status(400).json({ error: "supplier and invoiceNo are required" });
  }
  const rows = readSupplierInvoices();
  const duplicate = rows.find(
    (row) =>
      normalizeSupplierName(row.supplier) === supplier &&
      normalizeInvoiceNo(row.invoiceNo) === invoiceNo
  );
  if (!duplicate) return res.json({ duplicate: false });
  res.json({
    duplicate: true,
    supplierInvoiceId: duplicate.id,
    invoiceNo: duplicate.invoiceNo,
    supplier: duplicate.supplier,
    createdAt: duplicate.createdAt,
  });
});

app.get("/r/:id", (req, res) => {
  res.sendFile(path.join(ROOT, "report", "index.html"));
});

app.get("/b/:id", (_req, res) => {
  res.sendFile(path.join(ROOT, "billing", "index.html"));
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "Photo is too large (max 6 MB)." });
  }
  const status = Number(err.status) >= 400 ? Number(err.status) : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || "Server error" });
});

function lanIPv4s() {
  try {
    const os = require("os");
    const nets = os.networkInterfaces();
    const ips = [];
    for (const list of Object.values(nets)) {
      for (const net of list || []) {
        if (net.family === "IPv4" && !net.internal) ips.push(net.address);
      }
    }
    return ips;
  } catch {
    return [];
  }
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Deane Auto Repairs running at http://localhost:${PORT}`);
  if (isProduction()) {
    console.log(`Public URL: ${PUBLIC_BASE_URL || "(set PUBLIC_BASE_URL)"}`);
    console.log(`Data dir: ${DATA_DIR}`);
  } else {
    console.log(`Admin (this PC): http://localhost:${PORT}/admin/`);
    const ips = lanIPv4s().filter(
      (ip) => !ip.startsWith("169.254.") && !ip.startsWith("172.22.")
    );
    if (ips.length) {
      console.log("Admin (phone, same Wi-Fi):");
      for (const ip of ips) {
        console.log(`  http://${ip}:${PORT}/admin/`);
      }
    } else {
      console.log("Admin (phone): use this PC's Wi-Fi IPv4 from ipconfig, port " + PORT);
    }
    console.log("Admin PIN: set in .env (ADMIN_PIN)");
  }
  console.log(
    SITE_PIN
      ? "Site lock: ON (SITE_PIN set — public website requires preview PIN)"
      : "Site lock: OFF (set SITE_PIN to lock the public website while unfinished)"
  );
  console.log(
    smtpConfigured()
      ? `Email: SMTP ready (from ${MAIL_FROM})`
      : "Email: not configured — copy .env.example to .env and add Gmail App Password"
  );
  console.log(
    websms.websmsConfigured()
      ? `WebSMS: ready${String(process.env.WEBSMS_SANDBOX || "").toLowerCase() === "true" ? " (sandbox)" : ""}`
      : "WebSMS: not configured — add WEBSMS_CLIENT_ID / WEBSMS_CLIENT_SECRET for SMS reminders"
  );
  driveBackup.startBackupScheduler({ dataDir: DATA_DIR, uploadsDir: UPLOADS_DIR });
});
