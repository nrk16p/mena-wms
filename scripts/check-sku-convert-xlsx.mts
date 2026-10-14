// ตรวจไฟล์ Excel ของ /sku/convert แบบไม่ต้องเปิดเบราว์เซอร์
//   รัน: npx tsx scripts/check-sku-convert-xlsx.mts
// ดึงแถวจริงจาก Mongo (อ่านอย่างเดียว) → ประกอบ workbook 2 ชีต → อ่านกลับมาตรวจหัวคอลัมน์/จำนวนแถว
// แล้วเขียนไฟล์ตัวอย่างไว้ที่ tmp/ ให้เปิดดูด้วยตาได้
import { readFileSync } from "node:fs"
import path from "node:path"
import { MongoClient } from "mongodb"
import { buildExcelBook } from "../lib/excel-table"
import { exportEntries, exportItems, loadCodeBook } from "../lib/sku-convert-db"
import { entryExportRows } from "../lib/sku-convert-export"

const env = readFileSync(path.join(process.cwd(), ".env"), "utf8")
const uri = env.match(/^MONGO_URI=(.+)$/m)![1].trim().replace(/^["']|["']$/g, "")
const DB = env.match(/^MONGO_DB=(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "") ?? "master_data"

const c = new MongoClient(uri)
await c.connect()
const t0 = Date.now()
const rows = await exportItems(c.db(DB))
console.log(`ดึงได้ ${rows.length.toLocaleString()} แถว ใน ${Date.now() - t0}ms`)
console.log("ตัวอย่างแถวแรก:", JSON.stringify(rows[0], null, 1))

const byStatus = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {})
const byWh = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.warehouse]: (m[r.warehouse] ?? 0) + 1 }), {})
console.log("แยกตามสถานะ:", byStatus)
console.log("แยกตามคลัง:", byWh)
console.log("แถวที่ไม่มีราคาล่าสุด:", rows.filter((r) => r.lastPrice == null).length)

// ชีต 2: SKU ใหม่ที่กรอกไว้แล้ว
const sources = await exportEntries(c.db(DB))
const book = await loadCodeBook(c.db(DB))
const entries = entryExportRows(sources, book)
console.log(`\nSKU ใหม่ที่กรอกไว้ ${entries.length.toLocaleString()} รายการ จาก ${sources.length.toLocaleString()} รหัส`)
console.log("ที่ยังไม่มีรหัส SKU (กรอกไม่ครบ):", entries.filter((e) => !e.sku).length)
// ช่องที่ยังเป็นรหัสเปล่าแปลว่า master_codes ไม่มีรหัสนั้น — ควรเป็น 0 ถ้าชุด dictionary ครบ
const rawL2 = entries.filter((e) => e.l2 && e.l2Th === e.l2).length
console.log("L2 ที่หาชื่อไทยไม่เจอ:", rawL2, rawL2 ? "⚠️ ตรวจ master_codes" : "✓")

// ประกอบไฟล์ด้วย builder ตัวเดียวกับที่หน้าเว็บใช้ (import ตรง ๆ ไม่ได้เพราะ export-xlsx เรียก
// downloadExcelBook ที่ต้องมี document) — ใช้ COLUMNS ชุดเดียวกันผ่าน buildExcelBook
const { CONVERT_XLSX_COLUMNS, CONVERT_ENTRY_XLSX_COLUMNS, convertXlsxRows, convertEntryXlsxRows } =
  await import("../components/sku-convert/export-xlsx")
const wb = await buildExcelBook([
  {
    sheetName: "รหัส ATMS", title: "แปลงรหัส ATMS → SKU ใหม่", subtitle: "ตรวจด้วยสคริปต์",
    columns: CONVERT_XLSX_COLUMNS, rows: convertXlsxRows(rows), freezeCols: 2,
  },
  {
    sheetName: "SKU ใหม่", title: "SKU ใหม่ที่กรอกไว้แล้ว", subtitle: "ตรวจด้วยสคริปต์",
    columns: CONVERT_ENTRY_XLSX_COLUMNS, rows: convertEntryXlsxRows(entries), freezeCols: 2,
  },
])
const out = path.join(process.cwd(), "tmp", "sku-convert-check.xlsx")
await wb.xlsx.writeFile(out)

for (const [ws, expect] of [[wb.worksheets[0], rows.length], [wb.worksheets[1], entries.length]] as const) {
  const heads = (ws.getRow(5).values as unknown[]).slice(1).map((v) => String(v ?? ""))
  console.log(`\n[${ws.name}] หัวคอลัมน์ (${heads.length}):`, heads.join(" | "))
  console.log("แถวข้อมูลในชีต:", ws.rowCount - 5, "· ตรงกับที่ดึงมา:", ws.rowCount - 5 === expect ? "✓" : "✗")
  console.log("ตรึงหัว/คอลัมน์:", JSON.stringify(ws.views?.[0]))
  console.log("แถวแรก:", (ws.getRow(6).values as unknown[]).slice(1)
    .map((v) => (v instanceof Date ? v.toISOString().slice(0, 16) : String(v ?? ""))).join(" | "))
}
console.log("\nไฟล์ตัวอย่าง:", out)
await c.close()
