#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  DEFAULT_SETTINGS,
  WEBSITE_BRANDS_PER_TIER,
  websitePicks,
  buildPublic,
  diffWebsite,
} = require("../data/tyre-prices");

function row({ brand, pattern, cost_ex, stock = "10", size = "205/55R16", load_speed = "91H" }) {
  return { brand, pattern, cost_ex, usual_ex: cost_ex, stock, size, load_speed, tyrewise_ex: 6.65 };
}

const settings = { ...DEFAULT_SETTINGS };

{
  const picks = websitePicks(
    [
      row({ brand: "Mazzini", pattern: "A", cost_ex: 40 }),
      row({ brand: "Achilles", pattern: "B", cost_ex: 42 }),
      row({ brand: "Wanli", pattern: "C", cost_ex: 45 }),
      row({ brand: "OtherBrand", pattern: "D", cost_ex: 50 }),
      row({ brand: "Linglong", pattern: "Eco", cost_ex: 55 }),
      row({ brand: "Hankook", pattern: "Kinergy", cost_ex: 60 }),
      row({ brand: "Kumho", pattern: "Solus", cost_ex: 65 }),
      row({ brand: "Goodyear", pattern: "Opti", cost_ex: 110 }),
      row({ brand: "Michelin", pattern: "Primacy", cost_ex: 130 }),
      row({ brand: "Bridgestone", pattern: "Turanza", cost_ex: 140 }),
    ],
    settings
  );
  assert.strictEqual(WEBSITE_BRANDS_PER_TIER, 3);
  assert.strictEqual(picks.filter((p) => p.tier === "Budget").length, 3);
  assert.strictEqual(picks.filter((p) => p.tier === "Mid-range").length, 3);
  assert.strictEqual(picks.filter((p) => p.tier === "Premium").length, 3);
  assert.deepStrictEqual(
    picks.filter((p) => p.tier === "Budget").map((p) => p.row.brand),
    ["Mazzini", "Achilles", "Wanli"]
  );
}

{
  // Mid-range cheaper than Budget → Budget still listed (brand menu + website cards)
  const picks = websitePicks(
    [
      row({ brand: "Mazzini", pattern: "A", cost_ex: 80 }),
      row({ brand: "Linglong", pattern: "Eco", cost_ex: 50 }),
      row({ brand: "Goodyear", pattern: "Opti", cost_ex: 110 }),
    ],
    settings
  );
  assert.deepStrictEqual(
    picks.map((p) => `${p.tier}:${p.row.brand}`),
    ["Budget:Mazzini", "Mid-range:Linglong", "Premium:Goodyear"]
  );

  const publicPrices = buildPublic(
    [
      row({ brand: "Mazzini", pattern: "ECO307+", cost_ex: 49.3, size: "175/65R15", load_speed: "84H" }),
      row({ brand: "Linglong", pattern: "Comfort Master", cost_ex: 44, size: "175/65R15", load_speed: "84H" }),
      row({ brand: "Goodyear", pattern: "Assurance", cost_ex: 110, size: "175/65R15", load_speed: "84H" }),
    ],
    settings,
    "2026-11-01"
  );
  assert.ok(publicPrices.brands["175/65R15"].some((c) => c.brand === "Mazzini"));
  assert.ok(publicPrices.sizes["175/65R15"].some((c) => c.brand === "Mazzini"));
  const linglong = publicPrices.sizes["175/65R15"].find((c) => c.brand === "Linglong");
  assert.ok(linglong?.special, "Linglong cheaper than Budget should be SPECIAL");
  assert.ok(publicPrices.brands["175/65R15"].find((c) => c.brand === "Linglong")?.special);
}

{
  // Linglong dearer than Budget → no SPECIAL
  const publicPrices = buildPublic(
    [
      row({ brand: "Mazzini", pattern: "A", cost_ex: 40, size: "185/65R15" }),
      row({ brand: "Linglong", pattern: "Eco", cost_ex: 70, size: "185/65R15" }),
    ],
    settings,
    "2026-11-01"
  );
  assert.ok(!publicPrices.sizes["185/65R15"].find((c) => c.brand === "Linglong")?.special);
}

{
  const publicPrices = buildPublic(
    [
      row({ brand: "Linglong", pattern: "Eco", cost_ex: 55, stock: "Out of stock" }),
      row({ brand: "Hankook", pattern: "Kinergy", cost_ex: 60, stock: "5" }),
      row({ brand: "Goodyear", pattern: "Opti", cost_ex: 110, stock: "" }),
      row({ brand: "Goodyear", pattern: "Opti", cost_ex: 110, stock: "2", load_speed: "94W" }),
    ],
    settings,
    "2026-11-01"
  );
  assert.ok(publicPrices.brands["205/55R16"].length >= 3);
  assert.ok(publicPrices.brands["205/55R16"].some((c) => c.brand === "Linglong"));
  assert.ok(publicPrices.sizes["205/55R16"].length >= 2);

  const changed = diffWebsite(
    { sizes: { "205/55R16": [{ tier: "Mid-range", brand: "Linglong", pattern: "Eco", load: "91H", price: 100 }] } },
    publicPrices
  );
  assert.ok(changed.length >= 1);
}

console.log("test-tyre-website-picks: ok");
