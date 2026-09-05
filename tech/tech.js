const loginView = document.getElementById("login-view");
const jobsView = document.getElementById("jobs-view");
const jobView = document.getElementById("job-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const jobsList = document.getElementById("jobs-list");
const searchInput = document.getElementById("search");
const jobTitle = document.getElementById("job-title");
const jobSubtitle = document.getElementById("job-subtitle");
const statusLine = document.getElementById("status");
const workInput = document.getElementById("work-input");
const supplierInput = document.getElementById("supplier-input");
const workPhotosEl = document.getElementById("work-photos");
const supplierPhotosEl = document.getElementById("supplier-photos");

let jobs = [];
let currentJob = null;

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...options, headers, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function showStatus(text) {
  statusLine.hidden = !text;
  statusLine.textContent = text || "";
  if (!text) return;
  setTimeout(() => {
    statusLine.hidden = true;
  }, 2500);
}

function showLogin() {
  loginView.hidden = false;
  jobsView.hidden = true;
  jobView.hidden = true;
}

function showJobs() {
  loginView.hidden = true;
  jobsView.hidden = false;
  jobView.hidden = true;
}

function showJob() {
  loginView.hidden = true;
  jobsView.hidden = true;
  jobView.hidden = false;
}

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s-]/g, "");
}

function renderJobs() {
  const q = String(searchInput.value || "").trim().toLowerCase();
  const qPlate = normalizeSearch(q);
  const filtered = jobs.filter((job) => {
    if (!q) return true;
    const name = String(job.customerName || "").toLowerCase();
    const number = String(job.number || "").toLowerCase();
    const plate = normalizeSearch(job.registration);
    return name.includes(q) || number.includes(q) || plate.includes(qPlate);
  });
  if (!filtered.length) {
    jobsList.innerHTML = '<p class="muted">No matching jobs.</p>';
    return;
  }
  jobsList.innerHTML = filtered
    .map(
      (job) => `
      <article class="job-card">
        <h3>${escapeHtml(job.number || "Job")}</h3>
        <p class="muted small">${escapeHtml(job.customerName || "Customer")} · ${escapeHtml(job.registration || "No plate")} · ${escapeHtml(job.vehicle || "")}</p>
        <div class="badges">
          <span class="badge">${escapeHtml(job.status || "in_progress")}</span>
          <span class="badge">Work photos: ${Number(job.workPhotosCount) || 0}</span>
          <span class="badge">Supplier photos: ${Number(job.supplierInvoicePhotosCount) || 0}</span>
        </div>
        <button type="button" data-open="${escapeAttr(job.id)}">Open job</button>
      </article>`
    )
    .join("");
  jobsList.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => openJob(btn.dataset.open));
  });
}

async function loadJobs() {
  const rows = await api("/api/jobs");
  jobs = rows.filter((job) => job.status !== "collected");
  renderJobs();
}

function photoList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => String(row || "").trim()).filter(Boolean);
}

function renderThumbs(el, rows, alt) {
  if (!rows.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = rows
    .map((src) => `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" />`)
    .join("");
}

function renderCurrentJob() {
  if (!currentJob) return;
  jobTitle.textContent = currentJob.number || "Job";
  jobSubtitle.textContent = `${currentJob.customerName || "Customer"} · ${currentJob.registration || "No plate"} · ${currentJob.vehicle || ""}`;
  renderThumbs(workPhotosEl, photoList(currentJob.workPhotos), "Work photo");
  renderThumbs(
    supplierPhotosEl,
    photoList(currentJob.supplierInvoicePhotos),
    "Supplier invoice photo"
  );
}

async function openJob(id) {
  currentJob = await api(`/api/jobs/${id}`);
  renderCurrentJob();
  showJob();
}

async function uploadPhotos(type, files) {
  if (!currentJob || !files?.length) return;
  const body = new FormData();
  for (const file of files) body.append("photos", file);
  const endpoint = type === "supplier" ? "supplier-invoice-photos" : "work-photos";
  const data = await api(`/api/jobs/${currentJob.id}/${endpoint}`, {
    method: "POST",
    body,
  });
  if (type === "supplier") currentJob.supplierInvoicePhotos = data.supplierInvoicePhotos || [];
  else currentJob.workPhotos = data.workPhotos || [];
  renderCurrentJob();
  showStatus(files.length > 1 ? "Photos uploaded" : "Photo uploaded");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.hidden = true;
    const username = document.getElementById("username")?.value.trim() || "";
    const pin = document.getElementById("pin").value.trim();
    const submit = loginForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Signing in…";
    try {
      await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password: pin, pin }),
      });
    await loadJobs();
    showJobs();
  } catch (err) {
    loginError.hidden = false;
    loginError.textContent = err.message;
  } finally {
    submit.disabled = false;
    submit.textContent = "Sign in";
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", { method: "POST" });
  } catch {
    /* best effort */
  }
  showLogin();
});

document.getElementById("btn-back").addEventListener("click", async () => {
  await loadJobs();
  showJobs();
});

document.getElementById("btn-refresh").addEventListener("click", async () => {
  if (!currentJob) return;
  currentJob = await api(`/api/jobs/${currentJob.id}`);
  renderCurrentJob();
  showStatus("Refreshed");
});

searchInput.addEventListener("input", renderJobs);
searchInput.addEventListener("search", renderJobs);

workInput.addEventListener("change", async () => {
  try {
    await uploadPhotos("work", workInput.files);
  } catch (err) {
    alert(err.message);
  } finally {
    workInput.value = "";
  }
});

supplierInput.addEventListener("change", async () => {
  try {
    await uploadPhotos("supplier", supplierInput.files);
  } catch (err) {
    alert(err.message);
  } finally {
    supplierInput.value = "";
  }
});

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
    await loadJobs();
    showJobs();
  } catch {
    showLogin();
  }
})();
