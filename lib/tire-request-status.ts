/**
 * สถานะของ "ใบคำขอเปลี่ยนยาง" — คำนวณจากยางทุกเส้นในใบเสมอ และมีที่เดียวคือไฟล์นี้
 *
 * เดิมแต่ละ endpoint คิดเอง กติกาจึงเพี้ยนกัน: ฝั่งตัดสินรายเส้นคืนได้แค่
 * pending / approved / rejected (ไม่เคยคืน "appointment") ผลคือใบที่นัดยางไว้ครบแล้ว
 * พอมีเส้นใหม่เข้ามาทีหลังและเพิ่งถูกตัดสิน ใบจะถอยไปค้างที่ "approved" ทั้งที่ทุกเส้น
 * มีวันนัดอยู่แล้ว → ปุ่มปิดงานหายไปโดยไม่มีใครรู้ว่าต้องกดนัดซ้ำ
 * (เคสจริง T-0003 / สบ.70-6788: RA8+RA7 นัด 17 ส.ค. แล้ว แต่ RA3+F2 ยังไม่ถูกตัดสิน)
 */

export type RequestItemLike = {
  status?: string
  appointmentDate?: Date | string | null
}

/** ยางที่ถูก "ปิดงาน" ไปแล้วรายเส้น — จบแล้วเหมือน rejected ไม่นับเป็นงานค้าง */
export const ITEM_DONE = "done"

/**
 * วันนัดของยางเส้นนี้ — ใบเก่าที่นัดไว้ "ระดับใบ" ยังใช้วันนั้นได้
 * แต่พอมีเส้นไหนในใบเดียวกันนัดรายเส้นแล้ว ต้องไม่ fallback อีก ไม่งั้นวันนัดของเส้นเดียว
 * จะรั่วไปโชว์ทุกล้อ (กติกาเดียวกับ apptOf() ฝั่งหน้าเว็บ)
 */
export function itemAppointment(
  items: RequestItemLike[],
  it: RequestItemLike,
  requestAppointmentDate?: Date | string | null,
): Date | string | null {
  if (it.appointmentDate) return it.appointmentDate
  const perItem = items.some((x) => x.appointmentDate)
  return perItem ? null : (requestAppointmentDate ?? null)
}

/**
 * สถานะใบจากยางทุกเส้น — ลำดับการตัดสินสำคัญ:
 *   มีเส้นค้างตัดสิน            → pending    (ห้ามพาใบไปขั้นนัด/ปิด ทับเส้นที่ยังไม่ตัดสิน)
 *   มีเส้นอนุมัติที่ยังไม่ปิดงาน → นัดครบทุกเส้น ? appointment : approved
 *   ที่เหลือปิดงานไปแล้วอย่างน้อย 1 เส้น → done
 *   นอกนั้น                     → rejected
 */
export function rollupRequestStatus(
  items: RequestItemLike[],
  requestAppointmentDate?: Date | string | null,
): string {
  if (!items.length) return "pending"

  const statusOf = (it: RequestItemLike) => it.status ?? "pending"
  if (items.some((it) => statusOf(it) === "pending")) return "pending"

  const open = items.filter((it) => statusOf(it) === "approved")
  if (open.length) {
    const allScheduled = open.every((it) => !!itemAppointment(items, it, requestAppointmentDate))
    return allScheduled ? "appointment" : "approved"
  }

  return items.some((it) => statusOf(it) === ITEM_DONE) ? "done" : "rejected"
}
