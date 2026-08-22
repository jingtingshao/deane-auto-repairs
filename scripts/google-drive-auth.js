/**
 * One-time Google Drive OAuth for personal Gmail backup.
 *
 * Prerequisites:
 * 1. Google Cloud project → OAuth consent screen (External / Testing)
 * 2. Add your Google account as a test user
 * 3. Credentials → Create OAuth client ID → Desktop app
 * 4. Put Client ID + Secret in .env, then run: npm run backup:auth
 */

require("dotenv").config({ quiet: true });

const http = require("http");
const { URL } = require("url");
const { google } = require("googleapis");
const { DRIVE_SCOPE } = require("../data/drive-backup");

const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth2callback`;

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

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [DRIVE_SCOPE],
  });

  console.log("");
  console.log("1. Open this URL in your browser (use bpauckland@gmail.com):");
  console.log(authUrl);
  console.log("");
  console.log(`2. Waiting for Google to redirect to ${REDIRECT_URI} ...`);
  console.log("");

  const tokens = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
        if (url.pathname !== "/oauth2callback") {
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
        const { tokens: next } = await oauth2.getToken(code);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<h1>Google Drive connected</h1><p>You can close this tab and return to the terminal.</p>"
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
    server.listen(PORT, "127.0.0.1");
    server.on("error", reject);
  });

  if (!tokens.refresh_token) {
    console.error(
      "No refresh_token returned. Revoke app access at https://myaccount.google.com/permissions then run again."
    );
    process.exit(1);
  }

  console.log("Success. Add this line to your .env (never commit it):");
  console.log("");
  console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log("");
  console.log("Then restart: npm start");
  console.log("Then Admin → Dashboard → Backup now");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
