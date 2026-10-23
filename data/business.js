/** Canonical business details — use across server emails, APIs, and future apps. */
module.exports = {
  name: "Deane Auto Repairs",
  addressLine2: "(Next to BP Petrol Station)",
  street: "63 Hayr Road",
  suburb: "Mt Roskill",
  city: "Auckland",
  phoneDisplay: "0800 625 9827",
  phoneTel: "08006259827",
  email: "admin@deaneauto.co.nz",
  hoursShort: "Mon–Sat 9:30am – 5:00pm",
  hoursSunday: "Sunday closed",
  gstNumber: "96-650-434",
  website: "https://www.deaneauto.co.nz",
  logoPath: "/images/deane-auto-logo.jpg",
  // Official GBP share link — a plain "Deane Auto Repairs" search also matches competitor Dean Auto Repairs (Carr Rd).
  mapsUrl: "https://maps.app.goo.gl/sbM5hQmmw5oGgNY77",
  mapsLat: -36.9140797,
  mapsLng: 174.7542951,
  // Google review link for invoice QR / email button (GBP → Get more reviews).
  // Override on Render with GOOGLE_REVIEW_URL if the share link changes.
  googlePlaceId: "ChIJpcEa575HDW0RftiwMHU8Cf8",
  googleReviewUrl: "https://g.page/r/CX7YsDB1PAn_ECE/review",
  bankAccountName: "Dreamworld Investments Limited",
  bankAccount: "02-0216-0104554-002",
  paymentTerms: [
    "A 30% deposit may be required for repairs over $1,000.",
    "Payment is due upon completion of the repair and before the vehicle is released.",
    "Additional work will only be carried out with customer approval.",
    "We may retain possession of the vehicle for unpaid amounts.",
  ],

  fullAddress() {
    return `${this.name}\n${this.addressLine2}\n${this.street}\n${this.suburb}, ${this.city}`;
  },
  footerLine() {
    return `${this.name} · ${this.addressLine2} · ${this.street}, ${this.suburb} · ${this.phoneDisplay} · ${this.email}`;
  },
  paymentTermsText() {
    return (this.paymentTerms || []).map((line) => `• ${line}`).join("\n");
  },
  paymentText() {
    return (
      `How to pay\n` +
      `Bank account name: ${this.bankAccountName}\n` +
      `Bank account number: ${this.bankAccount}\n\n` +
      `Payment terms\n${this.paymentTermsText()}`
    );
  },
};
