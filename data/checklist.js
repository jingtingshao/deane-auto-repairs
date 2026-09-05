/** Checklist aligned to in-store price list — Basic $99 / Standard $199 / Premium $279 */

const STD = ["standard", "premium"];
const PREMIUM = ["premium"];
const BASIC_CHECK_CODES = ["SVC-01", "SVC-02", "SVC-08"];

const GROUPS = [
  {
    id: "service_basics",
    title: "Oil, fluids & filters",
    items: [
      { code: "SVC-01", label: "Change engine oil", packages: STD },
      { code: "SVC-02", label: "Change engine oil filter", packages: STD },
      { code: "SVC-03", label: "Check / top-up brake fluid", packages: STD, wofFlag: true },
      { code: "SVC-04", label: "Check brake fluid condition", packages: STD, wofFlag: true },
      { code: "SVC-05", label: "Check / top-up coolant", packages: STD },
      { code: "SVC-06", label: "Visual check radiator cap & hoses", packages: STD },
      { code: "SVC-07", label: "Check / top-up power steering fluid", packages: STD },
      { code: "SVC-08", label: "Check / top-up washer fluid", packages: STD },
      { code: "SVC-09", label: "Visual check air filter", packages: STD },
      { code: "SVC-10", label: "Check transmission / gearbox fluid", packages: STD },
      { code: "SVC-11", label: "Check differential fluid", packages: STD },
      { code: "SVC-13", label: "Engine / transmission oil leak inspection", packages: STD },
      { code: "SVC-12", label: "Cabin / pollen filter check", packages: PREMIUM },
    ],
  },
  {
    id: "electrical_battery",
    title: "Battery, belts & electrics",
    items: [
      { code: "ELC-01", label: "Test battery condition", packages: STD },
      { code: "ELC-02", label: "Visual check drive belts", packages: STD },
      { code: "ELC-03", label: "Exterior lights & indicators", packages: STD, wofFlag: true },
      { code: "ELC-08", label: "Dashboard warning lights", packages: STD, wofFlag: true },
      { code: "ELC-04", label: "Check wiper blades", packages: STD, wofFlag: true },
      { code: "ELC-05", label: "Service light reset (where possible)", packages: STD },
      { code: "ELC-06", label: "Visual check spark plugs", packages: PREMIUM },
      { code: "ELC-07", label: "Diagnostic scan", packages: PREMIUM },
    ],
  },
  {
    id: "brakes",
    title: "Brakes",
    items: [
      { code: "BRK-01", label: "Brake inspection (wheels on)", packages: PREMIUM, wofFlag: true },
      { code: "BRK-02", label: "Brake warning / ABS lights", packages: STD, wofFlag: true },
      { code: "BRK-03", label: "Brake inspection (wheels off)", packages: PREMIUM, wofFlag: true },
      { code: "BRK-04", label: "Front brake pads — inspect / measure", packages: PREMIUM, wofFlag: true },
      { code: "BRK-05", label: "Rear brake pads / shoes — inspect / measure", packages: PREMIUM, wofFlag: true },
      { code: "BRK-06", label: "Front discs / rotors — inspect", packages: PREMIUM, wofFlag: true },
      { code: "BRK-07", label: "Rear discs / drums — inspect", packages: PREMIUM, wofFlag: true },
      { code: "BRK-08", label: "Brake lines / hoses — wheels-off check", packages: PREMIUM, wofFlag: true },
      { code: "BRK-09", label: "Parking brake — check / adjust", packages: PREMIUM, wofFlag: true },
    ],
  },
  {
    id: "tyres_steering",
    title: "Tyres, steering & suspension",
    items: [
      { code: "TYR-01", label: "Tyre pressure & condition check", packages: STD, wofFlag: true },
      { code: "SUS-01", label: "Visual check steering / CV boots", packages: STD, wofFlag: true },
      { code: "SUS-02", label: "Visual check suspension", packages: PREMIUM, wofFlag: true },
      { code: "SUS-03", label: "Check wheel bearings for excessive play", packages: PREMIUM, wofFlag: true },
    ],
  },
  {
    id: "exhaust_road",
    title: "Exhaust & road test",
    items: [
      { code: "BOD-01", label: "Visual check exhaust system", packages: STD, wofFlag: true },
      { code: "RD-01", label: "Road test up to 50 km/h", packages: PREMIUM },
    ],
  },
];

const ACTIONS = {
  basic: [
    { id: "oil", label: "Engine oil replaced (as quoted)" },
    { id: "oil_filter", label: "Oil filter replaced" },
    { id: "washer", label: "Washer fluid topped up" },
  ],
  standard: [
    { id: "oil", label: "Engine oil replaced (full synthetic as quoted)" },
    { id: "oil_filter", label: "Oil filter replaced" },
    { id: "fluids", label: "Fluids checked / topped up" },
    { id: "battery", label: "Battery tested" },
    { id: "air_filter", label: "Air filter checked" },
    { id: "exterior_lights", label: "Exterior lights & indicators checked" },
    { id: "dashboard_lights", label: "Dashboard warning lights checked" },
    { id: "tyre_pressures", label: "Tyre pressures set" },
    { id: "cv_boots", label: "Steering / CV boots checked" },
    { id: "oil_leaks", label: "Engine / transmission oil leaks inspected" },
    { id: "service_light", label: "Service light reset (where possible)" },
    { id: "digital_report", label: "Digital service report prepared" },
  ],
  /** Premium-only completed actions (also returned as fullExtra for older clients) */
  premiumExtra: [
    { id: "wheels_on", label: "Brake inspection completed (wheels on)" },
    { id: "wheels_off", label: "Road wheels removed — brake inspection" },
    { id: "brakes_measured", label: "Brake pads / discs inspected (wheels off)" },
    { id: "steering_suspension", label: "Steering / CV boots & suspension checked" },
    { id: "wheel_bearings", label: "Wheel bearings checked for play" },
    { id: "spark_plugs", label: "Spark plugs inspected" },
    { id: "cabin_filter", label: "Cabin / pollen filter checked" },
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
