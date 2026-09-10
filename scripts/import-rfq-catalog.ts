// scripts/import-rfq-catalog.ts
// นำเข้าแคตตาล็อกงานช่าง + อะไหล่ จากฟอร์ม xlsx → rfq_job_catalog / rfq_part_catalog
// รัน: node -r dotenv/config node_modules/.bin/tsx scripts/import-rfq-catalog.ts "<path.xlsx>" [--apply]
// ไม่ใส่ --apply = dry run พิมพ์สรุปต่อชีต · --apply = version+1, upsert ทุกแถว, ที่หายไป active=false
import * as XLSX from "xlsx"
import clientPromise from "../lib/mongo"
import { SHEET_ORDER, type RfqJob, type RfqPart } from "../lib/rfq-core"

const DB = process.env.MONGO_DB ?? "master_data"
const s = (v: unknown) => String(v ?? "").trim()
const n = (v: unknown): number | null => { const x = Number(v); return v === "" || v == null || !Number.isFinite(x) ? null : x }

function parseSheet(ws: XLSX.WorkSheet, sheet: string, sheetTitle: string) {
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" })
  const jobs: Omit<RfqJob, "version" | "active">[] = []
  const parts: Omit<RfqPart, "version" | "active">[] = []
  let section: 0 | 1 | 2 = 0
  for (const r of rows) {
    const a = s(r[0])
    if (a.startsWith("ส่วนที่ 1")) { section = 1; continue }
    if (a.startsWith("ส่วนที่ 2")) { section = 2; continue }
    if (a === "ลำดับ") continue
    if (!/^\d+$/.test(a)) continue
    if (section === 1 && s(r[1])) {
      jobs.push({ sheet, sheetTitle, seq: +a, jobCode: s(r[1]), name: s(r[2]), scope: s(r[3]),
        tierCriteria: s(r[4]), refHoursL: n(r[5]), refHoursS: n(r[6]) })
    } else if (section === 2 && s(r[1])) {
      parts.push({ sheet, sheetTitle, seq: +a, sku: s(r[1]), name: s(r[2]), useWith: s(r[3]) || "L+S", unit: s(r[4]) })
    }
  }
  return { jobs, parts }
}

async function main() {
  const file = process.argv[2]
  const apply = process.argv.includes("--apply")
  if (!file) { console.error("usage: import-rfq-catalog.ts <xlsx> [--apply]"); process.exit(1) }
  const wb = XLSX.readFile(file)
  const allJobs: Omit<RfqJob, "version" | "active">[] = []
  const allParts: Omit<RfqPart, "version" | "active">[] = []
  for (const name of wb.SheetNames) {
    const m = /^(S\d+|SVC)\s+(.*)$/.exec(name)
    if (!m) continue
    const { jobs, parts } = parseSheet(wb.Sheets[name], m[1], m[2].trim())
    console.log(`${m[1].padEnd(4)} ${m[2].padEnd(30)} งาน ${String(jobs.length).padStart(3)} · อะไหล่ ${String(parts.length).padStart(3)}`)
    allJobs.push(...jobs); allParts.push(...parts)
  }
  const unknownSheets = [...new Set(allJobs.map((j) => j.sheet))].filter((x) => !SHEET_ORDER.includes(x))
  if (unknownSheets.length) throw new Error(`ชีตที่ไม่อยู่ใน SHEET_ORDER: ${unknownSheets.join(", ")}`)
  const dupJobs = allJobs.map((j) => j.jobCode).filter((c, i, arr) => arr.indexOf(c) !== i)
  if (dupJobs.length) throw new Error(`jobCode ซ้ำ: ${[...new Set(dupJobs)].join(", ")}`)
  console.log(`\nรวม งาน ${allJobs.length} · อะไหล่ ${allParts.length}`)
  if (!apply) { console.log("(dry run — ใส่ --apply เพื่อเขียนจริง)"); process.exit(0) }

  const client = await clientPromise
  const db = client.db(DB)
  const meta = db.collection("rfq_catalog_meta")
  const prev = await meta.findOne<{ version: number }>({ _id: "latest" as never })
  const version = (prev?.version ?? 0) + 1
  const jobCol = db.collection<RfqJob>("rfq_job_catalog")
  const partCol = db.collection<RfqPart>("rfq_part_catalog")
  await jobCol.createIndex({ jobCode: 1 }, { unique: true })
  await jobCol.createIndex({ sheet: 1, seq: 1 })
  await partCol.createIndex({ sheet: 1, sku: 1 }, { unique: true })
  await jobCol.bulkWrite(allJobs.map((j) => ({ updateOne: { filter: { jobCode: j.jobCode }, update: { $set: { ...j, version, active: true } }, upsert: true } })))
  await partCol.bulkWrite(allParts.map((p) => ({ updateOne: { filter: { sheet: p.sheet, sku: p.sku }, update: { $set: { ...p, version, active: true } }, upsert: true } })))
  const j0 = await jobCol.updateMany({ version: { $lt: version }, active: true }, { $set: { active: false } })
  const p0 = await partCol.updateMany({ version: { $lt: version }, active: true }, { $set: { active: false } })
  await meta.updateOne({ _id: "latest" as never }, { $set: { version, importedAt: new Date().toISOString(), jobs: allJobs.length, parts: allParts.length } }, { upsert: true })
  console.log(`✅ version ${version} · งาน ${allJobs.length} · อะไหล่ ${allParts.length} · ปิดใช้ของเก่า งาน ${j0.modifiedCount} อะไหล่ ${p0.modifiedCount}`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
