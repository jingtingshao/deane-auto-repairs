/**
 * Push local workshop JSON onto the live Render disk.
 * Uses ADMIN_PIN from .env. Does not print secrets.
 *
 *   node scripts/restore-to-render.js
 */
require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const BASE = (
  process.env.RENDER_RESTORE_URL || "https://deane-auto-repairs.onrender.com"
).replace(/\/$/, "");
const PIN = String(process.env.ADMIN_PIN || "").trim();

function readJson(file, fallback) {
  const full = path.join(DATA, file);
  if (!fs.existsSync(full)) return fallback;
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

async function health() {
  const res = await fetch(`${BASE}/api/health`);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function restore(body) {
  const res = await fetch(`${BASE}/api/admin/restore-workshop`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Pin": PIN,
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
  const customers = readJson("customers.json", []);
  const billing = readJson("billing.json", []);
  const jobs = readJson("jobs.json", []);
  const reports = readJson("reports.json", []);
  const billingSeq = readJson("billing-seq.json", null);
  const customersSeq = readJson("customers-seq.json", null);
  if (!Array.isArray(customers) || !Array.isArray(billing)) {
    throw new Error("Local data files are not valid JSON arrays.");
  }
  console.log(`Target: ${BASE}`);
  console.log(
    `Local counts: customers ${customers.length}, billing ${billing.length}, jobs ${jobs.length}, reports ${reports.length}`
  );
  const live = await waitForRestoreEndpoint();
  console.log(`Render dataDir: ${live.dataDir}`);
  const result = await restore({
    replace: true,
    customers,
    billing,
    jobs,
    reports,
    billingSeq: billingSeq && typeof billingSeq === "object" ? billingSeq : undefined,
    customersSeq:
      customersSeq && typeof customersSeq === "object" ? customersSeq : undefined,
  });
  if (result.status === 401) {
    console.error("Render ADMIN_PIN does not match this PC. Set the same PIN in Render Environment, restart, then run this script again.");
    process.exit(1);
  }
  if (!result.data?.ok) {
    console.error("Restore failed:", result.status, result.data);
    process.exit(1);
  }
  console.log("Restored:", result.data.counts);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
