/**
 * Replace old parts GRADE codes with G1–G7
 * Run: MONGO_URI=... MONGO_DB=... npx tsx scripts/seed-grades.ts
 */

import { MongoClient } from "mongodb"

const URI = process.env.MONGO_URI ?? ""
const DB  = process.env.MONGO_DB  ?? "master_data"
if (!URI) throw new Error("Set MONGO_URI env var")

const NEW_GRADES = [
  { code: "G1", th: "แท้ศูนย์นำเข้า (ซื้อศูนย์)",        en: "Genuine Import",     note: "ซื้อจากศูนย์โดยตรง นำเข้าจากต่างประเทศ" },
  { code: "G2", th: "แท้ศูนย์ Local (ซื้อศูนย์)",         en: "Genuine Local",      note: "ซื้อจากศูนย์ ผลิตในประเทศ เช่น กลุ่ม Hi-POP" },
  { code: "G3", th: "เทียบ OEM หรือเทียบมี Brand",        en: "OEM / Branded",      note: "ซื้อร้านอะไหล่น่าเชื่อถือ เช่น SKF" },
  { code: "G4", th: "อะไหล่เก่าแท้ เซียงกง",              en: "Used Genuine",       note: "แนะนำกรณีมูลค่าสูง เช่น เกียร์" },
  { code: "G5", th: "เทียบ ไม่มี Brand ❌",               en: "Unbranded",          note: "ห้ามใช้ ยกเว้นรายการไม่มีผลต่อรถ เช่น ไฟท้าย เบาะ" },
  { code: "G6", th: "อะไหล่เก่ารีบิ้ว โรงงาน",           en: "Factory Rebuilt",    note: "ศูนย์/โรงงานรีบิ้ว สภาพ 95%" },
  { code: "G7", th: "อะไหล่เก่ารีบิ้วเอง",               en: "Self Rebuilt",       note: "เอาอะไหล่เก่าของเราไปซ่อมเป็นอะไหล่สำรอง A1" },
]

async function main() {
  const client = await MongoClient.connect(URI)
  const col    = client.db(DB).collection("master_codes")

  // Remove old grade codes (OEM, OE, A, B, NA) — keep LAB grades (CTR/G1–G4/INH)
  const deleted = await col.deleteMany({ dict: "GRADE", code: { $in: ["OEM", "OE", "A", "B", "NA"] } })
  console.log(`Deleted ${deleted.deletedCount} old grade codes`)

  // Upsert new G1–G7 (no expenseType tag = parts grades)
  let order = 100
  for (const g of NEW_GRADES) {
    await col.updateOne(
      { _id: `GRADE:${g.code}` } as never,
      { $set: { dict: "GRADE", code: g.code, th: g.th, en: g.en, parent: null, order: order++, meta: { note: g.note } } },
      { upsert: true }
    )
    console.log(`  ✓ ${g.code}: ${g.th}`)
  }

  await client.close()
  console.log("Done")
}

main().catch((e) => { console.error(e); process.exit(1) })
