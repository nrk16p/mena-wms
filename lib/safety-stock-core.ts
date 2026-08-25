// lib/safety-stock-core.ts
// ตรรกะล้วนของหน้า /safety-stock — ห้าม import อะไรทั้งสิ้น เพื่อให้ทดสอบตรงๆ ด้วย tsx
// และเพื่อให้เบราว์เซอร์เรียกใช้สูตรตัวเดียวกับที่ cron ใช้ได้ (สูตรมีที่เดียว ไม่มีทางเพี้ยนคนละทาง)

export const INVENTORY_ID = "4"
export const WAREHOUSE = "คลังลาดกระบัง"

/** คลังที่ระบบครอบคลุม — id คือ inventory_id ใน ATMS/stockmovement_v5
 *  ตัดเหลือ 2 คลัง (ขอบเขตที่อนุมัติ 2569-08) — ขอนแก่น (11) และ DIST (24) ออกจากขอบเขตทั้งหมด
 *  ทั้ง sync/build เดินตาม array นี้อัตโนมัติอยู่แล้ว จึงไม่ต้องแก้ที่อื่น */
export const WAREHOUSES: { id: string; name: string }[] = [
  { id: "4", name: "คลังลาดกระบัง" },
  { id: "3", name: "คลังสระบุรี" },
]

/** เวลารอของตามนโยบาย (วัน) — ใช้แทนเวลารอของที่วัดได้จริงในทุกสูตร (SS/ROP/แนะนำสั่ง) ของหน้า /safety-stock
 *  ตั้งแต่ 2569-08 (ขอบเขตที่อนุมัติ) เพราะ PR→รับของจับคู่ได้ไม่ครบทุกรหัส ทำให้ lead time รายรหัส/รายกลุ่ม
 *  มีทั้งเชื่อได้และเดา ปนกันจนเทียบรหัสต่อรหัสไม่ตรงกัน — ใช้ค่าคงที่ตัวเดียวทั้งระบบให้เทียบกันได้ตรงๆ
 *  ค่าที่วัดได้จริง (SnapshotRow.leadTimeDays จาก build) ยังคงเก็บไว้เหมือนเดิมทุกประการเพื่อใช้เป็นข้อมูลอ้างอิง
 *  (แสดงในหน้าต่างรายละเอียดรายรหัสของ /safety-stock) และเพราะ /tire/* ยังใช้ค่าที่วัดได้จริงนี้ตรงๆ ต่อไป
 *  ไม่ผ่านนโยบาย 7 วันนี้เลย — ห้ามเขียนทับ SnapshotRow.leadTimeDays ที่ build เก็บไว้ */
export const LEAD_TIME_DAYS = 7

/** กลุ่มสินค้าที่ตัดออกจากมุมมอง "นโยบายอะไหล่" ของหน้า /safety-stock (ไม่รวม "เครื่องมือยาง" — เก็บไว้ตามที่ตกลง)
 *  กรองที่ layer อ่าน (lib/safety-stock.ts) เท่านั้น ไม่ใช่ตอน build — เพราะ safety_stock_snapshot เป็นชุดข้อมูล
 *  ที่ /tire/{branch}/stock-tire ใช้ร่วมด้วย (ดู lib/tire-stock-safety.ts) กรองตอน build จะทำให้แถวกลุ่มนี้
 *  หายไปจาก collection เลย พา /tire/* ไปด้วยทั้งที่ไม่ได้ตั้งใจ */
export const EXCLUDED_PRODUCT_GROUP = "ยาง"

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
/** "policy" ไม่เคยเก็บลง SnapshotRow.leadTimeSource (ยังเป็น sku/group/warehouse ของค่าที่วัดได้จริงเสมอ)
 *  ใช้เฉพาะภายใน derive() เมื่อมีการส่ง lead time override เข้ามา (ดู derive() ด้านล่าง) เพื่อบอก minVerdictOf
 *  ว่ากำลังตัดสินด้วยเวลารอของตามนโยบาย ไม่ใช่ค่าที่วัดได้ — จึงไม่ต้องกดเป็น unknown แบบเดียวกับ "warehouse" */
export type LeadTimeSource = "sku" | "group" | "warehouse" | "policy"
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

/** อภิธานศัพท์ย่อ — นิยามเดียวใช้ร่วมกันทุกที่ (การ์ดใน /safety-stock, tooltip หัวตาราง, หน้า /safety-stock/baseline)
 *  เพื่อไม่ให้คำอธิบายเพี้ยนคนละความหมายในแต่ละหน้า — เขียนสำหรับทีมหน้างานอ่าน บอกว่าตัวเลขหมายถึงอะไรและควรทำอะไรต่อ
 *  ไม่ใช่สูตรพีชคณิต (สูตรอยู่ที่หน้า /safety-stock/baseline โดยเฉพาะ)
 *  ต้องใช้ได้ทั้งกับหน้า /safety-stock (อะไหล่ทั่วไป, เวลารอของคงที่ 7 วัน) และหน้า /tire/*  (สต็อกยาง,
 *  เวลารอของที่วัดได้จริง) — จึงเขียนแบบกลางๆ ไม่ผูกกับตัวเลข 7 วันหรือสมมติว่าเป็นอะไหล่เท่านั้น */
export type GlossaryKey = "adu" | "sd" | "ss" | "rop" | "dos" | "lt" | "min" | "max" | "suggestQty"
export const GLOSSARY: Record<GlossaryKey, { label: string; desc: string }> = {
  adu: {
    label: "ADU — เบิกเฉลี่ย/วัน",
    desc: "เฉลี่ยแล้วเบิกออกวันละกี่หน่วย คำนวณจากยอดเบิกจริงย้อนหลังในหน้าต่างเวลาที่เลือก ยิ่งสูงยิ่งต้องมีของสำรองไว้มาก",
  },
  sd: {
    label: "SD — ความผันผวนของการเบิก",
    desc: "บอกว่าการเบิกแต่ละเดือนแกว่งขึ้นลงมากแค่ไหน เดือนไหนเบิกเยอะเดือนไหนเบิกน้อยสลับกัน ยิ่งแกว่งมากยิ่งต้องกันสต๊อกสำรอง (SS) ไว้มากขึ้น",
  },
  ss: {
    label: "SS — สต๊อกกันชน (Safety Stock)",
    desc: "ของที่กันเผื่อไว้ไม่ให้พลาด เผื่อว่าจู่ๆ เดือนนั้นเบิกหนักกว่าปกติ หรือของรอบใหม่มาช้ากว่าที่คิดไว้ ไม่ใช่ของที่หมุนใช้ตามปกติ — เดือนไหนยอดเบิกแกว่งขึ้นลงมาก ตัวเลขนี้ก็ยิ่งสูงตาม",
  },
  rop: {
    label: "ROP — จุดสั่งซื้อ (Reorder Point)",
    desc: "ถ้าของที่เหลืออยู่ตอนนี้ต่ำกว่าเลขนี้ ให้รีบสั่งเพิ่มได้เลย เพราะกว่าของรอบใหม่จะมาถึง ของที่มีจะไม่พอใช้แล้ว — รอสั่งช้ากว่านี้เสี่ยงของขาดมือก่อนของใหม่จะมาถึง",
  },
  dos: {
    label: "พอใช้อีก (Days of Supply)",
    desc: "ประมาณการว่าของที่มีอยู่ตอนนี้จะพอใช้ได้อีกกี่วัน ถ้าเบิกในอัตราเฉลี่ยเท่าเดิม ใช้เทียบกับเวลารอของเพื่อดูว่าจะขาดก่อนของใหม่มาถึงหรือไม่ — คำนวณไม่ได้ (แสดง —) เมื่อไม่มีการเบิกเลย",
  },
  lt: {
    label: "LT / เวลารอของ (Lead Time)",
    desc: "จำนวนวันตั้งแต่วันที่สั่งซื้อจนของมาถึงคลัง ใช้คำนวณทั้ง SS และ ROP — ยิ่งรอนานยิ่งต้องกันสต๊อกสำรองไว้มากขึ้น",
  },
  min: {
    label: "min",
    desc: "ระดับคงเหลือขั้นต่ำที่ตั้งไว้ใน ATMS เป็นเกณฑ์อ้างอิงเดิม อาจตรงหรือไม่ตรงกับพฤติกรรมการเบิกจริงตอนนี้ก็ได้ — ดูคอลัมน์ \"ตรวจ min\" ประกอบ",
  },
  max: {
    label: "max",
    desc: "ระดับคงเหลือสูงสุดที่ตั้งไว้ใน ATMS มีของเกินระดับนี้ถือว่าสต๊อกจมเกินความจำเป็น ควรตรวจว่าซื้อเกินมาจริงหรือ max ตั้งไว้ต่ำเกินไป",
  },
  suggestQty: {
    label: "แนะนำสั่ง",
    desc: "จำนวนที่แนะนำให้สั่งเพิ่มในรอบนี้ เพื่อให้คงเหลือกลับไปอยู่ในระดับปลอดภัยโดยไม่เกิน max — เป็น 0 เสมอถ้ารหัสนี้ไม่มีการเบิกเลยในช่วงที่ผ่านมา",
  },
}

export type SnapshotRow = {
  code: string; name: string; group: string; unit: string
  brand: string; oracleCode: string; inventoryId: string
  /** สถานที่จัดเก็บที่คนคลังกรอกไว้ใน ATMS (เช่น "B1-1" ลาดกระบัง · "Shelf 4/B" สระบุรี) — "" = ยังไม่ได้กรอก
   *  ATMS มีค่านี้ที่ตาราง /inv/stock.history/index ที่เดียว ไม่มีในตาราง SKU index ที่ซิงก์ min/max มา
   *  (ดู fetchStockLocationPage) · แถวที่ซิงก์ไว้ก่อน 25/08/2026 ยังไม่มีฟิลด์นี้ จึงเป็น optional — ฝั่งอ่านต้อง default "" เอง */
  storageLocation?: string
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
  /** ของที่สั่งไปแล้วแต่ยังไม่เข้าคลัง — ไม่ใส่ (undefined) เมื่อไม่มีของค้างอยู่เลย
   *  build ใช้ $unset ล้างทิ้งเมื่อของมาครบแล้ว จะได้ไม่มีค่าค้างหลอกในรอบถัดไป
   *  (แถวที่ build ไว้ก่อน 25/08/2026 ก็ไม่มีฟิลด์นี้ ฝั่งอ่านต้องทนค่า undefined ได้) */
  onOrder?: OnOrder
}

/** สรุป "กำลังสั่งซื้อ" ของรหัสสินค้าหนึ่งในคลังหนึ่ง — ดู openPrQtyBySku สำหรับนิยามเต็ม */
export type OnOrder = {
  /** จำนวนที่ยังไม่เข้าคลัง = ยอดในใบ PR หักส่วนที่รับไปแล้ว */
  qty: number
  prCount: number
  /** เลข PR (ใหม่→เก่า) ตัดที่ ON_ORDER_PR_CODES_MAX ใบ — ไว้โชว์ในหน้าต่างรายละเอียด ไม่ใช่เก็บให้ครบ */
  prCodes: string[]
  /** อายุใบ PR ที่เก่าสุดในกอง (วัน) — สั่งไปนานแล้วยังไม่มาคือสัญญาณว่าต้องตามของ ไม่ใช่สั่งเพิ่ม */
  oldestDays: number
}

/** เกณฑ์ "นโยบายอะไหล่" ที่หน้า /safety-stock ใช้ — กรองที่ layer อ่าน (lib/safety-stock.ts getSafetyStock)
 *  ไม่ใช่ตอน build เพราะ safety_stock_snapshot เป็นชุดข้อมูลที่ /tire/{branch}/stock-tire ใช้ร่วมด้วย
 *  (ดู lib/tire-stock-safety.ts) — ต้องมีทั้ง min และ max พร้อมกัน (เดิม min หรือ max อย่างใดอย่างหนึ่งก็พอ)
 *  และไม่ใช่กลุ่ม "ยาง" เป๊ะๆ (เก็บ "เครื่องมือยาง" ไว้ตามที่ตกลง) ส่งออกไว้ให้ script ตรวจสอบ
 *  (scripts/check-safety-stock.ts) ใช้ประกอบด้วย กันตรรกะกระจายไปเขียนซ้ำคนละที่ */
export function isPartsPolicyRow(r: Pick<SnapshotRow, "group" | "minQty" | "maxQty">): boolean {
  return r.group !== EXCLUDED_PRODUCT_GROUP && r.minQty > 0 && r.maxQty > 0
}

export type Derived = {
  adu: number; sdDaily: number
  safetyStock: number; reorderPoint: number
  daysOfSupply: number | null
  status: Status; minVerdict: MinVerdict; suggestQty: number
  /** "ตอนนี้ต้องสั่ง แต่ของที่สั่งไว้แล้วพอ" — true เมื่อสถานะตอนนี้อยู่ในกลุ่มต้องลงมือ แต่ถ้านับของที่กำลังมา
   *  ด้วยจะหลุดออกจากกลุ่มนั้น · เป็น false เสมอเมื่อผู้เรียกไม่ส่ง onOrderQty เข้ามา (เช่น /tire/*) */
  coveredByOrder: boolean
}

/** สถานะที่แปลว่า "ต้องลงมือสั่ง" — ใช้ตัดสิน coveredByOrder ที่เดียว ไม่ให้เกณฑ์กระจายไปเขียนซ้ำ */
const NEEDS_ORDER: Status[] = ["out", "below_rop", "below_min"]

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

// ── "กำลังสั่งซื้อ" — PR ที่ยังไม่มี DD ─────────────────────────────────────

/** PR เก่ากว่านี้ไม่นับว่าของกำลังมา — เวลารอของตามนโยบายคือ 7 วัน เกิน 90 วันคือ 13 เท่า
 *  ของกองนี้ในทางปฏิบัติคือใบที่ค้างจนลืม ถ้านับต่อไปหน้าจอจะบอกว่ามีของกำลังมาตลอดกาลแล้วไม่มีใครสั่งเพิ่ม */
export const ON_ORDER_MAX_AGE_DAYS = 90
/** เก็บเลข PR ไว้โชว์ในหน้าต่างรายละเอียดเท่าที่พอให้ตามของถูก ไม่ใช่เก็บครบทุกใบ (payload ส่งออกทุกแถว) */
export const ON_ORDER_PR_CODES_MAX = 5
/** บรรทัด PR กลุ่มค่าแรงไม่ใช่ของเข้าสต๊อก (ค่าปะยาง ค่าเชื่อม ฯลฯ) — นับรวมจะทำให้ตัวเลขเพี้ยน */
const LABOUR_GROUP_RE = /^ค่าแรง/

export type PrHeadRef = { code: string; date: string; warehouse: string; plate: string }
export type PoHeadRef = { code: string; prCode: string; receiveStatus: string }
export type PrItemRef = { prCode: string; sku: string; amount: number; warehouse: string; group: string }
export type PoItemRef = { poCode: string; sku: string; received: number }

/** ใบ PR ที่ระบุทะเบียนรถจริง = ซื้ออะไหล่ไปลงรถคันนั้นโดยเฉพาะ ไม่ใช่ซื้อเข้าสต๊อก
 *  ของกองนี้รับเข้าคลังแล้วเบิกออกให้รถทันที สุทธิแล้วสต๊อกไม่ได้เพิ่ม — และยอดเบิกของรถพวกนั้นถูกนับ
 *  ใน ADU/ROP อยู่แล้ว ถ้าเอามาหัก "แนะนำสั่ง" อีกจะเท่ากับหักซ้ำสองรอบ
 *
 *  ห้ามเช็คแค่ "ช่องทะเบียนไม่ว่าง" — ฝ่ายจัดซื้อสโตร์กรอกทะเบียนหลอกไว้ "สบ.00000"/"สบ.000" ในใบที่ซื้อ
 *  เข้าสต๊อกจริง (วัดจริง 25/08/2026: 392 ใบจาก 4,019 ใบ หมายเหตุเขียนว่า "เข้าสต๊อกเพื่อการซ่อมบำรุง"
 *  หรือ "สำหรับ PM") เช็คแบบนั้นจะตัดของที่เข้าสต๊อกจริงทิ้งไปด้วย
 *  เกณฑ์จึงเป็น "มีตัวเลขที่ไม่ใช่ศูนย์อยู่ในทะเบียน" ไม่ใช่แค่ "มีตัวอักษรอยู่ในช่อง" */
export function isVehiclePlate(plate: string | null | undefined): boolean {
  const digits = (plate ?? "").replace(/\D/g, "")
  return digits.length > 0 && /[1-9]/.test(digits)
}

/** อายุ (วัน) ของวันที่รูป "DD/MM/YYYY" — คืน null เมื่ออ่านไม่ออก ให้ผู้เรียกตัดสินเองว่าจะทิ้งหรือเก็บ */
export function ageDaysFromDmy(dmy: string, asOf: Date): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((dmy ?? "").trim())
  if (!m) return null
  const from = Date.UTC(+m[3], +m[2] - 1, +m[1])
  const to = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())
  return Math.round((to - from) / 86_400_000)
}

/** "กำลังสั่งซื้อ" รายรหัสสินค้าของคลังหนึ่ง — ตรรกะล้วน ไม่แตะ DB (ผู้เรียกดึงข้อมูลมาให้ครบ)
 *
 *  นิยาม: รวมทุกใบ PR ของคลังนี้ที่ "ยังไม่มี DD ครบ" และอายุ ≤ maxAgeDays
 *           qty ของรหัส X = max(0, ยอด X ในบรรทัด PR − ยอด X ที่รับไปแล้วใน PO ของ PR ใบนั้น)
 *
 *  "ยังไม่มี DD ครบ" ใช้เกณฑ์เดียวกับหน้า /pr (lib/pr-snapshot.ts): PO ที่ยกเลิกไม่นับ · ปิดงานเมื่อ PO
 *  ที่เหลือมีใบรับของ (DD) ครบทุกใบ · PR ที่ยังไม่ออก PO เลยถือว่ายังไม่มี DD (ของยังอยู่ในสายพานจัดซื้อ)
 *
 *  ที่ต้องหักส่วนที่รับไปแล้ว: PR ใบเดียวแตกเป็นหลาย PO แล้วทยอยรับ ถ้าเอายอดในใบ PR มาตรงๆ จะนับเกิน
 *  (วัดจริง 25/08/2026: ลาดกระบังยอดดิบ 6,210 ชิ้น แต่รับไปแล้ว 2,622 = เกินจริง 42%)
 *
 *  ใบที่ระบุทะเบียนรถจริงถูกตัดทิ้งทั้งใบ — เป็นอะไหล่ลงคัน ไม่ใช่ของเข้าสต๊อก (ดู isVehiclePlate)
 *  วัดจริง 25/08/2026: ใบที่ยังไม่มี DD 644 ใบ เป็นอะไหล่ลงคัน 564 ใบ เหลือของเข้าสต๊อกจริง 80 ใบ
 */
export function openPrQtyBySku(input: {
  prHeads: PrHeadRef[]
  poHeads: PoHeadRef[]
  /** เลข PO ที่มีใบรับของแล้ว (จาก deposit_header.purchase_order) */
  ddPoCodes: Iterable<string>
  prItems: PrItemRef[]
  poItems: PoItemRef[]
  /** ชื่อคลังอย่างที่ ATMS เขียน เช่น "คลังลาดกระบัง" */
  warehouse: string
  asOf: Date
  maxAgeDays?: number
}): Map<string, OnOrder> {
  const maxAge = input.maxAgeDays ?? ON_ORDER_MAX_AGE_DAYS
  const dd = new Set(input.ddPoCodes)

  // PO ที่ยกเลิกไม่นับทั้งการตัดสินว่าปิดงานแล้วและการหักยอดที่รับ (เหมือนที่หน้า /pr ทำ)
  const posByPr = new Map<string, string[]>()
  const prOfPo = new Map<string, string>()
  for (const po of input.poHeads) {
    if (po.receiveStatus.includes("ยกเลิก")) continue
    if (!po.prCode || !po.code) continue
    if (!posByPr.has(po.prCode)) posByPr.set(po.prCode, [])
    posByPr.get(po.prCode)!.push(po.code)
    prOfPo.set(po.code, po.prCode)
  }

  // ใบ PR ที่ยังไม่มี DD ครบ + อายุยังไม่เกิน + ไม่ใช่อะไหล่ลงคัน — เก็บอายุไว้ด้วยเพื่อรายงาน oldestDays
  const openPrAge = new Map<string, number>()
  for (const pr of input.prHeads) {
    if (pr.warehouse !== input.warehouse) continue
    if (isVehiclePlate(pr.plate)) continue      // ซื้อไปลงรถคันนั้น ไม่ใช่ของเข้าสต๊อก
    const age = ageDaysFromDmy(pr.date, input.asOf)
    if (age === null || age < 0 || age > maxAge) continue
    const myPos = posByPr.get(pr.code) ?? []
    if (myPos.length > 0 && myPos.every((po) => dd.has(po))) continue   // รับของครบแล้ว
    openPrAge.set(pr.code, age)
  }

  // ยอดที่รับไปแล้ว รายคู่ (PR, รหัสสินค้า)
  const received = new Map<string, number>()
  for (const it of input.poItems) {
    const pr = prOfPo.get(it.poCode)
    if (!pr || !openPrAge.has(pr)) continue
    const k = `${pr}|${it.sku}`
    received.set(k, (received.get(k) ?? 0) + (Number(it.received) || 0))
  }

  // รวมรายรหัสสินค้า — หักยอดที่รับแล้วทีละ (PR, รหัส) ไม่ใช่หักทีเดียวตอนท้าย
  // (หักตอนท้ายจะทำให้ใบที่รับเกินยอดของตัวเองไปกินโควตาของใบอื่นในกองเดียวกัน)
  const out = new Map<string, OnOrder>()
  const seenPr = new Map<string, Set<string>>()
  for (const it of input.prItems) {
    const age = openPrAge.get(it.prCode)
    if (age === undefined) continue
    if (it.warehouse !== input.warehouse) continue
    if (LABOUR_GROUP_RE.test(it.group)) continue
    const sku = (it.sku ?? "").trim()
    if (!sku) continue
    const qty = Math.max(0, (Number(it.amount) || 0) - (received.get(`${it.prCode}|${sku}`) ?? 0))
    if (qty <= 0) continue

    const cur = out.get(sku) ?? { qty: 0, prCount: 0, prCodes: [], oldestDays: 0 }
    cur.qty = r2(cur.qty + qty)
    cur.oldestDays = Math.max(cur.oldestDays, age)
    if (!seenPr.has(sku)) seenPr.set(sku, new Set())
    const prs = seenPr.get(sku)!
    if (!prs.has(it.prCode)) {
      prs.add(it.prCode)
      cur.prCount = prs.size
      // ใบใหม่กว่ามาก่อน แล้วตัดที่เพดาน — คนตามของสนใจใบล่าสุดมากกว่าใบที่ค้างมานาน
      cur.prCodes = [...prs]
        .sort((a, b) => (openPrAge.get(a) ?? 0) - (openPrAge.get(b) ?? 0))
        .slice(0, ON_ORDER_PR_CODES_MAX)
    }
    out.set(sku, cur)
  }
  return out
}

// ── ตัวรวม — job และเบราว์เซอร์เรียกตัวนี้ตัวเดียวกัน ──────────────────────
/** ltOverride: เวลารอของตามนโยบาย (วัน) ใช้แทนค่าที่วัดได้จริง (r.leadTimeDays) ในทุกสูตร — ไม่ใส่ (undefined)
 *  พฤติกรรมเดิมทุกประการ (ใช้ค่าที่วัดได้จริง เหมือนที่ /tire/* เรียกอยู่) หน้า /safety-stock ส่ง LEAD_TIME_DAYS
 *  เข้ามาที่นี่ (view-layer parameter เดียวกับ win/z ไม่ใช่การเขียนทับ r.leadTimeDays ที่ build เก็บไว้)
 *  เมื่อมี override ตัดสิน minVerdict ด้วย source "policy" แทน r.leadTimeSource เดิม — เพราะเวลารอของตอนนี้
 *  เป็นค่าคงที่ตามนโยบาย ไม่ใช่ค่ากลางทั้งคลังที่เชื่อไม่ได้ (การ์ด "warehouse" ของ minVerdictOf ยังอยู่ครบ
 *  ใช้กับ /tire/* ที่ไม่ส่ง override เข้ามาต่อไปเหมือนเดิม) */
export function derive(
  r: SnapshotRow, win: WindowKey = DEFAULT_WINDOW, z: number = DEFAULT_Z, ltOverride?: number,
  onOrderQty = 0,
): Derived {
  const adu = r.adu[win]
  const sdDaily = r.sdDaily[win]
  const lt = ltOverride ?? r.leadTimeDays
  const ltSource: LeadTimeSource = ltOverride !== undefined ? "policy" : r.leadTimeSource
  const ss = safetyStockOf(sdDaily, lt, z)
  const rop = reorderPointOf(adu, lt, ss)
  const onHand = r.stockQty

  // ของที่กำลังมาเปลี่ยนแค่ "ต้องสั่งเพิ่มอีกเท่าไร" — ไม่เปลี่ยนสถานะและ "พอใช้อีกกี่วัน" เพราะของยังไม่อยู่ในมือ
  // เบิกวันนี้ยังเบิกไม่ได้ ถ้าเอาไปบวกใน onHand ตรงๆ ของที่หมดจริงจะขึ้นเขียวทั้งที่หยิบไม่ได้สักชิ้น
  const onOrder = Math.max(0, onOrderQty)
  const status = statusOf({ usage12: r.usage.m12, onHand, rop, minQty: r.minQty, maxQty: r.maxQty })
  const statusIfArrived = onOrder > 0
    ? statusOf({ usage12: r.usage.m12, onHand: onHand + onOrder, rop, minQty: r.minQty, maxQty: r.maxQty })
    : status

  return {
    adu,
    sdDaily,
    safetyStock: r2(ss),
    reorderPoint: r2(rop),
    daysOfSupply: daysOfSupplyOf(onHand, adu),
    status,
    minVerdict: minVerdictOf(r.minQty, rop, ltSource),
    suggestQty: suggestQtyOf(onHand + onOrder, r.maxQty, rop, adu, lt, r.usage.m12),
    coveredByOrder: onOrder > 0 && NEEDS_ORDER.includes(status) && !NEEDS_ORDER.includes(statusIfArrived),
  }
}
