// scripts/import-ap-account.ts
// รัน (ดูอย่างเดียว):  npx tsx scripts/import-ap-account.ts [ไฟล์]
// รัน (เขียนจริง):     npx tsx scripts/import-ap-account.ts [ไฟล์] --write
//
// นำเข้าผลตรวจของบัญชีจากไฟล์ "สรุปDD จาก ATMS ปี2569.xlsx" (สมุดงานของฝ่ายบัญชี)
// กติกาจากผู้ใช้ 19/08/2026: ใบ DD ที่มี "วันที่ส่งเอกสารเข้าสกท" = บัญชีผ่านแล้ว
// → review = ผ่าน (at = วันที่นั้น) · VoucherNo.เลขตั้งหนี้เก็บเข้า voucherNos (ค้นหาได้)
// · เลขใบวางบิลจริงรวมเข้า billingNoteNos · ช่อง Taxinvoice/Receipt ที่ขีด "/" = ติ๊กว่ามีเอกสาร
//
// ปลอดภัย: ตั้งผ่านเฉพาะใบที่ "ยังไม่ตรวจ" และ "อยู่ในระบบติดตามแล้ว" — ใบสระบุรีไม่มี
// tracking เพราะสระบุรีใช้เว็บโดยตรง (ผู้ใช้สั่ง 19/08/2026: ไม่ต้องมีสระบุรี ให้บัญชีกดในเว็บเอง)
// · ไม่ทับผลที่คนกดในเว็บ · ไม่สร้างกำหนดจ่าย
// ย้อนหลัง (pay ใช้กับการกดผ่านใหม่ในเว็บเท่านั้น ของเก่าบัญชีจ่ายตามระบบเดิมไปแล้ว)
// · รันซ้ำได้ — ใบที่ผ่านแล้วถูกข้าม เลขเอกสารรวมแบบ union ไม่เขียนทับ
import { readFileSync } from "node:fs"
import path from "node:path"
import { MongoClient } from "mongodb"
import * as XLSX from "xlsx"
import { cleanDocNos } from "../lib/ap-tracking"

const DEFAULT_FILE = path.join(process.env.HOME ?? "", "Documents/project/detb/บัญชี/สรุปDD จาก ATMS ปี2569.xlsx")
const DD_RE = /^[A-Z]{2,4}DD\d+$/
const IMPORT_BY = "นำเข้าจากไฟล์บัญชี (สรุปDD)"
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

const s = (v: unknown) => (v == null ? "" : String(v)).trim()
function ymd(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return new Date(EXCEL_EPOCH + Math.round(v) * 86_400_000).toISOString().slice(0, 10)
  }
  const t = s(v)
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
  return ""
}

type Rec = { sent: string[]; vouchers: Set<string>; bns: Set<string>; taxTick: boolean; rcptTick: boolean; sheets: Set<string> }

async function main() {
  const args = process.argv.slice(2)
  const write = args.includes("--write")
  const file = args.find((a) => !a.startsWith("--")) ?? DEFAULT_FILE

  // อ่าน serial number ดิบแล้วแปลงวันเอง — cellDates:true ของ SheetJS เลื่อนวันตาม timezone (เจอมาแล้ว)
  const wb = XLSX.read(readFileSync(file), { cellDates: false, dense: true })
  const recs = new Map<string, Rec>()
  for (const sheet of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: true, blankrows: false })
    // ตำแหน่งคอลัมน์อ่านจากหัวตาราง (แถวที่ 2) ไม่ hardcode — ชีตของบัญชีขยับคอลัมน์กันบ่อย
    const head = (rows[1] ?? []).map((c) => s(c))
    const col = {
      dd: head.findIndex((h) => h === "DD"),
      voucher: head.findIndex((h) => h.startsWith("VoucherNo")),
      bn: head.findIndex((h) => h.startsWith("ใบวางบิลเลขที่")),
      tax: head.findIndex((h) => h.startsWith("TaxinvoiceNo")),
      rcpt: head.findIndex((h) => h.startsWith("ReceiptNo")),
      sent: head.findIndex((h) => h.includes("ส่งเอกสารเข้าสกท")),
    }
    if (col.dd < 0 || col.sent < 0) { console.log(`  ข้ามชีต ${sheet} — ไม่พบคอลัมน์ DD/วันที่ส่งเข้าสกท`); continue }
    for (const row of rows.slice(2)) {
      const code = s(row[col.dd])
      if (!DD_RE.test(code)) continue
      const r = recs.get(code) ?? { sent: [], vouchers: new Set(), bns: new Set(), taxTick: false, rcptTick: false, sheets: new Set<string>() }
      const d = ymd(row[col.sent])
      if (d && !r.sent.includes(d)) r.sent.push(d)
      const vc = s(row[col.voucher])
      if (vc && vc !== "/") r.vouchers.add(vc)
      const bn = s(row[col.bn])
      if (bn && bn !== "/") r.bns.add(bn)
      if (s(row[col.tax])) r.taxTick = true
      if (s(row[col.rcpt])) r.rcptTick = true
      r.sheets.add(sheet.trim())
      recs.set(code, r)
    }
  }
  const passed = [...recs.entries()].filter(([, r]) => r.sent.length > 0)
  console.log(`ใบ DD ในไฟล์: ${recs.size.toLocaleString("th-TH")} · มีวันส่งเข้าสกท (= ผ่าน): ${passed.length.toLocaleString("th-TH")}`)

  const env = readFileSync(path.join(process.cwd(), ".env"), "utf8")
  const uri = env.match(/^MONGO_URI=(.+)$/m)![1].trim().replace(/^["']|["']$/g, "")
  const mdName = env.match(/^MONGO_DB=(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "") ?? "master_data"
  if (mdName === "atms") throw new Error("MONGO_DB ต้องไม่ใช่ 'atms'")

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 })
  await client.connect()
  const codes = passed.map(([c]) => c)
  const known = new Set<string>()
  for (let i = 0; i < codes.length; i += 2000) {
    for (const d of await client.db("atms").collection("deposit_header")
      .find({ deposit_code: { $in: codes.slice(i, i + 2000) } }, { projection: { _id: 0, deposit_code: 1 } }).toArray()) {
      known.add(String(d.deposit_code))
    }
  }
  const col = client.db(mdName).collection("ap_tracking")
  const cur = new Map<string, Record<string, unknown>>()
  for (let i = 0; i < codes.length; i += 2000) {
    for (const d of await col.find({ depositCode: { $in: codes.slice(i, i + 2000) } },
      { projection: { _id: 0, depositCode: 1, "review.status": 1, docs: 1, voucherNos: 1, billingNoteNos: 1 } }).toArray()) {
      cur.set(String(d.depositCode), d)
    }
  }

  const now = new Date().toISOString()
  let willWrite = 0, skipReviewed = 0, noHeader = 0, skipNoTracking = 0
  const ops: Parameters<typeof col.bulkWrite>[0] = []
  for (const [code, r] of passed) {
    if (!known.has(code)) { noHeader++; continue }
    const c = cur.get(code)
    if (!c) { skipNoTracking++; continue }                 // ไม่อยู่ในระบบติดตาม (สระบุรี) — ให้กดในเว็บเอง
    const status = s((c.review as { status?: string } | undefined)?.status)
    if (status) { skipReviewed++; continue }               // มีผลตรวจแล้ว (เว็บหรือรอบก่อน) — ไม่ทับ
    // วันผ่าน = วันส่งเข้าสกทล่าสุด · ไฟล์ไม่มีเวลา ใช้เที่ยงวันไทยกันวันเลื่อน
    const at = `${r.sent.sort().at(-1)}T05:00:00.000Z`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const set: Record<string, any> = {
      depositCode: code, updatedAt: now, updatedBy: IMPORT_BY,
      review: { status: "ผ่าน", note: "", by: IMPORT_BY, at },
      accountImportedFrom: { at: now, file: path.basename(file), sheets: [...r.sheets] },
    }
    // เลขเอกสารรวมแบบ union — ไม่ทับของที่กรอกไว้ในเว็บ
    if (r.vouchers.size) set.voucherNos = cleanDocNos([...cleanDocNos(c?.voucherNos), ...r.vouchers])
    if (r.bns.size)      set.billingNoteNos = cleanDocNos([...cleanDocNos(c?.billingNoteNos), ...r.bns])
    const docs = (c?.docs ?? {}) as Record<string, { checked?: boolean }>
    if (r.taxTick && !docs.taxInvoice?.checked) set["docs.taxInvoice"] = { checked: true, by: IMPORT_BY, at }
    if (r.rcptTick && !docs.receipt?.checked)   set["docs.receipt"] = { checked: true, by: IMPORT_BY, at }
    willWrite++
    ops.push({
      updateOne: {
        filter: { depositCode: code },
        update: {
          $set: set,
          $push: { log: { action: "บัญชีตรวจเอกสาร: ผ่าน (นำเข้าจากไฟล์บัญชี)", field: "review",
                          detail: r.vouchers.size ? `Voucher ${[...r.vouchers].join(", ")}` : "", by: IMPORT_BY, at } },
          $setOnInsert: { createdAt: now, createdBy: IMPORT_BY },
        },
        upsert: false,          // เขียนเฉพาะใบที่มี tracking อยู่แล้ว — ห้ามงอกใบสระบุรี
      },
    })
  }

  console.log(`\n── สรุป ──────────────────────────────`)
  console.log(`  จะตั้งผ่าน                     ${willWrite.toLocaleString("th-TH")} ใบ`)
  console.log(`  ข้าม: ไม่อยู่ในระบบติดตาม        ${skipNoTracking}  (สระบุรี — บัญชีกดในเว็บเอง)`)
  console.log(`  ข้าม: มีผลตรวจอยู่แล้ว          ${skipReviewed.toLocaleString("th-TH")}  (รันซ้ำ/คนกดในเว็บ — ไม่ทับ)`)
  console.log(`  ข้าม: ไม่มีใบนี้ใน ATMS         ${noHeader}`)
  const ex = passed.find(([c]) => cur.has(c) && !s((cur.get(c)?.review as { status?: string } | undefined)?.status))
  if (ex) console.log(`  ตัวอย่าง ${ex[0]}: ผ่าน ${ex[1].sent.sort().at(-1)} · Voucher [${[...ex[1].vouchers].join(",")}]`)

  if (!write) console.log("\nโหมดดูอย่างเดียว — ใส่ --write เพื่อเขียนจริง")
  else if (ops.length) {
    const res = await col.bulkWrite(ops, { ordered: false })
    console.log(`\nเขียนแล้ว: สร้างใหม่ ${res.upsertedCount.toLocaleString("th-TH")} · อัปเดต ${res.modifiedCount.toLocaleString("th-TH")}`)
  }
  await client.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
