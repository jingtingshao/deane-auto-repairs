/** Checklist aligned to website #prices — Standard $199 / Premium $279 */

const BOTH = ["standard", "premium"];
const PREMIUM = ["premium"];

const GROUPS = [
  {
    id: "service_basics",
    title: "Oil, fluids & filters",
    items: [
      { code: "SVC-01", label: "Change engine oil", packages: BOTH },
      { code: "SVC-02", label: "Change engine oil filter", packages: BOTH },
      { code: "SVC-03", label: "Check / top-up brake fluid", packages: BOTH, wofFlag: true },
      { code: "SVC-04", label: "Check brake fluid condition", packages: BOTH, wofFlag: true },
      { code: "SVC-05", label: "Check / top-up coolant", packages: BOTH },
      { code: "SVC-06", label: "Visual check radiator cap & hoses", packages: BOTH },
      { code: "SVC-07", label: "Check / top-up power steering fluid", packages: BOTH },
      { code: "SVC-08", label: "Check / top-up washer fluid", packages: BOTH },
      { code: "SVC-09", label: "Visual check air filter", packages: BOTH },
      { code: "SVC-10", label: "Check transmission / gearbox fluid", packages: BOTH },
      { code: "SVC-11", label: "Check differential fluid", packages: BOTH },
      { code: "SVC-12", label: "Cabin / pollen filter check", packages: PREMIUM },
    ],
  },
  {
    id: "electrical_battery",
    title: "Battery, belts & electrics",
    items: [
      { code: "ELC-01", label: "Test battery condition", packages: BOTH },
      { code: "ELC-02", label: "Visual check drive belts", packages: BOTH },
      { code: "ELC-03", label: "Check / test all lights", packages: BOTH, wofFlag: true },
      { code: "ELC-04", label: "Check wiper blades", packages: BOTH, wofFlag: true },
      { code: "ELC-05", label: "Service light reset (where possible)", packages: BOTH },
      { code: "ELC-06", label: "Visual check spark plugs", packages: BOTH },
      { code: "ELC-07", label: "Diagnostic scan", packages: PREMIUM },
    ],
  },
  {
    id: "brakes",
    title: "Brakes",
    items: [
      { code: "BRK-01", label: "Brake inspection (wheels on)", packages: BOTH, wofFlag: true },
      { code: "BRK-02", label: "Brake warning / ABS lights", packages: BOTH, wofFlag: true },
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
      { code: "TYR-01", label: "Tyre pressure & condition check", packages: BOTH, wofFlag: true },
      { code: "SUS-01", label: "Visual check steering / CV boots", packages: BOTH, wofFlag: true },
      { code: "SUS-02", label: "Visual check suspension", packages: BOTH, wofFlag: true },
    ],
  },
  {
    id: "exhaust_road",
    title: "Exhaust & road test",
    items: [
      { code: "BOD-01", label: "Visual check exhaust system", packages: BOTH, wofFlag: true },
      { code: "RD-01", label: "Road test up to 50 km/h", packages: BOTH },
    ],
  },
];

const ACTIONS = {
  standard: [
    { id: "oil", label: "Engine oil replaced (full synthetic as quoted)" },
    { id: "oil_filter", label: "Oil filter replaced" },
    { id: "fluids", label: "Fluids checked / topped up" },
    { id: "battery", label: "Battery tested" },
    { id: "air_filter", label: "Air filter checked" },
    { id: "lights", label: "Lights checked" },
    { id: "tyre_pressures", label: "Tyre pressures set" },
    { id: "service_light", label: "Service light reset (where possible)" },
    { id: "road_test", label: "Road test completed" },
    { id: "digital_report", label: "Digital service report prepared" },
  ],
  /** Premium-only completed actions (also returned as fullExtra for older clients) */
  premiumExtra: [
    { id: "wheels_off", label: "Road wheels removed — brake inspection" },
    { id: "brakes_measured", label: "Brake pads / discs inspected (wheels off)" },
    { id: "cabin_filter", label: "Cabin / pollen filter checked" },
    { id: "diagnostic", label: "Diagnostic scan completed" },
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
  return "standard";
}

function itemsForPackage(pkg) {
  const packageKey = normalizePackage(pkg);
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
  normalizePackage,
  itemsForPackage,
  emptyChecks,
};
