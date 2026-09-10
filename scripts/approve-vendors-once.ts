// scripts/approve-vendors-once.ts
// อนุมัติอู่เป็นชุด "ครั้งเดียว" ตาม AUTO_APPROVE_RULE (≥20 ครั้งใน 24 เดือน + ใช้ล่าสุด ≤12 เดือน)
// ผู้ใช้ตัดสินใจ 10/09/2026 ว่าไม่เอาแบบอัตโนมัติตลอด — หน้าเว็บจึงไม่รันเอง ต้องสั่งจากตรงนี้
//
//   node -r dotenv/config node_modules/.bin/tsx scripts/approve-vendors-once.ts          ← แค่ดูรายชื่อ (dry)
//   node -r dotenv/config node_modules/.bin/tsx scripts/approve-vendors-once.ts --apply  ← เขียนจริง
//
// ปลอดภัยรันซ้ำ: แตะเฉพาะอู่ที่ยัง "รอพิจารณา" และคนไม่เคยตั้งสถานะเอง (autoApproved !== false)
import { getVendors, approveVendorsByRule } from "../lib/vendor"
import { autoApproveCandidates, AUTO_APPROVE_RULE, MONTHS_BACK } from "../lib/vendor-core"

async function main() {
  const apply = process.argv.includes("--apply")
  const d = await getVendors(true)
  const cands = autoApproveCandidates(d.vendors).sort((a, b) => b.jobs - a.jobs)
  console.log(`เกณฑ์: ≥${AUTO_APPROVE_RULE.minJobs} ครั้งใน ${MONTHS_BACK} เดือน (${d.fromYm} → ${d.asOfYm}) · ใช้ล่าสุด ≤${AUTO_APPROVE_RULE.activeMonths} เดือน`)
  console.log(`อู่ทั้งหมด ${d.vendors.length} ราย · เข้าเกณฑ์และยังรอพิจารณา ${cands.length} ราย\n`)
  for (const v of cands) console.log(`  ${String(v.jobs).padStart(5)} ครั้ง · ล่าสุด ${v.lastYm} · ${v.vendor}`)
  if (!apply) { console.log("\n(dry run — ใส่ --apply เพื่อเขียนจริง)"); process.exit(0) }
  const done = await approveVendorsByRule(d)
  console.log(`\n✅ อนุมัติแล้ว ${done.length} ราย (ข้าม ${cands.length - done.length} รายที่ถูกคนตั้งสถานะไปก่อน)`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
