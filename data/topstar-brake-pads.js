/** Topstar brake pads consignment (Jap + Euro), lists dated 15/10/2026.
 * Buy: Jap $25 incl GST → ex GST below; Euro from $30+ (tiers $30/$35/$40/$45 not mapped per part).
 * Qty is sets on the consignment sheets. Parts on both lists are one SKU (fitment merged, qty max).
 * Retail is the stock markup band minimum, same as Add to stock.
 */

const inventoryLib = require("./inventory");

const IMPORT_ID = "topstar-brake-pads-2026-10";
const SUPPLIER = "Topstar New Zealand";
const BRAND = "Topstar";
const JAP_BUY_EX = inventoryLib.roundMoney(25 / (1 + inventoryLib.GST_RATE)); // $25 incl
const EURO_BUY_EX = 30; // from $30+ on sheet note

// [part, application, qty sets, range: jap|euro|both]
const PADS = [
  ["CDB300", "HONDA/SUBARU", 1, "jap"],
  ["CDB308", "TOYOTA", 1, "jap"],
  ["CDB422/1147", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB1086", "PEUGEOT", 0, "euro"],
  ["CDB1149", "TOYOTA/FOTON", 1, "jap"],
  ["CDB1158", "MAZDA/FORD", 0, "jap"],
  ["CDB1163/1195", "HONDA/ISUZU/SUZUKI", 1, "jap"],
  ["CDB1165", "HYUNDAI/NISSAN", 1, "jap"],
  ["CDB1166", "HYUNDAI/KIA/NISSAN", 1, "jap"],
  ["CDB1185/1219", "SUBARU", 1, "jap"],
  ["CDB1187/1232", "NISSAN/SUZUKI", 1, "jap"],
  ["CDB1191/1391", "HONDA", 1, "jap"],
  ["CDB1200", "TOYOTA/LEXUS/MITS", 1, "jap"],
  ["CDB1223", "MITSUBISHI", 1, "jap"],
  ["CDB1247", "NISSAN", 1, "jap"],
  ["CDB1252", "HYUNDAI", 1, "jap"],
  ["CDB1262", "HONDA/ISUZU", 1, "jap"],
  ["CDB1265", "HONDA", 1, "jap"],
  ["CDB1267", "TOYOTA", 1, "jap"],
  ["CDB1274", "MAZDA/MITS", 1, "jap"],
  ["CDB1277", "MITS/TOYOTA", 1, "jap"],
  ["CDB1286", "HONDA/ISUZU", 1, "jap"],
  ["CDB1302", "NISSAN/MAZDA", 1, "jap"],
  ["CDB1328", "TOYOTA", 1, "jap"],
  ["CDB1331", "HOLDEN", 0, "euro"],
  ["CDB1332", "HOLDEN", 0, "euro"],
  ["CDB1333", "TOYOTA/FOTON", 1, "jap"],
  ["CDB1345", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB1378", "TOYOTA", 1, "jap"],
  ["CDB1379", "SUBARU", 1, "jap"],
  ["CDB1388", "MAZDA/MITS", 1, "jap"],
  ["CDB1393/1515", "HONDA", 1, "jap"],
  ["CDB1395/1419", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB1405W", "AUDI/VW", 1, "euro"],
  ["CDB1409", "BMW", 0, "euro"],
  ["CDB1415", "BMW", 0, "euro"],
  ["CDB1416", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB1422", "TOYOTA", 1, "jap"],
  ["CDB1429", "TOYOTA", 1, "jap"],
  ["CDB1431", "TOYOTA", 1, "jap"],
  ["CDB1432", "TOYOTA", 1, "jap"],
  ["CDB1433", "TOYOTA", 0, "jap"],
  ["CDB1434", "TOYOTA", 1, "jap"],
  ["CDB1441", "MITS/JEEP", 1, "jap"],
  ["CDB1449", "AUDI/VW", 1, "euro"],
  ["CDB1451", "HYUNDAI/KIA", 1, "jap"],
  ["CDB1454", "NISSAN/MAZDA", 1, "jap"],
  ["CDB1455", "MITSUBISHI", 0, "jap"],
  ["CDB1460", "TOYOTA/SUZUKI", 0, "jap"],
  ["CDB1462", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB1463", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB1464", "MITSUBISHI", 1, "jap"],
  ["CDB1473", "FORD", 1, "euro"],
  ["CDB1474/2243", "TOYOTA", 1, "jap"],
  ["CDB1475", "TOYOTA", 1, "jap"],
  ["CDB1481", "HONDA", 1, "jap"],
  ["CDB1482", "TOYOTA/MITS", 1, "jap"],
  ["CDB1484", "MAZDA", 1, "jap"],
  ["CDB1487", "TOYOTA", 1, "jap"],
  ["CDB1490/1519", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB1491", "SUBARU/TOYOTA", 1, "jap"],
  ["CDB1509", "NISSAN/SUZUKI", 1, "jap"],
  ["CDB1516", "NISSAN", 1, "jap"],
  ["CDB1517", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB1518", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB1657", "MERCEDES-BENZ", 0, "euro"],
  ["CDB1660", "TOYOTA", 1, "jap"],
  ["CDB1665", "NISSAN/FORD/HOLDEN", 1, "both"],
  ["CDB1674", "TOYOTA/SUZUKI/DAIHATSU", 1, "jap"],
  ["CDB1675", "FORD", 1, "euro"],
  ["CDB1678", "MITSUBISHI/SUBARU", 0, "jap"],
  ["CDB1679", "MAZDA/FORD", 1, "jap"],
  ["CDB1681", "MAZDA/FORD", 1, "jap"],
  ["CDB1682", "MAZDA", 1, "jap"],
  ["CDB1686", "MITSUBISHI", 1, "jap"],
  ["CDB1694", "BMW", 1, "euro"],
  ["CDB1696", "NISSAN/MITS", 1, "jap"],
  ["CDB1722", "SUBARU", 1, "jap"],
  ["CDB1724", "MAZDA/FORD", 1, "jap"],
  ["CDB1728", "HONDA", 1, "jap"],
  ["CDB1729", "MAZDA", 1, "jap"],
  ["CDB1739", "TOYOTA", 1, "jap"],
  ["CDB1741", "TOYOTA", 1, "jap"],
  ["CDB1744", "SUBARU", 1, "jap"],
  ["CDB1754", "HYUNDAI/KIA", 1, "jap"],
  ["CDB1760/417", "MAZDA", 1, "jap"],
  ["CDB1763", "MAZDA/FORD/VOLVO/PEUGEOT", 1, "both"],
  ["CDB1765", "HOLDEN", 1, "euro"],
  ["CDB1766", "HOLDEN", 1, "euro"],
  ["CDB1768", "TOYOTA/DA/SUBARU", 1, "jap"],
  ["CDB1769", "NISSAN/ISUZU", 1, "jap"],
  ["CDB1772", "TOYOTA", 1, "jap"],
  ["CDB1774", "NISSAN/MITS", 1, "jap"],
  ["CDB1782", "BMW", 1, "euro"],
  ["CDB1783", "BMW", 1, "euro"],
  ["CDB1785", "TOYOTA", 1, "jap"],
  ["CDB1786", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB1787", "HYUNDAI/KIA", 1, "jap"],
  ["CDB1789", "SUBARU", 1, "jap"],
  ["CDB1796", "MITSUBISHI", 1, "jap"],
  ["CDB1800", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB1801", "TOYOTA", 1, "jap"],
  ["CDB1802", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB1803", "SUBARU/TOYOTA", 1, "jap"],
  ["CDB1818", "SUZUKI", 1, "jap"],
  ["CDB1819", "NISSAN/MAZDA", 1, "jap"],
  ["CDB1820", "TOYOTA", 1, "jap"],
  ["CDB1830", "NISSAN", 1, "jap"],
  ["CDB1832", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB1833", "BMW", 1, "euro"],
  ["CDB1835", "NISSAN", 1, "jap"],
  ["CDB1841", "HOLDEN", 1, "euro"],
  ["CDB1842", "SUZUKI", 1, "jap"],
  ["CDB1843", "HONDA", 1, "jap"],
  ["CDB1847", "HONDA", 1, "jap"],
  ["CDB1849W", "AUDI/VW", 1, "euro"],
  ["CDB1850", "HOLDEN", 1, "euro"],
  ["CDB1852", "LEXUS", 1, "jap"],
  ["CDB1854", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB1856", "BMW", 1, "euro"],
  ["CDB1857", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB1858", "BMW", 1, "euro"],
  ["CDB1862", "HOLDEN", 1, "euro"],
  ["CDB1864", "BMW", 0, "euro"],
  ["CDB1865", "AUDI/VW", 1, "euro"],
  ["CDB1913", "TOYOTA", 1, "jap"],
  ["CDB1914", "TOYOTA", 1, "jap"],
  ["CDB1916", "MAZDA", 1, "jap"],
  ["CDB1917", "MAZDA", 1, "jap"],
  ["CDB1919", "NISSAN", 1, "jap"],
  ["CDB1921", "MERCEDES-BENZ", 1, "euro"],
  ["CDB1940", "HYUNDAI/KIA", 1, "jap"],
  ["CDB1941", "SUZUKI/MAZDA", 1, "jap"],
  ["CDB1942", "MAZDA/FORD", 1, "jap"],
  ["CDB1943", "HYUNDAI/KIA", 1, "jap"],
  ["CDB1946", "NISSAN", 1, "jap"],
  ["CDB1953", "HONDA", 1, "jap"],
  ["CDB1982", "LDV", 1, "jap"],
  ["CDB1985", "TOYOTA", 1, "jap"],
  ["CDB1989", "HOLDEN", 1, "euro"],
  ["CDB1991", "HONDA", 1, "jap"],
  ["CDB1998", "LDV/MG/VOLVO", 1, "jap"],
  ["CDB2004", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB2005", "TOYOTA", 1, "jap"],
  ["CDB2019", "MERCEDES-BENZ", 1, "euro"],
  ["CDB2020", "MERCEDES-BENZ", 0, "euro"],
  ["CDB2034", "HYUNDAI/KIA/Ssangyong", 1, "jap"],
  ["CDB2035", "LDV", 1, "jap"],
  ["CDB2072", "HYUNDAI/KIA", 1, "jap"],
  ["CDB2074", "MAZDA/FORD", 1, "both"],
  ["CDB2088/2076", "HYUNDAI/KIA", 1, "jap"],
  ["CDB2089", "HYUNDAI/KIA", 1, "jap"],
  ["CDB2159", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB2174", "HYUNDAI/KIA", 1, "jap"],
  ["CDB2178", "HYUNDAI/KIA/Ssangyong", 1, "jap"],
  ["CDB2181", "MERCEDES-BENZ", 1, "euro"],
  ["CDB2182", "MERCEDES-BENZ", 1, "euro"],
  ["CDB2184", "AUDI/VW", 1, "euro"],
  ["CDB2185", "AUDI/VW", 1, "euro"],
  ["CDB2186", "AUDI/FORD", 1, "euro"],
  ["CDB2194", "BMW", 1, "euro"],
  ["CDB2195", "BMW", 0, "euro"],
  ["CDB2211", "AUDI/VW", 1, "euro"],
  ["CDB2221", "TOYOTA", 0, "jap"],
  ["CDB2223", "BMW", 1, "euro"],
  ["CDB2224", "BMW", 1, "euro"],
  ["CDB2225", "BMW", 1, "euro"],
  ["CDB2226", "MAZDA/JEEP", 1, "jap"],
  ["CDB2227", "MAZDA", 1, "jap"],
  ["CDB2230", "TOYOTA", 1, "jap"],
  ["CDB2231", "TOYOTA", 1, "jap"],
  ["CDB2240", "HYUNDAI/KIA", 1, "jap"],
  ["CDB2245", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB2255", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB2293", "MAZDA", 1, "jap"],
  ["CDB2294", "MAZDA/MITS", 1, "jap"],
  ["CDB2299", "BMW", 1, "euro"],
  ["CDB2304", "HONDA", 1, "jap"],
  ["CDB2308", "HONDA", 1, "jap"],
  ["CDB2309", "TOYOTA/HONDA", 1, "jap"],
  ["CDB2315", "MERCEDES-BENZ", 1, "euro"],
  ["CDB2318", "MERCEDES-BENZ", 1, "euro"],
  ["CDB2330", "MAZDA", 1, "jap"],
  ["CDB2331", "MAZDA", 1, "jap"],
  ["CDB2332", "BMW", 0, "euro"],
  ["CDB2334", "MAZDA/TOYOTA", 1, "jap"],
  ["CDB2341", "NISSAN/HOLDEN", 1, "jap"],
  ["CDB2345", "NISSAN", 1, "jap"],
  ["CDB2355", "HONDA", 1, "jap"],
  ["CDB2357", "NISSAN", 1, "jap"],
  ["CDB2364", "SUZUKI/Nissan", 1, "jap"],
  ["CDB2374", "NISSAN", 1, "jap"],
  ["CDB2378", "NISSAN", 1, "jap"],
  ["CDB2380", "TOYOTA", 1, "jap"],
  ["CDB2383", "AUDI/VW/Skoda", 1, "euro"],
  ["CDB2384", "AUDI/VW/Skoda", 1, "euro"],
  ["CDB2394", "MERCEDES-BENZ", 1, "euro"],
  ["CDB2398", "SUBARU", 1, "jap"],
  ["CDB2403", "MERCEDES-BENZ", 1, "euro"],
  ["CDB2404", "MERCEDES-BENZ", 1, "euro"],
  ["CDB2414", "MAZDA", 1, "jap"],
  ["CDB2419", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB2424", "HYUNDAI/KIA", 1, "jap"],
  ["CDB2429", "HAVAL/HONDA", 1, "jap"],
  ["CDB2430", "SUZUKI/Nissan", 1, "jap"],
  ["CDB2446", "HYUNDAI/KIA", 1, "jap"],
  ["CDB2447/1957", "HYUNDAI/KIA", 1, "jap"],
  ["CDB2449", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB2454", "KIA", 1, "jap"],
  ["CDB2458", "MG", 1, "jap"],
  ["CDB2466", "MG", 1, "jap"],
  ["CDB2469", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB2480", "SUBARU", 0, "jap"],
  ["CDB2483", "MERCEDES-BENZ", 1, "euro"],
  ["CDB2485", "MAZDA", 1, "jap"],
  ["CDB2493", "BMW/MINI", 1, "euro"],
  ["CDB2494", "MINI", 1, "euro"],
  ["CDB2495", "MAZDA", 1, "jap"],
  ["CDB2525", "TOYOTA", 1, "jap"],
  ["CDB2526", "TOYOTA", 1, "jap"],
  ["CDB2529", "TOYOTA/LEXUS", 1, "jap"],
  ["CDB2538", "MAZDA", 1, "jap"],
  ["CDB2539", "MAZDA", 1, "jap"],
  ["CDB2540", "MITSUBISHI", 1, "jap"],
  ["CDB2544", "TOYOTA", 1, "jap"],
  ["CDB2551", "MERCEDES-BENZ", 1, "euro"],
  ["CDB2581", "MERCEDES-BENZ", 1, "euro"],
  ["CDB2593", "HYUNDAI/KIA", 1, "jap"],
  ["CDB2614", "HYUNDAI/KIA", 1, "jap"],
  ["CDB2632", "MG", 1, "jap"],
  ["CDB2633", "MITSUBISHI/NISSAN", 1, "jap"],
  ["CDB2634", "MITSUBISHI", 1, "jap"],
  ["CDB2641", "HYUNDAI/KIA", 1, "jap"],
  ["CDB2643", "HYUNDAI/KIA", 1, "jap"],
  ["CDB2655", "LDV", 1, "jap"],
  ["CDB3144", "MAZDA", 1, "jap"],
];

function buyFor(range) {
  return range === "euro" ? EURO_BUY_EX : JAP_BUY_EX;
}

function rangeLabel(range) {
  if (range === "euro") return "Euro";
  if (range === "both") return "Jap/Euro";
  return "Jap";
}

function stockLine([part, application, qty, range]) {
  const buy = buyFor(range);
  return {
    category: "brake_pad",
    name: `${part} Topstar brake pads`,
    partNumber: part,
    brand: BRAND,
    supplier: SUPPLIER,
    fitment: `${rangeLabel(range)} · ${application}`,
    costPrice: buy,
    sellPrice: inventoryLib.suggestPrice(buy).sell,
    qtyOnHand: qty,
    notes: "Consignment · set",
  };
}

function samePart(item, part) {
  return String(item.partNumber || "").replace(/\s+/g, "").toUpperCase() === part.toUpperCase();
}

/** Add the pads to stock. A Topstar part already in stock keeps its qty; only prices and details are updated. */
function applyToStock(items, movements, now, newId) {
  const added = [];
  const updated = [];
  for (const row of PADS) {
    const line = stockLine(row);
    const existing = items.find(
      (item) =>
        item.category === "brake_pad" &&
        samePart(item, line.partNumber) &&
        String(item.supplier || "").trim().toLowerCase() === SUPPLIER.toLowerCase()
    );
    if (existing) {
      Object.assign(existing, { ...line, qtyOnHand: existing.qtyOnHand, updatedAt: now });
      updated.push(line.partNumber);
      continue;
    }
    const item = inventoryLib.normalizeItem({ ...line, id: newId(), createdAt: now, updatedAt: now });
    items.push(item);
    added.push(line.partNumber);
    if (item.qtyOnHand > 0) {
      movements.push({
        id: newId(),
        itemId: item.id,
        qtyDelta: item.qtyOnHand,
        qtyAfter: item.qtyOnHand,
        costPrice: item.costPrice,
        supplier: item.supplier,
        invoiceNo: "",
        supplierInvoiceId: "",
        candidateId: "",
        note: "Opening stock (consignment)",
        createdAt: now,
      });
    }
  }
  return { added, updated };
}

module.exports = {
  IMPORT_ID,
  SUPPLIER,
  JAP_BUY_EX,
  EURO_BUY_EX,
  PADS,
  stockLine,
  applyToStock,
};
