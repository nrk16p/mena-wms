// scripts/migrate-deadstock-used-no-wd.ts
// รัน: node -r dotenv/config node_modules/.bin/tsx scripts/migrate-deadstock-used-no-wd.ts [--apply]
//
// ครั้งเดียว 27/08/2026 — ป้าย "ใช้แล้ว" (used) กับ "ไม่มี WD" (no_wd) ถูกรวมเป็นตัวเลือกเดียว
// "ใช้แล้ว-ไม่มี WD" (used_no_wd) ตามที่ผู้ใช้สั่ง · ป้ายที่คนติ๊กไว้ก่อนหน้าต้องย้ายตาม
// ไม่งั้นช่องการจัดการของแถวนั้นจะขึ้นว่าง (ค่าที่บันทึกไว้ไม่ตรงกับตัวเลือกไหนเลย)
//
// ไม่ใส่ --apply = ดูอย่างเดียว ไม่เขียนอะไร
import clientPromise from "../lib/mongo"

const DB = process.env.MONGO_DB ?? "master_data"
const OLD = ["used", "no_wd"]
const NEW = "used_no_wd"

async function main() {
  const apply = process.argv.includes("--apply")
  const client = await clientPromise
  const col = client.db(DB).collection("deadstock_action")

  const docs = await col.find({ action: { $in: OLD } }, { projection: { _id: 0, key: 1, action: 1, by: 1, at: 1 } }).toArray()
  console.log(`ป้ายที่ต้องย้าย ${docs.length} รายการ:`)
  for (const d of docs) console.log(`  ${d.key}  ${d.action} → ${NEW}   (โดย ${d.by})`)
  if (!docs.length) { console.log("ไม่มีอะไรต้องย้าย"); await client.close(); return }

  if (!apply) { console.log("\n(ดูอย่างเดียว — ใส่ --apply เพื่อเขียนจริง)"); await client.close(); return }

  // เขียนเฉพาะฟิลด์ action · log เดิมไม่แตะ (เก็บไว้ว่าตอนนั้นคนติ๊กว่าอะไรจริง ๆ)
  // แล้วต่อท้าย log 1 บรรทัดว่าระบบย้ายให้ จะได้ตามรอยได้ว่าค่าเปลี่ยนเพราะอะไร
  const at = new Date().toISOString()
  const res = await col.updateMany(
    { action: { $in: OLD } },
    {
      $set: { action: NEW },
      $push: {
        log: {
          $each: [{ action: "ใช้แล้ว-ไม่มี WD", note: "ระบบย้ายป้ายอัตโนมัติ (รวมตัวเลือก ใช้แล้ว + ไม่มี WD)", by: "ระบบ (รวมตัวเลือก)", byEmail: "", at }],
          $slice: -50,
        },
      },
    } as never
  )
  console.log(`\nย้ายแล้ว ${res.modifiedCount} รายการ`)
  const left = await col.countDocuments({ action: { $in: OLD } })
  console.log(`เหลือค้างคีย์เก่า: ${left}`)
  await client.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
