// ===========================================================================
// ส่งออกตารางเป็นไฟล์ Excel ที่ "จัดหน้ามาแล้ว"
// ===========================================================================
// SheetJS ตัวฟรี (xlsx) เขียนสไตล์ลงไฟล์ไม่ได้ — ไฟล์ที่ได้จึงเป็นตารางเปล่า ๆ ที่คนรับ
// ต้องมานั่งปรับความกว้าง/ตรึงหัวเองทุกครั้ง ที่นี่ใช้ ExcelJS เพื่อให้ไฟล์ที่ส่งต่อกัน
// "เปิดมาแล้วใช้งานได้เลย": หัวตารางแบรนด์ ตรึงหัว+คอลัมน์ซ้าย ฟิลเตอร์พร้อม แถบสลับสี
// ตัวเลขจัดขวาพร้อม format และสั่งพิมพ์ออกมาแล้วหัวตารางตามไปทุกหน้า
//
// โหลด exceljs ตอนกดปุ่มเท่านั้น (ก้อนใหญ่) — ห้าม import ไว้บนสุดของหน้า
// ที่ import ตรง ๆ ได้เพราะ package ชี้ browser build ให้เองแล้ว

import { BKK_OFFSET_MS } from "@/lib/bkk-time"

/* ── โทนสี: ชุดเดียวกับหน้าเว็บ WMS (ARGB ไม่มี # และมี alpha นำหน้า) ────────── */

const INK        = "FF14271C"  // เขียวเข้มเกือบดำ — ตัวหนังสือหลัก
const INK_MUTED  = "FF6B7C72"
const BRAND      = "FF1B8C4B"  // เขียว WMS — พื้นหัวตาราง
const BAND       = "FFE4EFE8"  // เขียวจาง — แถบชื่อกลุ่มคอลัมน์
const GRID       = "FFE4EEE8"
const ZEBRA      = "FFF7FBF8"
const WARN_FILL  = "FFFFF3E6"  // ส้มจาง — แถวที่ต้องรีบดู
const DANGER_FILL = "FFFDECEC" // แดงจาง — แถวที่มีปัญหา
const LINK       = "FF1D4ED8"

/** Tahoma มีอยู่ในทุกเครื่อง Windows และมีสระ/วรรณยุกต์ไทยครบ — ฟอนต์สวยกว่านี้เสี่ยงคนรับไม่มี */
const FONT = "Tahoma"

/* ── รูปร่างของตารางที่จะส่งออก ─────────────────────────────────────────────── */

export type ExcelAlign = "left" | "center" | "right"

export type ExcelCol = {
  key:      string
  header:   string
  width:    number
  /** ชื่อกลุ่มที่จะไปรวมเป็นแถบเหนือหัวคอลัมน์ — คอลัมน์ที่ติดกันและกลุ่มเดียวกันจะถูก merge ให้ */
  group?:   string
  align?:   ExcelAlign
  /** format ของ Excel เช่น "#,##0" — ใส่เฉพาะคอลัมน์ที่ค่าเป็นตัวเลข/วันที่จริง */
  numFmt?:  string
  wrap?:    boolean
}

export type ExcelCellValue = string | number | Date | null | undefined | { text: string; hyperlink: string }

export type ExcelRow = {
  cells: Record<string, ExcelCellValue>
  /** ระบายทั้งแถวเพื่อเน้น — ใช้กับแถวที่ต้องรีบดู ไม่ใช่ใช้แทนคอลัมน์สถานะ */
  tone?: "warn" | "danger"
  /** สีตัวอักษรเฉพาะบางช่อง (ARGB) เช่น ให้ช่องสถานะสีเดียวกับชิปบนเว็บ */
  ink?: Record<string, string>
}

export type ExcelTable = {
  fileName:   string
  sheetName:  string
  title:      string
  /** บรรทัดเล็กใต้หัวเรื่อง — ควรบอกว่าไฟล์นี้กรองอะไรมาและส่งออกเมื่อไหร่ */
  subtitle?:  string
  columns:    ExcelCol[]
  rows:       ExcelRow[]
  /** ตรึงกี่คอลัมน์แรกไว้ตอนเลื่อนขวา — ควรพอให้ยังรู้ว่าแถวนี้ของใคร */
  freezeCols?: number
}

/* ── ตัวช่วยเรื่องเวลา ───────────────────────────────────────────────────────── */

/**
 * แปลงเป็น Date ที่ "เวลาท้องถิ่นของเครื่อง = เวลาไทย"
 *
 * ExcelJS แปลงวันที่ลงไฟล์ด้วยเวลาท้องถิ่นของเครื่องที่กดส่งออก ถ้าโยน Date ดิบเข้าไป
 * เครื่องที่ตั้ง timezone เป็น UTC (โน้ตบุ๊กที่ลง Windows ใหม่เจอบ่อย) จะได้เวลาเพี้ยนไป 7 ชม.
 * และวันที่ของงานกะดึกจะเลื่อนไปคนละวัน — จึงประกอบ Date ใหม่จาก "ส่วนประกอบเวลาไทย"
 */
export function xlsDate(s?: string | null, withTime = false): Date | null {
  if (!s) return null
  const t = Date.parse(s)
  if (isNaN(t)) return null
  const b = new Date(t + BKK_OFFSET_MS)
  return withTime
    ? new Date(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), b.getUTCHours(), b.getUTCMinutes())
    : new Date(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())
}

/** format วันที่/เวลาสำหรับคอลัมน์ที่ค่าเป็น Date จริง */
export const XLS_DATE_FMT = "dd/mm/yyyy"
export const XLS_DATETIME_FMT = "dd/mm/yyyy hh:mm"

/* ── ตัวส่งออก ──────────────────────────────────────────────────────────────── */

const thin = { style: "thin" as const, color: { argb: GRID } }

/** ประกอบ workbook ที่จัดหน้าเสร็จแล้ว — แยกจากตัวดาวน์โหลดเพื่อให้ทดสอบนอกเบราว์เซอร์ได้ */
export async function buildExcelTable(t: ExcelTable) {
  const ExcelJS = await import("exceljs")

  const cols = t.columns
  const n = cols.length
  const hasGroups = cols.some((c) => c.group)

  // แถว 1 หัวเรื่อง · 2 คำอธิบาย · 3 เว้น · 4 แถบกลุ่ม (ถ้ามี) · หัวคอลัมน์ · ข้อมูล
  const groupRow = hasGroups ? 4 : 0
  const headRow  = hasGroups ? 5 : 4
  const firstData = headRow + 1

  const wb = new ExcelJS.Workbook()
  wb.creator = "MENA WMS"
  wb.created = new Date()

  const ws = wb.addWorksheet(t.sheetName, {
    views: [{
      state: "frozen",
      xSplit: Math.min(t.freezeCols ?? 0, n),
      ySplit: headRow,
    }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      // สั่งพิมพ์แล้วหัวตารางตามไปทุกหน้า — ตารางกว้าง 27 คอลัมน์ ถ้าไม่มีหัวคือเดาไม่ออกว่าคอลัมน์อะไร
      printTitlesRow: `${headRow}:${headRow}`,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  })

  ws.columns = cols.map((c) => ({ key: c.key, width: c.width }))
  ws.properties.defaultRowHeight = 17

  /* หัวเรื่อง */
  ws.mergeCells(1, 1, 1, n)
  const title = ws.getCell(1, 1)
  title.value = t.title
  title.font = { name: FONT, size: 14, bold: true, color: { argb: INK } }
  title.alignment = { vertical: "middle" }
  ws.getRow(1).height = 26

  ws.mergeCells(2, 1, 2, n)
  const sub = ws.getCell(2, 1)
  sub.value = t.subtitle ?? ""
  sub.font = { name: FONT, size: 9, color: { argb: INK_MUTED } }
  sub.alignment = { vertical: "middle" }
  ws.getRow(2).height = 16
  ws.getRow(3).height = 6

  /* แถบชื่อกลุ่มคอลัมน์ — ตารางกว้างมาก ถ้าไม่มีแถบนี้ต้องไล่อ่านหัวทีละช่อง */
  if (hasGroups) {
    const r = ws.getRow(groupRow)
    r.height = 19
    let i = 0
    while (i < n) {
      const g = cols[i].group ?? ""
      let j = i
      while (j + 1 < n && (cols[j + 1].group ?? "") === g) j++
      if (j > i) ws.mergeCells(groupRow, i + 1, groupRow, j + 1)
      const cell = ws.getCell(groupRow, i + 1)
      cell.value = g
      cell.font = { name: FONT, size: 9.5, bold: true, color: { argb: BRAND } }
      cell.alignment = { horizontal: "center", vertical: "middle" }
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } }
      cell.border = { top: thin, left: thin, right: thin }
      i = j + 1
    }
  }

  /* หัวคอลัมน์ */
  const head = ws.getRow(headRow)
  head.height = 30
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1)
    cell.value = c.header
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } }
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } }
    cell.border = {
      top:    { style: "thin", color: { argb: BRAND } },
      bottom: { style: "medium", color: { argb: "FF14683B" } },
      left:   { style: "thin", color: { argb: "FF3FA96C" } },
      right:  { style: "thin", color: { argb: "FF3FA96C" } },
    }
  })

  /* ข้อมูล */
  t.rows.forEach((r, ri) => {
    const row = ws.getRow(firstData + ri)
    row.height = 18
    const bg =
      r.tone === "danger" ? DANGER_FILL :
      r.tone === "warn"   ? WARN_FILL :
      ri % 2 === 1        ? ZEBRA : null

    cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1)
      const v = r.cells[c.key]
      const isLink = !!v && typeof v === "object" && !(v instanceof Date)

      // "" กับ undefined ต้องเป็นช่องว่างจริง ไม่ใช่สตริงเปล่าที่ทำให้ COUNTA นับเกิน
      cell.value = v === "" || v === undefined || v === null ? null : (v as never)

      cell.font = {
        name: FONT, size: 10,
        color: { argb: isLink ? LINK : r.ink?.[c.key] ?? INK },
        underline: isLink || undefined,
        bold: r.ink?.[c.key] ? true : undefined,
      }
      cell.alignment = {
        horizontal: c.align ?? (typeof v === "number" ? "right" : "left"),
        vertical: c.wrap ? "top" : "middle",
        wrapText: c.wrap,
      }
      if (c.numFmt) cell.numFmt = c.numFmt
      cell.border = { top: thin, bottom: thin, left: thin, right: thin }
      if (bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } }
    })
  })

  /* เปิดไฟล์มาแล้วกรองต่อได้ทันที — คนรับไฟล์ส่วนใหญ่ไม่ได้เข้าหน้าเว็บ */
  if (t.rows.length > 0) {
    ws.autoFilter = {
      from: { row: headRow, column: 1 },
      to:   { row: headRow + t.rows.length, column: n },
    }
  }

  return wb
}

/** สร้างไฟล์แล้วสั่งดาวน์โหลดเลย — คืนจำนวนแถวที่เขียนจริงไว้ให้เอาไปขึ้น toast */
export async function downloadExcelTable(t: ExcelTable): Promise<number> {
  const wb = await buildExcelTable(t)

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = t.fileName
  a.click()
  // ปล่อยช้าหน่อย — บาง browser ยังอ่าน blob อยู่ตอน click เพิ่งคืนค่า
  setTimeout(() => URL.revokeObjectURL(url), 2000)

  return t.rows.length
}
