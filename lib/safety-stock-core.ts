// lib/safety-stock-core.ts
// ตรรกะล้วนของหน้า /safety-stock — ห้าม import อะไรทั้งสิ้น เพื่อให้ทดสอบตรงๆ ด้วย tsx
// และเพื่อให้เบราว์เซอร์เรียกใช้สูตรตัวเดียวกับที่ cron ใช้ได้ (สูตรมีที่เดียว ไม่มีทางเพี้ยนคนละทาง)

export const INVENTORY_ID = "4"
export const WAREHOUSE = "คลังลาดกระบัง"

/** คลังที่ระบบครอบคลุม — id คือ inventory_id ใน ATMS/stockmovement_v5 */
export const WAREHOUSES: { id: string; name: string }[] = [
  { id: "4", name: "คลังลาดกระบัง" },
  { id: "3", name: "คลังสระบุรี" },
  { id: "11", name: "คลังขอนแก่น" },
  { id: "24", name: "คลัง DIST" },
]

/** 365/12 — ใช้แปลงหน่วยเดือน↔วัน ให้ตรงกันทุกที่ */
export const DAYS_PER_MONTH = 365 / 12

export const USAGE_LOOKBACK_MONTHS = 12
export const LT_LOOKBACK_MONTHS = 24
/** ต้องมีอย่างน้อยกี่ครั้งถึงจะเชื่อ lead time รายรหัส — น้อยกว่านี้ใช้ค่ากลางของกลุ่มแทน */
export const LT_MIN_SAMPLES = 3
/** เกินเท่านี้ถือว่าข้อมูลเพี้ยน (PR ค้างในระบบ / จับคู่ผิดใบ) */
export const LT_MAX_DAYS = 365

export type WindowKey = "m3" | "m6" | "m12"
export const DEFAULT_WINDOW: WindowKey = "m6"
export const WINDOW_MONTHS: Record<WindowKey, number> = { m3: 3, m6: 6, m12: 12 }

/** ค่า z ของ service level — 95% เป็นค่าเริ่มต้นที่ตำราคลังสินค้าใช้ทั่วไป */
export const Z_BY_SERVICE: Record<number, number> = { 90: 1.28, 95: 1.65, 99: 2.33 }
export const DEFAULT_Z = Z_BY_SERVICE[95]

export type WindowStat = { m3: number; m6: number; m12: number }
export type LeadTimeSource = "sku" | "group" | "warehouse"
export type Status = "no_usage" | "out" | "below_rop" | "below_min" | "over_max" | "ok"
export type MinVerdict = "too_low" | "too_high" | "ok" | "unknown"

/** เรียงตามความเร่งด่วนที่ทีม store ต้องลงมือ — ใช้ลำดับนี้ทั้งตาราง ตัวกรอง และการ์ด */
export const STATUS_META: { key: Status; th: string; hint: string; tone: string }[] = [
  { key: "out",       th: "ของหมด",          hint: "ไม่มีของในคลังแล้วแต่ยังมีการเบิก", tone: "zinc" },
  { key: "below_rop", th: "ต้องสั่งวันนี้",   hint: "คงเหลือต่ำกว่าจุดสั่งซื้อ ของจะขาดก่อนของใหม่มาถึง", tone: "orange" },
  { key: "below_min", th: "ต่ำกว่า min",     hint: "ต่ำกว่า min ที่ตั้งไว้ใน ATMS แต่ยังไม่ถึงจุดสั่งซื้อ", tone: "amber" },
  { key: "over_max",  th: "เกิน max",        hint: "มีของเกินเพดานที่ตั้งไว้ = จมเงิน", tone: "blue" },
  { key: "no_usage",  th: "ตั้งไว้แต่ไม่ใช้", hint: "ตั้ง min/max ไว้แต่ไม่มีการเบิกเลยตลอด 12 เดือน ควรทบทวน", tone: "violet" },
  { key: "ok",        th: "ปกติ",            hint: "อยู่ในช่วงที่เหมาะสม", tone: "emerald" },
]

export const MIN_VERDICT_META: Record<MinVerdict, { th: string; hint: string }> = {
  too_low:  { th: "min ต่ำไป",  hint: "min ที่ตั้งไว้ต่ำกว่าจุดสั่งซื้อที่คำนวณได้ ของจะขาดก่อนของใหม่มาถึง" },
  too_high: { th: "min สูงไป",  hint: "min ที่ตั้งไว้เกินสองเท่าของจุดสั่งซื้อ เก็บของมากเกินจำเป็น" },
  ok:       { th: "เหมาะสม",    hint: "min ที่ตั้งไว้สอดคล้องกับการใช้จริงและเวลารอของ" },
  unknown:  { th: "ประเมินไม่ได้", hint: "ข้อมูลไม่พอ — ไม่ได้ตั้ง min, ไม่มีการเบิก, หรือ lead time เป็นค่ากลางทั้งคลัง" },
}

export type SnapshotRow = {
  code: string; name: string; group: string; unit: string
  brand: string; oracleCode: string; inventoryId: string
  minQty: number; maxQty: number; stockQty: number
  /** จาก FIFO ของหน้า /deadstock — ข้อมูลประกอบ ไม่ใช่ตัวหลัก */
  fifoRemaining: number; oldestAgeDays: number
  usage: WindowStat; issueCounts: WindowStat
  adu: WindowStat; sdDaily: WindowStat
  /** ยอดเบิกรายเดือน 12 เดือน เรียงเก่า→ใหม่ ตำแหน่งอิงตาม SafetyStockPayload.months (ไม่เก็บป้ายเดือนซ้ำรายแถว
   *  เพราะทุกแถวใช้หน้าต่างเดียวกัน — เก็บ label ซ้ำ 4,100 แถวจะเพิ่มขนาด payload ~1-2 MB โดยไม่จำเป็น) */
  monthly: number[]
  leadTimeDays: number; leadTimeSource: LeadTimeSource; leadTimeSamples: number
  cost: number; value: number
}

export type Derived = {
  adu: number; sdDaily: number
  safetyStock: number; reorderPoint: number
  daysOfSupply: number | null
  status: Status; minVerdict: MinVerdict; suggestQty: number
}

export type SafetyStockPayload = {
  asOf: string
  warehouse: string
  inventoryId: string
  /** วันที่เคลื่อนไหวล่าสุดใน stockmovement_v5 — ใช้เตือนเมื่อ pipeline ต้นทางตายเงียบ */
  latestMovementDate: string | null
  /** เวลาที่ sync min/max จาก ATMS สำเร็จครั้งล่าสุด */
  skuSyncedAt: string | null
  /** ป้ายเดือน "YYYY-MM" 12 ค่า เก่า→ใหม่ — ตำแหน่งเดียวกับ SnapshotRow.monthly ของทุกแถว (เก็บครั้งเดียวระดับ payload) */
  months: string[]
  rows: SnapshotRow[]
}

// ── สถิติพื้นฐาน ────────────────────────────────────────────────────────────
const r2 = (n: number) => Math.round(n * 100) / 100

export function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** SD แบบ sample (หาร n-1) — ตัวอย่างเดียววัดความผันผวนไม่ได้ คืน 0 ไม่ใช่ NaN */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(v)
}

// ── สูตรคลังสินค้า ──────────────────────────────────────────────────────────

export function aduFrom(totalQty: number, months: number): number {
  if (months <= 0) return 0
  return totalQty / (months * DAYS_PER_MONTH)
}

/** ใช้ SD ของยอด**รายเดือน** แล้วแปลงเป็นรายวัน
 *  ถ้าใช้รายวันตรงๆ วันที่ไม่มีการเบิกจะเป็น 0 เต็มไปหมด ทำให้ SD บวมและ ADU ต่ำจนสูตรเพี้ยน
 *  — อะไหล่เบิกเป็นครั้งคราว ไม่ใช่ของที่ใช้ทุกวัน */
export function sdDailyFrom(monthlyQty: number[]): number {
  return stdev(monthlyQty) / Math.sqrt(DAYS_PER_MONTH)
}

/** SS = z × SD_daily × √LT */
export function safetyStockOf(sdDaily: number, leadTimeDays: number, z: number): number {
  if (sdDaily <= 0 || leadTimeDays <= 0) return 0
  return z * sdDaily * Math.sqrt(leadTimeDays)
}

/** ROP = ADU × LT + SS */
export function reorderPointOf(adu: number, leadTimeDays: number, ss: number): number {
  return Math.max(0, adu * Math.max(0, leadTimeDays)) + Math.max(0, ss)
}

export function daysOfSupplyOf(onHand: number, adu: number): number | null {
  if (adu <= 0) return null
  return r2(Math.max(0, onHand) / adu)
}

/** ลำดับสำคัญ: no_usage ต้องคัดออกก่อนเสมอ
 *  ADU/SD/SS/ROP ล้วนคำนวณจากยอดเบิก ถ้าไม่มีการเบิกเลยตัวเลขที่ตามมาเป็นศูนย์หมด
 *  ปล่อยให้ตกไปติด below_min จะทำให้ของที่ควร "เลิกตั้ง min/max"
 *  ไปปนกับของที่ "ต้องสั่งเพิ่ม" ซึ่งเป็นการกระทำคนละทางกัน */
export function statusOf(i: {
  usage12: number; onHand: number; rop: number; minQty: number; maxQty: number
}): Status {
  if (i.usage12 <= 0) return "no_usage"
  if (i.onHand <= 0) return "out"
  if (i.onHand < i.rop) return "below_rop"
  if (i.minQty > 0 && i.onHand < i.minQty) return "below_min"
  if (i.maxQty > 0 && i.onHand > i.maxQty) return "over_max"
  return "ok"
}

/** ห้ามตัดสิน min จาก lead time ที่เป็นค่ากลางทั้งคลัง — ไม่มีข้อมูลรายรหัสเลยแปลว่าเดา */
export function minVerdictOf(minQty: number, rop: number, source: LeadTimeSource): MinVerdict {
  if (source === "warehouse") return "unknown"
  if (minQty <= 0 || rop <= 0) return "unknown"
  if (minQty < rop) return "too_low"
  if (minQty > rop * 2) return "too_high"
  return "ok"
}

/** เติมให้ถึง max ถ้าตั้งไว้ ไม่ได้ตั้งก็เติมถึง ROP บวกของที่จะใช้ระหว่างรอของรอบถัดไป
 *  ปัดขึ้นเสมอ — สั่งของเป็นเศษไม่ได้
 *
 *  usage12 <= 0 (รหัสไม่มีการเบิกเลยใน 12 เดือน — no_usage) ต้องคืน 0 เสมอ ไม่ว่า ROP/ADU จะคำนวณออกมาเท่าไหร่ —
 *  ห้ามแนะนำให้ซื้อของที่ไม่มีความต้องการจริงเด็ดขาด (ค่า default = 1 เพื่อไม่ให้ผู้เรียกเดิม/เทสต์เดิมที่ไม่ได้ส่ง
 *  พารามิเตอร์นี้มาพังพฤติกรรม — เฉพาะ derive() เท่านั้นที่ส่ง r.usage.m12 ของจริงเข้ามา)
 *
 *  onHand ต้อง clamp เป็น 0 ก่อนใช้เสมอ — book balance ติดลบไม่ใช่ "มีของเกินความจำเป็นเผื่อไว้" ทำเหมือนไม่มีของเลย
 *
 *  เมื่อมี max ตั้งไว้ ใช้ Math.max(maxQty, rop) เป็นเป้าหมาย ไม่ใช่ maxQty เพียวๆ — max ที่ตั้งไว้ต่ำกว่า ROP
 *  ที่คำนวณได้จริงมักเป็นค่าเก่าที่ไม่ทันการเบิกที่เปลี่ยนไป สั่งแค่ถึง max จะไม่ถึง ROP เลย รับประกันขาดซ้ำทันที
 *  รอบถัดไป (พรุ่งนี้ก็ยัง below_rop เหมือนเดิม) — ให้ ROP ชนะเมื่อขัดกัน ส่วนความเบี่ยงนี้เองคือสิ่งที่คอลัมน์
 *  "ตรวจ min" ของหน้านี้มีไว้ชี้ให้เห็นอยู่แล้ว (มักขึ้น "min ต่ำไป" คู่กับ max ที่ต่ำกว่า ROP พร้อมกัน) */
export function suggestQtyOf(
  onHand: number, maxQty: number, rop: number, adu: number, lt: number, usage12 = 1
): number {
  if (usage12 <= 0) return 0
  const clampedOnHand = Math.max(0, onHand)
  const target = maxQty > 0 ? Math.max(maxQty, rop) : rop + adu * Math.max(0, lt)
  return Math.max(0, Math.ceil(target - clampedOnHand))
}

// ── การแกะข้อมูลต้นทาง ──────────────────────────────────────────────────────

/** เลข PR ฝังอยู่ต้น `หมายเหตุ` ของแถวรับ เช่น "LBPR26050758/71-5742/153/โม่ใหญ่"
 *  รูปแบบคือ อักษรคลัง 2 ตัว + "PR" + ตัวเลข — "LBMR..." เป็นใบเบิกวัสดุ ไม่ใช่ใบขอซื้อ */
const PR_RE = /^([A-Z]{2}PR\d+)/

export function prCodeFromNote(note: string | null | undefined): string | null {
  const head = (note ?? "").trim().split("/")[0].trim()
  const m = PR_RE.exec(head)
  return m ? m[1] : null
}

/** วันที่ PR มาจาก ATMS เป็น string "DD/MM/YYYY" ส่วนวันที่รับเป็น Date จริงใน v5
 *  คืน null เมื่อข้อมูลเพี้ยน (รับก่อนขอซื้อ / เกิน LT_MAX_DAYS) เพื่อให้ผู้เรียกทิ้งได้เลย */
export function leadTimeDaysBetween(prDate: string, receiveDate: string | Date): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((prDate ?? "").trim())
  if (!m) return null
  const from = Date.UTC(+m[3], +m[2] - 1, +m[1])
  const rd = new Date(receiveDate)
  if (Number.isNaN(rd.getTime())) return null
  const to = Date.UTC(rd.getUTCFullYear(), rd.getUTCMonth(), rd.getUTCDate())
  const days = Math.round((to - from) / 86_400_000)
  if (days < 0 || days > LT_MAX_DAYS) return null
  return days
}

// ── รวม results[] ของ log ซิงก์/build ต่อคลัง — ห้ามทับทั้งก้อน ──────────────
// safety_stock_sync_log เป็น singleton ต่อ trigger เดียว ถือ results[] ของ "ทั้ง 4 คลังรวมกัน"
// ถ้าเขียนทับทั้งก้อนทุกครั้ง (เช่น $set: { results }) คลังที่รอบนี้ไม่ได้แตะ (?inventory= จำกัดคลังเดียว)
// จะหายไปจาก doc และคลังที่ถูกข้ามเพราะ deadline จะเขียนทับข้อมูล freshness ของจริงด้วยค่าว่าง —
// ทำให้แถบเตือน "ข้อมูลไม่สด" ที่ควรยิ่งเข้มขึ้นกลับเงียบไปแทน (ตรงข้ามกับที่ควรเป็น)
/** รวม results[] ของรอบนี้ (thisRun) เข้ากับของเดิมใน doc (existing) แทนการทับทั้งก้อน
 *  - คลังที่รอบนี้ไม่แตะเลย (ไม่อยู่ใน thisRun): คงของเดิมไว้เป๊ะๆ ห้ามหาย
 *  - คลังที่ถูกข้ามเพราะ deadline (thisRun entry มี skipped=true): คงข้อมูลเนื้อหาของเดิมไว้ (freshness ต้องยังจริงและแก่ขึ้นเรื่อยๆ)
 *    แล้วปะแค่ error/skipped ทับ — ถ้าไม่มีของเดิมให้ merge (ไม่เคยรันคลังนี้มาก่อน) ใช้ค่าที่ thisRun คำนวณไว้ตรงๆ
 *  - คลังที่รันจริงรอบนี้ (สำเร็จหรือ error จริงจาก ATMS ไม่ใช่ deadline): แทนที่ของเดิมตามปกติ
 *  เรียงลำดับตาม doc เดิมก่อนเสมอแล้วค่อยเติมคลังใหม่ต่อท้าย + กันซ้ำด้วย inventoryId ไม่ให้ array บวมโตเมื่อรันซ้ำ */
export function mergeWarehouseResults<T extends { inventoryId: string; error: string | null; skipped?: boolean }>(
  existing: T[] | undefined,
  thisRun: T[]
): T[] {
  const thisRunByWarehouse = new Map(thisRun.map((r) => [r.inventoryId, r]))
  const seen = new Set<string>()
  const merged: T[] = []

  for (const old of existing ?? []) {
    if (seen.has(old.inventoryId)) continue // กันซ้ำถ้า doc เดิมมี inventoryId ซ้ำมาก่อนด้วยเหตุใดก็ตาม
    seen.add(old.inventoryId)
    const fresh = thisRunByWarehouse.get(old.inventoryId)
    if (!fresh) merged.push(old)
    else if (fresh.skipped) merged.push({ ...old, error: fresh.error, skipped: true })
    else merged.push(fresh)
  }
  for (const fresh of thisRun) {
    if (seen.has(fresh.inventoryId)) continue
    seen.add(fresh.inventoryId)
    merged.push(fresh)
  }
  return merged
}

// ── ตัวรวม — job และเบราว์เซอร์เรียกตัวนี้ตัวเดียวกัน ──────────────────────
export function derive(r: SnapshotRow, win: WindowKey = DEFAULT_WINDOW, z: number = DEFAULT_Z): Derived {
  const adu = r.adu[win]
  const sdDaily = r.sdDaily[win]
  const lt = r.leadTimeDays
  const ss = safetyStockOf(sdDaily, lt, z)
  const rop = reorderPointOf(adu, lt, ss)
  const onHand = r.stockQty
  return {
    adu,
    sdDaily,
    safetyStock: r2(ss),
    reorderPoint: r2(rop),
    daysOfSupply: daysOfSupplyOf(onHand, adu),
    status: statusOf({ usage12: r.usage.m12, onHand, rop, minQty: r.minQty, maxQty: r.maxQty }),
    minVerdict: minVerdictOf(r.minQty, rop, r.leadTimeSource),
    suggestQty: suggestQtyOf(onHand, r.maxQty, rop, adu, lt, r.usage.m12),
  }
}
