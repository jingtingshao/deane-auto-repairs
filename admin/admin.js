const PIN_KEY = "deane_admin_pin";

const loginView = document.getElementById("login-view");
const app = document.getElementById("app");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const listView = document.getElementById("list-view");
const editView = document.getElementById("edit-view");
const reportList = document.getElementById("report-list");
const reportForm = document.getElementById("report-form");
const checklistEl = document.getElementById("checklist");
const actionsEl = document.getElementById("actions");
const saveStatus = document.getElementById("save-status");
const viewTitle = document.getElementById("view-title");
const vehiclePhoto = document.getElementById("vehicle-photo");
const photoInput = document.getElementById("photo-input");

let pin = sessionStorage.getItem(PIN_KEY) || "";
let current = null;
let checklistMeta = null;

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (pin) headers["X-Admin-Pin"] = pin;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
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

function showLogin() {
  loginView.hidden = false;
  app.hidden = true;
  pin = "";
  sessionStorage.removeItem(PIN_KEY);
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
      body: JSON.stringify({ pin: value }),
    });
    if (res.status === 401) {
      throw new Error("Wrong PIN. Default is deane123 — start with: npm start");
    }
    if (!res.ok) {
      throw new Error(`Server error (${res.status}). Is npm start running?`);
    }
    pin = value;
    sessionStorage.setItem(PIN_KEY, pin);
    showApp();
    await loadList();
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

document.getElementById("btn-logout").addEventListener("click", showLogin);

document.getElementById("btn-back").addEventListener("click", async () => {
  current = null;
  editView.hidden = true;
  listView.hidden = false;
  viewTitle.textContent = "Reports";
  await loadList();
});

document.getElementById("btn-new").addEventListener("click", async () => {
  try {
    const report = await api("/api/reports", {
      method: "POST",
      body: JSON.stringify({
        serviceDate: new Date().toISOString().slice(0, 10),
        jobType: "standard_service",
        servicePackage: "standard",
      }),
    });
    await openReport(report.id);
  } catch (err) {
    alert(err.message);
  }
});

async function loadList() {
  const reports = await api("/api/reports");
  if (!reports.length) {
    reportList.innerHTML =
      '<div class="empty">No reports yet. Click <strong>New report</strong> to start.</div>';
    return;
  }
  reportList.innerHTML = reports
    .map(
      (r) => `
      <article class="report-card" data-id="${r.id}">
        <div>
          <h2>${escapeHtml(r.registration || "No plate")} · ${escapeHtml(r.customerName || "Customer")}</h2>
          <p class="muted">${escapeHtml(r.jobNumber)} · ${escapeHtml(r.serviceDate || "")} · ${escapeHtml(labelJob(r.jobType, r.servicePackage))} · ${escapeHtml(r.vehicle || "")}</p>
        </div>
        <span class="badge ${r.status}">${r.status}</span>
      </article>`
    )
    .join("");

  reportList.querySelectorAll(".report-card").forEach((card) => {
    card.addEventListener("click", () => openReport(card.dataset.id));
  });
}

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
  current = await api(`/api/reports/${id}`);
  listView.hidden = true;
  editView.hidden = false;
  viewTitle.textContent = current.jobNumber;
  fillForm(current);
  await renderChecklist(current.servicePackage, current.checks);
  renderActions(current);
  updatePhoto(current.vehiclePhoto);
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
  set("customerName", r.customerName);
  set("customerEmail", r.customerEmail);
  set("customerPhone", r.customerPhone);
  set("registration", r.registration);
  set("vehicle", r.vehicle);
  set("odometer", r.odometer);
  set("vin", r.vin);
  set("customerConcern", r.customerConcern);
  set("actionsOther", r.actionsOther);
  set("oilSpec", r.oilSpec);
  set("oilFilter", r.oilFilter);
  set("summary", r.summary);
  set("nextServiceDue", r.nextServiceDue);
  set("technicianComments", r.technicianComments);
  set("wofPerformed", r.wof?.performed);
  set("wofResult", r.wof?.result || "not_completed");
  set("wofExpiry", r.wof?.expiry || "");
  set("wofReference", r.wof?.reference || "");
  set("wofFailNotes", r.wof?.failNotes || "");
  set("wofRepairs", r.wof?.repairsForPass || "");
  set("wofRecheck", r.wof?.recheckRequired);
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
    });
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
    wof: {
      performed: f.wofPerformed.checked,
      result: f.wofResult.value,
      expiry: f.wofExpiry.value,
      reference: f.wofReference.value.trim(),
      failNotes: f.wofFailNotes.value.trim(),
      repairsForPass: f.wofRepairs.value.trim(),
      recheckRequired: f.wofRecheck.checked,
    },
  };
}

async function saveReport() {
  if (!current) return null;
  const payload = collectPayload();
  current = await api(`/api/reports/${current.id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  reportForm.elements.namedItem("status").value = current.status;
  showStatus("Saved");
  return current;
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
  });
});

document.getElementById("btn-publish").addEventListener("click", async () => {
  try {
    await saveReport();
    current = await api(`/api/reports/${current.id}/publish`, { method: "POST", body: "{}" });
    reportForm.elements.namedItem("status").value = current.status;
    const url = `${location.origin}/r/${current.id}`;
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

photoInput.addEventListener("change", async () => {
  if (!current || !photoInput.files?.[0]) return;
  const body = new FormData();
  body.append("photo", photoInput.files[0]);
  try {
    const res = await fetch(`/api/reports/${current.id}/photo`, {
      method: "POST",
      headers: { "X-Admin-Pin": pin },
      body,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    current = data;
    updatePhoto(current.vehiclePhoto);
    showStatus("Photo uploaded");
  } catch (err) {
    alert(err.message);
  }
});

function updatePhoto(src) {
  if (src) {
    vehiclePhoto.src = src;
    vehiclePhoto.hidden = false;
  } else {
    vehiclePhoto.hidden = true;
    vehiclePhoto.removeAttribute("src");
  }
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
  if (!pin) return;
  try {
    await api("/api/reports");
    showApp();
    await loadList();
  } catch {
    showLogin();
  }
})();
