/**
 * อ่านไฟล์ .xlsx ที่ดาวน์โหลดจาก Google Sheet "[2026]ข้อมูลยางสระบุรี" → แถวพร้อมเขียนลง WMS
 *
 * ใช้ช่วงทำคู่กัน (ชีตยังเป็นตัวหลัก) — นำเข้าซ้ำได้เรื่อย ๆ จนกว่าจะตัดมาใช้ WMS อย่างเดียว
 * ค่าที่กรอกในชีตนำเข้าตามนั้น ไม่แก้ ยกเว้นวันที่ 2 เรื่องที่รู้ว่าชีตพังเอง:
 *   1. วันที่ที่ชีตแปลงเป็นวันที่จริงเอง มักสลับวัน/เดือน (ชีตอ่าน DD/MM เป็น MM/DD) → เทียบกับอายุ ปี/ด/ว
 *      ที่กรอกไว้ ถ้าสลับแล้วตรงกว่า ใช้แบบสลับ
 *   2. บันทึกการจัดเก็บ: วันที่จริงสลับทุกแถว และมีปีพิมพ์ผิดเป็นปีหน้า (2027)
 */
import * as XLSX from "xlsx"
import {
  ROW_COLS, STORAGE_COLS, SALES_COLS, EMPTY_OPTIONS, prepFields, sizeFromText, parseDate, isoDate, ageYmd, toNum,
  type AnyRow, type SheetCol, type SheetOptions, type TyreSize,
} from "@/lib/tyre-sheet"

type Cell = string | number | boolean | null | undefined

type DateParts = { y: number; m: number; d: number }

/** เซลล์วันที่: ตัวเลข serial ของ Excel → ส่วนวัน/เดือน/ปี (ไม่ผ่าน Date กันโซนเวลาเลื่อน) */
function serialParts(v: number): DateParts | null {
  const p = XLSX.SSF.parse_date_code(v)
  return p && p.y ? { y: p.y, m: p.m, d: p.d } : null
}

function cellDate(v: Cell): string | null {
  if (typeof v === "number") {
    const p = serialParts(v)
    return p ? isoDate(p.y, p.m, p.d) : null
  }
  return parseDate(v)
}

/** วันที่ที่ชีตแปลงเอง — เลือกระหว่างตามที่เห็นกับสลับวัน/เดือน โดยเทียบอายุที่กรอกไว้ */
function installDateFix(v: Cell, bookingIso: string | null, stored: { y: number | null; m: number | null; d: number | null }): { iso: string | null; swapped: boolean } {
  if (typeof v !== "number") return { iso: parseDate(v), swapped: false }
  const p = serialParts(v)
  if (!p) return { iso: null, swapped: false }
  const asIs = isoDate(p.y, p.m, p.d)
  if (p.d > 12 || p.d === p.m) return { iso: asIs, swapped: false }
  const swapped = isoDate(p.y, p.d, p.m)
  const score = (iso: string | null) => {
    if (!iso || !bookingIso) return Infinity
    if (iso > bookingIso) return Infinity // ใส่ยางหลังวันจองไม่ได้
    const a = ageYmd(iso, bookingIso)
    if (!a || stored.y === null) return 0
    return Math.abs(a.y * 365 + a.m * 30 + a.d - ((stored.y ?? 0) * 365 + (stored.m ?? 0) * 30 + (stored.d ?? 0)))
  }
  const sa = score(asIs), ss = score(swapped)
  return ss < sa ? { iso: swapped, swapped: true } : { iso: asIs, swapped: false }
}

function cellValue(c: SheetCol, v: Cell): unknown {
  if (c.type === "date") return cellDate(v)
  if (c.type === "num") return toNum(v)
  return v === null || v === undefined ? "" : String(v).replace(/\s+$/g, "").trim()
}

function aoa(ws: XLSX.WorkSheet): Cell[][] {
  return XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: false })
}

export type ImportResult = {
  rows: AnyRow[]
  storage: AnyRow[]
  sales: AnyRow[]
  options: SheetOptions | null
  stats: {
    sheetsFound: string[]
    bySize: Record<string, number>
    prep: number
    storage: number
    sales: number
    installDatesSwapped: number
    storageDatesFixed: number
    exactDuplicatesSkipped: number
  }
}

export function parseTyreWorkbook(buf: ArrayBuffer | Buffer): ImportResult {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? "array" : "buffer", cellDates: false })
  const stats: ImportResult["stats"] = {
    sheetsFound: [], bySize: {}, prep: 0, storage: 0, sales: 0,
    installDatesSwapped: 0, storageDatesFixed: 0, exactDuplicatesSkipped: 0,
  }
  const rows: AnyRow[] = []
  const seen = new Set<string>()

  // ── แท็บยางนอก 11R22.5 / 1000-20 (A–AN ตรงกับ ROW_COLS) ─────────────────────────
  for (const name of wb.SheetNames) {
    const n = name.toLowerCase()
    if (!name.includes("ยางนอก") || n.includes("query") || n.includes("copy")) continue
    const size = sizeFromText(name)
    if (!size) continue
    stats.sheetsFound.push(name)
    const data = aoa(wb.Sheets[name])
    // หาแถวหัวตาราง (มีคำว่า "วันที่จอง") — ปกติแถว 2
    const hi = data.findIndex((r) => r.some((c) => String(c ?? "").includes("วันที่จอง")))
    for (const r of data.slice(hi + 1)) {
      const doc = masterRow(r, size, stats)
      if (!doc) continue
      const sig = JSON.stringify(ROW_COLS.slice(1, 40).map((c) => doc[c.key] ?? null)) + size
      if (seen.has(sig)) { stats.exactDuplicatesSkipped++; continue }
      seen.add(sig)
      rows.push(doc)
      stats.bySize[size] = (stats.bySize[size] ?? 0) + 1
    }
  }

  // ── เตรียมข้อมูล (ยังไม่ส่ง) — ลำดับคอลัมน์ต่างจากแท็บหลัก (ตาม mapRow ใน Apps Script) ─────────
  const prepName = wb.SheetNames.find((s) => s.trim() === "เตรียมข้อมูล")
  if (prepName) {
    stats.sheetsFound.push(prepName)
    const data = aoa(wb.Sheets[prepName])
    const hi = data.findIndex((r) => r.some((c) => String(c ?? "").includes("วันที่จอง")))
    for (const r of data.slice(hi + 1)) {
      const doc = prepRow(r)
      if (!doc) continue
      rows.push(doc)
      stats.prep++
    }
  }

  // ── บันทึกการจัดเก็บยาง ─────────────────────────────────────────────────────────
  const storage: AnyRow[] = []
  const stName = wb.SheetNames.find((s) => s.includes("บันทึกการจัดเก็บ"))
  if (stName) {
    stats.sheetsFound.push(stName)
    const data = aoa(wb.Sheets[stName])
    const thisYear = new Date().getFullYear()
    for (const r of data.slice(1)) {
      if (!r.some((c) => c !== null && String(c).trim() !== "")) continue
      const doc: AnyRow = {}
      STORAGE_COLS.forEach((c, i) => { doc[c.key] = cellValue(c, r[i]) })
      // วันที่จริงในแท็บนี้สลับวัน/เดือนทุกแถว
      if (typeof r[0] === "number") {
        const p = serialParts(r[0])
        if (p && p.d <= 12) { doc.date = isoDate(p.y, p.d, p.m); stats.storageDatesFixed++ }
      }
      // ปีพิมพ์ผิดเป็นปีหน้า (เช่น 19/8/2027)
      if (typeof doc.date === "string" && Number(doc.date.slice(0, 4)) > thisYear) {
        doc.date = `${thisYear}${doc.date.slice(4)}`
        stats.storageDatesFixed++
      }
      if (!doc.serial && !doc.date) continue
      storage.push(doc)
    }
    stats.storage = storage.length
  }

  // ── Sheet16 ขายเหมา ─────────────────────────────────────────────────────────────
  const sales: AnyRow[] = []
  const saleName = wb.SheetNames.find((s) => s.trim().toLowerCase() === "sheet16")
  if (saleName) {
    stats.sheetsFound.push(saleName)
    const data = aoa(wb.Sheets[saleName])
    for (const r of data.slice(1)) {
      const item = String(r[0] ?? "").trim()
      if (!item) continue // แถวคิดเลขเล่นด้านล่างไม่มีชื่อรายการ
      const doc: AnyRow = {}
      SALES_COLS.forEach((c, i) => { doc[c.key] = cellValue(c, r[i]) })
      sales.push(doc)
    }
    stats.sales = sales.length
  }

  // ── options (dropdown) ────────────────────────────────────────────────────────
  let options: SheetOptions | null = null
  const optName = wb.SheetNames.find((s) => s.trim().toLowerCase() === "options")
  if (optName) {
    stats.sheetsFound.push(optName)
    const data = aoa(wb.Sheets[optName]).slice(1)
    const col = (i: number) => [...new Set(data.map((r) => String(r[i] ?? "").trim()).filter(Boolean))]
    const plateHeadTail: Record<string, string> = {}
    for (const r of data) {
      const p = String(r[1] ?? "").trim(), ht = String(r[2] ?? "").trim()
      if (p && ht) plateHeadTail[p] = ht
    }
    options = {
      drivers: col(0),
      plates: col(1),
      plateHeadTail,
      positions: col(3),
      tyreTypes: col(4).length ? col(4) : EMPTY_OPTIONS.tyreTypes,
      storageTypes: col(5).length ? col(5) : EMPTY_OPTIONS.storageTypes,
      symptoms: col(6).length ? col(6) : EMPTY_OPTIONS.symptoms,
    }
  }

  return { rows, storage, sales, options, stats }
}

function masterRow(r: Cell[], size: TyreSize, stats: ImportResult["stats"]): AnyRow | null {
  const doc: AnyRow = { size, stage: "sent" }
  ROW_COLS.slice(0, 40).forEach((c, i) => { doc[c.key] = cellValue(c, r[i]) })
  if (!doc.mrNo && !doc.oldSerial && !doc.plate) return null
  const fix = installDateFix(r[2], doc.bookingDate, { y: toNum(r[19]), m: toNum(r[20]), d: toNum(r[21]) })
  doc.installDate = fix.iso
  if (fix.swapped) stats.installDatesSwapped++
  doc.pr = String(doc.pr ?? "").trim()
  doc.newSerial = ""
  return doc
}

/** แถวในแท็บเตรียมข้อมูล → คอลัมน์ชุดหลัก (ตาม mapRow ของ Apps Script เดิม) */
function prepRow(r: Cell[]): AnyRow | null {
  const doc: AnyRow = {
    stage: "prep",
    size: sizeFromText(r[8]) ?? null,
    seq: null,
    ...prepFields((i) => r[i], (v) => cellDate(v as Cell)),
    newSerial: "",
  }
  if (!doc.mrNo && !doc.oldSerial && !doc.plate) return null
  return doc
}
