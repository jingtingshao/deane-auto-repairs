/** Print-ready booking QR codes for posters. */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const QRCode = require("qrcode");
const business = require("../data/business");

const ROOT = path.join(__dirname, "..");
const QR_DIR = path.join(ROOT, "assets", "qr");
const ADS_DIR = path.join(ROOT, "exports", "ads");
const BASE = String(business.website || "https://www.deaneauto.co.nz").replace(/\/+$/, "");

const TARGETS = [
  { file: "book.png", path: "/book" },
  { file: "book-service-wof.png", path: "/book?help=service-wof" },
  { file: "book-brakes.png", path: "/book?help=brakes" },
];

const QR_OPTS = {
  type: "png",
  width: 720,
  margin: 2,
  errorCorrectionLevel: "H",
  color: { dark: "#021534", light: "#ffffff" },
};

async function main() {
  fs.mkdirSync(QR_DIR, { recursive: true });
  for (const row of TARGETS) {
    const url = `${BASE}${row.path}`;
    const dest = path.join(QR_DIR, row.file);
    await QRCode.toFile(dest, url, QR_OPTS);
    console.log(`QR ${row.file} → ${url}`);
  }

  const overlay = spawnSync("python", [path.join(__dirname, "overlay-booking-qr.py")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (overlay.stdout) process.stdout.write(overlay.stdout);
  if (overlay.stderr) process.stderr.write(overlay.stderr);
  if (overlay.status !== 0) {
    throw new Error(`QR overlay failed with exit ${overlay.status}`);
  }
  console.log(`Posters with QR saved in ${ADS_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
