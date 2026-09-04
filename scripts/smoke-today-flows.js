/**
 * Smoke tests for 30 Aug 2026 flows:
 * - Customer plate uniqueness / same email OK
 * - Customer list contact save (saved profile wins)
 * - Booking YES → confirmed, NO → needs_reschedule
 * - SMS inbox handleResult
 *
 * Usage: node scripts/smoke-today-flows.js
 * Uses a temp DATA_DIR + ephemeral server (does not touch live workshop data).
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { todayIso, plusDays } = require("../data/nz-time");
const appointmentsLib = require("../data/appointments");
const bookingRequestsLib = require("../data/booking-requests");
const driveBackup = require("../data/drive-backup");
const websms = require("../data/websms");

const ROOT = path.join(__dirname, "..");
const ADMIN_PIN = "smoke-test-pin-20260830";
const PORT = 5199;

const results = [];
function pass(name) {
  results.push({ name, ok: true });
  console.log(`  ✓ ${name}`);
}
function fail(name, err) {
  results.push({ name, ok: false, err: err?.message || String(err) });
  console.error(`  ✗ ${name}`);
  console.error(`    ${err?.message || err}`);
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

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
    await sleep(200);
  }
  throw new Error(`Server did not become ready at ${base}`);
}

function unitTests() {
  console.log("\nUnit checks");

  try {
    assert.equal(websms.normalizeNzMobile("0211234567"), "64211234567");
    assert.equal(websms.normalizeNzMobile("+64 21 123 4567"), "64211234567");
    assert.equal(websms.normalizeNzMobile("09 123 4567"), "");
    pass("websms.normalizeNzMobile NZ mobiles");
  } catch (err) {
    fail("websms.normalizeNzMobile NZ mobiles", err);
  }

  try {
    const ids = appointmentsLib.APPOINTMENT_STATUSES.map((s) => s.id);
    assert.ok(ids.includes("confirmed"));
    assert.ok(ids.includes("needs_reschedule"));
    const row = appointmentsLib.normalizeAppointment({
      status: "needs_reschedule",
      date: "2026-09-01",
      startTime: "9:00",
    });
    assert.equal(row.status, "needs_reschedule");
    assert.equal(row.startTime, "09:00");
    pass("appointment status needs_reschedule normalizes");
  } catch (err) {
    fail("appointment status needs_reschedule normalizes", err);
  }

  try {
    const bad = appointmentsLib.normalizeAppointment({ status: "bogus" });
    assert.equal(bad.status, "booked");
    pass("unknown appointment status falls back to booked");
  } catch (err) {
    fail("unknown appointment status falls back to booked", err);
  }

  try {
    const row = bookingRequestsLib.normalizeBookingRequest({
      name: "Jane",
      preferred_date: "—",
      preferred_time: "Morning drop-off",
      help: "WOF",
      notes: "—",
    });
    assert.equal(row.name, "Jane");
    assert.equal(row.preferredDate, "");
    assert.equal(row.notes, "");
    assert.equal(row.helpWith, "WOF");
    assert.equal(row.handledAt, "");
    assert.equal(bookingRequestsLib.startTimeFromPreferred("Afternoon drop-off"), "13:00");
    assert.equal(bookingRequestsLib.startTimeFromPreferred("Morning drop-off"), "09:00");
    pass("website booking request normalizes blank dashes");
  } catch (err) {
    fail("website booking request normalizes blank dashes", err);
  }

  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deane-backup-"));
    fs.writeFileSync(path.join(dir, "jobs.json"), "[]");
    fs.writeFileSync(path.join(dir, "appointments.json"), "[]");
    fs.writeFileSync(path.join(dir, "jobs.json.bak"), "[]");
    fs.writeFileSync(path.join(dir, "google-service-account.json"), "{}");
    fs.writeFileSync(path.join(dir, "notes.txt"), "no");
    const names = driveBackup.listWorkshopDataFiles(dir);
    assert.deepEqual(names, ["appointments.json", "jobs.json", "jobs.json.bak"]);
    fs.rmSync(dir, { recursive: true, force: true });
    pass("backup zip includes workshop json files");
  } catch (err) {
    fail("backup zip includes workshop json files", err);
  }
}

async function integrationTests(base, dataDir) {
  console.log("\nIntegration (temp server)");

  let cookie = "";
  const tomorrow = plusDays(todayIso(), 1);
  const today = todayIso();

  try {
    const login = await api(base, "", "POST", "/api/admin/login", { pin: ADMIN_PIN });
    assert.equal(login.res.status, 200, login.data?.error || login.text);
    const setCookies =
      typeof login.res.headers.getSetCookie === "function"
        ? login.res.headers.getSetCookie()
        : [login.res.headers.get("set-cookie")].filter(Boolean);
    cookie = parseCookie(setCookies);
    assert.ok(cookie, "missing admin cookie");
    pass("admin login");
  } catch (err) {
    fail("admin login", err);
    return;
  }

  try {
    const denied = await fetch(`${base}/api/admin/backup.zip`);
    assert.equal(denied.status, 401);
    const zipRes = await fetch(`${base}/api/admin/backup.zip`, {
      headers: { Cookie: cookie },
    });
    const buf = Buffer.from(await zipRes.arrayBuffer());
    assert.equal(zipRes.status, 200, `status ${zipRes.status}`);
    assert.equal(buf.slice(0, 2).toString(), "PK");
    pass("admin backup zip download");
  } catch (err) {
    fail("admin backup zip download", err);
  }

  try {
    const honeypot = await api(base, "", "POST", "/api/booking", {
      name: "Bot",
      email: "bot@example.com",
      phone: "0210000000",
      help_with: "WOF",
      _gotcha: "spam",
    });
    assert.equal(honeypot.res.status, 200, honeypot.data?.error || honeypot.text);
    const created = await api(base, "", "POST", "/api/booking", {
      name: "Smoke Booker",
      email: "booker.smoke@example.com",
      phone: "0219999888",
      vehicle: "Mazda 3",
      registration: "BK001",
      preferred_date: "2026-09-10",
      preferred_time: "Morning drop-off",
      help_with: "WOF",
      notes: "Squeaky brakes",
    });
    assert.equal(created.res.status, 200, created.data?.error || created.text);
    assert.ok(created.data?.id, "missing booking request id");
    const denied = await api(base, "", "GET", "/api/booking-requests");
    assert.equal(denied.res.status, 401);
    const list = await api(base, cookie, "GET", "/api/booking-requests");
    assert.equal(list.res.status, 200, list.data?.error || list.text);
    assert.equal(list.data.unseenCount, 1);
    assert.equal(list.data.unseen[0].name, "Smoke Booker");
    assert.equal(list.data.unseen[0].helpWith, "WOF");
    const ack = await api(base, cookie, "POST", `/api/booking-requests/${created.data.id}/ack`, {});
    assert.equal(ack.res.status, 200, ack.data?.error || ack.text);
    const afterAck = await api(base, cookie, "GET", "/api/booking-requests");
    assert.equal(afterAck.data.unseenCount, 0);
    assert.equal(afterAck.data.pendingCount, 1);
    const added = await api(base, cookie, "POST", `/api/booking-requests/${created.data.id}/added`, {});
    assert.equal(added.res.status, 200, added.data?.error || added.text);
    const afterAdded = await api(base, cookie, "GET", "/api/booking-requests");
    assert.equal(afterAdded.data.pendingCount, 0);
    assert.ok(afterAdded.data.recent[0].handledAt);
    const removed = await api(base, cookie, "DELETE", `/api/booking-requests/${created.data.id}`);
    assert.equal(removed.res.status, 200, removed.data?.error || removed.text);
    const afterDelete = await api(base, cookie, "GET", "/api/booking-requests");
    assert.equal(afterDelete.data.recent.length, 0);
    pass("website booking request saved and admin popup ack");
  } catch (err) {
    fail("website booking request saved and admin popup ack", err);
  }

  try {
    const bookPage = await fetch(`${base}/book`);
    const html = await bookPage.text();
    assert.equal(bookPage.status, 200, `status ${bookPage.status}`);
    assert.ok(html.includes("data-booking-form"), "missing booking form");
    assert.ok(html.includes('id="help"'), "missing service select");
    pass("poster booking page /book");
  } catch (err) {
    fail("poster booking page /book", err);
  }

  // --- Customers: same email OK, duplicate plate blocked ---
  let customerA = null;
  let customerB = null;
  try {
    const a = await api(base, cookie, "POST", "/api/customers", {
      customerName: "Smoke Alpha",
      customerPhone: "0211111001",
      customerEmail: "shared.smoke@example.com",
      vehicles: [{ registration: "SMK001", vehicle: "Toyota", wofExpiry: "2026-12-01" }],
    });
    assert.equal(a.res.status, 201, a.data?.error || a.text);
    customerA = a.data;

    const b = await api(base, cookie, "POST", "/api/customers", {
      customerName: "Smoke Beta",
      customerPhone: "0211111002",
      customerEmail: "shared.smoke@example.com",
      vehicles: [{ registration: "SMK002", vehicle: "Honda", wofExpiry: "2026-11-01" }],
    });
    assert.equal(b.res.status, 201, b.data?.error || b.text);
    customerB = b.data;
    pass("same email allowed on two customers (different plates)");
  } catch (err) {
    fail("same email allowed on two customers (different plates)", err);
  }

  try {
    const dup = await api(base, cookie, "POST", "/api/customers", {
      customerName: "Smoke Dup",
      customerPhone: "0211111003",
      customerEmail: "other.smoke@example.com",
      vehicles: [{ registration: "SMK001", vehicle: "Mazda" }],
    });
    assert.equal(dup.res.status, 400);
    assert.match(String(dup.data?.error || ""), /already on/i);
    pass("duplicate plate rejected");
  } catch (err) {
    fail("duplicate plate rejected", err);
  }

  try {
    const created = await api(base, cookie, "POST", "/api/billing", {
      preset: "standard",
      customerId: customerA.id,
      customerName: "Smoke Alpha",
      customerEmail: "shared.smoke@example.com",
      customerPhone: "0211111001",
      registration: "SMK001",
      vehicle: "Toyota",
    });
    assert.equal(created.res.status, 201, created.data?.error || created.text);
    const inv = created.data;
    assert.ok(inv.viewToken, "missing viewToken");
    assert.equal(inv.status, "draft");
    const denied = await api(base, "", "GET", `/api/billing/${inv.id}`);
    assert.equal(denied.res.status, 404);
    const preview = await api(
      base,
      "",
      "GET",
      `/api/billing/${inv.id}?v=${encodeURIComponent(inv.viewToken)}&preview=1`
    );
    assert.equal(preview.res.status, 200, preview.data?.error || preview.text);
    assert.equal(preview.data.number, inv.number);
    assert.equal(preview.data.kind, "invoice");
    pass("draft invoice preview URL with view token");
  } catch (err) {
    fail("draft invoice preview URL with view token", err);
  }

  try {
    const list = await api(base, cookie, "GET", "/api/customers");
    assert.equal(list.res.status, 200);
    const rows = list.data || [];
    const aRows = rows.filter((r) => r.customerId === customerA.id);
    assert.equal(aRows.length, 1, `expected one list row for A, got ${aRows.length}`);
    assert.equal(plateish(aRows[0].registration), "SMK001");
    pass("customer list one row per plate");
  } catch (err) {
    fail("customer list one row per plate", err);
  }

  // Contact-only save + billing must not overwrite name/phone
  try {
    const put = await api(base, cookie, "PUT", `/api/customers/${customerA.id}`, {
      customerName: "Smoke Alpha Updated",
      customerPhone: "0219999001",
      customerEmail: "alpha.updated@example.com",
      customerAddress: "63 Hayr Road",
      // omit vehicles → contact-only
    });
    assert.equal(put.res.status, 200, put.data?.error || put.text);

    // Seed a billing doc that would previously clobber the saved profile
    const billingFile = path.join(dataDir, "billing.json");
    fs.writeFileSync(
      billingFile,
      JSON.stringify(
        [
          {
            id: "bill-smoke-1",
            kind: "invoice",
            status: "sent",
            customerId: customerA.id,
            customerName: "OLD BILLING NAME",
            customerPhone: "0210000000",
            customerEmail: "old.billing@example.com",
            registration: "SMK001",
            vehicle: "Toyota",
            lines: [{ description: "Labour", qty: 1, unitPrice: 100 }],
            createdAt: `${tomorrow}T10:00:00+12:00`,
            updatedAt: `${tomorrow}T10:00:00+12:00`,
            sentAt: `${tomorrow}T10:00:00+12:00`,
          },
        ],
        null,
        2
      )
    );

    const list = await api(base, cookie, "GET", "/api/customers");
    const row = (list.data || []).find(
      (r) => r.customerId === customerA.id && plateish(r.registration) === "SMK001"
    );
    assert.ok(row, "list row missing after billing seed");
    assert.equal(row.customerName, "Smoke Alpha Updated");
    assert.equal(websms.normalizeNzMobile(row.customerPhone), "64219999001");
    assert.equal(row.customerEmail, "alpha.updated@example.com");
    pass("saved customer contact wins over billing on list");
  } catch (err) {
    fail("saved customer contact wins over billing on list", err);
  }

  // --- Appointments + YES/NO webhook ---
  let apptYes = null;
  let apptNo = null;
  let apptAmbiguousA = null;
  let apptAmbiguousB = null;
  let apptArrived = null;

  try {
    const created = await api(base, cookie, "POST", "/api/appointments", {
      date: tomorrow,
      startTime: "09:00",
      durationMinutes: 120,
      status: "booked",
      customerId: customerA.id,
      customerName: "Smoke Alpha Updated",
      customerPhone: "0218888001",
      registration: "SMK001",
      vehicle: "Toyota",
      workSummary: "Service",
    });
    assert.equal(created.res.status, 201, created.data?.error || created.text);
    apptYes = created.data;

    // Mark as SMS-sent without calling WebSMS
    const rows = readJson(path.join(dataDir, "appointments.json"));
    const idx = rows.findIndex((r) => r.id === apptYes.id);
    rows[idx].bookingSmsReminderSentAt = `${today}T08:00:00+12:00`;
    rows[idx].customerPhone = "0218888001";
    writeJson(path.join(dataDir, "appointments.json"), rows);
    // also seed outbound sms-log for replyTo matching later
    writeJson(path.join(dataDir, "sms-log.json"), [
      {
        id: "out-yes-1",
        direction: "out",
        kind: "booking_confirm",
        at: `${today}T08:00:00+12:00`,
        to: "64218888001",
        body: "Reply YES…",
        messageId: "msg-out-yes-1",
        appointmentId: apptYes.id,
        customerId: customerA.id,
        customerName: "Smoke Alpha Updated",
        registration: "SMK001",
        handled: false,
      },
    ]);
    pass("create tomorrow appointment + fake booking SMS sent");
  } catch (err) {
    fail("create tomorrow appointment + fake booking SMS sent", err);
  }

  try {
    const wh = await api(base, "", "POST", "/api/websms/webhook", {
      type: "SMS",
      from: "64218888001",
      body: "YES",
      messageId: "msg-in-yes-1",
      replyTo: "msg-out-yes-1",
    });
    assert.equal(wh.res.status, 200);
    await sleep(150);
    const rows = readJson(path.join(dataDir, "appointments.json"));
    const row = rows.find((r) => r.id === apptYes.id);
    assert.equal(row.status, "confirmed");
    assert.equal(row.bookingSmsReply, "yes");
    assert.match(row.notes || "", /YES/i);

    const inbox = await api(base, cookie, "GET", "/api/sms-inbox");
    const reply = (inbox.data || []).find((r) => r.messageId === "msg-in-yes-1");
    assert.ok(reply, "inbox missing YES reply");
    assert.equal(reply.handled, true);
    assert.match(String(reply.handleResult || ""), /yes.*confirmed/i);
    pass("YES reply → calendar confirmed + inbox handled");
  } catch (err) {
    fail("YES reply → calendar confirmed + inbox handled", err);
  }

  try {
    const created = await api(base, cookie, "POST", "/api/appointments", {
      date: tomorrow,
      startTime: "11:00",
      durationMinutes: 60,
      status: "confirmed",
      customerName: "Smoke No Person",
      customerPhone: "0218888002",
      registration: "SMKNO1",
      workSummary: "WOF",
    });
    assert.equal(created.res.status, 201, created.data?.error || created.text);
    apptNo = created.data;
    const rows = readJson(path.join(dataDir, "appointments.json"));
    const idx = rows.findIndex((r) => r.id === apptNo.id);
    rows[idx].bookingSmsReminderSentAt = `${today}T08:05:00+12:00`;
    writeJson(path.join(dataDir, "appointments.json"), rows);

    const wh = await api(base, "", "POST", "/api/websms/webhook", {
      type: "SMS",
      from: "0218888002",
      body: "no thanks",
      messageId: "msg-in-no-1",
    });
    assert.equal(wh.res.status, 200);
    await sleep(150);
    const after = readJson(path.join(dataDir, "appointments.json")).find((r) => r.id === apptNo.id);
    assert.equal(after.status, "needs_reschedule");
    assert.equal(after.bookingSmsReply, "no");
    pass("NO reply → Need reschedule");
  } catch (err) {
    fail("NO reply → Need reschedule", err);
  }

  try {
    // Re-confirm after NO
    const wh = await api(base, "", "POST", "/api/websms/webhook", {
      type: "SMS",
      from: "64218888002",
      body: "yes",
      messageId: "msg-in-yes-2",
    });
    assert.equal(wh.res.status, 200);
    await sleep(150);
    const after = readJson(path.join(dataDir, "appointments.json")).find((r) => r.id === apptNo.id);
    assert.equal(after.status, "confirmed");
    pass("YES after Need reschedule → confirmed again");
  } catch (err) {
    fail("YES after Need reschedule → confirmed again", err);
  }

  try {
    const wh = await api(base, "", "POST", "/api/websms/webhook", {
      type: "SMS",
      from: "64219999999",
      body: "YES",
      messageId: "msg-orphan-yes",
    });
    assert.equal(wh.res.status, 200);
    await sleep(150);
    const inbox = await api(base, cookie, "GET", "/api/sms-inbox");
    const reply = (inbox.data || []).find((r) => r.messageId === "msg-orphan-yes");
    assert.ok(reply);
    assert.equal(reply.handled, false);
    assert.equal(reply.handleResult, "no_match");
    pass("YES with no matching appointment stays unhandled");
  } catch (err) {
    fail("YES with no matching appointment stays unhandled", err);
  }

  try {
    const wh = await api(base, "", "POST", "/api/websms/webhook", {
      type: "SMS",
      from: "64218888001",
      body: "12/09/26 10am",
      messageId: "msg-wof-style",
    });
    assert.equal(wh.res.status, 200);
    await sleep(150);
    const inbox = await api(base, cookie, "GET", "/api/sms-inbox");
    const reply = (inbox.data || []).find((r) => r.messageId === "msg-wof-style");
    assert.equal(reply?.handleResult, "not_yes_no");
    const row = readJson(path.join(dataDir, "appointments.json")).find((r) => r.id === apptYes.id);
    assert.equal(row.status, "confirmed", "WOF-style reply must not change status");
    pass("date-style reply does not auto-confirm");
  } catch (err) {
    fail("date-style reply does not auto-confirm", err);
  }

  // Ambiguous: two future SMS-eligible appts same phone → should pick earliest tomorrow with SMS
  try {
    const a = await api(base, cookie, "POST", "/api/appointments", {
      date: tomorrow,
      startTime: "13:00",
      durationMinutes: 60,
      status: "booked",
      customerName: "Twin Slot",
      customerPhone: "0217777001",
      registration: "TWIN01",
    });
    const b = await api(base, cookie, "POST", "/api/appointments", {
      date: tomorrow,
      startTime: "15:00",
      durationMinutes: 60,
      status: "booked",
      customerName: "Twin Slot",
      customerPhone: "0217777001",
      registration: "TWIN02",
    });
    assert.equal(a.res.status, 201, a.data?.error || a.text);
    assert.equal(b.res.status, 201, b.data?.error || b.text);
    apptAmbiguousA = a.data;
    apptAmbiguousB = b.data;
    const rows = readJson(path.join(dataDir, "appointments.json"));
    for (const id of [apptAmbiguousA.id, apptAmbiguousB.id]) {
      const idx = rows.findIndex((r) => r.id === id);
      rows[idx].bookingSmsReminderSentAt = `${today}T09:00:00+12:00`;
    }
    writeJson(path.join(dataDir, "appointments.json"), rows);

    const wh = await api(base, "", "POST", "/api/websms/webhook", {
      type: "SMS",
      from: "0217777001",
      body: "YES",
      messageId: "msg-twin-yes",
    });
    assert.equal(wh.res.status, 200);
    await sleep(150);
    const after = readJson(path.join(dataDir, "appointments.json"));
    const ra = after.find((r) => r.id === apptAmbiguousA.id);
    const rb = after.find((r) => r.id === apptAmbiguousB.id);
    assert.equal(ra.status, "confirmed");
    assert.equal(rb.status, "booked", "later twin slot should stay booked");
    pass("two slots same phone → earliest SMS slot confirmed");
  } catch (err) {
    fail("two slots same phone → earliest SMS slot confirmed", err);
  }

  // Logic risk: arrived + NO should ideally not demote — probe current behaviour
  try {
    const created = await api(base, cookie, "POST", "/api/appointments", {
      date: tomorrow,
      startTime: "16:00",
      durationMinutes: 60,
      status: "arrived",
      customerName: "Arrived Car",
      customerPhone: "0216666001",
      registration: "ARR001",
    });
    assert.equal(created.res.status, 201, created.data?.error || created.text);
    apptArrived = created.data;
    const rows = readJson(path.join(dataDir, "appointments.json"));
    const idx = rows.findIndex((r) => r.id === apptArrived.id);
    rows[idx].bookingSmsReminderSentAt = `${today}T07:00:00+12:00`;
    writeJson(path.join(dataDir, "appointments.json"), rows);

    await api(base, "", "POST", "/api/websms/webhook", {
      type: "SMS",
      from: "0216666001",
      body: "NO",
      messageId: "msg-arrived-no",
    });
    await sleep(150);
    const after = readJson(path.join(dataDir, "appointments.json")).find(
      (r) => r.id === apptArrived.id
    );
    if (after.status === "needs_reschedule") {
      fail(
        "arrived + NO should not demote status",
        new Error(`status became ${after.status} (logic bug: late SMS demotes Arrived)`)
      );
    } else {
      assert.equal(after.status, "arrived");
      pass("arrived + NO does not demote status");
    }
  } catch (err) {
    fail("arrived + NO does not demote status", err);
  }

  // Booking SMS API without WebSMS keys
  try {
    const meta = await api(base, cookie, "GET", "/api/appointments/meta");
    assert.equal(meta.res.status, 200);
    assert.equal(meta.data.websmsConfigured, false);
    const remindAlt = await api(base, cookie, "POST", "/api/appointments/booking-sms-reminder", {
      appointmentId: apptYes.id,
    });
    assert.ok(
      remindAlt.res.status === 503 || remindAlt.res.status === 400,
      `unexpected ${remindAlt.res.status} ${JSON.stringify(remindAlt.data)}`
    );
    pass("booking SMS without WebSMS returns error (no crash)");
  } catch (err) {
    fail("booking SMS without WebSMS returns error (no crash)", err);
  }

  // Meta includes new status
  try {
    const meta = await api(base, cookie, "GET", "/api/appointments/meta");
    const ids = (meta.data?.statuses || []).map((s) => s.id);
    assert.ok(ids.includes("needs_reschedule"));
    pass("appointments meta exposes Need reschedule");
  } catch (err) {
    fail("appointments meta exposes Need reschedule", err);
  }
}

function plateish(v) {
  return String(v || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, rows) {
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
}

async function main() {
  console.log("Deane smoke — today's flows");
  unitTests();

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "deane-smoke-"));
  const emptyEnvFile = path.join(dataDir, ".env.smoke");
  fs.writeFileSync(emptyEnvFile, "# smoke harness — do not load workshop .env\n");

  const env = { ...process.env };
  // Prevent workshop .env from injecting WebSMS / Drive / SMTP into this child.
  for (const key of Object.keys(env)) {
    if (
      /^(WEBSMS_|SMTP_|GOOGLE_|GMAIL_|DRIVE_|MAIL_|SITE_PIN|ADMIN_PIN|DATA_DIR|UPLOADS_DIR|PUBLIC_BASE_URL|RENDER)/i.test(
        key
      )
    ) {
      delete env[key];
    }
  }
  Object.assign(env, {
    PORT: String(PORT),
    DATA_DIR: dataDir,
    UPLOADS_DIR: path.join(dataDir, "uploads"),
    ADMIN_PIN,
    SITE_PIN: "",
    DOTENV_CONFIG_PATH: emptyEnvFile,
    NODE_ENV: "test",
  });

  fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
  for (const name of [
    "appointments.json",
    "customers.json",
    "billing.json",
    "jobs.json",
    "reports.json",
    "sms-log.json",
    "sms-inbound.json",
  ]) {
    fs.writeFileSync(path.join(dataDir, name), "[]\n");
  }

  const base = `http://127.0.0.1:${PORT}`;
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverLog = "";
  child.stdout.on("data", (buf) => {
    serverLog += buf.toString();
  });
  child.stderr.on("data", (buf) => {
    serverLog += buf.toString();
  });

  try {
    await waitForServer(child, base);
    // Confirm health reports our temp data dir
    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    if (path.resolve(health.dataDir) !== path.resolve(dataDir)) {
      throw new Error(`DATA_DIR mismatch: ${health.dataDir} vs ${dataDir}`);
    }
    await integrationTests(base, dataDir);
  } catch (err) {
    fail("server startup / harness", err);
    console.error(serverLog.slice(-2500));
  } finally {
    child.kill("SIGTERM");
    await sleep(300);
    if (child.exitCode == null && child.kill) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("\nLogic / failures:");
    for (const row of failed) {
      console.log(`- ${row.name}: ${row.err}`);
    }
    process.exitCode = 1;
  } else {
    console.log("\nNo failures in covered flows.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
