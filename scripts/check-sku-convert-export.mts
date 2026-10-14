// ตรวจไฟล์ Excel 2 ชีตของ /sku/convert แบบไม่แตะ DB และไม่ต้องมีเบราว์เซอร์
//   รัน: npx tsx scripts/check-sku-convert-export.mts
// ใช้ข้อมูลปลอมที่คุมได้ทุกเคส (ค่าแรง/อะไหล่ · กรอกครบ/ไม่ครบ · ยุบรวมรหัส) แล้วอ่านไฟล์
// ที่ประกอบเสร็จกลับมาเทียบทีละช่อง — ตัวที่ต้องดึงของจริงคือ check-sku-convert-xlsx.mts
import assert from "node:assert"
import { buildExcelBook, buildExcelTable } from "../lib/excel-table"
import { buildCodeBook, emptyEntry } from "../lib/sku-convert-core"
import { entryExportRows } from "../lib/sku-convert-export"
import type { ConvertEntrySource, Entry, MasterCodeRow } from "../lib/sku-convert-types"

let pass = 0
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); process.exitCode = 1 }
}

const codes: MasterCodeRow[] = [
  { dict: "WAREHOUSE", code: "LK", th: "ลาดกระบัง" },
  { dict: "EXPENSE_TYPE", code: "PRT", th: "อะไหล่" }, { dict: "EXPENSE_TYPE", code: "LAB", th: "ค่าแรง" },
  { dict: "SYSTEM_L1", code: "ENG", th: "ระบบเครื่องยนต์" },
  { dict: "SUB_ASSEMBLY_L2", code: "OIL", th: "ระบบน้ำมันเครื่อง", parent: "ENG", meta: {} },
  { dict: "SUB_ASSEMBLY_L2", code: "ENGL", th: "ค่าแรงเครื่องยนต์", parent: "ENG", meta: { expenseType: "LAB" } },
  { dict: "COMPONENT_L3", code: "OFT", th: "กรองน้ำมันเครื่อง", parent: "ENG:OIL", meta: {} },
  { dict: "COMPONENT_L3", code: "OVH", th: "ยกเครื่อง", parent: "ENG:ENGL", meta: { expenseType: "LAB" } },
  { dict: "UNIT", code: "PC", th: "ชิ้น" }, { dict: "UNIT", code: "HR", th: "ชั่วโมง" },
  { dict: "GRADE", code: "G1", th: "แท้ศูนย์นำเข้า", meta: {} },
  { dict: "GRADE", code: "T1", th: "อู่ Tier 1", meta: { expenseType: "LAB" } },
  { dict: "POSITION", code: "GN", th: "ทั่วไป" }, { dict: "POSITION", code: "FR", th: "หน้า" },
  { dict: "VEHICLE_TYPE", code: "ISZ_ALL", th: "Isuzu (ทุกรุ่น)" },
  { dict: "BRAND", code: "NOK", th: "เอ็นโอเค" },
]
const book = buildCodeBook(codes)

const entry = (over: Partial<Entry>): Entry => ({ ...emptyEntry(), wh: "LK", ...over })

const sources: ConvertEntrySource[] = [
  {
    code: "LB10PM00093", name: "กรองเครื่อง ISUZU", warehouse: "ลาดกระบัง", kind: "parts", status: "done",
    entries: [
      entry({
        type: "PRT", l1: "ENG", l2: "OIL", l3: "OFT", nameTh: "กรองน้ำมันเครื่อง", nameEn: "Oil Filter",
        partNo: "8-98018-858-0", oemRef: "OEM-1", unit: "PC", price: "1,250.50", grade: "G1", brand: "NOK",
        positions: ["GN", "FR"], vehicles: ["ISZ_ALL"], qty: 12, atmsCodes: ["LB10PM00093", "LB10PM00094"], note: "ยุบสองรหัส",
      }),
      entry({ type: "PRT", l1: "ENG", l2: "OIL", nameTh: "กรองน้ำมันเครื่อง (เล็ก)", unit: "PC", price: "", qty: 3, atmsCodes: ["LB10PM00093"] }),
    ],
  },
  {
    code: "LB90LB00001", name: "ค่าแรงยกเครื่อง", warehouse: "ลาดกระบัง", kind: "svc", status: "draft",
    entries: [
      entry({ type: "LAB", l1: "ENG", l2: "ENGL", l3: "OVH", nameTh: "ยกเครื่อง", unit: "HR", price: "800", grade: "T1", qty: 5, atmsCodes: ["LB90LB00001"] }),
      entry({ nameTh: "ยังกรอกไม่ครบ", atmsCodes: ["LB90LB00001"] }),   // ไม่มี type/L1/L2 → ไม่มีรหัส SKU
    ],
  },
]

const rows = entryExportRows(sources, book)

console.log("entryExportRows:")
check("แบนทุก entry ออกมาเป็นแถว (2 รหัส × 2 ใบ)", () => assert.equal(rows.length, 4))
check("seq เริ่มที่ 1 ใหม่ทุกรหัส", () => assert.deepEqual(rows.map((r) => r.seq), [1, 2, 1, 2]))
check("รหัส SKU มาจาก skuPreview", () => assert.equal(rows[0].sku, "LK-PRT-ENG-OIL-OFT-####"))
check("กรอกไม่ครบ → ไม่มีรหัส SKU", () => assert.equal(rows[3].sku, ""))
check("L3 ว่าง → ชื่อ L3 ว่าง ไม่ใช่รหัสเปล่า", () => assert.equal(rows[1].l3Th, ""))
check("ชื่อไทยของ L1/L2/L3 ชุดอะไหล่", () => assert.deepEqual(
  [rows[0].l1Th, rows[0].l2Th, rows[0].l3Th], ["ระบบเครื่องยนต์", "ระบบน้ำมันเครื่อง", "กรองน้ำมันเครื่อง"]))
check("ชื่อไทยของ L2/L3 ชุดค่าแรง (คนละตารางกับอะไหล่)", () => assert.deepEqual(
  [rows[2].l2Th, rows[2].l3Th], ["ค่าแรงเครื่องยนต์", "ยกเครื่อง"]))
check("เกรดค่าแรงอยู่คนละชุด ก็ต้องได้ชื่อไทย", () => assert.equal(rows[2].gradeTh, "อู่ Tier 1"))
check("ราคามีลูกน้ำ → เป็นตัวเลขจริง", () => assert.equal(rows[0].price, 1250.5))
check("ราคาว่าง → null ไม่ใช่ 0", () => assert.equal(rows[1].price, null))
check("ตำแหน่งหลายค่า → ชื่อไทยคั่นด้วย , ", () => assert.equal(rows[0].positions, "ทั่วไป, หน้า"))
check("รหัสที่ยุบรวม ตัดรหัสของตัวเองออก", () => assert.equal(rows[0].mergedCodes, "LB10PM00094"))
check("ไม่ยุบรวม → ช่องว่าง", () => assert.equal(rows[1].mergedCodes, ""))
check("รหัสที่ไม่มีใน master_codes คืนรหัสเดิม ไม่ใช่ค่าว่าง", () => {
  const r = entryExportRows([{ ...sources[0], entries: [entry({ type: "PRT", l1: "ENG", l2: "OIL", brand: "ไม่มีจริง" })] }], book)
  assert.equal(r[0].brandTh, "ไม่มีจริง")
})

const { CONVERT_XLSX_COLUMNS, CONVERT_ENTRY_XLSX_COLUMNS, convertXlsxRows, convertEntryXlsxRows } =
  await import("../components/sku-convert/export-xlsx")

const itemRows = sources.map((s) => ({
  code: s.code, name: s.name, warehouse: s.warehouse, wh: "LK", kind: s.kind, group: "กรอง",
  atmsQty: 10, atmsValue: 1000, lastPrice: 100, lastSupplier: "ร้าน ก", status: s.status,
  splitHint: "", haveSku: "", asOf: "2026-09-30T00:00:00.000Z", updatedAt: "2026-10-13T09:00:00.000Z",
  entryCount: s.entries.length, updatedByName: "เนส",
}))

const wb = await buildExcelBook([
  { sheetName: "รหัส ATMS", title: "t", subtitle: "s", columns: CONVERT_XLSX_COLUMNS, rows: convertXlsxRows(itemRows), freezeCols: 2 },
  { sheetName: "SKU ใหม่", title: "t", subtitle: "s", columns: CONVERT_ENTRY_XLSX_COLUMNS, rows: convertEntryXlsxRows(rows), freezeCols: 2 },
])

// หัวคอลัมน์อยู่แถว 5 เพราะทั้งสองชีตมีแถบชื่อกลุ่ม (แถว 4)
const HEAD = 5
const heads = (ws: (typeof wb.worksheets)[number]) => (ws.getRow(HEAD).values as unknown[]).slice(1).map((v) => String(v ?? ""))

console.log("\nworkbook:")
check("ได้ 2 ชีต ชื่อตามลำดับที่ส่ง", () => assert.deepEqual(wb.worksheets.map((w) => w.name), ["รหัส ATMS", "SKU ใหม่"]))
check("ชีต 1 แถวข้อมูลเท่าจำนวนรหัส", () => assert.equal(wb.worksheets[0].rowCount - HEAD, itemRows.length))
check("ชีต 2 แถวข้อมูลเท่าจำนวน SKU", () => assert.equal(wb.worksheets[1].rowCount - HEAD, rows.length))
check("หัวคอลัมน์ครบทั้งสองชีต", () => {
  assert.equal(heads(wb.worksheets[0]).length, CONVERT_XLSX_COLUMNS.length)
  assert.equal(heads(wb.worksheets[1]).length, CONVERT_ENTRY_XLSX_COLUMNS.length)
})
check("ทุกคอลัมน์ของชีต 2 มีช่องข้อมูลจริง (key ไม่หลุด)", () => {
  const cells = convertEntryXlsxRows(rows)[0].cells
  const missing = CONVERT_ENTRY_XLSX_COLUMNS.filter((c) => !(c.key in cells)).map((c) => c.key)
  assert.deepEqual(missing, [])
})
check("ทั้งสองชีตตรึงหัวและ 2 คอลัมน์ซ้าย", () => {
  for (const ws of wb.worksheets) {
    assert.equal(ws.views?.[0]?.ySplit, HEAD)
    assert.equal(ws.views?.[0]?.xSplit, 2)
  }
})
check("ชีต 2: ราคาเขียนเป็นตัวเลข / ช่องว่างเป็นช่องว่างจริง", () => {
  const ws = wb.worksheets[1]
  const col = CONVERT_ENTRY_XLSX_COLUMNS.findIndex((c) => c.key === "price") + 1
  assert.equal(ws.getRow(HEAD + 1).getCell(col).value, 1250.5)
  assert.equal(ws.getRow(HEAD + 2).getCell(col).value, null)
})
check("ชีต 2: ค่าแรงไม่โชว์แบ่งจำนวน", () => {
  const ws = wb.worksheets[1]
  const col = CONVERT_ENTRY_XLSX_COLUMNS.findIndex((c) => c.key === "qty") + 1
  assert.equal(ws.getRow(HEAD + 1).getCell(col).value, 12)      // อะไหล่ → มีค่า
  assert.equal(ws.getRow(HEAD + 3).getCell(col).value, null)    // ค่าแรง → ว่าง
})
check("ชีต 2: ฟิลเตอร์คลุมถึงแถวสุดท้าย", () =>
  assert.equal((wb.worksheets[1].autoFilter as { to: { row: number } }).to.row, HEAD + rows.length))
// ของเดิม (หน้ายาง 2 หน้า) เรียกผ่าน buildExcelTable/downloadExcelTable ชีตเดียว — ต้องไม่เปลี่ยนพฤติกรรม
const one = await buildExcelTable({
  fileName: "x.xlsx", sheetName: "ชีตเดียว", title: "t", subtitle: "s",
  columns: CONVERT_XLSX_COLUMNS, rows: convertXlsxRows(itemRows), freezeCols: 2,
})
check("buildExcelTable เดิมยังได้ workbook ชีตเดียว ชื่อตามที่ส่ง", () => {
  assert.deepEqual(one.worksheets.map((w) => w.name), ["ชีตเดียว"])
  assert.equal(one.worksheets[0].rowCount - HEAD, itemRows.length)
})

console.log(`\nผ่าน ${pass} ข้อ`)
