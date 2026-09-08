// คอลัมน์ Excel แบบแบนของใบ DD — ใช้ร่วมกันทุกปุ่ม export ของ /ap-tracking (รายเดือน · รายปี ·
// รายเจ้าหนี้) ให้ไฟล์ทุกใบมีหัวคอลัมน์ชุดเดียวกัน เอาไป pivot ต่อได้โดยไม่ต้อง map ใหม่
// วันที่ทุกช่องเป็นวันไทย (ictDate) — review.at เก็บเป็น UTC ถ้า slice ตรง ๆ จะเป็นเมื่อวานช่วงเช้า
import { ictDate } from "@/lib/ap-tracking"
import type { ApRow } from "@/components/ap-types"

export const apFlatRow = (r: ApRow) => ({
  "เลขใบรับของ": r.depositCode,
  "วันที่รับของ": r.receivedAt,
  "คลัง": r.warehouse,
  "ซัพพลายเออร์": r.supplier,
  "PO": r.purchaseOrder,
  "ทะเบียนรถ": r.vehicle ?? "",
  "เบอร์รถ": r.fleetNo ?? "",
  "ยอดเงิน": r.amount,
  "เครดิตเทอม": r.creditTerm,
  "ประเภทการส่ง": r.pay?.type || r.sentType,
  "กดส่งเมื่อ": r.sentMarkedDate ?? "",
  "ผ่านเมื่อ": ictDate(r.review?.at ?? ""),
  "ตรวจโดย": r.review?.by ?? "",
  "กำหนดจ่าย": r.pay?.payDate ?? "",
  "จ่ายจริง": r.paid?.date ?? "",
  "เลข PV": (r.paid?.paymentNos ?? []).join(", "),
  "เลขที่ Voucher": (r.docNos.voucherNos ?? []).join(", "),
  "เลขที่ใบวางบิล": (r.docNos.billingNoteNos ?? []).join(", "),
  "หมายเหตุ": r.note,
})

export const AP_FLAT_WIDTHS = [14, 11, 16, 30, 13, 12, 10, 12, 10, 11, 11, 11, 22, 11, 11, 18, 18, 18, 24].map((w) => ({ wch: w }))
