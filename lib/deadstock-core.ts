// lib/deadstock-core.ts
// ตรรกะล้วนของหน้า /deadstock — import ได้เฉพาะ lib/safety-stock-core ซึ่งเป็นตรรกะล้วนเหมือนกัน
// (ไม่แตะ mongo/env) เพื่อให้ยังทดสอบตรง ๆ ได้ด้วย tsx และไม่ต้องก๊อปสูตรแกะเลข PR มาไว้สองที่
//
// นิยาม "ของค้าง" ที่นี่: ชั้นของจากใบรับสินค้า (DD) ที่ยังไม่ถูกใบเบิก (WD) ตัดออกตามลำดับ FIFO
// ⚠️ ต่างจาก KPI ชื่อ "deadstock" ของ mena-intelligence ซึ่งนับจาก "ไม่เคลื่อนไหว ≥12 เดือน"
//    ชื่อซ้ำกันแต่คนละนิยาม — ระบุให้ชัดทุกครั้งที่คุยข้ามทีม

import { prCodeFromNote } from "@/lib/safety-stock-core"
import type { OnOrder } from "@/lib/safety-stock-core"

export const DB_NAME = "atms"
export const COLL_NAME = "stockmovement_v5"

/** คลังลาดกระบัง — ต้องกรองด้วย inventory_id เท่านั้น
 *  `คลังสินค้า` ไม่มี index (collscan 435k แถว) ส่วนคู่ year_month+inventory_id มี index รองรับ */
export const INVENTORY_ID = "4"
export const WAREHOUSE = "คลังลาดกระบัง"
export const START_YM = "2025-01"

/** เกินกี่วันถือว่า "ค้างนาน" — ผู้ใช้กำหนด 7 วัน */
export const STALE_DAYS = 7

/** ── ตัวชี้วัด (KPI) ──
 *  วัดที่ "มูลค่าของที่ค้างเกิน KPI_AGE_DAYS วัน" ต้องไม่เกิน KPI_MAX_VALUE บาท
 *  เป็นเป้าหมายที่ฝ่ายบริหารกำหนด ไม่ได้คำนวณจากข้อมูลย้อนหลัง (ต่างจาก baseline แบบ X̄ ± SD)
 *  แนวเดียวกับ KPI "มูลค่าสินค้าคงคลัง >12 เดือน" ของ mena-intelligence ที่ตั้งเป้า ศลบ. ฿13,000 */
export const KPI_AGE_DAYS = 60
export const KPI_MAX_VALUE = 12_000

/** สถานะของค้างตามอายุ — ใช้ชุดเดียวกันทุกหน้า (ตาราง / กราฟ / ตัวกรอง / สไลด์)
 *
 *  หมายเหตุเรื่องศัพท์: ตำราคลังสินค้านิยาม Slow Moving / Deadstock จาก "การไม่มีการเบิกออก"
 *  แต่ที่นี่วัดจาก "อายุของล็อตที่รับเข้ามาแล้วยังไม่ถูกเบิก" ซึ่งเป็นคนละมุม —
 *  ใช้ศัพท์ชุดนี้เพื่อให้ตรงกับเอกสารโครงการ Lean โดยมีนิยามกำกับที่หน้า /deadstock/baseline */
export const AGE_BUCKETS = [
  { key: "normal", label: "Normal", th: "ปกติ", range: "0-7 วัน", max: 7 },
  { key: "watch", label: "Watch", th: "เฝ้าระวัง", range: "8-30 วัน", max: 30 },
  { key: "slow", label: "Slow Moving", th: "เคลื่อนไหวช้า", range: "31-60 วัน", max: 60 },
  { key: "candidate", label: "Deadstock Candidate", th: "เข้าข่ายของตาย", range: "61-180 วัน", max: 180 },
  { key: "confirmed", label: "Deadstock Confirmed", th: "ของตาย", range: "เกิน 180 วัน", max: Number.POSITIVE_INFINITY },
] as const

export type BucketKey = (typeof AGE_BUCKETS)[number]["key"]

/** การจัดการของค้าง — ผู้ใช้เลือกเองต่อใบ DD เก็บทับไว้อีกชั้นใน master_data.deadstock_action
 *  ไม่แตะข้อมูล ATMS และ**ไม่ตัดแถวออกจากรายการ** (ของยังอยู่ในคลังจริงจนกว่าจะมีใบ WD มาตัด)
 *  จึงยังนับใน KPI ตามปกติ — ป้ายนี้บอกแค่ว่า "มีคนดูและตัดสินใจแล้ว" */
export const DEADSTOCK_ACTIONS = [
  { key: "wrong_spec", label: "ผิด Spec", hint: "ของที่ได้มาไม่ตรงสเปคที่ขอ ใช้กับงานเดิมไม่ได้" },
  { key: "return_vendor", label: "คืนผู้ขาย", hint: "ส่งคืนผู้ขายเพื่อรับเงินคืนหรือเปลี่ยนของ" },
  { key: "to_stock", label: "โอนสต็อกกลาง", hint: "ย้ายเข้าสต็อกกลาง ให้ใช้กับรถคันไหนก็ได้" },
  { key: "move_truck", label: "ย้ายไปรถคันอื่น", hint: "เอาไปใช้กับรถคันอื่นที่ต้องการของชิ้นเดียวกัน" },
  { key: "for_sale", label: "รอขาย", hint: "ไม่มีทางได้ใช้ตามวัตถุประสงค์เดิม รอตัดขาย/ขายเป็นเศษซาก" },
  // ตัวล่างนี้แปลว่า "ไม่ได้ค้างจริง" — ของไม่ได้อยู่ในคลังแล้ว แต่ระบบยังนับว่าค้างเพราะเอกสารไม่ครบ
  // ต่างจากสี่ตัวบนที่เป็นการตัดสินใจว่าจะทำอะไรกับของที่ยังอยู่จริง
  // เพิ่ม 27/08/2026 ตอนแรกเป็นสองตัวแยก (used / no_wd) แล้วผู้ใช้สั่งรวมเป็นตัวเดียววันเดียวกัน
  // เพราะเป็นสถานการณ์เดียวกัน: เอาของไปใช้แล้วแต่ไม่มีใบเบิกมาตัดยอด (ป้ายเก่าย้ายมาคีย์นี้แล้ว)
  { key: "used_no_wd", label: "ใช้แล้ว-ไม่มี WD", hint: "เอาของไปใช้แล้วจริง แต่ไม่ได้เปิดใบเบิก (WD) ยอดในระบบจึงไม่ลดลง" },
] as const

export type ActionKey = (typeof DEADSTOCK_ACTIONS)[number]["key"]

export const ACTION_LABEL: Record<string, string> = Object.fromEntries(
  DEADSTOCK_ACTIONS.map((a) => [a.key, a.label])
)

/** คีย์ประจำล็อต — ต้องคงที่ทุกครั้งที่คำนวณ FIFO ใหม่ ไม่งั้นป้ายที่บันทึกไว้จะหลุด
 *  ใช้ (เลขใบ DD + รหัสสินค้า + วันที่รับ) ซึ่งมาจากเอกสารจริงทั้งสามส่วน */
export function layerKey(r: { dd: string; itemCode: string; date: string }): string {
  return `${r.dd}|${r.itemCode}|${r.date.slice(0, 10)}`
}

/** ตัวกรองช่วงอายุของหน้า "รายรหัสสินค้า" — กรองที่ระดับใบ DD แล้วรวมยอดใหม่
 *  หมายเหตุ: แบ่งที่ < 7 กับ >= 7 ตามที่ผู้ใช้กำหนด ซึ่งไม่ตรงกับ STALE_DAYS (นับ > 7)
 *  ของที่ค้างพอดี 7 วันจึงอยู่ใน "≥ 7 วัน" แต่ไม่นับเป็น stale ของหน้าอื่น */
export const ITEM_AGE_FILTERS = [
  { key: "", label: "ทุกช่วงอายุ" },
  { key: "lt7", label: "ต่ำกว่า 7 วัน" },
  { key: "gte7", label: "7 วันขึ้นไป" },
  { key: "gt30", label: "เกิน 30 วัน" },
] as const

export type ItemAgeFilterKey = (typeof ITEM_AGE_FILTERS)[number]["key"]

export function matchesAgeFilter(key: string, days: number): boolean {
  if (key === "lt7") return days < 7
  if (key === "gte7") return days >= 7
  if (key === "gt30") return days > 30
  return true
}

// ── Mongo pipelines ─────────────────────────────────────────────────────────
// อยู่ในไฟล์นี้เพื่อให้สคริปต์ตรวจสอบใช้ pipeline "ตัวเดียวกัน" กับที่ production ใช้จริง
// ค่าแรงถูกตัดตั้งแต่ใน query ได้ เพราะเป็นคุณสมบัติระดับรหัสสินค้า (ไม่ก้ำกึ่ง)
const BASE_MATCH = { inventory_id: INVENTORY_ID, year_month: { $gte: START_YM } }
const NOT_LABOUR = { กลุ่มสินค้า: { $not: /^ค่าแรง/ } }

/** ชั้นรับของ — 1 doc ต่อ (รหัสสินค้า × ใบ DD × วันที่) */
export const LAYER_PIPELINE = [
  { $match: { ...BASE_MATCH, ...NOT_LABOUR, รับ: { $gt: 0 } } },
  {
    $group: {
      _id: { i: "$รหัสสินค้า", d: "$DD", t: "$วันที่" },
      q: { $sum: "$รับ" },
      c: { $last: "$ราคาทุน" },
      n: { $last: "$ชื่อสินค้า" },
      g: { $last: "$กลุ่มสินค้า" },
      note: { $last: "$หมายเหตุ" },
    },
  },
]

/** ยอดเบิกรวม — 1 doc ต่อ (รหัสสินค้า × เดือน)
 *  รายเดือนพอ ไม่ต้องรายวัน เพราะ snapshot ตัดที่สิ้นเดือน (หรือวันนี้สำหรับเดือนปัจจุบัน)
 *  ยอดเบิกที่นับเข้ามาจึงอยู่ก่อนจุดตัดเสมอ */
export const ISSUE_PIPELINE = [
  { $match: { ...BASE_MATCH, ...NOT_LABOUR, จ่าย: { $gt: 0 } } },
  { $group: { _id: { i: "$รหัสสินค้า", m: "$year_month" }, q: { $sum: "$จ่าย" } } },
]

// ── Types ───────────────────────────────────────────────────────────────────
export type LayerDoc = {
  _id: { i: string | null; d: string | null; t: Date | string | null }
  q: number | null
  c: number | null
  n: string | null
  g: string | null
  note: string | null
}
export type IssueDoc = { _id: { i: string | null; m: string | null }; q: number | null }

export type Layer = {
  dd: string
  date: string
  qty: number
  cost: number
  itemCode: string
  itemName: string
  itemGroup: string
  note: string
  plate: string | null
}

export type PendingRow = {
  dd: string
  date: string
  plate: string
  /** เบอร์รถ + เลขใบขอซื้อ แกะจาก `หมายเหตุ` ใบเดียวกับที่ให้ทะเบียน — null เมื่อใบนั้นเขียนไม่ครบช่อง */
  fleetNo: string | null
  prCode: string | null
  /** ผู้ขอซื้อจากหัวใบ PR — ไม่ได้อยู่ใน stockmovement จึงเติมทีหลังใน lib/deadstock.ts
   *  (ตรรกะล้วนที่นี่ query ไม่ได้ · แพตเทิร์นเดียวกับ newerCount ที่เติมย้อนหลัง) */
  requester: string | null
  itemCode: string
  itemName: string
  itemGroup: string
  remaining: number
  cost: number
  value: number
  ageDays: number
  bucket: BucketKey
  /** จำนวนใบ DD ที่ผูกทะเบียนรถของ "รหัสสินค้าเดียวกัน" ซึ่งรับเข้ามาหลังใบนี้ = ซื้อซ้ำทั้งที่ของเก่ายังไม่ถูกเบิก
   *  ไม่ต้องเช็คว่าใบใหม่กว่า "ยังไม่ถูกเบิก" ซ้ำอีก — FIFO ตัดจากใบเก่าสุดก่อน
   *  ถ้าใบนี้ยังค้าง ใบที่ใหม่กว่าย่อมยังไม่ถูกแตะเสมอ (ตรวจกับข้อมูลจริงแล้ว 0/290 กรณีขัดแย้ง) */
  newerCount: number
  /** "กำลังจะซื้อซ้ำ" — ของรหัสเดียวกันที่สั่งไปแล้วแต่ยังไม่รับเข้า ทั้งที่ใบนี้ยังไม่ถูกเบิกสักชิ้น
   *  ต่างจาก newerCount ตรงที่อันนั้นนับใบ DD ที่ "รับของมาแล้ว" (เงินออกไปแล้ว) ส่วนอันนี้นับ PR ที่ยัง
   *  ไม่รับของ — เห็นก่อนเงินออก ยังชะลอหรือยกเลิกทัน (ทับซ้อนกันแค่ 1 ใบจาก 364 วัดจริง 25/08/2026)
   *  นับเฉพาะ PR ที่ซื้อเข้าสต๊อก ไม่รวมอะไหล่ลงคัน — เกณฑ์เดียวกับหน้า /safety-stock (ดู openPrQtyBySku)
   *  ไม่ใส่ (undefined) เมื่อรหัสนั้นไม่มีของค้างสั่งอยู่ */
  onOrder?: OnOrder
}

export type MonthPoint = {
  ym: string
  count: number
  qty: number
  value: number
  staleCount: number
  staleValue: number
  /** ของที่ค้างเกิน KPI_AGE_DAYS วัน ณ สิ้นเดือนนั้น = ตัวเลขที่ KPI คุม */
  kpiCount: number
  kpiValue: number
}

export type ItemRow = {
  itemCode: string
  itemName: string
  itemGroup: string
  layers: number
  remaining: number
  value: number
  oldestAgeDays: number
  /** ซื้อซ้ำมากสุดของรหัสนี้ = newerCount ของใบที่เก่าที่สุด */
  newerMax: number
}

export type DeadstockPayload = {
  asOf: string
  warehouse: string
  startYm: string
  staleDays: number
  summary: {
    pendingCount: number
    pendingQty: number
    pendingValue: number
    staleCount: number
    staleValue: number
    /** ของที่ค้างเกิน KPI_AGE_DAYS วัน ณ วันนี้ = ตัวเลขที่ KPI คุม */
    kpiCount: number
    kpiValue: number
    buckets: { key: BucketKey; label: string; th: string; range: string; count: number; value: number }[]
  }
  monthly: MonthPoint[]
  pending: PendingRow[]
  items: ItemRow[]
  dataQuality: { unmatchedIssueQty: number; stockLayersRemaining: number }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const r2 = (n: number) => Math.round(n * 100) / 100
const r4 = (n: number) => Math.round(n * 10000) / 10000

/** ทะเบียนรถบนใบ DD ฝังอยู่ใน `หมายเหตุ` หลังเลข PR เช่น "LBPR26050758/71-5742/153/โม่ใหญ่"
 *  (คอลัมน์ `ทะเบียน` ของแถวรับเป็น null ทุกแถว — ตรวจแล้ว 0/2508)
 *  ไม่เข้าเงื่อนไข = เข้าสต็อกกลาง เช่น ".../STOCK" หรือ ".../เข้าสต๊อกเพื่อการซ่อมบำรุง" */
const PLATE_RE = /\/\s*([ก-ฮ]{0,3}\s*\d{1,3}-?\d{3,4})/

export function plateFromNote(note: string | null | undefined): string | null {
  const m = PLATE_RE.exec(note ?? "")
  return m ? m[1].replace(/\s+/g, "") : null
}

/** เบอร์รถอยู่ช่องที่ 3 ของ `หมายเหตุ` ถัดจากเลข PR และทะเบียน
 *  เช่น "LBPR26050758/71-5742/153/โม่ใหญ่" → "153"  ·  ".../71-0432/UH04/..." → "UH04"
 *  บางใบเขียนไม่ครบช่อง ช่องที่ 3 จึงกลายเป็นประเภทรถ ("โม่ใหญ่") — บังคับให้ต้องมีตัวเลข
 *  และเป็นอักษรอังกฤษล้วน เพื่อไม่ให้ประเภทรถหลุดมาแสดงเป็นเบอร์รถ */
const FLEET_NO_RE = /^(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{1,10}$/

export function fleetNoFromNote(note: string | null | undefined): string | null {
  const seg = (note ?? "").split("/")[2]?.trim() ?? ""
  return FLEET_NO_RE.test(seg) ? seg : null
}

export function daysBetween(from: string | Date, to: Date): number {
  return Math.floor((to.getTime() - new Date(from).getTime()) / 86_400_000)
}

export function bucketOf(days: number): BucketKey {
  return (AGE_BUCKETS.find((b) => days <= b.max) ?? AGE_BUCKETS[AGE_BUCKETS.length - 1]).key
}

/** ตัดยอดเบิกรวมออกจากชั้นของตามลำดับ FIFO (ชั้นเก่าสุดก่อน)
 *  ยอดเบิกที่หาชั้นมาตัดไม่เจอ (ของยกมาก่อนปี 2026) คืนเป็น `unmatched` ไม่ทำให้ค้างติดลบ */
export function consumeFifo(
  layers: Layer[],
  issuedQty: number
): { remaining: (Layer & { remaining: number })[]; unmatched: number } {
  const sorted = [...layers].sort((a, b) =>
    a.date === b.date ? a.dd.localeCompare(b.dd) : a.date < b.date ? -1 : 1
  )
  let left = issuedQty
  const remaining: (Layer & { remaining: number })[] = []
  for (const l of sorted) {
    const take = Math.min(left, l.qty)
    left = r4(left - take)
    const rem = r4(l.qty - take)
    if (rem > 0) remaining.push({ ...l, remaining: rem })
  }
  return { remaining, unmatched: r4(Math.max(left, 0)) }
}

const ymOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`

function monthRange(from: string, to: string): string[] {
  const out: string[] = []
  const parts = from.split("-").map(Number)
  let y = parts[0]
  let m = parts[1]
  while (`${y}-${String(m).padStart(2, "0")}` <= to) {
    out.push(`${y}-${String(m).padStart(2, "0")}`)
    m += 1
    if (m > 12) {
      y += 1
      m = 1
    }
  }
  return out
}

/** จุดตัดของเดือน = สิ้นเดือน แต่ถ้าเป็นเดือนปัจจุบันให้ใช้ asOf (ยังไม่จบเดือน) */
function cutoffOf(ym: string, asOf: Date): Date {
  const [y, m] = ym.split("-").map(Number)
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999))
  return end > asOf ? asOf : end
}

/** รวมใบ DD ที่ค้างเป็นยอดต่อรหัสสินค้า เรียงตามมูลค่ามากไปน้อย
 *  แยกออกมาเพราะหน้า "รายรหัสสินค้า" ต้องรวมยอดใหม่หลังกรองช่วงอายุ — ใช้ตัวเดียวกันทั้งสองที่ */
export function rollupItems(rows: PendingRow[]): ItemRow[] {
  const itemMap = new Map<string, ItemRow>()
  for (const p of rows) {
    let it = itemMap.get(p.itemCode)
    if (!it)
      itemMap.set(
        p.itemCode,
        (it = {
          itemCode: p.itemCode,
          itemName: p.itemName,
          itemGroup: p.itemGroup,
          layers: 0,
          remaining: 0,
          value: 0,
          oldestAgeDays: 0,
          newerMax: 0,
        })
      )
    it.layers += 1
    it.remaining = r4(it.remaining + p.remaining)
    it.value = r2(it.value + p.value)
    it.oldestAgeDays = Math.max(it.oldestAgeDays, p.ageDays)
    it.newerMax = Math.max(it.newerMax, p.newerCount)
  }
  return [...itemMap.values()].sort((a, b) => b.value - a.value)
}

// ── Payload builder ─────────────────────────────────────────────────────────
/** onOrderBySku: "กำลังสั่งซื้อ" รายรหัส (ดู lib/on-order.ts) — ไม่ส่งมาก็ได้ ผลลัพธ์จะไม่มีฟิลด์ onOrder
 *  เลยทุกแถว เหมือนก่อนมีฟีเจอร์นี้ทุกประการ (เทสต์เดิมที่เรียกแบบ 3 อาร์กิวเมนต์จึงไม่ต้องแก้) */
export function buildPayload(
  layerDocs: LayerDoc[], issueDocs: IssueDoc[], asOf: Date,
  onOrderBySku?: Map<string, OnOrder>,
): DeadstockPayload {
  type Entry = { layers: Layer[]; issues: Map<string, number> }
  const byItem = new Map<string, Entry>()
  const entry = (code: string): Entry => {
    let e = byItem.get(code)
    if (!e) byItem.set(code, (e = { layers: [], issues: new Map() }))
    return e
  }

  for (const d of layerDocs) {
    const code = d._id.i ?? "(ไม่มีรหัส)"
    const note = d.note ?? ""
    entry(code).layers.push({
      dd: d._id.d ?? "",
      date: new Date(d._id.t ?? 0).toISOString(),
      qty: d.q ?? 0,
      cost: d.c ?? 0,
      itemCode: code,
      itemName: d.n ?? "",
      itemGroup: (d.g ?? "").trim() || "ไม่ระบุ",
      note,
      plate: plateFromNote(note),
    })
  }
  for (const d of issueDocs) {
    const e = entry(d._id.i ?? "(ไม่มีรหัส)")
    const ym = d._id.m ?? ""
    e.issues.set(ym, (e.issues.get(ym) ?? 0) + (d.q ?? 0))
  }

  const issuedUpTo = (e: Entry, ym: string) => {
    let sum = 0
    for (const [k, v] of e.issues) if (k <= ym) sum += v
    return r4(sum)
  }

  // ── ภาพรายเดือน ──
  const months = monthRange(START_YM, ymOf(asOf))
  const monthly: MonthPoint[] = months.map((ym) => {
    const cutoff = cutoffOf(ym, asOf)
    const cutoffIso = cutoff.toISOString()
    let count = 0
    let qty = 0
    let value = 0
    let staleCount = 0
    let staleValue = 0
    let kpiCount = 0
    let kpiValue = 0
    for (const e of byItem.values()) {
      const upTo = e.layers.filter((l) => l.date <= cutoffIso)
      if (upTo.length === 0) continue
      const { remaining } = consumeFifo(upTo, issuedUpTo(e, ym))
      for (const r of remaining) {
        if (!r.plate) continue // สต็อกกลาง — ร่วมตัดแล้ว แต่ไม่นับเป็นของค้างที่ต้องตาม
        const v = r.remaining * r.cost
        const age = daysBetween(r.date, cutoff)
        count += 1
        qty += r.remaining
        value += v
        if (age > STALE_DAYS) {
          staleCount += 1
          staleValue += v
        }
        if (age > KPI_AGE_DAYS) {
          kpiCount += 1
          kpiValue += v
        }
      }
    }
    return {
      ym, count, qty: r4(qty), value: r2(value),
      staleCount, staleValue: r2(staleValue),
      kpiCount, kpiValue: r2(kpiValue),
    }
  })

  // ── สถานะล่าสุด ──
  const nowYm = ymOf(asOf)
  const pending: PendingRow[] = []
  let unmatchedIssueQty = 0
  let stockLayersRemaining = 0
  for (const e of byItem.values()) {
    const { remaining, unmatched } = consumeFifo(e.layers, issuedUpTo(e, nowYm))
    unmatchedIssueQty = r4(unmatchedIssueQty + unmatched)
    for (const r of remaining) {
      if (!r.plate) {
        stockLayersRemaining += 1
        continue
      }
      const ageDays = daysBetween(r.date, asOf)
      pending.push({
        dd: r.dd,
        date: r.date,
        plate: r.plate,
        fleetNo: fleetNoFromNote(r.note),
        prCode: prCodeFromNote(r.note),
        requester: null, // เติมใน lib/deadstock.ts เมื่อรู้ว่าใบไหนค้างจริงแล้ว จะได้ยิง $in เท่าที่แสดง
        itemCode: r.itemCode,
        itemName: r.itemName,
        itemGroup: r.itemGroup,
        remaining: r.remaining,
        cost: r.cost,
        value: r2(r.remaining * r.cost),
        ageDays,
        bucket: bucketOf(ageDays),
        newerCount: 0, // เติมด้านล่างเมื่อรู้ครบทุกใบของรหัสนั้นแล้ว
      })
    }
  }

  // ซื้อซ้ำ: ต่อรหัสสินค้า เรียงใบที่ค้างจากเก่า→ใหม่ ใบลำดับที่ i มีใบใหม่กว่าเหลืออีก (n-1-i) ใบ
  const byCode = new Map<string, PendingRow[]>()
  for (const p of pending) {
    const arr = byCode.get(p.itemCode)
    if (arr) arr.push(p)
    else byCode.set(p.itemCode, [p])
  }
  for (const rows of byCode.values()) {
    rows.sort((a, b) => (a.date === b.date ? a.dd.localeCompare(b.dd) : a.date < b.date ? -1 : 1))
    for (let i = 0; i < rows.length; i++) rows[i].newerCount = rows.length - 1 - i
  }

  // กำลังจะซื้อซ้ำ — แปะรายรหัส ทุกใบที่ค้างของรหัสนั้นเห็นยอดเดียวกัน (ยอดสั่งผูกกับรหัส ไม่ใช่ผูกกับใบ DD)
  if (onOrderBySku) {
    for (const p of pending) {
      const oo = onOrderBySku.get(p.itemCode)
      if (oo && oo.qty > 0) p.onOrder = oo
    }
  }

  pending.sort((a, b) => b.ageDays - a.ageDays || b.value - a.value)

  // ── สรุป ──
  const buckets = AGE_BUCKETS.map((b) => {
    const rows = pending.filter((p) => p.bucket === b.key)
    return {
      key: b.key,
      label: b.label,
      th: b.th,
      range: b.range,
      count: rows.length,
      value: r2(rows.reduce((s, p) => s + p.value, 0)),
    }
  })
  const stale = pending.filter((p) => p.ageDays > STALE_DAYS)
  const kpiRows = pending.filter((p) => p.ageDays > KPI_AGE_DAYS)

  const items = rollupItems(pending)

  return {
    asOf: asOf.toISOString(),
    warehouse: WAREHOUSE,
    startYm: START_YM,
    staleDays: STALE_DAYS,
    summary: {
      pendingCount: pending.length,
      pendingQty: r4(pending.reduce((s, p) => s + p.remaining, 0)),
      pendingValue: r2(pending.reduce((s, p) => s + p.value, 0)),
      staleCount: stale.length,
      staleValue: r2(stale.reduce((s, p) => s + p.value, 0)),
      kpiCount: kpiRows.length,
      kpiValue: r2(kpiRows.reduce((s, p) => s + p.value, 0)),
      buckets,
    },
    monthly,
    pending,
    items,
    dataQuality: { unmatchedIssueQty, stockLayersRemaining },
  }
}
