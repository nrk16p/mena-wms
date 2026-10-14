// ไฟล์ Excel ของหน้ารายการแปลงรหัส ATMS (/sku/convert) — ไฟล์เดียว 2 ชีต
//   ชีต "รหัส ATMS" = งานทั้งชุดและความคืบหน้า (ทุกรหัส)
//   ชีต "SKU ใหม่"  = ผลที่กรอกไว้ แถวละ 1 SKU เอาไปสร้าง SKU จริงต่อได้ (เฉพาะรหัสที่กรอกแล้ว)
// คอลัมน์ชีตแรกตามที่ผู้ใช้สั่ง 13/10/2026 · ชีตที่สองเพิ่ม 14/10/2026
// เอาทุกคลังทุกประเภททั้งชุด ไม่สนตัวกรองบนหน้า — ไฟล์ไว้ส่งต่อ/แบ่งงาน คนรับไม่รู้ว่า
// คนกดตั้งตัวกรองอะไรไว้ตอนนั้น (ยืนยันอีกครั้ง 14/10/2026)
import { downloadExcelBook, XLS_DATE_FMT, XLS_DATETIME_FMT, xlsDate, type ExcelCol, type ExcelRow } from "@/lib/excel-table"
import type { ConvertEntryExportRow, ConvertExportRow } from "@/lib/sku-convert-types"

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

export const CONVERT_ENTRY_XLSX_COLUMNS: ExcelCol[] = [
  { key: "code",      header: "รหัส ATMS",    width: 16, group: "รหัสเดิมใน ATMS" },
  { key: "srcName",   header: "ชื่อเดิม",      width: 32, group: "รหัสเดิมใน ATMS", wrap: true },
  { key: "warehouse", header: "คลัง",          width: 16, group: "รหัสเดิมใน ATMS" },
  { key: "status",    header: "สถานะรหัส",    width: 11, align: "center", group: "รหัสเดิมใน ATMS" },
  { key: "seq",       header: "SKU ที่",       width: 8,  align: "center", numFmt: "#,##0", group: "SKU ใหม่" },
  { key: "sku",       header: "รหัส SKU",      width: 26, group: "SKU ใหม่" },
  { key: "nameTh",    header: "ชื่อไทย",       width: 36, group: "SKU ใหม่", wrap: true },
  { key: "nameEn",    header: "ชื่ออังกฤษ",    width: 28, group: "SKU ใหม่", wrap: true },
  { key: "whTh",      header: "คลัง",          width: 14, group: "ผังรหัส" },
  { key: "type",      header: "ประเภท",        width: 8,  align: "center", group: "ผังรหัส" },
  { key: "typeTh",    header: "ประเภท (ชื่อ)", width: 16, group: "ผังรหัส" },
  { key: "l1",        header: "L1",            width: 7,  align: "center", group: "ผังรหัส" },
  { key: "l1Th",      header: "ระบบ (L1)",     width: 22, group: "ผังรหัส" },
  { key: "l2",        header: "L2",            width: 7,  align: "center", group: "ผังรหัส" },
  { key: "l2Th",      header: "ชุดย่อย (L2)",  width: 24, group: "ผังรหัส" },
  { key: "l3",        header: "L3",            width: 7,  align: "center", group: "ผังรหัส" },
  { key: "l3Th",      header: "ชิ้นส่วน (L3)", width: 24, group: "ผังรหัส" },
  { key: "partNo",    header: "Part No.",      width: 20, group: "รายละเอียด" },
  { key: "oemRef",    header: "OEM",           width: 20, group: "รายละเอียด" },
  { key: "brandTh",   header: "แบรนด์",        width: 18, group: "รายละเอียด" },
  { key: "gradeTh",   header: "เกรด",          width: 20, group: "รายละเอียด" },
  { key: "unitTh",    header: "หน่วย",         width: 10, align: "center", group: "รายละเอียด" },
  { key: "price",     header: "ราคา",          width: 12, align: "right", numFmt: "#,##0.00", group: "รายละเอียด" },
  { key: "positions", header: "ตำแหน่ง",       width: 22, group: "รายละเอียด", wrap: true },
  { key: "vehicles",  header: "รุ่นรถ",        width: 26, group: "รายละเอียด", wrap: true },
  { key: "qty",       header: "แบ่งจำนวน",     width: 11, align: "right", numFmt: "#,##0.##", group: "แบ่งของเดิม" },
  { key: "mergedCodes", header: "รหัสที่ยุบรวม", width: 26, group: "แบ่งของเดิม", wrap: true },
  { key: "note",      header: "หมายเหตุ",      width: 30, group: "แบ่งของเดิม", wrap: true },
]

/** แถวของชีต "SKU ใหม่" — แยกออกมาให้ scripts/check-sku-convert-xlsx.mts ตรวจได้เหมือนชีตแรก */
export function convertEntryXlsxRows(rows: ConvertEntryExportRow[]): ExcelRow[] {
  return rows.map((r) => ({
    // SKU ที่ยังกรอกไม่ครบจะยังไม่มีรหัส (skuPreview ต้องมี wh/type/L1/L2 ก่อน) — เน้นไว้ให้เห็นว่าต้องกลับไปแก้
    tone: r.sku ? undefined : "warn",
    ink: { status: STATUS_INK[r.status] ?? "FF14271C" },
    cells: {
      code: r.code,
      srcName: r.srcName,
      warehouse: r.warehouse,
      status: STATUS_LABEL[r.status] ?? r.status,
      seq: r.seq,
      sku: r.sku,
      nameTh: r.nameTh,
      nameEn: r.nameEn,
      whTh: r.whTh,
      type: r.type,
      typeTh: r.typeTh,
      l1: r.l1,
      l1Th: r.l1Th,
      l2: r.l2,
      l2Th: r.l2Th,
      l3: r.l3,
      l3Th: r.l3Th,
      partNo: r.partNo,
      oemRef: r.oemRef,
      brandTh: r.brandTh,
      gradeTh: r.gradeTh,
      unitTh: r.unitTh,
      price: r.price,
      positions: r.positions,
      vehicles: r.vehicles,
      // ค่าแรง/บริการไม่มีการแบ่งจำนวน — เว้นว่าง ไม่ใส่ 0 ให้เข้าใจผิดว่าแบ่งไว้ 0
      qty: r.kind === "svc" ? null : r.qty,
      mergedCodes: r.mergedCodes,
      note: r.note,
    },
  }))
}

/** คืนจำนวนแถวที่เขียนลงไฟล์ (รวมสองชีต) */
export async function downloadConvertXlsx(
  rows: ConvertExportRow[],
  entries: ConvertEntryExportRow[],
  asOf: string,
): Promise<number> {
  const done = rows.filter((r) => r.status === "done").length
  const d = xlsDate(asOf, true) ?? new Date()
  const stamp = `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${d.getFullYear() + 543 - 2500}`
  const n = (v: number) => v.toLocaleString("th-TH")
  const stampedAt = `ส่งออก ${d.toLocaleString("th-TH")}`

  return downloadExcelBook(`แปลงรหัส ATMS ${stamp}.xlsx`, [
    {
      sheetName: "รหัส ATMS",
      title: "แปลงรหัส ATMS → SKU ใหม่",
      subtitle: `ทุกคลังทุกประเภท ${n(rows.length)} รหัส · ครบแล้ว ${n(done)} รหัส · ${stampedAt}`,
      columns: CONVERT_XLSX_COLUMNS,
      rows: convertXlsxRows(rows),
      freezeCols: 2,
    },
    {
      sheetName: "SKU ใหม่",
      title: "SKU ใหม่ที่กรอกไว้แล้ว",
      subtitle: `${n(entries.length)} SKU จาก ${n(new Set(entries.map((e) => e.code)).size)} รหัส ATMS`
        + ` · รหัสที่ยังไม่ได้กรอกไม่อยู่ในชีตนี้ · ${stampedAt}`,
      columns: CONVERT_ENTRY_XLSX_COLUMNS,
      rows: convertEntryXlsxRows(entries),
      freezeCols: 2,
    },
  ])
}
