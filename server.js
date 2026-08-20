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
const CUSTOMERS_FILE = path.join(DATA_DIR, "customers.json");
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
if (!fs.existsSync(REPORTS_FILE)) {
  fs.writeFileSync(REPORTS_FILE, "[]", "utf8");
}
if (!fs.existsSync(BILLING_FILE)) {
  fs.writeFileSync(BILLING_FILE, "[]", "utf8");
}
if (!fs.existsSync(CUSTOMERS_FILE)) {
  fs.writeFileSync(CUSTOMERS_FILE, "[]", "utf8");
}
if (!fs.existsSync(JOBS_FILE)) {
  fs.writeFileSync(JOBS_FILE, "[]", "utf8");
}

function readReports() {
  try {
    return JSON.parse(fs.readFileSync(REPORTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeReports(reports) {
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports, null, 2), "utf8");
}

function readBilling() {
  try {
    return JSON.parse(fs.readFileSync(BILLING_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeBilling(docs) {
  fs.writeFileSync(BILLING_FILE, JSON.stringify(docs, null, 2), "utf8");
}

function readSavedCustomers() {
  try {
    const rows = JSON.parse(fs.readFileSync(CUSTOMERS_FILE, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function readJobs() {
  try {
    const rows = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
    const jobs = Array.isArray(rows) ? rows : [];
    return ensureJobStatuses(jobs);
  } catch {
    return [];
  }
}

function ensureJobStatuses(jobs) {
  let changed = false;
  for (const job of jobs) {
    const next = jobsLib.normalizeJobStatus(job.status, job.parts);
    if (next !== job.status) {
      job.status = next;
      changed = true;
    }
  }
  if (changed) {
    try {
      writeJobs(jobs);
    } catch (err) {
      console.error("Could not migrate job statuses:", err);
    }
  }
  return jobs;
}

function writeJobs(jobs) {
  try {
    fs.mkdirSync(path.dirname(JOBS_FILE), { recursive: true });
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), "utf8");
  } catch (err) {
    console.error("Could not write jobs file:", err);
    const error = new Error(
      "Could not save job. On Render attach a disk at /data, then set DATA_DIR=/data."
    );
    error.status = 500;
    throw error;
  }
}

function nextJobCardNumber(jobs) {
  const year = new Date().getFullYear();
  const prefix = `JC-${year}-`;
  const nums = jobs
    .map((j) => j.number)
    .filter((n) => typeof n === "string" && n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
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
    if (!doc.quoteId) {
      return {
        error: "This invoice was not created from an accepted quote.",
        status: 400,
      };
    }
    const quote = docs.find((d) => d.id === doc.quoteId) || null;
    return { quote, invoice: doc, source: quote || doc };
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
  const invoice = doc.invoiceId ? docs.find((d) => d.id === doc.invoiceId) : null;
  return { quote: doc, invoice: invoice || null, source: doc };
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
  const directory = listCustomers();
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

function applyCustomerFieldsToJob(job, fields) {
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
    if (next && !String(job[key] || "").trim()) {
      job[key] = key === "registration" ? next.toUpperCase() : next;
      changed = true;
    }
  }
  if (changed) job.updatedAt = new Date().toISOString();
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
      if (applyCustomerFieldsToJob(existing, fields)) {
        jobs[index] = existing;
        writeJobs(jobs);
      }
      return { job: existing, created: false };
    }
  }

  const jobs = readJobs();
  const now = new Date().toISOString();
  const parts = jobsLib.partsFromQuoteLines(source.lines || quote?.lines || [], () =>
    randomUUID()
  );
  const job = {
    ...emptyJob(now),
    number: nextJobCardNumber(jobs),
    ...fields,
    workRequested: jobsLib.workRequestedFromQuote(quote || source),
    parts,
  };
  linkJobToBilling(docs, job, quote || null, invoice || null);
  jobs.push(job);
  writeJobs(jobs);
  return { job, created: true };
}

function unlinkJobFromBilling(jobId) {
  const docs = readBilling();
  let changed = false;
  for (const doc of docs) {
    if (doc.jobId === jobId) {
      doc.jobId = "";
      doc.updatedAt = new Date().toISOString();
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
    updatedAt: new Date().toISOString(),
  };
}

function writeSavedCustomers(rows) {
  try {
    fs.mkdirSync(path.dirname(CUSTOMERS_FILE), { recursive: true });
    fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(rows, null, 2), "utf8");
  } catch (err) {
    console.error("Could not write customers file:", err);
    const error = new Error(
      "Could not save customer. On Render attach a disk at /data, then set DATA_DIR=/data."
    );
    error.status = 500;
    throw error;
  }
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
    vehicles.push({
      id: row.id || randomUUID(),
      registration,
      vehicle: String(row?.vehicle || "").trim(),
    });
  }
  return vehicles;
}

function normalizeSavedCustomer(body, current = {}) {
  const customerName = String(body?.customerName ?? current.customerName ?? "").trim();
  const customerAddress = String(body?.customerAddress ?? current.customerAddress ?? "").trim();
  const customerPhone = String(body?.customerPhone ?? current.customerPhone ?? "").trim();
  const vehicles = normalizeVehicles(body || {}, current || {});
  if (!customerName) {
    const err = new Error("Customer name is required.");
    err.status = 400;
    throw err;
  }
  if (!vehicles.length) {
    const err = new Error("Add at least one registration / plate.");
    err.status = 400;
    throw err;
  }
  return {
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
    customerEmail: "",
    customerPhone: "",
    registration: "",
    registrations: [],
    vehicles: [],
    vehicle: "",
    wofExpiry: "",
    lastVisit: "",
    lastJobNumber: "",
    lastReportId: "",
    lastBillingId: "",
    customerAddress: "",
    customerId: "",
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
        };
      } else {
        vehicles.push({
          id: v.id || randomUUID(),
          registration: String(v.registration || "").toUpperCase(),
          vehicle: String(v.vehicle || "").trim(),
          wofExpiry: v.wofExpiry || "",
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
    };
    if (idx >= 0) vehicles[idx] = { ...vehicles[idx], ...nextVehicle };
    else vehicles.push(nextVehicle);
  }

  const registrations = vehicles.map((v) => v.registration).filter(Boolean);
  const bestWof = vehicles
    .map((v) => v.wofExpiry)
    .filter(Boolean)
    .sort()[0] || incoming.wofExpiry || cur.wofExpiry || "";

  map.set(key, {
    ...cur,
    customerName: incoming.customerName || cur.customerName || "",
    customerAddress: incoming.customerAddress || cur.customerAddress,
    customerEmail: incoming.customerEmail || cur.customerEmail,
    customerPhone: incoming.customerPhone || cur.customerPhone,
    vehicles,
    registrations,
    registration: registrations.join(", "),
    vehicle:
      (isNewerVisit && incoming.vehicle) || cur.vehicle || incoming.vehicle || "",
    wofExpiry: bestWof,
    lastVisit: incomingVisit >= (cur.lastVisit || "") ? incomingVisit : cur.lastVisit,
    lastJobNumber:
      isNewerVisit && incoming.lastJobNumber
        ? incoming.lastJobNumber
        : cur.lastJobNumber,
    lastReportId: incoming.lastReportId || cur.lastReportId,
    lastBillingId: incoming.lastBillingId || cur.lastBillingId,
    customerId: incoming.customerId || cur.customerId,
  });
}

function listCustomers() {
  const map = new Map();
  const plateOwner = new Map();

  for (const c of readSavedCustomers()) {
    const vehicles = normalizeVehicles(c, c);
    const key = `id:${c.id}`;
    for (const v of vehicles) {
      const pk = plateKey(v.registration);
      if (pk) plateOwner.set(pk, key);
    }
    mergeCustomer(map, {
      customerName: c.customerName,
      customerAddress: c.customerAddress,
      customerPhone: c.customerPhone,
      customerEmail: c.customerEmail || "",
      vehicles,
      registration: vehicles[0]?.registration || c.registration || "",
      vehicle: "",
      wofExpiry: "",
      lastVisit: "",
      lastJobNumber: "",
      lastReportId: "",
      lastBillingId: "",
      customerId: c.id,
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
      wofExpiry: "",
      lastVisit: (d.updatedAt || d.createdAt || "").slice(0, 10),
      lastJobNumber: d.number || "",
      lastReportId: "",
      lastBillingId: d.id,
    });
  }

  const rank = { overdue: 0, due_soon: 1, ok: 2, missing: 3 };
  return [...map.values()]
    .map((row) => {
      const hasReport = Boolean(row.lastReportId);
      const hasBilling = Boolean(row.lastBillingId);
      const canDelete = Boolean(row.customerId) && !hasReport && !hasBilling;
      return {
        ...row,
        ...wofMeta(row.wofExpiry),
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

function nextBillingNumber(docs, kind) {
  const year = new Date().getFullYear();
  const prefix = kind === "invoice" ? `INV-${year}-` : `Q-${year}-`;
  const nums = docs
    .filter((d) => d.kind === kind)
    .map((d) => d.number)
    .filter((n) => typeof n === "string" && n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

function newAcceptToken() {
  return randomBytes(24).toString("hex");
}

function plusDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    now.setDate(now.getDate() + days);
    return now.toISOString().slice(0, 10);
  }
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
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
    at: entry.at || new Date().toISOString(),
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
    at: doc.createdAt || new Date().toISOString(),
    type: "created",
    summary: doc.kind === "invoice" ? "Invoice created" : "Quote created",
    amount: totals.totalIncl,
  });
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
      depositNote: business.depositNote || "",
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
    doc.sentAt = new Date().toISOString();
  }
  doc.updatedAt = new Date().toISOString();
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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").slice(0, 8) || ".jpg";
    cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
});

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(
  "/admin",
  express.static(path.join(ROOT, "admin"), {
    etag: false,
    lastModified: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store");
    },
  })
);
app.use("/report", express.static(path.join(ROOT, "report")));
app.use("/billing", express.static(path.join(ROOT, "billing")));
app.use(express.static(ROOT, { index: "index.html" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    shop: business.name,
    dataDir: DATA_DIR,
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
    const now = new Date().toISOString();
    if (existing) {
      Object.assign(existing, fields, { updatedAt: now });
      writeSavedCustomers(rows);
      return res.json(existing);
    }
    const row = {
      id: randomUUID(),
      ...fields,
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
    rows[index] = {
      ...rows[index],
      ...fields,
      id: rows[index].id,
      createdAt: rows[index].createdAt,
      updatedAt: new Date().toISOString(),
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

  const vehicles = normalizeVehicles(customer, customer);
  const plates = new Set(vehicles.map((v) => plateKey(v.registration)).filter(Boolean));
  const name = String(customer.customerName || "").trim().toLowerCase();
  const email = String(customer.customerEmail || "").trim().toLowerCase();

  const hasReport = readReports().some((r) => {
    const plate = plateKey(r.registration);
    if (plate && plates.has(plate)) return true;
    if (email && String(r.customerEmail || "").trim().toLowerCase() === email) return true;
    return (
      name &&
      String(r.customerName || "").trim().toLowerCase() === name &&
      plate &&
      plates.has(plate)
    );
  });
  if (hasReport) {
    return res.status(400).json({
      error: "This customer has a service report. Delete is not available.",
    });
  }

  const hasBilling = readBilling().some((d) => {
    if (d.status === "void") return false;
    const plate = plateKey(d.registration);
    if (plate && plates.has(plate)) return true;
    if (email && String(d.customerEmail || "").trim().toLowerCase() === email) return true;
    return false;
  });
  if (hasBilling) {
    return res.status(400).json({
      error: "This customer has a quote or invoice. Delete is not available.",
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
  res.json(report);
});

app.post("/api/reports", requireAdmin, (req, res) => {
  const reports = readReports();
  const now = new Date().toISOString();
  const servicePackage = normalizePackage(req.body.servicePackage);
  let jobType = req.body.jobType || "standard_service";
  if (jobType === "full_service") jobType = "premium_service";
  if (jobType === "full_wof") jobType = "premium_wof";

  const report = {
    id: randomUUID(),
    jobNumber: nextJobNumber(reports),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    serviceDate: req.body.serviceDate || now.slice(0, 10),
    technicianName: req.body.technicianName || "",
    customerName: req.body.customerName || "",
    customerEmail: req.body.customerEmail || "",
    customerPhone: req.body.customerPhone || "",
    registration: (req.body.registration || "").toUpperCase(),
    vehicle: req.body.vehicle || "",
    odometer: req.body.odometer || "",
    vin: req.body.vin || "",
    jobType,
    servicePackage,
    customerConcern: req.body.customerConcern || "",
    checks: emptyChecks(servicePackage),
    actionsDone: {},
    actionsOther: "",
    oilSpec: "",
    oilFilter: "",
    wof: {
      performed: jobType.includes("wof"),
      result: "not_completed",
      expiry: "",
      reference: "",
      failNotes: "",
      repairsForPass: "",
      recheckRequired: false,
    },
    summary: "",
    nextServiceDue: "",
    technicianComments: "",
    vehiclePhoto: "",
  };

  reports.push(report);
  writeReports(reports);
  res.status(201).json(report);
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

  reports[index] = {
    ...current,
    ...body,
    id: current.id,
    jobNumber: current.jobNumber,
    createdAt: current.createdAt,
    servicePackage: nextPackage,
    checks,
    registration: (body.registration ?? current.registration).toUpperCase(),
    updatedAt: new Date().toISOString(),
  };

  writeReports(reports);
  res.json(reports[index]);
});

app.post("/api/reports/:id/publish", requireAdmin, (req, res) => {
  const reports = readReports();
  const index = reports.findIndex((r) => r.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Report not found" });

  reports[index].status = "published";
  reports[index].publishedAt = new Date().toISOString();
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
    let depositsOutstandingTotal = 0;
    let depositsOutstandingCount = 0;

    for (const doc of readBilling()) {
      if (doc.status === "void") continue;
      const totals = catalog.computeTotals(doc.lines || []);
      if (doc.kind === "quote" && doc.status === "sent") {
        quotesAwaiting += 1;
        quotesAwaitingTotal = catalog.round2(quotesAwaitingTotal + totals.totalIncl);
      }
      if (doc.kind === "invoice") {
        const payment = normalizeInvoicePayment(doc, {}, totals);
        if (payment.paymentStatus === "unpaid" && payment.balanceDue > 0) {
          invoicesUnpaidCount += 1;
          invoicesUnpaidTotal = catalog.round2(
            invoicesUnpaidTotal + payment.balanceDue
          );
        } else if (payment.paymentStatus === "deposit" && payment.balanceDue > 0) {
          depositsOutstandingCount += 1;
          depositsOutstandingTotal = catalog.round2(
            depositsOutstandingTotal + payment.balanceDue
          );
        }
      }
    }

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
      depositsOutstanding: {
        count: depositsOutstandingCount,
        totalIncl: depositsOutstandingTotal,
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

  const to = String(req.body?.to || "").trim();
  const name = String(req.body?.customerName || "there").trim() || "there";
  const registration = String(req.body?.registration || "").trim().toUpperCase();
  const vehicle = String(req.body?.vehicle || "").trim();
  const expiry = String(req.body?.wofExpiry || "").trim();
  if (!to) {
    return res.status(400).json({ error: "Customer email is missing." });
  }
  if (!expiry) {
    return res.status(400).json({ error: "Add a WOF expiry date on the service report first." });
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
    res.json({ ok: true, to, messageId: info.messageId });
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
    report.publishedAt = new Date().toISOString();
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

    report.lastEmailedAt = new Date().toISOString();
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
  reports[index].updatedAt = new Date().toISOString();
  writeReports(reports);
  res.json(reports[index]);
});

app.post(
  "/api/reports/:id/photo",
  requireAdmin,
  upload.single("photo"),
  (req, res) => {
    const reports = readReports();
    const index = reports.findIndex((r) => r.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Report not found" });
    if (!req.file) return res.status(400).json({ error: "No photo uploaded" });

    reports[index].vehiclePhoto = `/uploads/${req.file.filename}`;
    reports[index].updatedAt = new Date().toISOString();
    writeReports(reports);
    res.json(reports[index]);
  }
);

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
      return {
        id: d.id,
        kind: d.kind,
        number: d.number,
        status: d.status,
        preset: d.preset,
        customerName: d.customerName,
        customerEmail: d.customerEmail,
        registration: d.registration,
        vehicle: d.vehicle,
        totalIncl: totals.totalIncl,
        updatedAt: d.updatedAt,
        sentAt: d.sentAt,
        acceptedAt: d.acceptedAt,
        invoiceId: d.invoiceId || "",
        quoteId: d.quoteId || "",
        jobId: d.jobId || "",
        paymentStatus: payment?.paymentStatus || "",
        amountPaid: payment?.amountPaid ?? null,
        balanceDue: payment?.balanceDue ?? null,
      };
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json(docs);
});

app.post("/api/billing", requireAdmin, (req, res) => {
  const preset = catalog.presetById(req.body?.preset);
  if (!preset) {
    return res.status(400).json({ error: "Choose a package or custom quote." });
  }

  const docs = readBilling();
  const now = new Date().toISOString();
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
    customerName: req.body?.customerName || "",
    customerEmail: req.body?.customerEmail || "",
    customerPhone: req.body?.customerPhone || "",
    registration: String(req.body?.registration || "").toUpperCase(),
    vehicle: req.body?.vehicle || "",
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
  const tokenOk =
    doc.kind === "quote" && doc.acceptToken && token && token === doc.acceptToken;

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
  const locked = isLockedBilling(current);
  const nextLines = locked
    ? current.lines
    : normalizeLines(body.lines != null ? body.lines : current.lines);

  const next = {
    ...current,
    customerName: body.customerName != null ? String(body.customerName).trim() : current.customerName,
    customerEmail: body.customerEmail != null ? String(body.customerEmail).trim() : current.customerEmail,
    customerPhone: body.customerPhone != null ? String(body.customerPhone).trim() : current.customerPhone,
    registration: String(body.registration != null ? body.registration : current.registration).toUpperCase(),
    vehicle: body.vehicle != null ? String(body.vehicle).trim() : current.vehicle,
    odometer: body.odometer != null ? String(body.odometer).trim() : current.odometer,
    notes: body.notes != null ? String(body.notes) : current.notes,
    validUntil:
      current.kind === "quote" && body.validUntil != null
        ? String(body.validUntil)
        : current.validUntil,
    lines: nextLines,
    updatedAt: new Date().toISOString(),
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
      `Total (plus GST): $${money}\n\n` +
      `Please review and accept this quote before we start work:\n${url}\n\n` +
      (doc.validUntil ? `This quote is valid until ${doc.validUntil}.\n\n` : "") +
      `${business.paymentText()}\n\n` +
      `${business.fullAddress()}\n${business.phoneDisplay}\n${business.email}\n`;
    html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Here is your quote for <strong>${escapeHtml(vehicleBit)}</strong> — ${escapeHtml(doc.number)}.</p>
      <p>Total (plus GST): <strong>$${escapeHtml(money)}</strong></p>
      <p>Please review and accept this quote before we start work.</p>
      <p><a href="${escapeAttr(url)}" style="display:inline-block;background:#1565c0;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700;">Review &amp; accept quote</a></p>
      <p>Or open this link:<br/><a href="${escapeAttr(url)}">${escapeHtml(url)}</a></p>
      ${doc.validUntil ? `<p>This quote is valid until ${escapeHtml(doc.validUntil)}.</p>` : ""}
      <p><strong>How to pay</strong><br/>
      Bank account number: <strong>${escapeHtml(business.bankAccount)}</strong><br/>
      <span style="color:#5b6777;font-size:14px;">*${escapeHtml(business.depositNote)}</span></p>
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
      `Total (plus GST): $${money}\n\n` +
      `View / print your invoice:\n${url}\n\n` +
      `${business.paymentText()}\n\n` +
      `${business.fullAddress()}\n${business.phoneDisplay}\n${business.email}\n`;
    html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Here is your tax invoice for <strong>${escapeHtml(vehicleBit)}</strong> — ${escapeHtml(doc.number)}.</p>
      <p>Total (plus GST): <strong>$${escapeHtml(money)}</strong></p>
      <p><a href="${escapeAttr(url)}">View / print your invoice</a></p>
      <p><strong>How to pay</strong><br/>
      Bank account number: <strong>${escapeHtml(business.bankAccount)}</strong><br/>
      <span style="color:#5b6777;font-size:14px;">*${escapeHtml(business.depositNote)}</span></p>
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

    doc.lastEmailedAt = new Date().toISOString();
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
  if (quote.kind !== "quote") {
    const err = new Error("Only quotes convert to invoices.");
    err.status = 400;
    throw err;
  }
  if (quote.status === "invoiced" && quote.invoiceId) {
    return docs.find((d) => d.id === quote.invoiceId) || null;
  }
  if (quote.status === "void") {
    const err = new Error("This quote is no longer valid.");
    err.status = 400;
    throw err;
  }

  const lines = billableLines(quote.lines);
  if (!lines.length) {
    const err = new Error("Quote has no billable lines.");
    err.status = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const invoice = {
    id: randomUUID(),
    kind: "invoice",
    number: nextBillingNumber(docs, "invoice"),
    status: "draft",
    preset: quote.preset,
    createdAt: now,
    updatedAt: now,
    sentAt: "",
    acceptedAt: quote.acceptedAt || now,
    validUntil: "",
    customerName: quote.customerName,
    customerEmail: quote.customerEmail,
    customerPhone: quote.customerPhone,
    registration: quote.registration,
    vehicle: quote.vehicle,
    odometer: quote.odometer,
    notes: quote.notes,
    lines: lines.map((line) => ({ ...line, id: randomUUID() })),
    acceptToken: "",
    quoteId: quote.id,
    invoiceId: "",
    jobId: quote.jobId || "",
    lastEmailedAt: "",
    lastEmailedTo: "",
    history: [],
    ...emptyPaymentFields(),
  };
  appendHistory(invoice, {
    type: "created",
    summary: "Invoice created",
    detail: `From ${quote.number}`,
    amount: catalog.computeTotals(invoice.lines).totalIncl,
  });
  ensureHistory(quote);
  appendHistory(quote, {
    type: "invoiced",
    summary: "Converted to invoice",
    detail: invoice.number,
    amount: catalog.computeTotals(invoice.lines).totalIncl,
  });

  quote.status = "invoiced";
  quote.invoiceId = invoice.id;
  quote.updatedAt = now;
  docs.push(invoice);
  return invoice;
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
    `Total (plus GST): $${money}\n` +
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
      Total (plus GST): <strong>$${escapeHtml(money)}</strong><br/>
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
  doc.acceptedAt = new Date().toISOString();
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
    const invoice = convertQuoteToInvoice(docs, quote);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    writeBilling(docs);
    res.status(quote.status === "invoiced" ? 200 : 201).json(withBillingTotals(invoice, true));
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

  const now = new Date().toISOString();
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
  docs[index].voidedAt = new Date().toISOString();
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

app.post("/api/jobs", requireAdmin, (req, res) => {
  try {
    const jobs = readJobs();
    const now = new Date().toISOString();
    const job = applyJobFields(
      {
        ...emptyJob(now),
        number: nextJobCardNumber(jobs),
      },
      req.body || {}
    );
    jobs.push(job);
    writeJobs(jobs);
    res.status(201).json(job);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
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
    if (ensured.created) writeBilling(docs);
    res.status(ensured.created ? 201 : 200).json(ensured.job);
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
    if (applyCustomerFieldsToJob(job, fields)) {
      jobs[index] = job;
      writeJobs(jobs);
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
});
