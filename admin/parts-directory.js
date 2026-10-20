(function () {
  const Admin = window.DeaneAdmin;

  const GROUPS = [
    { id: "all", label: "全部" },
    { id: "trade", label: "日常件" },
    { id: "euro", label: "欧洲车" },
    { id: "japan", label: "日本车" },
    { id: "korea", label: "韩国车" },
  ];

  const CONDITIONS = [
    { id: "all", label: "新件 + 二手" },
    { id: "new", label: "新件" },
    { id: "used", label: "二手" },
  ];

  const GROUP_LABEL = {
    trade: "日常件",
    euro: "欧洲车",
    japan: "日本车",
    korea: "韩国车",
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
      makes: ["所有品牌", "机滤", "刹车片", "火花塞", "皮带", "电瓶", "机油"],
      summary: "日常保养件先打这里。有贸易账号后用 Repco Navigator Pro 查库存和价格。",
      address: "Mt Roskill：82–84 Stoddard Road",
      hours: "Mt Roskill：周一至周六 8am–5pm，周日 9am–5pm",
      web: "https://www.repcotrade.co.nz/",
      phones: [
        { label: "Mt Roskill（离店最近）", display: "09 928 8399", tel: "099288399" },
        { label: "Onehunga 51 Princes St", display: "09 636 1567", tel: "096361567" },
      ],
      note: "Onehunga 店周一至周六开到 5:30pm，周日 9am–5pm。",
    },
    {
      id: "partmaster",
      name: "Partmaster",
      priority: 20,
      near: true,
      groups: ["trade"],
      conditions: ["new"],
      makes: ["所有品牌", "贸易配件"],
      summary: "另一家全品牌贸易配件商。Repco 缺货时打这里。",
      address: "Grey Lynn：135 Great North Road",
      hours: "网站上的贸易时间：周一至周五 7:30am–5:30pm，周六 8am–1pm",
      web: "https://partmaster.kiwi/",
      phones: [
        { label: "Grey Lynn", display: "09 309 0799", tel: "093090799" },
        { label: "Penrose 174 Station Rd", display: "09 526 3939", tel: "095263939" },
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
      makes: ["所有品牌", "贸易配件"],
      summary: "全品牌新件。Penrose 和 Otahuhu 都离店不远。",
      address: "Penrose：3 Sims Road",
      hours: "",
      web: "https://www.napa.co.nz/locations/",
      phones: [
        { label: "Penrose", display: "09 270 5819", tel: "092705819" },
        { label: "Otahuhu 127 Great South Rd", display: "09 276 3852", tel: "092763852" },
        { label: "全国", display: "0800 800 073", tel: "0800800073" },
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
      makes: ["刹车", "离合器", "球头", "轴承", "传动轴", "欧洲车", "日本车"],
      summary: "刹车盘/片、离合器、球头、轴承。欧洲车和日本车都做。",
      address: "Onehunga：55 Church Street",
      hours: "周一至周五 8am–5pm，周六 9am–12pm",
      web: "https://bntnz.co.nz/",
      phones: [
        { label: "Onehunga", display: "09 634 5710", tel: "096345710" },
        { label: "Penrose 47 Walls Rd", display: "09 900 0444", tel: "099000444" },
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
      makes: ["减震", "方向机", "拉杆", "悬挂", "欧洲车", "日本车"],
      summary: "减震、方向机、拉杆。只做转向和悬挂，欧洲车和日本车都能配。",
      address: "Mt Wellington：5/99 Carbine Road",
      hours: "周一至周五 7:30am–5pm，周六 9am–12pm",
      web: "https://autolign.co.nz/",
      phones: [
        { label: "Mt Wellington", display: "09 574 2288", tel: "095742288" },
        { label: "全国", display: "0800 868 900", tel: "0800868900" },
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
      makes: ["欧洲车", "OEM", "副厂", "机滤", "刹车", "皮带", "水箱", "悬挂"],
      summary: "欧洲车新件，原厂配套和副厂机械件。可以特殊空运订货。",
      address: "Auckland 柜台：3 Parkhead Place, Rosedale",
      hours: "周一至周五 8am–5:30pm，周末休息",
      web: "https://www.alleuroparts.co.nz/",
      phones: [
        { label: "Auckland", display: "09 425 5023", tel: "094255023" },
        { label: "全国", display: "0800 255 387", tel: "0800255387" },
      ],
      note: "他们不卖外壳件、玻璃、整个发动机、变速箱，也不卖二手件。",
    },
    {
      id: "europart",
      name: "EuroPart（European Auto Spares）",
      priority: 70,
      near: false,
      groups: ["euro"],
      conditions: ["new", "used"],
      makes: ["BMW", "宝马", "Audi", "奥迪", "Mercedes", "奔驰", "MINI", "VW", "大众", "Bosch", "Febi", "Mahle"],
      summary: "宝马、奥迪、奔驰、MINI、大众。新件和二手都有，南区可以自取。",
      address: "8 Ryan Place, Manukau",
      hours: "周一至周五 8am–5pm",
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
      groups: ["euro"],
      conditions: ["new", "used"],
      makes: ["BMW", "宝马", "Mercedes", "奔驰", "Porsche", "保时捷", "Maserati", "玛莎拉蒂"],
      summary: "宝马、奔驰、保时捷、玛莎拉蒂。新件和拆车件都有，车间和保险公司常用。",
      address: "8 Moa Street, Otahuhu",
      hours: "周一至周五 8am–5pm",
      web: "https://euro1.co.nz/",
      phones: [{ label: "Otahuhu", display: "09 270 3611", tel: "092703611" }],
      note: "新件一般 12 个月保修。机械和电器二手件一般 90 天。有 Capricorn 账号可以报给他们。打电话带车牌、年份、车型或底盘号。",
    },
    {
      id: "aaa",
      name: "AAA Autocentre",
      priority: 90,
      near: true,
      groups: ["euro"],
      conditions: ["used"],
      makes: ["Audi", "奥迪", "VW", "大众", "Skoda", "斯柯达", "Volvo", "沃尔沃", "Renault", "雷诺", "Peugeot", "标致", "Seat", "Maserati"],
      summary: "大众、奥迪、斯柯达、沃尔沃、雷诺、标致的二手件。离店很近。",
      address: "360B Neilson Street, Onehunga",
      hours: "周一至周五 9am–5pm",
      email: "partsenquiry@aautocentre.co.nz",
      web: "https://www.aautocentre.co.nz/",
      phones: [
        { label: "Onehunga", display: "09 633 4466", tel: "096334466" },
        { label: "短信", display: "027 496 6856", tel: "0274966856" },
      ],
      note: "先打电话或发短信，不要直接去场地等。邮件里写车牌。全国可送。",
    },
    {
      id: "euroline",
      name: "Euroline",
      priority: 100,
      near: false,
      groups: ["euro"],
      conditions: ["new", "used"],
      makes: ["Audi", "奥迪", "VW", "大众", "Skoda", "斯柯达", "Peugeot", "标致"],
      summary: "奥迪、大众、斯柯达、标致。1997 年起做新件和拆车件，全国送货。",
      address: "60 Firth Street, Drury",
      hours: "周一至周五 8am–5pm，周六 9am–12pm 要预约",
      email: "info@euroline.co.nz",
      web: "https://partsconnection.co.nz/branches/euroline-",
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
      makes: ["Audi", "奥迪", "原厂"],
      summary: "奥迪原厂新件。Grey Lynn 零件部，比北岸经销商近。",
      address: "150 Great North Road, Grey Lynn",
      hours: "周六 8am–12pm。平日营业时间先打电话确认。",
      email: "parts@giltrapaudi.co.nz",
      web: "https://www.giltrap.com/dealer/audi-grey-lynn/about",
      phones: [{ label: "零件部", display: "09 336 5255", tel: "093365255" }],
      note: "",
    },
    {
      id: "continental",
      name: "Continental Cars 原厂零件",
      priority: 120,
      near: false,
      groups: ["euro"],
      conditions: ["new"],
      makes: ["BMW", "宝马", "MINI", "Audi", "奥迪", "VW", "大众", "Volkswagen", "Porsche", "保时捷", "原厂"],
      summary: "宝马、MINI、奥迪、大众、保时捷的原厂新件。",
      address: "零件仓：11 Mauranui Avenue, Newmarket",
      hours: "Newmarket 零件仓：周一至周五 8am–5pm",
      email: "parts@continentalcars.co.nz",
      web: "https://www.continentalcars.co.nz/contact-us/continental-cars-parts-centre/",
      phones: [
        { label: "宝马 / MINI（Wairau）", display: "09 488 2000", tel: "094882000" },
        { label: "奥迪 Newmarket", display: "09 526 6940", tel: "095266940" },
        { label: "大众", display: "09 526 6968", tel: "095266968" },
        { label: "保时捷", display: "09 526 8991", tel: "095268991" },
        { label: "Newmarket 零件仓", display: "09 526 6943", tel: "095266943" },
      ],
      note: "宝马零件在 45–65 Wairau Road。奥迪如果要近一点，也可以打 Giltrap Grey Lynn。",
    },
    {
      id: "mercedes",
      name: "Mercedes-Benz Auckland",
      priority: 130,
      near: false,
      groups: ["euro"],
      conditions: ["new"],
      makes: ["Mercedes", "奔驰", "原厂"],
      summary: "奔驰原厂新件。Newmarket 有单独的零件电话。",
      address: "2 Great South Road, Newmarket",
      hours: "经销商周一至周五大约 7:30am–6pm",
      email: "parts@mbauckland.co.nz",
      web: "https://www.mercedesbenzvans.co.nz/locate-us/mercedes-benz-auckland/",
      phones: [
        { label: "Newmarket 零件", display: "09 529 3873", tel: "095293873" },
        { label: "北岸（总机）", display: "09 443 3808", tel: "094433808" },
      ],
      note: "二手奔驰件打 Euro1。",
    },
    {
      id: "strong-onehunga",
      name: "Parts Connection · Onehunga",
      priority: 140,
      near: true,
      groups: ["japan"],
      conditions: ["new", "used"],
      makes: [
        "Nissan",
        "日产",
        "Mazda",
        "马自达",
        "Suzuki",
        "铃木",
        "Honda",
        "本田",
        "Subaru",
        "斯巴鲁",
        "Isuzu",
        "五十铃",
        "Nisbits",
        "Mazbits",
        "Suzibits",
      ],
      summary: "日本车二手先打这一栋。斯巴鲁这里也有新件。日产、马自达、铃木、本田、斯巴鲁、五十铃分机不同，地址相同。",
      address: "75 Captain Springs Road, Onehunga",
      hours: "按各品牌柜台，平日营业。全国送货。",
      email: "parts@strongparts.net",
      web: "https://partsconnection.co.nz/branches",
      phones: [
        { label: "日产 Nisbits", display: "09 297 7703", tel: "092977703" },
        { label: "日产免费电话", display: "0800 166 666", tel: "0800166666" },
        { label: "马自达 Mazbits", display: "09 297 7703", tel: "092977703" },
        { label: "铃木 Suzibits", display: "09 297 7703", tel: "092977703" },
        { label: "本田 Strong", display: "09 634 2914", tel: "096342914" },
        { label: "斯巴鲁 Strong", display: "09 634 0065", tel: "096340065" },
        { label: "斯巴鲁免费电话", display: "0800 634 0065", tel: "08006340065" },
        { label: "五十铃", display: "09 622 2072", tel: "096222072" },
      ],
      note: "斯巴鲁这里新件和二手都有，并经常从日本进货。名爵、哈弗、LDV 等中国品牌也打 09 634 0065。",
    },
    {
      id: "ajcpc",
      name: "Auckland Japanese Car Parts Centre",
      priority: 150,
      near: true,
      groups: ["japan", "euro"],
      conditions: ["used"],
      makes: ["丰田", "Toyota", "日产", "本田", "马自达", "三菱", "斯巴鲁", "铃木", "外壳", "门", "灯", "保险杠", "Audi", "BMW", "VW", "Peugeot"],
      summary: "日本车外壳件：门、叶子板、灯、保险杠、尾门。也有部分奥迪、宝马、标致、大众外壳。",
      address: "322–324 Church Street, Onehunga",
      hours: "周一至周五 8am–4:30pm",
      email: "sales@ajcpc.co.nz",
      web: "https://aucklandjapanesecarpartscentre.co.nz/",
      phones: [
        { label: "Onehunga", display: "09 634 5546", tel: "096345546" },
        { label: "免费电话", display: "0800 80 5546", tel: "0800805546" },
      ],
      note: "1982 年起做拆车外壳。全国送货。",
    },
    {
      id: "toyotaz",
      name: "Toyotaz Galore",
      priority: 160,
      near: false,
      groups: ["japan"],
      conditions: ["used"],
      makes: ["Toyota", "丰田", "海拉克斯", "普拉多"],
      summary: "丰田二手件，1992 年起。轿车、面包、皮卡、四驱都做。",
      address: "118a Sunnybrae Road, Glenfield",
      hours: "周一至周五 8am–5pm",
      email: "sales@toyotaspares.co.nz",
      web: "https://www.toyotaspares.co.nz/",
      phones: [{ label: "Glenfield", display: "09 444 8095", tel: "094448095" }],
      note: "丰田原厂新件打 Auckland City Toyota，不要打这里。",
    },
    {
      id: "mitsi",
      name: "Mitsi Galore",
      priority: 170,
      near: false,
      groups: ["japan"],
      conditions: ["new", "used"],
      makes: ["Mitsubishi", "三菱", "Lancer", "Pajero", "Outlander", "Delica"],
      summary: "三菱拆车件，新西兰最大的三菱拆车商之一。也有一部分原厂和新副厂件。",
      address: "Parts Connection 现写：118a Sunnybrae Road, Glenfield",
      hours: "周一至周五 8am–5pm",
      email: "sales@mitsigalore.co.nz",
      web: "https://partsconnection.co.nz/branches/mitsi-galore",
      phones: [{ label: "三菱", display: "09 269 0255", tel: "092690255" }],
      note: "开车去之前先打电话。旧资料是 Takanini 21B Spartan Road，现在官网写 Glenfield，和丰田二手同一地址。Capricorn 供应商。三菱原厂新件打 Manukau Autos。",
    },
    {
      id: "dodson",
      name: "Dodson's Autospares",
      priority: 180,
      near: false,
      groups: ["japan", "euro"],
      conditions: ["new", "used"],
      makes: ["Toyota", "Nissan", "Honda", "Mazda", "Subaru", "Suzuki", "Mitsubishi", "Lexus", "雷克萨斯", "VW", "Audi", "BMW", "Volvo"],
      summary: "日本车新件和二手都有，也覆盖一部分大众、奥迪、宝马、沃尔沃。",
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
      makes: ["Toyota", "丰田", "原厂", "Lexus", "雷克萨斯"],
      summary: "丰田原厂新件。Greenlane 和 Mt Wellington 离店最近。电话是经销商总机，进门说零件部。",
      address: "Greenlane：233 Great South Road",
      hours: "",
      web: "https://www.armstrongs.co.nz/",
      phones: [
        { label: "Greenlane", display: "09 601 9000", tel: "096019000" },
        { label: "Mt Wellington 8 Forge Way", display: "09 360 6726", tel: "093606726" },
        { label: "Grey Lynn 49 Great North Rd", display: "09 378 9919", tel: "093789919" },
      ],
      note: "雷克萨斯原厂件也可以先问丰田零件部。二手丰田打 Toyotaz Galore。",
    },
    {
      id: "honda-dealer",
      name: "Honda 零件配送中心",
      priority: 200,
      near: false,
      groups: ["japan"],
      conditions: ["new"],
      makes: ["Honda", "本田", "原厂"],
      summary: "本田原厂新件，给车间和代理发货。东区有全国零件仓。",
      address: "51 Business Parade South, East Tamaki",
      hours: "周一至周五 8am–5pm",
      email: "parts@honda.co.nz",
      web: "https://www.honda.co.nz/find-a-store/auckland/honda-parts-distribution-centre/",
      phones: [
        { label: "零件仓", display: "0800 377 374", tel: "0800377374" },
        { label: "Newmarket 店", display: "09 890 9030", tel: "098909030" },
      ],
      note: "本田二手件打 Onehunga Strong，09 634 2914。",
    },
    {
      id: "mazda-dealer",
      name: "John Andrew Mazda",
      priority: 210,
      near: true,
      groups: ["japan"],
      conditions: ["new"],
      makes: ["Mazda", "马自达", "原厂"],
      summary: "马自达原厂新件。Penrose 零件部离店近。",
      address: "Penrose：23 Greenpark Road",
      hours: "周一至周五 7:30am–5pm",
      web: "https://www.johnandrewmazda.co.nz/parts",
      phones: [
        { label: "Penrose 零件", display: "09 571 3024", tel: "095713024" },
        { label: "Grey Lynn", display: "0800 526 2932", tel: "08005262932" },
      ],
      note: "马自达二手打 Onehunga Mazbits，09 297 7703。",
    },
    {
      id: "nissan-dealer",
      name: "Armstrong's Nissan East Auckland",
      priority: 220,
      near: false,
      groups: ["japan"],
      conditions: ["new"],
      makes: ["Nissan", "日产", "原厂"],
      summary: "日产原厂新件。这是 Botany 经销商总机，进门说零件部。",
      address: "277 Ti Rakau Drive, Botany",
      hours: "",
      web: "https://www.armstrongs.co.nz/",
      phones: [{ label: "Botany", display: "09 272 8000", tel: "092728000" }],
      note: "日产二手离店更近：Onehunga Nisbits，09 297 7703。",
    },
    {
      id: "mitsubishi-dealer",
      name: "Manukau Autos · Mitsubishi",
      priority: 230,
      near: false,
      groups: ["japan"],
      conditions: ["new"],
      makes: ["Mitsubishi", "三菱", "原厂"],
      summary: "三菱原厂新件，南区经销商。",
      address: "1 Bakerfield Place, Manukau",
      hours: "经销商周一至周五 8am–5pm",
      web: "https://manukauautos.co.nz/service/parts/",
      phones: [{ label: "Manukau", display: "0508 99 66 33", tel: "0508996633" }],
      note: "三菱二手打 Mitsi Galore，09 269 0255。",
    },
    {
      id: "winger",
      name: "Winger 零件",
      priority: 240,
      near: true,
      groups: ["japan"],
      conditions: ["new"],
      makes: ["Subaru", "斯巴鲁", "Suzuki", "铃木", "原厂"],
      summary: "斯巴鲁、铃木原厂新件。Greenlane 的零件电话离店更近。",
      address: "北岸零件中心：75 Wairau Road",
      hours: "北岸：周一至周五 8am–5pm，周六 9am–12pm",
      web: "https://winger.co.nz/locations/department/parts/",
      phones: [
        { label: "Greenlane 零件", display: "09 522 2022", tel: "095222022" },
        { label: "北岸零件", display: "09 887 1863", tel: "098871863" },
      ],
      note: "斯巴鲁二手打 Onehunga Strong，0800 634 0065。铃木二手打 Suzibits，09 297 7703。",
    },
    {
      id: "eastern-korean",
      name: "Eastern for Korean",
      priority: 250,
      near: true,
      groups: ["korea"],
      conditions: ["used"],
      makes: ["Hyundai", "现代", "Kia", "起亚", "SsangYong", "Daewoo"],
      summary: "现代、起亚、双龙、大宇的拆车件。",
      address: "17 Bairds Road, Otara",
      hours: "",
      email: "easternkorean@xtra.co.nz",
      web: "https://partsconnection.co.nz/branches",
      phones: [{ label: "Otara", display: "09 258 5210", tel: "092585210" }],
      note: "Parts Connection 成员，全国送货。",
    },
    {
      id: "pickapart",
      name: "Pick a Part",
      priority: 260,
      near: true,
      groups: ["euro", "japan"],
      conditions: ["used"],
      makes: ["自拆", "欧洲车", "日本车", "外壳", "便宜件"],
      summary: "自拆场。欧洲车和日本车都有，适合便宜的外壳和杂件。",
      address: "最近：1 Alderman Place, Mangere East",
      hours: "每天 9am–5pm，最晚 4:45pm 进场",
      web: "https://www.pickapart.co.nz/",
      phones: [],
      note: "没有订件电话，不代拆，不邮寄。进场约 $2，自带工具。另外两处：Avondale 763 Rosebank Road；Takanini 15 Rangi Road。",
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
    if (group !== "all" && !(row.groups || []).includes(group)) return false;
    if (condition !== "all" && !(row.conditions || []).includes(condition)) return false;
    const q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    return haystack(row).includes(q);
  }

  function tags(row) {
    const items = [];
    if (row.near) items.push({ label: "离店近", kind: "near" });
    for (const id of row.groups || []) {
      if (GROUP_LABEL[id]) items.push({ label: GROUP_LABEL[id], kind: "" });
    }
    if ((row.conditions || []).includes("new")) items.push({ label: "新件", kind: "" });
    if ((row.conditions || []).includes("used")) items.push({ label: "二手", kind: "used" });
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
    const web = row.web
      ? `<p class="muted small"><a href="${Admin.escapeAttr(row.web)}" target="_blank" rel="noopener">网站</a></p>`
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
    if (count) count.textContent = `${rows.length} 家`;
    list.innerHTML = rows.length
      ? rows.map(cardHtml).join("")
      : '<div class="empty">没有匹配的配件商。换个筛选，或搜品牌、地名、电话。</div>';
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

  window.DeanePartsGuide = { show, suppliers: SUPPLIERS, matches };
})();
