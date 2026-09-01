(() => {
  const widget = document.querySelector("[data-booking-widget]");
  if (!widget) return;

  const infoEl = widget.querySelector("[data-booking-info]");
  const monthLabel = widget.querySelector("[data-cal-month-label]");
  const calGrid = widget.querySelector("[data-cal-grid]");
  const calPrev = widget.querySelector("[data-cal-prev]");
  const calNext = widget.querySelector("[data-cal-next]");
  const timesDayLabel = widget.querySelector("[data-times-day-label]");
  const timesList = widget.querySelector("[data-times-list]");
  const timesHint = widget.querySelector("[data-times-hint]");
  const stepPicker = widget.querySelector('[data-booking-step="picker"]');
  const stepDetails = widget.querySelector('[data-booking-step="details"]');
  const stepDone = widget.querySelector('[data-booking-step="done"]');
  const form = widget.querySelector("[data-booking-form]");
  const summaryEl = widget.querySelector("[data-booking-summary]");
  const doneMsg = widget.querySelector("[data-booking-done-msg]");
  const status = widget.querySelector("[data-form-status]");
  const submitBtn = widget.querySelector("[data-submit-btn]");
  const backBtn = widget.querySelector("[data-booking-back]");
  const resetBtn = widget.querySelector("[data-booking-reset]");

  const SERVICE_ALIASES = {
    "Service + WOF": "Service",
    "Repairs / other": "Repair",
    "Pre-Purchase Inspection": "Pre-Purchase Inspection",
  };

  let meta = null;
  let viewMonth = "";
  let monthDays = {};
  let selectedServiceId = "";
  let selectedDate = "";
  let selectedTime = "";
  let timeFormat = "12h";
  let loadingMonth = false;
  let loadingSlots = false;

  function todayIsoLocal() {
    return meta?.today || todayIsoLocalFallback();
  }

  function todayIsoLocalFallback() {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
  }

  function shiftMonth(yearMonth, delta) {
    const [y, m] = String(yearMonth).split("-").map(Number);
    const utc = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function monthLongLabel(yearMonth) {
    const [y, m] = String(yearMonth).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-NZ", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  function weekdayUtc(isoDate) {
    const [y, m, d] = String(isoDate).slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  function isSunday(isoDate) {
    return weekdayUtc(isoDate) === 0;
  }

  function dayShortLabel(isoDate) {
    const [y, m, d] = String(isoDate).slice(0, 10).split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-NZ", {
      weekday: "short",
      timeZone: "UTC",
    });
    const suffix =
      d % 10 === 1 && d !== 11
        ? "st"
        : d % 10 === 2 && d !== 12
          ? "nd"
          : d % 10 === 3 && d !== 13
            ? "rd"
            : "th";
    return `${weekday} ${d}${suffix}`;
  }

  function normalizeServiceId(raw) {
    const key = String(raw || "").trim();
    return SERVICE_ALIASES[key] || key;
  }

  function currentService() {
    return meta?.services?.find((s) => s.id === selectedServiceId) || null;
  }

  function showStep(name) {
    stepPicker.hidden = name !== "picker";
    stepDetails.hidden = name !== "details";
    stepDone.hidden = name !== "done";
  }

  function setStatus(message, type, allowHtml = false) {
    if (!status) return;
    status.hidden = !message;
    status.classList.remove("is-success", "is-error");
    if (type) status.classList.add(type);
    if (allowHtml) status.innerHTML = message;
    else status.textContent = message || "";
  }

  function renderInfo() {
    if (!infoEl || !meta) return;
    const service = currentService();
    const biz = meta.business || {};
    const serviceOptions = (meta.services || [])
      .map(
        (s) =>
          `<option value="${escapeAttr(s.id)}"${s.id === selectedServiceId ? " selected" : ""}>${escapeHtml(s.label)}</option>`
      )
      .join("");
    infoEl.innerHTML = `
      <p class="biz-name">${escapeHtml(biz.name || "Deane Auto Repairs")}</p>
      <h3>Book a drop-off</h3>
      <label class="booking-service-select">Service
        <select data-service-select>${serviceOptions}</select>
      </label>
      <dl>
        <div>
          <dt>Duration</dt>
          <dd>${meta.dropOffDurationMinutes || 60} min drop-off</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>${escapeHtml(biz.street || "")}<br />${escapeHtml(biz.suburb || "")}, ${escapeHtml(biz.city || "Auckland")}</dd>
        </div>
        <div>
          <dt>Hours</dt>
          <dd>${escapeHtml(biz.hoursShort || "Mon–Sat 8:30am – 5:30pm")}<br />${escapeHtml(biz.hoursSunday || "Sunday closed")}</dd>
        </div>
        <div>
          <dt>Timezone</dt>
          <dd>${escapeHtml(meta.timezone || "Pacific/Auckland")}</dd>
        </div>
      </dl>
      ${service ? `<p class="booking-times-hint">Selected: ${escapeHtml(service.label)}</p>` : ""}
    `;
    const select = infoEl.querySelector("[data-service-select]");
    select?.addEventListener("change", () => {
      selectedServiceId = select.value;
      selectedDate = "";
      selectedTime = "";
      renderInfo();
      loadMonthAvailability().then(() => {
        renderCalendar();
        renderTimes([]);
      });
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, "&#39;");
  }

  async function loadMeta() {
    const res = await fetch("/api/booking/meta", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Could not load booking settings.");
    meta = await res.json();
    if (!selectedServiceId && meta.services?.length) {
      selectedServiceId = meta.services[0].id;
    }
    viewMonth = (meta.today || todayIsoLocalFallback()).slice(0, 7);
  }

  async function loadMonthAvailability() {
    if (!viewMonth) return;
    loadingMonth = true;
    try {
      const res = await fetch(
        `/api/booking/availability?month=${encodeURIComponent(viewMonth)}&service=${encodeURIComponent(selectedServiceId)}`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) throw new Error("Could not load calendar.");
      const data = await res.json();
      monthDays = data.days || {};
    } finally {
      loadingMonth = false;
    }
  }

  async function loadSlots(date) {
    loadingSlots = true;
    timesList.innerHTML = "";
    timesHint.hidden = false;
    timesHint.textContent = "Loading times…";
    try {
      const res = await fetch(
        `/api/booking/availability?date=${encodeURIComponent(date)}&service=${encodeURIComponent(selectedServiceId)}`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) throw new Error("Could not load times.");
      const data = await res.json();
      renderTimes(data.slots || []);
    } catch {
      renderTimes([]);
      timesHint.textContent = "Could not load times. Please try again.";
    } finally {
      loadingSlots = false;
    }
  }

  function renderCalendar() {
    if (!calGrid || !monthLabel) return;
    monthLabel.textContent = monthLongLabel(viewMonth);
    const [year, month] = viewMonth.split("-").map(Number);
    const firstDay = new Date(Date.UTC(year, month - 1, 1));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const startPad = firstDay.getUTCDay();
    const cells = [];

    for (let i = 0; i < startPad; i += 1) {
      cells.push('<span class="booking-cal-spacer" aria-hidden="true"></span>');
    }

    const today = todayIsoLocal();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${viewMonth}-${String(day).padStart(2, "0")}`;
      const sunday = isSunday(iso);
      const available = Boolean(monthDays[iso]);
      const past = iso < today;
      const selected = iso === selectedDate;
      let cls = "booking-cal-day";
      if (sunday || past || !available) {
        cls += sunday ? " is-closed" : " is-muted";
      } else {
        cls += " is-available";
      }
      if (selected) cls += " is-selected";
      const disabled = sunday || past || !available;
      cells.push(
        `<button type="button" class="${cls}" data-date="${escapeAttr(iso)}" ${disabled ? "disabled" : ""} aria-label="${escapeAttr(iso)}">${day}</button>`
      );
    }

    calGrid.innerHTML = cells.join("");
    calGrid.querySelectorAll("[data-date]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedDate = btn.dataset.date || "";
        selectedTime = "";
        renderCalendar();
        timesDayLabel.textContent = dayShortLabel(selectedDate);
        loadSlots(selectedDate);
      });
    });

    const minMonth = today.slice(0, 7);
    const maxDate = meta?.maxDate || today;
    const maxMonth = maxDate.slice(0, 7);
    if (calPrev) calPrev.disabled = viewMonth <= minMonth;
    if (calNext) calNext.disabled = viewMonth >= maxMonth;
  }

  function renderTimes(slots) {
    if (!timesList || !timesHint) return;
    const available = (slots || []).filter((s) => s.available);
    if (!selectedDate) {
      timesList.innerHTML = "";
      timesHint.hidden = false;
      timesHint.textContent = "Pick a date to see drop-off times.";
      return;
    }
    if (!available.length) {
      timesList.innerHTML = "";
      timesHint.hidden = false;
      timesHint.textContent = "No drop-off times left on this day.";
      return;
    }
    timesHint.hidden = true;
    timesList.innerHTML = available
      .map((slot) => {
        const label = timeFormat === "24h" ? slot.label24h : slot.label12h;
        return `<button type="button" class="booking-time-slot" data-time="${escapeAttr(slot.startTime)}">${escapeHtml(label)}</button>`;
      })
      .join("");
    timesList.querySelectorAll("[data-time]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedTime = btn.dataset.time || "";
        openDetailsStep();
      });
    });
  }

  function openDetailsStep() {
    const service = currentService();
    const label = timeFormat === "24h" ? selectedTime : bookingLabel12h(selectedTime);
    summaryEl.textContent = `${service?.label || "Booking"} · ${dayShortLabel(selectedDate)} · ${label} drop-off`;
    showStep("details");
    setStatus("", null);
    stepDetails.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function bookingLabel12h(time) {
    const [hRaw, m] = String(time || "").split(":").map(Number);
    const suffix = hRaw >= 12 ? "pm" : "am";
    const h12 = hRaw % 12 || 12;
    return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
  }

  widget.querySelectorAll("[data-time-format]").forEach((btn) => {
    btn.addEventListener("click", () => {
      timeFormat = btn.dataset.timeFormat || "12h";
      widget.querySelectorAll("[data-time-format]").forEach((b) => {
        b.classList.toggle("is-active", b === btn);
      });
      if (selectedDate) loadSlots(selectedDate);
    });
  });

  calPrev?.addEventListener("click", async () => {
    viewMonth = shiftMonth(viewMonth, -1);
    selectedDate = "";
    selectedTime = "";
    await loadMonthAvailability();
    renderCalendar();
    renderTimes([]);
    timesDayLabel.textContent = "Select a time";
  });

  calNext?.addEventListener("click", async () => {
    viewMonth = shiftMonth(viewMonth, 1);
    selectedDate = "";
    selectedTime = "";
    await loadMonthAvailability();
    renderCalendar();
    renderTimes([]);
    timesDayLabel.textContent = "Select a time";
  });

  backBtn?.addEventListener("click", () => {
    showStep("picker");
    setStatus("", null);
  });

  resetBtn?.addEventListener("click", () => {
    selectedDate = "";
    selectedTime = "";
    form?.reset();
    showStep("picker");
    renderCalendar();
    renderTimes([]);
    timesDayLabel.textContent = "Select a time";
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (!selectedDate || !selectedTime || !selectedServiceId) {
      setStatus("Choose a date and time first.", "is-error");
      return;
    }

    const data = new FormData(form);
    const payload = {
      service: selectedServiceId,
      date: selectedDate,
      startTime: selectedTime,
      name: data.get("name") || "",
      phone: data.get("phone") || "",
      email: data.get("email") || "",
      vehicle: data.get("vehicle") || "",
      rego: data.get("rego") || "",
      notes: data.get("notes") || "",
      _gotcha: data.get("_gotcha") || "",
    };

    submitBtn.disabled = true;
    submitBtn.innerHTML = "Confirming… <span>→</span>";
    setStatus("Saving your booking…", null);

    try {
      const response = await fetch("/api/booking/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) {
          selectedTime = "";
          showStep("picker");
          if (selectedDate) loadSlots(selectedDate);
        }
        throw new Error(result.error || "Could not confirm booking.");
      }
      const when = result.summary?.whenLabel || summaryEl.textContent;
      const emailNote = result.emailSent
        ? " A confirmation email has been sent."
        : " We have your booking — if you don’t receive an email, call 0800 625 9827.";
      doneMsg.textContent = `${when}.${emailNote}`;
      showStep("done");
      await loadMonthAvailability();
      if (selectedDate && viewMonth === selectedDate.slice(0, 7)) {
        renderCalendar();
      }
    } catch (error) {
      setStatus(
        `${error.message || "Something went wrong."} Please try another time or call <a href="tel:08006259827">0800 625 9827</a>.`,
        "is-error",
        true
      );
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = "Confirm booking <span>→</span>";
    }
  });

  document.querySelectorAll("[data-booking-type]").forEach((link) => {
    link.addEventListener("click", () => {
      selectedServiceId = normalizeServiceId(link.dataset.bookingType);
      if (meta) {
        renderInfo();
        loadMonthAvailability().then(() => {
          renderCalendar();
          renderTimes([]);
        });
      }
    });
  });

  (async () => {
    try {
      await loadMeta();
      renderInfo();
      widget.hidden = false;
      await loadMonthAvailability();
      renderCalendar();
      renderTimes([]);
    } catch (error) {
      widget.innerHTML = `<p class="form-note is-error">Online booking is unavailable right now. Please call <a href="tel:08006259827">0800 625 9827</a>.</p>`;
      widget.hidden = false;
      console.error(error);
    }
  })();
})();
