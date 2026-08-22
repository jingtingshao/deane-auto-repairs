require("dotenv").config({ quiet: true });
const { google } = require("googleapis");

function clean(v) {
  return String(v || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

async function main() {
  const clientId = clean(process.env.GOOGLE_OAUTH_CLIENT_ID);
  const clientSecret = clean(process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  const refreshToken = clean(process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  try {
    const r = await oauth2.getAccessToken();
    console.log("access token ok:", Boolean(r && (r.token || r)));
  } catch (e) {
    console.error("refresh failed:", e.message);
    if (e.response?.data) console.error(JSON.stringify(e.response.data));
    process.exit(1);
  }
}

main();
