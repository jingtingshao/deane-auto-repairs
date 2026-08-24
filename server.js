require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
const { randomUUID, randomBytes } = require("crypto");
const {
  ACTIONS,
  STATUSES,
  normalizePackage,
  itemsForPackage,
  emptyChecks,
} = require("./data/checklist");
const business = require("./data/business");
const catalog = require("./data/catalog");
const jobsLib = require("./data/jobs");
const { buildBillingPdf, safeFilename } = require("./data/billing-pdf");
const { readJsonArray, writeJsonArray } = require("./data/json-store");
const { blockedStaticPath, safeUploadPath, UPLOAD_EXTS } = require("./data/static-guard");
const { todayIso, plusDays, nowIso, monthKey, shiftMonthKey, monthShortLabel, monthLongLabel } = require("./data/nz-time");
const driveBackup = require("./data/drive-backup");

const PORT = Number(process.env.PORT) || 5173;
const ADMIN_PIN = process.env.ADMIN_PIN || "deane123";
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
for (const file of [REPORTS_FILE, BILLING_FILE, CUSTOMERS_FILE, JOBS_FILE]) {
  if (!fs.existsSync(file)) writeJsonArray(file, []);
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
  if (id === "premium") return "premium_service";
  if (id === "standard") return "standard_service";
  return "repair";
}

function packageFromInvoice(invoice) {
  return String(invoice?.preset || "") === "premium" ? "premium" : "standard";
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

function summarizeJob(job) {
  const status = jobsLib.normalizeJobStatus(job.status, job.parts);
  const parts = jobsLib.partsSummary(job.parts);
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
    updatedAt: job.updatedAt,
    createdAt: job.createdAt,
  };
}

function billingSourceForJob(docs, id) {
  const doc = docs.find((d) => d.id === id);
  if (!doc) return { error: "Quote not found", status: 404 };
  if (doc.kind === "invoice") {
    if (doc.status === "void") {
      return { error: "This invoice has been voided.", status: 400 };
    }
    return { quote: doc, invoice: doc, source: doc };
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
  return { quote: doc, invoice: null, source: doc };
}

function linkJobToBilling(docs, job, quote, invoice) {
  if (quote) {
    quote.jobId = job.id;
    quote.updatedAt = job.updatedAt;
    job.quoteId = quote.id;
    job.quoteNumber = quote.number;
  }
  if (invoice) {
    invoice.jobId = job.id;
    invoice.updatedAt = job.updatedAt;
    job.invoiceId = invoice.id;
    job.invoiceNumber = invoice.number;
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
        return plates.some((p) => plateKey(p) === plate);
      }) || null;
  }
  if (!match && email) {
    match =
      directory.find(
        (row) => String(row.customerEmail || "").trim().toLowerCase() === email
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
    const value = key === "registration" ? next.toUpperCase() : next;
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
      let changed = applyCustomerFieldsToJob(existing, fields, true);
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
    createdAt: now,
    updatedAt: now,
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

  return {
    ...job,
    status,
    customerName:
      body.customerName != null ? String(body.customerName).trim() : job.customerName,
    customerEmail:
      body.customerEmail != null ? String(body.customerEmail).trim() : job.customerEmail,
    customerPhone:
      body.customerPhone != null ? String(body.customerPhone).trim() : job.customerPhone,
    registration: String(
      body.registration != null ? body.registration : job.registration
    )
      .trim()
      .toUpperCase(),
    vehicle: body.vehicle != null ? String(body.vehicle).trim() : job.vehicle,
    odometer: body.odometer != null ? String(body.odometer).trim() : job.odometer,
    workRequested:
      body.workRequested != null ? String(body.workRequested) : job.workRequested,
    technicianName:
      body.technicianName != null
        ? String(body.technicianName).trim()
        : job.technicianName,
    notes: body.notes != null ? String(body.notes) : job.notes,
    parts,
    updatedAt: nowIso(),
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
      vehicle: capitalizePersonName(String(row?.vehicle || prev?.vehicle || "").trim()),
      wofExpiry: String(row?.wofExpiry || prev?.wofExpiry || "").trim(),
      wofReminderSentAt: String(row?.wofReminderSentAt || prev?.wofReminderSentAt || "").trim(),
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

function capitalizePersonName(value) {
  return String(value || "").replace(
    /(^|[\s-])(\S)/g,
    (_, sep, ch) => sep + ch.toLocaleUpperCase("en-NZ")
  );
}

function namesFromCustomer(row = {}) {
  let firstName = String(row.firstName || "").trim();
  let lastName = String(row.lastName || "").trim();
  if (!firstName && !lastName) {
    const split = splitFullName(row.customerName);
    firstName = split.firstName;
    lastName = split.lastName;
  }
  firstName = capitalizePersonName(firstName);
  lastName = capitalizePersonName(lastName);
  return {
    firstName,
    lastName,
    customerName: composeCustomerName(firstName, lastName, row.customerName),
  };
}

function normalizeSavedCustomer(body, current = {}) {
  const fromBody = namesFromCustomer({
    firstName: body?.firstName ?? current.firstName,
    lastName: body?.lastName ?? current.lastName,
    customerName: body?.customerName ?? current.customerName,
  });
  const firstName = fromBody.firstName;
  const lastName = fromBody.lastName;
  const customerName = fromBody.customerName;
  const customerAddress = String(body?.customerAddress ?? current.customerAddress ?? "").trim();
  const customerPhone = String(body?.customerPhone ?? current.customerPhone ?? "").trim();
  const vehicles = normalizeVehicles(body || {}, current || {});
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

function customerRecordKey(item) {
  if (item.customerId) return `id:${item.customerId}`;
  const plate = plateKey(item.registration);
  if (plate) return `rego:${plate}`;
  const email = String(item.customerEmail || "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const name = String(item.customerName || "").trim().toLowerCase();
  const phone = String(item.customerPhone || "").replace(/\s+/g, "");
  if (name || phone) return `id:${name}|${phone}`;
  return "";
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

function mergeCustomer(map, incoming) {
  const key = customerRecordKey(incoming);
  if (!key) return;
  const cur = map.get(key) || {
    key,
    customerName: "",
    firstName: "",
    lastName: "",
    customerEmail: "",
    customerPhone: "",
    registration: "",
    registrations: [],
    vehicles: [],
    vehicle: "",
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
        };
      } else {
        vehicles.push({
          id: v.id || randomUUID(),
          registration: String(v.registration || "").toUpperCase(),
          vehicle: String(v.vehicle || "").trim(),
          wofExpiry: v.wofExpiry || "",
          wofReminderSentAt: v.wofReminderSentAt || "",
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
  map.set(key, {
    ...cur,
    firstName: names.firstName || curNames.firstName || "",
    lastName: names.lastName || curNames.lastName || "",
    customerName: names.customerName || curNames.customerName || "",
    customerAddress: incoming.customerAddress || cur.customerAddress,
    customerEmail: incoming.customerEmail || cur.customerEmail,
    customerPhone: incoming.customerPhone || cur.customerPhone,
    vehicles,
    registrations,
    registration: registrations.join(", "),
    vehicle:
      (isNewerVisit && incoming.vehicle) || cur.vehicle || incoming.vehicle || "",
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
    const key = `id:${c.id}`;
    for (const v of vehicles) {
      const pk = plateKey(v.registration);
      if (pk) plateOwner.set(pk, key);
    }
    const names = namesFromCustomer(c);
    mergeCustomer(map, {
      firstName: names.firstName,
      lastName: names.lastName,
      customerName: names.customerName,
      customerAddress: c.customerAddress,
      customerPhone: c.customerPhone,
      customerEmail: c.customerEmail || "",
      vehicles,
      registration: vehicles[0]?.registration || c.registration || "",
      vehicle: "",
      wofExpiry:
        vehicles.map((v) => v.wofExpiry).filter(Boolean).sort()[0] || c.wofExpiry || "",
      wofReminderSentAt: c.wofReminderSentAt || "",
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

  function mergeIncoming(incoming) {
    const pk = plateKey(incoming.registration);
    const owned = pk ? plateOwner.get(pk) : "";
    mergeCustomer(map, {
      ...incoming,
      customerId: owned ? owned.slice(3) : incoming.customerId || "",
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
      const seq = row.customerId ? Number(seqById.get(row.customerId)) || 0 : 0;
      return {
        ...row,
        ...wofMeta(row.wofExpiry),
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
  const vehicle =
    (vehicleId && vehicles.find((v) => v.id === vehicleId)) ||
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

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => ({
    id: line.id || randomUUID(),
    description: String(line.description || "").trim(),
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
  const paymentStatus = derivePaymentStatus(amountPaid, totalIncl);
  const last = payments[payments.length - 1];
  return {
    payments,
    paymentStatus,
    amountPaid,
    paidAt: last?.paidAt || "",
    paymentNote: last?.note || "",
    balanceDue: catalog.round2(Math.max(0, totalIncl - amountPaid)),
  };
}

function appendHistory(doc, entry = {}) {
  if (!doc || typeof doc !== "object") return;
  if (!Array.isArray(doc.history)) doc.history = [];
  doc.history.push({
    id: randomUUID(),
    at: entry.at || nowIso(),
    type: String(entry.type || "note"),
    summary: String(entry.summary || "").trim(),
    detail: String(entry.detail || "").trim(),
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

/** Customer quote opens — cooldown avoids refresh spam in History. */
const QUOTE_VIEW_COOLDOWN_MS = 30 * 60 * 1000;

function recordCustomerQuoteView(doc) {
  if (!doc || doc.kind !== "quote") return false;
  if (doc.status === "void" || doc.status === "draft") return false;

  ensureHistory(doc);
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
  appendHistory(doc, {
    at: iso,
    type: "viewed",
    summary:
      doc.viewCount === 1
        ? "Customer opened quote"
        : "Customer opened quote again",
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
      bankAccount: business.bankAccount || "",
      paymentTerms: Array.isArray(business.paymentTerms)
        ? [...business.paymentTerms]
        : [],
    },
  };
  if (payment) {
    payload.payments = payment.payments;
    payload.paymentStatus = payment.paymentStatus;
    payload.amountPaid = payment.amountPaid;
    payload.paidAt = payment.paidAt;
    payload.paymentNote = payment.paymentNote;
    payload.balanceDue = payment.balanceDue;
  }
  if (!isAdmin) {
    delete payload.acceptToken;
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
  if (doc.kind === "quote" && doc.acceptToken) {
    return `${origin}/b/${doc.id}?t=${encodeURIComponent(doc.acceptToken)}`;
  }
  return `${origin}/b/${doc.id}`;
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
  if (doc.status === "draft") {
    doc.status = "sent";
    doc.sentAt = nowIso();
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

function requireAdmin(req, res, next) {
  const pin = req.headers["x-admin-pin"] || req.query.pin;
  if (pin !== ADMIN_PIN) {
    return res.status(401).json({ error: "Invalid admin PIN" });
  }
  next();
}

const UPLOAD_MIME_EXT = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

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
    const mimeOk = Boolean(UPLOAD_MIME_EXT[file.mimetype]);
    const extOk = UPLOAD_EXTS.has(path.extname(file.originalname || "").toLowerCase());
    if (!mimeOk || !extOk) {
      const err = new Error("Please upload a JPEG, PNG, GIF, or WebP photo.");
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
app.use("/report", express.static(path.join(ROOT, "report"), { dotfiles: "deny" }));
app.use("/billing", express.static(path.join(ROOT, "billing"), { dotfiles: "deny" }));
app.use(express.static(ROOT, { index: "index.html", dotfiles: "deny" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    shop: business.name,
    dataDir: DATA_DIR,
    restoreWorkshop: true,
  });
});

app.post("/api/booking", async (req, res) => {
  if (!smtpConfigured()) {
    return res.status(503).json({
      error: "Booking email is not configured. Please call 0800 625 9827.",
    });
  }

  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim();
  const phone = String(req.body?.phone || "").trim();
  const vehicle = String(req.body?.vehicle || "").trim();
  const registration = String(req.body?.registration || req.body?.rego || "").trim();
  const preferredDate = String(req.body?.preferred_date || req.body?.date || "").trim();
  const preferredTime = String(req.body?.preferred_time || req.body?.time || "").trim();
  const helpWith = String(req.body?.help_with || req.body?.help || "").trim();
  const notes = String(req.body?.notes || "").trim();

  if (!name || !email || !phone || !helpWith) {
    return res.status(400).json({ error: "Name, email, phone and service type are required." });
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

  try {
    const mailer = createMailer();
    await mailer.sendMail({
      from: MAIL_FROM,
      to: business.email,
      replyTo: email,
      subject,
      text,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Booking email failed:", err);
    res.status(502).json({
      error: "Could not send the enquiry. Please call 0800 625 9827.",
    });
  }
});

app.get("/api/checklist", (req, res) => {
  const pkg = normalizePackage(req.query.package);
  res.json({
    package: pkg,
    statuses: STATUSES,
    groups: itemsForPackage(pkg),
    actions: {
      standard: ACTIONS.standard,
      premiumExtra: pkg === "premium" ? ACTIONS.premiumExtra : [],
      fullExtra: pkg === "premium" ? ACTIONS.premiumExtra : [],
      either: ACTIONS.either,
    },
  });
});

app.post("/api/admin/login", (req, res) => {
  if (req.body?.pin !== ADMIN_PIN) {
    return res.status(401).json({ error: "Wrong PIN" });
  }
  res.json({ ok: true });
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
    const plates = new Set(fields.vehicles.map((v) => plateKey(v.registration)));
    const existing = rows.find((c) => {
      const vehicles = normalizeVehicles(c, c);
      return vehicles.some((v) => plates.has(plateKey(v.registration)));
    });
    const sameName = findCustomerWithSameName(rows, fields.customerName, existing?.id);
    if (sameName) {
      const err = new Error(
        `A customer named ${fields.customerName} already exists. Open that record instead.`
      );
      err.status = 400;
      throw err;
    }
    const now = nowIso();
    if (existing) {
      Object.assign(existing, fields, { updatedAt: now });
      writeSavedCustomers(rows);
      return res.json(existing);
    }
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
    const fields = normalizeSavedCustomer(req.body, rows[index]);
    const sameName = findCustomerWithSameName(rows, fields.customerName, rows[index].id);
    if (sameName) {
      const err = new Error(
        `A customer named ${fields.customerName} already exists. Use a different name.`
      );
      err.status = 400;
      throw err;
    }
    rows[index] = {
      ...rows[index],
      ...fields,
      id: rows[index].id,
      createdAt: rows[index].createdAt,
      dailySeq: rows[index].dailySeq,
      customerSeq: rows[index].customerSeq || rows[index].dailySeq,
      dailySeqDate: rows[index].dailySeqDate,
      updatedAt: nowIso(),
    };
    writeSavedCustomers(rows);
    res.json(rows[index]);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.delete("/api/customers/:id", requireAdmin, (req, res) => {
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

app.get("/api/reports/:id", (req, res) => {
  const report = readReports().find((r) => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: "Report not found" });

  const isAdmin = (req.headers["x-admin-pin"] || req.query.pin) === ADMIN_PIN;
  if (report.status !== "published" && !isAdmin) {
    return res.status(404).json({ error: "Report not found" });
  }
  res.json(withReportPhotos(report));
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
    for (const code of Object.keys(fresh)) {
      if (checks[code]) fresh[code] = checks[code];
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
  writeReports(reports);
  res.json(reports[index]);
});

app.get("/api/admin/email-status", requireAdmin, (_req, res) => {
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
  });
});

app.get("/api/admin/backup-status", requireAdmin, (_req, res) => {
  res.json(driveBackup.publicStatus(DATA_DIR));
});

app.post("/api/admin/backup", requireAdmin, async (_req, res) => {
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

app.post("/api/admin/restore-workshop", requireAdmin, (req, res) => {
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
    res.json({
      ok: true,
      dataDir: DATA_DIR,
      counts: {
        customers: customers.length,
        billing: billing.length,
        jobs: jobs.length,
        reports: reports.length,
      },
    });
  } catch (err) {
    console.error("Workshop restore failed:", err);
    res.status(err.status || 500).json({ error: err.message || "Restore failed" });
  }
});

app.get("/api/admin/dashboard", requireAdmin, (_req, res) => {
  try {
    const jobs = readJobs();
    const jobCounts = {
      waiting_parts: 0,
      in_progress: 0,
      completed: 0,
    };
    for (const job of jobs) {
      const status = jobsLib.normalizeJobStatus(job.status, job.parts || []);
      if (jobCounts[status] != null) jobCounts[status] += 1;
    }
    const jobTotal =
      jobCounts.waiting_parts + jobCounts.in_progress + jobCounts.completed;

    let quotesAwaiting = 0;
    let quotesAwaitingTotal = 0;
    let invoicesUnpaidTotal = 0;
    let invoicesUnpaidCount = 0;
    let invoicesOverdueTotal = 0;
    let invoicesOverdueCount = 0;

    const monthBuckets = new Map();
    const thisMonthKey = monthKey();
    for (let i = 5; i >= 0; i -= 1) {
      const key = shiftMonthKey(thisMonthKey, -i);
      monthBuckets.set(key, {
        key,
        label: monthShortLabel(key),
        year: Number(key.slice(0, 4)),
        sales: 0,
        outstanding: 0,
      });
    }

    for (const doc of readBilling()) {
      if (doc.status === "void") continue;
      const totals = catalog.computeTotals(doc.lines || []);
      if (doc.kind === "quote" && doc.status === "sent") {
        quotesAwaiting += 1;
        quotesAwaitingTotal = catalog.round2(quotesAwaitingTotal + totals.totalIncl);
      }
      if (doc.kind === "invoice") {
        const payment = normalizeInvoicePayment(doc, {}, totals);
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

        const anchor = billingAnchorDate(doc);
        const docMonthKey = anchor ? monthKey(new Date(anchor)) : "";
        const bucket = monthBuckets.get(docMonthKey);
        if (bucket) {
          bucket.sales = catalog.round2(bucket.sales + totals.totalIncl);
          if (payment.balanceDue > 0) {
            bucket.outstanding = catalog.round2(
              bucket.outstanding + payment.balanceDue
            );
          }
        }
      }
    }

    let servicesThisMonth = 0;
    let wofsThisMonth = 0;
    for (const report of readReports()) {
      if (report.status === "void") continue;
      const day = String(report.serviceDate || report.createdAt || "").slice(0, 10);
      if (!day.startsWith(thisMonthKey)) continue;
      const jobType = String(report.jobType || "").toLowerCase();
      const pkg = String(report.servicePackage || "").toLowerCase();
      const isService =
        /service/.test(jobType) || pkg === "standard" || pkg === "premium";
      const isWof =
        /wof/.test(jobType) || Boolean(report.wof && report.wof.performed);
      if (isService) servicesThisMonth += 1;
      if (isWof) wofsThisMonth += 1;
    }

    const monthly = [...monthBuckets.values()];
    const thisMonthLabel = monthLongLabel(thisMonthKey);

    res.json({
      jobs: {
        total: jobTotal,
        waiting_parts: jobCounts.waiting_parts,
        in_progress: jobCounts.in_progress,
        completed: jobCounts.completed,
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
      monthly,
      thisMonth: {
        key: thisMonthKey,
        label: thisMonthLabel,
        services: servicesThisMonth,
        wofs: wofsThisMonth,
      },
    });
  } catch (err) {
    console.error("Dashboard failed:", err);
    res.status(500).json({ error: "Could not load dashboard." });
  }
});

app.post("/api/customers/wof-reminder", requireAdmin, async (req, res) => {
  if (!smtpConfigured()) {
    return res.status(503).json({
      error:
        "Email not configured. On Render go to Settings → Environment and add SMTP_HOST, SMTP_USER, SMTP_PASS, then save.",
    });
  }

  const customerId = String(req.body?.customerId || "").trim();
  const rows = readSavedCustomers();
  const customer = customerId ? rows.find((c) => c.id === customerId) : null;
  if (!customer) {
    return res.status(400).json({ error: "Open a saved customer first." });
  }

  const names = namesFromCustomer(customer);
  const vehicles = normalizeVehicles(customer, customer);
  const expiry =
    vehicles.map((v) => v.wofExpiry).filter(Boolean).sort()[0] ||
    String(customer.wofExpiry || req.body?.wofExpiry || "").trim();
  const meta = wofMeta(expiry);
  if (meta.wofStatus !== "due_soon") {
    return res.status(400).json({
      error: "Email reminder is only for customers whose WOF expires in the next 30 days.",
    });
  }
  if (customer.wofReminderSentAt) {
    return res.json({
      ok: true,
      alreadySent: true,
      to: customer.customerEmail,
      sentAt: customer.wofReminderSentAt,
    });
  }

  const to = String(customer.customerEmail || req.body?.to || "").trim();
  const name = names.customerName || "there";
  const matchVehicle =
    vehicles.find((v) => v.wofExpiry === expiry) || vehicles[0] || {};
  const registration = String(matchVehicle.registration || "").trim().toUpperCase();
  const vehicle = String(matchVehicle.vehicle || "").trim();
  if (!to) {
    return res.status(400).json({ error: "Customer email is missing." });
  }

  const vehicleBit = `${vehicle || "your vehicle"}${registration ? ` (${registration})` : ""}`;
  const site = PUBLIC_BASE_URL || business.website;
  const subject = `WOF reminder for ${registration || vehicle || "your vehicle"} — ${business.name}`;
  const text =
    `Hi ${name},\n\n` +
    `This is a reminder from ${business.name} that the WOF for ${vehicleBit} expires on ${expiry}.\n\n` +
    `Book a WOF with us:\n` +
    `Phone ${business.phoneDisplay}\n` +
    `${business.email}\n` +
    `${business.fullAddress()}\n` +
    `${business.hoursShort}; ${business.hoursSunday}\n` +
    (site ? `\nWebsite: ${site}\n` : "") +
    `\nThank you,\n${business.name}\n`;
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>This is a reminder from <strong>${escapeHtml(business.name)}</strong> that the WOF for <strong>${escapeHtml(vehicleBit)}</strong> expires on <strong>${escapeHtml(expiry)}</strong>.</p>
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
    const info = await mailer.sendMail({
      from: MAIL_FROM,
      to,
      replyTo: process.env.SMTP_USER || MAIL_FROM,
      subject,
      text,
      html,
    });
    const sentAt = nowIso();
    customer.wofReminderSentAt = sentAt;
    const plate = plateKey(registration);
    for (const v of vehicles) {
      if (!plate || plateKey(v.registration) === plate) {
        v.wofReminderSentAt = sentAt;
        if (plate) break;
      }
    }
    customer.vehicles = vehicles;
    customer.updatedAt = sentAt;
    writeSavedCustomers(rows);
    res.json({ ok: true, to, sentAt });
  } catch (err) {
    console.error("WOF reminder email failed:", err);
    res.status(502).json({
      error: err.response || err.message || "Failed to send email. Check SMTP settings.",
    });
  }
});

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
    writeReports(reports);
  }

  const origin =
    PUBLIC_BASE_URL ||
    String(req.body?.baseUrl || "").replace(/\/$/, "") ||
    `${req.protocol}://${req.get("host")}`;
  const url = `${origin}/r/${report.id}`;
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
    <p style="color:#5b6777;font-size:14px;">
      ${escapeHtml(business.name)}<br/>
      ${escapeHtml(business.addressLine2)}<br/>
      ${escapeHtml(business.street)}<br/>
      ${escapeHtml(business.suburb)}, ${escapeHtml(business.city)}<br/>
      ${escapeHtml(business.phoneDisplay)}<br/>
      ${escapeHtml(business.email)}
    </p>
  `;

  try {
    const mailer = createMailer();
    const info = await mailer.sendMail({
      from: MAIL_FROM,
      to,
      replyTo: process.env.SMTP_USER || MAIL_FROM,
      subject,
      text,
      html,
    });

    report.lastEmailedAt = nowIso();
    report.lastEmailedTo = to;
    report.updatedAt = report.lastEmailedAt;
    writeReports(reports);

    res.json({
      ok: true,
      to,
      messageId: info.messageId,
      reportUrl: url,
      report,
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
    })),
    quickAdds: catalog.QUICK_ADDS,
    gstNumber: business.gstNumber || "",
  });
});

app.get("/api/billing", requireAdmin, (_req, res) => {
  const docs = readBilling()
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
        paymentStatus: payment?.paymentStatus || "",
        amountPaid: payment?.amountPaid ?? null,
        balanceDue: payment?.balanceDue ?? null,
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

  const docs = readBilling();
  const now = nowIso();
  const today = todayIso();
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
    validUntil: preset.kind === "quote" ? plusDays(today, catalog.QUOTE_VALID_DAYS) : "",
    customerId: "",
    vehicleId: "",
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    registration: "",
    vehicle: "",
    odometer: req.body?.odometer || "",
    notes: req.body?.notes || "",
    lines: catalog.cloneLines(preset.lines).map((line) => ({
      id: randomUUID(),
      ...line,
    })),
    acceptToken: preset.kind === "quote" ? newAcceptToken() : "",
    quoteId: "",
    invoiceId: "",
    jobId: "",
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
  if (doc.kind === "invoice") {
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

  const isAdmin = (req.headers["x-admin-pin"] || req.query.pin) === ADMIN_PIN;
  const token = String(req.query.t || "");
  const tokenOk = Boolean(doc.acceptToken && token && token === doc.acceptToken);

  if (!isAdmin) {
    if (doc.status === "void") return res.status(404).json({ error: "Not found" });
    if (doc.status === "draft" && !tokenOk) {
      return res.status(404).json({ error: "Not found" });
    }
  }

  if (isAdmin) {
    const before = Array.isArray(doc.history) ? doc.history.length : 0;
    ensureHistory(doc);
    if ((doc.history || []).length > before) writeBilling(docs);
  } else if (recordCustomerQuoteView(doc)) {
    docs[index] = doc;
    try {
      writeBilling(docs);
    } catch (err) {
      console.error("Could not save quote view:", err);
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

app.put("/api/billing/:id", requireAdmin, (req, res) => {
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
    notes: body.notes != null ? String(body.notes) : current.notes,
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
    const payment = normalizeInvoicePayment(next, body, catalog.computeTotals(nextLines));
    next.payments = payment.payments;
    next.paymentStatus = payment.paymentStatus;
    next.amountPaid = payment.amountPaid;
    next.paidAt = payment.paidAt;
    next.paymentNote = payment.paymentNote;
  }

  if (!Array.isArray(next.history)) next.history = Array.isArray(current.history) ? [...current.history] : [];
  ensureHistory(next);

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
  res.json(withBillingTotals(docs[index], true));
});

app.post("/api/billing/:id/issue", requireAdmin, (req, res) => {
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

app.post("/api/billing/:id/email", requireAdmin, async (req, res) => {
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
      (doc.validUntil ? `This quote is valid until ${doc.validUntil}.\n\n` : "") +
      `${business.paymentText()}\n\n` +
      `${business.fullAddress()}\n${business.phoneDisplay}\n${business.email}\n`;
    html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Here is your quote for <strong>${escapeHtml(vehicleBit)}</strong> — ${escapeHtml(doc.number)}.</p>
      <p>Total incl. GST: <strong>$${escapeHtml(money)}</strong></p>
      <p>Please review and accept this quote before we start work.</p>
      <p><a href="${escapeAttr(url)}" style="display:inline-block;background:#1565c0;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700;">Review &amp; accept quote</a></p>
      <p>Or open this link:<br/><a href="${escapeAttr(url)}">${escapeHtml(url)}</a></p>
      <p>A PDF copy is attached for your records.</p>
      ${doc.validUntil ? `<p>This quote is valid until ${escapeHtml(doc.validUntil)}.</p>` : ""}
      <p><strong>How to pay</strong><br/>
      Bank account number: <strong>${escapeHtml(business.bankAccount)}</strong></p>
      <p><strong>Payment terms</strong></p>
      <ul style="margin:0.25rem 0 1rem;padding-left:1.2rem;color:#1a2332;font-size:14px;">
        ${(business.paymentTerms || [])
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join("")}
      </ul>
      <p style="color:#5b6777;font-size:14px;">
        ${escapeHtml(business.name)}<br/>
        ${escapeHtml(business.addressLine2)}<br/>
        ${escapeHtml(business.street)}<br/>
        ${escapeHtml(business.suburb)}, ${escapeHtml(business.city)}<br/>
        ${escapeHtml(business.phoneDisplay)}<br/>
        ${escapeHtml(business.email)}
      </p>
    `;
  } else {
    subject = `Tax Invoice ${doc.number} for ${rego || vehicle} — ${business.name}`;
    text =
      `Hi ${name},\n\n` +
      `Here is your tax invoice for ${vehicleBit}: ${doc.number}.\n` +
      `Total incl. GST: $${money}\n\n` +
      `View / print your invoice:\n${url}\n\n` +
      `A PDF copy is attached for your records.\n\n` +
      `${business.paymentText()}\n\n` +
      `${business.fullAddress()}\n${business.phoneDisplay}\n${business.email}\n`;
    html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Here is your tax invoice for <strong>${escapeHtml(vehicleBit)}</strong> — ${escapeHtml(doc.number)}.</p>
      <p>Total incl. GST: <strong>$${escapeHtml(money)}</strong></p>
      <p><a href="${escapeAttr(url)}">View / print your invoice</a></p>
      <p>A PDF copy is attached for your records.</p>
      <p><strong>How to pay</strong><br/>
      Bank account number: <strong>${escapeHtml(business.bankAccount)}</strong></p>
      <p><strong>Payment terms</strong></p>
      <ul style="margin:0.25rem 0 1rem;padding-left:1.2rem;color:#1a2332;font-size:14px;">
        ${(business.paymentTerms || [])
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join("")}
      </ul>
      <p style="color:#5b6777;font-size:14px;">
        ${escapeHtml(business.name)}<br/>
        ${escapeHtml(business.addressLine2)}<br/>
        ${escapeHtml(business.street)}<br/>
        ${escapeHtml(business.suburb)}, ${escapeHtml(business.city)}<br/>
        ${escapeHtml(business.phoneDisplay)}<br/>
        ${escapeHtml(business.email)}
      </p>
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
      html,
      attachments: [pdfAttachment],
    });

    doc.lastEmailedAt = nowIso();
    doc.lastEmailedTo = to;
    doc.updatedAt = doc.lastEmailedAt;
    ensureHistory(doc);
    appendHistory(doc, {
      type: "sent",
      summary: wasResend
        ? doc.kind === "invoice"
          ? "Updated invoice sent to customer"
          : "Updated quote sent to customer"
        : doc.kind === "invoice"
          ? "Invoice emailed to customer"
          : "Quote emailed to customer",
      detail: to,
      amount: totals.totalIncl,
    });
    writeBilling(docs);

    res.json({
      ok: true,
      to,
      messageId: info.messageId,
      url,
      doc: withBillingTotals(doc, true),
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
      return existing;
    }
  }

  const now = nowIso();
  const previousNumber = quote.number;
  quote.kind = "invoice";
  quote.quotedNumber = quote.quotedNumber || previousNumber;
  quote.number = toInvoiceNumber(previousNumber);
  quote.lines = lines;
  quote.validUntil = "";
  quote.quoteId = quote.id;
  quote.invoiceId = quote.id;
  quote.updatedAt = now;
  if (!Array.isArray(quote.payments)) {
    Object.assign(quote, emptyPaymentFields());
  }
  ensureHistory(quote);
  appendHistory(quote, {
    type: "invoiced",
    summary: "Converted to invoice",
    detail: `${previousNumber} → ${quote.number}`,
    amount: catalog.computeTotals(quote.lines).totalIncl,
  });

  if (quote.jobId) {
    const jobs = readJobs();
    const job = jobs.find((j) => j.id === quote.jobId);
    if (job) {
      job.invoiceId = quote.id;
      job.invoiceNumber = quote.number;
      job.quoteId = quote.id;
      job.quoteNumber = quote.quotedNumber || previousNumber;
      const preferred = jobNumberFromBilling(quote.number);
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
    syncJobFromInvoiceExtras(docs, quote);
  } catch (err) {
    console.error("Could not add invoice extras to job card:", err);
  }
  return quote;
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
  const servicePackage = extra.servicePackage || "standard";
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
  const origin = publicOrigin(req, {});
  const quoteUrl = `${origin}/b/${quote.id}`;
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
    const ensured = ensureJobFromAcceptedQuote(docs, invoice || doc, invoice);
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
    jobNumber: job?.number || "",
  });
});

app.post("/api/billing/:id/convert", requireAdmin, (req, res) => {
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

app.post("/api/billing/:id/revise", requireAdmin, (req, res) => {
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

app.post("/api/billing/:id/void", requireAdmin, (req, res) => {
  const docs = readBilling();
  const index = docs.findIndex((d) => d.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Not found" });
  if (docs[index].status === "invoiced") {
    return res.status(400).json({ error: "This quote already has an invoice." });
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

app.delete("/api/billing/:id", requireAdmin, (req, res) => {
  const docs = readBilling();
  const doc = docs.find((d) => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: "Not found" });
  if (doc.status !== "draft") {
    return res.status(400).json({ error: "Only drafts can be deleted. Void it instead." });
  }
  writeBilling(docs.filter((d) => d.id !== req.params.id));
  res.json({ ok: true });
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
  res.json(job);
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
  if (process.env.NODE_ENV === "production") {
    console.log(`Public URL: ${PUBLIC_BASE_URL || "(set PUBLIC_BASE_URL)"}`);
    console.log(`Data dir: ${DATA_DIR}`);
    if (!process.env.ADMIN_PIN || process.env.ADMIN_PIN === "deane123") {
      console.warn("Set a strong ADMIN_PIN in production.");
    }
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
    console.log(`Admin PIN: ${ADMIN_PIN}`);
  }
  console.log(
    smtpConfigured()
      ? `Email: SMTP ready (from ${MAIL_FROM})`
      : "Email: not configured — copy .env.example to .env and add Gmail App Password"
  );
  driveBackup.startBackupScheduler({ dataDir: DATA_DIR, uploadsDir: UPLOADS_DIR });
});
