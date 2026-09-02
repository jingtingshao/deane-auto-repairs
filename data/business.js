/** Canonical business details — use across server emails, APIs, and future apps. */
module.exports = {
  name: "Deane Auto Repairs",
  addressLine2: "(Next to BP Petrol Station)",
  street: "63 Hayr Road",
  suburb: "Three Kings",
  city: "Auckland",
  phoneDisplay: "0800 625 9827",
  phoneTel: "08006259827",
  email: "deaneautonz@gmail.com",
  hoursShort: "Mon–Sat 8:30am – 5:30pm",
  hoursSunday: "Sunday closed",
  gstNumber: "96-650-434",
  website: "https://www.deaneauto.co.nz",
  logoPath: "/images/deane-auto-logo.jpg",
  // Street pin only — do not search "Deane Auto Repairs" (Google matches competitor Dean Auto Repairs).
  mapsUrl:
    "https://www.google.com/maps/place/63+Hayr+Road,+Three+Kings,+Auckland/@-36.9140797,174.7542951,18z",
  mapsLat: -36.9140797,
  mapsLng: 174.7542951,
  // Google review link for invoice QR / email button.
  // Override on Render with GOOGLE_REVIEW_URL or GOOGLE_PLACE_ID if the GBP share link changes.
  // Listing is at the Hayr / Carr corner next to BP (phone 09 625 9827 / 0800 625 9827).
  googlePlaceId: "ChIJ4azubaRmDW0RFejjjVWPxYY",
  googleReviewUrl: "https://g.page/r/Cb_8HFmv-bW4EAE/review",
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
