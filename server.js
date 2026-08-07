const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const { randomUUID } = require("crypto");
const {
  ACTIONS,
  STATUSES,
  itemsForPackage,
  emptyChecks,
} = require("./data/checklist");

const PORT = Number(process.env.PORT) || 5173;
const ADMIN_PIN = process.env.ADMIN_PIN || "deane123";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");
const UPLOADS_DIR = path.join(ROOT, "uploads");

for (const dir of [DATA_DIR, UPLOADS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(REPORTS_FILE)) {
  fs.writeFileSync(REPORTS_FILE, "[]", "utf8");
}

function readReports() {
  try {
    return JSON.parse(fs.readFileSync(REPORTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeReports(reports) {
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports, null, 2), "utf8");
}

function nextJobNumber(reports) {
  const year = new Date().getFullYear();
  const prefix = `DAR-${year}-`;
  const nums = reports
    .map((r) => r.jobNumber)
    .filter((n) => typeof n === "string" && n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

function requireAdmin(req, res, next) {
  const pin = req.headers["x-admin-pin"] || req.query.pin;
  if (pin !== ADMIN_PIN) {
    return res.status(401).json({ error: "Invalid admin PIN" });
  }
  next();
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").slice(0, 8) || ".jpg";
    cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
});

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/admin", express.static(path.join(ROOT, "admin")));
app.use("/report", express.static(path.join(ROOT, "report")));
app.use(express.static(ROOT, { index: "index.html" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, shop: "Deane Auto Repairs" });
});

app.get("/api/checklist", (req, res) => {
  const pkg = req.query.package === "full" ? "full" : "standard";
  res.json({
    package: pkg,
    statuses: STATUSES,
    groups: itemsForPackage(pkg),
    actions: {
      standard: ACTIONS.standard,
      fullExtra: pkg === "full" ? ACTIONS.fullExtra : [],
      either: ACTIONS.either,
    },
  });
});

app.post("/api/admin/login", (req, res) => {
  if (req.body?.pin !== ADMIN_PIN) {
    return res.status(401).json({ error: "Wrong PIN" });
  }
  res.json({ ok: true });
});

app.get("/api/reports", requireAdmin, (_req, res) => {
  const reports = readReports()
    .map((r) => ({
      id: r.id,
      jobNumber: r.jobNumber,
      status: r.status,
      serviceDate: r.serviceDate,
      customerName: r.customerName,
      registration: r.registration,
      vehicle: r.vehicle,
      jobType: r.jobType,
      servicePackage: r.servicePackage,
      updatedAt: r.updatedAt,
    }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json(reports);
});

app.get("/api/reports/:id", (req, res) => {
  const report = readReports().find((r) => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: "Report not found" });

  const isAdmin = (req.headers["x-admin-pin"] || req.query.pin) === ADMIN_PIN;
  if (report.status !== "published" && !isAdmin) {
    return res.status(404).json({ error: "Report not found" });
  }
  res.json(report);
});

app.post("/api/reports", requireAdmin, (req, res) => {
  const reports = readReports();
  const now = new Date().toISOString();
  const servicePackage =
    req.body.servicePackage === "full" ? "full" : "standard";
  const jobType = req.body.jobType || "standard_service";

  const report = {
    id: randomUUID(),
    jobNumber: nextJobNumber(reports),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    serviceDate: req.body.serviceDate || now.slice(0, 10),
    technicianName: req.body.technicianName || "",
    customerName: req.body.customerName || "",
    customerEmail: req.body.customerEmail || "",
    customerPhone: req.body.customerPhone || "",
    registration: (req.body.registration || "").toUpperCase(),
    vehicle: req.body.vehicle || "",
    odometer: req.body.odometer || "",
    vin: req.body.vin || "",
    jobType,
    servicePackage,
    customerConcern: req.body.customerConcern || "",
    checks: emptyChecks(servicePackage),
    actionsDone: {},
    actionsOther: "",
    oilSpec: "",
    oilFilter: "",
    wof: {
      performed: jobType.includes("wof"),
      result: "not_completed",
      expiry: "",
      reference: "",
      failNotes: "",
      repairsForPass: "",
      recheckRequired: false,
    },
    summary: "",
    nextServiceDue: "",
    technicianComments: "",
    vehiclePhoto: "",
  };

  reports.push(report);
  writeReports(reports);
  res.status(201).json(report);
});

app.put("/api/reports/:id", requireAdmin, (req, res) => {
  const reports = readReports();
  const index = reports.findIndex((r) => r.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Report not found" });

  const current = reports[index];
  const body = req.body || {};
  const nextPackage =
    body.servicePackage === "full"
      ? "full"
      : body.servicePackage === "standard"
        ? "standard"
        : current.servicePackage;

  let checks = body.checks || current.checks;
  if (nextPackage !== current.servicePackage) {
    const fresh = emptyChecks(nextPackage);
    for (const code of Object.keys(fresh)) {
      if (checks[code]) fresh[code] = checks[code];
    }
    checks = fresh;
  }

  reports[index] = {
    ...current,
    ...body,
    id: current.id,
    jobNumber: current.jobNumber,
    createdAt: current.createdAt,
    servicePackage: nextPackage,
    checks,
    registration: (body.registration ?? current.registration).toUpperCase(),
    updatedAt: new Date().toISOString(),
  };

  writeReports(reports);
  res.json(reports[index]);
});

app.post("/api/reports/:id/publish", requireAdmin, (req, res) => {
  const reports = readReports();
  const index = reports.findIndex((r) => r.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Report not found" });

  reports[index].status = "published";
  reports[index].publishedAt = new Date().toISOString();
  reports[index].updatedAt = reports[index].publishedAt;
  writeReports(reports);
  res.json(reports[index]);
});

app.post("/api/reports/:id/unpublish", requireAdmin, (req, res) => {
  const reports = readReports();
  const index = reports.findIndex((r) => r.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Report not found" });

  reports[index].status = "draft";
  reports[index].updatedAt = new Date().toISOString();
  writeReports(reports);
  res.json(reports[index]);
});

app.post(
  "/api/reports/:id/photo",
  requireAdmin,
  upload.single("photo"),
  (req, res) => {
    const reports = readReports();
    const index = reports.findIndex((r) => r.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Report not found" });
    if (!req.file) return res.status(400).json({ error: "No photo uploaded" });

    reports[index].vehiclePhoto = `/uploads/${req.file.filename}`;
    reports[index].updatedAt = new Date().toISOString();
    writeReports(reports);
    res.json(reports[index]);
  }
);

app.delete("/api/reports/:id", requireAdmin, (req, res) => {
  const reports = readReports();
  const next = reports.filter((r) => r.id !== req.params.id);
  if (next.length === reports.length) {
    return res.status(404).json({ error: "Report not found" });
  }
  writeReports(next);
  res.json({ ok: true });
});

app.get("/r/:id", (req, res) => {
  res.sendFile(path.join(ROOT, "report", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Deane Auto Repairs running at http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin/`);
  console.log(`Admin PIN: ${ADMIN_PIN}`);
});
