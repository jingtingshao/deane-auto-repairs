(() => {
  const FORM_ENDPOINT = "/api/booking";

  const header = document.querySelector("[data-header]");
  const nav = document.querySelector("[data-nav]");
  const toggle = document.querySelector("[data-nav-toggle]");
  const year = document.querySelector("[data-year]");
  const form = document.querySelector("[data-booking-form]");
  const status = document.querySelector("[data-form-status]");
  const submitBtn = document.querySelector("[data-submit-btn]");
  const preferredDate = document.querySelector("#date");
  const helpSelect = document.querySelector("#help");

  if (year) year.textContent = String(new Date().getFullYear());

  if (preferredDate) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const localTomorrow = [
      tomorrow.getFullYear(),
      String(tomorrow.getMonth() + 1).padStart(2, "0"),
      String(tomorrow.getDate()).padStart(2, "0"),
    ].join("-");
    preferredDate.min = localTomorrow;

    preferredDate.addEventListener("input", () => {
      const selected = new Date(`${preferredDate.value}T00:00:00`);
      preferredDate.setCustomValidity(
        selected.getDay() === 0 ? "Please choose Monday to Saturday; we are closed on Sundays." : ""
      );
    });
  }

  document.querySelectorAll("[data-booking-type]").forEach((link) => {
    link.addEventListener("click", () => {
      if (!helpSelect) return;
      const wanted = link.dataset.bookingType || "";
      const match = [...helpSelect.options].find(
        (opt) =>
          opt.value === wanted ||
          opt.value.toLowerCase() === wanted.toLowerCase()
      );
      if (match) helpSelect.value = match.value;
    });
  });

  const HELP_ALIASES = {
    "service-wof": "Service + WOF",
    "service+wof": "Service + WOF",
    wof: "WOF",
    service: "Standard Service",
    "car-service": "Standard Service",
    "standard-service": "Standard Service",
    "premium-service": "Premium / European Service",
    "premium-/-european-service": "Premium / European Service",
    "premium-/european-service": "Premium / European Service",
    european: "Premium / European Service",
    "european-service": "Premium / European Service",
    diesel: "Diesel / 4WD Service",
    "diesel-service": "Diesel / 4WD Service",
    "diesel-4wd": "Diesel / 4WD Service",
    "diesel-/4wd-service": "Diesel / 4WD Service",
    ppi: "Pre-Purchase Inspection",
    "pre-purchase": "Pre-Purchase Inspection",
    winz: "WINZ quote",
    brakes: "Brake inspection",
    brake: "Brake inspection",
    "brake-inspection": "Brake inspection",
    "brakes-suspension": "Brake inspection",
    tyres: "Tyres",
    tyre: "Tyres",
    tires: "Tyres",
    tire: "Tyres",
    repairs: "Repairs / other",
    diagnostics: "Repairs / other",
    "diagnostics-repairs": "Repairs / other",
  };

  const applyHelpValue = (value) => {
    if (!helpSelect || !value) return false;
    const raw = String(value).trim();
    const key = raw.toLowerCase().replace(/\s+/g, "-");
    const mapped = HELP_ALIASES[key] || HELP_ALIASES[raw.toLowerCase()] || raw;
    const match = [...helpSelect.options].find(
      (opt) =>
        opt.value === mapped ||
        opt.value.toLowerCase() === mapped.toLowerCase() ||
        opt.value.toLowerCase() === raw.toLowerCase()
    );
    if (!match) return false;
    helpSelect.value = match.value;
    return true;
  };

  const bookingParams = new URLSearchParams(location.search);
  if (applyHelpValue(bookingParams.get("help") || bookingParams.get("type"))) {
    const booking = document.getElementById("book");
    if (booking) booking.scrollIntoView();
  }

  const onScroll = () => {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -40px 0px" }
    );
    reveals.forEach((el) => observer.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("is-visible"));
  }

  const checklist = document.querySelector("#full-checklist");
  const checklistLinks = document.querySelectorAll("[data-open-checklist], a[href='#full-checklist']");
  const setChecklistOpen = (open) => {
    checklistLinks.forEach((link) => link.setAttribute("aria-expanded", open ? "true" : "false"));
  };
  const openChecklist = () => {
    if (!checklist) return;
    checklist.hidden = false;
    setChecklistOpen(true);
    checklist.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const closeChecklist = () => {
    if (!checklist) return;
    checklist.hidden = true;
    setChecklistOpen(false);
    if (location.hash === "#full-checklist" && history.replaceState) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
  };

  checklistLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      if (checklist && !checklist.hidden) {
        closeChecklist();
        return;
      }
      openChecklist();
      if (history.replaceState) {
        history.replaceState(null, "", "#full-checklist");
      } else {
        location.hash = "full-checklist";
      }
    });
  });
  document.querySelectorAll("[data-close-checklist]").forEach((btn) => {
    btn.addEventListener("click", closeChecklist);
  });

  const tyreToggle = document.querySelector("[data-tyre-size-toggle]");
  const tyrePanel = document.querySelector("[data-tyre-size-panel]");
  const notesField = document.querySelector("#notes");
  const tyreWidth = document.querySelector("#tyre-width");
  const tyreProfile = document.querySelector("#tyre-profile");
  const tyreRim = document.querySelector("#tyre-rim");
  const tyreQuotes = document.querySelector("[data-tyre-quotes]");
  const tyreQuotesNote = document.querySelector("[data-tyre-quotes-note]");
  let tyrePrices = null;
  let tyrePricesLoading = null;

  const tyreSizes = () =>
    Object.keys(tyrePrices?.sizes || {})
      .map((size) => /^(\d{3})\/(\d{2})R(\d{2})$/.exec(size))
      .filter(Boolean)
      .map(([, w, p, r]) => ({ w, p, r }));

  const fillTyreSelect = (select, values, preferred) => {
    if (!select) return;
    const sorted = [...new Set(values)].sort((a, b) => Number(a) - Number(b));
    const keep = [preferred, select.value].find((v) => sorted.includes(v)) || sorted[0];
    select.replaceChildren(...sorted.map((v) => new Option(v, v, false, v === keep)));
    select.value = keep || "";
  };

  const formatDollars = (n) => `$${Number(n).toLocaleString("en-NZ")}`;

  const addTyreNote = (line) => {
    if (!notesField) return;
    const kept = notesField.value
      .split("\n")
      .filter((l) => l.trim() && !/^Tyre( size)?:/.test(l.trim()));
    notesField.value = [...kept, line].join("\n");
  };

  const renderTyreQuotes = () => {
    if (!tyreQuotes || !tyrePrices) return;
    const size = `${tyreWidth.value}/${tyreProfile.value}R${tyreRim.value}`;
    const options = tyrePrices.sizes[size] || [];
    if (!options.length) {
      const empty = document.createElement("p");
      empty.className = "tyre-quotes-empty";
      empty.textContent = "No online price for this size yet — book and we’ll quote it for you.";
      tyreQuotes.replaceChildren(empty);
      return;
    }
    tyreQuotes.replaceChildren(
      ...options.map((opt) => {
        const card = document.createElement("article");
        card.className = `tyre-quote tyre-quote-${opt.tier.toLowerCase().replace(/[^a-z]+/g, "-")}`;

        const tier = document.createElement("p");
        tier.className = "tyre-quote-tier";
        tier.textContent = opt.tier;

        const name = document.createElement("h4");
        name.textContent = `${opt.brand} ${opt.pattern}`.trim();

        const spec = document.createElement("p");
        spec.className = "tyre-quote-spec";
        spec.textContent = [size, opt.load].filter(Boolean).join(" · ");

        const price = document.createElement("p");
        price.className = "tyre-quote-price";
        price.innerHTML = "<strong></strong><span>per tyre, fitted</span>";
        price.querySelector("strong").textContent = formatDollars(opt.price);

        const set = document.createElement("p");
        set.className = "tyre-quote-set";
        set.textContent = `Set of 4: ${formatDollars(opt.price * 4)}`;

        const stock = document.createElement("p");
        stock.className = `tyre-quote-stock${opt.inStock ? " is-available" : ""}`;
        stock.textContent = opt.inStock ? "Available now" : "Order in — we’ll confirm timing";

        const book = document.createElement("a");
        book.className = "service-cta tyres-book-cta";
        book.href = "#book";
        book.innerHTML = 'Book this tyre <span aria-hidden="true">→</span>';
        book.addEventListener("click", () => {
          if (helpSelect) helpSelect.value = "Tyres";
          addTyreNote(
            `Tyre: ${size} ${opt.load} — ${opt.tier} ${opt.brand} ${opt.pattern} — ${formatDollars(opt.price)}/tyre fitted (website price ${tyrePrices.updated})`
          );
        });

        card.append(tier, name, spec, price, set, stock, book);
        return card;
      })
    );
  };

  const onTyreWidth = () => {
    const sizes = tyreSizes().filter((s) => s.w === tyreWidth.value);
    fillTyreSelect(tyreProfile, sizes.map((s) => s.p), tyreProfile.value);
    onTyreProfile();
  };
  const onTyreProfile = () => {
    const sizes = tyreSizes().filter((s) => s.w === tyreWidth.value && s.p === tyreProfile.value);
    fillTyreSelect(tyreRim, sizes.map((s) => s.r), tyreRim.value);
    renderTyreQuotes();
  };

  const loadTyrePrices = () => {
    if (tyrePricesLoading || !tyreQuotes || !tyreWidth || !tyreProfile || !tyreRim) {
      return tyrePricesLoading;
    }
    const getJson = (url) =>
      fetch(url, { cache: "no-cache" }).then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(res.statusText))
      );
    tyrePricesLoading = getJson("/api/public/tyre-prices")
      .catch(() => getJson("assets/tyre-prices.json"))
      .then((data) => {
        tyrePrices = data;
        fillTyreSelect(tyreWidth, tyreSizes().map((s) => s.w), tyreWidth.value);
        onTyreWidth();
        tyreWidth.addEventListener("change", onTyreWidth);
        tyreProfile.addEventListener("change", onTyreProfile);
        tyreRim.addEventListener("change", renderTyreQuotes);
        if (tyreQuotesNote) {
          const updated = new Date(`${data.updated}T00:00:00`).toLocaleDateString("en-NZ", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          tyreQuotesNote.textContent =
            `Prices are per tyre, fitted, incl. GST and Tyrewise fee. Updated ${updated}. ` +
            "Subject to stock — we’ll confirm before ordering. Please match your car’s load/speed rating (e.g. 91H).";
          tyreQuotesNote.hidden = false;
        }
      })
      .catch(() => {
        tyrePricesLoading = null;
      });
    return tyrePricesLoading;
  };

  const openTyreSize = () => {
    if (!tyrePanel || !tyreToggle) return;
    tyrePanel.hidden = false;
    tyreToggle.setAttribute("aria-expanded", "true");
    tyrePanel.scrollIntoView({ behavior: "smooth", block: "start" });
    loadTyrePrices();
  };
  if (tyreToggle && tyrePanel) {
    tyreToggle.addEventListener("click", () => {
      const willOpen = tyrePanel.hidden;
      tyrePanel.hidden = !willOpen;
      tyreToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
      if (willOpen) {
        tyrePanel.scrollIntoView({ behavior: "smooth", block: "start" });
        loadTyrePrices();
      }
    });
  }

  if (location.hash === "#prices") {
    location.replace("#services");
  }
  if (location.hash === "#full-checklist") {
    openChecklist();
  }
  if (location.hash === "#tyres") {
    openTyreSize();
  }
  window.addEventListener("hashchange", () => {
    if (location.hash === "#full-checklist") openChecklist();
    if (location.hash === "#tyres") openTyreSize();
  });

  document.querySelectorAll("[data-tyre-size-book]").forEach((link) => {
    link.addEventListener("click", () => {
      const width = document.querySelector("#tyre-width")?.value || "";
      const profile = document.querySelector("#tyre-profile")?.value || "";
      const rim = document.querySelector("#tyre-rim")?.value || "";
      if (!notesField || !width || !profile || !rim) return;
      const line = `Tyre size: ${width}/${profile}R${rim}`;
      const current = notesField.value.trim();
      notesField.value = current.includes(line)
        ? current
        : current
          ? `${current}\n${line}`
          : line;
    });
  });

  const setStatus = (message, type, allowHtml = false) => {
    if (!status) return;
    status.hidden = false;
    status.classList.remove("is-success", "is-error");
    if (type) status.classList.add(type);
    if (allowHtml) status.innerHTML = message;
    else status.textContent = message;
  };

  const setLoading = (loading) => {
    if (!submitBtn) return;
    submitBtn.disabled = loading;
    submitBtn.innerHTML = loading
      ? "Sending… <span>→</span>"
      : 'Request a booking <span>→</span>';
  };

  if (form && status) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const data = new FormData(form);
      const payload = {
        name: data.get("name") || "",
        email: data.get("email") || "",
        phone: data.get("phone") || "",
        vehicle: data.get("vehicle") || "",
        registration: data.get("rego") || "—",
        preferred_date: data.get("date") || "—",
        preferred_time: data.get("time") || "—",
        help_with: data.get("help") || "",
        notes: data.get("notes") || "—",
        _subject: `Booking enquiry: ${data.get("help") || "Service"} — ${data.get("name") || ""}`,
      };

      setLoading(true);
      setStatus("Sending your enquiry…", null);

      try {
        const response = await fetch(FORM_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.error || result.message || "Something went wrong sending the form.");
        }

        form.reset();
        setStatus(
          "Booking request received. We will contact you shortly to confirm the booking or discuss any changes.",
          "is-success"
        );
      } catch (error) {
        setStatus(
          'Sorry — we couldn’t send that just now. Please call <a href="tel:08006259827">0800 625 9827</a> or email <a href="mailto:admin@deaneauto.co.nz">admin@deaneauto.co.nz</a>.',
          "is-error",
          true
        );
        console.error(error);
      } finally {
        setLoading(false);
      }
    });
  }
})();
