// scripts/probe-vendors.ts
// รัน: node -r dotenv/config node_modules/.bin/tsx scripts/probe-vendors.ts [ประเภทงาน]
// อ่านอย่างเดียว ไม่เขียนอะไรลง DB — เรียก getVendors() ตัวเดียวกับที่หน้าเว็บใช้
// จะได้รู้ตัวถ้า ATMS เปลี่ยนรูปข้อมูลจนตัวเลขเพี้ยน โดยไม่ต้องเปิดเบราว์เซอร์
import { getVendors } from "../lib/vendor"
import { TIER_LABEL, UNCLASSIFIED } from "../lib/vendor-core"

const thb = (n: number) => Math.round(n).toLocaleString("th-TH")

async function main() {
  const t0 = Date.now()
  const d = await getVendors(true)
  console.log(`\n=== Vendor List · ${d.fromYm} → ${d.asOfYm} · ${Date.now() - t0} ms ===`)
  console.log(`อู่ทั้งหมด ${d.vendors.length} ราย · คู่ (อู่ × ประเภท) ${d.byService.length} แถว`)
  console.log(`ยังไม่จัดประเภท: ${d.unclassified.codes} รหัส · ${d.unclassified.jobs} ครั้ง · ${thb(d.unclassified.baht)} บาท`)

  console.log("\n— ประเภทงาน —")
  for (const s of d.services) {
    console.log(`  ${thb(s.baht).padStart(12)} · ${String(s.jobs).padStart(5)} ครั้ง · อู่ ${String(s.vendors).padStart(3)} ราย · ค่ากลาง/ครั้ง ${thb(s.medianAvg).padStart(7)} · ${s.serviceType}`)
  }

  const pick = process.argv[2] || d.services.find((s) => s.serviceType !== UNCLASSIFIED)?.serviceType
  if (pick) {
    console.log(`\n— อู่สำหรับงาน "${pick}" (10 อันดับแรก) —`)
    for (const r of d.byService.filter((r) => r.serviceType === pick).slice(0, 10)) {
      console.log(
        `  ${TIER_LABEL[r.tier].th.padEnd(18)} ${String(r.jobs).padStart(4)} ครั้ง · ` +
        `${thb(r.baht).padStart(10)} · เฉลี่ย ${thb(r.avg).padStart(7)} · ` +
        `${r.vsMedian === null ? "  —  " : `${r.vsMedian > 0 ? "+" : ""}${r.vsMedian}%`.padStart(6)} · ` +
        `ล่าสุด ${r.lastYm} · ${r.vendor}`
      )
    }
  }

  console.log("\n— อู่ยอดสูงสุด 10 ราย —")
  for (const v of d.vendors.slice(0, 10)) {
    console.log(`  ${thb(v.baht).padStart(12)} · ${String(v.jobs).padStart(5)} ครั้ง · ${v.lastYm} · ${v.vendor}`)
    console.log(`        ประเภทที่เคยทำ: ${v.didTypes.map((t) => `${t.serviceType}(${t.jobs})`).join(", ")}`)
  }
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
