(function () {
var Admin = window.DeaneAdmin;

const JOB_STATUSES = [
  { id: "waiting_parts", label: "Waiting parts" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Ready to collect" },
  { id: "collected", label: "Collected" },
];
const PART_LINE_STATUSES = [
  { id: "draft", label: "Draft" },
  { id: "matched", label: "Matched" },
  { id: "approved", label: "Approved" },
  { id: "billed", label: "Billed" },
  { id: "rejected", label: "Rejected" },
];

const jobsListView = document.getElementById("jobs-list-view");
const jobsEditView = document.getElementById("jobs-edit-view");
const jobsList = document.getElementById("jobs-list");
const jobsSearch = document.getElementById("jobs-search");
const jobsFilter = document.getElementById("jobs-filter");
const jobsForm = document.getElementById("jobs-form");
const jobsPartsEl = document.getElementById("jobs-parts");
const jobsQuoteLink = document.getElementById("jobs-quote-link");
const createQuoteBtn = document.getElementById("btn-jobs-create-quote");
const createInvoiceBtn = document.getElementById("btn-jobs-create-invoice");
const openQuoteBtn = document.getElementById("btn-jobs-open-quote");
const attachInvoiceBtn = document.getElementById("btn-jobs-attach-invoice");
const collectBtn = document.getElementById("btn-jobs-collected");
const jobsYearSelect = document.getElementById("jobs-year");
const jobsYearLabel = document.getElementById("jobs-year-label");
const jobWorkPhotosInput = document.getElementById("job-work-photos-input");
const jobWorkPhotosEl = document.getElementById("job-work-photos");
const jobSupplierPhotosInput = document.getElementById("job-supplier-photos-input");
const jobSupplierPhotosEl = document.getElementById("job-supplier-photos");

function sentenceCase(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const lower = text.toLocaleLowerCase("en-NZ");
  return lower.charAt(0).toLocaleUpperCase("en-NZ") + lower.slice(1);
}

let currentJob = null;
let jobRows = [];
let partRows = [];
let jobFilter = "active";
let jobYear = String(new Date().getFullYear());
let jobMonth = "";

function statusLabel(id) {
  return JOB_STATUSES.find((s) => s.id === id)?.label || id || "";
}

function newPart(partial = {}) {
  const qty = Number(partial.qty);
  const costPrice = Number(partial.costPrice);
  const markupPercent = Number(partial.markupPercent);
  const sellPrice =
    partial.sellPrice != null && partial.sellPrice !== ""
      ? Number(partial.sellPrice)
      : (Number.isFinite(costPrice) ? costPrice : 0) *
        (1 + (Number.isFinite(markupPercent) ? markupPercent : 25) / 100);
  return {
    id: partial.id || crypto.randomUUID(),
    partNumber: partial.partNumber || "",
    description: partial.description || "",
    qty: Number.isFinite(qty) ? qty : 1,
    costPrice: Number.isFinite(costPrice) ? costPrice : 0,
    markupPercent: Number.isFinite(markupPercent) ? markupPercent : 25,
    sellPrice: Number.isFinite(sellPrice) ? sellPrice : 0,
    ordered: Boolean(partial.ordered) || Boolean(partial.received),
    received: Boolean(partial.received),
    supplier: partial.supplier || "",
    supplierInvoiceNo: partial.supplierInvoiceNo || "",
    status: partial.status || "draft",
    note: partial.note || "",
  };
}

function partsLabel(job) {
  const total = Number(job.partsTotal) || 0;
  const received = Number(job.partsReceived) || 0;
  if (!total) return null;
  if (received >= total) return { text: "Parts in", cls: "parts-ok" };
  return { text: `${received}/${total} parts in`, cls: "parts-wait" };
}

function renderFilters() {
  if (!jobsFilter) return;
  if (!jobsFilter.dataset.ready) {
    jobsFilter.innerHTML = [
      `<button type="button" class="ghost" data-filter="active">Active</button>`,
      `<button type="button" class="ghost" data-filter="waiting_parts">Waiting parts</button>`,
      `<button type="button" class="ghost" data-filter="in_progress">In progress</button>`,
      `<button type="button" class="ghost" data-filter="completed">Ready to collect</button>`,
      `<button type="button" class="ghost" data-filter="collected_month">Collected this month</button>`,
      `<button type="button" class="ghost" data-filter="collected">All history</button>`,
    ].join("");
    jobsFilter.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        jobFilter = btn.dataset.filter;
        if (jobFilter === "collected_month") jobMonth = Admin.todayIso().slice(0, 7);
        renderFilters();
        Admin.setViewTitle(jobListTitle());
        renderJobList();
      });
    });
    jobsFilter.dataset.ready = "1";
  }
  jobsFilter.querySelectorAll("[data-filter]").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.filter === jobFilter);
  });
  if (jobsYearLabel) jobsYearLabel.hidden = jobFilter !== "collected";
}

function archiveDate(job) {
  return String(job.collectedAt || job.updatedAt || job.createdAt || "").slice(0, 10);
}

function currentMonthKey() {
  return jobMonth || Admin.todayIso().slice(0, 7);
}

function activityMonthLabel() {
  const [year, month] = currentMonthKey().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleString("en-NZ", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function jobListTitle() {
  if (jobFilter === "waiting_parts") return "Waiting parts";
  if (jobFilter === "in_progress") return "Jobs in progress";
  if (jobFilter === "completed") return "Ready to collect";
  if (jobFilter === "collected_month") return `Collected · ${activityMonthLabel()}`;
  if (jobFilter === "collected") return `Job history · ${jobYear}`;
  return "Active jobs";
}

function renderYearFilter() {
  if (!jobsYearSelect) return;
  const currentYear = Admin.todayIso().slice(0, 4);
  const years = new Set([currentYear]);
  jobRows.forEach((job) => {
    if (job.status !== "collected") return;
    const year = archiveDate(job).slice(0, 4);
    if (/^\d{4}$/.test(year)) years.add(year);
  });
  const ordered = [...years].sort((a, b) => b.localeCompare(a));
  if (!ordered.includes(jobYear)) jobYear = currentYear;
  jobsYearSelect.innerHTML = ordered
    .map(
      (year) =>
        `<option value="${Admin.escapeAttr(year)}"${year === jobYear ? " selected" : ""}>${Admin.escapeHtml(year)}</option>`
    )
    .join("");
  jobsYearSelect.value = jobYear;
  if (jobsYearLabel) jobsYearLabel.hidden = jobFilter !== "collected";
}

function fillStatusSelect(selected) {
  const sel = jobsForm?.elements.namedItem("status");
  if (!sel) return;
  sel.innerHTML = JOB_STATUSES.map(
    (s) =>
      `<option value="${Admin.escapeAttr(s.id)}" ${s.id === selected ? "selected" : ""}>${Admin.escapeHtml(s.label)}</option>`
  ).join("");
}

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s-]/g, "");
}

function formatJobDate(value) {
  return Admin.formatDateShort(value) || "—";
}

function matchesJobSearch(job, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return true;
  const name = String(job.customerName || "").toLowerCase();
  const plate = normalizeSearch(job.registration);
  const plateQuery = q.replace(/[\s-]/g, "");
  const number = String(job.number || "").toLowerCase();
  return name.includes(q) || plate.includes(plateQuery) || number.includes(q);
}

function renderJobList() {
  if (!jobsList) return;
  if (!jobRows.length) {
    jobsList.innerHTML =
      '<div class="empty">No job cards yet. Saving an invoice creates one automatically — or open the invoice and click <strong>Open job card</strong>.</div>';
    return;
  }

  const query = jobsSearch?.value || "";
  const jobs = jobRows.filter((job) => {
    if (jobFilter === "active" && job.status === "collected") return false;
    if (jobFilter === "collected_month") {
      if (job.status !== "collected" || !archiveDate(job).startsWith(currentMonthKey())) {
        return false;
      }
    } else if (jobFilter === "collected") {
      if (job.status !== "collected" || !archiveDate(job).startsWith(`${jobYear}-`)) {
        return false;
      }
    } else if (
      jobFilter !== "active" &&
      jobFilter !== "collected_month" &&
      job.status !== jobFilter
    ) {
      return false;
    }
    return matchesJobSearch(job, query);
  });
  if (!jobs.length) {
    const label =
      jobFilter === "waiting_parts"
        ? "waiting for parts"
        : jobFilter === "in_progress"
          ? "in progress"
          : jobFilter === "completed"
            ? "ready to collect"
            : jobFilter === "collected_month"
              ? "collected this month"
              : jobFilter === "collected"
                ? `collected in ${jobYear}`
                : "matching";
    jobsList.innerHTML = `<div class="empty">No vehicles ${Admin.escapeHtml(label)}.</div>`;
    return;
  }

  jobsList.innerHTML = `
    <div class="billing-table-wrap">
      <table class="billing-table job-list-table">
        <thead>
          <tr>
            <th>Job number</th>
            <th>Date</th>
            <th>Customer name</th>
            <th>Plate</th>
            <th>Vehicle</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${jobs
            .map((job) => {
              const parts = partsLabel(job);
              return `<tr class="job-row" data-id="${Admin.escapeAttr(job.id)}">
                <td class="billing-number">${Admin.escapeHtml(job.number || "—")}</td>
                <td>${Admin.escapeHtml(formatJobDate(job.createdAt || job.updatedAt))}</td>
                <td>${Admin.escapeHtml(job.customerName || "—")}</td>
                <td>${Admin.escapeHtml(job.registration || "—")}</td>
                <td>${Admin.escapeHtml(job.vehicle || "—")}</td>
                <td class="job-table-status">
                  <span class="badge ${Admin.escapeAttr(job.status)}">${Admin.escapeHtml(statusLabel(job.status))}</span>
                  ${parts ? `<span class="badge ${Admin.escapeAttr(parts.cls)}">${Admin.escapeHtml(parts.text)}</span>` : ""}
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;

  jobsList.querySelectorAll(".job-row").forEach((row) => {
    row.addEventListener("click", () => openJob(row.dataset.id));
  });
}

function syncStatusFromParts() {
  const statusEl = jobInput("status");
  if (!statusEl) return;
  const next = suggestStatusFromParts(statusEl.value || "in_progress", partRows);
  if (next !== statusEl.value) {
    fillStatusSelect(next);
    statusEl.value = next;
  }
}

function suggestStatusFromParts(currentStatus, parts) {
  if (currentStatus === "completed" || currentStatus === "collected") {
    return currentStatus;
  }
  const rows = (parts || []).filter((p) => String(p.description || "").trim());
  if (!rows.length) return "in_progress";
  if (rows.some((p) => !p.received)) return "waiting_parts";
  return "in_progress";
}

function renderParts() {
  if (!jobsPartsEl) return;
  if (!partRows.length) partRows = [newPart()];
  jobsPartsEl.innerHTML = partRows
    .map(
      (part, index) => `<tr data-index="${index}">
        <td><input data-field="partNumber" value="${Admin.escapeAttr(part.partNumber || "")}" placeholder="Part #" /></td>
        <td class="part-name-cell"><input data-field="description" value="${Admin.escapeAttr(part.description)}" placeholder="e.g. Front pads" /></td>
        <td><input class="qty" data-field="qty" type="number" min="0" step="1" value="${Admin.escapeAttr(String(part.qty))}" /></td>
        <td><input class="price" data-field="costPrice" type="number" min="0" step="0.01" value="${Admin.escapeAttr(String(part.costPrice || 0))}" /></td>
        <td class="check-cell"><input data-field="ordered" type="checkbox" ${part.ordered ? "checked" : ""} /></td>
        <td class="check-cell"><input data-field="received" type="checkbox" ${part.received ? "checked" : ""} /></td>
        <td><input class="part-supplier" data-field="supplier" value="${Admin.escapeAttr(part.supplier)}" placeholder="e.g. Repco" /></td>
        <td><input class="part-note" data-field="supplierInvoiceNo" value="${Admin.escapeAttr(part.supplierInvoiceNo || "")}" placeholder="Supplier invoice #" /></td>
        <td>
          <select data-field="status">
            ${PART_LINE_STATUSES.map(
              (status) =>
                `<option value="${Admin.escapeAttr(status.id)}"${part.status === status.id ? " selected" : ""}>${Admin.escapeHtml(status.label)}</option>`
            ).join("")}
          </select>
        </td>
        <td><input class="part-note" data-field="note" value="${Admin.escapeAttr(part.note)}" placeholder="ETA Friday" /></td>
        <td><button type="button" class="ghost" data-remove="${index}">×</button></td>
      </tr>`
    )
    .join("");

  const bindField = (control) => {
    const apply = () => {
      const row = control.closest("tr");
      const index = Number(row.dataset.index);
      const field = control.dataset.field;
      if (field === "ordered" || field === "received") {
        partRows[index][field] = control.checked;
        if (field === "received" && control.checked) {
          partRows[index].ordered = true;
          const ordered = row.querySelector('[data-field="ordered"]');
          if (ordered) ordered.checked = true;
        }
        syncStatusFromParts();
        scheduleJobAutosave();
        return;
      }
      if (field === "qty" || field === "costPrice") {
        partRows[index][field] = Number(control.value) || 0;
        if (field === "costPrice") {
          const cost = Number(partRows[index].costPrice) || 0;
          const markup = Number(partRows[index].markupPercent) || 25;
          partRows[index].sellPrice = Number((cost * (1 + markup / 100)).toFixed(2));
        }
      } else {
        partRows[index][field] = control.value;
      }
      scheduleJobAutosave();
    };
    control.addEventListener("input", apply);
    control.addEventListener("change", apply);
  };
  jobsPartsEl.querySelectorAll("input").forEach(bindField);
  jobsPartsEl.querySelectorAll("select").forEach(bindField);
  jobsPartsEl.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      partRows.splice(Number(btn.dataset.remove), 1);
      if (!partRows.length) partRows = [newPart()];
      renderParts();
      syncStatusFromParts();
      scheduleJobAutosave();
    });
  });
}

function jobInput(name) {
  return (
    document.getElementById(
      name === "customerName"
        ? "job-customer-name"
        : name === "customerEmail"
          ? "job-customer-email"
          : name === "customerPhone"
            ? "job-customer-phone"
            : name === "registration"
              ? "job-registration"
              : name === "vehicle"
                ? "job-vehicle"
                : name === "odometer"
                  ? "job-odometer"
                  : ""
    ) ||
    jobsForm?.elements?.namedItem?.(name) ||
    document.querySelector(`#jobs-form [name="${name}"]`)
  );
}

function fillForm(job) {
  const set = (name, value) => {
    const el = jobInput(name);
    if (!el) return;
    el.value = value ?? "";
  };
  fillStatusSelect(job.status || "in_progress");
  set("jobNumber", job.number);
  set("status", job.status || "in_progress");
  set("technicianName", job.technicianName);
  set("customerName", job.customerName);
  set("customerEmail", job.customerEmail);
  set("customerPhone", job.customerPhone);
  set("registration", String(job.registration || "").toUpperCase());
  set("vehicle", job.vehicle);
  set("odometer", job.odometer);
  set("workRequested", job.workRequested);
  set("notes", job.notes);

  partRows = (job.parts || []).map((part) => newPart(part));
  if (!partRows.length) partRows = [newPart()];
  renderParts();

  const linked = Boolean(job.quoteId || job.invoiceId);
  ["customerName", "customerEmail", "customerPhone", "registration", "vehicle"].forEach(
    (name) => {
      const el = jobInput(name);
      if (el) el.readOnly = linked;
    }
  );
  const workEl = jobInput("workRequested");
  if (workEl) workEl.readOnly = linked;
  const hasQuote = Boolean(job.quoteId);
  const hasInvoice = Boolean(job.invoiceId);
  const canCreateBilling = Boolean(job.id) && !hasQuote && !hasInvoice;
  if (createQuoteBtn) createQuoteBtn.hidden = !canCreateBilling;
  if (createInvoiceBtn) createInvoiceBtn.hidden = !canCreateBilling;
  if (openQuoteBtn) {
    openQuoteBtn.hidden = !hasQuote && !hasInvoice;
    openQuoteBtn.textContent = hasInvoice ? "Open invoice" : "Open quote";
  }
  if (attachInvoiceBtn) {
    const pending = (job.parts || []).some((part) => String(part.description || "").trim());
    attachInvoiceBtn.hidden = !(hasInvoice && pending);
  }
  if (jobsQuoteLink) {
    if (hasInvoice) {
      jobsQuoteLink.hidden = false;
      jobsQuoteLink.textContent = `Linked invoice: ${job.invoiceNumber || job.invoiceId}`;
    } else if (hasQuote) {
      jobsQuoteLink.hidden = false;
      jobsQuoteLink.textContent = `Linked quote: ${job.quoteNumber || job.quoteId}`;
    } else {
      jobsQuoteLink.hidden = true;
      jobsQuoteLink.textContent = "";
    }
  }
  renderJobPhotos();
  loadJobAppointments();
  updateCollectedButton();
}

async function loadJobAppointments() {
  const el = document.getElementById("job-appointments");
  if (!el || !currentJob?.id) return;
  try {
    const rows = await Admin.api(`/api/appointments?jobId=${encodeURIComponent(currentJob.id)}`);
    if (!rows.length) {
      el.innerHTML = '<p class="muted small">No visits booked for this job yet.</p>';
      return;
    }
    el.innerHTML = rows
      .map((row) => {
        const when = `${row.date} · ${row.startTime}–${row.endTime || ""} · ${row.durationMinutes || ""} min`;
        return `<button type="button" class="job-appt-row" data-appt-id="${Admin.escapeAttr(row.id)}">
          <strong>${Admin.escapeHtml(when)}</strong>
          <span class="badge ${Admin.escapeAttr(row.status)}">${Admin.escapeHtml(row.status)}</span>
          <span class="muted small">${Admin.escapeHtml(row.workSummary || "")}</span>
        </button>`;
      })
      .join("");
    el.querySelectorAll("[data-appt-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        Admin.setSection("calendar");
        window.DeaneCalendar?.openAppointment?.(btn.dataset.apptId);
      });
    });
  } catch {
    el.innerHTML = '<p class="muted small">Could not load appointments.</p>';
  }
}

function photoList(key) {
  if (!currentJob || !Array.isArray(currentJob[key])) return [];
  return currentJob[key].map((src) => String(src || "").trim()).filter(Boolean);
}

function renderPhotoGroup(el, photos, type) {
  if (!el) return;
  if (!photos.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = photos
    .map(
      (src) => `
      <span class="photo-thumb">
        <img src="${Admin.escapeAttr(src)}" alt="${type === "supplier" ? "Supplier invoice photo" : "Work photo"}" />
        <button type="button" class="ghost photo-remove" data-photo-type="${Admin.escapeAttr(type)}" data-photo-url="${Admin.escapeAttr(src)}" aria-label="Remove photo">×</button>
      </span>`
    )
    .join("");
}

function renderJobPhotos() {
  renderPhotoGroup(jobWorkPhotosEl, photoList("workPhotos"), "work");
  renderPhotoGroup(jobSupplierPhotosEl, photoList("supplierInvoicePhotos"), "supplier");
  [jobWorkPhotosEl, jobSupplierPhotosEl].forEach((el) => {
    el?.querySelectorAll("[data-photo-url]").forEach((btn) => {
      btn.addEventListener("click", () => removeJobPhoto(btn.dataset.photoType, btn.dataset.photoUrl));
    });
  });
}

async function uploadJobPhotos(type, files) {
  if (!currentJob || !files?.length) return;
  const body = new FormData();
  for (const file of files) body.append("photos", file);
  const endpoint =
    type === "supplier" ? "supplier-invoice-photos" : "work-photos";
  const data = await Admin.api(`/api/jobs/${currentJob.id}/${endpoint}`, {
    method: "POST",
    body,
  });
  if (type === "supplier") currentJob.supplierInvoicePhotos = data.supplierInvoicePhotos || [];
  else currentJob.workPhotos = data.workPhotos || [];
  renderJobPhotos();
  const msgEl = document.getElementById("jobs-save-status");
  if (msgEl) {
    msgEl.hidden = false;
    msgEl.textContent = files.length > 1 ? "Photos uploaded" : "Photo uploaded";
    setTimeout(() => {
      msgEl.hidden = true;
    }, 2500);
  }
}

async function removeJobPhoto(type, url) {
  if (!currentJob || !url) return;
  const endpoint = type === "supplier" ? "supplier-invoice-photos" : "work-photos";
  const data = await Admin.api(
    `/api/jobs/${currentJob.id}/${endpoint}?url=${encodeURIComponent(url)}`,
    { method: "DELETE" }
  );
  if (type === "supplier") currentJob.supplierInvoicePhotos = data.supplierInvoicePhotos || [];
  else currentJob.workPhotos = data.workPhotos || [];
  renderJobPhotos();
}

function updateCollectedButton() {
  if (!collectBtn) return;
  collectBtn.hidden = !currentJob || jobInput("status")?.value !== "completed";
}

function collectJob() {
  const value = (name) => String(jobInput(name)?.value || "").trim();
  return {
    status: jobInput("status")?.value || "in_progress",
    technicianName: value("technicianName"),
    customerName: value("customerName"),
    customerEmail: value("customerEmail"),
    customerPhone: value("customerPhone"),
    registration: value("registration").toUpperCase(),
    vehicle: value("vehicle"),
    odometer: value("odometer"),
    workRequested: sentenceCase(jobInput("workRequested")?.value || ""),
    notes: sentenceCase(jobInput("notes")?.value || ""),
    parts: partRows.map((part) => ({
      ...part,
      description:
        String(part.source || "").toLowerCase() === "ocr"
          ? part.description
          : sentenceCase(part.description),
      note: sentenceCase(part.note),
    })),
  };
}

async function saveJob(opts = {}) {
  if (!currentJob) return null;
  currentJob = await Admin.api(`/api/jobs/${currentJob.id}`, {
    method: "PUT",
    body: JSON.stringify(collectJob()),
  });
  const statusEl = jobInput("status");
  if (statusEl) statusEl.value = currentJob.status;
  updateCollectedButton();
  const el = document.getElementById("jobs-save-status");
  if (el) {
    el.hidden = false;
    el.textContent = opts.autosave ? "Autosaved" : "Saved";
    setTimeout(() => {
      el.hidden = true;
    }, 2500);
  }
  return currentJob;
}

const jobAutosave = Admin?.createAutosave
  ? Admin.createAutosave({
      isReady: () => Boolean(currentJob && jobsEditView && !jobsEditView.hidden),
      save: () => saveJob({ autosave: true }),
      onSaving: (msg) => {
        const el = document.getElementById("jobs-save-status");
        if (!el || !msg) return;
        el.hidden = false;
        el.textContent = msg;
      },
      onError: (err) => {
        const el = document.getElementById("jobs-save-status");
        if (el) {
          el.hidden = false;
          el.textContent = err.message || "Save failed";
        }
      },
    })
  : { schedule() {}, cancel() {}, async flush() {} };

window.DeaneJobs = {
  showList,
  openJob,
  createJob,
  filterBy(status) {
    jobFilter = status || "active";
    const filter = document.getElementById("jobs-filter");
    filter?.querySelectorAll("[data-filter]").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.filter === jobFilter);
    });
    renderJobList();
  },
};

function scheduleJobAutosave() {
  jobAutosave.schedule();
}

async function openJob(id) {
  currentJob = await Admin.api(`/api/jobs/${id}`);
  jobsListView.hidden = true;
  jobsEditView.hidden = false;
  Admin.setViewTitle(currentJob.number);
  fillForm(currentJob);
}

async function createJob() {
  const job = await Admin.api("/api/jobs", {
    method: "POST",
    body: JSON.stringify({ status: "in_progress" }),
  });
  await openJob(job.id);
}

async function loadJobList() {
  jobRows = await Admin.api("/api/jobs");
  renderFilters();
  renderYearFilter();
  renderJobList();
}

async function showList(opts = {}) {
  try {
    await jobAutosave.flush();
  } catch {
    /* still leave the editor */
  }
  jobAutosave.cancel();
  currentJob = null;
  if (opts.filter) jobFilter = opts.filter;
  else jobFilter = "active";
  if (opts.year) jobYear = String(opts.year);
  if (opts.month) jobMonth = String(opts.month);
  else if (jobFilter === "collected_month") jobMonth = Admin.todayIso().slice(0, 7);
  jobsEditView.hidden = true;
  jobsListView.hidden = false;
  Admin.setViewTitle(jobListTitle());
  try {
    await loadJobList();
  } catch (err) {
    alert(err.message);
  }
}

jobsSearch?.addEventListener("input", renderJobList);
jobsSearch?.addEventListener("search", renderJobList);
jobsYearSelect?.addEventListener("change", () => {
  jobYear = jobsYearSelect.value;
  Admin.setViewTitle(jobListTitle());
  renderJobList();
});

document.getElementById("btn-jobs-back")?.addEventListener("click", showList);

document.getElementById("btn-add-part")?.addEventListener("click", () => {
  partRows.push(newPart());
  renderParts();
  scheduleJobAutosave();
});

document.getElementById("btn-jobs-save")?.addEventListener("click", async () => {
  try {
    await saveJob();
  } catch (err) {
    alert(err.message);
  }
});

collectBtn?.addEventListener("click", async () => {
  if (!currentJob || jobInput("status")?.value !== "completed") return;
  if (!confirm("Mark this vehicle as collected and move the job to history?")) return;
  const statusEl = jobInput("status");
  statusEl.value = "collected";
  try {
    await saveJob();
    await showList({ filter: "active" });
  } catch (err) {
    statusEl.value = "completed";
    updateCollectedButton();
    alert(err.message);
  }
});

openQuoteBtn?.addEventListener("click", async () => {
  const docId = currentJob?.invoiceId || currentJob?.quoteId;
  if (!docId) return;
  try {
    await saveJob();
  } catch {
    /* still try to open the document */
  }
  Admin.setSection(currentJob.invoiceId ? "invoices" : "quotes");
  await window.DeaneBilling?.openDoc(docId);
});

async function createBillingFromJob(kind) {
  if (!currentJob?.id) return;
  try {
    await saveJob();
  } catch (err) {
    alert(err.message || "Save the job card first.");
    return;
  }
  if (!window.DeaneBilling?.createFromJob) {
    alert("Billing page did not load. Refresh Admin and try again.");
    return;
  }
  try {
    await window.DeaneBilling.createFromJob(currentJob, kind);
  } catch (err) {
    alert(err.message);
  }
}

createQuoteBtn?.addEventListener("click", () => createBillingFromJob("quote"));
createInvoiceBtn?.addEventListener("click", () => createBillingFromJob("invoice"));

attachInvoiceBtn?.addEventListener("click", async () => {
  if (!currentJob?.id || !currentJob.invoiceId) return;
  try {
    await saveJob();
    const result = await Admin.api(
      `/api/jobs/${currentJob.id}/invoices/${currentJob.invoiceId}/attach-parts`,
      { method: "POST", body: "{}" }
    );
    await openJob(currentJob.id);
    const added = Number(result.linesAdded) || 0;
    const attached = Number(result.attached) || 0;
    alert(
      added
        ? `Added ${added} part line${added === 1 ? "" : "s"} to ${currentJob.invoiceNumber || "the invoice"}.`
        : attached
          ? "Parts marked billed. Those descriptions were already on the invoice."
          : "No approved parts to add. Set a part to Approved first."
    );
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("btn-jobs-delete")?.addEventListener("click", async () => {
  if (!currentJob || !confirm("Delete this job card?")) return;
  jobAutosave.cancel();
  try {
    await Admin.api(`/api/jobs/${currentJob.id}`, { method: "DELETE" });
    currentJob = null;
    await showList();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("btn-job-add-appointment")?.addEventListener("click", async () => {
  if (!currentJob) return;
  try {
    await jobAutosave.flush();
  } catch {
    /* still open calendar */
  }
  Admin.setSection("calendar");
  await window.DeaneCalendar?.newAppointment?.({
    date: Admin.todayIso(),
    customerName: currentJob.customerName,
    customerPhone: currentJob.customerPhone,
    customerEmail: currentJob.customerEmail,
    registration: currentJob.registration,
    vehicle: currentJob.vehicle,
    workSummary: currentJob.workRequested,
    jobId: currentJob.id,
    jobNumber: currentJob.number,
  });
});

jobsForm?.addEventListener("input", (e) => {
  const el = e.target;
  if (el?.id === "job-registration" || el?.name === "registration") {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = String(el.value || "").toUpperCase();
    if (next !== el.value) {
      el.value = next;
      try {
        el.setSelectionRange(start, end);
      } catch {
        /* ignore */
      }
    }
  }
  scheduleJobAutosave();
});
jobsForm?.addEventListener("change", (event) => {
  if (event.target === jobInput("status")) updateCollectedButton();
  scheduleJobAutosave();
});
jobWorkPhotosInput?.addEventListener("change", async () => {
  try {
    await uploadJobPhotos("work", jobWorkPhotosInput.files);
  } catch (err) {
    alert(err.message);
  } finally {
    jobWorkPhotosInput.value = "";
  }
});
jobSupplierPhotosInput?.addEventListener("change", async () => {
  try {
    await uploadJobPhotos("supplier", jobSupplierPhotosInput.files);
  } catch (err) {
    alert(err.message);
  } finally {
    jobSupplierPhotosInput.value = "";
  }
});
window.addEventListener("beforeunload", () => {
  jobAutosave.flush();
});
})();
