// แปลง entries ที่กรอกไว้ → แถวของชีต "SKU ใหม่" ในไฟล์ Excel ของ /sku/convert
//
// ทำที่ฝั่ง server เพราะต้องใช้ CodeBook (master_codes) มาแปลงรหัสเป็นชื่อไทย — ถ้าส่ง
// CodeBook ทั้งก้อนไปแปลงที่เบราว์เซอร์ก็เท่ากับโหลด dictionary ทั้งชุดมาใช้ครั้งเดียว
// ไม่แตะ DB และไม่แตะ document เลย สคริปต์ตรวจจึงเรียกตรงได้
import { skuPreview } from "./sku-convert-core"
import type { CodeBook, CodeOption, ConvertEntryExportRow, ConvertEntrySource } from "./sku-convert-types"

/** รหัส → ชื่อไทย; ไม่เจอก็คืนรหัสเดิมไว้ ดีกว่าช่องว่างที่อ่านไม่ออกว่าหายไปหรือไม่มี */
function label(list: CodeOption[] | undefined, code: string): string {
  if (!code) return ""
  return list?.find((o) => o.code === code)?.th ?? code
}

/** หลายรหัส → ชื่อไทยคั่นด้วย ", " (ตำแหน่ง/รุ่นรถ กรอกได้หลายค่าใน SKU เดียว) */
function labels(list: CodeOption[] | undefined, codes: string[]): string {
  return codes.map((c) => label(list, c)).filter(Boolean).join(", ")
}

/**
 * L2/L3 แยกตาราง LAB กับไม่ LAB และ key ต่างกัน (L2 คีย์ด้วย L1 · L3 คีย์ด้วย "L1:L2")
 * ค่าแรงกับอะไหล่ใช้คนละชุด — หาในชุดที่ตรงประเภทไม่เจอต้องลองอีกชุดเสมอ ไม่งั้น
 * SKU ค่าแรงจะโชว์เป็นรหัสเปล่าทั้งคอลัมน์
 */
function l2Label(book: CodeBook, l1: string, l2: string): string {
  if (!l2) return ""
  const hit = book.l2[l1]?.find((o) => o.code === l2) ?? book.l2Lab[l1]?.find((o) => o.code === l2)
  return hit?.th ?? l2
}

function l3Label(book: CodeBook, l1: string, l2: string, l3: string): string {
  if (!l3) return ""
  const key = `${l1}:${l2}`
  const hit = book.l3[key]?.find((o) => o.code === l3) ?? book.l3Lab[key]?.find((o) => o.code === l3)
  return hit?.th ?? l3
}

/** เกรดของค่าแรงเป็นอีกชุด (อู่ Tier) — หาในชุดอะไหล่ไม่เจอให้ลองชุดค่าแรง */
function gradeLabel(book: CodeBook, grade: string): string {
  if (!grade) return ""
  const hit = book.grade.find((o) => o.code === grade) ?? book.gradeLab.find((o) => o.code === grade)
  return hit?.th ?? grade
}

/** "1,250.50" → 1250.5 · ช่องว่าง/กรอกไม่เป็นตัวเลข → null (เว้นช่องไว้ ไม่ใส่ 0 ให้เข้าใจผิด) */
function price(v: string): number | null {
  const n = Number(String(v ?? "").replace(/,/g, "").trim())
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null
}

/** 1 รหัส ATMS → หลายแถว (แถวละ SKU ใหม่หนึ่งรหัส) เรียงตามลำดับใบที่กรอกไว้ */
export function entryExportRows(sources: ConvertEntrySource[], book: CodeBook): ConvertEntryExportRow[] {
  return sources.flatMap((s) =>
    (s.entries ?? []).map((e, i) => ({
      code: s.code,
      srcName: s.name,
      warehouse: s.warehouse,
      kind: s.kind,
      status: s.status,
      seq: i + 1,
      sku: skuPreview(e),
      wh: e.wh,       whTh: label(book.wh, e.wh),
      type: e.type,   typeTh: label(book.type, e.type),
      l1: e.l1,       l1Th: label(book.l1, e.l1),
      l2: e.l2,       l2Th: l2Label(book, e.l1, e.l2),
      l3: e.l3,       l3Th: l3Label(book, e.l1, e.l2, e.l3),
      nameTh: e.nameTh,
      nameEn: e.nameEn,
      partNo: e.partNo,
      oemRef: e.oemRef,
      unit: e.unit,   unitTh: label(book.unit, e.unit),
      price: price(e.price),
      grade: e.grade, gradeTh: gradeLabel(book, e.grade),
      brand: e.brand, brandTh: label(book.brand, e.brand),
      positions: labels(book.position, e.positions ?? []),
      vehicles: labels(book.vehicle, e.vehicles ?? []),
      qty: e.qty,
      // ตัวแรกคือรหัสของแถวนี้เอง — ที่เหลือคือรหัสอื่นที่ถูกยุบมารวม จึงมีความหมายเฉพาะตัวที่ 2 ขึ้นไป
      mergedCodes: (e.atmsCodes ?? []).slice(1).join(", "),
      note: e.note,
    })),
  )
}
