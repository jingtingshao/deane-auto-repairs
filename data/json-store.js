const fs = require("fs");
const path = require("path");

function dataError(message, cause) {
  const error = new Error(message);
  error.status = 500;
  if (cause) error.cause = cause;
  return error;
}

function persistError(cause) {
  console.error("Could not write data file:", cause);
  return dataError(
    "Could not save. On Render attach a disk at /data, then set DATA_DIR=/data.",
    cause
  );
}

function replaceFile(tmpPath, destPath) {
  try {
    fs.renameSync(tmpPath, destPath);
    return;
  } catch (err) {
    if (err.code !== "EEXIST" && err.code !== "EPERM" && err.code !== "EACCES") {
      throw err;
    }
  }
  fs.copyFileSync(tmpPath, destPath);
  try {
    fs.unlinkSync(tmpPath);
  } catch {
    /* leftover tmp is harmless */
  }
}

function writeTempFile(tmpPath, contents) {
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeFileSync(fd, contents, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeJsonArray(filePath, value) {
  if (!Array.isArray(value)) {
    throw dataError("Internal error: refusing to save non-array data.");
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const json = `${JSON.stringify(value, null, 2)}\n`;
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    const bakPath = `${filePath}.bak`;
    writeTempFile(tmpPath, json);
    if (fs.existsSync(filePath)) {
      try {
        fs.copyFileSync(filePath, bakPath);
      } catch (err) {
        console.error("Could not update backup file:", bakPath, err);
      }
    }
    replaceFile(tmpPath, filePath);
  } catch (err) {
    if (err.status) throw err;
    throw persistError(err);
  }
}

function readBackupArray(filePath, label) {
  const bakPath = `${filePath}.bak`;
  if (!fs.existsSync(bakPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(bakPath, "utf8"));
    if (!Array.isArray(parsed)) return null;
    console.error(`Loaded ${label} from backup:`, bakPath);
    try {
      fs.copyFileSync(bakPath, filePath);
    } catch (err) {
      console.error("Could not restore main file from backup:", err);
    }
    return parsed;
  } catch (err) {
    console.error(`Backup for ${label} is also unreadable:`, bakPath, err);
    return null;
  }
}

function readJsonArray(filePath, label) {
  if (!fs.existsSync(filePath)) return [];
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw dataError(`Could not read ${label}.`, err);
  }
  if (!String(raw).trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("not an array");
    }
    return parsed;
  } catch (err) {
    console.error(`Corrupt ${label} file:`, filePath, err.message);
    const recovered = readBackupArray(filePath, label);
    if (recovered) return recovered;
    throw dataError(
      `Could not load ${label} (data file is damaged). Restore a backup and try again.`,
      err
    );
  }
}

module.exports = {
  dataError,
  readJsonArray,
  writeJsonArray,
};
