// lib/tire-stock-safety.ts
// สโคปของ "สต็อกยาง" ที่หน้า /tire/{branch}/stock-tire ใช้ — เป็นชุดข้อมูลเดียวกับหน้า /safety-stock
// แต่ตัดเหลือเฉพาะยางที่นับเป็นเส้น กติกาการตัดอยู่ที่นี่ที่เดียว ทั้งฝั่ง API และฝั่งเบราว์เซอร์อ่านตัวนี้ตัวเดียวกัน
//
// ห้ามแตะ lib/safety-stock.ts หรือ /api/safety-stock — หน้า Safety Stock ต้องเห็นข้อมูลครบทุกกลุ่มเหมือนเดิม
// การกรองทำที่ชั้นบนสุด (route ของหน้านี้) หลังอ่าน snapshot ออกมาแล้วเท่านั้น
import type { SnapshotRow } from "@/lib/safety-stock-core"

/** inventory_id ของ ATMS/stockmovement_v5 — คนละชุดกับ branch_id ที่ lib/atms-sync.ts ใช้
 *  (ที่นั่น 2=ลาดกระบัง, 3=สระบุรี — ที่นี่ 4=ลาดกระบัง, 3=สระบุรี) อย่าสลับกัน */
export const BRANCH_INVENTORY_ID: Record<string, string> = {
  latkrabang: "4",
  saraburi:   "3",
}

/** กลุ่มสินค้าและหน่วยที่ถือว่าเป็น "ยาง" ของหน้านี้
 *  กลุ่ม "ยาง" ยังมีหน่วยอื่นปนอยู่ (ลูก/วง/ชุด/แผ่น/อัน = จุ๊บ ยางรอง ชุดปะ ฯลฯ) และหน่วย "เส้น" ก็มีในกลุ่มอื่น
 *  (สายไฮดรอลิก สายลม) — ต้องเข้าเงื่อนไขทั้งสองอย่างพร้อมกันถึงจะเป็นยางรถที่นับเป็นเส้นจริงๆ */
export const TIRE_GROUP = "ยาง"
export const TIRE_UNIT  = "เส้น"

export function isTireRow(r: Pick<SnapshotRow, "group" | "unit">): boolean {
  return r.group.trim() === TIRE_GROUP && r.unit.trim() === TIRE_UNIT
}
