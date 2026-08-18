// scripts/check-tire-request-stuck.mjs
// รัน: node scripts/check-tire-request-stuck.mjs [ทะเบียน]
//
// อ่านอย่างเดียว — ตรวจ "ความสอดคล้อง" ของคำขอเปลี่ยนยาง (tire_change_request)
// สถานะของใบคำขอถูกคำนวณมาจากสถานะของยางแต่ละเส้น ถ้าสองอย่างไม่ตรงกันจะเกิดทางตัน:
// เส้นที่ยังไม่ถูกตัดสินค้างอยู่ในใบที่ปิดแล้ว → อนุมัติไม่ได้ (409) และหน้ารายละเอียดรถ
// ก็ไม่โชว์ด้วย (มันข้ามใบที่ done/rejected) คนขับจึงรอยางฟรี ๆ โดยไม่มีใครเห็น
import { readFileSync } from "node:fs"
import { MongoClient } from "mongodb"

// อ่าน .env / .env.local เอง — สคริปต์ไม่ได้วิ่งผ่าน Next จึงไม่มีใครโหลดให้
const readEnv = (file) => {
  try {
    return Object.fromEntries(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => {
          const i = l.indexOf("=")
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]
        })
    )
  } catch { return {} }
}
const env = { ...readEnv(".env"), ...readEnv(".env.local") }

/** ต้องตรงกับ MERGE_WINDOW_DAYS ใน app/api/tire-change-request/route.ts */
const MERGE_WINDOW_DAYS = 7

const day = (d) => d?.toISOString?.().slice(0, 10) ?? "?"
const min = (d) => d?.toISOString?.().slice(0, 16).replace("T", " ") ?? "-"
const st = (it) => it.status ?? "pending"

const client = new MongoClient(env.MONGO_URI)
await client.connect()
const col = client.db(env.MONGO_DB ?? "master_data").collection("tire_change_request")

const plateArg = process.argv[2]
if (plateArg) {
  console.log(`=== ใบของ ${plateArg} ===`)
  for (const r of await col.find({ plate: plateArg }).sort({ createdAt: 1 }).toArray()) {
    console.log(`\n_id=${r._id} ${r.branch} status=${r.status ?? "(none)"} createdAt=${min(r.createdAt)}`)
    console.log(`   นัด=${day(r.appointmentDate)} ปิดงาน=${min(r.doneAt)} โดย=${r.doneBy ?? "-"} ผู้ยื่น=${r.requestedBy ?? "-"} (${r.source ?? "-"})`)
    for (const it of r.items ?? []) {
      console.log(`   - ${String(it.positionCode).padEnd(5)} ${st(it).padEnd(9)} ${String(it.serialNo).padEnd(14)} ${String(it.reason).padEnd(12)} ยื่น=${min(it.createdAt)} นัด=${day(it.appointmentDate)} job=${it.jobNo ?? "-"}`)
    }
  }
  console.log("")
}

const all = await col.find({ "items.0": { $exists: true } }).toArray()
const problems = []
const note = (kind, r, detail) => problems.push({ kind, plate: r.plate, id: String(r._id), status: r.status ?? "(none)", detail })

for (const r of all) {
  const items   = r.items ?? []
  const status  = r.status ?? "pending"
  const pending = items.filter((it) => st(it) === "pending")
  const okItems = items.filter((it) => st(it) === "approved")

  // 1) ทางตัน — เส้นที่ยังไม่ถูกตัดสิน ค้างในใบที่นัด/ปิดไปแล้ว จึงอนุมัติไม่ได้อีก
  if ((status === "appointment" || status === "done") && pending.length) {
    note("ทางตัน", r, `ค้าง ${pending.length} เส้น [${pending.map((it) => `${it.positionCode}@${day(it.createdAt)}`).join(", ")}] · ตัดสินแล้ว [${items.filter((it) => st(it) !== "pending").map((it) => `${it.positionCode}:${st(it)}`).join(", ")}]`)
  }

  // 2) ใบบอกว่าอนุมัติแล้ว แต่ยังมีเส้นรออนุมัติ — สถานะใบไม่ตรงกับเส้น
  if (status === "approved" && pending.length) {
    note("สถานะใบไม่ตรง", r, `ใบ=approved แต่มีเส้นรออนุมัติ ${pending.length} เส้น [${pending.map((it) => it.positionCode).join(", ")}]`)
  }

  // 3) ใบบอกว่ารออนุมัติ แต่ไม่มีเส้นไหนรอเลย
  if (status === "pending" && !pending.length) {
    note("สถานะใบไม่ตรง", r, `ใบ=pending แต่ทุกเส้นตัดสินแล้ว [${items.map((it) => `${it.positionCode}:${st(it)}`).join(", ")}]`)
  }

  // 4) เส้นที่อนุมัติแล้วต้องมีเลข Job (ฝั่ง API บังคับตอนอนุมัติ — ถ้าว่างคือของเก่าก่อนมีกฎ)
  const noJob = okItems.filter((it) => !String(it.jobNo ?? "").trim())
  if (noJob.length) note("ไม่มีเลข Job", r, `${noJob.map((it) => it.positionCode).join(", ")}`)

  // 5) เส้นที่ยื่นห่างจากวันสร้างใบเกินหน้าต่างรวมใบ — คนละงานแต่ถูกยัดใบเดียวกัน
  const far = items.filter((it) => {
    const gap = (it.createdAt?.getTime?.() ?? 0) - (r.createdAt?.getTime?.() ?? 0)
    return gap > MERGE_WINDOW_DAYS * 86_400_000
  })
  if (far.length) {
    note("รวมใบข้ามงาน", r, `ใบสร้าง ${day(r.createdAt)} แต่มีเส้นยื่น ${far.map((it) => `${it.positionCode}@${day(it.createdAt)}`).join(", ")}`)
  }
}

const kinds = [...new Set(problems.map((p) => p.kind))]
console.log(`=== ตรวจ ${all.length} ใบ · พบปัญหา ${problems.length} รายการ ===`)
for (const k of kinds) {
  const rows = problems.filter((p) => p.kind === k)
  console.log(`\n── ${k} (${rows.length}) ──`)
  for (const p of rows) console.log(`${p.plate.padEnd(12)} status=${p.status.padEnd(11)} ${p.detail}\n${" ".repeat(12)} _id=${p.id}`)
}
if (!problems.length) console.log("ไม่พบความไม่สอดคล้อง")

await client.close()
