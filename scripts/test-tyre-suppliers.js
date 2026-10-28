/**
 * Check the supplier logins in .env: logs in to each supplier, downloads the
 * price list and prints row counts only. Nothing is saved.
 *   node scripts/test-tyre-suppliers.js            (all suppliers with a login)
 *   node scripts/test-tyre-suppliers.js Wing       (one supplier)
 */
require("dotenv").config({ quiet: true });
const { SUPPLIERS, fetchAllSuppliers, supplierStatus } = require("../data/tyre-suppliers");

(async () => {
  const only = process.argv[2];
  const env = { ...process.env };
  for (const s of SUPPLIERS) {
    if (only && s.name.toLowerCase() !== only.toLowerCase()) delete env[s.userEnv];
  }
  for (const s of supplierStatus(env)) console.log(`${s.supplier}: ${s.configured ? "login saved" : "no login"}`);
  const results = await fetchAllSuppliers(env, (msg) => console.log(msg));
  for (const r of results) {
    if (!r.rows) continue;
    const sample = r.rows.find((x) => x.size === "205/55R16") || r.rows[0];
    console.log(`${r.supplier} sample: ${sample.size} ${sample.brand} ${sample.pattern} cost $${sample.cost_ex} stock ${sample.stock}`);
  }
  process.exit(results.some((r) => r.error) ? 1 : 0);
})();
