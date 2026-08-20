(function () {
var Admin = window.DeaneAdmin;

const JOB_STATUSES = [
  { id: "waiting_parts", label: "Waiting parts" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
];

const jobsListView = document.getElementById("jobs-list-view");
const jobsEditView = document.getElementById("jobs-edit-view");
const jobsList = document.getElementById("jobs-list");
const jobsSearch = document.getElementById("jobs-search");
const jobsFilter = document.getElementById("jobs-filter");
const jobsForm = document.getElementById("jobs-form");
const jobsPartsEl = document.getElementById("jobs-parts");
const jobsQuoteLink = document.getElementById("jobs-quote-link");
const openQuoteBtn = document.getElementById("btn-jobs-open-quote");

let currentJob = null;
let jobRows = [];
let partRows = [];
let jobFilter = "all";

function statusLabel(id) {
  return JOB_STATUSES.find((s) => s.id === id)?.label || id || "";
}

function newPart(partial = {}) {
  return {
    id: partial.id || crypto.randomUUID(),
    description: partial.description || "",
    qty: partial.qty != null ? partial.qty : 1,
    ordered: Boolean(partial.ordered) || Boolean(partial.received),
    received: Boolean(partial.received),
    note: partial.note || "",
  };
}

function partsLabel(job) {
  const total = Number(job.partsTotal) || 0;
  const received = Number(job.partsReceived) || 0;
  if (!total) return { text: "No parts", cls: "parts-none" };
  if (received >= total) return { text: "Parts in", cls: "parts-ok" };
  return { text: `${received}/${total} parts in`, cls: "parts-wait" };
}

function renderFilters() {
  if (!jobsFilter || jobsFilter.dataset.ready) return;
  jobsFilter.innerHTML = [
    `<button type="button" class="ghost is-active" data-filter="all">All</button>`,
    ...JOB_STATUSES.map(
      (s) =>
        `<button type="button" class="ghost" data-filter="${Admin.escapeAttr(s.id)}">${Admin.escapeHtml(s.label)}</button>`
    ),
  ].join("");
  jobsFilter.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      jobFilter = btn.dataset.filter;
      jobsFilter.querySelectorAll("[data-filter]").forEach((el) => {
        el.classList.toggle("is-active", el === btn);
      });
      renderJobList();
    });
  });
  jobsFilter.dataset.ready = "1";
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
      '<div class="empty">No job cards yet. Click <strong>New job</strong>, or open an accepted quote and create one from there.</div>';
    return;
  }

  const query = jobsSearch?.value || "";
  const jobs = jobRows.filter((job) => {
    if (jobFilter !== "all" && job.status !== jobFilter) return false;
    return matchesJobSearch(job, query);
  });
  if (!jobs.length) {
    jobsList.innerHTML = '<div class="empty">No matching jobs.</div>';
    return;
  }

  jobsList.innerHTML = jobs
    .map((job) => {
      const parts = partsLabel(job);
      return `
      <article class="report-card billing-card" data-id="${job.id}">
        <div class="billing-number">${Admin.escapeHtml(job.number)}</div>
        <div>
          <h2>${Admin.escapeHtml(job.customerName || "Customer")}</h2>
          <p class="muted">${Admin.escapeHtml(job.registration || "No plate")} · ${Admin.escapeHtml(job.vehicle || "")}${job.quoteNumber ? ` · ${Admin.escapeHtml(job.quoteNumber)}` : ""}</p>
        </div>
        <div class="job-card-meta">
          <span class="badge ${Admin.escapeAttr(job.status)}">${Admin.escapeHtml(statusLabel(job.status))}</span>
          <span class="badge ${parts.cls}">${Admin.escapeHtml(parts.text)}</span>
        </div>
      </article>`;
    })
    .join("");

  jobsList.querySelectorAll(".report-card").forEach((card) => {
    card.addEventListener("click", () => openJob(card.dataset.id));
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
  if (currentStatus === "completed") return "completed";
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
        <td><input data-field="description" value="${Admin.escapeAttr(part.description)}" placeholder="e.g. Front pads" /></td>
        <td><input class="qty" data-field="qty" type="number" min="0" step="1" value="${Admin.escapeAttr(String(part.qty))}" /></td>
        <td class="check-cell"><input data-field="ordered" type="checkbox" ${part.ordered ? "checked" : ""} /></td>
        <td class="check-cell"><input data-field="received" type="checkbox" ${part.received ? "checked" : ""} /></td>
        <td><input class="part-note" data-field="note" value="${Admin.escapeAttr(part.note)}" placeholder="ETA Friday" /></td>
        <td><button type="button" class="ghost" data-remove="${index}">×</button></td>
      </tr>`
    )
    .join("");

  jobsPartsEl.querySelectorAll("input").forEach((input) => {
    const apply = () => {
      const row = input.closest("tr");
      const index = Number(row.dataset.index);
      const field = input.dataset.field;
      if (field === "ordered" || field === "received") {
        partRows[index][field] = input.checked;
        if (field === "received" && input.checked) {
          partRows[index].ordered = true;
          const ordered = row.querySelector('[data-field="ordered"]');
          if (ordered) ordered.checked = true;
        }
        syncStatusFromParts();
        return;
      }
      partRows[index][field] = field === "qty" ? Number(input.value) || 0 : input.value;
    };
    input.addEventListener("input", apply);
    input.addEventListener("change", apply);
  });
  jobsPartsEl.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      partRows.splice(Number(btn.dataset.remove), 1);
      if (!partRows.length) partRows = [newPart()];
      renderParts();
      syncStatusFromParts();
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
  set("registration", job.registration);
  set("vehicle", job.vehicle);
  set("odometer", job.odometer);
  set("workRequested", job.workRequested);
  set("notes", job.notes);

  partRows = (job.parts || []).map((part) => newPart(part));
  if (!partRows.length) partRows = [newPart()];
  renderParts();

  const hasQuote = Boolean(job.quoteId);
  if (openQuoteBtn) openQuoteBtn.hidden = !hasQuote;
  if (jobsQuoteLink) {
    if (hasQuote) {
      jobsQuoteLink.hidden = false;
      jobsQuoteLink.textContent = `Linked quote: ${job.quoteNumber || job.quoteId}`;
    } else {
      jobsQuoteLink.hidden = true;
      jobsQuoteLink.textContent = "";
    }
  }
}

function collectJob() {
  const value = (name) => String(jobInput(name)?.value || "").trim();
  return {
    status: jobInput("status")?.value || "in_progress",
    technicianName: value("technicianName"),
    customerName: value("customerName"),
    customerEmail: value("customerEmail"),
    customerPhone: value("customerPhone"),
    registration: value("registration"),
    vehicle: value("vehicle"),
    odometer: value("odometer"),
    workRequested: String(jobInput("workRequested")?.value || ""),
    notes: String(jobInput("notes")?.value || ""),
    parts: partRows.map((part) => ({ ...part })),
  };
}

async function saveJob() {
  if (!currentJob) return null;
  currentJob = await Admin.api(`/api/jobs/${currentJob.id}`, {
    method: "PUT",
    body: JSON.stringify(collectJob()),
  });
  const statusEl = jobInput("status");
  if (statusEl) statusEl.value = currentJob.status;
  const el = document.getElementById("jobs-save-status");
  if (el) {
    el.hidden = false;
    el.textContent = "Saved";
    setTimeout(() => {
      el.hidden = true;
    }, 2500);
  }
  return currentJob;
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
  renderFilters();
  jobRows = await Admin.api("/api/jobs");
  renderJobList();
}

async function showList() {
  currentJob = null;
  jobsEditView.hidden = true;
  jobsListView.hidden = false;
  Admin.setViewTitle("Jobs");
  try {
    await loadJobList();
  } catch (err) {
    alert(err.message);
  }
}

jobsSearch?.addEventListener("input", renderJobList);
jobsSearch?.addEventListener("search", renderJobList);

document.getElementById("btn-jobs-back")?.addEventListener("click", showList);

document.getElementById("btn-add-part")?.addEventListener("click", () => {
  partRows.push(newPart());
  renderParts();
});

document.getElementById("btn-jobs-save")?.addEventListener("click", async () => {
  try {
    await saveJob();
  } catch (err) {
    alert(err.message);
  }
});

openQuoteBtn?.addEventListener("click", async () => {
  if (!currentJob?.quoteId) return;
  try {
    await saveJob();
  } catch {
    /* still try to open the quote */
  }
  Admin.setSection("billing");
  await window.DeaneBilling?.openDoc(currentJob.quoteId);
});

document.getElementById("btn-jobs-delete")?.addEventListener("click", async () => {
  if (!currentJob || !confirm("Delete this job card?")) return;
  try {
    await Admin.api(`/api/jobs/${currentJob.id}`, { method: "DELETE" });
    await showList();
  } catch (err) {
    alert(err.message);
  }
});

window.DeaneJobs = {
  showList,
  openJob,
  createJob,
  filterBy(status) {
    jobFilter = status || "all";
    const filter = document.getElementById("jobs-filter");
    filter?.querySelectorAll("[data-filter]").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.filter === jobFilter);
    });
    renderJobList();
  },
};
})();
