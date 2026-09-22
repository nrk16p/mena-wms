// scripts/import-ap-doc-templates.ts
// รัน (ดูอย่างเดียว):  npx tsx scripts/import-ap-doc-templates.ts [ไฟล์.xlsx]
// รัน (เขียนจริง):     npx tsx scripts/import-ap-doc-templates.ts [ไฟล์.xlsx] --write
//
// นำเข้าแม่แบบเอกสารประกบชุดส่งบัญชีตามผู้ขาย → master_data.ap_doc_template (1 doc = 1 ผู้ขาย, คีย์ = code)
// ไฟล์ต้นทาง: ชีตแรก "รายงานรายละเอียดผู้ขายทังหมด" หัวตารางแถว 1
//   Vendor Code | Vendor Name | Credit Days | ใบวางบิล | ใบเสร็จรับเงิน | ใบกำกับภาษี | ใบแจ้งหนี้ | บิลเงินสด | ใบส่งของ | ใบรับสินค้า | ใบสั่งซื้อ
// ติ๊ก = "☑" · ไม่ติ๊ก = "☐" หรือเซลล์ว่าง
//
// กติกา:
//   - เจ้าที่ติ๊กแค่ใบรับสินค้า/ใบสั่งซื้อ (ไม่มีเอกสารการเงินเลย) = ไม่มีแม่แบบ → ไม่นำเข้า
//   - Credit Days ในไฟล์ไม่ใช้ — เครดิตเทอมมาจาก ATMS อยู่แล้ว (ap_supplier / ap term บน PO)
//   - แม่แบบที่คนแก้ในหน้าเว็บแล้ว (source "manual") ห้ามทับ — นโยบายเดียวกับ AP: ค่าที่คนตั้ง = ค่าจริง
//   - รหัสซ้ำในไฟล์: ติ๊กเหมือนกัน = รวมเป็นอันเดียว · ติ๊กต่างกัน = ข้าม แล้วพิมพ์ออกมาให้คนตัดสิน
import { readFileSync } from "node:fs"
import path from "node:path"
import { MongoClient } from "mongodb"
import * as XLSX from "xlsx"
import {
  normVendorCode, templateDocsFromExcelRow, templateDocLabel, type ApTplDocKey,
} from "../lib/ap-doc-template"

const DEFAULT_FILE = path.join(process.env.HOME ?? "", "Documents/project/เอกสารปะกบชุดส่งบัญชีตามผู้ขาย.xlsx")
const IMPORT_BY = "นำเข้าจาก Excel (เอกสารปะกบชุดส่งบัญชีตามผู้ขาย)"
const COLL = "ap_doc_template"

const args = process.argv.slice(2)
const WRITE = args.includes("--write")
const file = args.find((a) => !a.startsWith("--")) ?? DEFAULT_FILE

type Rec = { code: string; name: string; docs: ApTplDocKey[] }

function readTemplates(p: string) {
  const wb = XLSX.read(readFileSync(p))
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
  const recs = new Map<string, Rec>()
  const conflicts: { code: string; a: Rec; b: Rec }[] = []
  let noCode = 0, noDocs = 0
  for (const r of rows) {
    const code = normVendorCode(r["Vendor Code"])
    const name = String(r["Vendor Name"] ?? "").trim()
    // แถวหัวตารางซ้ำกลางชีต / แถวว่าง
    if (!code || code === "Vendor Code") { noCode++; continue }
    const docs = templateDocsFromExcelRow(r)
    if (!docs.length) { noDocs++; continue }
    const prev = recs.get(code)
    if (prev) {
      if (prev.docs.join() !== docs.join()) conflicts.push({ code, a: prev, b: { code, name, docs } })
      continue
    }
    recs.set(code, { code, name, docs })
  }
  for (const c of conflicts) recs.delete(c.code)
  return { total: rows.length, recs, conflicts, noCode, noDocs, sheet: wb.SheetNames[0] }
}

async function main() {
  console.log(`ไฟล์: ${file}`)
  const { total, recs, conflicts, noCode, noDocs, sheet } = readTemplates(file)
  console.log(`ชีต "${sheet}" ${total.toLocaleString("th-TH")} แถว`)
  console.log(`  มีแม่แบบ (ติ๊กเอกสารการเงิน ≥1): ${recs.size}`)
  console.log(`  ไม่มีแม่แบบ (ติ๊กแค่ใบรับสินค้า/ใบสั่งซื้อ): ${noDocs}`)
  if (noCode) console.log(`  ไม่มีรหัสผู้ขาย: ${noCode}`)
  for (const c of conflicts) {
    console.log(`  ⚠️ รหัสซ้ำแต่ติ๊กต่างกัน — ข้าม ${c.code}:`)
    console.log(`      "${c.a.name}" ${c.a.docs.map(templateDocLabel).join(", ")}`)
    console.log(`      "${c.b.name}" ${c.b.docs.map(templateDocLabel).join(", ")}`)
  }
  const patterns = new Map<string, number>()
  for (const r of recs.values()) { const k = r.docs.map(templateDocLabel).join(" + "); patterns.set(k, (patterns.get(k) ?? 0) + 1) }
  console.log(`\nรูปแบบแม่แบบ:`)
  for (const [k, n] of [...patterns].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`)

  const env = readFileSync(path.join(process.cwd(), ".env"), "utf8")
  const uri = env.match(/^MONGO_URI=(.+)$/m)![1].trim().replace(/^["']|["']$/g, "")
  const mdName = env.match(/^MONGO_DB=(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "") ?? "master_data"
  if (mdName === "atms") throw new Error("MONGO_DB ต้องไม่ใช่ 'atms' — ฐานนั้นเป็น read-only ของ scraper")

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 })
  await client.connect()
  try {
    const md = client.db(mdName)
    // ap_supplier มีไม่กี่ร้อยแถว — อ่านทั้งชุดเพื่อรายงานว่าแม่แบบครอบคลุมเจ้าที่มีใบ DD จริงแค่ไหน
    const sup = await md.collection("ap_supplier")
      .find({}, { projection: { _id: 0, name: 1, atmsCode: 1, ddCount: 1 } }).limit(5000).toArray()
    const col = md.collection(COLL)
    const existing = new Map((await col.find({}, { projection: { _id: 0, code: 1, source: 1, docs: 1 } }).limit(10000).toArray())
      .map((d) => [String(d.code ?? ""), d]))

    let hitSup = 0, hitDd = 0, allDd = 0
    for (const x of sup) {
      const n = Number(x.ddCount ?? 0); allDd += n
      if (recs.has(String(x.atmsCode ?? ""))) { hitSup++; hitDd += n }
    }
    console.log(`\nครอบคลุมเจ้าหนี้ที่มีในระบบ: ${hitSup}/${sup.length} ราย · ใบ DD ${hitDd.toLocaleString("th-TH")}/${allDd.toLocaleString("th-TH")} (${allDd ? Math.round((hitDd / allDd) * 100) : 0}%)`)
    const top = sup.filter((x) => !recs.has(String(x.atmsCode ?? ""))).sort((a, b) => Number(b.ddCount ?? 0) - Number(a.ddCount ?? 0)).slice(0, 10)
    console.log(`เจ้าที่ใบ DD เยอะแต่ไม่มีแม่แบบ (ตั้งเองได้ที่ /ap-tracking/suppliers):`)
    for (const x of top) console.log(`  ${String(x.ddCount ?? 0).padStart(5)}  ${x.name} (${x.atmsCode || "ไม่มีรหัส"})`)

    const at = new Date().toISOString()
    let add = 0, update = 0, same = 0, keptManual = 0
    const ops: Parameters<typeof col.bulkWrite>[0] = []
    for (const r of recs.values()) {
      const cur = existing.get(r.code)
      if (cur?.source === "manual") { keptManual++; continue }
      if (cur && (cur.docs ?? []).join() === r.docs.join()) { same++; continue }
      if (cur) update++; else add++
      ops.push({ updateOne: {
        filter: { code: r.code },
        update: {
          $set: { code: r.code, name: r.name, docs: r.docs, source: "excel", updatedBy: IMPORT_BY, updatedAt: at },
          $push: { log: { $each: [{ action: cur ? "นำเข้าใหม่จาก Excel" : "นำเข้าจาก Excel", docs: r.docs, by: IMPORT_BY, at }], $slice: -50 } },
        },
        upsert: true,
      } })
    }
    console.log(`\nจะเขียน: เพิ่มใหม่ ${add} · อัปเดต ${update} · เหมือนเดิม ${same} · ข้ามเพราะคนแก้ในเว็บแล้ว ${keptManual}`)

    if (!WRITE) { console.log(`\n(ดูอย่างเดียว — ใส่ --write เพื่อเขียนจริง)`); return }
    // รหัสว่างได้ (เจ้าที่เพิ่มเองไม่มีใน ATMS ใช้ชื่อเป็นคีย์แทน) → unique เฉพาะที่มีรหัส
    await col.createIndex({ code: 1 }, { unique: true, partialFilterExpression: { code: { $gt: "" } }, name: "code_unique" })
    await col.createIndex({ name: 1 }, { name: "name" })
    if (ops.length) {
      const res = await col.bulkWrite(ops, { ordered: false })
      console.log(`เขียนแล้ว: upsert ${res.upsertedCount} · modified ${res.modifiedCount}`)
    } else console.log("ไม่มีอะไรต้องเขียน")
  } finally {
    await client.close()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
