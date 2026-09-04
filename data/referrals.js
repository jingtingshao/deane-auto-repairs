/** Referral program store helpers — referrals + credits in one JSON array. */

const { randomUUID } = require("crypto");
const catalog = require("./catalog");
const rules = require("./referral-rules");
const { nowIso, todayIso } = require("./nz-time");

const REFERRAL_STATUSES = ["pending", "qualified", "rejected", "cancelled"];
const CREDIT_STATUSES = ["active", "used", "expired", "void"];

function addMonthsIsoDate(isoDate, months) {
  const raw = String(isoDate || "").slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return addMonthsIsoDate(todayIso(), months);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1 + Number(months), day));
  return utc.toISOString().slice(0, 10);
}

function isoDateOnly(value) {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

function money(n) {
  return catalog.round2(Math.max(0, Number(n) || 0));
}

function normalizeAppliedRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      creditId: String(row.creditId || "").trim(),
      amount: money(row.amount),
      usedAt: String(row.usedAt || "").trim(),
    }))
    .filter((row) => row.creditId && row.amount > 0);
}

function referralCreditTotal(doc) {
  return money(
    normalizeAppliedRows(doc?.referralCreditsApplied).reduce((sum, row) => sum + row.amount, 0)
  );
}

function isInvoicePaidForReferral(doc, totals) {
  if (!doc || doc.kind !== "invoice" || doc.status === "void") return false;
  const totalIncl =
    Number(totals?.totalIncl) ||
    catalog.computeTotals(doc.lines || []).totalIncl;
  const amountPaid = money(
    (Array.isArray(doc.payments) ? doc.payments : []).reduce(
      (sum, row) => sum + (Number(row.amount) || 0),
      0
    )
  );
  const covered = money(amountPaid + referralCreditTotal(doc));
  return totalIncl > 0 && covered + 0.001 >= totalIncl;
}

function isQualifyingPaidInvoice(doc) {
  if (!doc || doc.kind !== "invoice" || doc.status === "void") return false;
  const totals = catalog.computeTotals(doc.lines || []);
  if (totals.totalIncl + 0.001 < rules.minInvoiceSpend) return false;
  return isInvoicePaidForReferral(doc, totals);
}

function customerHasPriorPaidWork(customerId, billingDocs, jobs, options = {}) {
  const id = String(customerId || "").trim();
  const exceptInvoiceId = String(options.exceptInvoiceId || "").trim();
  if (!id) return false;
  for (const doc of billingDocs || []) {
    if (String(doc.customerId || "") !== id) continue;
    if (doc.kind !== "invoice" || doc.status === "void") continue;
    if (exceptInvoiceId && String(doc.id || "") === exceptInvoiceId) continue;
    if (isInvoicePaidForReferral(doc)) return true;
  }
  for (const job of jobs || []) {
    if (String(job.customerId || "") !== id) continue;
    if (job.status === "completed" || job.status === "collected") return true;
  }
  return false;
}

/** How many referral rewards this person has already generated as the new customer. */
function countReferralRewardsForReferred(storeRows, customerId) {
  const id = String(customerId || "").trim();
  if (!id) return 0;
  let count = 0;
  for (const row of storeRows || []) {
    if (row.type !== "referral") continue;
    if (row.referredCustomerId !== id) continue;
    // Qualified, or any referral that already issued a credit (even if later cancelled).
    if (row.status === "qualified" || row.creditId) count += 1;
  }
  return count;
}

/** Already used as the "new customer" on a rewarded referral — cannot earn again. */
function customerAlreadyRewardedAsReferred(storeRows, customerId) {
  const max = Number(rules.maxRewardsPerReferredCustomer) || 1;
  return countReferralRewardsForReferred(storeRows, customerId) >= max;
}

/** True if this person cannot be registered / rewarded as a new referred customer. */
function isExistingCustomerForReferral(customerId, billingDocs, jobs, storeRows, options = {}) {
  if (customerAlreadyRewardedAsReferred(storeRows, customerId)) return true;
  return customerHasPriorPaidWork(customerId, billingDocs, jobs, options);
}

function findFirstQualifyingInvoice(customerId, billingDocs) {
  const id = String(customerId || "").trim();
  if (!id) return null;
  const paid = (billingDocs || [])
    .filter((doc) => String(doc.customerId || "") === id && isQualifyingPaidInvoice(doc))
    .sort((a, b) => {
      const aAt = String(a.paidAt || a.updatedAt || a.createdAt || "");
      const bAt = String(b.paidAt || b.updatedAt || b.createdAt || "");
      return aAt.localeCompare(bAt);
    });
  return paid[0] || null;
}

function normalizeReferral(row) {
  return {
    id: String(row.id || randomUUID()),
    type: "referral",
    referrerCustomerId: String(row.referrerCustomerId || "").trim(),
    referredCustomerId: String(row.referredCustomerId || "").trim(),
    status: REFERRAL_STATUSES.includes(row.status) ? row.status : "pending",
    rejectionReason: String(row.rejectionReason || "").trim(),
    qualifyingInvoiceId: String(row.qualifyingInvoiceId || "").trim(),
    creditId: String(row.creditId || "").trim(),
    notes: String(row.notes || "").trim(),
    createdAt: String(row.createdAt || nowIso()),
    updatedAt: String(row.updatedAt || row.createdAt || nowIso()),
    createdBy: String(row.createdBy || "admin"),
  };
}

function normalizeCredit(row) {
  const amount = money(row.amount != null ? row.amount : rules.creditAmount);
  const remaining = money(row.remaining != null ? row.remaining : amount);
  let status = CREDIT_STATUSES.includes(row.status) ? row.status : "active";
  const expiresAt = isoDateOnly(row.expiresAt) || addMonthsIsoDate(isoDateOnly(row.issuedAt) || todayIso(), rules.creditValidMonths);
  if (status === "active" && remaining <= 0) status = "used";
  if (status === "active" && expiresAt && todayIso() > expiresAt) status = "expired";
  return {
    id: String(row.id || randomUUID()),
    type: "credit",
    ownerCustomerId: String(row.ownerCustomerId || "").trim(),
    referralId: String(row.referralId || "").trim(),
    amount,
    remaining: status === "used" || status === "expired" || status === "void" ? 0 : remaining,
    status,
    issuedAt: String(row.issuedAt || nowIso()),
    expiresAt,
    usedOn: Array.isArray(row.usedOn)
      ? row.usedOn.map((u) => ({
          invoiceId: String(u.invoiceId || "").trim(),
          amount: money(u.amount),
          usedAt: String(u.usedAt || "").trim(),
        }))
      : [],
    createdAt: String(row.createdAt || row.issuedAt || nowIso()),
    updatedAt: String(row.updatedAt || row.issuedAt || nowIso()),
  };
}

function normalizeStoreRow(row) {
  if (!row || typeof row !== "object") return null;
  if (row.type === "credit") return normalizeCredit(row);
  if (row.type === "referral") return normalizeReferral(row);
  return null;
}

function readNormalized(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeStoreRow)
    .filter(Boolean);
}

function expireCreditsInPlace(rows) {
  let changed = false;
  const today = todayIso();
  for (const row of rows) {
    if (row.type !== "credit") continue;
    if (row.status !== "active") continue;
    if (row.expiresAt && today > row.expiresAt) {
      row.status = "expired";
      row.remaining = 0;
      row.updatedAt = nowIso();
      changed = true;
    }
  }
  return changed;
}

function activeCreditsForCustomer(rows, customerId) {
  const id = String(customerId || "").trim();
  expireCreditsInPlace(rows);
  return rows
    .filter(
      (row) =>
        row.type === "credit" &&
        row.ownerCustomerId === id &&
        row.status === "active" &&
        row.remaining + 0.001 >= rules.creditAmount
    )
    .sort((a, b) => {
      const exp = String(a.expiresAt).localeCompare(String(b.expiresAt));
      if (exp) return exp;
      return String(a.issuedAt).localeCompare(String(b.issuedAt));
    });
}

function creditBalanceSummary(rows, customerId) {
  const active = activeCreditsForCustomer(rows, customerId);
  const balance = money(active.reduce((sum, c) => sum + c.remaining, 0));
  return {
    customerId: String(customerId || "").trim(),
    creditCount: active.length,
    balance,
    credits: active,
  };
}

function createReferral({
  referrerCustomerId,
  referredCustomerId,
  notes,
  billingDocs,
  jobs,
  storeRows,
}) {
  const referrerId = String(referrerCustomerId || "").trim();
  const referredId = String(referredCustomerId || "").trim();
  if (!referrerId || !referredId) {
    const err = new Error("Choose both the referrer and the new customer.");
    err.status = 400;
    throw err;
  }
  if (referrerId === referredId) {
    const err = new Error("Referrer and new customer must be different people.");
    err.status = 400;
    throw err;
  }

  const rows = readNormalized(storeRows);
  const existingOpen = rows.find(
    (row) =>
      row.type === "referral" &&
      row.referredCustomerId === referredId &&
      (row.status === "pending" || row.status === "qualified")
  );
  if (existingOpen) {
    const err = new Error("This customer is already linked to a referral.");
    err.status = 400;
    throw err;
  }

  if (customerAlreadyRewardedAsReferred(rows, referredId)) {
    const rejected = normalizeReferral({
      referrerCustomerId: referrerId,
      referredCustomerId: referredId,
      status: "rejected",
      rejectionReason: "already_referred_before",
      notes,
    });
    rows.push(rejected);
    return { rows, referral: rejected, rejected: true };
  }

  if (customerHasPriorPaidWork(referredId, billingDocs, jobs)) {
    const rejected = normalizeReferral({
      referrerCustomerId: referrerId,
      referredCustomerId: referredId,
      status: "rejected",
      rejectionReason: "already_existing_customer",
      notes,
    });
    rows.push(rejected);
    return { rows, referral: rejected, rejected: true };
  }

  const referral = normalizeReferral({
    referrerCustomerId: referrerId,
    referredCustomerId: referredId,
    status: "pending",
    notes,
  });
  rows.push(referral);
  return { rows, referral, rejected: false };
}

function cancelReferral(storeRows, referralId) {
  const rows = readNormalized(storeRows);
  const index = rows.findIndex(
    (row) => row.type === "referral" && row.id === String(referralId || "")
  );
  if (index < 0) {
    const err = new Error("Referral not found.");
    err.status = 404;
    throw err;
  }
  const referral = rows[index];
  if (referral.status === "qualified" && referral.creditId) {
    const credit = rows.find((r) => r.type === "credit" && r.id === referral.creditId);
    if (credit && credit.status === "used") {
      const err = new Error("Cannot cancel — the $20 credit has already been used.");
      err.status = 400;
      throw err;
    }
    if (credit && (credit.status === "active" || credit.status === "expired")) {
      credit.status = "void";
      credit.remaining = 0;
      credit.updatedAt = nowIso();
    }
  }
  referral.status = "cancelled";
  referral.updatedAt = nowIso();
  rows[index] = referral;
  return { rows, referral };
}

function issueCreditForReferral(rows, referral, invoiceId) {
  if (customerAlreadyRewardedAsReferred(rows, referral.referredCustomerId)) {
    const err = new Error(
      "This new customer has already generated a referral reward."
    );
    err.status = 400;
    throw err;
  }
  const issuedAt = nowIso();
  const credit = normalizeCredit({
    ownerCustomerId: referral.referrerCustomerId,
    referralId: referral.id,
    amount: rules.creditAmount,
    remaining: rules.creditAmount,
    status: "active",
    issuedAt,
    expiresAt: addMonthsIsoDate(isoDateOnly(issuedAt) || todayIso(), rules.creditValidMonths),
  });
  referral.status = "qualified";
  referral.qualifyingInvoiceId = String(invoiceId || "").trim();
  referral.creditId = credit.id;
  referral.rejectionReason = "";
  referral.updatedAt = issuedAt;
  rows.push(credit);
  return credit;
}

/**
 * When a referred customer's invoice becomes paid & qualifying, issue $20 to referrer.
 * Existing customers (prior paid work / prior reward as referred) are rejected — no credit.
 * Returns { changed, qualified: [{ referral, credit }] }
 */
function tryQualifyReferrals(storeRows, billingDocs, customerId, jobs = []) {
  const rows = readNormalized(storeRows);
  expireCreditsInPlace(rows);
  const id = String(customerId || "").trim();
  if (!id) return { rows, changed: false, qualified: [] };

  const pending = rows.filter(
    (row) =>
      row.type === "referral" &&
      row.status === "pending" &&
      row.referredCustomerId === id
  );
  if (!pending.length) return { rows, changed: false, qualified: [] };

  // Already received a referral reward as the new customer — never again.
  if (customerAlreadyRewardedAsReferred(rows, id)) {
    let changed = false;
    const now = nowIso();
    for (const referral of pending) {
      referral.status = "rejected";
      referral.rejectionReason = "already_referred_before";
      referral.updatedAt = now;
      changed = true;
    }
    return { rows, changed, qualified: [] };
  }

  const first = findFirstQualifyingInvoice(id, billingDocs);
  if (!first) return { rows, changed: false, qualified: [] };

  // Any other paid work / completed job means they were already a customer.
  if (customerHasPriorPaidWork(id, billingDocs, jobs, { exceptInvoiceId: first.id })) {
    let changed = false;
    const now = nowIso();
    for (const referral of pending) {
      referral.status = "rejected";
      referral.rejectionReason = "already_existing_customer";
      referral.updatedAt = now;
      changed = true;
    }
    return { rows, changed, qualified: [] };
  }

  // Only one reward per new customer — qualify the oldest pending, reject the rest.
  pending.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const [winner, ...extras] = pending;
  const qualified = [];
  const credit = issueCreditForReferral(rows, winner, first.id);
  qualified.push({ referral: winner, credit });
  const now = nowIso();
  for (const extra of extras) {
    extra.status = "rejected";
    extra.rejectionReason = "already_referred_before";
    extra.updatedAt = now;
  }
  return { rows, changed: true, qualified };
}

function applyCreditsToInvoice({ storeRows, invoice, creditIds }) {
  if (!invoice || invoice.kind !== "invoice") {
    const err = new Error("Referral credits can only be applied to invoices.");
    err.status = 400;
    throw err;
  }
  if (invoice.status === "void") {
    const err = new Error("Cannot apply credits to a voided invoice.");
    err.status = 400;
    throw err;
  }
  const ownerId = String(invoice.customerId || "").trim();
  if (!ownerId) {
    const err = new Error("Invoice needs a customer before applying credits.");
    err.status = 400;
    throw err;
  }

  const totals = catalog.computeTotals(invoice.lines || []);
  if (totals.totalIncl + 0.001 < rules.minInvoiceSpend) {
    const err = new Error(
      `Invoice must be at least $${rules.minInvoiceSpend.toFixed(0)} to use referral credits.`
    );
    err.status = 400;
    throw err;
  }

  const rows = readNormalized(storeRows);
  expireCreditsInPlace(rows);

  const already = normalizeAppliedRows(invoice.referralCreditsApplied);
  const alreadyTotal = money(already.reduce((s, r) => s + r.amount, 0));

  const amountPaid = money(
    (Array.isArray(invoice.payments) ? invoice.payments : []).reduce(
      (sum, row) => sum + (Number(row.amount) || 0),
      0
    )
  );
  let room = money(Math.max(0, totals.totalIncl - amountPaid - alreadyTotal));
  if (room + 0.001 < rules.creditAmount) {
    const err = new Error(
      `Not enough balance left on this invoice for a whole $${rules.creditAmount.toFixed(0)} credit.`
    );
    err.status = 400;
    throw err;
  }

  const wanted = Array.isArray(creditIds)
    ? creditIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const available = activeCreditsForCustomer(rows, ownerId);
  const pickPool = wanted.length
    ? wanted.map((id) => {
        const hit = available.find((c) => c.id === id);
        if (!hit) {
          const err = new Error("One of the selected credits is not available.");
          err.status = 400;
          throw err;
        }
        return hit;
      })
    : available;

  const applied = [...already];
  const usedAt = nowIso();
  let appliedNow = 0;

  for (const credit of pickPool) {
    if (room + 0.001 < rules.creditAmount) break;
    // Whole credit only — never split.
    if (money(credit.remaining) + 0.001 < rules.creditAmount) continue;
    if (applied.some((row) => row.creditId === credit.id)) continue;

    credit.remaining = 0;
    credit.status = "used";
    credit.updatedAt = usedAt;
    credit.usedOn = [
      ...(credit.usedOn || []),
      { invoiceId: invoice.id, amount: rules.creditAmount, usedAt },
    ];
    applied.push({ creditId: credit.id, amount: rules.creditAmount, usedAt });
    appliedNow = money(appliedNow + rules.creditAmount);
    room = money(room - rules.creditAmount);
  }

  if (appliedNow <= 0) {
    const err = new Error("No whole $20 credits could be applied.");
    err.status = 400;
    throw err;
  }

  invoice.referralCreditsApplied = applied;
  invoice.referralCreditTotal = money(applied.reduce((s, r) => s + r.amount, 0));
  invoice.updatedAt = usedAt;

  return {
    rows,
    invoice,
    appliedAmount: appliedNow,
    referralCreditTotal: invoice.referralCreditTotal,
  };
}

function removeCreditsFromInvoice({ storeRows, invoice }) {
  if (!invoice || invoice.kind !== "invoice") {
    const err = new Error("Not an invoice.");
    err.status = 400;
    throw err;
  }
  const applied = normalizeAppliedRows(invoice.referralCreditsApplied);
  if (!applied.length) {
    return { rows: readNormalized(storeRows), invoice, removedAmount: 0 };
  }

  const rows = readNormalized(storeRows);
  const removedAt = nowIso();
  let removedAmount = 0;

  for (const row of applied) {
    removedAmount = money(removedAmount + row.amount);
    const credit = rows.find((c) => c.type === "credit" && c.id === row.creditId);
    if (!credit) continue;
    credit.usedOn = (credit.usedOn || []).filter((u) => u.invoiceId !== invoice.id);
    // Restore only if still within expiry and was a whole $20.
    if (credit.expiresAt && todayIso() > credit.expiresAt) {
      credit.status = "expired";
      credit.remaining = 0;
    } else {
      credit.status = "active";
      credit.remaining = rules.creditAmount;
    }
    credit.updatedAt = removedAt;
  }

  invoice.referralCreditsApplied = [];
  invoice.referralCreditTotal = 0;
  invoice.updatedAt = removedAt;

  return { rows, invoice, removedAmount };
}

function enrichReferralList(rows, customersById, billingById) {
  return rows
    .filter((row) => row.type === "referral")
    .map((row) => {
      const referrer = customersById.get(row.referrerCustomerId);
      const referred = customersById.get(row.referredCustomerId);
      const invoice = billingById.get(row.qualifyingInvoiceId);
      const credit = rows.find((c) => c.type === "credit" && c.id === row.creditId);
      return {
        ...row,
        referrerName: referrer?.customerName || referrer?.name || "",
        referredName: referred?.customerName || referred?.name || "",
        qualifyingInvoiceNumber: invoice?.number || "",
        creditStatus: credit?.status || "",
        creditExpiresAt: credit?.expiresAt || "",
        creditRemaining: credit ? credit.remaining : null,
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

module.exports = {
  rules,
  REFERRAL_STATUSES,
  CREDIT_STATUSES,
  addMonthsIsoDate,
  referralCreditTotal,
  normalizeAppliedRows,
  isInvoicePaidForReferral,
  isQualifyingPaidInvoice,
  customerHasPriorPaidWork,
  countReferralRewardsForReferred,
  customerAlreadyRewardedAsReferred,
  isExistingCustomerForReferral,
  findFirstQualifyingInvoice,
  normalizeReferral,
  normalizeCredit,
  readNormalized,
  expireCreditsInPlace,
  activeCreditsForCustomer,
  creditBalanceSummary,
  createReferral,
  cancelReferral,
  tryQualifyReferrals,
  applyCreditsToInvoice,
  removeCreditsFromInvoice,
  enrichReferralList,
};
