// scripts/import-ap-excel.ts
// รัน (ดูอย่างเดียว):  npx tsx scripts/import-ap-excel.ts [โฟลเดอร์]
// รัน (เขียนจริง):     npx tsx scripts/import-ap-excel.ts [โฟลเดอร์] --write
//
// นำเข้างานเจ้าหนี้ที่ทำไว้ในไฟล์ Excel (กระบวนการเดิม) เข้า master_data.ap_tracking
// เพื่อให้เดือน ม.ค.–ส.ค. 69 ในหน้า /ap-tracking แสดงสถานะจริง ไม่ใช่ "รอประกบ" ทั้งกระดาน
//
// ไฟล์ต้นทางมี 2 รูปแบบ (โครงคนละแบบ ตรวจจากหัวตารางแถวที่ 2):
//   A "เจ้าหนี้เดือน xx.xlsx"  19 คอลัมน์ · 1 แถว = 1 รายการสินค้า → ต้องยุบเป็นรายใบ · ติ๊กเป็น "/"
//     ชีตแยกตามคลัง (ศลบ. / Dist / ศขก.) — ไม่มีคลังสระบุรีเพราะสระบุรีข้ามมาใช้ระบบใหม่โดยตรง
//   B "เจ้าหนี้ 2569.xlsx"      16 คอลัมน์ · 1 แถว = 1 ใบ · ติ๊กเป็น true/false · ชีตแยกตามรอบโอน
//
// กติกาที่ผู้ใช้ยืนยัน 18/08/2026:
//   ติ๊ก = "มีเอกสารใบนั้น" → docs.<key>.checked = true (ไม่ติ๊ก = ไม่เขียนคีย์ ไม่ใช่เขียน false)
//   คอลัมน์ "นอกรอบ/วันที่โอน" → sentType "นอกรอบ" · "ตามรอบ/วันที่ส่ง" → sentType "ตามรอบ"
//   มีทั้งสองคอลัมน์ → ยึดนอกรอบ (วันที่ในคอลัมน์นั้นเป็นวันพฤหัสจริงทุกใบ = วันโอนจริง)
//   ไม่มีทั้งคู่ → ยังไม่ได้ส่งบัญชี (ไม่เขียน sentDate) สถานะไปตามติ๊กเอกสารเอง
//
// ปลอดภัย: ใบที่ "มีคนแตะในระบบใหม่แล้ว" จะถูกข้ามเสมอ ไม่ทับงานที่ทำสดในเว็บ
import { readFileSync, readdirSync, realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { MongoClient } from "mongodb"
import * as XLSX from "xlsx"
import { apStatusOf, parseDmy, type ApDocKey, type ApDocs } from "../lib/ap-tracking"

const DEFAULT_DIR = path.join(process.env.HOME ?? "", "Documents/project/detb")
const DD_RE = /^[A-Z]{2,4}DD\d+$/          // กัน "ผู้จัดทำ" / ชื่อคน ในแถวลงนามท้ายชีตหลุดเข้ามา
const IMPORT_BY = "นำเข้าจาก Excel (กระบวนการเดิม)"

type Src = { file: string; sheet: string }
type Rec = {
  docs: Set<ApDocKey>
  sentType: "" | "นอกรอบ" | "ตามรอบ"
  sentDate: string
  sendDocDate: string        // ค่าดิบของคอลัมน์ "ตามรอบ/วันที่ส่ง" = วันที่ส่งเอกสารให้บัญชี
  notes: Set<string>
  srcs: Src[]
  sentConflict: boolean
}

const s = (v: unknown) => (v == null ? "" : String(v)).trim()

// ปีที่พิมพ์ผิดในไฟล์ต้นทาง — เจอจริง 8 ใบตอนนำเข้ารอบแรก (18/08/2026):
//   "0206-06-25" (ตกเลข 2 ตัว) และ "2025-01-07" ของใบที่รับ 07/01/2026
// แก้เฉพาะ "ปี" และเฉพาะเมื่อมั่นใจว่าผิดจริงเท่านั้น — วัน/เดือนไม่แตะ เพราะเดาแทนไม่ได้:
//   ก) ปีน้อยกว่า 2000 = เป็นไปไม่ได้
//   ข) วันส่งบัญชีอยู่ก่อนวันรับของ = เป็นไปไม่ได้ (ส่งเอกสารก่อนของมาถึง)
// เคสที่ "เป็นไปได้แต่แปลก" เช่นวันโอน พ.ย. ของใบเดือน ก.ค. ปล่อยไว้ตามไฟล์ ให้คนตรวจเอง
export function fixTypoYear(sent: string, receivedISO: string): { date: string; why: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sent)
  if (!m) return null
  const year = Number(m[1])
  const rYear = Number(receivedISO.slice(0, 4)) || 0
  if (year < 2000 && rYear) return { date: `${rYear}-${m[2]}-${m[3]}`, why: `ปี ${m[1]} เป็นไปไม่ได้` }
  if (receivedISO && sent < receivedISO && rYear && year < rYear) {
    const fixed = `${rYear}-${m[2]}-${m[3]}`
    if (fixed >= receivedISO) return { date: fixed, why: `วันส่งอยู่ก่อนวันรับของ (${receivedISO})` }
  }
  return null
}
// ติ๊กในไฟล์ A เป็น "/" ส่วนไฟล์ B เป็น boolean — ช่องที่มีชื่อคน (แถวลงนาม) ถูกกันด้วย DD_RE อยู่แล้ว
const ticked = (v: unknown) => v === true || (typeof v === "string" && s(v) !== "" && s(v) !== "-")

// วันที่ใน Excel เก็บเป็น "serial number" (จำนวนวันนับจาก 30/12/1899 — รวมบั๊กปีอธิกสุรทิน 1900 ของ Excel)
// อ่านเป็นตัวเลขแล้วแปลงเองด้วย UTC ล้วน · ห้ามให้ SheetJS แปลงเป็น Date ให้ (cellDates:true)
// เพราะมันคำนวณผ่าน timezone ของเครื่องแล้วเลื่อนวันจริง — วัดแล้ว 27/08 กลายเป็น 26/08
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
function ymd(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    const d = new Date(EXCEL_EPOCH + Math.round(v) * 86_400_000)
    return d.toISOString().slice(0, 10)
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`
  }
  const t = s(v)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t) || /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t)
  if (!m) return ""
  return m[0].includes("-") ? `${m[1]}-${m[2]}-${m[3]}`
    : `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
}

// ตำแหน่งคอลัมน์ของแต่ละรูปแบบ (0-based) — ตรวจรูปแบบจากหัวตาราง ไม่ใช่จากชื่อไฟล์
const LAYOUT = {
  monthly: { dd: 3, bill: 11, invoice: 12, taxInvoice: 13, receipt: 14, billingNote: 15, out: 16, inn: 17, note: 18 },
  rounds:  { dd: 3, bill: 8,  invoice: 9,  taxInvoice: 10, receipt: 11, billingNote: 12, out: 13, inn: 14, note: 15 },
}

function readWorkbook(file: string, recs: Map<string, Rec>, stat: Record<string, number>) {
  const wb = XLSX.read(readFileSync(file), { cellDates: false, dense: true })
  for (const sheet of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: true, blankrows: false })
    const head = (rows[1] ?? []).map((c) => s(c))
    const L = head[0] === "ลำดับ" ? LAYOUT.rounds : LAYOUT.monthly
    for (const row of rows.slice(2)) {
      const code = s(row[L.dd])
      if (!DD_RE.test(code)) { if (code) stat.skippedNonDd++; continue }
      stat.rows++
      const r = recs.get(code) ?? { docs: new Set<ApDocKey>(), sentType: "", sentDate: "", sendDocDate: "", notes: new Set<string>(), srcs: [], sentConflict: false }
      for (const k of ["bill", "invoice", "taxInvoice", "receipt", "billingNote"] as const) {
        if (ticked(row[L[k]])) r.docs.add(k as ApDocKey)
      }
      // นอกรอบชนะตามรอบเสมอ · ค่าเดิมที่เป็นนอกรอบอยู่แล้วห้ามถูกตามรอบของอีกแถวเขียนทับ
      const out = ymd(row[L.out]), inn = ymd(row[L.inn])
      const next: { t: Rec["sentType"]; d: string } | null =
        out ? { t: "นอกรอบ", d: out } : inn ? { t: "ตามรอบ", d: inn } : null
      if (next) {
        if (r.sentDate && (r.sentType !== next.t || r.sentDate !== next.d)) {
          r.sentConflict = true
          if (r.sentType === "นอกรอบ" && next.t === "ตามรอบ") { /* คงของเดิม */ }
          else { r.sentType = next.t; r.sentDate = next.d }
        } else { r.sentType = next.t; r.sentDate = next.d }
      }
      // "ตามรอบ/วันที่ส่ง" คือวันที่ส่งเอกสารให้บัญชีจริง ๆ เก็บแยกไว้ — ต่างจาก sentDate ที่เป็นวันเงินออก
      if (inn && !r.sendDocDate) r.sendDocDate = inn
      const n = s(row[L.note])
      if (n) r.notes.add(n)
      const src = { file: path.basename(file), sheet }
      if (!r.srcs.some((x) => x.file === src.file && x.sheet === src.sheet)) r.srcs.push(src)
      recs.set(code, r)
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const write = args.includes("--write")
  const dir = args.find((a) => !a.startsWith("--")) ?? DEFAULT_DIR

  const files = readdirSync(dir).filter((f) => f.endsWith(".xlsx") && !f.startsWith("~$")).sort()
  console.log(`โฟลเดอร์: ${dir}\nไฟล์ที่อ่าน: ${files.length}`)

  const recs = new Map<string, Rec>()
  const stat = { rows: 0, skippedNonDd: 0 }
  for (const f of files) {
    const before = recs.size
    readWorkbook(path.join(dir, f), recs, stat)
    console.log(`  ${f}  → สะสม ${recs.size.toLocaleString("th-TH")} ใบ (+${recs.size - before})`)
  }
  console.log(`\nแถวข้อมูลที่อ่าน ${stat.rows.toLocaleString("th-TH")} · ข้ามแถวที่ไม่ใช่เลขใบ ${stat.skippedNonDd} (แถวลงนามท้ายชีต)`)
  console.log(`ใบ DD ไม่ซ้ำ: ${recs.size.toLocaleString("th-TH")}`)

  const env = readFileSync(path.join(process.cwd(), ".env"), "utf8")
  const uri = env.match(/^MONGO_URI=(.+)$/m)![1].trim().replace(/^["']|["']$/g, "")
  const mdName = env.match(/^MONGO_DB=(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "") ?? "master_data"
  if (mdName === "atms") throw new Error("MONGO_DB ต้องไม่ใช่ 'atms' — ฐานนั้นเป็น read-only ของ scraper")

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 })
  await client.connect()
  const codes = [...recs.keys()]
  const known = new Map<string, string>()          // deposit_code → วันรับของ (YYYY-MM-DD)
  for (let i = 0; i < codes.length; i += 2000) {
    const chunk = codes.slice(i, i + 2000)
    for (const d of await client.db("atms").collection("deposit_header")
      .find({ deposit_code: { $in: chunk } }, { projection: { _id: 0, deposit_code: 1, received_at: 1 } }).toArray()) {
      known.set(String(d.deposit_code), parseDmy(d.received_at))
    }
  }
  const col = client.db(mdName).collection("ap_tracking")
  const touched = new Set((await col.find({}, { projection: { _id: 0, depositCode: 1 } }).toArray()).map((d) => String(d.depositCode)))

  const at = new Date().toISOString()
  let willWrite = 0, noHeader = 0, skipTouched = 0, conflicts = 0, sentNoDocs = 0, noSendDate = 0, typoFixed = 0
  const byStatus: Record<string, number> = {}
  const ops: Parameters<typeof col.bulkWrite>[0] = []

  for (const [code, r] of recs) {
    if (!known.has(code)) { noHeader++; continue }
    const fix = r.sentDate ? fixTypoYear(r.sentDate, known.get(code) ?? "") : null
    if (fix) { console.log(`  แก้ปีที่พิมพ์ผิด ${code}: ${r.sentDate} → ${fix.date} (${fix.why})`); r.sentDate = fix.date; typoFixed++ }
    if (touched.has(code)) { skipTouched++; continue }
    if (r.sentConflict) conflicts++
    const docs: ApDocs = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const set: Record<string, any> = { depositCode: code, updatedAt: at, updatedBy: IMPORT_BY }
    for (const k of r.docs) {
      set[`docs.${k}`] = { checked: true, by: IMPORT_BY, at }
      docs[k] = { checked: true, by: IMPORT_BY, at }
    }
    if (r.sentDate) {
      set.sentType = r.sentType
      set.sentDate = r.sentDate
      // "วันที่กดส่งบัญชี" มาจากคอลัมน์ "ตามรอบ/วันที่ส่ง" เท่านั้น เพราะนั่นคือวันที่ส่งเอกสารจริง
      // ห้ามเอาวันโอนของ "นอกรอบ" มาใช้แทน — คนละความหมาย (วันเงินออก ไม่ใช่วันที่ส่ง)
      // ไฟล์ไม่มีเวลา ใช้เที่ยงวันไทยเพื่อให้ตกวันเดียวกันแน่นอน · ที่มาดูได้จาก sentMarkedBy
      if (r.sendDocDate) {
        set.sentMarkedAt = `${r.sendDocDate}T05:00:00.000Z`
        set.sentMarkedBy = IMPORT_BY
      } else {
        noSendDate++
      }
      if (r.docs.size === 0) sentNoDocs++
    }
    if (r.notes.size) set.note = [...r.notes].join(" · ").slice(0, 500)
    set.importedFrom = { at, sources: r.srcs }
    const status = apStatusOf(docs, r.sentDate)
    byStatus[status] = (byStatus[status] ?? 0) + 1
    willWrite++
    ops.push({
      updateOne: {
        filter: { depositCode: code },
        update: {
          $set: set,
          $push: { log: { action: "นำเข้าจากไฟล์ Excel", field: "import",
                          detail: r.srcs.map((x) => `${x.file} · ${x.sheet}`).join(", "), by: IMPORT_BY, at } },
          $setOnInsert: { createdAt: at, createdBy: IMPORT_BY },
        },
        upsert: true,
      },
    })
  }

  console.log("\n── สรุปสิ่งที่จะเขียน ──────────────────────────────")
  console.log(`  จะเขียน                       ${willWrite.toLocaleString("th-TH")} ใบ`)
  console.log(`  ข้าม: ไม่มีใบนี้ใน ATMS        ${noHeader}`)
  console.log(`  ข้าม: มีคนแตะในระบบใหม่แล้ว    ${skipTouched}`)
  console.log(`  ⚠️ วันส่งขัดกันเองในไฟล์        ${conflicts}  (ยึด "นอกรอบ")`)
  console.log(`  แก้ปีที่พิมพ์ผิดในไฟล์          ${typoFixed}`)
  console.log(`  ⚠️ มีวันส่งแต่ไม่ติ๊กเอกสารเลย  ${sentNoDocs}`)
  console.log(`  ส่งบัญชีแล้วแต่ไม่มี "วันที่ส่ง"  ${noSendDate}  (มีแต่วันโอนนอกรอบ → คอลัมน์ "กดส่งเมื่อ" จะขึ้น —)`)
  console.log("  สถานะปลายทาง:", Object.entries(byStatus).map(([k, v]) => `${k} ${v.toLocaleString("th-TH")}`).join(" · "))
  // ตรวจความถูกต้องของการแปลงวันที่: "นอกรอบ" ต้องเป็นวันพฤหัสเกือบทั้งหมด (บัญชีโอนทุกพฤหัส)
  // ถ้าตัวเลขนี้เพี้ยน แปลว่า serial date ถูกแปลงผิดอีกครั้ง — อย่าเขียนลงฐาน
  const dow = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"]
  const outDow: Record<string, number> = {}
  for (const r of recs.values()) {
    if (r.sentType !== "นอกรอบ" || !r.sentDate) continue
    const k = dow[new Date(`${r.sentDate}T00:00:00Z`).getUTCDay()]
    outDow[k] = (outDow[k] ?? 0) + 1
  }
  console.log("  วันในสัปดาห์ของ \"นอกรอบ\" (ควรเป็น พฤ เกือบหมด):", outDow)
  for (const [code, r] of [...recs].slice(0, 3)) {
    console.log(`  ตัวอย่าง ${code}: ติ๊ก [${[...r.docs].join(",") || "—"}] · ${r.sentType || "ยังไม่ส่ง"} ${r.sentDate}`)
  }

  if (!write) {
    console.log("\nโหมดดูอย่างเดียว — ใส่ --write เพื่อเขียนจริง")
  } else if (ops.length) {
    const res = await col.bulkWrite(ops, { ordered: false })
    console.log(`\nเขียนแล้ว: สร้างใหม่ ${res.upsertedCount.toLocaleString("th-TH")} · อัปเดต ${res.modifiedCount.toLocaleString("th-TH")}`)
  }
  await client.close()
}

// รันเฉพาะตอนถูกเรียกเป็นสคริปต์หลักเท่านั้น — สคริปต์อื่น import fixTypoYear ไปใช้ได้
// โดยไม่เผลอสั่งนำเข้าทั้งชุดซ้ำ (เคยเกือบพลาดตอนเขียนตัวแก้ปีที่พิมพ์ผิด)
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
