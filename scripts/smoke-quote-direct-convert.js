/**
 * Smoke: workshop can Convert draft quote → invoice without email Accept.
 * Usage: node scripts/smoke-quote-direct-convert.js
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const ADMIN_PIN = "smoke-convert-pin-20261104";
const PORT = 5201;

function parseCookie(headerList) {
  const list = Array.isArray(headerList) ? headerList : headerList ? [headerList] : [];
  const admin = list.find((c) => /^deane_admin=/i.test(String(c).split(";")[0]));
  const raw = admin || list[0];
  if (!raw) return "";
  return String(raw).split(";")[0];
}

async function api(base, cookie, method, urlPath, body) {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { res, data, text };
}

async function waitForServer(child, base, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode != null) {
      throw new Error(`Server exited early with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server did not become healthy in time");
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "deane-convert-"));
  const base = `http://127.0.0.1:${PORT}`;
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      ADMIN_PIN,
      DATA_DIR: dataDir,
      ADMIN_DEVICE_VERIFY: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (b) => {
    log += b.toString();
  });
  child.stderr.on("data", (b) => {
    log += b.toString();
  });

  try {
    await waitForServer(child, base);
    const login = await api(base, "", "POST", "/api/admin/login", { pin: ADMIN_PIN });
    assert.equal(login.res.status, 200, login.data?.error || login.text);
    const setCookies =
      typeof login.res.headers.getSetCookie === "function"
        ? login.res.headers.getSetCookie()
        : [login.res.headers.get("set-cookie")].filter(Boolean);
    const cookie = parseCookie(setCookies);
    assert.ok(cookie, "missing admin cookie");

    const cust = await api(base, cookie, "POST", "/api/customers", {
      customerName: "Convert Test",
      customerPhone: "0210000000",
      customerEmail: "convert-test@example.com",
      vehicles: [{ registration: "CVT001", vehicle: "Toyota Corolla" }],
    });
    assert.equal(cust.res.status, 201, cust.data?.error || cust.text);

    const quote = await api(base, cookie, "POST", "/api/billing", {
      preset: "custom",
      customerId: cust.data.id,
      customerName: "Convert Test",
      customerEmail: "convert-test@example.com",
      customerPhone: "0210000000",
      registration: "CVT001",
      vehicle: "Toyota Corolla",
      lines: [{ description: "Brake pads", qty: 1, unitPriceIncl: 120 }],
    });
    assert.equal(quote.res.status, 201, quote.data?.error || quote.text);
    assert.equal(quote.data.kind, "quote");
    assert.equal(quote.data.status, "draft");

    const inv = await api(base, cookie, "POST", `/api/billing/${quote.data.id}/convert`, {});
    assert.equal(inv.res.status, 200, inv.data?.error || inv.text);
    assert.equal(inv.data.kind, "invoice");
    assert.ok(inv.data.number, "missing invoice number");
    assert.equal(inv.data.quoteId, quote.data.id);

    const after = await api(base, cookie, "GET", `/api/billing/${quote.data.id}`);
    assert.equal(after.res.status, 200, after.data?.error || after.text);
    assert.equal(after.data.status, "invoiced");
    assert.equal(after.data.invoiceId, inv.data.id);

    console.log(`OK: draft ${quote.data.number} → invoice ${inv.data.number}`);
  } catch (err) {
    console.error(err);
    console.error("--- server log ---\n" + log.slice(-4000));
    process.exitCode = 1;
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    if (child.exitCode == null) child.kill("SIGKILL");
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main();
