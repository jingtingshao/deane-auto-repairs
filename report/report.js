const loading = document.getElementById("loading");
const errorEl = document.getElementById("error");
const reportEl = document.getElementById("report");

const STATUS_LABEL = {
  ok: "OK",
  watch: "Watch",
  attention: "Attention",
  na: "N/A",
};

function reportId() {
  const parts = location.pathname.split("/").filter(Boolean);
  const rIndex = parts.indexOf("r");
  if (rIndex >= 0 && parts[rIndex + 1]) return parts[rIndex + 1];
  return new URLSearchParams(location.search).get("id");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function jobLabel(report) {
  const map = {
    standard_service: "Standard Service",
    premium_service: "Premium Service",
    full_service: "Premium Service",
    wof: "WOF",
    standard_wof: "Standard Service + WOF",
    premium_wof: "Premium Service + WOF",
    full_wof: "Premium Service + WOF",
    repair: "Repair",
  };
  if (map[report.jobType]) return map[report.jobType];
  if (report.servicePackage === "premium" || report.servicePackage === "full") {
    return "Premium Service";
  }
  return "Service";
}

async function load() {
  const id = reportId();
  if (!id) {
    loading.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = "Report link is missing.";
    return;
  }

  try {
    const view = new URLSearchParams(location.search).get("v") || "";
    const reportRes = await fetch(
      `/api/reports/${id}${view ? `?v=${encodeURIComponent(view)}` : ""}`
    );
    const report = await reportRes.json();
    if (!reportRes.ok) throw new Error(report.error || "Not found");

    const meta = await fetch(
      `/api/checklist?package=${report.servicePackage || "standard"}`
    ).then((r) => r.json());

    render(report, meta);
  } catch (err) {
    loading.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent =
      err.message === "Report not found"
        ? "This report is not available. It may still be a draft."
        : err.message;
  }
}

function render(report, meta) {
  loading.hidden = true;
  reportEl.hidden = false;

  const checks = report.checks || {};
  const counts = { ok: 0, watch: 0, attention: 0, na: 0 };
  Object.values(checks).forEach((c) => {
    if (counts[c.status] != null) counts[c.status] += 1;
  });

  const attentionItems = [];
  const watchItems = [];
  for (const group of meta.groups) {
    for (const item of group.items) {
      const state = checks[item.code];
      if (!state) continue;
      if (state.status === "attention") attentionItems.push({ item, state });
      else if (state.status === "watch") watchItems.push({ item, state });
    }
  }

  const actionLabels = [
    ...(meta.actions.standard || []),
    ...(meta.actions.premiumExtra || meta.actions.fullExtra || []),
    ...(meta.actions.either || []),
  ];
  const done = actionLabels.filter((a) => report.actionsDone?.[a.id]);
  const photos = Array.isArray(report.vehiclePhotos)
    ? report.vehiclePhotos.filter(Boolean)
    : report.vehiclePhoto
      ? [report.vehiclePhoto]
      : [];
  const coverPhoto = photos[0] || "";

  document.body.classList.add("has-cover");

  reportEl.innerHTML = `
    <section class="report-cover" aria-label="Report cover">
      <div class="cover-inner">
        <p class="cover-brand">
          <span class="script">Deane</span>
          <span class="sans">AUTO REPAIRS</span>
        </p>
        <p class="cover-tag">Digital service report</p>
        <h1 class="cover-title">${escapeHtml(jobLabel(report))}</h1>
        ${
          coverPhoto
            ? `<img class="cover-photo" src="${escapeHtml(coverPhoto)}" alt="Vehicle photo" />`
            : `<div class="cover-photo cover-photo-empty" aria-hidden="true"></div>`
        }
        <div class="cover-vehicle">
          <p class="cover-rego">${escapeHtml(report.registration || "—")}</p>
          <p class="cover-model">${escapeHtml(report.vehicle || "")}</p>
        </div>
        <dl class="cover-meta">
          <div><dt>Job</dt><dd>${escapeHtml(report.jobNumber || "—")}</dd></div>
          <div><dt>Date</dt><dd>${escapeHtml(report.serviceDate || "—")}</dd></div>
          <div><dt>Customer</dt><dd>${escapeHtml(report.customerName || "—")}</dd></div>
          <div><dt>Odometer</dt><dd>${escapeHtml(report.odometer ? report.odometer + " km" : "—")}</dd></div>
          <div><dt>Technician</dt><dd>${escapeHtml(report.technicianName || "—")}</dd></div>
        </dl>
        <div class="cover-shop">
          <strong>Deane Auto Repairs</strong><br />
          (Next to BP Petrol Station)<br />
          63 Hayr Road, Three Kings, Auckland<br />
          <a href="tel:08006259827">0800 625 9827</a> ·
          <a href="mailto:deaneautonz@gmail.com">deaneautonz@gmail.com</a><br />
          Mon–Sat 8:30am – 5:30pm
        </div>
      </div>
    </section>

    <section class="hero-card">
      <div>
        <h1>${escapeHtml(report.registration)} · ${escapeHtml(report.vehicle)}</h1>
        <p class="meta">${escapeHtml(jobLabel(report))} · ${escapeHtml(report.serviceDate || "")}</p>
        <p class="meta">Job ${escapeHtml(report.jobNumber)} · ${escapeHtml(report.odometer ? report.odometer + " km" : "")}</p>
        <p class="meta">Customer: ${escapeHtml(report.customerName || "—")}</p>
        <p class="meta">Technician: ${escapeHtml(report.technicianName || "—")}</p>
        <div class="counts">
          <span class="pill ok">${counts.ok} OK</span>
          <span class="pill watch">${counts.watch} Watch</span>
          <span class="pill attention">${counts.attention} Attention</span>
        </div>
      </div>
      ${
        photos.length
          ? `<div class="photo-gallery">${photos
              .map(
                (src) =>
                  `<img class="photo" src="${escapeHtml(src)}" alt="Vehicle photo" />`
              )
              .join("")}</div>`
          : ""
      }
    </section>

    ${
      attentionItems.length || watchItems.length
        ? `<section class="panel">
            <h2>What needs your attention</h2>
            ${attentionItems
              .map(
                ({ item, state }) => `
              <div class="alert attention">
                <strong>Attention — ${escapeHtml(item.label)}</strong>
                <div>${escapeHtml(state.note || "Needs attention soon.")}</div>
              </div>`
              )
              .join("")}
            ${watchItems
              .map(
                ({ item, state }) => `
              <div class="alert watch">
                <strong>Watch — ${escapeHtml(item.label)}</strong>
                <div>${escapeHtml(state.note || "Monitor / plan for next service.")}</div>
              </div>`
              )
              .join("")}
          </section>`
        : `<section class="panel"><h2>What needs your attention</h2><div class="alert ok-note">No Attention or Watch items recorded on this visit.</div></section>`
    }

    <section class="panel">
      <h2>Work completed</h2>
      ${report.summary ? `<p>${escapeHtml(report.summary)}</p>` : ""}
      ${
        done.length
          ? `<ul class="actions">${done
              .map((a) => `<li>${escapeHtml(a.label)}</li>`)
              .join("")}</ul>`
          : "<p>No action ticks recorded.</p>"
      }
      ${report.actionsOther ? `<p>${escapeHtml(report.actionsOther)}</p>` : ""}
      ${
        report.oilSpec || report.oilFilter
          ? `<p class="meta">Oil: ${escapeHtml(report.oilSpec || "—")} · Filter: ${escapeHtml(report.oilFilter || "—")}</p>`
          : ""
      }
      ${
        report.nextServiceDue
          ? `<p><strong>Next service due:</strong> ${escapeHtml(report.nextServiceDue)}</p>`
          : ""
      }
      ${
        report.technicianComments
          ? `<p>${escapeHtml(report.technicianComments)}</p>`
          : ""
      }
    </section>

    <section class="panel">
      <h2>Inspection checklist</h2>
      ${meta.groups
        .map((group) => {
          const rows = group.items
            .map((item) => {
              const state = checks[item.code] || { status: "na", note: "" };
              return `<div class="row">
                <div>${escapeHtml(item.label)}</div>
                <div class="tag ${state.status}">${STATUS_LABEL[state.status] || state.status}</div>
                ${state.note ? `<div class="note">${escapeHtml(state.note)}</div>` : ""}
              </div>`;
            })
            .join("");
          return `<div class="group"><h3>${escapeHtml(group.title)}</h3>${rows}</div>`;
        })
        .join("")}
    </section>
  `;

  document.title = `${report.registration} service report · Deane Auto Repairs`;
}

load();
