/** Cash paid out of the workshop. Each row is a date, a name, and an amount. */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_MAX = 80;
const AMOUNT_MAX = 999999.99;

function cashError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function isIsoDate(value) {
  const match = String(value || "").match(DATE_RE);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseAmount(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "")
    .trim()
    .replace(/[$,\s]/g, "");
  if (!text || !/^\d+(\.\d+)?$/.test(text)) return NaN;
  return Number(text);
}

function roundMoney(value) {
  const amount = parseAmount(value);
  if (!Number.isFinite(amount)) return NaN;
  return Math.round(amount * 100) / 100;
}

function cleanName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function presentExpense(row) {
  if (!row || typeof row !== "object") return null;
  const id = String(row.id || "").trim();
  const date = String(row.date || "").slice(0, 10);
  const name = cleanName(row.name);
  const amount = roundMoney(row.amount);
  const createdAt = String(row.createdAt || "").trim();
  if (!id || !isIsoDate(date) || !name || !Number.isFinite(amount) || amount <= 0) return null;
  return { id, date, name, amount, createdAt };
}

function createExpense(input, meta = {}) {
  const date = String(input?.date || "").trim().slice(0, 10);
  if (!isIsoDate(date)) throw cashError("Enter a valid date.");

  const name = cleanName(input?.name);
  if (!name) throw cashError("Enter who the cash was paid to.");
  if (name.length > NAME_MAX) throw cashError("Name is too long.");

  const amount = roundMoney(input?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw cashError("Enter an amount greater than zero.");
  }
  if (amount > AMOUNT_MAX) throw cashError("Amount is too large.");

  const id = String(meta.id || "").trim();
  if (!id) throw cashError("Could not save this expense.");

  return {
    id,
    date,
    name,
    amount,
    createdAt: String(meta.createdAt || new Date().toISOString()),
  };
}

function listExpenses(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(presentExpense)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
}

module.exports = {
  NAME_MAX,
  AMOUNT_MAX,
  createExpense,
  listExpenses,
};
