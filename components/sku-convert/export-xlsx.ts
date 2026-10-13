// ไฟล์ Excel ของหน้ารายการแปลงรหัส ATMS (/sku/convert)
// คอลัมน์ตามที่ผู้ใช้สั่ง 13/10/2026 · เอาทุกคลังทุกประเภททั้งชุด ไม่สนตัวกรองบนหน้า
// (ไฟล์ไว้ส่งต่อ/แบ่งงาน คนรับไม่รู้ว่าคนกดตั้งตัวกรองอะไรไว้ตอนนั้น)
import { downloadExcelTable, XLS_DATE_FMT, XLS_DATETIME_FMT, xlsDate, type ExcelCol, type ExcelRow } from "@/lib/excel-table"
import type { ConvertExportRow } from "@/lib/sku-convert-types"

const STATUS_LABEL: Record<string, string> = { todo: "ยังไม่ทำ", draft: "ร่าง", done: "ครบ" }
// สีเดียวกับชิปสถานะบนหน้าเว็บ (ARGB) — คนที่เปิดไฟล์กับคนที่ดูหน้าเว็บต้องเห็นภาพเดียวกัน
const STATUS_INK: Record<string, string> = { todo: "FF6B7C72", draft: "FF1D4ED8", done: "FF0B8A5E" }
const KIND_LABEL: Record<string, string> = { parts: "อะไหล่", svc: "ค่าแรง / บริการ" }

export const CONVERT_XLSX_COLUMNS: ExcelCol[] = [
  { key: "code",      header: "รหัส ATMS",   width: 16, group: "รหัสเดิมใน ATMS" },
  { key: "name",      header: "ชื่อ",         width: 40, group: "รหัสเดิมใน ATMS", wrap: true },
  { key: "warehouse", header: "คลัง",         width: 16, group: "รหัสเดิมใน ATMS" },
  { key: "kind",      header: "ประเภท",       width: 14, group: "รหัสเดิมใน ATMS" },
  { key: "group",     header: "กลุ่ม",        width: 22, group: "รหัสเดิมใน ATMS" },
  { key: "atmsQty",   header: "คงเหลือ",      width: 10, align: "right", numFmt: "#,##0.##", group: "สต็อก ATMS" },
  { key: "atmsValue", header: "มูลค่า",       width: 14, align: "right", numFmt: "#,##0.00", group: "สต็อก ATMS" },
  { key: "asOf",      header: "ตัดยอดเมื่อ",  width: 12, align: "center", numFmt: XLS_DATE_FMT, group: "สต็อก ATMS" },
  { key: "lastPrice",    header: "ราคาล่าสุด",  width: 12, align: "right", numFmt: "#,##0.00", group: "ซื้อล่าสุด" },
  { key: "lastSupplier", header: "ผู้ขายล่าสุด", width: 34, group: "ซื้อล่าสุด", wrap: true },
  { key: "status",     header: "สถานะ",             width: 11, align: "center", group: "ความคืบหน้า" },
  { key: "entryCount", header: "SKU ใหม่ (กี่รหัส)", width: 15, align: "right", numFmt: "#,##0", group: "ความคืบหน้า" },
  { key: "splitHint",  header: "ควรแยก",            width: 28, group: "ความคืบหน้า", wrap: true },
  { key: "haveSku",    header: "มี SKU อยู่แล้ว",    width: 18, group: "ความคืบหน้า" },
  { key: "updatedByName", header: "คนแก้",      width: 18, group: "ความคืบหน้า" },
  { key: "updatedAt",     header: "แก้เมื่อ",   width: 17, align: "center", numFmt: XLS_DATETIME_FMT, group: "ความคืบหน้า" },
]

/** แปลงแถวจาก API เป็นแถวของไฟล์ — แยกออกมาเพื่อให้ scripts/check-sku-convert-xlsx.ts
 *  ตรวจเนื้อในไฟล์ได้โดยไม่ต้องมี document (downloadExcelTable ต้องอยู่ในเบราว์เซอร์) */
export function convertXlsxRows(rows: ConvertExportRow[]): ExcelRow[] {
  return rows.map((r) => ({
    // งานที่ยังไม่เริ่มแต่ยังมีของคงเหลือ = ของที่เบิกได้แต่ยังไม่มี SKU ใหม่รองรับ ให้เด่นไว้
    tone: r.status === "todo" && r.atmsQty > 0 ? "warn" : undefined,
    ink: { status: STATUS_INK[r.status] ?? "FF14271C" },
    cells: {
      code: r.code,
      name: r.name,
      warehouse: r.warehouse,
      kind: KIND_LABEL[r.kind] ?? r.kind,
      group: r.group,
      atmsQty: r.atmsQty,
      atmsValue: r.atmsValue,
      asOf: xlsDate(r.asOf),
      // ไม่มีราคา/ผู้ขายล่าสุดคือ "ไม่เคยซื้อในช่วงที่ดึงมา" — เว้นว่างไว้ ไม่ใส่ 0 ให้เข้าใจผิด
      lastPrice: r.lastPrice ?? null,
      lastSupplier: r.lastSupplier ?? "",
      status: STATUS_LABEL[r.status] ?? r.status,
      entryCount: r.entryCount,
      splitHint: r.splitHint ?? "",
      haveSku: r.haveSku ?? "",
      updatedByName: r.updatedByName,
      updatedAt: xlsDate(r.updatedAt, true),
    },
  }))
}

/** คืนจำนวนแถวที่เขียนลงไฟล์ */
export async function downloadConvertXlsx(rows: ConvertExportRow[], asOf: string): Promise<number> {
  const done = rows.filter((r) => r.status === "done").length
  const d = xlsDate(asOf, true) ?? new Date()
  const stamp = `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${d.getFullYear() + 543 - 2500}`
  return downloadExcelTable({
    fileName: `แปลงรหัส ATMS ${stamp}.xlsx`,
    sheetName: "แปลงรหัส ATMS",
    title: "แปลงรหัส ATMS → SKU ใหม่",
    subtitle: `ทุกคลังทุกประเภท ${rows.length.toLocaleString("th-TH")} รหัส · ครบแล้ว `
      + `${done.toLocaleString("th-TH")} รหัส · ส่งออก ${d.toLocaleString("th-TH")}`,
    columns: CONVERT_XLSX_COLUMNS,
    rows: convertXlsxRows(rows),
    freezeCols: 2,
  })
}
