import { MongoClient } from "mongodb"

const URI = "mongodb+srv://adminbew:K879w5XpBm3QL046@mn-mongodb-ops-2c8032e6.mongo.ondigitalocean.com/terminus?authSource=admin"
const client = new MongoClient(URI)
await client.connect()
const col = client.db("master_data").collection("master_sku")

// Real ATMS codes matched from stockmovement_v5
const ATMS_MAP = {
  // ── Mixer drum seal ── (ซีลคอโม่, ซีลลูกกลิ้ง, ซีลเพลาปั่นโม่)
  "LK-PRT-MXS-SLD-0001": ["LB06MX00019", "LB06MX00020", "LB06MX00021", "LB06MX00026", "KK06MX0051"],

  // ── Drum rollers ── (ลูกกลิ้งโม่)
  "LK-PRT-MXS-RLR-0001": ["LB06MX00063", "LB06MX00064", "LB06MX00215", "LB06MX00216", "LB06MX00461"],

  // ── Hydraulic drive pump ── (ปั๊มไฮดรอลิค, ชุดซ่อมปั๊มไฮดรอลิค)
  "LK-PRT-MXS-HYD-0001": ["LB06MX00007", "LB06MX00009", "LB06MX00255", "KK06MX0048"],

  // ── High-pressure hydraulic hose ── (สายไฮโดรลิคย้ำ)
  "LK-PRT-MXS-HYD-0002": ["LB05MX00514", "LB06MX00146", "LB06MX00147", "LB06MX00168", "KK06MX0030"],

  // ── Mixer gearbox / drive motor ── (เกียร์โม่, มอเตอร์เกียร์โม่)
  "LK-PRT-MXS-GBX-0001": ["LB06MX00239", "LB06MX00245", "LB06MX00252", "LB06MX00292", "LB06MX00343"],

  // ── Concrete chute ── (รางเทปูน, แกนรับรางเท)
  "LK-PRT-MXS-CHT-0001": ["LB06MX00241", "LB06MX00247", "LB06MX00504"],

  // ── Hydraulic oil filter ── (กรองน้ำมันไฮโดรลิค)
  "LK-PRT-MXS-HYD-0003": ["LB10PM00064", "LB06MX00345", "KK10PM0054", "S10PM00214"],

  // ── Drum wash water tank ── (ถังน้ำหลังหัวเก๋ง, น็อตยึดถังน้ำล้างโม่)
  "LK-PRT-MXS-WTR-0001": ["LB06MX00162", "KK06MX0013"],

  // ── Engine oil filter ── (ไส้กรองน้ำมันเครื่อง — XZU600R, ISUZU 360, UD)
  "LK-PRT-ENG-OIL-0001": ["LB10PM00106", "LB10PM00048", "LB10PM00049", "LB10PM00161"],

  // ── Air filter ── (กรองอากาศลูกนอก — HINO, ISUZU, UD)
  "LK-PRT-ENG-OIL-0002": ["LB10PM00073", "LB10PM00074", "LB10PM00076", "LB10PM00077", "LB10PM00082"],

  // ── Water pump ── (ปั๊มน้ำเครื่อง SANY, Hino, ISUZU + ปั๊มน้ำโม่ปูน)
  "LK-PRT-COL-WPP-0001": ["LB02MS00584", "LB02MS00737", "LB02MS00744", "LB06MX00487", "LB06MX00041"],

  // ── PTO clutch ── (ซีล PTO)
  "LK-PRT-PTO-CLT-0001": ["KK02MS0005"],

  // ── Battery 12V 200Ah (Mixer) ── (N150 / N120 ใกล้เคียงที่มีในระบบ)
  "LK-PRT-ELC-BAT-0001": ["LB05AE00134", "LB05AE00133", "KK05AE0040", "KK05AE0039"],

  // ── Battery 12V 150Ah (Light truck) ──
  "LK-PRT-ELC-BAT-0002": ["LB05AE00134", "KK05AE0040", "S5AE00421"],

  // ── Battery 12V 100Ah (Pickup) ──
  "LK-PRT-ELC-BAT-0003": ["LB05AE00132", "KK05AE0037", "KK05AE0038", "LB05AE00705"],

  // ── Battery 24V set (Heavy truck) ── (N150 คู่)
  "LK-PRT-ELC-BAT-0004": ["LB05AE00134", "KK05AE0040", "LB05AE00133", "KK05AE0039"],

  // ── Battery terminal + ── (ขั้วแบตเตอร์รี่บวก)
  "LK-PRT-ELC-BAT-0005": ["S5AE00047"],

  // ── Battery terminal − ── (ขั้วแบตเตอร์รี่ลบ)
  "LK-PRT-ELC-BAT-0006": ["S5AE00048"],

  // ── Battery cable 70sq + ── (สายไฟ 70 sq)
  "LK-PRT-ELC-CAB-0001": ["LB08GP00798"],

  // ── Battery cable 70sq − ──
  "LK-PRT-ELC-CAB-0002": ["LB08GP00798"],

  // ── Battery tray/bracket ── (ฐานแบตเตอรี่, แท่นเหล็กวางแบตเตอรี่)
  "LK-PRT-ELC-BAT-0007": ["LB05AE00760", "LB13OT00203"],

  // ── Battery isolator switch ── (สวิทตัดแบตเตอรี่)
  "LK-PRT-ELC-SAF-0001": ["LB05AE00758", "LB05AE00835"],
}

let updated = 0
for (const [sku, codes] of Object.entries(ATMS_MAP)) {
  const res = await col.updateOne(
    { SKU: sku, createdBy: "seed-script" },
    { $set: { รหัสATMS: codes, updatedAt: new Date() } }
  )
  if (res.modifiedCount > 0) {
    console.log(`  OK  ${sku.padEnd(30)}  ATMS: [${codes.join(", ")}]`)
    updated++
  } else {
    console.log(`  --  ${sku} not found`)
  }
}

await client.close()
console.log(`\nUpdated ${updated} / ${Object.keys(ATMS_MAP).length} records`)
