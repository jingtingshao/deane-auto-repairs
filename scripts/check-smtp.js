require("dotenv").config();
const fs = require("fs");
const nodemailer = require("nodemailer");

const raw = fs.readFileSync(".env", "utf8");
const p = String(process.env.SMTP_PASS || "");
const cleaned = p.replace(/\s+/g, "").replace(/^["']|["']$/g, "");
const user = process.env.SMTP_USER || "";

console.log("USER=" + user);
console.log("PASS_ENV_LEN=" + p.length);
console.log("PASS_CLEAN_LEN=" + cleaned.length);
console.log("PASS_HAS_SPACES=" + /\s/.test(p));
console.log("LOOKS_16_ALNUM=" + (cleaned.length === 16 && /^[a-zA-Z0-9]+$/.test(cleaned)));
console.log("STILL_PLACEHOLDER=" + /PASTE_|your-16|HERE/i.test(p));
console.log("FILE_HAS_BOM=" + (raw.charCodeAt(0) === 0xfeff));

(async () => {
  try {
    const t = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass: cleaned },
    });
    await t.verify();
    console.log("VERIFY=OK");
  } catch (e) {
    console.log(
      "VERIFY_FAIL=" +
        (e.responseCode || "") +
        " " +
        (e.code || "") +
        " " +
        String(e.message).split("\n")[0]
    );
  }
})();
