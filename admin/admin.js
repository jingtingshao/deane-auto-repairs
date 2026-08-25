const loginView = document.getElementById("login-view");
const app = document.getElementById("app");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const listView = document.getElementById("list-view");
const editView = document.getElementById("edit-view");
const reportList = document.getElementById("report-list");
const reportSearch = document.getElementById("report-search");
const reportForm = document.getElementById("report-form");
const checklistEl = document.getElementById("checklist");
const actionsEl = document.getElementById("actions");
const saveStatus = document.getElementById("save-status");
const viewTitle = document.getElementById("view-title");
const vehiclePhotosEl = document.getElementById("vehicle-photos");
const photoInput = document.getElementById("photo-input");

let current = null;
let checklistMeta = null;
let reportDocs = [];
let reportCustomerDirectory = [];
const reportCustomerSelect = document.getElementById("report-customer-id");
const reportVehicleSelect = document.getElementById("report-vehicle-id");

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...options, headers, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    showLogin();
    throw new Error(data.error || "Please sign in again.");
  }
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function showStatus(msg) {
  saveStatus.hidden = false;
  saveStatus.textContent = msg;
  setTimeout(() => {
    saveStatus.hidden = true;
  }, 2500);
}

function showApp() {
  loginView.hidden = true;
  app.hidden = false;
}

function setSection(name) {
  if (name === "billing") name = "quotes";
  const dashboardSection = document.getElementById("dashboard-section");
  const reportsSection = document.getElementById("reports-section");
  const billingSection = document.getElementById("billing-section");
  const customersSection = document.getElementById("customers-section");
  const jobsSection = document.getElementById("jobs-section");
  const btnNew = document.getElementById("btn-new");
  const billingOpen = name === "quotes" || name === "invoices";
  if (dashboardSection) dashboardSection.hidden = name !== "dashboard";
  if (reportsSection) reportsSection.hidden = name !== "reports";
  if (billingSection) billingSection.hidden = !billingOpen;
  if (customersSection) customersSection.hidden = name !== "customers";
  if (jobsSection) jobsSection.hidden = name !== "jobs";
  if (btnNew) {
    btnNew.hidden = name !== "customers";
    btnNew.textContent = "New customer";
  }
  document.getElementById("nav-dashboard")?.classList.toggle("is-active", name === "dashboard");
  document.getElementById("nav-reports")?.classList.toggle("is-active", name === "reports");
  document.getElementById("nav-quotes")?.classList.toggle("is-active", name === "quotes");
  document.getElementById("nav-invoices")?.classList.toggle("is-active", name === "invoices");
  document.getElementById("nav-customers")?.classList.toggle("is-active", name === "customers");
  document.getElementById("nav-jobs")?.classList.toggle("is-active", name === "jobs");
  if (name === "reports" && listView && !listView.hidden) {
    viewTitle.textContent = "Reports";
  }
  if (name === "dashboard") {
    viewTitle.textContent = "Dashboard";
    window.DeaneDashboard?.load?.();
  }
  if (name === "quotes") viewTitle.textContent = "Quotes";
  if (name === "invoices") viewTitle.textContent = "Invoices";
}

function confirmPublicCustomerLink(kind) {
  const origin = location.origin;
  if (!/localhost|127\.0\.0\.1/i.test(origin)) return true;
  return confirm(
    `This ${kind} link is ${origin}, which only works on this computer.\n\n` +
      "The customer cannot open it on their phone until the workshop app is hosted on a public website.\n\n" +
      "Send / copy anyway?"
  );
}

window.DeaneAdmin = {
  api,
  showStatus,
  escapeHtml,
  escapeAttr,
  setSection,
  confirmPublicCustomerLink,
  NZ_TZ: "Pacific/Auckland",
  todayIso() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Auckland",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  },
  createAutosave({ delay = 2500, isReady, save, onSaving, onError }) {
    let timer = null;
    let inflight = null;
    let queued = false;

    async function run() {
      timer = null;
      if (!isReady()) return;
      if (inflight) {
        queued = true;
        return;
      }
      onSaving?.("Saving…");
      inflight = Promise.resolve()
        .then(() => save())
        .finally(() => {
          inflight = null;
          if (queued) {
            queued = false;
            if (isReady()) schedule();
          }
        });
      try {
        await inflight;
      } catch (err) {
        onError?.(err);
      }
    }

    function schedule() {
      if (!isReady()) return;
      clearTimeout(timer);
      timer = setTimeout(run, delay);
    }

    async function flush() {
      clearTimeout(timer);
      timer = null;
      if (!isReady()) return;
      if (inflight) await inflight;
      else await run();
    }

    function cancel() {
      clearTimeout(timer);
      timer = null;
      queued = false;
    }

    return { schedule, flush, cancel };
  },
  customerVehicles(row) {
    if (Array.isArray(row?.vehicles) && row.vehicles.length) return row.vehicles;
    if (Array.isArray(row?.registrations) && row.registrations.length) {
      return row.registrations.map((p) => ({
        id: "",
        registration: String(p || "").trim(),
        vehicle: row.vehicle || "",
      }));
    }
    const plate = String(row?.registration || "").trim();
    return plate ? [{ id: "", registration: plate, vehicle: row?.vehicle || "" }] : [];
  },
  matchCustomer(directory, doc) {
    const list = directory || [];
    if (!doc) return null;
    const id = String(doc.customerId || "").trim();
    if (id) {
      const byId = list.find((row) => row.customerId === id);
      if (byId) return byId;
    }
    const email = String(doc.customerEmail || "").trim().toLowerCase();
    if (email) {
      const byEmail = list.find(
        (row) => String(row.customerEmail || "").trim().toLowerCase() === email
      );
      if (byEmail) return byEmail;
    }
    const plate = String(doc.registration || "")
      .toUpperCase()
      .replace(/[\s-]/g, "");
    if (plate) {
      const byPlate = list.find((row) =>
        this.customerVehicles(row).some(
          (v) =>
            String(v.registration || "")
              .toUpperCase()
              .replace(/[\s-]/g, "") === plate
        )
      );
      if (byPlate) return byPlate;
    }
    const name = String(doc.customerName || "").trim().toLowerCase();
    if (name) {
      const matches = list.filter(
        (row) => String(row.customerName || "").trim().toLowerCase() === name
      );
      if (matches.length === 1) return matches[0];
    }
    return null;
  },
  fillCustomerSelect(selectEl, directory, selectedId = "") {
    if (!selectEl) return;
    const saved = (directory || []).filter((row) => row.customerId);
    const current = String(selectedId || "");
    const options = saved
      .slice()
      .sort((a, b) =>
        String(a.customerName || "").localeCompare(String(b.customerName || ""))
      )
      .map((row) => {
        const labelName =
          [row.firstName, row.lastName].filter(Boolean).join(" ") ||
          row.customerName;
        const sel = row.customerId === current ? " selected" : "";
        return `<option value="${escapeAttr(row.customerId)}"${sel}>${escapeHtml(
          labelName || "Customer"
        )}</option>`;
      })
      .join("");
    selectEl.innerHTML = `<option value="">Select customer…</option>${options}`;
    selectEl.value = current;
  },
  fillVehicleSelect(selectEl, row, selectedId = "") {
    if (!selectEl) return;
    const vehicles = this.customerVehicles(row);
    const current = String(selectedId || "");
    const currentKey = current.toUpperCase().replace(/[\s-]/g, "");
    const match = current
      ? vehicles.find((v) => {
          const id = v.id || v.registration;
          const plate = String(v.registration || "")
            .toUpperCase()
            .replace(/[\s-]/g, "");
          return id === current || v.registration === current || (currentKey && plate === currentKey);
        })
      : null;
    const selectedValue = match ? match.id || match.registration : "";
    const options = vehicles
      .map((v) => {
        const id = v.id || v.registration;
        const label = [v.registration, v.vehicle].filter(Boolean).join(" · ");
        const sel = selectedValue && id === selectedValue ? " selected" : "";
        return `<option value="${escapeAttr(id)}"${sel}>${escapeHtml(label || "Vehicle")}</option>`;
      })
      .join("");
    selectEl.innerHTML = `<option value="">Select vehicle…</option>${options}`;
    selectEl.value = selectedValue;
  },
  applyPartyToForm(form, row, vehicle) {
    if (!form) return;
    const set = (name, value) => {
      const el = form.elements.namedItem(name);
      if (el) el.value = String(value || "");
    };
    if (!row || !(row.customerId || row.customerName)) {
      set("customerId", "");
      set("customerName", "");
      set("customerEmail", "");
      set("customerPhone", "");
      set("vehicleId", "");
      set("registration", "");
      set("vehicle", "");
      return;
    }
    set("customerId", row.customerId || row.id || "");
    set("customerName", [row.firstName, row.lastName].filter(Boolean).join(" ") || row.customerName);
    set("customerEmail", row.customerEmail);
    set("customerPhone", row.customerPhone);
    if (vehicle) {
      set("vehicleId", vehicle.id || vehicle.registration || "");
      set("registration", vehicle.registration);
      set("vehicle", vehicle.vehicle);
    } else {
      set("vehicleId", "");
      set("registration", "");
      set("vehicle", "");
    }
  },
  setViewTitle(text) {
    viewTitle.textContent = text;
  },
  showBillingStatus(msg) {
    const el = document.getElementById("billing-save-status");
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
    setTimeout(() => {
      el.hidden = true;
    }, 2500);
  },
};

function showLogin() {
  loginView.hidden = false;
  app.hidden = true;
  const pinInput = document.getElementById("pin");
  if (pinInput) pinInput.value = "";
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  const value = document.getElementById("pin").value.trim();
  const submitBtn = loginForm.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";
  }
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ pin: value }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) {
      throw new Error(data.error || "Too many sign-in attempts. Try again later.");
    }
    if (res.status === 401) {
      throw new Error("Wrong PIN");
    }
    if (!res.ok) {
      throw new Error(data.error || `Server error (${res.status}). Is npm start running?`);
    }
    showApp();
    setSection("dashboard");
    await window.DeaneDashboard?.load?.();
  } catch (err) {
    loginError.hidden = false;
    const msg = err instanceof Error ? err.message : String(err);
    loginError.textContent = /Failed to fetch|NetworkError|Load failed/i.test(msg)
      ? "Cannot reach server. In the project folder run: npm start — then open http://localhost:5173/admin/"
      : msg;
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    }
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  try {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
  } catch {
    /* still sign out locally */
  }
  showLogin();
});

document.getElementById("nav-dashboard")?.addEventListener("click", () => {
  setSection("dashboard");
});

document.getElementById("nav-reports").addEventListener("click", async () => {
  setSection("reports");
  if (editView.hidden) {
    viewTitle.textContent = "Reports";
    await loadList();
  } else {
    viewTitle.textContent = current?.jobNumber || "Reports";
  }
});

document.getElementById("nav-jobs")?.addEventListener("click", () => {
  setSection("jobs");
  window.DeaneJobs?.showList();
});

document.getElementById("nav-quotes")?.addEventListener("click", () => {
  setSection("quotes");
  window.DeaneBilling?.showList({ kind: "quote", filter: "all" });
});

document.getElementById("nav-invoices")?.addEventListener("click", () => {
  setSection("invoices");
  window.DeaneBilling?.showList({ kind: "invoice", filter: "all" });
});

document.getElementById("nav-customers")?.addEventListener("click", () => {
  setSection("customers");
  viewTitle.textContent = "Customers";
  if (window.DeaneCustomers?.showList) {
    window.DeaneCustomers.showList();
  }
});

document.getElementById("btn-back").addEventListener("click", async () => {
  try {
    await reportAutosave.flush();
  } catch {
    /* still leave the editor */
  }
  reportAutosave.cancel();
  current = null;
  editView.hidden = true;
  listView.hidden = false;
  viewTitle.textContent = "Reports";
  await loadList();
});

document.getElementById("btn-new").addEventListener("click", async () => {
  const customersOpen = !document.getElementById("customers-section")?.hidden;
  if (customersOpen) {
    if (window.DeaneCustomers?.newCustomer) {
      window.DeaneCustomers.newCustomer();
    } else {
      const form = document.getElementById("customer-form");
      if (form) {
        form.hidden = false;
        form.removeAttribute("hidden");
        document.getElementById("customer-first-name")?.focus();
      }
    }
    return;
  }
  alert("Create a report from an invoice. Open the invoice and click Create report.");
});

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s-]/g, "");
}

function matchesReportSearch(report, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const name = String(report.customerName || "").toLowerCase();
  const plate = normalizeSearch(report.registration);
  const plateQuery = q.replace(/[\s-]/g, "");
  return name.includes(q) || plate.includes(plateQuery) || String(report.jobNumber || "").toLowerCase().includes(q);
}

function renderReportList() {
  if (!reportDocs.length) {
    reportList.innerHTML =
      '<div class="empty">No reports yet. Open an invoice and click <strong>Create report</strong>.</div>';
    return;
  }

  const query = reportSearch?.value || "";
  const reports = reportDocs.filter((r) => matchesReportSearch(r, query));
  if (!reports.length) {
    reportList.innerHTML =
      '<div class="empty">No matching customer name or plate.</div>';
    return;
  }

  reportList.innerHTML = reports
    .map(
      (r) => `
      <article class="report-card billing-card" data-id="${r.id}">
        <div class="billing-number">${escapeHtml(r.jobNumber)}</div>
        <div>
          <h2>${escapeHtml(r.customerName || "Customer")}</h2>
          <p class="muted">${escapeHtml(r.registration || "No plate")} · ${escapeHtml(r.serviceDate || "")} · ${escapeHtml(labelJob(r.jobType, r.servicePackage))} · ${escapeHtml(r.vehicle || "")}</p>
        </div>
        <span class="badge ${r.status}">${r.status}</span>
      </article>`
    )
    .join("");

  reportList.querySelectorAll(".report-card").forEach((card) => {
    card.addEventListener("click", () => openReport(card.dataset.id));
  });
}

async function loadList() {
  reportDocs = await api("/api/reports");
  renderReportList();
}

reportSearch?.addEventListener("input", renderReportList);
reportSearch?.addEventListener("search", renderReportList);

function labelJob(jobType, pkg) {
  const map = {
    standard_service: "Standard Service",
    premium_service: "Premium Service",
    full_service: "Premium Service",
    wof: "WOF",
    standard_wof: "Standard + WOF",
    premium_wof: "Premium + WOF",
    full_wof: "Premium + WOF",
    repair: "Repair",
  };
  if (map[jobType]) return map[jobType];
  if (pkg === "premium" || pkg === "full") return "Premium Service";
  if (pkg === "standard") return "Standard Service";
  return "Service";
}

function normalizePkg(pkg) {
  return pkg === "full" || pkg === "premium" ? "premium" : "standard";
}

async function openReport(id) {
  await loadReportCustomerDirectory();
  current = await api(`/api/reports/${id}`);
  listView.hidden = true;
  editView.hidden = false;
  viewTitle.textContent = current.jobNumber;
  fillForm(current);
  await renderChecklist(current.servicePackage, current.checks);
  renderActions(current);
  updatePhotos(current);
}

window.DeaneAdmin.openReport = openReport;

function normalizePlateSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s-]/g, "");
}

function selectedReportCustomer() {
  const id = reportCustomerSelect?.value || "";
  return reportCustomerDirectory.find((row) => row.customerId === id) || null;
}

function selectedReportVehicle(row) {
  const id = reportVehicleSelect?.value || "";
  const vehicles = window.DeaneAdmin.customerVehicles(row);
  const key = String(id)
    .toUpperCase()
    .replace(/[\s-]/g, "");
  return (
    vehicles.find(
      (v) =>
        v.id === id ||
        v.registration === id ||
        (key &&
          String(v.registration || "")
            .toUpperCase()
            .replace(/[\s-]/g, "") === key)
    ) || null
  );
}

function syncReportPartyFields() {
  const row = selectedReportCustomer();
  const vehicle = selectedReportVehicle(row);
  window.DeaneAdmin.applyPartyToForm(reportForm, row || {}, vehicle);
}

function refreshReportPartySelects(doc = current) {
  window.DeaneAdmin.fillCustomerSelect(
    reportCustomerSelect,
    reportCustomerDirectory,
    doc?.customerId || ""
  );
  const row = selectedReportCustomer();
  window.DeaneAdmin.fillVehicleSelect(
    reportVehicleSelect,
    row,
    doc?.vehicleId || doc?.registration || ""
  );
  syncReportPartyFields();
  if (!doc?.customerId && reportForm) {
    const set = (name, value) => {
      const el = reportForm.elements.namedItem(name);
      if (el && value) el.value = value;
    };
    set("customerName", doc?.customerName);
    set("customerEmail", doc?.customerEmail);
    set("customerPhone", doc?.customerPhone);
    set("registration", doc?.registration);
    set("vehicle", doc?.vehicle);
  }
}

async function loadReportCustomerDirectory() {
  try {
    reportCustomerDirectory = await api("/api/customers");
  } catch {
    reportCustomerDirectory = [];
  }
}

function fillForm(r) {
  const set = (name, value) => {
    const el = reportForm.elements.namedItem(name);
    if (!el) return;
    if (el.type === "checkbox") el.checked = Boolean(value);
    else el.value = value ?? "";
  };
  set("jobNumber", r.jobNumber);
  set("status", r.status);
  set("serviceDate", r.serviceDate);
  set("technicianName", r.technicianName);
  set(
    "jobType",
    r.jobType === "full_service"
      ? "premium_service"
      : r.jobType === "full_wof"
        ? "premium_wof"
        : r.jobType
  );
  set("servicePackage", normalizePkg(r.servicePackage));
  set("odometer", r.odometer);
  set("vin", r.vin);
  set("customerConcern", r.customerConcern);
  set("actionsOther", r.actionsOther);
  set("oilSpec", r.oilSpec);
  set("oilFilter", r.oilFilter);
  set("summary", r.summary);
  set("nextServiceDue", r.nextServiceDue);
  set("technicianComments", r.technicianComments);
  refreshReportPartySelects(r);
}

async function renderChecklist(pkg, checks) {
  checklistMeta = await fetch(`/api/checklist?package=${pkg}`).then((r) => r.json());
  checklistEl.innerHTML = checklistMeta.groups
    .map((group) => {
      const rows = group.items
        .map((item) => {
          const state = checks[item.code] || { status: "ok", note: "" };
          return `
          <div class="check-row" data-code="${item.code}">
            <div>
              <span class="code">${item.code}${item.wofFlag ? " · WOF-relevant" : ""}</span>
              ${escapeHtml(item.label)}
            </div>
            <select class="status-select status-${state.status}" data-status>
              <option value="ok" ${state.status === "ok" ? "selected" : ""}>OK</option>
              <option value="watch" ${state.status === "watch" ? "selected" : ""}>Watch</option>
              <option value="attention" ${state.status === "attention" ? "selected" : ""}>Attention</option>
              <option value="na" ${state.status === "na" ? "selected" : ""}>N/A</option>
            </select>
            <input data-note type="text" placeholder="Note for customer" value="${escapeAttr(state.note || "")}" />
          </div>`;
        })
        .join("");
      return `<div class="check-group"><h3>${escapeHtml(group.title)}</h3>${rows}</div>`;
    })
    .join("");

  checklistEl.querySelectorAll("[data-status]").forEach((sel) => {
    sel.addEventListener("change", () => {
      sel.className = `status-select status-${sel.value}`;
      scheduleReportAutosave();
    });
  });
  checklistEl.querySelectorAll("[data-note]").forEach((input) => {
    input.addEventListener("input", scheduleReportAutosave);
  });
}

function renderActions(r) {
  const pkg = normalizePkg(r.servicePackage);
  const blocks = [
    ...ACTIONS_FALLBACK.standard.map((a) => ({ ...a, group: "Standard" })),
    ...(pkg === "premium"
      ? ACTIONS_FALLBACK.premiumExtra.map((a) => ({ ...a, group: "Premium" }))
      : []),
    ...ACTIONS_FALLBACK.either.map((a) => ({ ...a, group: "Other" })),
  ];

  // Prefer live checklist actions if loaded
  const live = checklistMeta?.actions;
  const premiumActions = live?.premiumExtra || live?.fullExtra || [];
  const list = live
    ? [
        ...live.standard.map((a) => ({ ...a, group: "Standard" })),
        ...(pkg === "premium"
          ? premiumActions.map((a) => ({ ...a, group: "Premium" }))
          : []),
        ...live.either.map((a) => ({ ...a, group: "Other" })),
      ]
    : blocks;

  actionsEl.innerHTML = list
    .map((a) => {
      const checked = r.actionsDone?.[a.id] ? "checked" : "";
      return `<label><input type="checkbox" data-action="${a.id}" ${checked} /> ${escapeHtml(a.label)}</label>`;
    })
    .join("");
}

const ACTIONS_FALLBACK = {
  standard: [
    { id: "oil", label: "Engine oil replaced (full synthetic as quoted)" },
    { id: "oil_filter", label: "Oil filter replaced" },
    { id: "fluids", label: "Fluids checked / topped up" },
    { id: "battery", label: "Battery tested" },
    { id: "air_filter", label: "Air filter checked" },
    { id: "exterior_lights", label: "Exterior lights & indicators checked" },
    { id: "dashboard_lights", label: "Dashboard warning lights checked" },
    { id: "tyre_pressures", label: "Tyre pressures set" },
    { id: "service_light", label: "Service light reset (where possible)" },
    { id: "digital_report", label: "Digital service report prepared" },
  ],
  premiumExtra: [
    { id: "wheels_on", label: "Brake inspection completed (wheels on)" },
    { id: "wheels_off", label: "Road wheels removed — brake inspection" },
    { id: "brakes_measured", label: "Brake pads / discs inspected (wheels off)" },
    { id: "steering_suspension", label: "Steering / CV boots & suspension checked" },
    { id: "spark_plugs", label: "Spark plugs inspected" },
    { id: "cabin_filter", label: "Cabin / pollen filter checked" },
    { id: "diagnostic", label: "Diagnostic scan completed" },
    { id: "road_test", label: "Road test completed" },
  ],
  either: [
    { id: "cabin_filter_replaced", label: "Cabin filter replaced" },
    { id: "coolant", label: "Coolant replaced" },
    { id: "brake_flush", label: "Brake fluid flushed" },
    { id: "transmission", label: "Transmission service" },
    { id: "spark_plugs_replaced", label: "Spark plugs replaced" },
  ],
};

function collectPayload() {
  const f = reportForm;
  const checks = {};
  checklistEl.querySelectorAll(".check-row").forEach((row) => {
    checks[row.dataset.code] = {
      status: row.querySelector("[data-status]").value,
      note: row.querySelector("[data-note]").value.trim(),
    };
  });
  const actionsDone = {};
  actionsEl.querySelectorAll("[data-action]").forEach((box) => {
    actionsDone[box.dataset.action] = box.checked;
  });

  return {
    serviceDate: f.serviceDate.value,
    technicianName: f.technicianName.value.trim(),
    jobType: f.jobType.value,
    servicePackage: f.servicePackage.value,
    customerId: f.customerId?.value || "",
    vehicleId: f.vehicleId?.value || "",
    customerName: f.customerName.value.trim(),
    customerEmail: f.customerEmail.value.trim(),
    customerPhone: f.customerPhone.value.trim(),
    registration: f.registration.value.trim(),
    vehicle: f.vehicle.value.trim(),
    odometer: f.odometer.value.trim(),
    vin: f.vin.value.trim(),
    customerConcern: f.customerConcern.value.trim(),
    checks,
    actionsDone,
    actionsOther: f.actionsOther.value.trim(),
    oilSpec: f.oilSpec.value.trim(),
    oilFilter: f.oilFilter.value.trim(),
    summary: f.summary.value.trim(),
    nextServiceDue: f.nextServiceDue.value.trim(),
    technicianComments: f.technicianComments.value.trim(),
    wof: current?.wof || {
      performed: false,
      result: "not_completed",
      expiry: "",
      reference: "",
      failNotes: "",
      repairsForPass: "",
      recheckRequired: false,
    },
  };
}

async function saveReport(opts = {}) {
  if (!current) return null;
  const payload = collectPayload();
  current = await api(`/api/reports/${current.id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  reportForm.elements.namedItem("status").value = current.status;
  showStatus(opts.autosave ? "Autosaved" : "Saved");
  return current;
}

const reportAutosave = window.DeaneAdmin.createAutosave({
  isReady: () =>
    Boolean(current && !editView.hidden && reportCustomerSelect?.value && reportVehicleSelect?.value),
  save: () => saveReport({ autosave: true }),
  onSaving: (msg) => {
    if (msg) showStatus(msg);
  },
  onError: (err) => showStatus(err.message || "Save failed"),
});

function scheduleReportAutosave() {
  reportAutosave.schedule();
}

document.getElementById("btn-save").addEventListener("click", async () => {
  try {
    const beforePkg = current.servicePackage;
    await saveReport();
    if (current.servicePackage !== beforePkg) {
      await renderChecklist(current.servicePackage, current.checks);
      renderActions(current);
    }
  } catch (err) {
    alert(err.message);
  }
});

reportCustomerSelect?.addEventListener("change", async () => {
  const customerId = reportCustomerSelect.value;
  await loadReportCustomerDirectory();
  window.DeaneAdmin.fillCustomerSelect(reportCustomerSelect, reportCustomerDirectory, customerId);
  window.DeaneAdmin.fillVehicleSelect(reportVehicleSelect, selectedReportCustomer(), "");
  syncReportPartyFields();
  scheduleReportAutosave();
});
reportVehicleSelect?.addEventListener("change", () => {
  syncReportPartyFields();
  scheduleReportAutosave();
});

document.getElementById("servicePackage").addEventListener("change", async () => {
  if (!current) return;
  const pkg = normalizePkg(reportForm.servicePackage.value);
  reportForm.servicePackage.value = pkg;
  const checks = collectPayload().checks;
  await renderChecklist(pkg, checks);
  current.servicePackage = pkg;
  renderActions({ ...current, servicePackage: pkg, actionsDone: collectPayload().actionsDone });
});

reportForm.elements.namedItem("jobType").addEventListener("change", async () => {
  if (!current) return;
  const jobType = reportForm.elements.namedItem("jobType").value;
  if (jobType.startsWith("premium") || jobType.startsWith("full")) {
    reportForm.servicePackage.value = "premium";
  } else if (jobType.startsWith("standard")) {
    reportForm.servicePackage.value = "standard";
  } else {
    return;
  }
  document.getElementById("servicePackage").dispatchEvent(new Event("change"));
});

document.querySelectorAll("[data-bulk]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const status = btn.dataset.bulk;
    checklistEl.querySelectorAll("[data-status]").forEach((sel) => {
      sel.value = status;
      sel.className = `status-select status-${status}`;
    });
    scheduleReportAutosave();
  });
});

reportForm.addEventListener("input", scheduleReportAutosave);
reportForm.addEventListener("change", scheduleReportAutosave);
actionsEl.addEventListener("change", scheduleReportAutosave);
window.addEventListener("beforeunload", () => {
  reportAutosave.flush();
});

document.getElementById("btn-publish").addEventListener("click", async () => {
  try {
    await saveReport();
    current = await api(`/api/reports/${current.id}/publish`, { method: "POST", body: "{}" });
    reportForm.elements.namedItem("status").value = current.status;
    const url = current.viewToken
      ? `${location.origin}/r/${current.id}?v=${encodeURIComponent(current.viewToken)}`
      : `${location.origin}/r/${current.id}`;
    await navigator.clipboard.writeText(url);
    showStatus("Published — link copied");
    alert(`Report published.\n\nCustomer link:\n${url}\n\n(Link copied to clipboard)`);
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("btn-email").addEventListener("click", async () => {
  const btn = document.getElementById("btn-email");
  try {
    await saveReport();
    if (!current.customerEmail) {
      throw new Error("Add the customer email on this report first.");
    }
    if (!confirmPublicCustomerLink("report")) return;
    btn.disabled = true;
    btn.textContent = "Sending…";
    const result = await api(`/api/reports/${current.id}/email`, {
      method: "POST",
      body: JSON.stringify({ baseUrl: location.origin }),
    });
    current = result.report || current;
    reportForm.elements.namedItem("status").value = current.status;
    showStatus(`Email sent to ${result.to}`);
    alert(`Email sent to ${result.to}\n\nReport link:\n${result.reportUrl}`);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Email customer";
  }
});

document.getElementById("btn-delete").addEventListener("click", async () => {
  if (!current || !confirm("Delete this report permanently?")) return;
  reportAutosave.cancel();
  try {
    await api(`/api/reports/${current.id}`, { method: "DELETE" });
    current = null;
    editView.hidden = true;
    listView.hidden = false;
    viewTitle.textContent = "Reports";
    await loadList();
  } catch (err) {
    alert(err.message);
  }
});

photoInput?.addEventListener("change", async () => {
  if (!current || !photoInput.files?.length) return;
  const body = new FormData();
  for (const file of photoInput.files) {
    body.append("photos", file);
  }
  try {
    current = await api(`/api/reports/${current.id}/photo`, {
      method: "POST",
      body,
    });
    updatePhotos(current);
    showStatus(photoInput.files.length > 1 ? "Photos uploaded" : "Photo uploaded");
  } catch (err) {
    alert(err.message);
  } finally {
    photoInput.value = "";
  }
});

function reportPhotoList(report) {
  const listed = Array.isArray(report?.vehiclePhotos)
    ? report.vehiclePhotos.map((p) => String(p || "").trim()).filter(Boolean)
    : [];
  if (listed.length) return listed;
  const single = String(report?.vehiclePhoto || "").trim();
  return single ? [single] : [];
}

function updatePhotos(report) {
  if (!vehiclePhotosEl) return;
  const photos = reportPhotoList(report);
  if (!photos.length) {
    vehiclePhotosEl.innerHTML = "";
    return;
  }
  vehiclePhotosEl.innerHTML = photos
    .map(
      (src) => `
      <span class="photo-thumb">
        <img src="${escapeAttr(src)}" alt="Vehicle photo" />
        <button type="button" class="ghost photo-remove" data-photo="${escapeAttr(src)}" aria-label="Remove photo">×</button>
      </span>`
    )
    .join("");
  vehiclePhotosEl.querySelectorAll("[data-photo]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!current) return;
      try {
        current = await api(`/api/reports/${current.id}/photo?url=${encodeURIComponent(btn.dataset.photo)}`, {
          method: "DELETE",
        });
        updatePhotos(current);
        showStatus("Photo removed");
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("'", "&#39;");
}

(async function boot() {
  try {
    await api("/api/admin/session");
    showApp();
    setSection("dashboard");
    await window.DeaneDashboard?.load?.();
  } catch {
    showLogin();
  }
})();
