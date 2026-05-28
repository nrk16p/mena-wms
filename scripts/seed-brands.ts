/**
 * Seed BRAND code dictionary for mixer trucks and trailer trucks
 * Run: MONGO_URI=... npx tsx scripts/seed-brands.ts
 */

import { MongoClient } from "mongodb"

const URI = process.env.MONGO_URI ?? ""
const DB  = process.env.MONGO_DB  ?? "master_data"
if (!URI) throw new Error("Set MONGO_URI env var")

const BRANDS: { code: string; th: string; en: string; category: string }[] = [
  // ===== Truck Chassis — Mixer =====
  { code: "ISUZU",        th: "อีซูซุ",               en: "Isuzu",            category: "chassis" },
  { code: "HINO",         th: "ฮีโน่",                en: "Hino",             category: "chassis" },
  { code: "SANY",         th: "ซานี่",                en: "Sany",             category: "chassis" },
  { code: "ZOOMLION",     th: "ซูมไลออน",             en: "Zoomlion",         category: "chassis" },
  { code: "SCHWING",      th: "ชวิง สเตทเทอร์",       en: "Schwing Stetter",  category: "chassis" },

  // ===== Truck Chassis — Tractor Head / Trailer =====
  { code: "VOLVO",        th: "โวลโว่",               en: "Volvo",            category: "chassis" },
  { code: "SCANIA",       th: "สแกเนีย",              en: "Scania",           category: "chassis" },
  { code: "MAN",          th: "แมน",                  en: "MAN",              category: "chassis" },
  { code: "BENZ",         th: "เมอร์เซเดส-เบนซ์",    en: "Mercedes-Benz",    category: "chassis" },
  { code: "FUSO",         th: "มิตซูบิชิ ฟูโซ่",     en: "Mitsubishi Fuso",  category: "chassis" },
  { code: "UD",           th: "ยูดี ทรัคส์",          en: "UD Trucks",        category: "chassis" },
  { code: "DAF",          th: "แดฟ",                  en: "DAF",              category: "chassis" },
  { code: "IVECO",        th: "อีวีโก้",              en: "Iveco",            category: "chassis" },

  // ===== Filters =====
  { code: "DENSO",        th: "เดนโซ่",               en: "Denso",            category: "filter" },
  { code: "SAKURA",       th: "ซากุระ",               en: "Sakura",           category: "filter" },
  { code: "MANN",         th: "แมนน์",                en: "Mann",             category: "filter" },
  { code: "FLEETGUARD",   th: "ฟลีทการ์ด",            en: "Fleetguard",       category: "filter" },
  { code: "DONALDSON",    th: "โดนัลด์สัน",           en: "Donaldson",        category: "filter" },
  { code: "MAHLE",        th: "มาห์เล่",              en: "Mahle",            category: "filter" },
  { code: "HENGST",       th: "เฮงสต์",               en: "Hengst",           category: "filter" },
  { code: "BOSCH",        th: "บ๊อช",                 en: "Bosch",            category: "electrical" },

  // ===== Brakes & Air Systems =====
  { code: "WABCO",        th: "วาบโก้",               en: "Wabco",            category: "brake" },
  { code: "KNORR",        th: "นอร์-เบรมเซ่",         en: "Knorr-Bremse",     category: "brake" },
  { code: "MERITOR",      th: "เมอร์ริเตอร์",         en: "Meritor",          category: "brake" },
  { code: "HALDEX",       th: "ฮัลเด็กซ์",            en: "Haldex",           category: "brake" },
  { code: "BREMBO",       th: "เบรมโบ้",              en: "Brembo",           category: "brake" },
  { code: "FERODO",       th: "เฟอโรโด้",             en: "Ferodo",           category: "brake" },
  { code: "TMX",          th: "ทีเอ็มเอ็กซ์",        en: "TMX",              category: "brake" },
  { code: "NISSHINBO",    th: "นิสชินโบ้",            en: "Nisshinbo",        category: "brake" },
  { code: "ATE",          th: "เอทีอี",               en: "ATE",              category: "brake" },

  // ===== Bearings =====
  { code: "SKF",          th: "เอสเคเอฟ",             en: "SKF",              category: "bearing" },
  { code: "FAG",          th: "แฟ็ก",                 en: "FAG",              category: "bearing" },
  { code: "TIMKEN",       th: "ทิมเคน",               en: "Timken",           category: "bearing" },
  { code: "NSK",          th: "เอ็นเอสเค",            en: "NSK",              category: "bearing" },
  { code: "NTN",          th: "เอ็นทีเอ็น",           en: "NTN",              category: "bearing" },
  { code: "KOYO",         th: "โคโย่",                en: "Koyo",             category: "bearing" },
  { code: "NACHI",        th: "นาชิ",                 en: "Nachi",            category: "bearing" },

  // ===== Transmission / Clutch =====
  { code: "ZF",           th: "แซดเอฟ",               en: "ZF",               category: "transmission" },
  { code: "EATON",        th: "อีตัน",                en: "Eaton",            category: "transmission" },
  { code: "VALEO",        th: "วาลีโอ",               en: "Valeo",            category: "clutch" },
  { code: "LUK",          th: "ลุก",                  en: "LUK",              category: "clutch" },
  { code: "SACHS",        th: "ซัคส์",                en: "Sachs",            category: "clutch" },
  { code: "EXEDY",        th: "เอ็กเซดี้",            en: "Exedy",            category: "clutch" },

  // ===== Suspension / Shock =====
  { code: "KYB",          th: "เควายบี",              en: "KYB (Kayaba)",     category: "suspension" },
  { code: "MONROE",       th: "มอนโร",                en: "Monroe",           category: "suspension" },
  { code: "GABRIEL",      th: "กาเบรียล",             en: "Gabriel",          category: "suspension" },
  { code: "HENDRICKSON",  th: "เฮนดริกสัน",           en: "Hendrickson",      category: "suspension" },
  { code: "SAF_HOLLAND",  th: "แซฟ-ฮอลแลนด์",        en: "SAF-Holland",      category: "suspension" },

  // ===== Electrical =====
  { code: "NGK",          th: "เอ็นจีเค",             en: "NGK",              category: "electrical" },
  { code: "CHAMPION",     th: "แชมเปี้ยน",            en: "Champion",         category: "electrical" },
  { code: "LUCAS",        th: "ลูคัส",                en: "Lucas",            category: "electrical" },
  { code: "DELCO",        th: "เดลโก้",               en: "Delco Remy",       category: "electrical" },

  // ===== Batteries =====
  { code: "YUASA",        th: "ยัวซ่า",               en: "Yuasa",            category: "battery" },
  { code: "EXIDE",        th: "เอ็กไซด์",             en: "Exide",            category: "battery" },
  { code: "GS",           th: "จีเอส",                en: "GS Battery",       category: "battery" },
  { code: "AMARON",       th: "อามารอน",              en: "Amaron",           category: "battery" },
  { code: "PANASONIC",    th: "พานาโซนิค",            en: "Panasonic",        category: "battery" },

  // ===== Tires =====
  { code: "MICHELIN",     th: "มิชลิน",               en: "Michelin",         category: "tire" },
  { code: "BRIDGESTONE",  th: "บริดจสโตน",            en: "Bridgestone",      category: "tire" },
  { code: "GOODYEAR",     th: "กู๊ดเยียร์",           en: "Goodyear",         category: "tire" },
  { code: "CONTINENTAL",  th: "คอนติเนนตัล",          en: "Continental",      category: "tire" },
  { code: "YOKOHAMA",     th: "โยโกฮาม่า",            en: "Yokohama",         category: "tire" },
  { code: "DUNLOP",       th: "ดันลอป",               en: "Dunlop",           category: "tire" },
  { code: "PIRELLI",      th: "พิเรลลี่",             en: "Pirelli",          category: "tire" },
  { code: "MAXXIS",       th: "แม็กซิส",              en: "Maxxis",           category: "tire" },
  { code: "TRIANGLE",     th: "ไทรแองเกิล",           en: "Triangle",         category: "tire" },
  { code: "TORQUE",       th: "ทอร์ก",                en: "Torque",           category: "tire" },

  // ===== Lubricants =====
  { code: "SHELL",        th: "เชลล์",                en: "Shell",            category: "lubricant" },
  { code: "TOTAL",        th: "โตตาล",                en: "Total",            category: "lubricant" },
  { code: "MOBIL",        th: "โมบิล",                en: "Mobil",            category: "lubricant" },
  { code: "CASTROL",      th: "คาสทรอล",              en: "Castrol",          category: "lubricant" },
  { code: "CALTEX",       th: "คาลเท็กซ์",            en: "Caltex",           category: "lubricant" },
  { code: "GULF",         th: "กัลฟ์",                en: "Gulf",             category: "lubricant" },

  // ===== Belts / Hoses =====
  { code: "GATES",        th: "เกทส์",                en: "Gates",            category: "belt" },
  { code: "DAYCO",        th: "เดย์โก้",              en: "Dayco",            category: "belt" },
  { code: "BANDO",        th: "บันโด",                en: "Bando",            category: "belt" },

  // ===== Seals / Gaskets =====
  { code: "NOK",          th: "นอค",                  en: "NOK",              category: "seal" },
  { code: "CORTECO",      th: "คอร์เตโก้",            en: "Corteco",          category: "seal" },
  { code: "REINZ",        th: "ไรนซ์",                en: "Victor Reinz",     category: "seal" },
  { code: "ELRING",       th: "เอลริง",               en: "Elring",           category: "seal" },

  // ===== Hydraulics =====
  { code: "PARKER",       th: "ปาร์คเกอร์",           en: "Parker",           category: "hydraulic" },
  { code: "BOSCH_REX",    th: "บ๊อช เร็กโซธ",        en: "Bosch Rexroth",    category: "hydraulic" },

  // ===== Driveline / Axle =====
  { code: "DANA",         th: "ดาน่า",                en: "Dana",             category: "driveline" },
  { code: "TRW",          th: "ทีอาร์ดับเบิ้ลยู",    en: "TRW",              category: "steering" },
]

async function seedBrands() {
  const client = new MongoClient(URI)
  await client.connect()
  const col = client.db(DB).collection("master_codes")

  let upserted = 0, skipped = 0

  for (let i = 0; i < BRANDS.length; i++) {
    const b   = BRANDS[i]
    const _id = `BRAND:${b.code}`

    await col.updateOne(
      { _id: _id as unknown as string },
      {
        $setOnInsert: {
          _id,
          dict:   "BRAND",
          code:   b.code,
          th:     b.th,
          en:     b.en,
          parent: null,
          order:  i,
          meta:   { category: b.category },
        },
      },
      { upsert: true }
    )
    upserted++
  }

  console.log(`✅ Done: ${upserted} brands processed (${skipped} skipped)`)
  await client.close()
}

seedBrands().catch(console.error)
