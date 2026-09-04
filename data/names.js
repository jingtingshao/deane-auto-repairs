/** Customer / vehicle text casing. Keep in sync with admin.js DeaneAdmin name helpers. */

function capitalizeGivenName(value) {
  return String(value || "").replace(/[A-Za-zÀ-ÿ]+/g, (word) => {
    const lower = word.toLocaleLowerCase("en-NZ");
    return lower.charAt(0).toLocaleUpperCase("en-NZ") + lower.slice(1);
  });
}

function uppercaseFamilyName(value) {
  return String(value || "").toLocaleUpperCase("en-NZ");
}

function capitalizeVehicleDescription(value) {
  return capitalizeGivenName(value);
}

function formatFullCustomerName(value) {
  const raw = String(value || "");
  const trailing = raw.match(/\s+$/)?.[0] || "";
  const body = trailing ? raw.slice(0, -trailing.length) : raw;
  if (!body) return raw;
  const parts = body.split(/(\s+)/);
  const wordIndexes = [];
  parts.forEach((part, index) => {
    if (part && !/^\s+$/.test(part)) wordIndexes.push(index);
  });
  if (!wordIndexes.length) return raw;
  if (wordIndexes.length === 1) {
    parts[wordIndexes[0]] = capitalizeGivenName(parts[wordIndexes[0]]);
  } else {
    const lastIndex = wordIndexes.pop();
    wordIndexes.forEach((index) => {
      parts[index] = capitalizeGivenName(parts[index]);
    });
    parts[lastIndex] = uppercaseFamilyName(parts[lastIndex]);
  }
  return parts.join("") + trailing;
}

module.exports = {
  capitalizeGivenName,
  uppercaseFamilyName,
  capitalizeVehicleDescription,
  formatFullCustomerName,
};
