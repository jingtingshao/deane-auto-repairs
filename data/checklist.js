/** Checklist aligned to in-store price list — Basic $99 / Standard $199 / Premium / Diesel / European $299 */

const STD = ["standard", "premium"];
const PREMIUM = ["premium"];
const BASIC_CHECK_CODES = ["SVC-08"];

/** Inspection items only (OK / Watch / Attention). Work performed (oil, filter, service light reset) lives in ACTIONS. */
const GROUPS = [
  {
    id: "service_basics",
    title: "Oil, fluids & filters",
    items: [
      { code: "SVC-03", label: "Inspected brake fluid level", packages: STD, wofFlag: true },
      { code: "SVC-04", label: "Inspected brake fluid condition", packages: PREMIUM, wofFlag: true },
      { code: "SVC-05", label: "Inspected coolant level", packages: STD },
      { code: "SVC-06", label: "Inspected radiator cap & hoses", packages: PREMIUM },
      { code: "SVC-07", label: "Inspected power steering fluid level", packages: STD },
      { code: "SVC-08", label: "Inspected washer fluid level", packages: STD },
      { code: "SVC-09", label: "Inspected air filter", packages: STD },
      { code: "SVC-10", label: "Inspected transmission / gearbox fluid", packages: PREMIUM },
      { code: "SVC-11", label: "Inspected differential fluid", packages: PREMIUM },
      { code: "SVC-13", label: "Engine / transmission oil leak inspection", packages: STD },
    ],
  },
  {
    id: "electrical_battery",
    title: "Battery, belts & electrics",
    items: [
      { code: "ELC-01", label: "Test battery condition", packages: STD },
      { code: "ELC-02", label: "Inspected drive belts", packages: STD },
      { code: "ELC-03", label: "Exterior lights & indicators", packages: STD, wofFlag: true },
      { code: "ELC-08", label: "Dashboard warning lights", packages: STD, wofFlag: true },
      { code: "ELC-04", label: "Inspected wiper blades", packages: STD, wofFlag: true },
      { code: "ELC-07", label: "Diagnostic scan — check for stored fault codes", packages: PREMIUM },
    ],
  },
  {
    id: "brakes",
    title: "Brakes",
    items: [
      { code: "BRK-01", label: "Brake inspection (wheels on) - pads & disc visually check", packages: STD, wofFlag: true },
      { code: "BRK-02", label: "Brake warning / ABS lights", packages: STD, wofFlag: true },
      { code: "BRK-03", label: "Brake inspection (wheels off)", packages: PREMIUM, wofFlag: true },
      { code: "BRK-04", label: "Inspected front brake pads", packages: PREMIUM, wofFlag: true },
      { code: "BRK-05", label: "Inspected rear brake pads / shoes", packages: PREMIUM, wofFlag: true },
      { code: "BRK-06", label: "Inspected front discs / rotors", packages: PREMIUM, wofFlag: true },
      { code: "BRK-07", label: "Inspected rear discs / drums", packages: PREMIUM, wofFlag: true },
      { code: "BRK-08", label: "Inspected brake lines / hoses (wheels off)", packages: PREMIUM, wofFlag: true },
      { code: "BRK-09", label: "Inspected parking brake (adjusted if needed)", packages: PREMIUM, wofFlag: true },
    ],
  },
  {
    id: "tyres_steering",
    title: "Tyres, steering & suspension",
    items: [
      { code: "TYR-01", label: "Tyre pressures set & tyre condition inspected", packages: STD, wofFlag: true },
      { code: "SUS-01", label: "Inspected steering system, including rack & linkages", packages: STD, wofFlag: true },
      { code: "SUS-02", label: "Inspected suspension components for wear, damage & excessive play", packages: PREMIUM, wofFlag: true },
      { code: "SUS-03", label: "Inspected wheel bearings for excessive play", packages: PREMIUM, wofFlag: true },
      { code: "SUS-04", label: "Inspected CV boots", packages: PREMIUM, wofFlag: true },
    ],
  },
  {
    id: "exhaust_road",
    title: "Exhaust & road test",
    items: [
      { code: "BOD-01", label: "Inspected exhaust system", packages: STD, wofFlag: true },
      { code: "RD-01", label: "Road test up to 50 km/h", packages: PREMIUM },
    ],
  },
];

const ACTIONS = {
  basic: [
    { id: "oil", label: "Engine oil replaced" },
    { id: "oil_filter", label: "Oil filter replaced" },
    { id: "washer", label: "Washer fluid topped up" },
  ],
  standard: [
    { id: "oil", label: "Engine oil replaced" },
    { id: "oil_filter", label: "Oil filter replaced" },
    { id: "brake_fluid_topup", label: "Brake fluid topped up" },
    { id: "coolant_topup", label: "Coolant topped up" },
    { id: "power_steering_topup", label: "Power steering fluid topped up" },
    { id: "washer", label: "Washer fluid topped up" },
    { id: "battery", label: "Battery tested" },
    { id: "air_filter", label: "Air filter checked" },
    { id: "exterior_lights", label: "Exterior lights & indicators checked" },
    { id: "dashboard_lights", label: "Dashboard warning lights checked" },
    { id: "tyre_pressures", label: "Tyre pressures set" },
    { id: "cv_boots", label: "Steering system checked" },
    { id: "wheels_on", label: "Brake inspection completed (wheels on)" },
    { id: "oil_leaks", label: "Engine / transmission oil leaks inspected" },
    { id: "service_light", label: "Service light reset (where possible)" },
    { id: "digital_report", label: "Digital service report prepared" },
  ],
  /** Premium-only completed actions (also returned as fullExtra for older clients) */
  premiumExtra: [
    { id: "wheels_off", label: "Road wheels removed — brake inspection" },
    { id: "brakes_measured", label: "Brake pads / discs inspected (wheels off)" },
    { id: "steering_suspension", label: "Suspension & CV boots checked" },
    { id: "wheel_bearings", label: "Wheel bearings checked for play" },
    { id: "diagnostic", label: "Diagnostic scan completed" },
    { id: "road_test", label: "Road test completed" },
  ],
  either: [
    { id: "cabin_filter_replaced", label: "Cabin filter replaced" },
    { id: "coolant", label: "Coolant replaced" },
    { id: "brake_flush", label: "Brake fluid flushed" },
    { id: "transmission", label: "Transmission service" },
    { id: "spark_plugs_replaced", label: "Spark plugs replaced" },
  ],
  /** No longer offered in admin; kept so older reports still show these ticks */
  legacy: [
    { id: "fluids", label: "Fluids checked / topped up" },
    { id: "cabin_filter", label: "Cabin / pollen filter checked" },
    { id: "spark_plugs", label: "Spark plugs inspected" },
  ],
};

// Back-compat alias used by admin/report UIs
ACTIONS.fullExtra = ACTIONS.premiumExtra;

const STATUSES = ["ok", "watch", "attention", "na"];

function normalizePackage(pkg) {
  if (pkg === "full" || pkg === "premium") return "premium";
  if (pkg === "basic") return "basic";
  return "standard";
}

function itemsForPackage(pkg) {
  const packageKey = normalizePackage(pkg);
  if (packageKey === "basic") {
    return GROUPS.map((group) => ({ ...group, items: group.items.slice() }));
  }
  return GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.packages.includes(packageKey)),
  })).filter((group) => group.items.length > 0);
}

function emptyChecks(pkg) {
  const packageKey = normalizePackage(pkg);
  const checks = {};
  const basicKeep = new Set(BASIC_CHECK_CODES);
  for (const group of itemsForPackage(pkg)) {
    for (const item of group.items) {
      const status =
        packageKey === "basic" && !basicKeep.has(item.code) ? "na" : "ok";
      checks[item.code] = { status, note: "" };
    }
  }
  return checks;
}

module.exports = {
  GROUPS,
  ACTIONS,
  STATUSES,
  normalizePackage,
  itemsForPackage,
  emptyChecks,
  BASIC_CHECK_CODES,
};
