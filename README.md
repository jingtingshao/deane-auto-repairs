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
2. **New report** → fill customer / vehicle
3. Choose Standard or Full package (checklist updates)
4. Mark items OK / Watch / Attention + notes
5. Tick work completed, add WOF result if needed
6. **Publish & copy link** → send to customer
7. Or **Email customer** (opens mailto with the report link)

Customer opens: `http://localhost:5173/r/<report-id>`

## Business details

- **Name:** Deane Auto Repairs
- **Address:** 63 Hayr Road, Three Kings
- **Phone:** 0800 6259827
- **Email:** deaneautonz@gmail.com
- **Hours:** Mon–Fri 8:30am–5:30pm
- **Services:** Standard / Full service, WOF
- **Courtesy cars:** No

## Project files

| Path | Purpose |
|------|---------|
| `index.html` | Public website |
| `admin/` | Workshop backend UI |
| `report/` | Customer-facing report page |
| `server.js` | Local API + static hosting |
| `data/checklist.js` | Standard / Full checklist |
| `docs/service-checklist-and-wof-notes.md` | Spec |
| `facebook-page.txt` | Facebook copy kit |

Reports are stored in `data/reports.json` on this computer (simple local MVP).
