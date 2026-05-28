/**
 * Seed labor (LAB) L2/L3 codes for Mixer Truck and Trailer
 * Run: MONGO_URI=... npx tsx scripts/seed-lab-codes.ts
 */

import { MongoClient } from "mongodb"

const URI = process.env.MONGO_URI ?? ""
const DB  = process.env.MONGO_DB  ?? "master_data"
if (!URI) throw new Error("Set MONGO_URI env var")

// L2 codes for LAB — keyed by L1 parent
const L2: { parent: string; code: string; th: string; en: string }[] = [
  // ===== ENG — เครื่องยนต์ =====
  { parent: "ENG", code: "OVH", th: "ถอดประกอบเครื่องยนต์",     en: "Engine Overhaul" },
  { parent: "ENG", code: "HED", th: "ซ่อมฝาสูบ",                en: "Cylinder Head" },
  { parent: "ENG", code: "COL", th: "ซ่อมระบบหล่อเย็น",         en: "Cooling System" },
  { parent: "ENG", code: "FUL", th: "ซ่อมระบบเชื้อเพลิง",       en: "Fuel System" },
  { parent: "ENG", code: "TBO", th: "ซ่อมเทอร์โบ",              en: "Turbocharger" },
  { parent: "ENG", code: "INJ", th: "ซ่อมหัวฉีด/ปั๊มฉีด",      en: "Injector / Pump" },

  // ===== TRN — ระบบส่งกำลัง =====
  { parent: "TRN", code: "CLT", th: "ซ่อมระบบคลัทช์",          en: "Clutch" },
  { parent: "TRN", code: "GBX", th: "ซ่อมเกียร์บ็อกซ์",        en: "Gearbox" },
  { parent: "TRN", code: "PRO", th: "ซ่อมเพลากลาง/เพลาขับ",   en: "Propshaft / Driveshaft" },
  { parent: "TRN", code: "DIF", th: "ซ่อมดิฟเฟอเรนเชียล",      en: "Differential" },
  { parent: "TRN", code: "AXL", th: "ซ่อมเพลาล้อ",             en: "Wheel Axle" },

  // ===== BRK — ระบบเบรก =====
  { parent: "BRK", code: "LNG", th: "เปลี่ยนผ้าเบรก/ก้ามเบรก", en: "Brake Lining / Shoe" },
  { parent: "BRK", code: "DRM", th: "ซ่อมดรัม/จานเบรก",         en: "Drum / Disc" },
  { parent: "BRK", code: "AIR", th: "ซ่อมระบบลม",              en: "Air Brake System" },
  { parent: "BRK", code: "CYL", th: "ซ่อมกระบอกเบรก",          en: "Brake Cylinder" },

  // ===== SUS — ช่วงล่าง =====
  { parent: "SUS", code: "SPR", th: "ซ่อมสปริง/ใบแหนบ",        en: "Spring / Leaf Spring" },
  { parent: "SUS", code: "SHK", th: "ซ่อมโช้คอัพ",             en: "Shock Absorber" },
  { parent: "SUS", code: "BUS", th: "เปลี่ยนบูชช่วงล่าง",       en: "Bushing" },
  { parent: "SUS", code: "ALN", th: "ตั้งศูนย์/ถ่วงล้อ",        en: "Alignment / Balancing" },

  // ===== STR — พวงมาลัย =====
  { parent: "STR", code: "BOX", th: "ซ่อมกล่องพวงมาลัย",       en: "Steering Box" },
  { parent: "STR", code: "ROD", th: "ซ่อมคันส่ง/ลูกหมาก",      en: "Tie Rod / Ball Joint" },
  { parent: "STR", code: "PMP", th: "ซ่อมปั๊มพวงมาลัย",        en: "Power Steering Pump" },

  // ===== ELC — ระบบไฟฟ้า =====
  { parent: "ELC", code: "ALT", th: "ซ่อมไดชาร์จ",             en: "Alternator" },
  { parent: "ELC", code: "STM", th: "ซ่อมมอเตอร์สตาร์ท",       en: "Starter Motor" },
  { parent: "ELC", code: "WRG", th: "ซ่อมสายไฟ/ปลั๊ก",         en: "Wiring / Connectors" },
  { parent: "ELC", code: "LGT", th: "ซ่อมระบบไฟรถ",            en: "Lighting System" },

  // ===== MXS — ระบบโม่ผสม (Mixer Truck) =====
  { parent: "MXS", code: "DRM", th: "ซ่อมดรัมผสม",             en: "Mixer Drum" },
  { parent: "MXS", code: "HYD", th: "ซ่อมระบบไฮดรอลิก",       en: "Hydraulic System" },
  { parent: "MXS", code: "CHT", th: "ซ่อมรางเท/ราง",           en: "Chute / Discharge" },
  { parent: "MXS", code: "DRV", th: "ซ่อมระบบขับดรัม",         en: "Drum Drive System" },
  { parent: "MXS", code: "BRG", th: "เปลี่ยนลูกปืนดรัม",       en: "Drum Bearing" },
  { parent: "MXS", code: "WTR", th: "ซ่อมระบบน้ำ/ปั๊มน้ำ",     en: "Water System / Pump" },

  // ===== TRL — หางพ่วง/โดลลี่ (Trailer) =====
  { parent: "TRL", code: "FRM", th: "ซ่อมโครงหาง",             en: "Trailer Frame" },
  { parent: "TRL", code: "AXL", th: "ซ่อมเพลาหาง",             en: "Trailer Axle" },
  { parent: "TRL", code: "BRK", th: "ซ่อมเบรกหาง",             en: "Trailer Brake" },
  { parent: "TRL", code: "AIR", th: "ซ่อมระบบลมหาง",           en: "Trailer Air System" },
  { parent: "TRL", code: "KPN", th: "ซ่อมคิงพิน/แผ่นรับ",      en: "Kingpin / 5th Wheel" },
  { parent: "TRL", code: "EXP", th: "ซ่อมขาค้ำ (Landing Gear)", en: "Landing Gear" },

  // ===== BOD — ตัวถัง =====
  { parent: "BOD", code: "WLD", th: "งานเชื่อม",                en: "Welding" },
  { parent: "BOD", code: "PNT", th: "งานพ่นสี",                 en: "Painting" },
  { parent: "BOD", code: "REP", th: "ซ่อมตัวถัง/บุบ",           en: "Body Repair / Dent" },
  { parent: "BOD", code: "CAB", th: "ซ่อมห้องโดยสาร",          en: "Cabin Repair" },

  // ===== TYR — ยางและล้อ =====
  { parent: "TYR", code: "CHG", th: "เปลี่ยนยาง",              en: "Tire Change" },
  { parent: "TYR", code: "BAL", th: "ถ่วงล้อ/ตั้งศูนย์",        en: "Balancing / Alignment" },
  { parent: "TYR", code: "REP", th: "ซ่อม/ปะยาง",              en: "Tire Repair / Patch" },

  // ===== PTO — ระบบ PTO =====
  { parent: "PTO", code: "SHF", th: "ซ่อมเพลา PTO",            en: "PTO Shaft" },
  { parent: "PTO", code: "GBX", th: "ซ่อมเกียร์ PTO",          en: "PTO Gearbox" },
  { parent: "PTO", code: "VLV", th: "ซ่อมวาล์ว PTO",           en: "PTO Valve" },

  // ===== ACS — ระบบแอร์รถ =====
  { parent: "ACS", code: "CPR", th: "ซ่อมคอมเพรสเซอร์แอร์",   en: "AC Compressor" },
  { parent: "ACS", code: "CON", th: "ซ่อมแผงระบาย/คอนเดนเซอร์", en: "Condenser" },
  { parent: "ACS", code: "EVP", th: "ซ่อมคอยล์เย็น/อีวาพ",     en: "Evaporator" },
  { parent: "ACS", code: "GAS", th: "เติมน้ำยาแอร์",            en: "Refrigerant Recharge" },
]

// L3 codes for LAB — keyed by "L1:L2" parent
const L3: { parent: string; code: string; th: string; en: string }[] = [
  // ENG / OVH
  { parent: "ENG:OVH", code: "FULL", th: "ถอดประกอบเครื่องยนต์ทั้งตัว",     en: "Full Engine Overhaul" },
  { parent: "ENG:OVH", code: "TOP",  th: "ถอดประกอบครึ่งบน (Top Overhaul)", en: "Top Overhaul" },
  { parent: "ENG:OVH", code: "HON",  th: "ฮ็อนกระบอกสูบ",                  en: "Cylinder Honing" },
  { parent: "ENG:OVH", code: "RNG",  th: "เปลี่ยนแหวนลูกสูบ",               en: "Piston Ring Replacement" },

  // ENG / HED
  { parent: "ENG:HED", code: "REM",  th: "ถอด-ติดตั้งฝาสูบ",               en: "Remove / Install Head" },
  { parent: "ENG:HED", code: "GSK",  th: "เปลี่ยนปะเก็นฝาสูบ",             en: "Head Gasket" },
  { parent: "ENG:HED", code: "VAL",  th: "ปรับตั้งวาล์ว",                   en: "Valve Adjustment" },

  // ENG / TBO
  { parent: "ENG:TBO", code: "REB",  th: "รีบิ้วเทอร์โบ",                   en: "Turbo Rebuild" },
  { parent: "ENG:TBO", code: "REP",  th: "เปลี่ยนเทอร์โบใหม่",             en: "Turbo Replacement" },

  // TRN / CLT
  { parent: "TRN:CLT", code: "SET",  th: "เปลี่ยนชุดคลัทช์",               en: "Full Clutch Kit" },
  { parent: "TRN:CLT", code: "DSC",  th: "เปลี่ยนจานคลัทช์",               en: "Clutch Disc" },
  { parent: "TRN:CLT", code: "BRG",  th: "เปลี่ยนลูกปืนคลัทช์",            en: "Clutch Release Bearing" },

  // TRN / GBX
  { parent: "TRN:GBX", code: "OVH",  th: "ถอดประกอบเกียร์",                en: "Gearbox Overhaul" },
  { parent: "TRN:GBX", code: "OIL",  th: "เปลี่ยนน้ำมันเกียร์",            en: "Gear Oil Change" },
  { parent: "TRN:GBX", code: "BRG",  th: "เปลี่ยนลูกปืนเกียร์",            en: "Gearbox Bearing" },

  // TRN / DIF
  { parent: "TRN:DIF", code: "OVH",  th: "ถอดประกอบดิฟ",                   en: "Differential Overhaul" },
  { parent: "TRN:DIF", code: "OIL",  th: "เปลี่ยนน้ำมันดิฟ",               en: "Diff Oil Change" },
  { parent: "TRN:DIF", code: "BRG",  th: "เปลี่ยนลูกปืนดิฟ",               en: "Diff Bearing" },

  // BRK / LNG
  { parent: "BRK:LNG", code: "FNT",  th: "เปลี่ยนผ้าเบรกเพลาหน้า",        en: "Front Axle Lining" },
  { parent: "BRK:LNG", code: "MDL",  th: "เปลี่ยนผ้าเบรกเพลากลาง",        en: "Middle Axle Lining" },
  { parent: "BRK:LNG", code: "RER",  th: "เปลี่ยนผ้าเบรกเพลาหลัง",        en: "Rear Axle Lining" },
  { parent: "BRK:LNG", code: "ALL",  th: "เปลี่ยนผ้าเบรกทั้งคัน",          en: "All Axles" },

  // BRK / AIR
  { parent: "BRK:AIR", code: "VLV",  th: "ซ่อม/เปลี่ยนวาล์วลม",           en: "Air Valve" },
  { parent: "BRK:AIR", code: "TNK",  th: "ตรวจ/ล้างถังลม",                 en: "Air Tank Service" },
  { parent: "BRK:AIR", code: "CMB",  th: "ซ่อมแชมเบอร์เบรก",               en: "Brake Chamber" },

  // SUS / SPR
  { parent: "SUS:SPR", code: "REP",  th: "ซ่อมใบแหนบ",                    en: "Leaf Spring Repair" },
  { parent: "SUS:SPR", code: "CHG",  th: "เปลี่ยนชุดใบแหนบ",              en: "Leaf Spring Replacement" },
  { parent: "SUS:SPR", code: "PIN",  th: "เปลี่ยนพินสปริง/บูช",            en: "Spring Pin / Bushing" },

  // SUS / SHK
  { parent: "SUS:SHK", code: "CHG",  th: "เปลี่ยนโช้คอัพ",                 en: "Shock Absorber Replacement" },
  { parent: "SUS:SHK", code: "OVH",  th: "ซ่อมโช้คอัพ",                    en: "Shock Absorber Rebuild" },

  // MXS / DRM — Mixer drum (สำคัญมาก)
  { parent: "MXS:DRM", code: "INS",  th: "ตรวจสอบและล้างดรัม",             en: "Drum Inspection & Cleaning" },
  { parent: "MXS:DRM", code: "BLD",  th: "ซ่อม/เปลี่ยนใบพัดดรัม",         en: "Drum Blade Repair / Replace" },
  { parent: "MXS:DRM", code: "RBR",  th: "เปลี่ยนยางรับดรัม",              en: "Drum Rubber Roller" },
  { parent: "MXS:DRM", code: "TRK",  th: "ซ่อมรางวิ่งดรัม",               en: "Drum Track / Ring" },
  { parent: "MXS:DRM", code: "WLD",  th: "งานเชื่อมดรัม",                  en: "Drum Welding" },

  // MXS / HYD — Hydraulic (สำคัญมาก)
  { parent: "MXS:HYD", code: "PMP",  th: "ซ่อม/เปลี่ยนปั๊มไฮดรอลิก",     en: "Hydraulic Pump" },
  { parent: "MXS:HYD", code: "MTR",  th: "ซ่อม/เปลี่ยนมอเตอร์ไฮดรอลิก",  en: "Hydraulic Motor" },
  { parent: "MXS:HYD", code: "VLV",  th: "ซ่อมวาล์วคอนโทรล",              en: "Control Valve" },
  { parent: "MXS:HYD", code: "OIL",  th: "เปลี่ยนน้ำมันไฮดรอลิก",         en: "Hydraulic Oil Change" },
  { parent: "MXS:HYD", code: "HSE",  th: "เปลี่ยนสายไฮดรอลิก",            en: "Hydraulic Hose" },

  // MXS / DRV
  { parent: "MXS:DRV", code: "GBX",  th: "ซ่อมเกียร์ขับดรัม",             en: "Drum Drive Gearbox" },
  { parent: "MXS:DRV", code: "BRG",  th: "เปลี่ยนลูกปืนชุดขับ",           en: "Drive Bearing" },
  { parent: "MXS:DRV", code: "OIL",  th: "เปลี่ยนน้ำมันเกียร์ขับ",        en: "Drive Gear Oil" },

  // TRL / KPN — Kingpin (สำคัญมาก)
  { parent: "TRL:KPN", code: "INS",  th: "ตรวจสอบคิงพิน",                 en: "Kingpin Inspection" },
  { parent: "TRL:KPN", code: "REP",  th: "เปลี่ยนคิงพิน",                 en: "Kingpin Replacement" },
  { parent: "TRL:KPN", code: "PLT",  th: "ซ่อม/เปลี่ยนแผ่นรับ (5th Wheel)", en: "5th Wheel Plate" },

  // TRL / AXL
  { parent: "TRL:AXL", code: "BRG",  th: "เปลี่ยนลูกปืนเพลาหาง",         en: "Trailer Axle Bearing" },
  { parent: "TRL:AXL", code: "SLS",  th: "เปลี่ยนซีลเพลาหาง",             en: "Trailer Axle Seal" },
  { parent: "TRL:AXL", code: "OVH",  th: "ถอดประกอบเพลาหาง",              en: "Trailer Axle Overhaul" },

  // TRL / FRM
  { parent: "TRL:FRM", code: "WLD",  th: "งานเชื่อมโครงหาง",              en: "Frame Welding" },
  { parent: "TRL:FRM", code: "STR",  th: "ซ่อมโครงหางเสียรูป",            en: "Frame Straightening" },
  { parent: "TRL:FRM", code: "COR",  th: "ซ่อมสนิม/เคลือบ",               en: "Rust Treatment / Coating" },

  // TRL / BRK
  { parent: "TRL:BRK", code: "LNG",  th: "เปลี่ยนผ้าเบรกหาง",             en: "Trailer Brake Lining" },
  { parent: "TRL:BRK", code: "DRM",  th: "ซ่อมดรัมเบรกหาง",               en: "Trailer Brake Drum" },
  { parent: "TRL:BRK", code: "CMB",  th: "ซ่อมแชมเบอร์เบรกหาง",           en: "Trailer Brake Chamber" },

  // TRL / EXP
  { parent: "TRL:EXP", code: "REP",  th: "ซ่อมขาค้ำ",                     en: "Landing Gear Repair" },
  { parent: "TRL:EXP", code: "CHG",  th: "เปลี่ยนขาค้ำ",                  en: "Landing Gear Replacement" },

  // BOD
  { parent: "BOD:WLD", code: "STR",  th: "งานเชื่อมโครงสร้าง",            en: "Structural Welding" },
  { parent: "BOD:WLD", code: "REP",  th: "งานเชื่อมซ่อม",                 en: "Repair Welding" },
  { parent: "BOD:PNT", code: "FUL",  th: "พ่นสีทั้งคัน",                  en: "Full Paint" },
  { parent: "BOD:PNT", code: "PAR",  th: "พ่นสีบางส่วน",                  en: "Partial Paint" },
  { parent: "BOD:PNT", code: "PRM",  th: "ทาสีรองพื้น",                   en: "Primer / Undercoat" },

  // TYR
  { parent: "TYR:CHG", code: "SGL",  th: "เปลี่ยนยางเดี่ยว",             en: "Single Tire" },
  { parent: "TYR:CHG", code: "SET",  th: "เปลี่ยนยางทั้งชุด (1 เพลา)",   en: "Axle Set" },
  { parent: "TYR:REP", code: "PTH",  th: "ปะยางใน",                       en: "Inner Tube Patch" },
  { parent: "TYR:REP", code: "PLG",  th: "อุดยางปะเก็น",                   en: "Plug Repair" },
]

async function seed() {
  const client = new MongoClient(URI)
  await client.connect()
  const col = client.db(DB).collection("master_codes")

  let upserted = 0

  // Seed L2
  for (let i = 0; i < L2.length; i++) {
    const item = L2[i]
    const _id  = `SUB_ASSEMBLY_L2:${item.parent}:${item.code}`
    await col.updateOne(
      { _id: _id as unknown as string },
      {
        $setOnInsert: {
          _id,
          dict:   "SUB_ASSEMBLY_L2",
          code:   item.code,
          th:     item.th,
          en:     item.en,
          parent: item.parent,
          order:  i,
          meta:   { expenseType: "LAB" },
        },
      },
      { upsert: true }
    )
    upserted++
  }

  // Seed L3
  for (let i = 0; i < L3.length; i++) {
    const item = L3[i]
    const _id  = `COMPONENT_L3:${item.parent}:${item.code}`
    await col.updateOne(
      { _id: _id as unknown as string },
      {
        $setOnInsert: {
          _id,
          dict:   "COMPONENT_L3",
          code:   item.code,
          th:     item.th,
          en:     item.en,
          parent: item.parent,
          order:  i,
          meta:   { expenseType: "LAB" },
        },
      },
      { upsert: true }
    )
    upserted++
  }

  console.log(`✅ Done: ${upserted} labor codes seeded`)
  await client.close()
}

seed().catch(console.error)
