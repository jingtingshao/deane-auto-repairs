/**
 * Trusted-device + email OTP for workshop staff sign-in.
 * New browsers/computers must enter a code emailed to the workshop inbox.
 */

const { createHash, randomBytes, randomInt, timingSafeEqual } = require("crypto");
const { readJsonArray, writeJsonArray } = require("./json-store");

const DEVICE_COOKIE = "deane_device";
const DEVICE_TRUST_MS = 180 * 24 * 60 * 60 * 1000; // 180 days
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const CODE_LENGTH = 6;

const pendingChallenges = new Map();

function hashSecret(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase();
}

function newDeviceId() {
  return randomBytes(32).toString("hex");
}

function newChallengeId() {
  return randomBytes(24).toString("hex");
}

function generateCode() {
  const max = 10 ** CODE_LENGTH;
  return String(randomInt(0, max)).padStart(CODE_LENGTH, "0");
}

function maskEmail(email) {
  const raw = String(email || "").trim();
  const at = raw.indexOf("@");
  if (at < 1) return "workshop email";
  const user = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}***@${domain}`;
}

function browserLabel(userAgent) {
  const ua = String(userAgent || "");
  let browser = "Browser";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
  let os = "device";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Mac OS X/i.test(ua)) os = "Mac";
  else if (/Linux/i.test(ua)) os = "Linux";
  return `${browser} on ${os}`;
}

function pruneChallenges() {
  const now = Date.now();
  for (const [id, row] of pendingChallenges) {
    if (!row || row.expiresAt < now) pendingChallenges.delete(id);
  }
}

function readTrustedDevices(filePath) {
  return readJsonArray(filePath, "trusted devices")
    .map((row) => ({
      id: String(row?.id || "").trim(),
      username: normalizeUsername(row?.username),
      label: String(row?.label || "Trusted device").trim() || "Trusted device",
      createdAt: String(row?.createdAt || ""),
      lastUsedAt: String(row?.lastUsedAt || row?.createdAt || ""),
      ip: String(row?.ip || "").trim(),
    }))
    .filter((row) => row.id && row.username);
}

function writeTrustedDevices(filePath, rows) {
  writeJsonArray(filePath, rows);
}

function isDeviceTrusted(filePath, username, deviceId) {
  const id = String(deviceId || "").trim();
  const user = normalizeUsername(username);
  if (!id || !user) return false;
  return readTrustedDevices(filePath).some((row) => row.id === id && row.username === user);
}

function touchTrustedDevice(filePath, username, deviceId, meta = {}) {
  const id = String(deviceId || "").trim();
  const user = normalizeUsername(username);
  if (!id || !user) return;
  const rows = readTrustedDevices(filePath);
  const now = new Date().toISOString();
  let found = false;
  for (const row of rows) {
    if (row.id === id && row.username === user) {
      row.lastUsedAt = now;
      if (meta.ip) row.ip = String(meta.ip);
      if (meta.label) row.label = String(meta.label);
      found = true;
      break;
    }
  }
  if (!found) {
    rows.push({
      id,
      username: user,
      label: String(meta.label || "Trusted device"),
      createdAt: now,
      lastUsedAt: now,
      ip: String(meta.ip || ""),
    });
  }
  writeTrustedDevices(filePath, rows);
}

function createChallenge({ username, role, deviceId, ip, userAgent, emailTo }) {
  pruneChallenges();
  const code = generateCode();
  const id = newChallengeId();
  const row = {
    id,
    username: normalizeUsername(username),
    role: role === "technician" ? "technician" : "admin",
    deviceId: String(deviceId || "").trim(),
    codeHash: hashSecret(code),
    expiresAt: Date.now() + CODE_TTL_MS,
    attempts: 0,
    sentAt: Date.now(),
    emailTo: String(emailTo || "").trim(),
    ip: String(ip || ""),
    label: browserLabel(userAgent),
  };
  pendingChallenges.set(id, row);
  return { challenge: row, code };
}

function getChallenge(challengeId) {
  pruneChallenges();
  return pendingChallenges.get(String(challengeId || "").trim()) || null;
}

function canResend(challenge) {
  if (!challenge) return { ok: false, waitSeconds: 0 };
  const waitMs = RESEND_COOLDOWN_MS - (Date.now() - Number(challenge.sentAt || 0));
  if (waitMs > 0) {
    return { ok: false, waitSeconds: Math.ceil(waitMs / 1000) };
  }
  return { ok: true, waitSeconds: 0 };
}

function refreshChallengeCode(challenge) {
  const code = generateCode();
  challenge.codeHash = hashSecret(code);
  challenge.expiresAt = Date.now() + CODE_TTL_MS;
  challenge.attempts = 0;
  challenge.sentAt = Date.now();
  pendingChallenges.set(challenge.id, challenge);
  return code;
}

function verifyChallengeCode(challengeId, code) {
  const challenge = getChallenge(challengeId);
  if (!challenge) {
    return { ok: false, error: "That code has expired. Sign in again." };
  }
  if (challenge.expiresAt < Date.now()) {
    pendingChallenges.delete(challenge.id);
    return { ok: false, error: "That code has expired. Sign in again." };
  }
  if (challenge.attempts >= MAX_CODE_ATTEMPTS) {
    pendingChallenges.delete(challenge.id);
    return { ok: false, error: "Too many wrong codes. Sign in again." };
  }
  const entered = String(code || "").replace(/\s+/g, "");
  const enteredHash = hashSecret(entered);
  const expected = String(challenge.codeHash || "");
  let match = false;
  try {
    match =
      /^\d{6}$/.test(entered) &&
      enteredHash.length === expected.length &&
      timingSafeEqual(Buffer.from(enteredHash, "hex"), Buffer.from(expected, "hex"));
  } catch {
    match = false;
  }
  if (!match) {
    challenge.attempts += 1;
    pendingChallenges.set(challenge.id, challenge);
    const left = MAX_CODE_ATTEMPTS - challenge.attempts;
    if (left <= 0) pendingChallenges.delete(challenge.id);
    return {
      ok: false,
      error: left > 0 ? `Wrong code. ${left} tries left.` : "Too many wrong codes. Sign in again.",
    };
  }
  pendingChallenges.delete(challenge.id);
  const deviceId = challenge.deviceId || newDeviceId();
  return {
    ok: true,
    username: challenge.username,
    role: challenge.role,
    deviceId,
    label: challenge.label,
    ip: challenge.ip,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildVerifyEmail({ code, username, label, ip, expiresMinutes }) {
  const mins = expiresMinutes || Math.round(CODE_TTL_MS / 60000);
  const subject = "Deane Auto Repairs — new device sign-in code";
  const text =
    `A sign-in to the workshop system needs a code because this computer/browser is new.\n\n` +
    `Account: ${username}\n` +
    `Device: ${label}\n` +
    `IP: ${ip || "unknown"}\n\n` +
    `Verification code: ${code}\n\n` +
    `This code expires in ${mins} minutes.\n` +
    `If this was not you, change the admin PIN / technician password and reply to this email.\n`;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1a2332;">` +
    `<p style="margin:0 0 12px;"><strong>Deane Auto Repairs</strong> — new device sign-in</p>` +
    `<p style="margin:0 0 12px;">Someone signed in as <strong>${escapeHtml(username)}</strong> from a computer/browser we have not seen before.</p>` +
    `<p style="margin:0 0 8px;">Device: ${escapeHtml(label)}<br/>IP: ${escapeHtml(ip || "unknown")}</p>` +
    `<p style="margin:16px 0;font-size:28px;letter-spacing:0.2em;font-weight:700;">${escapeHtml(code)}</p>` +
    `<p style="margin:0;color:#5a6575;">Expires in ${mins} minutes. If this was not you, change the workshop password.</p>` +
    `</div>`;
  return { subject, text, html };
}

module.exports = {
  DEVICE_COOKIE,
  DEVICE_TRUST_MS,
  CODE_TTL_MS,
  RESEND_COOLDOWN_MS,
  MAX_CODE_ATTEMPTS,
  maskEmail,
  browserLabel,
  newDeviceId,
  isDeviceTrusted,
  touchTrustedDevice,
  readTrustedDevices,
  writeTrustedDevices,
  createChallenge,
  getChallenge,
  canResend,
  refreshChallengeCode,
  verifyChallengeCode,
  buildVerifyEmail,
};
