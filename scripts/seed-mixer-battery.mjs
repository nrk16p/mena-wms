import { MongoClient } from "mongodb"

const URI  = "mongodb+srv://adminbew:K879w5XpBm3QL046@mn-mongodb-ops-2c8032e6.mongo.ondigitalocean.com/terminus?authSource=admin"
const DB   = "master_data"
const COLL = "master_sku"

function buildSku(wh, type, l1, l2, l3, seq) {
  const parts = l3 ? [wh, type, l1, l2, l3] : [wh, type, l1, l2]
  return `${parts.join("-")}-${String(seq).padStart(4, "0")}`
}

const MIXER_DATA = [
  { nameTh: "ซีลโม่ผสมคอนกรีต",           nameEn: "Mixer Drum Seal Kit",           partNo: "SK-MX-3812-A",    l1: "MXS", l2: "SLD", l3: "", price: 3200, unit: "SET", brand: "NOK",           vehicle: "Mixer Truck" },
  { nameTh: "ลูกกลิ้งรับโม่ผสม",           nameEn: "Drum Support Roller",           partNo: "RLR-450-MX",      l1: "MXS", l2: "RLR", l3: "", price: 4800, unit: "PC",  brand: "Generic",        vehicle: "Mixer Truck" },
  { nameTh: "ปั๊มไฮดรอลิกขับโม่",          nameEn: "Hydraulic Drive Pump",          partNo: "HP-705-KYB",      l1: "MXS", l2: "HYD", l3: "", price: 28500, unit: "PC", brand: "KYB",            vehicle: "Mixer Truck" },
  { nameTh: "สายไฮดรอลิกความดันสูง",       nameEn: "High Pressure Hydraulic Hose",  partNo: "HH-3/4-600",      l1: "MXS", l2: "HYD", l3: "", price: 1850, unit: "PC",  brand: "Parker",         vehicle: "Mixer Truck" },
  { nameTh: "ชุดเกียร์ทดขับโม่",           nameEn: "Mixer Reduction Gearbox",       partNo: "GBX-MX-2200",     l1: "MXS", l2: "GBX", l3: "", price: 62000, unit: "PC", brand: "Sauer-Danfoss",  vehicle: "Mixer Truck" },
  { nameTh: "รางเทคอนกรีต (ชุด)",          nameEn: "Concrete Discharge Chute Set",  partNo: "CHT-SET-MX",      l1: "MXS", l2: "CHT", l3: "", price: 7500, unit: "SET", brand: "Generic",        vehicle: "Mixer Truck" },
  { nameTh: "ไส้กรองน้ำมันไฮดรอลิก",      nameEn: "Hydraulic Oil Filter",          partNo: "HF-35011",        l1: "MXS", l2: "HYD", l3: "", price: 650,  unit: "PC",  brand: "Fleetguard",     vehicle: "Mixer Truck" },
  { nameTh: "ถังน้ำล้างโม่",               nameEn: "Drum Wash Water Tank",          partNo: "WT-200L-MX",      l1: "MXS", l2: "WTR", l3: "", price: 5200, unit: "PC",  brand: "Generic",        vehicle: "Mixer Truck" },
  { nameTh: "ไส้กรองน้ำมันเครื่อง",        nameEn: "Engine Oil Filter",             partNo: "EF-26320-35503",  l1: "ENG", l2: "OIL", l3: "", price: 350,  unit: "PC",  brand: "Genuine",        vehicle: "Mixer Truck" },
  { nameTh: "ไส้กรองอากาศ",               nameEn: "Air Filter Element",            partNo: "AF-17801-2880",   l1: "ENG", l2: "OIL", l3: "", price: 720,  unit: "PC",  brand: "Genuine",        vehicle: "Mixer Truck" },
  { nameTh: "ปั๊มน้ำหล่อเย็น",             nameEn: "Water Pump Assembly",           partNo: "WP-16100-78220",  l1: "COL", l2: "WPP", l3: "", price: 3500, unit: "PC",  brand: "Aisin",          vehicle: "Mixer Truck" },
  { nameTh: "แผ่นคลัทช์ PTO",             nameEn: "PTO Clutch Disc",               partNo: "PTO-CD-220",      l1: "PTO", l2: "CLT", l3: "", price: 8900, unit: "PC",  brand: "Generic",        vehicle: "Mixer Truck" },
]

const BATTERY_DATA = [
  { nameTh: "แบตเตอรี่รถ 12V 200Ah DIN200",        nameEn: "Truck Battery 12V 200Ah",          partNo: "BAT-DIN200-MF",  l1: "ELC", l2: "BAT", l3: "", price: 4800, unit: "PC",  brand: "Yuasa",   vehicle: "Mixer Truck" },
  { nameTh: "แบตเตอรี่รถ 12V 150Ah DIN150",        nameEn: "Truck Battery 12V 150Ah",          partNo: "BAT-DIN150-MF",  l1: "ELC", l2: "BAT", l3: "", price: 3600, unit: "PC",  brand: "Yuasa",   vehicle: "Light Truck" },
  { nameTh: "แบตเตอรี่รถ 12V 100Ah DIN100",        nameEn: "Truck Battery 12V 100Ah",          partNo: "BAT-DIN100-MF",  l1: "ELC", l2: "BAT", l3: "", price: 2800, unit: "PC",  brand: "GS Yuasa", vehicle: "Pickup" },
  { nameTh: "แบตเตอรี่รถ 24V 200Ah (คู่)",         nameEn: "24V Battery Set (2×12V)",          partNo: "BAT-24V-200-SET", l1: "ELC", l2: "BAT", l3: "", price: 9600, unit: "SET", brand: "Yuasa",   vehicle: "Heavy Truck" },
  { nameTh: "ขั้วแบตเตอรี่ขั้วบวก",                nameEn: "Battery Terminal Positive (+)",    partNo: "BT-POS-M8",      l1: "ELC", l2: "BAT", l3: "", price: 85,   unit: "PC",  brand: "Generic", vehicle: "All" },
  { nameTh: "ขั้วแบตเตอรี่ขั้วลบ",                 nameEn: "Battery Terminal Negative (−)",   partNo: "BT-NEG-M8",      l1: "ELC", l2: "BAT", l3: "", price: 85,   unit: "PC",  brand: "Generic", vehicle: "All" },
  { nameTh: "สายแบตเตอรี่ขั้วบวก 70 sq",           nameEn: "Battery Cable Positive 70mm²",    partNo: "BC-POS-70-120",  l1: "ELC", l2: "CAB", l3: "", price: 320,  unit: "PC",  brand: "Generic", vehicle: "Heavy Truck" },
  { nameTh: "สายแบตเตอรี่ขั้วลบ 70 sq",            nameEn: "Battery Cable Negative 70mm²",    partNo: "BC-NEG-70-120",  l1: "ELC", l2: "CAB", l3: "", price: 320,  unit: "PC",  brand: "Generic", vehicle: "Heavy Truck" },
  { nameTh: "ถาดยึดแบตเตอรี่สแตนเลส",              nameEn: "Stainless Battery Tray & Bracket", partNo: "BH-SS-MX-01",    l1: "ELC", l2: "BAT", l3: "", price: 1200, unit: "SET", brand: "Generic", vehicle: "Mixer Truck" },
  { nameTh: "ที่ตัดกระแสไฟฟ้า (Battery Cut-off)",  nameEn: "Battery Isolator Switch",          partNo: "BIS-400A",       l1: "ELC", l2: "SAF", l3: "", price: 950,  unit: "PC",  brand: "Hella",   vehicle: "All" },
]

async function main() {
  const client = new MongoClient(URI)
  await client.connect()
  const col = client.db(DB).collection(COLL)

  const allRows = [
    ...MIXER_DATA.map(r => ({ ...r, wh: "LK", type: "PRT" })),
    ...BATTERY_DATA.map(r => ({ ...r, wh: "LK", type: "PRT" })),
  ]

  let inserted = 0
  let skipped  = 0

  for (const row of allRows) {
    const { wh, type, l1, l2, l3, nameTh, nameEn, partNo, price, unit, brand, vehicle } = row

    // Check if an identical part number already exists
    const existing = await col.findOne({ "เบอร์อะไหล่": partNo })
    if (existing) {
      console.log(`  SKIP (exists): ${partNo} → ${existing.SKU}`)
      skipped++
      continue
    }

    // Find next sequence for this prefix
    const prefix = l3
      ? `${wh}-${type}-${l1}-${l2}-${l3}-`
      : `${wh}-${type}-${l1}-${l2}-`

    const last = await col
      .find({ SKU: { $regex: `^${prefix.replace(/\//g, "\\/")}` } })
      .sort({ SKU: -1 })
      .limit(1)
      .toArray()

    const seq = last.length > 0
      ? parseInt(last[0].SKU.split("-").pop() ?? "0") + 1
      : 1

    const sku = buildSku(wh, type, l1, l2, l3, seq)

    const doc = {
      SKU:               sku,
      status:            "approved",
      createdBy:         "seed-script",
      createdByName:     "Seed Script",
      คลังสินค้า:        wh,
      ประเภทค่าใช้จ่าย: type,
      ชื่ออะไหล่_TH:    nameTh,
      Part_Name_EN:      nameEn,
      เบอร์อะไหล่:       partNo,
      ระบบ_L1:           l1,
      ชุดประกอบ_L2:      l2,
      ชิ้นส่วน_L3:       l3,
      ตำแหน่ง:           ["GN"],
      ราคาต่อหน่วย:      price,
      หน่วย:             unit,
      ยี่ห้อ:            brand,
      เบอร์แท้อ้างอิง:   "",
      เบอร์เทียบอ้างอิง: [],
      ทะเบียนหรือรุ่นรถ: [vehicle],
      Grade:             "OEM",
      รหัสATMS:          [],
      createdAt:         new Date(),
      updatedAt:         new Date(),
    }

    await col.insertOne(doc)
    console.log(`  OK  ${sku}  ${nameTh}`)
    inserted++
  }

  await client.close()
  console.log(`\nDone — inserted: ${inserted}, skipped: ${skipped}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
