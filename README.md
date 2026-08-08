# Deane Auto Repairs

Marketing website + simple workshop admin for **digital service reports**.

## Quick start

```powershell
cd D:\project\deane-auto-repairs
npm install
npm start
```

Then open:

- Website: http://localhost:5173/
- Admin: http://localhost:5173/admin/
- Default admin PIN: `deane123`

Change the PIN anytime:

```powershell
$env:ADMIN_PIN="your-pin"; npm start
```

## Workshop flow

1. Sign in at `/admin/`
2. **New report** â†’ fill customer / vehicle (include customer email)
3. Choose Standard ($199) or Premium ($279) package (checklist matches website prices)
4. Mark items OK / Watch / Attention + notes
5. Tick work completed, add WOF result if needed
6. **Publish & copy link**, or **Email customer** (sends via SMTP â€” not mailto)

Customer opens: `http://localhost:5173/r/<report-id>`

## Email setup (Gmail)

Direct send uses SMTP. One-time setup:

1. Turn on 2-Step Verification for `deaneautonz@gmail.com`
2. Create a Google **App Password** (Google Account â†’ Security â†’ App passwords)
3. In the project folder:

```powershell
copy .env.example .env
```

4. Edit `.env` and set `SMTP_PASS` to the 16-character app password
5. Restart:

```powershell
npm start
```

Terminal should show: `Email: SMTP ready (...)`  
Then **Email customer** in admin sends the report link from the server.

## Business details

- **Name:** Deane Auto Repairs
- **Address:** 63 Hayr Road, Three Kings
- **Phone:** 0800 6259827
- **Email:** deaneautonz@gmail.com
- **Hours:** Monâ€“Fri 8:30amâ€“5:30pm
- **Services:** Standard / Premium service, WOF
- **Courtesy cars:** No

## Project files

| Path | Purpose |
|------|---------|
| `index.html` | Public website |
| `admin/` | Workshop backend UI |
| `report/` | Customer-facing report page |
| `server.js` | Local API + static hosting |
| `data/checklist.js` | Standard / Premium checklist (aligned to #prices) |
| `docs/service-checklist-and-wof-notes.md` | Spec |
| `facebook-page.txt` | Facebook copy kit |

Reports are stored in `data/reports.json` on this computer (simple local MVP).
