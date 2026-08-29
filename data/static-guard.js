const path = require("path");

const BLOCKED_STATIC_EXACT = new Set([
  "/server.js",
  "/package.json",
  "/package-lock.json",
  "/render.yaml",
  "/.gitignore",
  "/.env",
  "/.env.example",
]);
const BLOCKED_STATIC_PREFIXES = [
  "/data/",
  "/node_modules/",
  "/.git/",
  "/.cursor/",
  "/scripts/",
  "/docs/",
  "/exports/",
];
const BLOCKED_STATIC_FILES = new Set([
  "server.js",
  "package.json",
  "package-lock.json",
  "render.yaml",
  "reports.json",
  "billing.json",
  "customers.json",
  "jobs.json",
  "backup-status.json",
]);

function blockedStaticPath(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(String(urlPath || "").split("?")[0]);
  } catch {
    return true;
  }
  pathname = pathname.replace(/\\/g, "/");
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (pathname.includes("\0") || pathname.split("/").includes("..")) return true;
  const lower = pathname.toLowerCase();
  if (BLOCKED_STATIC_EXACT.has(lower)) return true;
  const trimmed = lower.replace(/\/+$/, "") || "/";
  if (trimmed === "/data" || trimmed === "/uploads") return true;
  if (BLOCKED_STATIC_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  const base = path.posix.basename(lower);
  if (BLOCKED_STATIC_FILES.has(base)) return true;
  if (base.endsWith(".bak") || base.endsWith(".tmp") || base.endsWith(".env")) return true;
  return false;
}

const UPLOAD_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf"]);

function safeUploadPath(uploadsDir, filename) {
  const base = path.basename(String(filename || ""));
  if (!base || base !== String(filename) || base.includes("\0")) return null;
  const ext = path.extname(base).toLowerCase();
  if (!UPLOAD_EXTS.has(ext)) return null;
  const resolvedDir = path.resolve(uploadsDir);
  const resolved = path.resolve(uploadsDir, base);
  const prefix = resolvedDir.endsWith(path.sep) ? resolvedDir : resolvedDir + path.sep;
  if (resolved !== resolvedDir && !resolved.startsWith(prefix)) return null;
  return resolved;
}

module.exports = {
  UPLOAD_EXTS,
  blockedStaticPath,
  safeUploadPath,
};
