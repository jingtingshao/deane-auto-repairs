/**
 * Log in to each tyre supplier's trade portal and download the current price list.
 * Credentials come from environment variables only (Render → Environment).
 * Each supplier has fetch (raw rows as the portal returns them) and convert
 * (normalised rows, same shape as tyre-price-data.json).
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0 Safari/537.36";
const PAGE_DELAY_MS = 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createSession() {
  const jar = new Map();
  async function request(url, opts = {}, hops = 0) {
    const headers = { "User-Agent": UA, "Accept-Language": "en-NZ,en;q=0.9", ...(opts.headers || {}) };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers,
      body: opts.body,
      redirect: "manual",
      signal: AbortSignal.timeout(90_000),
    });
    for (const line of res.headers.getSetCookie?.() || []) {
      const pair = line.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq < 1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value || value === "deleted" || /max-age=0|expires=thu, 01 jan 1970/i.test(line)) jar.delete(name);
      else jar.set(name, value);
    }
    if ([301, 302, 303, 307, 308].includes(res.status) && hops < 8) {
      const next = new URL(res.headers.get("location") || "/", url).href;
      const keep = res.status === 307 || res.status === 308;
      return request(next, keep ? opts : { headers: opts.headers }, hops + 1);
    }
    return res;
  }
  return { request, cookie: (name) => jar.get(name) };
}

async function readJson(res, label) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: unexpected response (${res.status})`);
  }
}

function formBody(fields) {
  const p = new URLSearchParams();
  for (const [k, v] of fields) p.append(k, v);
  return p.toString();
}

// ---- name parsing (ported from the office price-list script) ----

const WING_SIZE_RES = [
  [/(?:LT\s*)?(\d{2})\s*[*X]\s*(\d{1,2}(?:\.\d{1,2})?)\s*R\s*(\d{2,3})(?:\s*LT)?/, (m) => `${m[1]}x${Number(m[2]).toFixed(2)}R${m[3].slice(-2)}`],
  [/(?:LT\s*)?(\d{3})\/(\d{2})\s*Z?RF?\s*(\d{2}(?:\.5)?)(C)?/, (m) => `${m[1]}/${m[2]}R${m[3]}${m[4] || ""}`],
  [/\b(\d{1,2}(?:\.5)?)R\s*(\d{2}\.5)/, (m) => `${m[1]}R${m[2]}`],
  [/\b([1-3]\d{2})R\s*(\d{2})(\s*C)?/, (m) => `${m[1]}R${m[2]}${m[3] ? "C" : ""}`],
  [/\b(\d)\.?(\d{2})R(\d{2})/, (m) => `${m[1]}.${m[2]}R${m[3]}`],
  [/\b(\d{2})[-.\s](16\.5)/, (m) => `${m[1]}-16.5`],
];
const LOAD_RE = /\(?\b(\d{2,3})(?:\/(\d{2,3}))?\s*(XL)?\s*([HJKLMNPQRSTUVWY])?\s*(XL)?\s*\)?(?!\s*(?:PR|PLY)|\d)/g;
const BRANDS = [
  ["Mazzini", "M[AI]?Z{2,3}I{0,2}NI"], ["Rotalla", "ROTALLA"], ["iLink", "I-?LINK"],
  ["Ardent", "ARDENT"], ["Delmax", "DELMAX"], ["Fronway", "FRONWAY"],
  ["Greenlander", "GRE+NLANDER"], ["Luxxan", "LUXXAN"], ["Minnell", "MINNELL"],
  ["Joyroad", "JOYROAD"], ["Three-A", "THREE-A"], ["Zmax", "ZMAX"],
  ["Delinte", "DELINTE"], ["Neolin", "NEOLIN"],
];
const BRAND_HINTS = [
  ["Mazzini", /ECO ?\d{3}|\bF1\b|FALCONER|VA?ERE?NNA|ECOSAVER|GIA?N?T ?SAVER|GAINTSAVER|NITRO ?GRIP|EFFIVAN|ECOROVER|MUD CONTENDER|SHARK/],
  ["Rotalla", /\bR[HUFSX]\d|S-RACE|\bAT0\d|EV01|\bRX9|F105/],
  ["iLink", /ZEAL|L-COMFORT|L-GRIP|POWERCITY|THUNDER/],
];
const FILLER_RE =
  /NON-DIRECTIONAL|PATTERN|\(TREAD\)|TREAD|TYRES?\b|LIGHT TRUCK|\bVAN\b|\bLT\b|\bLT-EU\b|\d{1,2}\s*P(?:R|LY)\b|[()]/g;

const squash = (s) => String(s ?? "").split(/\s+/).filter(Boolean).join(" ");
const money = (s) => (s === null || s === undefined || s === "" ? null : Number(String(s).replace(/[$,]/g, "")));
const round2 = (n) => Math.round(n * 100) / 100;
const titleCase = (s) => String(s || "").replace(/[A-Za-z]+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

function parseTyreName(name, mpn, sku) {
  const n = squash(name);
  const u = n.toUpperCase();
  let size = null;
  let rest = "";
  for (const [rx, fmt] of WING_SIZE_RES) {
    const m = rx.exec(u);
    if (m) {
      size = fmt(m);
      rest = `${u.slice(0, m.index)} ${u.slice(m.index + m[0].length)}`.trim();
      break;
    }
  }
  if (!size) return null;
  let loadSpeed = "";
  for (const lm of rest.matchAll(LOAD_RE)) {
    if (Number(lm[1]) >= 60 && Number(lm[1]) <= 130) {
      loadSpeed = lm[1] + (lm[2] ? `/${lm[2]}` : "") + (lm[4] || "");
      if (lm[3] || lm[5]) loadSpeed += " XL";
      rest = `${rest.slice(0, lm.index)} ${rest.slice(lm.index + lm[0].length)}`;
      break;
    }
  }
  if (/^\d{3}R\d{2}$/.test(size) && loadSpeed.includes("/")) size += "C";
  const ply = /(\d{1,2})\s*P(?:R|LY)\b/.exec(u);
  let brand = null;
  const extra = `${mpn || ""} ${sku || ""}`.toUpperCase();
  for (const [b, rx] of BRANDS) {
    if (new RegExp(rx).test(rest) || new RegExp(rx).test(extra)) {
      brand = b;
      rest = rest.replace(new RegExp(`${rx}\\w*`, "g"), " ");
      break;
    }
  }
  if (!brand) brand = (BRAND_HINTS.find(([, rx]) => rx.test(rest)) || ["Other"])[0];
  const pattern = squash(rest.replace(FILLER_RE, " ").split(" - ").join(" ").replace(/^[ -]+|[ -]+$/g, ""));
  return { size, loadSpeed, brand, pattern, ply: ply ? `${ply[1]}PR` : null, description: n };
}

function row(fields) {
  return {
    supplier: null, category: null, sku: null, size: null, brand: null, pattern: null,
    variant: null, load_speed: null, ply: null, features: null, oe_fitments: null,
    cost_ex: null, special: false, usual_ex: null, rrp_incl: null, tyrewise_ex: null, stock: "",
    ...fields,
  };
}

// ---- Tyremax (GraphQL) ----

const TYREMAX_GQL = "https://admin.tyremax.co.nz/graphql";
const TYREMAX_LOGIN = `mutation submitLoginForm($email: String!, $password: String!, $rememberMe: Boolean = false) {
  result: createMemberTokens(email: $email, password: $password, rememberMe: $rememberMe) { valid status code message accessToken }
}`;
const TYREMAX_PRODUCTS = `query readProductList($offset: Int, $limit: Int, $category: ID, $term: String, $consignment: Boolean!, $exclude: [ID!]) {
  data: readProductList(offset: $offset, limit: $limit, category: $category, term: $term, consignment: $consignment, exclude: $exclude) {
    nodes {
      id sku title brandTitle loadSpeed oeFitments otherInfo plyRating treadName treadPattern
      price rrp rrpGstIncl special tyrewiseChargePriceExclusive
      publicStockData(filter: DEFAULT) { warehouse quantity quantityExceedMaxDisplay default available }
    }
    pageInfo { totalCount }
  }
}`;
const TYREMAX_CATEGORIES = [["1", "car"], ["5", "lt"]];

async function fetchTyremax({ email, password }) {
  const gql = async (query, variables, auth) => {
    const res = await fetch(TYREMAX_GQL, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://www.tyremax.co.nz",
        ...(auth ? { Authorization: auth } : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(90_000),
    });
    const json = await readJson(res, "Tyremax");
    if (json.errors?.length) throw new Error(`Tyremax: ${json.errors[0].message}`);
    return json.data;
  };
  const login = (await gql(TYREMAX_LOGIN, { email, password, rememberMe: false })).result;
  if (!login?.valid || !login.accessToken) throw new Error(`Tyremax login failed: ${login?.message || "no token"}`);
  let auth = `Bearer ${login.accessToken}`;
  const out = { car: [], lt: [] };
  for (const [category, key] of TYREMAX_CATEGORIES) {
    for (let offset = 0; offset < 10000; offset += 100) {
      const vars = { offset, limit: 100, category, term: null, consignment: false, exclude: [] };
      let data = (await gql(TYREMAX_PRODUCTS, vars, auth)).data;
      if (offset === 0 && data.nodes.length && data.nodes.every((n) => !n.price)) {
        auth = login.accessToken;
        data = (await gql(TYREMAX_PRODUCTS, vars, auth)).data;
        if (data.nodes.every((n) => !n.price)) throw new Error("Tyremax: logged in but no trade prices returned");
      }
      for (const n of data.nodes) {
        const st = (n.publicStockData || []).find((s) => s.default) || (n.publicStockData || [])[0] || {};
        out[key].push([
          n.sku, n.title, n.brandTitle, n.treadPattern, n.treadName, n.loadSpeed, n.plyRating, n.otherInfo,
          n.oeFitments, n.price, n.special, n.rrp, n.rrpGstIncl, n.tyrewiseChargePriceExclusive,
          st.warehouse, st.quantity, st.quantityExceedMaxDisplay,
        ]);
      }
      if (data.nodes.length < 100) break;
      await sleep(PAGE_DELAY_MS);
    }
  }
  return out;
}

function convertTyremax(data) {
  const out = [];
  for (const [key, category] of [["car", "Car & 4WD"], ["lt", "Light Truck & TBR"]]) {
    for (const r of data[key] || []) {
      const [sku, size, brand, pattern, variant, loadSpeed, ply, features, oe, price, special, usual, rrpIncl, twEx, , qty, qtyMore] = r;
      out.push(row({
        supplier: "Tyremax", category, sku, size: String(size || "").trim(), brand, pattern, variant,
        load_speed: loadSpeed, ply, features, oe_fitments: oe,
        cost_ex: money(price), special: Boolean(special), usual_ex: special ? money(usual) : null,
        rrp_incl: money(rrpIncl), tyrewise_ex: money(twEx),
        stock: qty === null || qty === undefined ? "" : qtyMore ? `${qty}+` : String(qty),
      }));
    }
  }
  return out;
}

// ---- Wing Tyres ----

const WING = "https://www.wingtyres.co.nz";

async function fetchWing({ email, password }) {
  const s = createSession();
  await s.request(`${WING}/customer`);
  await s.request(`${WING}/customer/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${WING}/customer` },
    body: formBody([["username", email], ["password", password]]),
  });
  const list = async (categoryId, page) =>
    readJson(
      await s.request(
        `${WING}/product/list/?q=&categoryId=${categoryId}&productAttributeValueIds=&special=-1&newArrival=-1&page=${page}&size=100&sortBy=position&sort=ASC`,
        { headers: { Accept: "application/json" } }
      ),
      "Wing"
    );
  const top = await readJson(await s.request(`${WING}/category/top`, { headers: { Accept: "application/json" } }), "Wing");
  const parentId = top?.[0]?.menu?.id;
  const cats = (top?.[0]?.subMenuViewList || []).map((c) => [c.menu.id, c.menu.name]);
  if (!cats.length) throw new Error("Wing: could not read the product categories");
  const rows = [];
  const seen = new Set();
  const push = (n, catName) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    rows.push([n.id, catName, n.productName, n.mpn, n.sku, n.price1, n.price3, n.special, n.formatedStock, n.stock, n.status, n.slug]);
  };
  for (const [id, name] of [...cats, ...(parentId ? [[parentId, null]] : [])]) {
    for (let p = 0; p < 50; p++) {
      const j = await list(id, p);
      for (const n of j.content || []) push(n, name || (/R\s*(\d+)/i.exec(n.productName)?.[1] ? `${/R\s*(\d+)/i.exec(n.productName)[1]} inch` : "Other"));
      await sleep(PAGE_DELAY_MS);
      if (j.last || (j.content || []).length < 100) break;
    }
  }
  if (!rows.some((r) => Number(r[6]) > 0)) throw new Error("Wing login failed: no trade prices returned");
  return { wing: rows };
}

function convertWing(data) {
  const out = [];
  for (const [pid, , name, mpn, sku, rrpEx, price, special, fstock, stock] of data.wing || []) {
    const p = parseTyreName(name, mpn, sku);
    if (!p || !price) continue;
    const stockText = fstock === null || fstock === undefined ? (!stock ? "Out of stock" : String(Math.trunc(stock))) : fstock;
    const lightTruck = /^\d\.\d{2}R|-16\.5/.test(p.size);
    out.push(row({
      supplier: "Wing", category: lightTruck ? "Light Truck & TBR" : "Car & 4WD", sku: String(pid),
      size: p.size, brand: p.brand, pattern: p.pattern, load_speed: p.loadSpeed, ply: p.ply,
      features: p.description, cost_ex: Number(price), special: Boolean(special),
      rrp_incl: rrpEx ? round2(Number(rrpEx) * 1.15) : null, tyrewise_ex: 6.65, stock: stockText,
    }));
  }
  return out;
}

// ---- Value Tyres (EasyOrder) ----

const VALUE = "https://portal.valuetyres.co.nz";
const VALUE_TYPES = {
  "Passenger Car Radial": "Car & 4WD",
  "Ultra High Performance": "Car & 4WD",
  "Recreational Vehicle": "Car & 4WD",
  "Light Truck": "Light Truck & TBR",
  "Truck Bus Radial": "Light Truck & TBR",
};

async function fetchValueTyres({ email: code, password }) {
  const s = createSession();
  const loginPage = await (await s.request(`${VALUE}/login`)).text();
  const token = /name="_token"\s+value="([^"]+)"/.exec(loginPage)?.[1] || /<meta name="csrf-token" content="([^"]+)"/.exec(loginPage)?.[1];
  if (!token) throw new Error("Value Tyres: login page changed (no form token)");
  await s.request(`${VALUE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${VALUE}/login`, Origin: VALUE },
    body: formBody([["_token", token], ["accredo_code", code], ["password", password], ["remember", "on"]]),
  });
  const rows = [];
  for (let page = 1, last = 1; page <= last && page < 400; page++) {
    const xsrf = s.cookie("XSRF-TOKEN");
    const res = await s.request(
      `${VALUE}/api/portal/products/list?page=${page}&type=&brand=&sort=recommended&application=&tyreSize=&isSpecial=false&isSales=false&sales=&isClearance=undefined&priceLabel=&promoName=`,
      {
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Referer: `${VALUE}/tyres/all`,
          ...(xsrf ? { "X-XSRF-TOKEN": decodeURIComponent(xsrf) } : {}),
        },
      }
    );
    if (res.status === 401 || res.status === 419) throw new Error("Value Tyres login failed");
    const j = await readJson(res, "Value Tyres");
    last = j.meta?.last_page || 1;
    for (const n of j.data || []) {
      rows.push([
        n.id, n.product_code, n.description, n.brand?.name, n.sub_brand, n.pattern, n.type, n.direction?.name,
        n.price, n.was_price, n.rrp_price, n.is_custom_price, n.custom_price, n.is_stock_local, n.is_stock_national,
        n.hscode?.price, n.discontinued, n.promotion_name, n.decibel_rating,
      ]);
    }
    await sleep(PAGE_DELAY_MS);
  }
  if (!rows.some((r) => Number(r[8]) > 0)) throw new Error("Value Tyres login failed: no trade prices returned");
  return { rows };
}

const VALUE_PATTERN_SKIP = /^(\(?\d{2,3}(\/\d{2,3})?[A-Z]?(XL)?\)?|\d{1,2}PLY|\d{1,2}PR|XL)$/;

function convertValueTyres(data) {
  const out = [];
  for (const r of data.rows || []) {
    const [, code, desc, brand, , , typ, direction, price, wasPrice, rrp, isCustom, customPrice, stockLocal, , fee, discontinued, promo] = r;
    const category = VALUE_TYPES[typ];
    if (!category) continue;
    const p = parseTyreName(desc, null, null);
    const cost = Number(isCustom && customPrice ? customPrice : price || 0);
    if (!p || !cost) continue;
    const words = p.description.split(" ");
    let sizeTok = words.findIndex((w) => /\d.*R\d/.test(w.toUpperCase()));
    if (sizeTok < 0) sizeTok = 0;
    const rest = [...words.slice(0, sizeTok), ...words.slice(sizeTok + 2)];
    const pattern = rest.filter((w) => !VALUE_PATTERN_SKIP.test(w.toUpperCase())).join(" ");
    const features = [direction, typ, discontinued ? "Discontinued" : null, promo].filter(Boolean).join(" | ");
    const brandUpper = String(brand || "").toUpperCase();
    out.push(row({
      supplier: "Value Tyres", category, sku: code, size: p.size,
      brand: { GREENTR: "Greentrac", ROYALBLACK: "RoyalBlack" }[brandUpper] || titleCase(brand),
      pattern, load_speed: p.loadSpeed, ply: p.ply, features,
      cost_ex: cost, special: Boolean(wasPrice || promo), usual_ex: wasPrice ? Number(wasPrice) : null,
      rrp_incl: rrp ? Number(rrp) : null, tyrewise_ex: fee ? Number(fee) : null,
      stock: stockLocal === null || stockLocal === undefined ? "" : String(stockLocal),
    }));
  }
  return out;
}

// ---- Blairs ----

const BLAIRS = "https://www.blairs.co.nz";
const BLAIRS_CAR_LT_CATEGORY = "6675";

async function fetchBlairs({ email, password }) {
  const s = createSession();
  await s.request(`${BLAIRS}/`);
  await s.request(`${BLAIRS}/360admin/Surface/MembershipSurface/Login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "*/*",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${BLAIRS}/`,
      Origin: BLAIRS,
    },
    body: formBody([
      ["Username", email], ["Password", password], ["RememberMe", "true"], ["RememberMe", "false"],
      ["ReturnUrl", ""], ["X-Requested-With", "XMLHttpRequest"],
    ]),
  });
  const rows = [];
  for (let page = 1, pages = 1; page <= pages && page < 100; page++) {
    const body = JSON.stringify({
      SearchParams: {
        BaseFilterCategoryIds: [BLAIRS_CAR_LT_CATEGORY], BaseFilterKeywords: "", IncludeHiddenItems: false,
        DisableEmptyKeyWordSearch: false, Facets: [{ GroupId: "f___applicableCategoryIdsSSV", FacetId: BLAIRS_CAR_LT_CATEGORY }],
        BaseFilterFlagIds: null, KeyWords: "", StoreId: 1, CurrentPage: page, PageSize: 100,
      },
      ItemSummaryTextLength: 0, ImagePaddingBgColor: "ffffff", IncludeCategoryFacets: false,
      IncludeFlagFacets: false, IncludeBrandFacets: false, IncludeOtherFacets: false, SearchResultScoreThreshold: "0",
    });
    const j = await readJson(
      await s.request(`${BLAIRS}/Umbraco/Api/Products/SearchByParams`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Referer: `${BLAIRS}/categories/car-lt/` },
        body,
      }),
      "Blairs"
    );
    pages = j.TotalPages || 1;
    for (const it of j.Items || []) {
      let price = null;
      try {
        price = JSON.parse(it.PriceItems).PriceItems[0].Price.Value;
      } catch {
        /* no price for this item */
      }
      const st = it.DeserializedDisplayLocationWithStock || {};
      rows.push([it.Id, it.DisplayName, it.Sku, it.Brand, price, it.RecommendedRetailPrice, it.DisplayTariffPrice, st.Auckland, st.Nationwide, it.Url, ""]);
    }
    await sleep(PAGE_DELAY_MS);
  }
  if (!rows.some((r) => Number(r[4]) > 0)) throw new Error("Blairs login failed: no trade prices returned");
  return { rows };
}

function blairsName(name) {
  let s = squash(name);
  s = s.replace(/^(\d{3}) (\d)R(\d) /, "$1/$2$3R ");
  s = s.replace(/^(\d{3})[ /](\d{2}) ?R ?/, "$1/$2R");
  s = s.replace(/^(\d{2}) (\d{1,2}\.\d) ?R ?/, "$1x$2R");
  s = s.replace(/^(\S*?R) (\d)/, "$1$2");
  return s.replace(/\b(\d{2,3}(?:\/\d{2,3})?) ([HJKLMNPQRSTUVWY])\b/g, "$1$2");
}

function convertBlairs(data) {
  const out = [];
  for (const [pid, name, sku, brand, price, rrpEx, feeText, stockAkl] of data.rows || []) {
    if (/^[\d. ]+X/i.test(name) || !price) continue;
    const p = parseTyreName(blairsName(name), null, null);
    if (!p) continue;
    const fee = money(String(feeText ?? "").replace("GST excl.", "").trim());
    const commercial = p.size.endsWith("C") || p.size.includes(".5");
    out.push(row({
      supplier: "Blairs", category: commercial ? "Light Truck & TBR" : "Car & 4WD", sku: sku || String(pid),
      size: p.size, brand: brand === "Star trac" ? "Star Trac" : brand, pattern: p.pattern,
      load_speed: p.loadSpeed, ply: p.ply, features: squash(name), cost_ex: Number(price),
      rrp_incl: rrpEx ? round2(Number(rrpEx) * 1.15) : null,
      tyrewise_ex: fee && fee < 100 ? fee : null,
      stock: stockAkl === null || stockAkl === undefined ? "" : String(stockAkl),
    }));
  }
  return out;
}

// ---- all suppliers ----

const SUPPLIERS = [
  { name: "Tyremax", userEnv: "TYREMAX_EMAIL", passEnv: "TYREMAX_PASSWORD", fetch: fetchTyremax, convert: convertTyremax },
  { name: "Wing", userEnv: "WING_EMAIL", passEnv: "WING_PASSWORD", fetch: fetchWing, convert: convertWing },
  { name: "Value Tyres", userEnv: "VALUETYRES_CODE", passEnv: "VALUETYRES_PASSWORD", fetch: fetchValueTyres, convert: convertValueTyres },
  { name: "Blairs", userEnv: "BLAIRS_EMAIL", passEnv: "BLAIRS_PASSWORD", fetch: fetchBlairs, convert: convertBlairs },
];

function supplierStatus(env = process.env) {
  return SUPPLIERS.map((s) => ({
    supplier: s.name,
    configured: Boolean(String(env[s.userEnv] || "").trim() && String(env[s.passEnv] || "").trim()),
  }));
}

/** Download every configured supplier. One failing supplier does not stop the others. */
async function fetchAllSuppliers(env = process.env, log = () => {}) {
  const results = [];
  for (const s of SUPPLIERS) {
    const email = String(env[s.userEnv] || "").trim();
    const password = String(env[s.passEnv] || "");
    if (!email || !password) {
      results.push({ supplier: s.name, skipped: true });
      continue;
    }
    const started = Date.now();
    try {
      const rows = s.convert(await s.fetch({ email, password }));
      log(`${s.name}: ${rows.length} tyres in ${Math.round((Date.now() - started) / 1000)}s`);
      results.push({ supplier: s.name, rows });
    } catch (err) {
      log(`${s.name}: failed — ${err.message}`);
      results.push({ supplier: s.name, error: err.message || String(err) });
    }
  }
  return results;
}

module.exports = {
  SUPPLIERS,
  supplierStatus,
  fetchAllSuppliers,
  parseTyreName,
  convertTyremax,
  convertWing,
  convertValueTyres,
  convertBlairs,
};
