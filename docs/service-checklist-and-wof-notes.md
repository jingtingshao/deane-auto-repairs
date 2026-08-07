# Deane Auto Repairs — Service Checklists & WOF Notes

Draft v2 for the future digital service report app.  
Statuses for every check item: **OK** · **Watch** · **Attention** · **N/A**

Each item should support:
- Status
- Short technician note (plain English for the customer)
- Optional photo
- Optional “recommended by” km / date

**Packages**
- **Standard Service** — routine interval service (levels, filters, lights, pressures, visual safety checks)
- **Full Service** — everything in Standard, plus wheels-off brake inspection, deeper driveline/ignition checks, tyre rotation, and road test

In the app: choosing **Full Service** loads all Standard items + Full-only items.

Items marked ★ are also useful when a **WOF** is booked on the same visit (advisory only — not a WOF certificate).

---

## A. Report header (every job)

| Field | Required |
|-------|----------|
| Report / job number | Yes |
| Service date | Yes |
| Technician name | Yes |
| Customer name + phone/email | Yes |
| Registration | Yes |
| Make / model / year | Yes |
| Odometer (km) | Yes |
| VIN | Optional |
| Job type | Standard Service / Full Service / WOF / Service + WOF / Repair |
| Service package (if servicing) | Standard / Full |
| Vehicle photo | Recommended |
| Customer concern / notes | Optional |

---

## B. Service checklists (8 groups)

**Legend**
- **S** = included in Standard Service  
- **F** = Full Service only (on top of Standard)  
- **S+F** = both packages  

---

### B1. Engine & fluids

| Code | Check item | Package | Notes / examples |
|------|------------|---------|------------------|
| ENG-01 | Engine oil level & condition | S+F | “Oil dirty / level low.” |
| ENG-02 | Engine oil & oil filter service (replace as package) | S+F | Record oil spec + filter part |
| ENG-03 | Air filter (check) | S+F | Replace if restricted |
| ENG-04 | Cabin / pollen filter (if fitted) | S+F | Often Watch → next service |
| ENG-05 | Coolant level & condition | S+F | |
| ENG-06 | Radiator cap, hoses & belts (visual) | S+F | Fan belts & coolant hoses |
| ENG-07 | Engine oil / fluid leaks (visual) | S+F | |
| ENG-08 | Battery condition & terminals ★ | S+F | |
| ENG-09 | Fuel filter (check / due) | F | |
| ENG-10 | Spark plugs (check / due) | F | |
| ENG-11 | HT leads / ignition leads (if applicable) | F | |
| ENG-12 | Air filter housing / induction (visual detail) | F | |

---

### B2. Transmission / driveline

| Code | Check item | Package | Notes / examples |
|------|------------|---------|------------------|
| DRV-01 | Transmission fluid level / condition (if checkable) | S+F | Top up if required |
| DRV-02 | Differential / transfer / driveline levels (if applicable) | S+F | |
| DRV-03 | Grease & lube suspension / points as required | S+F | |
| DRV-04 | CV boots & driveshafts — quick visual ★ | S | Without extensive underbody strip |
| DRV-05 | CV boots, driveshafts & driveline — detailed inspection ★ | F | |
| DRV-06 | Clutch operation (road feel, if manual) | F | Usually with road test |
| DRV-07 | Auto transmission operation (road feel) | F | Usually with road test |

---

### B3. Brakes ★

| Code | Check item | Package | Notes / examples |
|------|------------|---------|------------------|
| BRK-01 | Brake fluid level & condition | S+F | “Fluid dark — recommend flush.” |
| BRK-02 | Brake warning / ABS lights (dash) | S+F | |
| BRK-03 | Brake hoses & pipes (visual, wheels on) | S | |
| BRK-04 | Handbrake / park brake — basic function | S | |
| BRK-05 | Remove road wheels | F | Required for Full brake inspect |
| BRK-06 | Front brake pads — measure / inspect | F | Record mm when Watch/Attention |
| BRK-07 | Front discs / rotors — inspect | F | |
| BRK-08 | Rear pads or shoes — inspect (drums removed if fitted) | F | |
| BRK-09 | Rear discs / drums — inspect | F | |
| BRK-10 | Clean & adjust brakes as required | F | Action item |
| BRK-11 | Reset / adjust handbrake | F | |
| BRK-12 | Brake hoses, pipes, calipers — wheels-off visual | F | |

---

### B4. Steering & suspension ★

| Code | Check item | Package | Notes / examples |
|------|------------|---------|------------------|
| SUS-01 | Power steering fluid (if applicable) | S+F | |
| SUS-02 | Steering play — basic check | S | |
| SUS-03 | Shocks / springs — visual leaks & obvious damage | S | |
| SUS-04 | Steering rack gaiters, ball joints, tie rods — detailed ★ | F | Prefer wheels off / on hoist |
| SUS-05 | Bushes, mounts, control arms — detailed visual ★ | F | |
| SUS-06 | Wheel bearings — play / noise check | F | |

---

### B5. Tyres & wheels ★

| Code | Check item | Package | Notes / examples |
|------|------------|---------|------------------|
| TYR-01 | Tyre pressures (all; spare if present) | S+F | Record set pressures |
| TYR-02 | Tread & condition — visual (wheels on) | S | Flag legal / damage risks |
| TYR-03 | Tread depth LF / RF / LR / RR (note mm) | F | Easier with wheels off |
| TYR-04 | Wear pattern / damage / age cracking — detailed | F | |
| TYR-05 | Wheel condition / wheel nuts | F | After refit |
| TYR-06 | Tyre rotation (if required / beneficial) | F | Yes / No / N/A |

---

### B6. Electrical, lights & visibility ★

| Code | Check item | Package | Notes / examples |
|------|------------|---------|------------------|
| ELE-01 | Headlights (high / low) | S+F | |
| ELE-02 | Tail / brake / reverse lights | S+F | |
| ELE-03 | Indicators / hazards | S+F | |
| ELE-04 | Number plate lights | S+F | |
| ELE-05 | Dashboard warning lights | S+F | |
| ELE-06 | Horn | S+F | |
| ELE-07 | Wiper blades | S+F | |
| ELE-08 | Washer fluid & washers | S+F | Top up washer fluid |
| ELE-09 | Windscreen chips / cracks (visual) | S+F | |

---

### B7. Body, exhaust & underbody ★

| Code | Check item | Package | Notes / examples |
|------|------------|---------|------------------|
| BOD-01 | Exhaust — quick visual (secure / obvious leaks) | S | |
| BOD-02 | Exhaust — detailed mounts, leaks, damage | F | |
| BOD-03 | Underbody / structural rust — quick look | S | |
| BOD-04 | Underbody / structural rust — hoist inspection | F | |
| BOD-05 | Door latches / mirrors (basic) | S+F | |
| BOD-06 | Seatbelts (visual / basic function) | S+F | |

---

### B8. Service actions completed

Tick what was **done this visit** (separate from inspection status).

#### Standard Service — expected actions
- [ ] Engine oil replaced  
- [ ] Oil filter replaced  
- [ ] Fluids checked / topped up (brake, coolant, washer, power steer, transmission/driveline as applicable)  
- [ ] Grease / lube as required  
- [ ] Lights checked  
- [ ] Tyre pressures set  
- [ ] Air filter checked (replaced if agreed)  
- [ ] Battery checked  

#### Full Service — additional actions
- [ ] Road wheels removed  
- [ ] Brakes inspected (incl. drums if fitted)  
- [ ] Brakes cleaned / adjusted  
- [ ] Handbrake reset / adjusted  
- [ ] Driveline & CV boots inspected in detail  
- [ ] Tyres rotated (if done)  
- [ ] Spark plugs checked / replaced if due  
- [ ] HT leads checked (if applicable)  
- [ ] Fuel filter checked / replaced if due  
- [ ] Road test completed  

#### Either package (as needed)
- [ ] Cabin filter replaced  
- [ ] Coolant replaced  
- [ ] Brake fluid flushed  
- [ ] Transmission service  
- [ ] Other: ___________  

---

### B9. Fluids / parts record (optional but useful)

| Item | Spec / brand / part no. | Qty | Package |
|------|-------------------------|-----|---------|
| Engine oil | e.g. 5W-30 | | S+F |
| Oil filter | | | S+F |
| Air filter | | | as needed |
| Cabin filter | | | as needed |
| Spark plugs | | | F / as needed |
| Fuel filter | | | F / as needed |
| Other | | | |

---

### B10. Summary for customer

| Field | Purpose |
|-------|---------|
| Package performed | Standard Service / Full Service |
| Work completed summary | Plain English list |
| Items needing Attention now | Red items + quote if ready |
| Items to Watch / next service | Yellow items + suggested km/date |
| Next service due | km and/or date |
| Technician comments | Free text |
| Disclaimer | See section D |

---

## Package difference (quick reference)

| Area | Standard | Full |
|------|----------|------|
| Oil & filter + fluid levels | Yes | Yes |
| Belts, hoses, battery, air filter | Yes | Yes |
| Lights, wipers, washer, tyre pressures | Yes | Yes |
| Brakes | Fluid + basic function | Wheels off, measure/inspect, adjust, handbrake |
| Suspension / steering | Basic / visual | Detailed joints, bushes, bearings |
| CV / driveline | Quick visual | Detailed inspection |
| Tyres | Pressure + visual | Depth mm, wear detail, rotation |
| Spark plugs / fuel filter / HT leads | No (unless obvious concern) | Check / service if due |
| Road test | Optional / if time | Expected |
| Exhaust / underbody | Quick look | Hoist / detailed |

**Customer-facing one-liner**
- **Standard Service:** keep the car maintained between major intervals.  
- **Full Service:** deeper safety inspection — especially brakes and underside — plus road test.

---

## C. WOF-related notes (for digital report)

**Important:** A digital service report is **not** a Warrant of Fitness.  
WOF pass/fail is issued only through the official inspection process.  
On the report, use a clear label such as:

> “WOF advisory notes from workshop findings — not an official WOF result.”

### C1. Fields to capture when job includes WOF

| Field | Values |
|-------|--------|
| WOF performed this visit? | Yes / No |
| Official WOF result | Pass / Fail / Not completed |
| WOF expiry (if passed) | Date |
| WOF label / cert reference | Optional |
| Fail items (if failed) | List linked to checklist codes where possible |
| Repairs completed to achieve pass | Free text / linked items |
| Re-check required? | Yes / No |

### C2. Common WOF failure / risk areas to flag in notes

Map to ★ items above:

1. **Tyres** — tread below legal, cords, bulges, incorrect size/type mix  
2. **Brakes** — imbalance, worn friction material, leaks, park brake ineffective  
3. **Lights** — inoperative, wrong colour, aim issues, cracked lenses affecting light  
4. **Steering / suspension** — excessive play, damaged joints, broken springs  
5. **Windscreen / wipers** — crack in driver’s view, wipers not clearing  
6. **Seatbelts** — cuts, not latching, missing  
7. **Structure / rust** — corrosion in structural areas, sharp body damage  
8. **Exhaust** — insecure, excessive leaks, missing sections  
9. **Registration plates** — missing, unreadable, insecure  
10. **Glazing / mirrors / horn** — required equipment not working  

### C3. Suggested customer wording templates

**Pass**
> WOF inspection completed and passed. Next WOF due by [date]. We still recommend addressing the Watch items below before they become a fail risk.

**Fail**
> WOF was not issued. The following items need attention before a pass can be issued: [list]. Once repaired, a re-check is required.

**Service only (no WOF)**
> This visit was a service inspection only ([Standard/Full]). Findings marked Attention/Watch may affect a future WOF — ask us if you’d like a WOF booked.

**Advisory during service**
> Not a WOF result. Based on what we could see today, [item] may cause a WOF fail if left unattended.

### C4. What the digital report should never claim

- Do not display a fake “WOF certificate”  
- Do not imply electronic report = legal warrant  
- Clearly separate **workshop recommendation** vs **official WOF outcome**

---

## D. Customer disclaimer (recommended footer)

> This digital report records workshop findings at the time of inspection. A Standard Service does not include a full wheels-off brake strip-down; a Full Service includes deeper inspection but still cannot reveal every hidden or intermittent fault without further dismantling. A WOF result, if shown, refers only to the official inspection outcome for that visit. Please contact Deane Auto Repairs on 0800 6259827 if you have questions about any item.

---

## E. Recommended report flow (for later software)

1. Select job type: **Standard Service** / **Full Service** / **WOF** / **Service + WOF**  
2. Load checklist filtered by package (S+F always; F items only for Full)  
3. If WOF involved → show **WOF panel** (section C)  
4. Attach photos to Attention / Watch items  
5. Auto-build customer summary from red/yellow items  
6. Send link to customer; optional PDF export  

---

## F. Open decisions (confirm later)

- [x] Separate Standard vs Full service checklists  
- [ ] Record exact pad measurements (mm) always on Full, or only when Watch/Attention  
- [ ] Customer must approve quotes inside the app, or outside (phone/email)  
- [ ] History portal for the customer (multi-visit) vs single report link only  
- [ ] Branding: Deane colours on PDF/web report  
- [ ] Website copy: publish Standard vs Full package difference for customers?  

---

*Deane Auto Repairs · 63 Hayr Road, Three Kings · 0800 6259827 · dreamautonz@gmail.com*
