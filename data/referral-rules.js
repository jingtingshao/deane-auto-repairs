/** Referral program rules — Deane Auto Repairs (admin phase 1). */

module.exports = {
  creditAmount: 20,
  creditValidMonths: 6,
  minInvoiceSpend: 50,
  maxCreditsPerInvoice: 40,
  /** Whole credits only — never split a $20 credit across invoices. */
  wholeCreditsOnly: true,
  cashOutAllowed: false,
  transferable: false,
};
