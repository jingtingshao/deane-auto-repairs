/** Checklist definitions — mirrors docs/service-checklist-and-wof-notes.md v2 */

const GROUPS = [
  {
    id: "engine",
    title: "Engine & fluids",
    items: [
      { code: "ENG-01", label: "Engine oil level & condition", packages: ["standard", "full"] },
      { code: "ENG-02", label: "Engine oil & oil filter service", packages: ["standard", "full"] },
      { code: "ENG-03", label: "Air filter (check)", packages: ["standard", "full"] },
      { code: "ENG-04", label: "Cabin / pollen filter (if fitted)", packages: ["standard", "full"] },
      { code: "ENG-05", label: "Coolant level & condition", packages: ["standard", "full"] },
      { code: "ENG-06", label: "Radiator cap, hoses & belts (visual)", packages: ["standard", "full"] },
      { code: "ENG-07", label: "Engine oil / fluid leaks (visual)", packages: ["standard", "full"] },
      { code: "ENG-08", label: "Battery condition & terminals", packages: ["standard", "full"], wofFlag: true },
      { code: "ENG-09", label: "Fuel filter (check / due)", packages: ["full"] },
      { code: "ENG-10", label: "Spark plugs (check / due)", packages: ["full"] },
      { code: "ENG-11", label: "HT leads / ignition leads (if applicable)", packages: ["full"] },
      { code: "ENG-12", label: "Air filter housing / induction (visual detail)", packages: ["full"] },
    ],
  },
  {
    id: "driveline",
    title: "Transmission / driveline",
    items: [
      { code: "DRV-01", label: "Transmission fluid level / condition", packages: ["standard", "full"] },
      { code: "DRV-02", label: "Differential / transfer / driveline levels", packages: ["standard", "full"] },
      { code: "DRV-03", label: "Grease & lube suspension / points as required", packages: ["standard", "full"] },
      { code: "DRV-04", label: "CV boots & driveshafts — quick visual", packages: ["standard"], wofFlag: true },
      { code: "DRV-05", label: "CV boots, driveshafts & driveline — detailed", packages: ["full"], wofFlag: true },
      { code: "DRV-06", label: "Clutch operation (road feel, if manual)", packages: ["full"] },
      { code: "DRV-07", label: "Auto transmission operation (road feel)", packages: ["full"] },
    ],
  },
  {
    id: "brakes",
    title: "Brakes",
    items: [
      { code: "BRK-01", label: "Brake fluid level & condition", packages: ["standard", "full"], wofFlag: true },
      { code: "BRK-02", label: "Brake warning / ABS lights", packages: ["standard", "full"], wofFlag: true },
      { code: "BRK-03", label: "Brake hoses & pipes (visual, wheels on)", packages: ["standard"], wofFlag: true },
      { code: "BRK-04", label: "Handbrake / park brake — basic function", packages: ["standard"], wofFlag: true },
      { code: "BRK-05", label: "Remove road wheels", packages: ["full"] },
      { code: "BRK-06", label: "Front brake pads — measure / inspect", packages: ["full"], wofFlag: true },
      { code: "BRK-07", label: "Front discs / rotors — inspect", packages: ["full"], wofFlag: true },
      { code: "BRK-08", label: "Rear pads or shoes — inspect", packages: ["full"], wofFlag: true },
      { code: "BRK-09", label: "Rear discs / drums — inspect", packages: ["full"], wofFlag: true },
      { code: "BRK-10", label: "Clean & adjust brakes as required", packages: ["full"] },
      { code: "BRK-11", label: "Reset / adjust handbrake", packages: ["full"], wofFlag: true },
      { code: "BRK-12", label: "Brake hoses, pipes, calipers — wheels-off visual", packages: ["full"], wofFlag: true },
    ],
  },
  {
    id: "suspension",
    title: "Steering & suspension",
    items: [
      { code: "SUS-01", label: "Power steering fluid (if applicable)", packages: ["standard", "full"] },
      { code: "SUS-02", label: "Steering play — basic check", packages: ["standard"], wofFlag: true },
      { code: "SUS-03", label: "Shocks / springs — visual leaks & obvious damage", packages: ["standard"], wofFlag: true },
      { code: "SUS-04", label: "Steering joints / gaiters / tie rods — detailed", packages: ["full"], wofFlag: true },
      { code: "SUS-05", label: "Bushes, mounts, control arms — detailed", packages: ["full"], wofFlag: true },
      { code: "SUS-06", label: "Wheel bearings — play / noise", packages: ["full"], wofFlag: true },
    ],
  },
  {
    id: "tyres",
    title: "Tyres & wheels",
    items: [
      { code: "TYR-01", label: "Tyre pressures (all; spare if present)", packages: ["standard", "full"], wofFlag: true },
      { code: "TYR-02", label: "Tread & condition — visual (wheels on)", packages: ["standard"], wofFlag: true },
      { code: "TYR-03", label: "Tread depth LF / RF / LR / RR (mm)", packages: ["full"], wofFlag: true },
      { code: "TYR-04", label: "Wear pattern / damage / age cracking — detailed", packages: ["full"], wofFlag: true },
      { code: "TYR-05", label: "Wheel condition / wheel nuts", packages: ["full"] },
      { code: "TYR-06", label: "Tyre rotation (if required)", packages: ["full"] },
    ],
  },
  {
    id: "electrical",
    title: "Electrical, lights & visibility",
    items: [
      { code: "ELE-01", label: "Headlights (high / low)", packages: ["standard", "full"], wofFlag: true },
      { code: "ELE-02", label: "Tail / brake / reverse lights", packages: ["standard", "full"], wofFlag: true },
      { code: "ELE-03", label: "Indicators / hazards", packages: ["standard", "full"], wofFlag: true },
      { code: "ELE-04", label: "Number plate lights", packages: ["standard", "full"], wofFlag: true },
      { code: "ELE-05", label: "Dashboard warning lights", packages: ["standard", "full"] },
      { code: "ELE-06", label: "Horn", packages: ["standard", "full"], wofFlag: true },
      { code: "ELE-07", label: "Wiper blades", packages: ["standard", "full"], wofFlag: true },
      { code: "ELE-08", label: "Washer fluid & washers", packages: ["standard", "full"] },
      { code: "ELE-09", label: "Windscreen chips / cracks", packages: ["standard", "full"], wofFlag: true },
    ],
  },
  {
    id: "body",
    title: "Body, exhaust & underbody",
    items: [
      { code: "BOD-01", label: "Exhaust — quick visual", packages: ["standard"], wofFlag: true },
      { code: "BOD-02", label: "Exhaust — detailed mounts, leaks, damage", packages: ["full"], wofFlag: true },
      { code: "BOD-03", label: "Underbody / structural rust — quick look", packages: ["standard"], wofFlag: true },
      { code: "BOD-04", label: "Underbody / structural rust — hoist inspection", packages: ["full"], wofFlag: true },
      { code: "BOD-05", label: "Door latches / mirrors (basic)", packages: ["standard", "full"] },
      { code: "BOD-06", label: "Seatbelts (visual / basic function)", packages: ["standard", "full"], wofFlag: true },
    ],
  },
];

const ACTIONS = {
  standard: [
    { id: "oil", label: "Engine oil replaced" },
    { id: "oil_filter", label: "Oil filter replaced" },
    { id: "fluids", label: "Fluids checked / topped up" },
    { id: "grease", label: "Grease / lube as required" },
    { id: "lights", label: "Lights checked" },
    { id: "tyre_pressures", label: "Tyre pressures set" },
    { id: "air_filter", label: "Air filter checked / replaced if agreed" },
    { id: "battery", label: "Battery checked" },
  ],
  fullExtra: [
    { id: "wheels_off", label: "Road wheels removed" },
    { id: "brakes_inspected", label: "Brakes inspected (incl. drums if fitted)" },
    { id: "brakes_adjusted", label: "Brakes cleaned / adjusted" },
    { id: "handbrake", label: "Handbrake reset / adjusted" },
    { id: "driveline_detail", label: "Driveline & CV boots inspected in detail" },
    { id: "tyres_rotated", label: "Tyres rotated" },
    { id: "plugs", label: "Spark plugs checked / replaced if due" },
    { id: "ht_leads", label: "HT leads checked (if applicable)" },
    { id: "fuel_filter", label: "Fuel filter checked / replaced if due" },
    { id: "road_test", label: "Road test completed" },
  ],
  either: [
    { id: "cabin_filter", label: "Cabin filter replaced" },
    { id: "coolant", label: "Coolant replaced" },
    { id: "brake_flush", label: "Brake fluid flushed" },
    { id: "transmission", label: "Transmission service" },
  ],
};

const STATUSES = ["ok", "watch", "attention", "na"];

function itemsForPackage(pkg) {
  const packageKey = pkg === "full" ? "full" : "standard";
  return GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.packages.includes(packageKey)),
  })).filter((group) => group.items.length > 0);
}

function emptyChecks(pkg) {
  const checks = {};
  for (const group of itemsForPackage(pkg)) {
    for (const item of group.items) {
      checks[item.code] = { status: "ok", note: "" };
    }
  }
  return checks;
}

module.exports = {
  GROUPS,
  ACTIONS,
  STATUSES,
  itemsForPackage,
  emptyChecks,
};
