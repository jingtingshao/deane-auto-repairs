(function () {
  const Admin = window.DeaneAdmin;
  const overlay = document.getElementById("booking-alert");
  const listEl = document.getElementById("booking-alert-list");
  const okBtn = document.getElementById("booking-alert-ok");
  const app = document.getElementById("app");
  const POLL_MS = 12000;

  let timer = null;
  let shownIds = new Set();
  let currentUnseen = [];
  let acking = false;

  function setNavCount(count) {
    const el = document.getElementById("nav-calendar-count");
    if (!el) return;
    const n = Number(count) || 0;
    el.hidden = n <= 0;
    el.textContent = String(n);
    el.classList.toggle("nav-alert", n > 0);
  }

  function dash(value) {
    return String(value || "").trim() || "—";
  }

  function playAlertSound() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      [880, 1175].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.07, now + i * 0.16 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.16);
        osc.stop(now + i * 0.16 + 0.16);
      });
      setTimeout(() => ctx.close().catch(() => {}), 800);
    } catch {
      /* workshop PCs may block audio until a click */
    }
  }

  function rowHtml(row) {
    const phone = String(row.phone || "").trim();
    const phoneHtml = phone
      ? `<a href="tel:${Admin.escapeAttr(phone.replace(/\s+/g, ""))}">${Admin.escapeHtml(phone)}</a>`
      : "—";
    const when = [row.preferredDate, row.preferredTime].filter(Boolean).join(" · ") || "No preferred time";
    return `<article class="booking-alert-item" data-id="${Admin.escapeAttr(row.id)}">
      <p><strong>${Admin.escapeHtml(row.name || "Customer")}</strong> · ${phoneHtml}</p>
      <p>${Admin.escapeHtml(row.helpWith || "Booking")} · ${Admin.escapeHtml(when)}</p>
      <p>${Admin.escapeHtml(dash(row.vehicle))}${row.registration ? ` · ${Admin.escapeHtml(row.registration)}` : ""}</p>
      ${row.notes ? `<p class="booking-alert-notes">${Admin.escapeHtml(row.notes)}</p>` : ""}
      <button type="button" class="ghost" data-add-cal="${Admin.escapeAttr(row.id)}">Add to calendar</button>
    </article>`;
  }

  function hidePopup() {
    if (overlay) overlay.hidden = true;
    currentUnseen = [];
  }

  function showPopup(rows, { beep } = {}) {
    if (!overlay || !listEl || !rows.length) return;
    currentUnseen = rows;
    const many = rows.length > 1;
    const title = document.getElementById("booking-alert-title");
    if (title) title.textContent = many ? `NEW BOOKING (${rows.length})` : "NEW BOOKING";
    listEl.innerHTML = rows.map(rowHtml).join("");
    overlay.hidden = false;
    okBtn?.focus();
    if (beep) playAlertSound();
  }

  async function ackIds(ids) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return;
    acking = true;
    try {
      if (list.length > 1) {
        await Admin.api("/api/booking-requests/ack-all", { method: "POST", body: "{}" });
      } else {
        await Admin.api(`/api/booking-requests/${encodeURIComponent(list[0])}/ack`, {
          method: "POST",
          body: "{}",
        });
      }
      list.forEach((id) => shownIds.delete(id));
    } finally {
      acking = false;
    }
  }

  async function openInCalendar(row) {
    hidePopup();
    Admin.setSection("calendar");
    if (window.DeaneCalendar?.fromWebsiteRequest) {
      await window.DeaneCalendar.fromWebsiteRequest(row);
    }
  }

  async function refresh() {
    if (!Admin || app?.hidden) return;
    try {
      const data = await Admin.api("/api/booking-requests");
      const unseen = Array.isArray(data.unseen) ? data.unseen : [];
      setNavCount(data.unseenCount ?? unseen.length);
      window.DeaneCalendar?.renderWebBookings?.(data.recent || unseen);

      const newIds = unseen.filter((row) => row.id && !shownIds.has(row.id));
      unseen.forEach((row) => {
        if (row.id) shownIds.add(row.id);
      });
      if (unseen.length) showPopup(unseen, { beep: newIds.length > 0 });
      else hidePopup();
    } catch {
      /* session expired is handled by Admin.api */
    }
  }

  function start() {
    if (timer) return;
    refresh();
    timer = setInterval(refresh, POLL_MS);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    shownIds = new Set();
    hidePopup();
    setNavCount(0);
  }

  okBtn?.addEventListener("click", async () => {
    if (acking) return;
    const ids = currentUnseen.map((row) => row.id);
    hidePopup();
    try {
      await ackIds(ids);
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  listEl?.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-add-cal]");
    if (!btn || acking) return;
    const id = btn.dataset.addCal;
    const row = currentUnseen.find((item) => item.id === id);
    if (!row) return;
    try {
      await ackIds([id]);
      await openInCalendar(row);
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  window.DeaneBookingAlerts = { start, stop, refresh };

  if (app && !app.hidden) start();
})();
