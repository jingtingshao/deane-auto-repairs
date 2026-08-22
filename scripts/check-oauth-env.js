require("dotenv").config({ quiet: true });
const t = String(process.env.GOOGLE_OAUTH_REFRESH_TOKEN || "");
const trimmed = t.trim();
console.log("token length", trimmed.length);
console.log("has surrounding quotes", /^["']/.test(trimmed) || /["']$/.test(trimmed));
console.log("has whitespace", /\s/.test(trimmed));
console.log("starts with 1/", trimmed.startsWith("1/"));
console.log("client id set", Boolean(String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim()));
console.log("client secret set", Boolean(String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim()));
