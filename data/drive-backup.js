/** Zip workshop data and upload to Google Drive via user OAuth (personal Gmail). */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { google } = require("googleapis");
const archiver = require("archiver");
const { todayIso, nowIso } = require("./nz-time");

const SKIP_DATA_NAME = /credential|service-account|\.env/i;

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function listWorkshopDataFiles(dataDir) {
  if (!dataDir || !fs.existsSync(dataDir)) return [];
  return fs
    .readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.json(\.bak)?$/i.test(name) && !SKIP_DATA_NAME.test(name))
    .sort();
}

function envFlag(name, fallback = false) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function envTrim(name) {
  return String(process.env[name] || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function oauthCredentials() {
  const clientId = envTrim("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = envTrim("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = envTrim("GOOGLE_OAUTH_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

function backupConfigured() {
  return Boolean(envTrim("GOOGLE_DRIVE_FOLDER_ID") && oauthCredentials());
}

function statusPath(dataDir) {
  return path.join(dataDir, "backup-status.json");
}

function readStatus(dataDir) {
  const file = statusPath(dataDir);
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeStatus(dataDir, status) {
  const file = statusPath(dataDir);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.copyFileSync(tmp, file);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function getConfig() {
  const folderId = envTrim("GOOGLE_DRIVE_FOLDER_ID");
  const oauth = oauthCredentials();
  const keep = Math.max(3, Number(process.env.BACKUP_KEEP_COUNT) || 14);
  const hourNz = Math.min(
    23,
    Math.max(0, Number(process.env.BACKUP_HOUR_NZ ?? 2))
  );
  const includePhotos = envFlag("BACKUP_INCLUDE_PHOTOS", false);
  return { folderId, oauth, keep, hourNz, includePhotos };
}

function createOAuthClient(oauth) {
  const client = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
  client.setCredentials({ refresh_token: oauth.refreshToken });
  return client;
}

async function createDriveClient(oauth) {
  const auth = createOAuthClient(oauth);
  return google.drive({ version: "v3", auth });
}

function zipWorkshopData({ dataDir, uploadsDir, includePhotos }) {
  return new Promise((resolve, reject) => {
    const stamp = nowIso().replace(/[:.]/g, "-");
    const zipName = `deane-backup-${stamp}.zip`;
    const zipPath = path.join(os.tmpdir(), zipName);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve({ zipPath, zipName, bytes: archive.pointer() }));
    archive.on("error", reject);
    archive.pipe(output);

    let added = 0;
    for (const name of listWorkshopDataFiles(dataDir)) {
      archive.file(path.join(dataDir, name), { name });
      added += 1;
    }

    if (includePhotos && uploadsDir && fs.existsSync(uploadsDir)) {
      archive.directory(uploadsDir, "uploads");
      added += 1;
    }

    if (!added) {
      archive.abort();
      reject(new Error("No workshop data files found to back up."));
      return;
    }

    archive.finalize();
  });
}

async function uploadZip(drive, folderId, zipPath, zipName) {
  const res = await drive.files.create({
    requestBody: {
      name: zipName,
      parents: [folderId],
    },
    media: {
      mimeType: "application/zip",
      body: fs.createReadStream(zipPath),
    },
    fields: "id, name, size, createdTime, webViewLink",
  });
  return res.data;
}

async function pruneOldBackups(drive, folderId, keep) {
  const listed = await drive.files.list({
    q: `'${folderId}' in parents and name contains 'deane-backup-' and trashed = false`,
    orderBy: "createdTime desc",
    pageSize: 100,
    fields: "files(id, name, createdTime)",
  });
  const files = listed.data.files || [];
  const extra = files.slice(keep);
  for (const file of extra) {
    try {
      await drive.files.delete({ fileId: file.id });
    } catch (err) {
      console.error("Could not delete old backup:", file.name, err.message);
    }
  }
  return { kept: Math.min(files.length, keep), deleted: extra.length };
}

async function runBackup({ dataDir, uploadsDir, reason = "manual" }) {
  if (!backupConfigured()) {
    const err = new Error(
      "Google Drive backup is not configured. Add GOOGLE_DRIVE_FOLDER_ID, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REFRESH_TOKEN. Run: npm run backup:auth"
    );
    err.status = 503;
    throw err;
  }

  const { folderId, oauth, keep, includePhotos } = getConfig();
  const startedAt = nowIso();
  let zipPath = "";

  try {
    const zip = await zipWorkshopData({ dataDir, uploadsDir, includePhotos });
    zipPath = zip.zipPath;
    const drive = await createDriveClient(oauth);
    const uploaded = await uploadZip(drive, folderId, zip.zipPath, zip.zipName);
    const pruned = await pruneOldBackups(drive, folderId, keep);

    const status = {
      ok: true,
      reason,
      at: startedAt,
      finishedAt: nowIso(),
      fileName: uploaded.name || zip.zipName,
      fileId: uploaded.id || "",
      bytes: Number(uploaded.size) || zip.bytes || 0,
      includePhotos,
      kept: pruned.kept,
      deletedOld: pruned.deleted,
      error: "",
    };
    writeStatus(dataDir, status);
    return status;
  } catch (err) {
    const status = {
      ok: false,
      reason,
      at: startedAt,
      finishedAt: nowIso(),
      fileName: "",
      fileId: "",
      bytes: 0,
      includePhotos,
      kept: 0,
      deletedOld: 0,
      error: err.message || String(err),
    };
    try {
      writeStatus(dataDir, status);
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    if (zipPath) {
      try {
        fs.unlinkSync(zipPath);
      } catch {
        /* ignore */
      }
    }
  }
}

function aucklandHour(date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-NZ", {
      timeZone: "Pacific/Auckland",
      hour: "numeric",
      hour12: false,
    }).format(date)
  );
  return hour === 24 ? 0 : hour;
}

function startBackupScheduler({ dataDir, uploadsDir }) {
  if (!backupConfigured()) {
    console.log(
      "Google Drive backup: not configured — run npm run backup:auth after adding OAuth client ID/secret"
    );
    return;
  }

  const { hourNz } = getConfig();
  console.log(
    `Google Drive backup: daily from ${hourNz}:00 Auckland time (OAuth + folder configured)`
  );

  let running = false;
  const tick = async () => {
    if (running) return;
    if (aucklandHour() < hourNz) return;
    const status = readStatus(dataDir);
    if (status?.ok && String(status.at || "").slice(0, 10) === todayIso()) {
      return;
    }
    running = true;
    try {
      const result = await runBackup({ dataDir, uploadsDir, reason: "scheduled" });
      console.log(`Google Drive backup ok: ${result.fileName}`);
    } catch (err) {
      console.error("Google Drive backup failed:", err.message || err);
    } finally {
      running = false;
    }
  };

  setTimeout(tick, 20_000);
  setInterval(tick, 15 * 60 * 1000);
}

function publicStatus(dataDir) {
  const configured = backupConfigured();
  const last = readStatus(dataDir);
  const { hourNz, includePhotos, keep } = configured
    ? getConfig()
    : {
        hourNz: Math.min(23, Math.max(0, Number(process.env.BACKUP_HOUR_NZ ?? 2))),
        includePhotos: envFlag("BACKUP_INCLUDE_PHOTOS", false),
        keep: Math.max(3, Number(process.env.BACKUP_KEEP_COUNT) || 14),
      };
  return {
    configured,
    hourNz,
    includePhotos,
    keep,
    last,
    authMode: "oauth",
  };
}

module.exports = {
  DRIVE_SCOPE,
  backupConfigured,
  listWorkshopDataFiles,
  zipWorkshopData,
  getConfig,
  runBackup,
  startBackupScheduler,
  publicStatus,
  createOAuthClient,
  oauthCredentials,
};
