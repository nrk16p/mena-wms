// scripts/tick-vendor-codes-once.ts
// ติ๊กประเภทการซ่อม (คอลัมน์อู่นอก) เป็นชุด "ครั้งเดียว" — ช่องไหนมีประวัติ ≥20 ครั้ง ติ๊กช่องนั้น
// (ผู้ใช้สั่ง 10/09/2026: "ประเภทงานซ่อม: tick only each 20>") · เพิ่มอย่างเดียว ไม่เอาติ๊กคนออก
//
//   node -r dotenv/config node_modules/.bin/tsx scripts/tick-vendor-codes-once.ts          ← ดูก่อน (dry)
//   node -r dotenv/config node_modules/.bin/tsx scripts/tick-vendor-codes-once.ts --apply  ← เขียนจริง
//
// หมายเหตุ: ประเภทฝั่งจัดซื้อ 1 ตัวครอบหลายงานตามทะเบียน (ระบบยาง → ปะยาง/เปลี่ยนยาง/... 5 ช่อง,
// ระบบบำรุงรักษา → PM-1..4 + อีก 4 ช่อง) อู่ยาง 48 ครั้งจึงถูกติ๊กงานยางทุกช่อง — ตรงกับตัวเลขที่โชว์ในช่องบนจอ
import { getVendors, tickVendorCodesByRule } from "../lib/vendor"
import { codesByRule, AUTO_APPROVE_RULE } from "../lib/vendor-core"
import { byCode } from "../lib/repair-type-master"

async function main() {
  const apply = process.argv.includes("--apply")
  const d = await getVendors(true)
  const plan = d.vendors
    .map((v) => ({ v, add: codesByRule(v) }))
    .filter((x) => x.add.length)
    .sort((a, b) => b.v.jobs - a.v.jobs)
  const cells = plan.reduce((a, x) => a + x.add.length, 0)
  console.log(`เกณฑ์: ช่องที่มีประวัติ ≥${AUTO_APPROVE_RULE.minJobs} ครั้ง (${d.fromYm} → ${d.asOfYm}) · เฉพาะคอลัมน์อู่นอก`)
  console.log(`อู่ทั้งหมด ${d.vendors.length} ราย · จะติ๊กเพิ่ม ${plan.length} ราย รวม ${cells} ช่อง\n`)
  for (const { v, add } of plan) {
    const works = [...new Set(add.map((c) => byCode(c)!.work))].join(", ")
    console.log(`  ${String(v.jobs).padStart(5)} ครั้ง · +${String(add.length).padStart(2)} ช่อง · ${v.vendor}\n           ${works}`)
  }
  if (!apply) { console.log("\n(dry run — ใส่ --apply เพื่อเขียนจริง)"); process.exit(0) }
  const r = await tickVendorCodesByRule(d)
  console.log(`\n✅ ติ๊กเพิ่มแล้ว ${r.cells} ช่อง ใน ${r.vendors} ราย`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
