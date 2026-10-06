// key แคชของ GET /api/tire-due (รายการฝั่งแอดมิน)
//
// ผลขึ้นกับเวลาแค่จุดเดียว: เส้นที่พักแจ้งเตือนไว้ (snoozedUntil เทียบกับตอนนี้)
// ระหว่าง "เวลาพักที่หมดถัดไป" สองจุด ผลคิวรีเหมือนเดิมทุกครั้ง → ใส่จุดนั้น (epoch) ลงใน key
// พอเลยเวลาพักของเส้นไหน key เปลี่ยนเอง = โหลดใหม่ทันที ไม่เสิร์ฟของเก่าที่ยังซ่อนเส้นที่หมดพักแล้ว

export type TireDueParams = {
  branch: string
  unit: string
  q: string
  group: string
  includeSnoozed: boolean
  countsOnly: boolean
}

/** ทุก query param ที่เปลี่ยนผล + epoch (เวลาพักที่หมดถัดไป, null = ไม่มีเส้นไหนพักค้าง) */
export function tireDueKey(p: TireDueParams, epoch: number | null): string {
  return `tire-due:${JSON.stringify([p.branch, p.unit, p.q, p.group, p.includeSnoozed, p.countsOnly, epoch])}`
}

/** เวลาพักที่ยังไม่ถึง (> now) ตัวที่ใกล้สุด — ถึงเวลาพอดีถือว่าหมดพักแล้ว เหมือน snoozedUntil $lte now */
export function nextSnoozeEnd(ends: number[], now: number): number | null {
  let next: number | null = null
  for (const e of ends) if (e > now && (next === null || e < next)) next = e
  return next
}
