const PIN_KEY = "deane_admin_pin";

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
const vehiclePhoto = document.getElementById("vehicle-photo");
const photoInput = document.getElementById("photo-input");

let pin = sessionStorage.getItem(PIN_KEY) || "";
let current = null;
let checklistMeta = null;
let reportDocs = [];
let reportCustomerDirectory = [];
const reportCustomerSuggestEl = document.getElementById("report-customer-suggest");
const reportRegoSuggestEl = document.getElementById("report-rego-suggest");

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

function setSection(name) {
  const dashboardSection = document.getElementById("dashboard-section");
  const reportsSection = document.getElementById("reports-section");
  const billingSection = document.getElementById("billing-section");
  const customersSection = document.getElementById("customers-section");
  const jobsSection = document.getElementById("jobs-section");
  const btnNew = document.getElementById("btn-new");
  if (dashboardSection) dashboardSection.hidden = name !== "dashboard";
  if (reportsSection) reportsSection.hidden = name !== "reports";
  if (billingSection) billingSection.hidden = name !== "billing";
  if (customersSection) customersSection.hidden = name !== "customers";
  if (jobsSection) jobsSection.hidden = name !== "jobs";
  if (btnNew) {
    btnNew.hidden = name !== "reports" && name !== "customers" && name !== "jobs";
    btnNew.textContent =
      name === "customers" ? "New customer" : name === "jobs" ? "New job" : "New report";
  }
  document.getElementById("nav-dashboard")?.classList.toggle("is-active", name === "dashboard");
  document.getElementById("nav-reports")?.classList.toggle("is-active", name === "reports");
  document.getElementById("nav-billing")?.classList.toggle("is-active", name === "billing");
  document.getElementById("nav-customers")?.classList.toggle("is-active", name === "customers");
  document.getElementById("nav-jobs")?.classList.toggle("is-active", name === "jobs");
  if (name === "reports" && listView && !listView.hidden) {
    viewTitle.textContent = "Reports";
  }
  if (name === "dashboard") {
    viewTitle.textContent = "Dashboard";
    window.DeaneDashboard?.load?.();
  }
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
    setSection("dashboard");
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

document.getElementById("nav-billing").addEventListener("click", () => {
  setSection("billing");
  window.DeaneBilling?.showList();
});

document.getElementById("nav-customers")?.addEventListener("click", () => {
  setSection("customers");
  viewTitle.textContent = "Customers";
  if (window.DeaneCustomers?.showList) {
    window.DeaneCustomers.showList();
  }
});

document.getElementById("btn-back").addEventListener("click", async () => {
  current = null;
  editView.hidden = true;
  listView.hidden = false;
  viewTitle.textContent = "Reports";
  await loadList();
});

document.getElementById("btn-new").addEventListener("click", async () => {
  const customersOpen = !document.getElementById("customers-section")?.hidden;
  const jobsOpen = !document.getElementById("jobs-section")?.hidden;
  if (customersOpen) {
    if (window.DeaneCustomers?.newCustomer) {
      window.DeaneCustomers.newCustomer();
    } else {
      const form = document.getElementById("customer-form");
      if (form) {
        form.hidden = false;
        form.removeAttribute("hidden");
        document.getElementById("customer-name")?.focus();
      }
    }
    return;
  }
  if (jobsOpen) {
    try {
      await window.DeaneJobs.createJob();
    } catch (err) {
      alert(err.message);
    }
    return;
  }
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
  return name.includes(q) || plate.includes(plateQuery);
}

function renderReportList() {
  if (!reportDocs.length) {
    reportList.innerHTML =
      '<div class="empty">No reports yet. Click <strong>New report</strong> to start.</div>';
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
  if (!reportCustomerDirectory.length) await loadReportCustomerDirectory();
  current = await api(`/api/reports/${id}`);
  listView.hidden = true;
  editView.hidden = false;
  viewTitle.textContent = current.jobNumber;
  fillForm(current);
  hideReportSuggest(reportCustomerSuggestEl);
  hideReportSuggest(reportRegoSuggestEl);
  await renderChecklist(current.servicePackage, current.checks);
  renderActions(current);
  updatePhoto(current.vehiclePhoto);
}

window.DeaneAdmin.openReport = openReport;

function normalizePlateSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s-]/g, "");
}

function customerPlates(row) {
  if (Array.isArray(row.registrations) && row.registrations.length) {
    return row.registrations.map((p) => String(p || "").trim()).filter(Boolean);
  }
  if (Array.isArray(row.vehicles) && row.vehicles.length) {
    return row.vehicles.map((v) => String(v.registration || "").trim()).filter(Boolean);
  }
  return String(row.registration || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

async function loadReportCustomerDirectory() {
  try {
    reportCustomerDirectory = await api("/api/customers");
  } catch {
    reportCustomerDirectory = [];
  }
}

function hideReportSuggest(el) {
  if (!el) return;
  el.hidden = true;
  el.innerHTML = "";
}

function applyCustomerToReport(row, preferredPlate = "") {
  if (!row || !reportForm) return;
  const set = (name, value) => {
    const el = reportForm.elements.namedItem(name);
    if (!el) return;
    const next = String(value || "").trim();
    if (next) el.value = next;
  };
  set("customerName", row.customerName);
  set("customerEmail", row.customerEmail);
  set("customerPhone", row.customerPhone);

  const vehicles = Array.isArray(row.vehicles) ? row.vehicles : [];
  const want = normalizePlateSearch(preferredPlate);
  let pick =
    (want &&
      vehicles.find((v) => normalizePlateSearch(v.registration) === want)) ||
    vehicles[0] ||
    null;
  if (pick) {
    set("registration", pick.registration);
    if (pick.vehicle) set("vehicle", pick.vehicle);
    else if (row.vehicle) set("vehicle", row.vehicle);
  } else {
    const plates = customerPlates(row);
    if (plates.length) set("registration", plates[0]);
    if (row.vehicle) set("vehicle", row.vehicle);
  }
  hideReportSuggest(reportCustomerSuggestEl);
  hideReportSuggest(reportRegoSuggestEl);
  showStatus("Customer details filled");
}

function matchReportCustomers(query, field) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const plateQuery = normalizePlateSearch(q);
  const out = [];
  for (const row of reportCustomerDirectory) {
    if (field === "registration") {
      for (const plate of customerPlates(row)) {
        if (normalizePlateSearch(plate).includes(plateQuery)) {
          out.push({
            ...row,
            _matchPlate: plate,
            _matchVehicle:
              (row.vehicles || []).find(
                (v) => normalizePlateSearch(v.registration) === normalizePlateSearch(plate)
              )?.vehicle || row.vehicle || "",
          });
        }
      }
    } else {
      const name = String(row.customerName || "").toLowerCase();
      if (name.includes(q)) out.push(row);
    }
    if (out.length >= 8) break;
  }
  return out.slice(0, 8);
}

function renderReportSuggest(el, matches, field) {
  if (!el) return;
  if (!matches.length) {
    hideReportSuggest(el);
    return;
  }
  el.hidden = false;
  el.innerHTML = matches
    .map((row, index) => {
      const plate = row._matchPlate || customerPlates(row).join(", ");
      const line = [row.customerName, plate, row.customerPhone].filter(Boolean).join(" · ");
      return `<button type="button" data-match="${index}">${escapeHtml(line || "Customer")}</button>`;
    })
    .join("");
  el.querySelectorAll("[data-match]").forEach((btn) => {
    btn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const row = matches[Number(btn.dataset.match)];
      applyCustomerToReport(row, field === "registration" ? row._matchPlate : "");
    });
  });
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

document.getElementById("report-customer-name")?.addEventListener("input", () => {
  renderReportSuggest(
    reportCustomerSuggestEl,
    matchReportCustomers(reportForm.elements.namedItem("customerName")?.value, "name"),
    "name"
  );
});

document.getElementById("report-customer-name")?.addEventListener("blur", () => {
  const name = String(reportForm.elements.namedItem("customerName")?.value || "")
    .trim()
    .toLowerCase();
  const exact = reportCustomerDirectory.filter(
    (row) => String(row.customerName || "").trim().toLowerCase() === name
  );
  if (exact.length === 1) {
    applyCustomerToReport(exact[0]);
    return;
  }
  setTimeout(() => {
    if (
      reportCustomerSuggestEl &&
      !reportCustomerSuggestEl.contains(document.activeElement)
    ) {
      hideReportSuggest(reportCustomerSuggestEl);
    }
  }, 150);
});

document.getElementById("report-registration")?.addEventListener("input", () => {
  renderReportSuggest(
    reportRegoSuggestEl,
    matchReportCustomers(reportForm.elements.namedItem("registration")?.value, "registration"),
    "registration"
  );
});

document.getElementById("report-registration")?.addEventListener("blur", () => {
  const plate = normalizePlateSearch(reportForm.elements.namedItem("registration")?.value);
  const matches = matchReportCustomers(
    reportForm.elements.namedItem("registration")?.value,
    "registration"
  );
  const exact = matches.filter(
    (row) => normalizePlateSearch(row._matchPlate || "") === plate
  );
  if (exact.length === 1) applyCustomerToReport(exact[0], exact[0]._matchPlate);
  setTimeout(() => {
    if (reportRegoSuggestEl && !reportRegoSuggestEl.contains(document.activeElement)) {
      hideReportSuggest(reportRegoSuggestEl);
    }
  }, 150);
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
    setSection("reports");
    await loadList();
  } catch {
    showLogin();
  }
})();
