/**
 * Push local workshop JSON onto the live Render disk (or wipe if local is empty).
 * Uses ADMIN_PIN from .env to sign in. Does not print secrets.
 *
 *   node scripts/restore-to-render.js
 */
require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_CANDIDATES = [path.join(ROOT, "DATA"), path.join(ROOT, "data")];
const BASE = (
  process.env.RENDER_RESTORE_URL || "https://deane-auto-repairs.onrender.com"
).replace(/\/$/, "");
const PIN = String(process.env.ADMIN_PIN || "").trim();

function dataDir() {
  for (const dir of DATA_CANDIDATES) {
    if (fs.existsSync(path.join(dir, "customers.json"))) return dir;
  }
  return DATA_CANDIDATES[1];
}

function readJson(file, fallback) {
  const full = path.join(dataDir(), file);
  if (!fs.existsSync(full)) return fallback;
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

function cookieFromLogin(res) {
  const list =
    typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const header = list.length ? list.join(",") : String(res.headers.get("set-cookie") || "");
  const match = header.match(/deane_admin=([^;]+)/);
  return match ? `deane_admin=${match[1]}` : "";
}

async function health() {
  const res = await fetch(`${BASE}/api/health`);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function login() {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: PIN }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: cookieFromLogin(res) };
}

async function restore(cookie, body) {
  const res = await fetch(`${BASE}/api/admin/restore-workshop`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function waitForRestoreEndpoint() {
  for (let i = 1; i <= 40; i += 1) {
    const live = await health();
    if (live.data?.restoreWorkshop) return live.data;
    process.stdout.write(
      `Waiting for Render deploy (${i}/40) dataDir=${live.data?.dataDir || "?"}\n`
    );
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error("Render did not pick up the restore endpoint. Check the deploy log.");
}

async function main() {
  if (!PIN) {
    console.error("ADMIN_PIN missing in .env");
    process.exit(1);
  }
  const localRoot = dataDir();
  const customers = readJson("customers.json", []);
  const billing = readJson("billing.json", []);
  const jobs = readJson("jobs.json", []);
  const reports = readJson("reports.json", []);
  const appointments = readJson("appointments.json", []);
  const supplierInvoices = readJson("supplier-invoices.json", []);
  const invoiceCandidates = readJson("invoice-candidates.json", []);
  const partAuditLog = readJson("part-audit-log.json", []);
  const smsLog = readJson("sms-log.json", []);
  const smsInbound = readJson("sms-inbound.json", []);
  const billingSeq = readJson("billing-seq.json", null);
  const customersSeq = readJson("customers-seq.json", null);
  if (!Array.isArray(customers) || !Array.isArray(billing)) {
    throw new Error("Local data files are not valid JSON arrays.");
  }
  console.log(`Target: ${BASE}`);
  console.log(`Local data: ${localRoot}`);
  console.log(
    `Local counts: customers ${customers.length}, billing ${billing.length}, jobs ${jobs.length}, reports ${reports.length}, appointments ${appointments.length}, sms ${smsLog.length}`
  );
  const live = await waitForRestoreEndpoint();
  console.log(`Render dataDir: ${live.dataDir}`);
  const session = await login();
  if (session.status === 401 || session.status === 429) {
    console.error(
      "Could not sign in to Render. Set the same strong ADMIN_PIN in Render Environment, restart, then run this script again."
    );
    process.exit(1);
  }
  if (!session.cookie) {
    console.error("Sign-in did not return a session cookie.");
    process.exit(1);
  }
  const result = await restore(session.cookie, {
    replace: true,
    customers,
    billing,
    jobs,
    reports,
    appointments,
    supplierInvoices,
    invoiceCandidates,
    partAuditLog,
    smsLog,
    smsInbound,
    billingSeq: billingSeq && typeof billingSeq === "object" ? billingSeq : undefined,
    customersSeq:
      customersSeq && typeof customersSeq === "object" ? customersSeq : undefined,
  });
  if (result.status === 401) {
    console.error(
      "Restore was rejected. Sign in failed or the session expired. Try again."
    );
    process.exit(1);
  }
  if (!result.data?.ok) {
    console.error("Restore failed:", result.status, result.data);
    process.exit(1);
  }
  console.log("Restored / wiped:", result.data.counts);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
