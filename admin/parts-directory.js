(function () {
  const Admin = window.DeaneAdmin;

  const GROUP_LABEL = {
    trade: "Service parts",
    euro: "European",
    japan: "Japanese",
    korea: "Korean",
  };

  /** Phones and addresses checked against each company's own site on 20 Oct 2026. */
  const SUPPLIERS = [
    {
      id: "repco",
      name: "Repco",
      priority: 10,
      near: true,
      groups: ["trade"],
      conditions: ["new"],
      makes: ["all makes", "oil filter", "brake pads", "spark plugs", "belts", "battery", "oil"],
      summary: "Call here first for everyday service parts. With a trade account, use Repco Navigator Pro for stock and prices.",
      address: "Mt Roskill: 82–84 Stoddard Road",
      hours: "Mt Roskill: Mon–Sat 8am–5pm, Sun 9am–5pm",
      web: "https://www.repcotrade.co.nz/",
      phones: [
        { label: "Mt Roskill (closest)", display: "09 928 8399", tel: "099288399" },
        { label: "Onehunga, 51 Princes St", display: "09 636 1567", tel: "096361567" },
      ],
      note: "Onehunga is open Mon–Sat until 5:30pm, and Sun 9am–5pm.",
    },
    {
      id: "partmaster",
      name: "Partmaster",
      priority: 20,
      near: true,
      groups: ["trade"],
      conditions: ["new"],
      makes: ["all makes", "trade parts"],
      summary: "Another all-makes trade supplier. Call them when Repco is out of stock.",
      address: "Grey Lynn: 135 Great North Road",
      hours: "Trade hours on their site: Mon–Fri 7:30am–5:30pm, Sat 8am–1pm",
      web: "https://partmaster.kiwi/",
      phones: [
        { label: "Grey Lynn", display: "09 309 0799", tel: "093090799" },
        { label: "Penrose, 174 Station Rd", display: "09 526 3939", tel: "095263939" },
      ],
      note: "",
    },
    {
      id: "napa",
      name: "NAPA",
      priority: 30,
      near: true,
      groups: ["trade"],
      conditions: ["new"],
      makes: ["all makes", "trade parts"],
      summary: "New parts for all makes. Penrose and Otahuhu are both close to the workshop.",
      address: "Penrose: 3 Sims Road",
      hours: "",
      web: "https://www.napa.co.nz/locations/",
      phones: [
        { label: "Penrose", display: "09 270 5819", tel: "092705819" },
        { label: "Otahuhu, 127 Great South Rd", display: "09 276 3852", tel: "092763852" },
        { label: "Nationwide", display: "0800 800 073", tel: "0800800073" },
      ],
      note: "",
    },
    {
      id: "bnt",
      name: "BNT",
      priority: 40,
      near: true,
      groups: ["trade", "euro", "japan"],
      conditions: ["new"],
      makes: ["brakes", "clutch", "ball joint", "bearings", "driveshaft", "European", "Japanese"],
      summary: "Brake discs and pads, clutches, ball joints, and bearings. Covers European and Japanese cars.",
      address: "Onehunga: 55 Church Street",
      hours: "Mon–Fri 8am–5pm, Sat 9am–12pm",
      web: "https://bntnz.co.nz/",
      phones: [
        { label: "Onehunga", display: "09 634 5710", tel: "096345710" },
        { label: "Penrose, 47 Walls Rd", display: "09 900 0444", tel: "099000444" },
      ],
      note: "",
    },
    {
      id: "autolign",
      name: "Autolign",
      priority: 50,
      near: true,
      groups: ["trade", "euro", "japan"],
      conditions: ["new"],
      makes: ["shocks", "steering rack", "tie rod", "suspension", "European", "Japanese"],
      summary: "Shocks, steering racks, and tie rods. Steering and suspension only, for European and Japanese cars.",
      address: "Mt Wellington: 5/99 Carbine Road",
      hours: "Mon–Fri 7:30am–5pm, Sat 9am–12pm",
      web: "https://autolign.co.nz/",
      phones: [
        { label: "Mt Wellington", display: "09 574 2288", tel: "095742288" },
        { label: "Nationwide", display: "0800 868 900", tel: "0800868900" },
      ],
      note: "",
    },
    {
      id: "all-euro-parts",
      name: "All Euro Parts",
      priority: 60,
      near: false,
      groups: ["euro"],
      conditions: ["new"],
      makes: ["European", "OEM", "aftermarket", "filter", "brakes", "belt", "radiator", "suspension"],
      summary: "New European parts: OEM and aftermarket mechanical parts. Special air-freight orders are available.",
      address: "Auckland counter: 3 Parkhead Place, Rosedale",
      hours: "Mon–Fri 8am–5:30pm, closed weekends",
      web: "https://www.alleuroparts.co.nz/",
      phones: [
        { label: "Auckland", display: "09 425 5023", tel: "094255023" },
        { label: "Nationwide", display: "0800 255 387", tel: "0800255387" },
      ],
      note: "They do not sell body panels, glass, complete engines, gearboxes, or used parts.",
    },
    {
      id: "europart",
      name: "EuroPart (European Auto Spares)",
      priority: 70,
      near: false,
      wrecker: true,
      groups: ["euro"],
      conditions: ["new", "used"],
      makes: ["BMW", "Audi", "Mercedes", "MINI", "VW", "Volkswagen", "Bosch", "Febi", "Mahle"],
      summary: "BMW, Audi, Mercedes, MINI, and Volkswagen. New and used parts, with pickup in South Auckland.",
      address: "8 Ryan Place, Manukau",
      hours: "Mon–Fri 8am–5pm",
      email: "sales@europart.co.nz",
      web: "https://www.europart.co.nz/",
      phones: [{ label: "Manukau", display: "09 262 3752", tel: "092623752" }],
      note: "",
    },
    {
      id: "euro1",
      name: "Euro1 Auto Spares",
      priority: 80,
      near: true,
      wrecker: true,
      groups: ["euro"],
      conditions: ["new", "used"],
      makes: ["BMW", "Mercedes", "Porsche", "Maserati"],
      summary: "BMW, Mercedes, Porsche, and Maserati. New and dismantled parts. Used by workshops and insurers.",
      address: "8 Moa Street, Otahuhu",
      hours: "Mon–Fri 8am–5pm",
      web: "https://euro1.co.nz/",
      phones: [{ label: "Otahuhu", display: "09 270 3611", tel: "092703611" }],
      note: "New parts are generally warranted for 12 months. Used mechanical and electrical parts are generally warranted for 90 days. Quote a Capricorn account if the workshop has one. Have the registration, year, model, or VIN when you call.",
    },
    {
      id: "aaa",
      name: "AAA Autocentre",
      priority: 90,
      near: true,
      wrecker: true,
      groups: ["euro"],
      conditions: ["used"],
      makes: ["Audi", "VW", "Volkswagen", "Skoda", "Volvo", "Renault", "Peugeot", "Seat", "Maserati"],
      summary: "Used parts for Volkswagen, Audi, Skoda, Volvo, Renault, and Peugeot. Close to the workshop.",
      address: "360B Neilson Street, Onehunga",
      hours: "Mon–Fri 9am–5pm",
      email: "partsenquiry@aautocentre.co.nz",
      web: "https://www.aautocentre.co.nz/",
      phones: [
        { label: "Onehunga", display: "09 633 4466", tel: "096334466" },
        { label: "Text", display: "027 496 6856", tel: "0274966856" },
      ],
      note: "Call or text before you go. Do not turn up and wait. Put the registration in the email. They deliver nationwide.",
    },
    {
      id: "euroline",
      name: "Euroline",
      priority: 100,
      near: false,
      wrecker: true,
      groups: ["euro"],
      conditions: ["new", "used"],
      makes: ["Audi", "VW", "Volkswagen", "Skoda", "Peugeot"],
      summary: "Audi, Volkswagen, Skoda, and Peugeot. New and dismantled parts since 1997, with nationwide delivery.",
      address: "60 Firth Street, Drury",
      hours: "Mon–Fri 8am–5pm, Sat 9am–12pm by appointment",
      email: "info@euroline.co.nz",
      web: "https://www.euroline.co.nz/",
      phones: [{ label: "Drury", display: "09 294 7635", tel: "092947635" }],
      note: "",
    },
    {
      id: "giltrap-audi",
      name: "Giltrap Audi Grey Lynn",
      priority: 110,
      near: false,
      groups: ["euro"],
      conditions: ["new"],
      makes: ["Audi", "genuine"],
      summary: "Genuine new Audi parts. The Grey Lynn parts desk is closer than the North Shore dealer.",
      address: "150 Great North Road, Grey Lynn",
      hours: "Sat 8am–12pm. Call to confirm weekday hours.",
      email: "parts@giltrapaudi.co.nz",
      web: "https://www.giltrap.com/dealer/audi-grey-lynn/about",
      phones: [{ label: "Parts", display: "09 336 5255", tel: "093365255" }],
      note: "",
    },
    {
      id: "continental",
      name: "Continental Cars genuine parts",
      priority: 120,
      near: false,
      groups: ["euro"],
      conditions: ["new"],
      makes: ["BMW", "MINI", "Audi", "VW", "Volkswagen", "Porsche", "genuine"],
      summary: "Genuine new parts for BMW, MINI, Audi, Volkswagen, and Porsche.",
      address: "Parts warehouse: 11 Mauranui Avenue, Newmarket",
      hours: "Newmarket parts warehouse: Mon–Fri 8am–5pm",
      email: "parts@continentalcars.co.nz",
      web: "https://www.continentalcars.co.nz/contact-us/continental-cars-parts-centre/",
      phones: [
        { label: "BMW / MINI (Wairau)", display: "09 488 2000", tel: "094882000" },
        { label: "Audi Newmarket", display: "09 526 6940", tel: "095266940" },
        { label: "Volkswagen", display: "09 526 6968", tel: "095266968" },
        { label: "Porsche", display: "09 526 8991", tel: "095268991" },
        { label: "Newmarket parts warehouse", display: "09 526 6943", tel: "095266943" },
      ],
      note: "BMW parts are at 45–65 Wairau Road. For a closer Audi counter, call Giltrap Grey Lynn.",
    },
    {
      id: "mercedes",
      name: "Mercedes-Benz Auckland",
      priority: 130,
      near: false,
      groups: ["euro"],
      conditions: ["new"],
      makes: ["Mercedes", "genuine"],
      summary: "Genuine new Mercedes-Benz parts. Newmarket has its own parts number.",
      address: "2 Great South Road, Newmarket",
      hours: "Dealer hours are about Mon–Fri 7:30am–6pm",
      email: "parts@mbauckland.co.nz",
      web: "https://www.mercedesbenzvans.co.nz/locate-us/mercedes-benz-auckland/",
      phones: [
        { label: "Newmarket parts", display: "09 529 3873", tel: "095293873" },
        { label: "North Shore (switchboard)", display: "09 443 3808", tel: "094433808" },
      ],
      note: "For used Mercedes parts, call Euro1.",
    },
    {
      id: "strong-onehunga",
      name: "Parts Connection · Onehunga",
      priority: 140,
      near: true,
      wrecker: true,
      groups: ["japan"],
      conditions: ["new", "used"],
      makes: ["Nissan", "Mazda", "Suzuki", "Honda", "Subaru", "Isuzu", "Nisbits", "Mazbits", "Suzibits"],
      summary: "Call this yard first for used Japanese parts. Subaru new parts are here too. Nissan, Mazda, Suzuki, Honda, Subaru, and Isuzu have different numbers at the same address.",
      address: "75 Captain Springs Road, Onehunga",
      hours: "Weekday counters. Nationwide delivery.",
      email: "parts@strongparts.net",
      web: "https://partsconnection.co.nz/branches",
      phones: [
        { label: "Nissan Nisbits", display: "09 297 7703", tel: "092977703" },
        { label: "Nissan freephone", display: "0800 166 666", tel: "0800166666" },
        { label: "Mazda Mazbits", display: "09 297 7703", tel: "092977703" },
        { label: "Suzuki Suzibits", display: "09 297 7703", tel: "092977703" },
        { label: "Honda Strong", display: "09 634 2914", tel: "096342914" },
        { label: "Subaru Strong", display: "09 634 0065", tel: "096340065" },
        { label: "Subaru freephone", display: "0800 634 0065", tel: "08006340065" },
        { label: "Isuzu", display: "09 622 2072", tel: "096222072" },
      ],
      note: "Subaru stock includes new and used parts, with regular shipments from Japan. MG, Haval, and LDV also go through 09 634 0065.",
    },
    {
      id: "ajcpc",
      name: "Auckland Japanese Car Parts Centre",
      priority: 150,
      near: true,
      wrecker: true,
      groups: ["japan", "euro"],
      conditions: ["used"],
      makes: ["Toyota", "Nissan", "Honda", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "panels", "doors", "lights", "bumpers", "Audi", "BMW", "VW", "Peugeot"],
      summary: "Used Japanese body panels: doors, guards, lights, bumpers, and tailgates. Some Audi, BMW, Peugeot, and Volkswagen panels too.",
      address: "322–324 Church Street, Onehunga",
      hours: "Mon–Fri 8am–4:30pm",
      email: "sales@ajcpc.co.nz",
      web: "https://aucklandjapanesecarpartscentre.co.nz/",
      phones: [
        { label: "Onehunga", display: "09 634 5546", tel: "096345546" },
        { label: "Freephone", display: "0800 80 5546", tel: "0800805546" },
      ],
      note: "Dismantled body panels since 1982. Nationwide delivery.",
    },
    {
      id: "toyotaz",
      name: "Toyotaz Galore",
      priority: 160,
      near: false,
      wrecker: true,
      groups: ["japan"],
      conditions: ["used"],
      makes: ["Toyota", "Hilux", "Prado"],
      summary: "Used Toyota parts since 1992. Cars, vans, utes, and 4WDs.",
      address: "118a Sunnybrae Road, Glenfield",
      hours: "Mon–Fri 8am–5pm",
      email: "sales@toyotaspares.co.nz",
      web: "https://www.toyotaspares.co.nz/",
      phones: [{ label: "Glenfield", display: "09 444 8095", tel: "094448095" }],
      note: "For genuine new Toyota parts, call Auckland City Toyota.",
    },
    {
      id: "mitsi",
      name: "Mitsi Galore",
      priority: 170,
      near: false,
      wrecker: true,
      groups: ["japan"],
      conditions: ["new", "used"],
      makes: ["Mitsubishi", "Lancer", "Pajero", "Outlander", "Delica"],
      summary: "Used Mitsubishi parts, one of the largest Mitsubishi dismantlers in New Zealand. They also stock some genuine and new aftermarket parts.",
      address: "Parts Connection lists: 118a Sunnybrae Road, Glenfield",
      hours: "Mon–Fri 8am–5pm",
      email: "sales@mitsigalore.co.nz",
      web: "https://mitsigalore.co.nz/",
      phones: [{ label: "Mitsubishi", display: "09 269 0255", tel: "092690255" }],
      note: "Call before you drive there. Older listings say 21B Spartan Road, Takanini. Their current listing says Glenfield, the same address as used Toyota. They are a Capricorn supplier. For genuine new Mitsubishi parts, call Manukau Autos.",
    },
    {
      id: "dodson",
      name: "Dodson's Autospares",
      priority: 180,
      near: false,
      wrecker: true,
      groups: ["japan", "euro"],
      conditions: ["new", "used"],
      makes: ["Toyota", "Nissan", "Honda", "Mazda", "Subaru", "Suzuki", "Mitsubishi", "Lexus", "VW", "Audi", "BMW", "Volvo"],
      summary: "New and used Japanese parts, plus some Volkswagen, Audi, BMW, and Volvo.",
      address: "20 Poland Road, Glenfield",
      hours: "",
      email: "sales@dodson.co.nz",
      web: "https://dodsonautospares.co.nz/",
      phones: [{ label: "Glenfield", display: "09 441 3152", tel: "094413152" }],
      note: "",
    },
    {
      id: "toyota-dealer",
      name: "Auckland City Toyota",
      priority: 190,
      near: true,
      groups: ["japan"],
      conditions: ["new"],
      makes: ["Toyota", "genuine", "Lexus"],
      summary: "Genuine new Toyota parts. Greenlane and Mt Wellington are the closest. These are dealer switchboards, so ask for parts.",
      address: "Greenlane: 233 Great South Road",
      hours: "",
      web: "https://www.armstrongs.co.nz/",
      phones: [
        { label: "Greenlane", display: "09 601 9000", tel: "096019000" },
        { label: "Mt Wellington, 8 Forge Way", display: "09 360 6726", tel: "093606726" },
        { label: "Grey Lynn, 49 Great North Rd", display: "09 378 9919", tel: "093789919" },
      ],
      note: "Lexus genuine parts can be asked for at the Toyota parts desk. For used Toyota, call Toyotaz Galore.",
    },
    {
      id: "honda-dealer",
      name: "Honda Parts Distribution Centre",
      priority: 200,
      near: false,
      groups: ["japan"],
      conditions: ["new"],
      makes: ["Honda", "genuine"],
      summary: "Genuine new Honda parts, dispatched to workshops and dealers. The national warehouse is in East Auckland.",
      address: "51 Business Parade South, East Tamaki",
      hours: "Mon–Fri 8am–5pm",
      email: "parts@honda.co.nz",
      web: "https://www.honda.co.nz/find-a-store/auckland/honda-parts-distribution-centre/",
      phones: [
        { label: "Parts warehouse", display: "0800 377 374", tel: "0800377374" },
        { label: "Newmarket store", display: "09 890 9030", tel: "098909030" },
      ],
      note: "For used Honda parts, call Strong in Onehunga on 09 634 2914.",
    },
    {
      id: "mazda-dealer",
      name: "John Andrew Mazda",
      priority: 210,
      near: true,
      groups: ["japan"],
      conditions: ["new"],
      makes: ["Mazda", "genuine"],
      summary: "Genuine new Mazda parts. The Penrose parts desk is close to the workshop.",
      address: "Penrose: 23 Greenpark Road",
      hours: "Mon–Fri 7:30am–5pm",
      web: "https://www.johnandrewmazda.co.nz/parts",
      phones: [
        { label: "Penrose parts", display: "09 571 3024", tel: "095713024" },
        { label: "Grey Lynn", display: "0800 526 2932", tel: "08005262932" },
      ],
      note: "For used Mazda, call Mazbits in Onehunga on 09 297 7703.",
    },
    {
      id: "nissan-dealer",
      name: "Armstrong's Nissan East Auckland",
      priority: 220,
      near: false,
      groups: ["japan"],
      conditions: ["new"],
      makes: ["Nissan", "genuine"],
      summary: "Genuine new Nissan parts. This is the Botany dealer switchboard, so ask for parts.",
      address: "277 Ti Rakau Drive, Botany",
      hours: "",
      web: "https://www.armstrongs.co.nz/",
      phones: [{ label: "Botany", display: "09 272 8000", tel: "092728000" }],
      note: "Used Nissan is closer: Nisbits in Onehunga, 09 297 7703.",
    },
    {
      id: "mitsubishi-dealer",
      name: "Manukau Autos · Mitsubishi",
      priority: 230,
      near: false,
      groups: ["japan"],
      conditions: ["new"],
      makes: ["Mitsubishi", "genuine"],
      summary: "Genuine new Mitsubishi parts from the South Auckland dealer.",
      address: "1 Bakerfield Place, Manukau",
      hours: "Dealer hours Mon–Fri 8am–5pm",
      web: "https://manukauautos.co.nz/service/parts/",
      phones: [{ label: "Manukau", display: "0508 99 66 33", tel: "0508996633" }],
      note: "For used Mitsubishi, call Mitsi Galore on 09 269 0255.",
    },
    {
      id: "winger",
      name: "Winger parts",
      priority: 240,
      near: true,
      groups: ["japan"],
      conditions: ["new"],
      makes: ["Subaru", "Suzuki", "genuine"],
      summary: "Genuine new Subaru and Suzuki parts. The Greenlane parts number is the closer one.",
      address: "North Shore parts centre: 75 Wairau Road",
      hours: "North Shore: Mon–Fri 8am–5pm, Sat 9am–12pm",
      web: "https://winger.co.nz/locations/department/parts/",
      phones: [
        { label: "Greenlane parts", display: "09 522 2022", tel: "095222022" },
        { label: "North Shore parts", display: "09 887 1863", tel: "098871863" },
      ],
      note: "For used Subaru, call Strong in Onehunga on 0800 634 0065. For used Suzuki, call Suzibits on 09 297 7703.",
    },
    {
      id: "eastern-korean",
      name: "Eastern for Korean",
      priority: 250,
      near: true,
      wrecker: true,
      groups: ["korea"],
      conditions: ["used"],
      makes: ["Hyundai", "Kia", "SsangYong", "Daewoo"],
      summary: "Dismantled parts for Hyundai, Kia, SsangYong, and Daewoo.",
      address: "17 Bairds Road, Otara",
      hours: "",
      email: "easternkorean@xtra.co.nz",
      web: "https://partsconnection.co.nz/branches",
      phones: [{ label: "Otara", display: "09 258 5210", tel: "092585210" }],
      note: "A Parts Connection member, with nationwide delivery.",
    },
    {
      id: "all-china",
      name: "All China",
      priority: 145,
      near: true,
      wrecker: true,
      groups: [],
      conditions: ["used"],
      makes: ["Chery", "Great Wall", "LDV", "Foton", "MG", "Haval"],
      summary: "Used parts for Chery, Great Wall, LDV, and Foton. Same Onehunga yard as the Japanese Parts Connection counters.",
      address: "75 Captain Springs Road, Onehunga",
      hours: "Mon–Fri 8am–5pm, Sat 9am–1pm",
      email: "parts@strongparts.net",
      web: "https://www.allchinaparts.co.nz/",
      phones: [{ label: "Onehunga", display: "09 634 0065", tel: "096340065" }],
      note: "Same phone as Strong for Subaru. Ask for Chinese-brand parts.",
    },
    {
      id: "fhm",
      name: "FHM Automotive",
      priority: 255,
      near: false,
      wrecker: true,
      groups: [],
      conditions: ["used"],
      makes: ["Ford", "Holden", "Mazda BT-50", "D-Max", "Isuzu"],
      summary: "Used Ford and Holden parts, plus Mazda BT-50 and D-Max. West Auckland.",
      address: "15 Old North Road, Kumeu",
      hours: "Mon–Fri 8am–5pm, closed weekends",
      email: "admin@fhmautomotive.co.nz",
      web: "https://www.fhmautomotive.co.nz/",
      phones: [{ label: "Kumeu", display: "09 834 6095", tel: "098346095" }],
      note: "Parts Connection member for Ford and Holden.",
    },
    {
      id: "national-car-parts",
      name: "National Car Parts",
      priority: 265,
      near: true,
      wrecker: true,
      groups: ["euro", "japan"],
      conditions: ["used"],
      makes: ["all makes", "Toyota", "Honda", "Mazda", "Nissan", "Ford", "Holden", "BMW", "Audi", "Subaru"],
      summary: "Used parts for European, Japanese, and Australian cars. Call the parts line before you visit.",
      address: "22 Ormiston Road, Otara",
      hours: "Parts enquiries Mon–Sat",
      email: "parts@ncp.co.nz",
      web: "https://nationalcarparts.co.nz/",
      phones: [
        { label: "Parts", display: "09 579 5152", tel: "095795152" },
        { label: "Selling a car", display: "0800 88 44 55", tel: "0800884455" },
      ],
      note: "Not a self-serve yard. 0800 88 44 55 is for selling a vehicle. Parts phone is 09 579 5152.",
    },
    {
      id: "pickapart",
      name: "Pick a Part",
      priority: 280,
      near: true,
      wrecker: true,
      groups: ["euro", "japan"],
      conditions: ["used"],
      makes: ["self serve", "European", "Japanese", "panels", "cheap parts"],
      summary: "Self-serve yard. European and Japanese cars. Useful for cheap panels and odd bits.",
      address: "Closest yard: 1 Alderman Place, Mangere East",
      hours: "Every day 9am–5pm, last entry 4:45pm",
      web: "https://www.pickapart.co.nz/",
      phones: [],
      note: "No phone orders, no removal service, and no shipping. Entry is about $2. Bring your own tools. Other yards: Avondale, 763 Rosebank Road; Takanini, 15 Rangi Road.",
    },
  ];

  let group = "all";
  let condition = "all";

  function haystack(row) {
    return [
      row.name,
      row.summary,
      row.address,
      row.hours,
      row.note,
      row.email,
      ...(row.makes || []),
      ...(row.phones || []).flatMap((phone) => [phone.label, phone.display, phone.tel]),
    ]
      .join(" ")
      .toLowerCase();
  }

  function matches(row, query) {
    if (group === "wreckers") {
      if (!row.wrecker) return false;
    } else if (group !== "all" && !(row.groups || []).includes(group)) return false;
    if (condition !== "all" && !(row.conditions || []).includes(condition)) return false;
    const q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    return haystack(row).includes(q);
  }

  function tags(row) {
    const items = [];
    if (row.near) items.push({ label: "Near the workshop", kind: "near" });
    if (row.wrecker) items.push({ label: "Wrecker", kind: "used" });
    for (const id of row.groups || []) {
      if (GROUP_LABEL[id]) items.push({ label: GROUP_LABEL[id], kind: "" });
    }
    if ((row.conditions || []).includes("new")) items.push({ label: "New", kind: "" });
    if ((row.conditions || []).includes("used")) items.push({ label: "Used", kind: "used" });
    return items;
  }

  function mapsHref(address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address}, Auckland, New Zealand`)}`;
  }

  function cardHtml(row) {
    const tagHtml = tags(row)
      .map((tag) => `<span class="parts-guide-tag ${tag.kind}">${Admin.escapeHtml(tag.label)}</span>`)
      .join("");
    const phoneHtml = (row.phones || [])
      .map(
        (phone) => `<div class="parts-guide-phone">
          <span>${Admin.escapeHtml(phone.label)}</span>
          <a href="tel:${Admin.escapeAttr(phone.tel)}">${Admin.escapeHtml(phone.display)}</a>
        </div>`
      )
      .join("");
    const email = row.email
      ? `<p class="muted small"><a href="mailto:${Admin.escapeAttr(row.email)}">${Admin.escapeHtml(row.email)}</a></p>`
      : "";
    const hours = row.hours ? `<p class="muted small">${Admin.escapeHtml(row.hours)}</p>` : "";
    const note = row.note ? `<p class="parts-guide-note">${Admin.escapeHtml(row.note)}</p>` : "";
    const address = row.address
      ? `<p class="muted small"><a href="${Admin.escapeAttr(mapsHref(row.address))}" target="_blank" rel="noopener">${Admin.escapeHtml(row.address)}</a></p>`
      : "";
    let site = "Website";
    try {
      site = new URL(row.web).host.replace(/^www\./, "");
    } catch {
      site = "Website";
    }
    const web = row.web
      ? `<p class="muted small"><a href="${Admin.escapeAttr(row.web)}" target="_blank" rel="noopener">${Admin.escapeHtml(site)}</a></p>`
      : "";
    return `<article class="parts-guide-card">
      <div class="parts-guide-tags">${tagHtml}</div>
      <h2>${Admin.escapeHtml(row.name)}</h2>
      <p>${Admin.escapeHtml(row.summary)}</p>
      ${phoneHtml}
      ${address}
      ${hours}
      ${email}
      ${note}
      ${web}
    </article>`;
  }

  function render() {
    const list = document.getElementById("parts-guide-list");
    const count = document.getElementById("parts-guide-count");
    if (!list) return;
    const query = document.getElementById("parts-guide-search")?.value || "";
    const rows = SUPPLIERS.filter((row) => matches(row, query)).sort((a, b) => a.priority - b.priority);
    if (count) count.textContent = `${rows.length} supplier${rows.length === 1 ? "" : "s"}`;
    list.innerHTML = rows.length
      ? rows.map(cardHtml).join("")
      : '<div class="empty">No matching supplier. Change the filter, or search for a make, suburb, or phone number.</div>';
    document.querySelectorAll("[data-parts-group]").forEach((button) => {
      button.classList.toggle("active", button.dataset.partsGroup === group);
    });
    document.querySelectorAll("[data-parts-condition]").forEach((button) => {
      button.classList.toggle("active", button.dataset.partsCondition === condition);
    });
  }

  function show() {
    render();
    document.getElementById("parts-guide-search")?.focus();
  }

  function printRows() {
    const query = document.getElementById("parts-guide-search")?.value || "";
    const rows = SUPPLIERS.filter((row) => matches(row, query)).sort((a, b) => a.priority - b.priority);
    const body = rows
      .map((row) => {
        const phones = (row.phones || []).filter((phone) => phone.display);
        const phoneLines = phones.length
          ? phones
              .map(
                (phone) =>
                  `<tr><td class="label">${Admin.escapeHtml(phone.label || "Phone")}</td><td class="phone">${Admin.escapeHtml(phone.display)}</td></tr>`
              )
              .join("")
          : `<tr><td class="label" colspan="2">No phone — see website / visit in person</td></tr>`;
        return `<section class="supplier">
          <h2>${Admin.escapeHtml(row.name)}</h2>
          <table>${phoneLines}</table>
        </section>`;
      })
      .join("");
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Parts suppliers — names &amp; phones</title>
  <style>
    @page { margin: 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 12px; }
    h1 { font-size: 18pt; margin: 0 0 4px; }
    .meta { font-size: 9pt; color: #444; margin: 0 0 14px; }
    .supplier { break-inside: avoid; margin: 0 0 10px; padding: 0 0 8px; border-bottom: 1px solid #ccc; }
    h2 { font-size: 12pt; margin: 0 0 4px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 2px 0; font-size: 11pt; vertical-align: baseline; }
    td.label { width: 48%; color: #333; }
    td.phone { width: 52%; font-weight: 700; font-size: 12pt; text-align: right; letter-spacing: 0.02em; }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <button class="no-print" type="button" onclick="window.print()" style="margin:0 0 12px;padding:8px 14px;font-size:14px;">Print</button>
  <h1>Deane Auto Repairs — parts supplier phones</h1>
  <p class="meta">${rows.length} supplier${rows.length === 1 ? "" : "s"} · names and phones only · checked 20 Oct 2026</p>
  ${body || "<p>No matching suppliers.</p>"}
  <script>window.addEventListener("load", () => setTimeout(() => window.print(), 250));<\/script>
</body>
</html>`;
    const win = window.open("", "_blank", "noopener,noreferrer,width=720,height=900");
    if (!win) {
      window.alert("Allow pop-ups for this site, then try Print names & phones again.");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  document.getElementById("parts-guide-groups")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-parts-group]");
    if (!button) return;
    group = button.dataset.partsGroup || "all";
    render();
  });

  document.getElementById("parts-guide-conditions")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-parts-condition]");
    if (!button) return;
    condition = button.dataset.partsCondition || "all";
    render();
  });

  document.getElementById("parts-guide-search")?.addEventListener("input", render);
  document.getElementById("btn-parts-guide-print")?.addEventListener("click", printRows);

  window.DeanePartsGuide = { show, suppliers: SUPPLIERS, matches, printRows };
})();
