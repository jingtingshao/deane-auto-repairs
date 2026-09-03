/**
 * One-time Google Drive OAuth for personal Gmail backup.
 *
 * Prerequisites:
 * 1. Google Cloud project → OAuth consent screen (External / Testing)
 * 2. Add bpauckland@gmail.com as a test user
 * 3. Credentials → Create OAuth client ID → Desktop app
 * 4. Put Client ID + Secret in .env, then run: npm run backup:auth
 *
 * Desktop clients must use loopback with no path: http://127.0.0.1:PORT
 */

require("dotenv").config({ quiet: true });

const crypto = require("crypto");
const http = require("http");
const { spawn } = require("child_process");
const { URL } = require("url");
const { google } = require("googleapis");
const { DRIVE_SCOPE } = require("../data/drive-backup");

const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

function openBrowser(url) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" });
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  }
}

async function main() {
  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    console.error(
      "Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET in .env"
    );
    console.error(
      "Create an OAuth client (Desktop app) in Google Cloud Console, then add both to .env."
    );
    process.exit(1);
  }

  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [DRIVE_SCOPE],
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  console.log("");
  console.log("1. Browser should open. Sign in with bpauckland@gmail.com and click Allow.");
  console.log("   If it did not open, paste this URL into Chrome:");
  console.log(authUrl);
  console.log("");
  console.log(`2. Waiting for Google to redirect to ${REDIRECT_URI} ...`);
  console.log("");

  const tokens = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, REDIRECT_URI);
        if (url.pathname !== "/" && url.pathname !== "/oauth2callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const err = url.searchParams.get("error");
        if (err) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<h1>Auth failed</h1><p>${err}</p>`);
          server.close();
          reject(new Error(err));
          return;
        }
        const code = url.searchParams.get("code");
        if (!code) {
          res.writeHead(400);
          res.end("Missing code");
          return;
        }
        const { tokens: next } = await oauth2.getToken({
          code,
          codeVerifier: verifier,
        });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<h1>Google Drive connected</h1><p>You can close this tab and return to Cursor.</p>"
        );
        server.close();
        resolve(next);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(String(e.message || e));
        server.close();
        reject(e);
      }
    });
    server.listen(PORT, "127.0.0.1", () => {
      openBrowser(authUrl);
    });
    server.on("error", reject);
  });

  if (!tokens.refresh_token) {
    console.error(
      "No refresh_token returned. Revoke app access at https://myaccount.google.com/permissions then run again."
    );
    process.exit(1);
  }

  const envPath = require("path").join(__dirname, "..", ".env");
  try {
    let text = require("fs").readFileSync(envPath, "utf8");
    const line = `GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`;
    if (/^GOOGLE_OAUTH_REFRESH_TOKEN=/m.test(text)) {
      text = text.replace(/^GOOGLE_OAUTH_REFRESH_TOKEN=.*$/m, line);
    } else {
      text = `${text.replace(/\s*$/, "")}\n${line}\n`;
    }
    require("fs").writeFileSync(envPath, text);
    console.log("Saved GOOGLE_OAUTH_REFRESH_TOKEN to local .env (not committed).");
  } catch (e) {
    console.log("Could not write .env automatically:", e.message);
    console.log("Add this line to your .env (never commit it):");
    console.log("");
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("");
  }
  console.log("If Backup on the live website still fails, paste the same token into Render env vars.");
  console.log("Then restart: npm start");
  console.log("Then Admin → Dashboard → Backup to Drive");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
