// ตรวจไฟล์ Excel ของ /sku/convert แบบไม่ต้องเปิดเบราว์เซอร์
//   รัน: npx tsx scripts/check-sku-convert-xlsx.mts
// ดึงแถวจริงจาก Mongo (อ่านอย่างเดียว) → ประกอบ workbook → อ่านกลับมาตรวจหัวคอลัมน์/จำนวนแถว
// แล้วเขียนไฟล์ตัวอย่างไว้ที่ tmp/ ให้เปิดดูด้วยตาได้
import { readFileSync } from "node:fs"
import path from "node:path"
import { MongoClient } from "mongodb"
import { buildExcelTable } from "../lib/excel-table"
import { exportItems } from "../lib/sku-convert-db"

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

// ประกอบไฟล์ด้วย builder ตัวเดียวกับที่หน้าเว็บใช้ (import ตรง ๆ ไม่ได้เพราะ export-xlsx เรียก
// downloadExcelTable ที่ต้องมี document) — ใช้ COLUMNS ชุดเดียวกันผ่าน buildExcelTable
const { CONVERT_XLSX_COLUMNS, convertXlsxRows } = await import("../components/sku-convert/export-xlsx")
const wb = await buildExcelTable({
  fileName: "x.xlsx", sheetName: "แปลงรหัส ATMS", title: "แปลงรหัส ATMS → SKU ใหม่",
  subtitle: "ตรวจด้วยสคริปต์", columns: CONVERT_XLSX_COLUMNS, rows: convertXlsxRows(rows), freezeCols: 2,
})
const out = path.join(process.cwd(), "tmp", "sku-convert-check.xlsx")
await wb.xlsx.writeFile(out)

const ws = wb.worksheets[0]
const headRow = ws.getRow(5)
const heads = (headRow.values as unknown[]).slice(1).map((v) => String(v ?? ""))
console.log(`\nหัวคอลัมน์ (${heads.length}):`, heads.join(" | "))
console.log("แถวข้อมูลในชีต:", ws.rowCount - 5, "· ตรงกับที่ดึงมา:", ws.rowCount - 5 === rows.length ? "✓" : "✗")
console.log("ตรึงหัว/คอลัมน์:", JSON.stringify(ws.views?.[0]))
const first = ws.getRow(6)
console.log("แถวแรกในชีต:", (first.values as unknown[]).slice(1).map((v) => (v instanceof Date ? v.toISOString().slice(0, 16) : String(v ?? ""))).join(" | "))
console.log("\nไฟล์ตัวอย่าง:", out)
await c.close()
