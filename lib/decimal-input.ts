// lib/decimal-input.ts — แปลงข้อความ ↔ ตัวเลขของช่องกรอกทศนิยม (จำนวน / ราคาต่อหน่วย)
// ทำไมแยก: ช่อง controlled ที่แปลงเป็นตัวเลขทุกครั้งที่พิมพ์ จะกลืนจุดทศนิยม ("2." → 2 → แสดง "2") พิมพ์ 2.30 ไม่ได้

/** "2.30" → 2.3 · "1,100.5" → 1100.5 · ว่าง/ไม่ใช่ตัวเลข → null · "2." (ยังพิมพ์ค้าง) → 2 */
export function parseDecimal(text: string): number | null {
  const t = text.replace(/[,\s]/g, "")
  if (t === "" || t === "." || t === "-") return null
  if (!/^-?\d*\.?\d*$/.test(t)) return null
  const n = parseFloat(t)
  return Number.isFinite(n) ? n : null
}

/** ข้อความที่พิมพ์ได้: ตัวเลข จุดเดียว (และคอมมาคั่นหลัก) · ตัวอักษรอื่นไม่รับ */
export const isTypable = (text: string): boolean => /^[\d,]*\.?\d*$/.test(text)

/** แสดงจำนวน: จำนวนเต็มไม่มีจุด · ทศนิยมแสดงอย่างน้อย 2 หลัก สูงสุด 4 ("2.3" → "2.30", "2.305" → "2.305") */
export function formatQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return ""
  if (Number.isInteger(n)) return String(n)
  const dec = (String(n).split(".")[1] ?? "").length
  return n.toFixed(Math.min(4, Math.max(2, dec)))
}

/** แสดงราคา: ตามที่เก็บ (ไม่บังคับหลัก) */
export const formatPlain = (n: number | null | undefined): string => (n == null || !Number.isFinite(n) ? "" : String(n))
