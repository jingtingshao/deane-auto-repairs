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

Copy `.env.example` to `.env` and set a strong `ADMIN_PIN` (8+ characters) before `npm start`. The server will not start without it. Do not use the old published default.

On Render, set `ADMIN_PIN` in Environment (not in Git). If it is missing or too weak, the service will refuse to start.

## Workshop flow

1. Sign in at `/admin/`
2. **Jobs** — workshop job cards (status + parts ordered/received)
3. **Reports** — digital service reports (checklist + photos)
4. **Quotes & invoices** — WOF / Standard / Premium can go straight to invoice; repair work is a quote emailed to the customer, who must click Accept before work starts. After Accept, create a job card from the quote.
5. Customer quote/invoice link: `http://localhost:5173/b/<id>`

## Business details

- **Name:** Deane Auto Repairs
- **Address:** Deane Auto Repairs (Next to BP Petrol Station), 63 Hayr Road, Three Kings, Auckland
- **Phone:** 0800 625 9827
- **Email:** deaneautonz@gmail.com
- **Hours:** Mon–Sat 8:30am–5:30pm (Sunday closed)
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
| `pre-purchase/ppi-form.html` | Pre-purchase report form with photo upload slots |

Reports are stored in `data/reports.json` on this computer (simple local MVP).
Quotes and invoices are stored in `data/billing.json` (workshop only — no bank data).
Job cards are stored in `data/jobs.json` (workshop only).

### Pre-purchase inspection (with photos)

Open `pre-purchase/ppi-form.html` in a browser (or via `npm start` then go to `/pre-purchase/ppi-form.html`).

- Upload **Interior**, **Front & Side**, **Engine**, **Rear & Back**
- Add problem blocks with notes + issue photos
- Use **Print / Save PDF** when finished
