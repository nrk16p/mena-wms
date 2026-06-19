import { MongoClient, ObjectId } from "mongodb"

const URI = "mongodb+srv://adminbew:K879w5XpBm3QL046@mn-mongodb-ops-2c8032e6.mongo.ondigitalocean.com/terminus?authSource=admin"
const client = new MongoClient(URI)
await client.connect()
const col = client.db("master_data").collection("master_sku")

// Real vehicle types from vehicle_master (excluding dummy entries)
const MIXER  = ["@type:Mixer 10 ล้อ", "@type:Mixer 6 ล้อ", "@type:Mixer 4 ล้อ"]
const HEAVY  = ["@type:ลากจูง Ngv", "@type:ลากจูง OIL  ADBLUE", "@type:ลากจูง Oil", "@type:หัวเบาท์ 12 ล้อ ขนอาหารสัตว์", "@type:หัวเบ้าท์ขนอาหาร"]
const LIGHT  = ["@type:รถ 6 ล้อ ตู้แห้ง", "@type:รถ 6 ล้อ ตู้แห้ง ท้ายลิฟท์", "@type:รถ 4 ล้อจัมโบ้ตู้แห้ง", "@type:รถ 10 ล้อตู้แห้ง 7.5 ม.", "@type:รถ10ล้อ ตู้เย็น 7.5 เมตร", "@type:รถ10ล้อ ตู้เย็น 9.5 เมตร", "@type:รถ12ล้อ ตู้เย็น 9.5 เมตร"]
const PICKUP = ["@type:รถสำนักงาน"]
const ALL    = [...MIXER, ...HEAVY, ...LIGHT, ...PICKUP,
  "@type:กล้วยหอม 2 เพลา", "@type:กล้วยหอม 3 เพลา",
  "@type:หาง Side Curtain 3 เพลา", "@type:หาง Side Curtain 3 เพลา (น้ำหนักหาง<10000)",
  "@type:หางเบาท์ 3 เพลา ขนอาหารสัตว์", "@type:หางเบ้าท์ 2 เพลาขนอาหาร",
]

// Map: SKU → correct vehicle array
const UPDATES = {
  // ── Mixer-specific parts ──────────────────────────────────
  "LK-PRT-MXS-SLD-0001": MIXER,   // ซีลโม่
  "LK-PRT-MXS-RLR-0001": MIXER,   // ลูกกลิ้งรับโม่
  "LK-PRT-MXS-HYD-0001": MIXER,   // ปั๊มไฮดรอลิก
  "LK-PRT-MXS-HYD-0002": MIXER,   // สายไฮดรอลิก
  "LK-PRT-MXS-GBX-0001": MIXER,   // เกียร์ขับโม่
  "LK-PRT-MXS-CHT-0001": MIXER,   // รางเทคอนกรีต
  "LK-PRT-MXS-HYD-0003": MIXER,   // ไส้กรองน้ำมันไฮดรอลิก
  "LK-PRT-MXS-WTR-0001": MIXER,   // ถังน้ำล้างโม่
  "LK-PRT-ENG-OIL-0001": MIXER,   // ไส้กรองน้ำมันเครื่อง (Mixer engine)
  "LK-PRT-ENG-OIL-0002": MIXER,   // ไส้กรองอากาศ (Mixer engine)
  "LK-PRT-COL-WPP-0001": MIXER,   // ปั๊มน้ำหล่อเย็น (Mixer)
  "LK-PRT-PTO-CLT-0001": MIXER,   // คลัทช์ PTO (Mixer only)

  // ── Battery — matched to real vehicle sizes ───────────────
  "LK-PRT-ELC-BAT-0001": MIXER,                     // 12V 200Ah → Mixer trucks
  "LK-PRT-ELC-BAT-0002": LIGHT,                     // 12V 150Ah → Light/medium trucks
  "LK-PRT-ELC-BAT-0003": PICKUP,                    // 12V 100Ah → Pickup/office
  "LK-PRT-ELC-BAT-0004": HEAVY,                     // 24V 200Ah → Heavy/tractor heads
  "LK-PRT-ELC-BAT-0005": ALL,                       // ขั้วบวก → all vehicles
  "LK-PRT-ELC-BAT-0006": ALL,                       // ขั้วลบ → all vehicles
  "LK-PRT-ELC-CAB-0001": [...MIXER, ...HEAVY],      // 70sq cable → Mixer + heavy
  "LK-PRT-ELC-CAB-0002": [...MIXER, ...HEAVY],      // 70sq cable → Mixer + heavy
  "LK-PRT-ELC-BAT-0007": MIXER,                     // ถาดยึดแบตเตอรี่ → Mixer
  "LK-PRT-ELC-SAF-0001": ALL,                       // Battery isolator → all vehicles
}

let updated = 0
for (const [sku, vehicles] of Object.entries(UPDATES)) {
  const res = await col.updateOne(
    { SKU: sku, createdBy: "seed-script" },
    { $set: { "ทะเบียนหรือรุ่นรถ": vehicles, updatedAt: new Date() } }
  )
  if (res.modifiedCount > 0) {
    console.log(`  OK  ${sku.padEnd(30)} → [${vehicles.slice(0,2).join(", ")}${vehicles.length > 2 ? ` +${vehicles.length-2} more` : ""}]`)
    updated++
  } else {
    console.log(`  --  ${sku} (not found or already up to date)`)
  }
}

await client.close()
console.log(`\nUpdated ${updated} records`)
