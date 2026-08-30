/**
 * WebSMS Connexus API (NZ) — https://websms.co.nz/api/connexus/
 * Env: WEBSMS_CLIENT_ID, WEBSMS_CLIENT_SECRET; optional WEBSMS_FROM, WEBSMS_BASE_URL, WEBSMS_SANDBOX
 */

const DEFAULT_BASE = "https://api.websms.co.nz/api/connexus";

let cachedToken = "";
let cachedTokenExpiresAt = 0;

function baseUrl() {
  return String(process.env.WEBSMS_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
}

function websmsConfigured() {
  const id = String(process.env.WEBSMS_CLIENT_ID || "").trim();
  const secret = String(process.env.WEBSMS_CLIENT_SECRET || "").trim();
  return Boolean(
    id &&
      secret &&
      !/^(cid_your|your-client|PASTE)/i.test(id) &&
      !/^(csk_your|your-secret|PASTE)/i.test(secret)
  );
}

/** NZ mobile → digits only with country code, no +: 64271234567 */
function normalizeNzMobile(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.replace(/^00+/, "");
  if (digits.startsWith("0")) digits = `64${digits.slice(1)}`;
  if (!digits.startsWith("64") && /^2\d{7,9}$/.test(digits)) digits = `64${digits}`;
  // NZ mobiles are 64 + 2x… (021/022/027/028/029 etc.)
  if (!/^642\d{7,9}$/.test(digits)) return "";
  return digits;
}

async function postForm(pathname, fields, { bearer = "" } = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields || {})) {
    if (value == null || value === "") continue;
    body.set(key, String(value));
  }
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${baseUrl()}${pathname}`, {
    method: "POST",
    headers,
    body,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(
      data.error || data.message || data.status || `WebSMS HTTP ${res.status}`
    );
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.payload = data;
    throw err;
  }
  return data;
}

async function getAccessToken() {
  if (!websmsConfigured()) {
    const err = new Error(
      "WebSMS not configured. Add WEBSMS_CLIENT_ID and WEBSMS_CLIENT_SECRET to .env / Render."
    );
    err.status = 503;
    throw err;
  }
  const now = Date.now();
  if (cachedToken && cachedTokenExpiresAt > now + 60_000) {
    return cachedToken;
  }
  const data = await postForm("/auth/token", {
    client_id: String(process.env.WEBSMS_CLIENT_ID || "").trim(),
    client_secret: String(process.env.WEBSMS_CLIENT_SECRET || "").trim(),
  });
  const token = String(data.access_token || "").trim();
  if (!token) {
    const err = new Error("WebSMS did not return an access token. Check API keys.");
    err.status = 502;
    throw err;
  }
  const expiresIn = Number(data.expires_in) || 86400;
  cachedToken = token;
  cachedTokenExpiresAt = now + expiresIn * 1000;
  return token;
}

/**
 * @param {{ to: string, body: string, messageClass?: string, from?: string, sandbox?: boolean }} opts
 */
async function sendSms({
  to,
  body,
  messageClass = "transactional",
  from = "",
  sandbox = undefined,
} = {}) {
  const normalized = normalizeNzMobile(to);
  if (!normalized) {
    const err = new Error("Customer phone must be a valid NZ mobile number.");
    err.status = 400;
    throw err;
  }
  const text = String(body || "").trim();
  if (!text) {
    const err = new Error("SMS body is empty.");
    err.status = 400;
    throw err;
  }
  const token = await getAccessToken();
  const useSandbox =
    sandbox === true ||
    String(process.env.WEBSMS_SANDBOX || "").toLowerCase() === "true";
  const fields = {
    to: normalized,
    body: text,
    messageClass: messageClass === "marketing" ? "marketing" : "transactional",
  };
  const sender = String(from || process.env.WEBSMS_FROM || "").trim();
  if (sender) fields.from = sender;
  if (useSandbox) fields.sandbox = "true";

  const data = await postForm("/sms/out", fields, { bearer: token });
  return {
    ok: true,
    to: normalized,
    messageId: data.message_id || data.messageId || "",
    status: data.status || "",
    parts: data.parts || data.Parts || 1,
    sandbox: useSandbox,
    raw: data,
  };
}

function publicStatus() {
  return {
    configured: websmsConfigured(),
    from: String(process.env.WEBSMS_FROM || "").trim() || null,
    sandbox: String(process.env.WEBSMS_SANDBOX || "").toLowerCase() === "true",
  };
}

module.exports = {
  websmsConfigured,
  normalizeNzMobile,
  sendSms,
  publicStatus,
  getAccessToken,
};
