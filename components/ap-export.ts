// คอลัมน์ Excel แบบแบนของใบ DD — ใช้ร่วมกันทุกปุ่ม export ของ /ap-tracking (รายเดือน · รายปี ·
// รายเจ้าหนี้) ให้ไฟล์ทุกใบมีหัวคอลัมน์ชุดเดียวกัน เอาไป pivot ต่อได้โดยไม่ต้อง map ใหม่
// วันที่ทุกช่องเป็นวันไทย (ictDate) — review.at เก็บเป็น UTC ถ้า slice ตรง ๆ จะเป็นเมื่อวานช่วงเช้า
import { ictDate, overdueDays } from "@/lib/ap-tracking"
import type { ApRow } from "@/components/ap-types"

export const apFlatRow = (r: ApRow) => ({
  "เลขใบรับของ": r.depositCode,
  "วันที่รับของ": r.receivedAt,
  "คลัง": r.warehouse,
  "ซัพพลายเออร์": r.supplier,
  "PO": r.purchaseOrder,
  "ทะเบียนรถ": r.vehicle ?? "",
  "เบอร์รถ": r.fleetNo ?? "",
  // ยอดที่ใช้ทำงานคือรวมสุทธิ · เก็บยอดก่อน VAT กับ VAT ไว้คนละช่องให้กระทบยอดกับ ATMS ได้
  "รวมสุทธิ": r.netAmount,
  "ยอดก่อน VAT": r.amount,
  "VAT": r.vat ? Math.round((r.netAmount - r.amount) * 100) / 100 : 0,
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
  // 3 ช่องนี้เพิ่ม 14/10/2026 — กล่อง "เลขที่เอกสาร" ของใบ DD มี 5 ช่อง แต่ไฟล์เดิมออกให้แค่ 2
  // ต่อท้ายของเดิม (ไม่ย้ายคอลัมน์) ตามที่ผู้ใช้สั่ง เพื่อไม่ให้ไฟล์เก่า/สูตร pivot ที่อ้างลำดับเดิมเพี้ยน
  "เลขที่ใบกำกับภาษี": (r.docNos.taxInvoiceNos ?? []).join(", "),
  "เลขที่บิลเงินสด": (r.docNos.cashBillNos ?? []).join(", "),
  "เลขที่ NC/AC": (r.docNos.ncAcNos ?? []).join(", "),
  "หมายเหตุ": r.note,
})

export const AP_FLAT_WIDTHS = [14, 11, 16, 30, 13, 12, 10, 12, 13, 9, 10, 11, 11, 11, 22, 11, 11, 18, 18, 18, 18, 18, 14, 24].map((w) => ({ wch: w }))

// แท็บ "รอประกบ" — ไฟล์ไว้ไล่ตามเอกสารจากเจ้าหนี้ (ผู้ใช้สั่ง 29/10/2026)
// ใบในแท็บนี้ยังไม่เคยกดส่ง ช่องกดส่ง/ผ่าน/จ่าย/PV ของชุดรวมจะว่างทั้งไฟล์ จึงใช้ชุดคอลัมน์ของตัวเอง
// อายุใบ = วันนับจากวันที่รับของถึงวันนี้ (เวลาไทย) · เกินกำหนด = ค่าเดียวกับที่ตารางใช้ (API คิดให้)
export const apWaitRow = (r: ApRow, today: string) => ({
  "เลขใบรับของ": r.depositCode,
  "วันที่รับของ": r.receivedAt,
  "อายุใบ (วัน)": overdueDays(r.receivedAt, today),
  "คลัง": r.warehouse,
  "ซัพพลายเออร์": r.supplier,
  "PO": r.purchaseOrder,
  "ทะเบียนรถ": r.vehicle ?? "",
  "เบอร์รถ": r.fleetNo ?? "",
  "รวมสุทธิ": r.netAmount,
  "เครดิตเทอม": r.creditTerm,
  "ครบกำหนด": r.dueDate,
  "เกินกำหนด (วัน)": r.overdue,
  "ไฟล์แนบ": r.fileCount,
  "หมายเหตุ PR": r.prNote ?? "",
  "หมายเหตุ": r.note,
})

export const AP_WAIT_WIDTHS = [14, 11, 9, 16, 30, 13, 12, 10, 12, 10, 11, 10, 8, 30, 24].map((w) => ({ wch: w }))

// แท็บ "ไม่ผ่าน" — review.at ของใบตีกลับคือเวลาที่บัญชีตีกลับ ถ้าใช้ชุดรวมจะไปโผล่ใต้หัว "ผ่านเมื่อ"
// จ่ายแล้วเมื่อ: ตีกลับชนะทุกขั้น (ดู apStage) ใบที่โอนไปแล้วแต่ถูกตีกลับทีหลังจึงอยู่แท็บนี้ด้วย
export const apRejectedRow = (r: ApRow) => ({
  "เลขใบรับของ": r.depositCode,
  "วันที่รับของ": r.receivedAt,
  "คลัง": r.warehouse,
  "ซัพพลายเออร์": r.supplier,
  "PO": r.purchaseOrder,
  "ทะเบียนรถ": r.vehicle ?? "",
  "เบอร์รถ": r.fleetNo ?? "",
  "รวมสุทธิ": r.netAmount,
  "เครดิตเทอม": r.creditTerm,
  "กดส่งเมื่อ": r.sentMarkedDate ?? "",
  "ส่งโดย": r.sentMarkedBy ?? "",
  "ตีกลับเมื่อ": ictDate(r.review?.at ?? ""),
  "ตีกลับโดย": r.review?.by ?? "",
  "เหตุผลที่ไม่ผ่าน": r.review?.note ?? "",
  "จ่ายแล้วเมื่อ": r.paid?.date ?? "",
  "หมายเหตุ": r.note,
})

export const AP_REJECTED_WIDTHS = [14, 11, 16, 30, 13, 12, 10, 12, 10, 11, 22, 11, 22, 40, 11, 24].map((w) => ({ wch: w }))
