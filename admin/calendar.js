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
  const remindTomorrowBtn = document.getElementById("btn-cal-remind-tomorrow");
  const smsBtn = document.getElementById("btn-cal-sms");

  let viewMode = "fortnight";
  let anchorDate = firstOpenDay(Admin.todayIso());
  let rows = [];
  let meta = null;
  let current = null;
  let jobOptions = [];
  let customerDirectory = [];
  let tomorrowSmsCount = 0;

  const partyFind = document.getElementById("cal-party-find");
  const partySuggest = document.getElementById("cal-party-suggest");
  const partyFindStatus = document.getElementById("cal-party-find-status");
  const customerIdInput = document.getElementById("cal-customer-id");

  const STATUS_FALLBACK = [
    { id: "booked", label: "Booked" },
    { id: "confirmed", label: "Confirmed" },
    { id: "needs_reschedule", label: "Need reschedule" },
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

  /** First open day on/after iso (Sunday → Monday). Past dates stay past so Prev still works. */
  function firstOpenDay(iso) {
    let cursor = String(iso || Admin.todayIso()).slice(0, 10);
    while (isSunday(cursor)) cursor = plusDays(cursor, 1);
    return cursor;
  }

  function addWorkingDays(iso, count) {
    let cursor = firstOpenDay(iso);
    const step = Number(count) >= 0 ? 1 : -1;
    let left = Math.abs(Number(count) || 0);
    while (left > 0) {
      cursor = plusDays(cursor, step);
      if (!isSunday(cursor)) left -= 1;
    }
    return cursor;
  }

  function workingDaysFrom(startIso, count) {
    const days = [];
    let cursor = firstOpenDay(startIso);
    while (days.length < count) {
      if (!isSunday(cursor)) days.push(cursor);
      cursor = plusDays(cursor, 1);
    }
    return days;
  }

  function workingDayCount() {
    return viewMode === "month" ? 24 : 14;
  }

  /** Next bookable day: not in the past, not Sunday (workshop closed). */
  function nextBookableDate(iso) {
    let cursor = String(iso || Admin.todayIso()).slice(0, 10);
    const today = Admin.todayIso();
    if (cursor < today) cursor = today;
    return firstOpenDay(cursor);
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
    const days = boardDays();
    return { from: days[0], to: days[days.length - 1] };
  }

  function boardDays() {
    return workingDaysFrom(anchorDate, workingDayCount());
  }

  function stepDays() {
    return workingDayCount();
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
    set("customerName", Admin.formatFullCustomerName(name));
    set("customerPhone", hit.row.customerPhone || "");
    set("customerEmail", hit.row.customerEmail || "");
    set("registration", String(hit.vehicle?.registration || "").toUpperCase());
    set("vehicle", Admin.capitalizeVehicleDescription(hit.vehicle?.vehicle || ""));
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
    if (smsBtn) {
      if (Admin.isTechnician?.()) {
        smsBtn.hidden = true;
      } else {
        const canSms = Boolean(current?.canBookingSms);
        const sent = Boolean(current?.bookingSmsReminderSentAt);
        smsBtn.hidden = !current || (!canSms && !sent);
        smsBtn.disabled = !canSms;
        smsBtn.textContent = sent && !canSms ? "Booking SMS sent" : "Send booking SMS";
      }
    }
    if (jobLinkEl) {
      jobLinkEl.textContent = linked
        ? `Linked job: ${current.jobNumber || current.jobId}`
        : "No job linked yet. Create one when the vehicle arrives, or link an existing job later.";
    }
  }

  function updateRemindTomorrowButton() {
    if (!remindTomorrowBtn) return;
    const n = Number(tomorrowSmsCount) || 0;
    if (!n) {
      remindTomorrowBtn.hidden = true;
      remindTomorrowBtn.textContent = "Remind tomorrow";
      return;
    }
    remindTomorrowBtn.hidden = false;
    remindTomorrowBtn.textContent = `Remind tomorrow (${n})`;
  }

  async function refreshTomorrowSmsCount() {
    if (Admin.isTechnician?.()) {
      tomorrowSmsCount = 0;
      updateRemindTomorrowButton();
      return;
    }
    try {
      const info = await Admin.api("/api/appointments/booking-sms-tomorrow");
      tomorrowSmsCount = Number(info.count) || 0;
    } catch {
      tomorrowSmsCount = rows.filter((r) => r.canBookingSms).length;
    }
    updateRemindTomorrowButton();
  }

  async function sendBookingSms(appointmentId, btn) {
    if (!appointmentId) return;
    if (!confirm("Send booking confirmation SMS for this appointment?")) return;
    const label = btn?.textContent || "SMS";
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Sending…";
      }
      const result = await Admin.api("/api/appointments/booking-sms-reminder", {
        method: "POST",
        body: JSON.stringify({ appointmentId }),
      });
      if (result.alreadySent) {
        alert(`Booking SMS already sent on ${Admin.formatDateTimeShort?.(result.sentAt) || result.sentAt}.`);
      } else {
        alert(
          `SMS sent to ${result.to}${result.sandbox ? " (sandbox — not billed)" : ""}`
        );
      }
      await loadList();
      if (current?.id === appointmentId) {
        current = rows.find((r) => r.id === appointmentId) || current;
        fillForm(current);
      }
    } catch (err) {
      alert(err.message || "Could not send SMS.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = label;
      }
    }
  }

  async function sendBulkTomorrowSms() {
    if (!tomorrowSmsCount) {
      alert("No tomorrow bookings with a NZ mobile are waiting for an SMS.");
      return;
    }
    if (
      !confirm(
        `Send booking SMS to ${tomorrowSmsCount} appointment${tomorrowSmsCount === 1 ? "" : "s"} tomorrow?\n\nReply YES to confirm or NO to reschedule.`
      )
    ) {
      return;
    }
    const label = remindTomorrowBtn?.textContent || "Remind tomorrow";
    try {
      if (remindTomorrowBtn) {
        remindTomorrowBtn.disabled = true;
        remindTomorrowBtn.textContent = `Sending ${tomorrowSmsCount}…`;
      }
      const result = await Admin.api("/api/appointments/booking-sms-reminder-bulk", {
        method: "POST",
        body: "{}",
      });
      const failed = Array.isArray(result.failed) ? result.failed : [];
      let msg = `Remind tomorrow done.\nSent: ${result.sent || 0}\nAlready sent: ${result.alreadySent || 0}\nFailed: ${failed.length}`;
      if (failed[0]?.error) msg += `\n\nFirst error: ${failed[0].error}`;
      alert(msg);
      await loadList();
    } catch (err) {
      alert(err.message || "Bulk booking SMS failed.");
    } finally {
      if (remindTomorrowBtn) {
        remindTomorrowBtn.disabled = false;
        remindTomorrowBtn.textContent = label;
      }
      updateRemindTomorrowButton();
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
        const isToday = day === Admin.todayIso();
        const bookable = !past && !isSunday(day);
        const heading = formatShortDay(day);
        const slots = dayRows.length
          ? `<div class="cal-day-slots">
              ${dayRows
                .map((row) => {
                  const time = `${row.startTime}–${row.endTime || endTime(row.startTime, row.durationMinutes)}`;
                  const vehicleLine = [row.registration, row.vehicle].filter(Boolean).join(" · ");
                  return `<div class="cal-slot-wrap">
                    <button type="button" class="cal-slot status-${Admin.escapeAttr(row.status)}" data-id="${Admin.escapeAttr(row.id)}">
                      <span class="cal-slot-time">${Admin.escapeHtml(time)}</span>
                      <strong>${Admin.escapeHtml(row.customerName || "Customer")}</strong>
                      ${vehicleLine ? `<span class="muted small">${Admin.escapeHtml(vehicleLine)}</span>` : ""}
                      <span class="badge ${Admin.escapeAttr(row.status)}">${Admin.escapeHtml(statusLabel(row.status))}</span>
                      ${
                        row.bookingSmsReminderSentAt
                          ? `<span class="muted small">SMS sent</span>`
                          : ""
                      }
                    </button>
                    ${
                      row.canBookingSms && !Admin.isTechnician?.()
                        ? `<button type="button" class="ghost compact cal-slot-sms" data-sms-id="${Admin.escapeAttr(row.id)}">SMS</button>`
                        : ""
                    }
                  </div>`;
                })
                .join("")}
            </div>`
          : `<p class="muted small">${past ? "No bookings" : "No bookings yet"}</p>`;

        const [y, m, d] = String(day).split("-").map(Number);
        const weekday = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
          new Date(Date.UTC(y, m - 1, d)).getUTCDay()
        ];
        return `<article class="cal-day cal-day-${weekday}${past ? " is-past" : ""}${isToday ? " is-today" : ""}${bookable ? " is-bookable" : ""}" data-day="${Admin.escapeAttr(day)}">
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
    board.querySelectorAll("[data-sms-id]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        sendBookingSms(btn.getAttribute("data-sms-id"), btn);
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
        if (event.target.closest(".cal-slot, .cal-slot-sms, [data-book-day]")) return;
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
    await refreshTomorrowSmsCount();
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
    set("customerName", Admin.formatFullCustomerName(row.customerName || ""));
    set("customerPhone", row.customerPhone || "");
    set("customerEmail", row.customerEmail || "");
    set("registration", String(row.registration || "").toUpperCase());
    set("vehicle", Admin.capitalizeVehicleDescription(row.vehicle || ""));
    set("workSummary", Admin.sentenceCase(row.workSummary || ""));
    set("notes", Admin.sentenceCase(row.notes || ""));
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
      customerName: Admin.formatFullCustomerName(value("customerName")),
      customerPhone: value("customerPhone"),
      customerEmail: value("customerEmail"),
      registration: value("registration").toUpperCase(),
      vehicle: Admin.capitalizeVehicleDescription(value("vehicle")),
      workSummary: Admin.sentenceCase(value("workSummary")),
      notes: Admin.sentenceCase(value("notes")),
      jobId: value("jobId"),
      source: current?.source || "manual",
      bookingSmsReminderSentAt: current?.bookingSmsReminderSentAt || "",
    };
  }

  async function showList(opts = {}) {
    listView.hidden = false;
    editView.hidden = true;
    current = null;
    if (opts.date) {
      anchorDate = firstOpenDay(opts.date);
    } else {
      const days = workingDaysFrom(anchorDate, workingDayCount());
      if (days.length && days[days.length - 1] < Admin.todayIso()) {
        anchorDate = firstOpenDay(Admin.todayIso());
      }
    }
    if (opts.view) viewMode = opts.view;
    document.querySelectorAll("[data-cal-view]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.calView === viewMode);
    });
    Admin.setViewTitle(viewMode === "month" ? "Next 24 open days" : "Next 14 open days");
    try {
      await loadList();
      await loadWebBookings();
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
      notes: partial.notes || "",
      jobId: partial.jobId || "",
      jobNumber: partial.jobNumber || "",
      source: partial.source || "manual",
      bookingRequestId: partial.bookingRequestId || "",
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
    const bookingRequestId = String(current?.bookingRequestId || "").trim();
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
    if (bookingRequestId) {
      try {
        await Admin.api(`/api/booking-requests/${encodeURIComponent(bookingRequestId)}/added`, {
          method: "POST",
          body: "{}",
        });
      } catch (err) {
        console.error("Could not mark website booking as added:", err);
      }
      window.DeaneBookingAlerts?.refresh?.();
    }
    await loadJobOptions();
    fillForm(current);
    showStatus(bookingRequestId ? "Saved — website booking marked added" : "Saved");
    return current;
  }

  function renderWebBookings(rows) {
    const el = document.getElementById("calendar-web-bookings");
    if (!el) return;
    const all = Array.isArray(rows) ? rows : [];
    const pending = all.filter((row) => !row.handledAt);
    const handled = all.filter((row) => row.handledAt);
    const list = [...pending, ...handled].slice(0, 12);
    if (!list.length) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML = `<p class="calendar-web-bookings-head">${
      pending.length
        ? `${pending.length} website booking${pending.length === 1 ? "" : "s"} to add`
        : "Website bookings"
    }</p>${list
      .map((row) => {
        const when = [row.preferredDate, row.preferredTime].filter(Boolean).join(" · ") || "No preferred time";
        const plate = String(row.registration || "").trim();
        const added = Boolean(row.handledAt);
        const actions = added
          ? `<span class="calendar-web-added">Added to calendar</span>
             <button type="button" class="ghost danger" data-web-booking-delete="${Admin.escapeAttr(row.id)}">Delete</button>`
          : `<button type="button" class="ghost" data-web-booking-add="${Admin.escapeAttr(row.id)}">Add to calendar</button>
             <button type="button" class="ghost" data-web-booking-done="${Admin.escapeAttr(row.id)}">Mark added</button>
             <button type="button" class="ghost danger" data-web-booking-delete="${Admin.escapeAttr(row.id)}">Delete</button>`;
        return `<article class="calendar-web-row${added ? " is-added" : ""}">
          <div>
            <p><strong>${Admin.escapeHtml(row.name || "Customer")}</strong> · ${Admin.escapeHtml(row.helpWith || "Booking")}</p>
            <small>${Admin.escapeHtml(when)}${plate ? ` · ${Admin.escapeHtml(plate)}` : ""} · ${Admin.escapeHtml(row.phone || "")}</small>
          </div>
          <div class="calendar-web-row-actions">${actions}</div>
        </article>`;
      })
      .join("")}`;
  }

  async function loadWebBookings() {
    try {
      const data = await Admin.api("/api/booking-requests");
      renderWebBookings(data.recent || data.unseen || []);
    } catch {
      renderWebBookings([]);
    }
  }

  async function fromWebsiteRequest(row) {
    const preferred = String(row.preferredDate || "").slice(0, 10);
    const timeRaw = String(row.preferredTime || "").toLowerCase();
    const clockMatch = timeRaw.match(/(\d{1,2})\s*:\s*(\d{2})/);
    let startTime = "09:00";
    if (clockMatch) {
      const hour = Number(clockMatch[1]);
      if (hour >= 0 && hour <= 23) {
        startTime = `${String(hour).padStart(2, "0")}:${clockMatch[2]}`;
      }
    } else if (timeRaw.includes("afternoon")) {
      startTime = "13:00";
    }
    const noteBits = [
      "Website booking request.",
      row.preferredDate || row.preferredTime
        ? `Preferred: ${[row.preferredDate, row.preferredTime].filter(Boolean).join(" · ")}`
        : "",
      row.notes ? `Customer notes: ${row.notes}` : "",
    ].filter(Boolean);
    await newAppointment({
      date: /^\d{4}-\d{2}-\d{2}$/.test(preferred) ? preferred : Admin.todayIso(),
      startTime,
      customerName: row.name || "",
      customerPhone: row.phone || "",
      customerEmail: row.email || "",
      registration: row.registration || "",
      vehicle: row.vehicle || "",
      workSummary: row.helpWith || "",
      notes: noteBits.join("\n"),
      source: "website",
      bookingRequestId: row.id || "",
    });
  }

  window.DeaneCalendar = {
    showList,
    openAppointment,
    newAppointment,
    fromWebsiteRequest,
    renderWebBookings,
  };

  document.getElementById("btn-cal-prev")?.addEventListener("click", () => {
    anchorDate = addWorkingDays(anchorDate, -stepDays());
    showList();
  });
  document.getElementById("btn-cal-next")?.addEventListener("click", () => {
    anchorDate = addWorkingDays(anchorDate, stepDays());
    showList();
  });
  document.getElementById("btn-cal-today")?.addEventListener("click", () => {
    anchorDate = firstOpenDay(Admin.todayIso());
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
  document.getElementById("calendar-web-bookings")?.addEventListener("click", async (event) => {
    const addBtn = event.target.closest("[data-web-booking-add]");
    const doneBtn = event.target.closest("[data-web-booking-done]");
    const deleteBtn = event.target.closest("[data-web-booking-delete]");
    if (!addBtn && !doneBtn && !deleteBtn) return;
    const id = addBtn?.dataset.webBookingAdd || doneBtn?.dataset.webBookingDone || deleteBtn?.dataset.webBookingDelete;
    try {
      if (deleteBtn) {
        if (!confirm("Delete this website booking from the list?")) return;
        await Admin.api(`/api/booking-requests/${encodeURIComponent(id)}`, { method: "DELETE" });
        window.DeaneBookingAlerts?.refresh?.();
        await loadWebBookings();
        return;
      }
      if (doneBtn) {
        await Admin.api(`/api/booking-requests/${encodeURIComponent(id)}/added`, {
          method: "POST",
          body: "{}",
        });
        window.DeaneBookingAlerts?.refresh?.();
        await loadWebBookings();
        return;
      }
      const data = await Admin.api("/api/booking-requests");
      const row = (data.recent || data.pending || data.unseen || []).find((item) => item.id === id);
      if (!row) return;
      if (!row.seenAt) {
        await Admin.api(`/api/booking-requests/${encodeURIComponent(id)}/ack`, {
          method: "POST",
          body: "{}",
        });
      }
      await fromWebsiteRequest(row);
      window.DeaneBookingAlerts?.refresh?.();
    } catch (err) {
      alert(err.message);
    }
  });
  remindTomorrowBtn?.addEventListener("click", () => sendBulkTomorrowSms());
  smsBtn?.addEventListener("click", () => {
    if (!current?.id) return;
    sendBookingSms(current.id, smsBtn);
  });
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
    const el = event.target;
    const name = el?.name;
    if (name === "customerName") Admin.applyLiveTransform(el, Admin.formatFullCustomerName);
    else if (name === "vehicle") Admin.applyLiveTransform(el, Admin.capitalizeVehicleDescription);
    else if (name === "workSummary" || name === "notes") {
      Admin.applyLiveTransform(el, Admin.sentenceCaseLive);
    } else if (name === "registration") {
      Admin.applyLiveTransform(el, (value) => String(value || "").toUpperCase());
    }
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
