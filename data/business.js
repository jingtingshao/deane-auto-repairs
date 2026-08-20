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
  gstNumber: "",
  website: "https://www.deaneauto.co.nz",
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
    return `How to pay\nBank account number: ${this.bankAccount}\n\nPayment terms\n${this.paymentTermsText()}`;
  },
};
