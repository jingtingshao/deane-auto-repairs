(() => {
  const FORM_ENDPOINT = "https://formsubmit.co/ajax/deaneautonz@gmail.com";
  const AUTOREPLY = [
    "Hi,",
    "",
    "Your email has been sent — thank you for contacting Deane Auto Repairs.",
    "",
    "We've received your booking enquiry and will get back to you soon to confirm a time.",
    "",
    "If you need to speak with us sooner:",
    "Phone: 0800 625 9827",
    "Email: deaneautonz@gmail.com",
    "Address: Deane Auto Repairs (Next to BP Petrol Station), 63 Hayr Road, Three Kings, Auckland",
    "Hours: Mon–Sat 8:30am – 5:30pm",
    "",
    "Kind regards,",
    "Deane Auto Repairs",
  ].join("\n");

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
      if (helpSelect) helpSelect.value = link.dataset.bookingType;
    });
  });

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
  const openChecklist = () => {
    if (!checklist) return;
    checklist.open = true;
  };

  document.querySelectorAll("[data-open-checklist], a[href='#full-checklist']").forEach((link) => {
    link.addEventListener("click", () => {
      openChecklist();
    });
  });

  if (location.hash === "#prices") {
    location.replace("#services");
  }
    openChecklist();
  }
  window.addEventListener("hashchange", () => {
    if (location.hash === "#full-checklist") openChecklist();
  });

  const setStatus = (message, type) => {
    if (!status) return;
    status.hidden = false;
    status.classList.remove("is-success", "is-error");
    if (type) status.classList.add(type);
    status.textContent = message;
  };

  const setLoading = (loading) => {
    if (!submitBtn) return;
    submitBtn.disabled = loading;
    submitBtn.textContent = loading ? "Sending…" : "Send booking enquiry";
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
        _template: "table",
        _captcha: "false",
        _autoresponse: AUTOREPLY,
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
          throw new Error(result.message || "Something went wrong sending the form.");
        }

        form.reset();
        setStatus(
          "Your email has been sent. We’ll get back to you soon to confirm a time.",
          "is-success"
        );
      } catch (error) {
        setStatus(
          "Sorry — we couldn’t send that just now. Please call 0800 625 9827 or email deaneautonz@gmail.com.",
          "is-error"
        );
        console.error(error);
      } finally {
        setLoading(false);
      }
    });
  }
})();
