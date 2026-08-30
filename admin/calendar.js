(function () {
  const Admin = window.DeaneAdmin;
  const section = document.getElementById("calendar-section");
  const listView = document.getElementById("calendar-list-view");
  const editView = document.getElementById("calendar-edit-view");
  const board = document.getElementById("calendar-board");
  const rangeLabel = document.getElementById("calendar-range-label");
  const form = document.getElementById("calendar-form");
  const statusSelect = document.getElementById("cal-status");
  const durationSelect = document.getElementById("cal-duration");
  const startTimeSelect = document.getElementById("cal-start-time");
  const endPreview = document.getElementById("cal-end-preview");
  const jobSelect = document.getElementById("cal-job-select");
  const jobLinkEl = document.getElementById("cal-job-link");
  const saveStatus = document.getElementById("calendar-save-status");
  const createJobBtn = document.getElementById("btn-cal-create-job");
  const openJobBtn = document.getElementById("btn-cal-open-job");

  let viewMode = "fortnight";
  let anchorDate = activeFortnightStart();
  let rows = [];
  let meta = null;
  let current = null;
  let jobOptions = [];
  let customerDirectory = [];

  const partyFind = document.getElementById("cal-party-find");
  const partySuggest = document.getElementById("cal-party-suggest");
  const partyFindStatus = document.getElementById("cal-party-find-status");
  const customerIdInput = document.getElementById("cal-customer-id");

  const STATUS_FALLBACK = [
    { id: "booked", label: "Booked" },
    { id: "confirmed", label: "Confirmed" },
    { id: "arrived", label: "Arrived" },
    { id: "job_created", label: "Job created" },
    { id: "cancelled", label: "Cancelled" },
    { id: "no_show", label: "No show" },
  ];

  function statusLabel(id) {
    const list = meta?.statuses || STATUS_FALLBACK;
    return list.find((s) => s.id === id)?.label || id || "";
  }

  function showStatus(msg) {
    if (!saveStatus) return;
    saveStatus.hidden = false;
    saveStatus.textContent = msg;
    setTimeout(() => {
      saveStatus.hidden = true;
    }, 2500);
  }

  function plusDays(iso, days) {
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d + Number(days)));
    return utc.toISOString().slice(0, 10);
  }

  function isSunday(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
  }

  /** Next bookable day: not in the past, not Sunday (workshop closed). */
  function nextBookableDate(iso) {
    let cursor = String(iso || Admin.todayIso()).slice(0, 10);
    const today = Admin.todayIso();
    if (cursor < today) cursor = today;
    while (isSunday(cursor)) cursor = plusDays(cursor, 1);
    return cursor;
  }

  /**
   * Rolling 2-week window starts on the Monday of the current bookable week.
   * On Sunday the Mon–Sat week just ended is dropped — next Monday starts the view.
   */
  function activeFortnightStart(iso = Admin.todayIso()) {
    return startOfWeek(nextBookableDate(iso));
  }

  /** Skip fully finished Mon–Sat weeks (used every Sunday after midnight NZ). */
  function snapFortnightStart(fromIso) {
    let from = startOfWeek(fromIso);
    const today = Admin.todayIso();
    while (plusDays(from, 5) < today) {
      from = plusDays(from, 7);
    }
    return from;
  }

  function assertBookableDate(iso) {
    const date = String(iso || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error("Appointment date is required.");
    }
    if (date < Admin.todayIso()) {
      throw new Error("Cannot book a past date. Choose today or a future date.");
    }
    if (isSunday(date)) {
      throw new Error("Sunday is closed. Choose another day.");
    }
    return date;
  }

  function syncDateInputLimits(existingDate) {
    const dateEl = form?.elements?.namedItem?.("date");
    if (!dateEl) return;
    const today = Admin.todayIso();
    const existing = String(existingDate || "").slice(0, 10);
    dateEl.min = existing && existing < today ? existing : today;
  }

  function startOfWeek(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d));
    const day = utc.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    return plusDays(iso, diff);
  }

  function formatDayHeading(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-NZ", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  function formatShortDay(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-NZ", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  }

  function endTime(start, durationMinutes) {
    const m = String(start || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return "";
    const total = Number(m[1]) * 60 + Number(m[2]) + (Number(durationMinutes) || 0);
    const h = Math.floor(Math.min(24 * 60, total) / 60);
    const min = Math.min(24 * 60, total) % 60;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }

  function rangeBounds() {
    const from = snapFortnightStart(anchorDate);
    if (viewMode === "month") {
      // Four Mon–Sat weeks (skip Sundays).
      return { from, to: plusDays(from, 26) };
    }
    // Default: two Mon–Sat weeks.
    return { from, to: plusDays(from, 12) };
  }

  function boardDays() {
    const { from } = rangeBounds();
    const days = [];
    const weekCount = viewMode === "month" ? 4 : 2;
    for (let week = 0; week < weekCount; week += 1) {
      for (let i = 0; i < 6; i += 1) {
        days.push(plusDays(from, week * 7 + i));
      }
    }
    return days;
  }

  function stepDays() {
    return viewMode === "month" ? 28 : 14;
  }

  function updateRangeLabel() {
    const days = boardDays();
    if (!rangeLabel) return;
    rangeLabel.textContent = `${formatShortDay(days[0])} – ${formatShortDay(days[days.length - 1])}`;
  }

  function fillStatusSelect(selected) {
    if (!statusSelect) return;
    const list = meta?.statuses || STATUS_FALLBACK;
    statusSelect.innerHTML = list
      .map(
        (s) =>
          `<option value="${Admin.escapeAttr(s.id)}"${s.id === selected ? " selected" : ""}>${Admin.escapeHtml(s.label)}</option>`
      )
      .join("");
  }

  function fillStartTimeSelect(selected) {
    if (!startTimeSelect) return;
    if (!startTimeSelect.dataset.ready) {
      // Workshop hours Mon–Sat 8:30–17:30, 15-minute steps, 24-hour labels.
      const options = [];
      for (let minutes = 8 * 60 + 30; minutes <= 17 * 60 + 30; minutes += 15) {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        options.push(`<option value="${value}">${value}</option>`);
      }
      startTimeSelect.innerHTML = options.join("");
      startTimeSelect.dataset.ready = "1";
    }
    const want = String(selected || "09:00").slice(0, 5);
    if ([...startTimeSelect.options].some((o) => o.value === want)) {
      startTimeSelect.value = want;
    } else {
      // Keep odd saved times (e.g. legacy) visible.
      const opt = document.createElement("option");
      opt.value = want;
      opt.textContent = want;
      startTimeSelect.appendChild(opt);
      startTimeSelect.value = want;
    }
  }

  function fillDurationSelect(selected) {
    if (!durationSelect || durationSelect.dataset.ready) return;
    const presets = meta?.durationPresets || [
      { minutes: 60, label: "1 hour" },
      { minutes: 120, label: "2 hours" },
      { minutes: 180, label: "3 hours" },
      { minutes: 240, label: "Half day (4h)" },
    ];
    durationSelect.innerHTML = presets
      .map(
        (p) =>
          `<option value="${Admin.escapeAttr(String(p.minutes))}">${Admin.escapeHtml(p.label)}</option>`
      )
      .join("");
    durationSelect.dataset.ready = "1";
    if (selected) durationSelect.value = String(selected);
  }

  async function loadJobOptions() {
    try {
      jobOptions = await Admin.api("/api/jobs");
    } catch {
      jobOptions = [];
    }
    if (!jobSelect) return;
    const currentId = jobSelect.value || current?.jobId || "";
    const options = jobOptions
      .filter((j) => j.status !== "collected")
      .map((j) => {
        const label = `${j.number || "Job"} · ${j.customerName || "Customer"} · ${j.registration || ""}`;
        return `<option value="${Admin.escapeAttr(j.id)}">${Admin.escapeHtml(label.trim())}</option>`;
      })
      .join("");
    jobSelect.innerHTML = `<option value="">Not linked</option>${options}`;
    if (currentId) jobSelect.value = currentId;
  }

  async function loadCustomerDirectory() {
    try {
      customerDirectory = await Admin.api("/api/customers");
    } catch {
      customerDirectory = [];
    }
  }

  function partyDisplayName(row) {
    return (
      [row?.firstName, row?.lastName].filter(Boolean).join(" ").trim() ||
      String(row?.customerName || "").trim()
    );
  }

  function plateKey(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[\s-]/g, "");
  }

  function setPartyFindStatus(text, ok = false) {
    if (!partyFindStatus) return;
    if (!text) {
      partyFindStatus.hidden = true;
      partyFindStatus.textContent = "";
      partyFindStatus.classList.remove("is-ok");
      return;
    }
    partyFindStatus.hidden = false;
    partyFindStatus.textContent = text;
    partyFindStatus.classList.toggle("is-ok", Boolean(ok));
  }

  function hidePartySuggest() {
    if (!partySuggest) return;
    partySuggest.hidden = true;
    partySuggest.innerHTML = "";
  }

  function partySearchHits(query) {
    const raw = String(query || "").trim().toLowerCase();
    const plateQ = plateKey(query);
    if (!raw && !plateQ) return [];
    const hits = [];
    for (const row of customerDirectory) {
      if (!row?.customerId) continue;
      const name = partyDisplayName(row).toLowerCase();
      const phone = String(row.customerPhone || "").replace(/\s+/g, "");
      const vehicles = Admin.customerVehicles(row);
      if (!vehicles.length) {
        const nameMatch = raw && name.includes(raw);
        const phoneMatch = raw && phone.includes(raw.replace(/\s+/g, ""));
        if (nameMatch || phoneMatch) {
          hits.push({
            row,
            vehicle: { registration: "", vehicle: "" },
            score: name.startsWith(raw) ? 0 : 2,
            label: `${partyDisplayName(row) || "Customer"} · no plate`,
          });
        }
        continue;
      }
      for (const vehicle of vehicles) {
        const plate = plateKey(vehicle.registration);
        const plateMatch =
          plateQ && (plate === plateQ || plate.startsWith(plateQ) || plate.includes(plateQ));
        const nameMatch = raw && name.includes(raw);
        const phoneMatch = raw && phone.includes(raw.replace(/\s+/g, ""));
        if (!plateMatch && !nameMatch && !phoneMatch) continue;
        let score = 3;
        if (plate && plate === plateQ) score = 0;
        else if (plate && plate.startsWith(plateQ)) score = 1;
        else if (nameMatch && name.startsWith(raw)) score = 1;
        else if (nameMatch || plateMatch) score = 2;
        hits.push({
          row,
          vehicle,
          score,
          label: `${partyDisplayName(row) || "Customer"} · ${String(vehicle.registration || "No plate").toUpperCase()}${vehicle.vehicle ? ` · ${vehicle.vehicle}` : ""}`,
        });
      }
    }
    hits.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.label.localeCompare(b.label);
    });
    return hits.slice(0, 12);
  }

  function applyPartyHit(hit) {
    if (!hit?.row || !form) return;
    const name = partyDisplayName(hit.row);
    const set = (field, value) => {
      const el = form.elements.namedItem(field);
      if (el) el.value = value ?? "";
    };
    set("customerName", name);
    set("customerPhone", hit.row.customerPhone || "");
    set("customerEmail", hit.row.customerEmail || "");
    set("registration", String(hit.vehicle?.registration || "").toUpperCase());
    set("vehicle", hit.vehicle?.vehicle || "");
    if (customerIdInput) customerIdInput.value = hit.row.customerId || "";
    if (partyFind) partyFind.value = hit.vehicle?.registration || name;
    setPartyFindStatus(
      `${name}${hit.vehicle?.registration ? ` · ${String(hit.vehicle.registration).toUpperCase()}` : ""}`,
      true
    );
    hidePartySuggest();
  }

  function renderPartySuggest(hits) {
    if (!partySuggest) return;
    if (!hits.length) {
      hidePartySuggest();
      return;
    }
    partySuggest.hidden = false;
    partySuggest.innerHTML = hits
      .map(
        (hit, index) =>
          `<button type="button" data-hit="${index}">${Admin.escapeHtml(hit.label)}</button>`
      )
      .join("");
    partySuggest.querySelectorAll("[data-hit]").forEach((btn) => {
      btn.addEventListener("click", () => applyPartyHit(hits[Number(btn.dataset.hit)]));
    });
  }

  function onPartyFindInput() {
    if (!partyFind) return;
    const q = String(partyFind.value || "").trim();
    if (!q) {
      hidePartySuggest();
      setPartyFindStatus("");
      return;
    }
    if (!customerDirectory.length) {
      setPartyFindStatus("No customers yet. Add them under Customers first.");
      hidePartySuggest();
      return;
    }
    const hits = partySearchHits(q);
    if (!hits.length) {
      setPartyFindStatus("No matching customer or plate");
      hidePartySuggest();
      return;
    }
    setPartyFindStatus(`${hits.length} match${hits.length === 1 ? "" : "es"} — click to fill`);
    renderPartySuggest(hits);
  }

  function updateEndPreview() {
    if (!form || !endPreview) return;
    const start = form.elements.namedItem("startTime")?.value;
    const duration = form.elements.namedItem("durationMinutes")?.value;
    endPreview.value = endTime(start, duration) || "";
  }

  function updateJobButtons() {
    const linked = Boolean(current?.jobId);
    if (createJobBtn) createJobBtn.hidden = !current || linked || current.status === "cancelled" || current.status === "no_show";
    if (openJobBtn) openJobBtn.hidden = !linked;
    if (jobLinkEl) {
      jobLinkEl.textContent = linked
        ? `Linked job: ${current.jobNumber || current.jobId}`
        : "No job linked yet. Create one when the vehicle arrives, or link an existing job later.";
    }
  }

  function renderBoard() {
    if (!board) return;
    updateRangeLabel();
    const days = boardDays();

    board.classList.toggle("calendar-board-fortnight", viewMode === "fortnight");
    board.classList.toggle("calendar-board-month", viewMode === "month");

    board.innerHTML = days
      .map((day) => {
        const dayRows = rows.filter((r) => r.date === day);
        const past = day < Admin.todayIso();
        const bookable = !past && !isSunday(day);
        const heading = formatShortDay(day);
        const slots = dayRows.length
          ? `<div class="cal-day-slots">
              ${dayRows
                .map((row) => {
                  const time = `${row.startTime}–${row.endTime || endTime(row.startTime, row.durationMinutes)}`;
                  const vehicleLine = [row.registration, row.vehicle].filter(Boolean).join(" · ");
                  return `<button type="button" class="cal-slot status-${Admin.escapeAttr(row.status)}" data-id="${Admin.escapeAttr(row.id)}">
                    <span class="cal-slot-time">${Admin.escapeHtml(time)}</span>
                    <strong>${Admin.escapeHtml(row.customerName || "Customer")}</strong>
                    ${vehicleLine ? `<span class="muted small">${Admin.escapeHtml(vehicleLine)}</span>` : ""}
                    <span class="badge ${Admin.escapeAttr(row.status)}">${Admin.escapeHtml(statusLabel(row.status))}</span>
                  </button>`;
                })
                .join("")}
            </div>`
          : `<p class="muted small">${past ? "No bookings" : "No bookings yet"}</p>`;

        const [y, m, d] = String(day).split("-").map(Number);
        const weekday = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
          new Date(Date.UTC(y, m - 1, d)).getUTCDay()
        ];
        return `<article class="cal-day cal-day-${weekday}${past ? " is-past" : ""}${bookable ? " is-bookable" : ""}" data-day="${Admin.escapeAttr(day)}">
          <header class="cal-day-header">
            <strong>${Admin.escapeHtml(heading)}</strong>
            ${bookable ? `<button type="button" class="ghost cal-day-add" data-book-day="${Admin.escapeAttr(day)}">+ Book</button>` : ""}
          </header>
          ${slots}
        </article>`;
      })
      .join("");

    board.querySelectorAll(".cal-slot[data-id]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        openAppointment(btn.dataset.id);
      });
    });
    board.querySelectorAll("[data-book-day]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        newAppointment({ date: btn.dataset.bookDay });
      });
    });
    board.querySelectorAll(".cal-day.is-bookable[data-day]").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest(".cal-slot, [data-book-day]")) return;
        newAppointment({ date: card.dataset.day });
      });
    });
  }

  async function loadList() {
    if (!meta) {
      meta = await Admin.api("/api/appointments/meta");
      fillDurationSelect(120);
    }
    const { from, to } = rangeBounds();
    rows = await Admin.api(`/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    renderBoard();
  }

  function fillForm(row) {
    fillStatusSelect(row.status || "booked");
    fillDurationSelect(row.durationMinutes || 120);
    fillStartTimeSelect(row.startTime || "09:00");
    const set = (name, value) => {
      const el = form?.elements?.namedItem?.(name);
      if (el) el.value = value ?? "";
    };
    const rawDate = row.date || Admin.todayIso();
    const dateValue = current?.id ? rawDate : nextBookableDate(rawDate);
    syncDateInputLimits(current?.id ? rawDate : "");
    set("date", dateValue);
    set("durationMinutes", String(row.durationMinutes || 120));
    set("status", row.status || "booked");
    set("customerName", row.customerName || "");
    set("customerPhone", row.customerPhone || "");
    set("customerEmail", row.customerEmail || "");
    set("registration", row.registration || "");
    set("vehicle", row.vehicle || "");
    set("workSummary", row.workSummary || "");
    set("notes", row.notes || "");
    if (customerIdInput) customerIdInput.value = row.customerId || "";
    if (partyFind) partyFind.value = row.registration || row.customerName || "";
    setPartyFindStatus("");
    hidePartySuggest();
    if (jobSelect) jobSelect.value = row.jobId || "";
    updateEndPreview();
    updateJobButtons();
  }

  function collectPayload() {
    const value = (name) => String(form.elements.namedItem(name)?.value || "").trim();
    let customerId = value("customerId");
    if (customerId) {
      const listed = customerDirectory.find((r) => r.customerId === customerId);
      const snapshot = {
        customerId,
        customerName: value("customerName"),
        customerEmail: value("customerEmail"),
        registration: value("registration"),
      };
      if (!listed || !Admin.sameParty(listed, snapshot)) {
        customerId = "";
        if (customerIdInput) customerIdInput.value = "";
      }
    }
    return {
      date: value("date"),
      startTime: value("startTime"),
      durationMinutes: Number(value("durationMinutes")) || 120,
      status: value("status") || "booked",
      customerId,
      customerName: value("customerName"),
      customerPhone: value("customerPhone"),
      customerEmail: value("customerEmail"),
      registration: value("registration").toUpperCase(),
      vehicle: value("vehicle"),
      workSummary: value("workSummary"),
      notes: value("notes"),
      jobId: value("jobId"),
      source: current?.source || "manual",
    };
  }

  async function showList(opts = {}) {
    listView.hidden = false;
    editView.hidden = true;
    current = null;
    if (opts.date) {
      anchorDate = String(opts.date).slice(0, 10);
    } else if (viewMode === "fortnight" || viewMode === "month") {
      // Sunday roll: finished Mon–Sat weeks drop out of the default view.
      if (plusDays(startOfWeek(anchorDate), 5) < Admin.todayIso()) {
        anchorDate = activeFortnightStart();
      }
    }
    if (opts.view) viewMode = opts.view;
    document.querySelectorAll("[data-cal-view]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.calView === viewMode);
    });
    Admin.setViewTitle(viewMode === "month" ? "1-month calendar" : "2-week calendar");
    try {
      await loadList();
    } catch (err) {
      alert(err.message);
    }
  }

  async function openAppointment(id) {
    current = await Admin.api(`/api/appointments/${id}`);
    listView.hidden = true;
    editView.hidden = false;
    Admin.setViewTitle("Appointment");
    await Promise.all([loadJobOptions(), loadCustomerDirectory()]);
    fillForm(current);
  }

  async function newAppointment(partial = {}) {
    current = {
      id: "",
      date: nextBookableDate(partial.date || anchorDate || Admin.todayIso()),
      startTime: partial.startTime || "09:00",
      durationMinutes: partial.durationMinutes || 120,
      status: "booked",
      customerId: partial.customerId || "",
      customerName: partial.customerName || "",
      customerPhone: partial.customerPhone || "",
      customerEmail: partial.customerEmail || "",
      registration: partial.registration || "",
      vehicle: partial.vehicle || "",
      workSummary: partial.workSummary || "",
      notes: "",
      jobId: partial.jobId || "",
      jobNumber: partial.jobNumber || "",
      source: "manual",
    };
    listView.hidden = true;
    editView.hidden = false;
    Admin.setViewTitle("New appointment");
    await Promise.all([loadJobOptions(), loadCustomerDirectory()]);
    fillForm(current);
    if (partyFind && !partial.customerName && !partial.registration) {
      partyFind.focus();
    }
  }

  async function saveAppointment() {
    const payload = collectPayload();
    assertBookableDate(payload.date);
    if (!payload.customerName) throw new Error("Customer name is required.");
    if (current?.id) {
      current = await Admin.api(`/api/appointments/${current.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      current = await Admin.api("/api/appointments", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
    await loadJobOptions();
    fillForm(current);
    showStatus("Saved");
    return current;
  }

  window.DeaneCalendar = {
    showList,
    openAppointment,
    newAppointment,
  };

  document.getElementById("btn-cal-prev")?.addEventListener("click", () => {
    anchorDate = plusDays(anchorDate, -stepDays());
    showList();
  });
  document.getElementById("btn-cal-next")?.addEventListener("click", () => {
    anchorDate = plusDays(anchorDate, stepDays());
    showList();
  });
  document.getElementById("btn-cal-today")?.addEventListener("click", () => {
    anchorDate = activeFortnightStart();
    showList();
  });
  document.querySelectorAll("[data-cal-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      viewMode = btn.dataset.calView;
      showList();
    });
  });
  document.getElementById("btn-cal-new")?.addEventListener("click", () =>
    newAppointment({ date: nextBookableDate(anchorDate) })
  );
  document.getElementById("btn-cal-back")?.addEventListener("click", () => showList());
  document.getElementById("btn-cal-save")?.addEventListener("click", async () => {
    try {
      await saveAppointment();
    } catch (err) {
      alert(err.message);
    }
  });
  document.getElementById("btn-cal-delete")?.addEventListener("click", async () => {
    if (!current?.id || !confirm("Delete this appointment?")) return;
    try {
      await Admin.api(`/api/appointments/${current.id}`, { method: "DELETE" });
      await showList();
    } catch (err) {
      alert(err.message);
    }
  });
  createJobBtn?.addEventListener("click", async () => {
    try {
      if (!current?.id) await saveAppointment();
      const result = await Admin.api(`/api/appointments/${current.id}/create-job`, {
        method: "POST",
        body: "{}",
      });
      current = result.appointment;
      fillForm(current);
      showStatus(result.created ? "Job card created" : "Job already linked");
      if (result.job?.id && window.DeaneJobs?.openJob) {
        Admin.setSection("jobs");
        await window.DeaneJobs.openJob(result.job.id);
      }
    } catch (err) {
      alert(err.message);
    }
  });
  openJobBtn?.addEventListener("click", async () => {
    if (!current?.jobId || !window.DeaneJobs?.openJob) return;
    Admin.setSection("jobs");
    await window.DeaneJobs.openJob(current.jobId);
  });
  form?.addEventListener("input", (event) => {
    updateEndPreview();
    const name = event.target?.name;
    if (
      customerIdInput?.value &&
      (name === "customerName" ||
        name === "customerPhone" ||
        name === "customerEmail" ||
        name === "registration" ||
        name === "vehicle")
    ) {
      const listed = customerDirectory.find((r) => r.customerId === customerIdInput.value);
      const snapshot = {
        customerId: customerIdInput.value,
        customerName: form.elements.namedItem("customerName")?.value,
        customerEmail: form.elements.namedItem("customerEmail")?.value,
        registration: form.elements.namedItem("registration")?.value,
      };
      if (!listed || !Admin.sameParty(listed, snapshot)) {
        customerIdInput.value = "";
        setPartyFindStatus("");
      }
    }
  });
  form?.addEventListener("change", (event) => {
    updateEndPreview();
    if (event.target === form.elements.namedItem("date")) {
      const dateEl = event.target;
      try {
        assertBookableDate(dateEl.value);
        dateEl.setCustomValidity("");
      } catch (err) {
        dateEl.setCustomValidity(err.message);
        dateEl.reportValidity();
      }
    }
  });
  form?.elements?.namedItem?.("registration")?.addEventListener("input", (e) => {
    const el = e.target;
    const next = String(el.value || "").toUpperCase();
    if (next !== el.value) el.value = next;
  });
  partyFind?.addEventListener("input", () => {
    if (customerIdInput) customerIdInput.value = "";
    onPartyFindInput();
  });
  partyFind?.addEventListener("search", onPartyFindInput);
  partyFind?.addEventListener("focus", () => {
    if (String(partyFind.value || "").trim()) onPartyFindInput();
  });
  document.addEventListener("click", (event) => {
    if (!partySuggest || partySuggest.hidden) return;
    if (partySuggest.contains(event.target) || partyFind?.contains(event.target)) return;
    hidePartySuggest();
  });
})();
