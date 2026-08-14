# Deadstock (DD ค้างไม่มี WD — FIFO) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มกลุ่มหน้า `/deadstock` ใน mena-wms แสดงใบรับสินค้า (DD) ของคลังลาดกระบังปี 2026 ที่ยังไม่ถูกใบเบิก (WD) ตัดออกตามหลัก FIFO พร้อมอายุค้างและภาพรายเดือน

**Architecture:** แยกเป็น 3 ชั้น — `lib/deadstock-core.ts` (ตรรกะล้วน ไม่มี dependency เลย ทดสอบได้ตรง ๆ), `lib/deadstock.ts` (คุย Mongo + memo cache), `app/deadstock/*` (UI). ดึงข้อมูลด้วย aggregation 2 ชุดที่ยุบข้อมูลฝั่ง Mongo ก่อน (1.7 วิ) แล้วรัน FIFO ใน Node (21 ms)

**Tech Stack:** Next.js 16 (App Router) · React 19 · MongoDB driver 7 · TypeScript · `xlsx` (มีอยู่แล้ว) · `lucide-react` · ทดสอบด้วย `node:assert/strict` ผ่าน `npx tsx` ตามแพตเทิร์น `scripts/check-*.ts` ของ repo (repo ไม่มี test framework — ห้ามเพิ่ม)

**Spec:** `docs/superpowers/specs/2026-08-14-deadstock-fifo-design.md`

## Global Constraints

- **ห้ามกรองด้วย `คลังสินค้า`** — ไม่มี index จะกลายเป็น collscan 435k แถว ใช้ `inventory_id: "4"` เท่านั้น (คู่กับ `year_month` ได้ index `year_month_1_inventory_id_1`)
- **ห้ามดึงแถวดิบมา Node** — ต้อง `$group` ฝั่ง Mongo ก่อนเสมอ (ดึงดิบ = 152 วินาที, ยุบก่อน = 1.7 วินาที)
- **ตัดค่าแรงใน query** (`กลุ่มสินค้า: { $not: /^ค่าแรง/ }`) — เป็นคุณสมบัติระดับรหัสสินค้า ตัดได้ปลอดภัย
- **ตัดสต็อกกลางตอนแสดงผลเท่านั้น ห้ามตัดก่อน FIFO** — ถ้าตัดก่อน ยอดเบิกจะไปกินชั้นที่ผูกทะเบียนรถแทน ทำให้ของค้างดูน้อยกว่าจริง
- ขอบเขตข้อมูล: `year_month >= "2026-01"` · คลังลาดกระบังเท่านั้น
- เกณฑ์ "ค้างนาน" = **เกิน 7 วัน** (`STALE_DAYS = 7`)
- ต้องแสดงยอดเบิกที่หา DD ต้นทางไม่เจอบนหน้าเว็บ ห้ามซ่อน
- ภาษา UI: ไทย · ฟอนต์/สไตล์ตามแพตเทิร์นเดิมของ repo (`app-shell`, `mitr`)
- Auth: ไม่ต้องเขียนเพิ่ม — `middleware.ts` บังคับ login ทุก path อยู่แล้ว

---

### Task 1: FIFO engine (ตรรกะล้วน)

**Files:**
- Create: `lib/deadstock-core.ts`
- Test: `scripts/check-deadstock-core.ts`

**Interfaces:**
- Consumes: ไม่มี (ไฟล์นี้ห้าม import อะไรเลย เพื่อให้ทดสอบและ reuse ได้)
- Produces: `INVENTORY_ID`, `WAREHOUSE`, `START_YM`, `STALE_DAYS`, `AGE_BUCKETS`, `LAYER_PIPELINE`, `ISSUE_PIPELINE`, `plateFromNote()`, `daysBetween()`, `bucketOf()`, `consumeFifo()`, `buildPayload()`, types `Layer`, `LayerDoc`, `IssueDoc`, `PendingRow`, `MonthPoint`, `ItemRow`, `DeadstockPayload`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `scripts/check-deadstock-core.ts`:

```ts
// scripts/check-deadstock-core.ts
// รัน: npx tsx scripts/check-deadstock-core.ts   (repo ไม่มี test framework — ใช้ assert ตามแพตเทิร์น check-ap-tracking.ts)
import assert from "node:assert/strict"
import {
  plateFromNote, daysBetween, bucketOf, consumeFifo, buildPayload,
  STALE_DAYS, type Layer, type LayerDoc, type IssueDoc,
} from "../lib/deadstock-core"

// --- plateFromNote: ทะเบียนถูกฝังใน หมายเหตุ เพราะแถว DD ไม่มีคอลัมน์ ทะเบียน เลย ---
assert.equal(plateFromNote("LBPR26050758/71-5742/153/โม่ใหญ่"), "71-5742")
assert.equal(plateFromNote("LBPR26050516/กธ2607 รถ สนง. ฝ่าย HR"), "กธ2607")
assert.equal(plateFromNote("LBPR26050729/71-0432/UH04/โม่ใหญ่"), "71-0432")
assert.equal(plateFromNote("LBPR26050699/STOCK"), null, "เข้าสต็อกกลาง ต้องไม่จับเป็นทะเบียน")
assert.equal(plateFromNote("LBPR25120644/เข้าสต๊อกเพื่อการซ่อมบำรุง"), null)
assert.equal(plateFromNote(""), null)
assert.equal(plateFromNote(null), null)

// --- daysBetween / bucketOf ---
assert.equal(daysBetween("2026-08-01T00:00:00.000Z", new Date("2026-08-14T00:00:00.000Z")), 13)
assert.equal(daysBetween("2026-08-14T00:00:00.000Z", new Date("2026-08-14T00:00:00.000Z")), 0)
assert.equal(bucketOf(0), "0-7")
assert.equal(bucketOf(7), "0-7")
assert.equal(bucketOf(8), "8-15")
assert.equal(bucketOf(30), "16-30")
assert.equal(bucketOf(61), "60+")
assert.equal(STALE_DAYS, 7)

// --- consumeFifo ---
const L = (dd: string, date: string, qty: number, plate: string | null = "71-0001"): Layer => ({
  dd, date, qty, cost: 10, itemCode: "X", itemName: "x", itemGroup: "g",
  note: plate ? `PR/${plate}/A/B` : "PR/STOCK", plate,
})

// ตัดข้ามหลายชั้น: เบิก 7 กินชั้นแรก 5 หมด และกินชั้นสองไป 2
{
  const { remaining, unmatched } = consumeFifo([L("D1", "2026-01-05", 5), L("D2", "2026-02-05", 4)], 7)
  assert.equal(unmatched, 0)
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].dd, "D2")
  assert.equal(remaining[0].remaining, 2)
}
// ตัดพอดีหมดทุกชั้น
{
  const { remaining, unmatched } = consumeFifo([L("D1", "2026-01-05", 5), L("D2", "2026-02-05", 4)], 9)
  assert.equal(remaining.length, 0)
  assert.equal(unmatched, 0)
}
// ไม่มีการเบิกเลย — ค้างทั้งหมด
{
  const { remaining } = consumeFifo([L("D1", "2026-01-05", 5)], 0)
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].remaining, 5)
}
// เบิกเกินของที่มี — ส่วนเกินต้องรายงานเป็น unmatched ไม่ใช่ค้างติดลบ
{
  const { remaining, unmatched } = consumeFifo([L("D1", "2026-01-05", 5)], 8)
  assert.equal(remaining.length, 0)
  assert.equal(unmatched, 3)
}
// เรียงตามวันที่จริง ไม่ใช่ลำดับที่ส่งเข้ามา
{
  const { remaining } = consumeFifo([L("NEW", "2026-05-01", 3), L("OLD", "2026-01-01", 3)], 3)
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].dd, "NEW", "ต้องตัดชั้นเก่า (OLD) ก่อน")
}
// วันที่เดียวกัน — ตัดสินด้วยเลขที่ DD เพื่อให้ผลคงที่
{
  const { remaining } = consumeFifo([L("D9", "2026-03-01", 2), L("D1", "2026-03-01", 2)], 2)
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].dd, "D9")
}
// ทศนิยม — ยอดเบิกจริงมีทศนิยม (เช่น น้ำมัน) ห้ามเหลือเศษลอย
{
  const { remaining, unmatched } = consumeFifo([L("D1", "2026-01-01", 18.2)], 18.2)
  assert.equal(remaining.length, 0)
  assert.equal(unmatched, 0)
}

// --- buildPayload: สต็อกกลางต้องร่วมตัด FIFO แต่ไม่ถูกแสดง ---
{
  // ชั้นสต็อกกลาง 1/1 (5 ชิ้น) มาก่อน ชั้นผูกรถ 1/2 (5 ชิ้น) — เบิก 5 ต้องกินชั้นสต็อกกลางหมด
  // เหลือชั้นผูกรถเต็ม 5 ถ้าใครไปกรองสต็อกกลางทิ้งก่อน FIFO จะเหลือ 0 ซึ่งผิด
  const layers: LayerDoc[] = [
    { _id: { i: "A", d: "DD-STOCK", t: "2026-01-01T00:00:00.000Z" }, q: 5, c: 100, n: "ของ A", g: "กลุ่ม1", note: "LBPR1/STOCK" },
    { _id: { i: "A", d: "DD-TRUCK", t: "2026-01-02T00:00:00.000Z" }, q: 5, c: 100, n: "ของ A", g: "กลุ่ม1", note: "LBPR2/71-1111/T1/โม่" },
  ]
  const issues: IssueDoc[] = [{ _id: { i: "A", m: "2026-01" }, q: 5 }]
  const p = buildPayload(layers, issues, new Date("2026-02-10T00:00:00.000Z"))
  assert.equal(p.pending.length, 1, "ต้องเหลือเฉพาะชั้นที่ผูกทะเบียนรถ")
  assert.equal(p.pending[0].dd, "DD-TRUCK")
  assert.equal(p.pending[0].remaining, 5, "ยอดเบิกต้องไปกินชั้นสต็อกกลางก่อน")
  assert.equal(p.pending[0].value, 500)
  assert.equal(p.summary.pendingCount, 1)
  assert.equal(p.summary.pendingValue, 500)
  assert.equal(p.summary.staleCount, 1, "รับ 2 ม.ค. วัดวันที่ 10 ก.พ. = 39 วัน > 7")
  assert.equal(p.dataQuality.stockLayersRemaining, 0)
  // ภาพรายเดือน: ม.ค. ถึง ก.พ.
  assert.deepEqual(p.monthly.map((m) => m.ym), ["2026-01", "2026-02"])
  assert.equal(p.monthly[0].count, 1, "สิ้น ม.ค. ก็ค้างแล้ว 1 รายการ")
  assert.equal(p.monthly[0].staleCount, 0, "สิ้น ม.ค. เพิ่ง 29 วัน... ต้องเป็น stale")
}

// --- buildPayload: unmatched ---
{
  const layers: LayerDoc[] = [
    { _id: { i: "B", d: "DD1", t: "2026-03-01T00:00:00.000Z" }, q: 2, c: 50, n: "ของ B", g: "กลุ่ม2", note: "LBPR3/71-2222/T2/โม่" },
  ]
  const issues: IssueDoc[] = [{ _id: { i: "B", m: "2026-03" }, q: 5 }]
  const p = buildPayload(layers, issues, new Date("2026-03-20T00:00:00.000Z"))
  assert.equal(p.pending.length, 0)
  assert.equal(p.dataQuality.unmatchedIssueQty, 3)
}

// --- buildPayload: รวมรายรหัสสินค้า ---
{
  const layers: LayerDoc[] = [
    { _id: { i: "C", d: "DD1", t: "2026-01-10T00:00:00.000Z" }, q: 3, c: 20, n: "ของ C", g: "กลุ่ม3", note: "LBPR4/71-3333/T3/โม่" },
    { _id: { i: "C", d: "DD2", t: "2026-02-10T00:00:00.000Z" }, q: 2, c: 20, n: "ของ C", g: "กลุ่ม3", note: "LBPR5/71-4444/T4/โม่" },
  ]
  const p = buildPayload(layers, [], new Date("2026-03-01T00:00:00.000Z"))
  assert.equal(p.items.length, 1)
  assert.equal(p.items[0].itemCode, "C")
  assert.equal(p.items[0].layers, 2)
  assert.equal(p.items[0].remaining, 5)
  assert.equal(p.items[0].value, 100)
  assert.equal(p.items[0].oldestAgeDays, 50, "ชั้นเก่าสุด 10 ม.ค. ถึง 1 มี.ค. = 50 วัน")
}

console.log("✅ deadstock-core: ผ่านทั้งหมด")
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
cd /Users/menatransport_02/Documents/project/master-sku-web
npx tsx scripts/check-deadstock-core.ts
```
Expected: FAIL — `Cannot find module '../lib/deadstock-core'`

- [ ] **Step 3: เขียน `lib/deadstock-core.ts`**

```ts
// lib/deadstock-core.ts
// ตรรกะล้วนของหน้า /deadstock — ห้าม import อะไรทั้งสิ้น เพื่อให้ทดสอบตรง ๆ ได้ด้วย tsx
//
// นิยาม "ของค้าง" ที่นี่: ชั้นของจากใบรับสินค้า (DD) ที่ยังไม่ถูกใบเบิก (WD) ตัดออกตามลำดับ FIFO
// ⚠️ ต่างจาก KPI ชื่อ "deadstock" ของ mena-intelligence ซึ่งนับจาก "ไม่เคลื่อนไหว ≥12 เดือน"
//    ชื่อซ้ำกันแต่คนละนิยาม — ระบุให้ชัดทุกครั้งที่คุยข้ามทีม

export const DB_NAME = "atms"
export const COLL_NAME = "stockmovement_v5"

/** คลังลาดกระบัง — ต้องกรองด้วย inventory_id เท่านั้น
 *  `คลังสินค้า` ไม่มี index (collscan 435k แถว) ส่วนคู่ year_month+inventory_id มี index รองรับ */
export const INVENTORY_ID = "4"
export const WAREHOUSE = "คลังลาดกระบัง"
export const START_YM = "2026-01"

/** เกินกี่วันถือว่า "ค้างนาน" — ผู้ใช้กำหนด 7 วัน */
export const STALE_DAYS = 7

export const AGE_BUCKETS = [
  { key: "0-7",   label: "0-7 วัน",     max: 7 },
  { key: "8-15",  label: "8-15 วัน",    max: 15 },
  { key: "16-30", label: "16-30 วัน",   max: 30 },
  { key: "31-60", label: "31-60 วัน",   max: 60 },
  { key: "60+",   label: "เกิน 60 วัน", max: Number.POSITIVE_INFINITY },
] as const

export type BucketKey = (typeof AGE_BUCKETS)[number]["key"]

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
  q: number | null; c: number | null; n: string | null; g: string | null; note: string | null
}
export type IssueDoc = { _id: { i: string | null; m: string | null }; q: number | null }

export type Layer = {
  dd: string; date: string; qty: number; cost: number
  itemCode: string; itemName: string; itemGroup: string
  note: string; plate: string | null
}

export type PendingRow = {
  dd: string; date: string; plate: string
  itemCode: string; itemName: string; itemGroup: string
  remaining: number; cost: number; value: number
  ageDays: number; bucket: BucketKey
}

export type MonthPoint = {
  ym: string; count: number; qty: number; value: number
  staleCount: number; staleValue: number
}

export type ItemRow = {
  itemCode: string; itemName: string; itemGroup: string
  layers: number; remaining: number; value: number; oldestAgeDays: number
}

export type DeadstockPayload = {
  asOf: string
  warehouse: string
  startYm: string
  staleDays: number
  summary: {
    pendingCount: number; pendingQty: number; pendingValue: number
    staleCount: number; staleValue: number
    buckets: { key: BucketKey; label: string; count: number; value: number }[]
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
  const sorted = [...layers].sort((a, b) => (a.date === b.date ? a.dd.localeCompare(b.dd) : a.date < b.date ? -1 : 1))
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
  let [y, m] = from.split("-").map(Number)
  while (`${y}-${String(m).padStart(2, "0")}` <= to) {
    out.push(`${y}-${String(m).padStart(2, "0")}`)
    m += 1
    if (m > 12) { y += 1; m = 1 }
  }
  return out
}

/** จุดตัดของเดือน = สิ้นเดือน แต่ถ้าเป็นเดือนปัจจุบันให้ใช้ asOf (ยังไม่จบเดือน) */
function cutoffOf(ym: string, asOf: Date): Date {
  const [y, m] = ym.split("-").map(Number)
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999))
  return end > asOf ? asOf : end
}

// ── Payload builder ─────────────────────────────────────────────────────────
export function buildPayload(layerDocs: LayerDoc[], issueDocs: IssueDoc[], asOf: Date): DeadstockPayload {
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
    let count = 0, qty = 0, value = 0, staleCount = 0, staleValue = 0
    for (const e of byItem.values()) {
      const upTo = e.layers.filter((l) => l.date <= cutoffIso)
      if (upTo.length === 0) continue
      const { remaining } = consumeFifo(upTo, issuedUpTo(e, ym))
      for (const r of remaining) {
        if (!r.plate) continue // สต็อกกลาง — ร่วมตัดแล้ว แต่ไม่นับเป็นของค้างที่ต้องตาม
        const v = r.remaining * r.cost
        count += 1; qty += r.remaining; value += v
        if (daysBetween(r.date, cutoff) > STALE_DAYS) { staleCount += 1; staleValue += v }
      }
    }
    return { ym, count, qty: r4(qty), value: r2(value), staleCount, staleValue: r2(staleValue) }
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
      if (!r.plate) { stockLayersRemaining += 1; continue }
      const ageDays = daysBetween(r.date, asOf)
      pending.push({
        dd: r.dd, date: r.date, plate: r.plate,
        itemCode: r.itemCode, itemName: r.itemName, itemGroup: r.itemGroup,
        remaining: r.remaining, cost: r.cost, value: r2(r.remaining * r.cost),
        ageDays, bucket: bucketOf(ageDays),
      })
    }
  }
  pending.sort((a, b) => b.ageDays - a.ageDays || b.value - a.value)

  // ── สรุป ──
  const buckets = AGE_BUCKETS.map((b) => {
    const rows = pending.filter((p) => p.bucket === b.key)
    return { key: b.key, label: b.label, count: rows.length, value: r2(rows.reduce((s, p) => s + p.value, 0)) }
  })
  const stale = pending.filter((p) => p.ageDays > STALE_DAYS)

  // ── รวมรายรหัสสินค้า ──
  const itemMap = new Map<string, ItemRow>()
  for (const p of pending) {
    let it = itemMap.get(p.itemCode)
    if (!it) itemMap.set(p.itemCode, (it = {
      itemCode: p.itemCode, itemName: p.itemName, itemGroup: p.itemGroup,
      layers: 0, remaining: 0, value: 0, oldestAgeDays: 0,
    }))
    it.layers += 1
    it.remaining = r4(it.remaining + p.remaining)
    it.value = r2(it.value + p.value)
    it.oldestAgeDays = Math.max(it.oldestAgeDays, p.ageDays)
  }
  const items = [...itemMap.values()].sort((a, b) => b.value - a.value)

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
      buckets,
    },
    monthly,
    pending,
    items,
    dataQuality: { unmatchedIssueQty, stockLayersRemaining },
  }
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

```bash
npx tsx scripts/check-deadstock-core.ts
```
Expected: PASS — `✅ deadstock-core: ผ่านทั้งหมด`

หมายเหตุ: assert `p.monthly[0].staleCount` ในเทสต์ — ชั้นรับ 2 ม.ค. วัดที่สิ้น ม.ค. (31 ม.ค.) = 29 วัน > 7 จึงเป็น stale → ค่าที่ถูกคือ `1` ถ้ารันแล้วไม่ตรงให้แก้ **เทสต์** ให้ตรงกับความจริงข้อนี้ ไม่ใช่แก้ตรรกะ

- [ ] **Step 5: Commit**

```bash
git add lib/deadstock-core.ts scripts/check-deadstock-core.ts
git commit -m "deadstock: ตรรกะ FIFO ตัดใบรับ (DD) ด้วยใบเบิก (WD) + เทสต์"
```

---

### Task 2: ชั้นข้อมูล Mongo + memo cache

**Files:**
- Create: `lib/deadstock.ts`
- Test: `scripts/check-deadstock.ts` (ตรวจกับข้อมูลจริง)

**Interfaces:**
- Consumes: `lib/deadstock-core.ts` (`LAYER_PIPELINE`, `ISSUE_PIPELINE`, `buildPayload`, types) · `lib/mongo.ts` (`clientPromise` default export)
- Produces: `getDeadstock(force?: boolean): Promise<DeadstockPayload>` — ผลที่ cache ไว้ 1 ชม.

- [ ] **Step 1: เขียน `lib/deadstock.ts`**

```ts
// lib/deadstock.ts
// ชั้นคุย MongoDB ของหน้า /deadstock — ตรรกะทั้งหมดอยู่ใน deadstock-core.ts
import clientPromise from "@/lib/mongo"
import {
  DB_NAME, COLL_NAME, LAYER_PIPELINE, ISSUE_PIPELINE, buildPayload,
  type LayerDoc, type IssueDoc, type DeadstockPayload,
} from "@/lib/deadstock-core"

/** ยุบข้อมูลฝั่ง Mongo ก่อนเสมอ — ดึงแถวดิบ 54k แถวใช้ 152 วินาที ส่วนยุบก่อนใช้ 1.7 วินาที */
async function fetchRaw(): Promise<{ layers: LayerDoc[]; issues: IssueDoc[] }> {
  const client = await clientPromise
  const col = client.db(DB_NAME).collection(COLL_NAME)
  const [layers, issues] = await Promise.all([
    col.aggregate<LayerDoc>(LAYER_PIPELINE, { maxTimeMS: 60_000 }).toArray(),
    col.aggregate<IssueDoc>(ISSUE_PIPELINE, { maxTimeMS: 60_000 }).toArray(),
  ])
  return { layers, issues }
}

// ข้อมูลต้นทางอัปเดตวันละครั้งจาก pipeline ATMS — ไม่มีเหตุให้ยิง DB ทุก request
// เก็บบน globalThis เพื่อให้รอดข้าม hot-reload ตอน dev และข้าม warm invocation บน Vercel
const TTL_MS = 60 * 60 * 1000
declare global {
  var _deadstockCache: { at: number; data: DeadstockPayload } | undefined
}

export async function getDeadstock(force = false): Promise<DeadstockPayload> {
  const hit = globalThis._deadstockCache
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.data
  const { layers, issues } = await fetchRaw()
  const data = buildPayload(layers, issues, new Date())
  globalThis._deadstockCache = { at: Date.now(), data }
  return data
}
```

- [ ] **Step 2: เขียนสคริปต์ตรวจกับข้อมูลจริง**

สร้าง `scripts/check-deadstock.ts` — ใช้ pipeline ตัวเดียวกับ production ไม่ก๊อปโค้ดซ้ำ:

```ts
// scripts/check-deadstock.ts
// รัน: npx tsx scripts/check-deadstock.ts
// ตรวจ FIFO กับข้อมูลจริงในคลังลาดกระบัง + ยืนยันว่า query ยังใช้ index อยู่
import assert from "node:assert/strict"
import { MongoClient } from "mongodb"
import { readFileSync } from "node:fs"
import {
  DB_NAME, COLL_NAME, INVENTORY_ID, LAYER_PIPELINE, ISSUE_PIPELINE, buildPayload,
  type LayerDoc, type IssueDoc,
} from "../lib/deadstock-core"

const env = readFileSync(new URL("../.env", import.meta.url), "utf8")
const uri = env.match(/^MONGO_URI=(.+)$/m)![1].trim().replace(/^["']|["']$/g, "")

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 })
await client.connect()
const col = client.db(DB_NAME).collection(COLL_NAME)

// 1) query ต้องใช้ index ไม่ใช่ collscan — กติกาข้อสำคัญที่สุดของงานนี้
const plan = await col.find({ inventory_id: INVENTORY_ID, year_month: { $gte: "2026-01" } }).explain("queryPlanner")
const planJson = JSON.stringify(plan.queryPlanner?.winningPlan ?? plan)
assert.ok(planJson.includes("IXSCAN"), "query ต้องวิ่งผ่าน index")
assert.ok(!planJson.includes("COLLSCAN"), "ห้าม collscan เด็ดขาด")
console.log("✅ query plan: IXSCAN")

// 2) ดึงจริงและจับเวลา
const t0 = Date.now()
const [layers, issues] = await Promise.all([
  col.aggregate<LayerDoc>(LAYER_PIPELINE, { maxTimeMS: 60_000 }).toArray(),
  col.aggregate<IssueDoc>(ISSUE_PIPELINE, { maxTimeMS: 60_000 }).toArray(),
])
const dbMs = Date.now() - t0
console.log(`✅ ดึงข้อมูล: ชั้นรับ ${layers.length} · ยอดเบิก ${issues.length} · ${dbMs} ms`)
assert.ok(dbMs < 30_000, `ดึงข้อมูลช้าผิดปกติ (${dbMs} ms) — ตรวจว่ายังยุบฝั่ง Mongo อยู่ไหม`)

// 3) FIFO
const t1 = Date.now()
const p = buildPayload(layers, issues, new Date())
console.log(`✅ FIFO: ${Date.now() - t1} ms`)

console.log("\n── สรุป ──")
console.log(`ค้างทั้งหมด        ${p.summary.pendingCount} รายการ`)
console.log(`มูลค่า             ฿${p.summary.pendingValue.toLocaleString()}`)
console.log(`ค้างเกิน ${p.staleDays} วัน      ${p.summary.staleCount} รายการ · ฿${p.summary.staleValue.toLocaleString()}`)
console.log("ช่วงอายุ:", p.summary.buckets.map((b) => `${b.label}=${b.count}`).join(" · "))
console.log(`เบิกที่หา DD ไม่เจอ ${p.dataQuality.unmatchedIssueQty}`)
console.log(`ชั้นสต็อกกลางค้าง   ${p.dataQuality.stockLayersRemaining}`)
console.log("\nรายเดือน:")
for (const m of p.monthly) console.log(`  ${m.ym}  ค้าง ${String(m.count).padStart(4)} · เกิน 7 วัน ${String(m.staleCount).padStart(4)} · ฿${Math.round(m.value).toLocaleString()}`)

// 4) ความสมเหตุสมผล (ช่วงกว้าง — ข้อมูลเดินทุกวัน)
assert.ok(p.summary.pendingCount > 0, "ต้องมีของค้างบ้าง")
assert.equal(p.summary.buckets.reduce((s, b) => s + b.count, 0), p.summary.pendingCount, "ผลรวมช่วงอายุต้องเท่ายอดรวม")
assert.equal(p.items.reduce((s, i) => s + i.layers, 0), p.summary.pendingCount, "ผลรวมรายรหัสต้องเท่ายอดรวม")
assert.ok(p.pending.every((r) => r.plate), "ทุกแถวที่แสดงต้องมีทะเบียนรถ")
assert.ok(p.pending.every((r) => r.remaining > 0), "ห้ามมีแถวคงเหลือ 0 หรือติดลบ")
assert.ok(p.monthly.length >= 1 && p.monthly[0].ym === "2026-01")

console.log("\n✅ check-deadstock: ผ่านทั้งหมด")
await client.close()
```

- [ ] **Step 3: รันสคริปต์ตรวจ**

```bash
npx tsx scripts/check-deadstock.ts
```

Expected: PASS · ตัวเลขต้องใกล้เคียงค่าอ้างอิงจาก dry-run วันที่ 2026-08-14 (จะขยับตามวันที่รันและข้อมูลใหม่):

| ตัวเลข | ค่าอ้างอิง |
|---|---|
| ค้างทั้งหมด | ~289 รายการ |
| มูลค่า | ~฿376,346 |
| ค้างเกิน 7 วัน | ~211 |
| ช่วงอายุ | 0-7=78 · 8-15=47 · 16-30=64 · 31-60=38 · 60+=62 |
| เบิกที่หา DD ไม่เจอ | ~1,872 |
| ชั้นสต็อกกลางค้าง | ~450 |

ถ้าห่างจากนี้มาก **หยุดแล้วหาสาเหตุก่อนไปต่อ** — อย่าปรับตัวเลขให้เข้าทาง

- [ ] **Step 4: Commit**

```bash
git add lib/deadstock.ts scripts/check-deadstock.ts
git commit -m "deadstock: ดึงข้อมูลจาก stockmovement_v5 ผ่าน index + cache 1 ชม."
```

---

### Task 3: API route

**Files:**
- Create: `app/api/deadstock/route.ts`

**Interfaces:**
- Consumes: `getDeadstock()` จาก `lib/deadstock.ts`
- Produces: `GET /api/deadstock` → `DeadstockPayload` (JSON) · รองรับ `?refresh=1` ล้าง cache

- [ ] **Step 1: เขียน route**

```ts
// app/api/deadstock/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getDeadstock } from "@/lib/deadstock"

export const dynamic = "force-dynamic" // cache จัดการเองใน lib (TTL 1 ชม.) ไม่พึ่ง route cache

export async function GET(req: NextRequest) {
  try {
    const data = await getDeadstock(req.nextUrl.searchParams.get("refresh") === "1")
    return NextResponse.json(data)
  } catch (e) {
    console.error("[deadstock] ", e)
    return NextResponse.json({ error: "ดึงข้อมูลไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
```

- [ ] **Step 2: ทดสอบด้วย dev server**

```bash
npm run dev
```
เปิดอีกเทอร์มินัล — คาดว่าได้ 307 ไป /login เพราะ middleware บังคับ session (ยืนยันว่า auth ทำงาน):
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/deadstock
```
Expected: `307`

- [ ] **Step 3: Commit**

```bash
git add app/api/deadstock/route.ts
git commit -m "deadstock: API route"
```

---

### Task 4: หน้าสถานะล่าสุด (หน้าหลักที่ใช้งานจริง)

**Files:**
- Create: `app/deadstock/pending/page.tsx`
- Create: `components/deadstock-pending-page.tsx`
- Create: `components/deadstock-shared.tsx` (ของใช้ร่วม 3 หน้า: แถบสีอายุ, การ์ดสรุป, ตัวจัดรูปแบบตัวเลข, hook ดึงข้อมูล)

**Interfaces:**
- Consumes: `GET /api/deadstock` · types จาก `lib/deadstock-core.ts`
- Produces: `useDeadstock()`, `Baht`, `SummaryCards`, `BucketBadge`, `DeadstockTabs` จาก `components/deadstock-shared.tsx`

- [ ] **Step 1: สร้างของใช้ร่วม**

```tsx
// components/deadstock-shared.tsx
"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { AlertTriangle, PackageX, RefreshCw } from "lucide-react"
import type { BucketKey, DeadstockPayload } from "@/lib/deadstock-core"

export const mitr = { fontFamily: "var(--font-mitr), sans-serif" }

export const baht = (n: number) =>
  "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
export const thaiDate = (iso: string) =>
  new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" })

/** สีตามช่วงอายุ — ยิ่งค้างนานยิ่งแดง */
export const BUCKET_STYLE: Record<BucketKey, { bg: string; fg: string; ring: string }> = {
  "0-7":   { bg: "#ECFDF5", fg: "#047857", ring: "#A7F3D0" },
  "8-15":  { bg: "#FEFCE8", fg: "#A16207", ring: "#FDE68A" },
  "16-30": { bg: "#FFF7ED", fg: "#C2410C", ring: "#FED7AA" },
  "31-60": { bg: "#FEF2F2", fg: "#B91C1C", ring: "#FECACA" },
  "60+":   { bg: "#7F1D1D", fg: "#FFFFFF", ring: "#7F1D1D" },
}

export function BucketBadge({ bucket, days }: { bucket: BucketKey; days: number }) {
  const s = BUCKET_STYLE[bucket]
  return (
    <span style={{
      background: s.bg, color: s.fg, border: `1px solid ${s.ring}`,
      padding: "2px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
    }}>
      {days} วัน
    </span>
  )
}

export function useDeadstock() {
  const [data, setData] = useState<DeadstockPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/deadstock${refresh ? "?refresh=1" : ""}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  return { data, error, loading, reload: load }
}

const TABS = [
  { href: "/deadstock", label: "ภาพรายเดือน" },
  { href: "/deadstock/pending", label: "สถานะล่าสุด" },
  { href: "/deadstock/items", label: "รายรหัสสินค้า" },
]

export function DeadstockShell({
  data, loading, error, reload, children,
}: {
  data: DeadstockPayload | null; loading: boolean; error: string | null
  reload: (refresh?: boolean) => void; children: React.ReactNode
}) {
  const pathname = usePathname()
  return (
    <div style={{ padding: "20px 24px 48px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <PackageX size={26} color="#B91C1C" />
        <h1 style={{ ...mitr, fontSize: 24, fontWeight: 700, margin: 0 }}>ของค้างคลัง (DD ที่ยังไม่ถูกเบิก)</h1>
        <button
          onClick={() => reload(true)}
          disabled={loading}
          style={{
            marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 8, border: "1px solid #E5E7EB",
            background: "#fff", fontSize: 13, fontWeight: 600, cursor: loading ? "wait" : "pointer",
          }}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> รีเฟรช
        </button>
      </div>
      <p style={{ fontSize: 13, color: "#6B7280", margin: "0 0 14px" }}>
        {data?.warehouse ?? "คลังลาดกระบัง"} · ตั้งแต่ {data?.startYm ?? "2026-01"} · ตัดของแบบ FIFO ·
        เน้นรายการที่ค้างเกิน {data?.staleDays ?? 7} วัน
      </p>

      <nav style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const active = pathname === t.href
          return (
            <Link key={t.href} href={t.href} style={{
              padding: "7px 16px", borderRadius: 999, fontSize: 13, fontWeight: 700, textDecoration: "none",
              background: active ? "#111827" : "#F3F4F6", color: active ? "#fff" : "#374151",
            }}>{t.label}</Link>
          )
        })}
      </nav>

      {error && (
        <div style={{ padding: 16, borderRadius: 10, background: "#FEF2F2", color: "#B91C1C", marginBottom: 16 }}>
          โหลดข้อมูลไม่สำเร็จ: {error}
        </div>
      )}
      {loading && !data && <p style={{ color: "#6B7280" }}>กำลังคำนวณ FIFO…</p>}
      {data && children}
      {data && <DataQualityNote data={data} />}
    </div>
  )
}

export function SummaryCards({ data }: { data: DeadstockPayload }) {
  const s = data.summary
  const cards = [
    { label: "ค้างทั้งหมด", value: `${s.pendingCount.toLocaleString()} รายการ`, sub: baht(s.pendingValue), tone: "#111827" },
    { label: `ค้างเกิน ${data.staleDays} วัน`, value: `${s.staleCount.toLocaleString()} รายการ`, sub: baht(s.staleValue), tone: "#B91C1C" },
    { label: "ค้างเกิน 60 วัน", value: `${(s.buckets.find((b) => b.key === "60+")?.count ?? 0).toLocaleString()} รายการ`, sub: baht(s.buckets.find((b) => b.key === "60+")?.value ?? 0), tone: "#7F1D1D" },
    { label: "รหัสสินค้าที่ค้าง", value: `${data.items.length.toLocaleString()} รายการ`, sub: `${s.pendingQty.toLocaleString()} ชิ้น`, tone: "#374151" },
  ]
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 20 }}>
      {cards.map((c) => (
        <div key={c.label} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>{c.label}</div>
          <div style={{ ...mitr, fontSize: 22, fontWeight: 700, color: c.tone, marginTop: 2 }}>{c.value}</div>
          <div style={{ fontSize: 13, color: "#6B7280" }}>{c.sub}</div>
        </div>
      ))}
    </div>
  )
}

/** ข้อจำกัดของข้อมูล — ต้องแสดงเสมอ ห้ามซ่อน (ระบุไว้ใน spec ข้อ 4) */
function DataQualityNote({ data }: { data: DeadstockPayload }) {
  return (
    <div style={{
      marginTop: 24, padding: "12px 16px", borderRadius: 10,
      background: "#F9FAFB", border: "1px solid #E5E7EB", fontSize: 12.5, color: "#4B5563", lineHeight: 1.7,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: "#374151", marginBottom: 4 }}>
        <AlertTriangle size={14} /> ข้อจำกัดของข้อมูล
      </div>
      • FIFO เริ่มนับที่ {data.startYm} ของที่รับเข้ามาก่อนหน้านั้นไม่ปรากฏ — มียอดเบิก{" "}
      <b>{data.dataQuality.unmatchedIssueQty.toLocaleString()}</b> หน่วยที่หาใบ DD ต้นทางมาตัดไม่เจอ<br />
      • แสดงเฉพาะของที่ระบุทะเบียนรถในหมายเหตุ — ของที่รับเข้าสต็อกกลางอีก{" "}
      <b>{data.dataQuality.stockLayersRemaining.toLocaleString()}</b> ชั้นถูกนำไปร่วมตัด FIFO แล้วแต่ไม่แสดงในตาราง<br />
      • ไม่รวมรายการค่าแรง · ข้อมูล ณ {new Date(data.asOf).toLocaleString("th-TH")}
    </div>
  )
}
```

- [ ] **Step 2: สร้างหน้าสถานะล่าสุด**

```tsx
// components/deadstock-pending-page.tsx
"use client"

import { useMemo, useState } from "react"
import { Download, Search } from "lucide-react"
import * as XLSX from "xlsx"
import { BucketBadge, DeadstockShell, SummaryCards, baht, mitr, thaiDate, useDeadstock } from "@/components/deadstock-shared"
import { AGE_BUCKETS } from "@/lib/deadstock-core"

export function DeadstockPendingPage() {
  const { data, error, loading, reload } = useDeadstock()
  const [q, setQ] = useState("")
  const [bucket, setBucket] = useState<string>("")
  const [group, setGroup] = useState<string>("")

  const groups = useMemo(
    () => [...new Set(data?.pending.map((p) => p.itemGroup) ?? [])].sort(),
    [data]
  )

  const rows = useMemo(() => {
    if (!data) return []
    const rx = q.trim() ? new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null
    return data.pending.filter((p) =>
      (!bucket || p.bucket === bucket) &&
      (!group || p.itemGroup === group) &&
      (!rx || rx.test(p.dd) || rx.test(p.plate) || rx.test(p.itemCode) || rx.test(p.itemName))
    )
  }, [data, q, bucket, group])

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
      "ใบ DD": r.dd,
      "วันที่รับ": thaiDate(r.date),
      "ทะเบียนรถ": r.plate,
      "รหัสสินค้า": r.itemCode,
      "ชื่อสินค้า": r.itemName,
      "กลุ่มสินค้า": r.itemGroup,
      "คงเหลือ": r.remaining,
      "ราคาทุน": r.cost,
      "มูลค่า": r.value,
      "อายุค้าง (วัน)": r.ageDays,
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "ของค้าง")
    XLSX.writeFile(wb, `deadstock-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <DeadstockShell data={data} loading={loading} error={error} reload={reload}>
      {data && (
        <>
          <SummaryCards data={data} />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "#9CA3AF" }} />
              <input
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหา DD / ทะเบียน / รหัส / ชื่อสินค้า"
                style={{ padding: "7px 12px 7px 30px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, width: 290 }}
              />
            </div>
            <select value={bucket} onChange={(e) => setBucket(e.target.value)}
              style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }}>
              <option value="">ทุกช่วงอายุ</option>
              {AGE_BUCKETS.map((b) => {
                const n = data.summary.buckets.find((x) => x.key === b.key)?.count ?? 0
                return <option key={b.key} value={b.key}>{b.label} ({n})</option>
              })}
            </select>
            <select value={group} onChange={(e) => setGroup(e.target.value)}
              style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }}>
              <option value="">ทุกกลุ่มสินค้า</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <span style={{ fontSize: 13, color: "#6B7280" }}>
              แสดง {rows.length.toLocaleString()} / {data.pending.length.toLocaleString()} รายการ ·{" "}
              {baht(rows.reduce((s, r) => s + r.value, 0))}
            </span>
            <button onClick={exportXlsx} disabled={rows.length === 0}
              style={{
                marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6,
                padding: "7px 14px", borderRadius: 8, border: "1px solid #E5E7EB",
                background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>
              <Download size={14} /> Excel
            </button>
          </div>

          <div style={{ overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                  {["ใบ DD", "วันที่รับ", "ทะเบียนรถ", "รหัสสินค้า", "ชื่อสินค้า", "กลุ่ม", "คงเหลือ", "มูลค่า", "อายุค้าง"].map((h, i) => (
                    <th key={h} style={{
                      padding: "10px 12px", fontWeight: 700, color: "#374151",
                      borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap",
                      textAlign: i >= 6 ? "right" : "left",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.dd}|${r.itemCode}|${r.date}`} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ padding: "9px 12px", fontFamily: "monospace", whiteSpace: "nowrap" }}>{r.dd}</td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>{thaiDate(r.date)}</td>
                    <td style={{ padding: "9px 12px", fontWeight: 600, whiteSpace: "nowrap" }}>{r.plate}</td>
                    <td style={{ padding: "9px 12px", fontFamily: "monospace", whiteSpace: "nowrap" }}>{r.itemCode}</td>
                    <td style={{ padding: "9px 12px", minWidth: 220 }}>{r.itemName}</td>
                    <td style={{ padding: "9px 12px", color: "#6B7280", whiteSpace: "nowrap" }}>{r.itemGroup}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}>{r.remaining.toLocaleString()}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 600 }}>{baht(r.value)}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}><BucketBadge bucket={r.bucket} days={r.ageDays} /></td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: 28, textAlign: "center", color: "#9CA3AF" }}>ไม่พบรายการตามเงื่อนไข</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </DeadstockShell>
  )
}
```

```tsx
// app/deadstock/pending/page.tsx
import { DeadstockPendingPage } from "@/components/deadstock-pending-page"

export default function Page() {
  return <DeadstockPendingPage />
}
```

- [ ] **Step 3: ตรวจด้วยตา**

```bash
npm run dev
```
เปิด `http://localhost:3000/deadstock/pending` — ต้องเห็นตาราง ~289 แถว, การ์ดสรุป, ตัวกรองใช้ได้, ปุ่ม Excel โหลดไฟล์ได้, กล่องข้อจำกัดข้อมูลอยู่ท้ายหน้า

- [ ] **Step 4: Commit**

```bash
git add app/deadstock/pending/page.tsx components/deadstock-pending-page.tsx components/deadstock-shared.tsx
git commit -m "deadstock: หน้าสถานะล่าสุด — ตาราง DD ค้าง + อายุ + export Excel"
```

---

### Task 5: หน้าภาพรายเดือน (หน้าแรกของกลุ่ม)

**Files:**
- Create: `app/deadstock/page.tsx`
- Create: `components/deadstock-monthly-page.tsx`

**Interfaces:**
- Consumes: `useDeadstock`, `DeadstockShell`, `SummaryCards`, `baht`, `mitr` จาก `components/deadstock-shared.tsx` · `data.monthly: MonthPoint[]`
- Produces: ไม่มีของที่ task อื่นใช้ต่อ

- [ ] **Step 1: สร้างหน้า**

กราฟทำด้วย `div` ล้วน (repo ไม่มี chart library — ห้ามเพิ่ม dependency) แท่งซ้อน: ส่วนแดง = ค้างเกิน 7 วัน, ส่วนเทา = ค้างไม่เกิน 7 วัน

```tsx
// components/deadstock-monthly-page.tsx
"use client"

import { useState } from "react"
import { DeadstockShell, SummaryCards, baht, mitr, useDeadstock } from "@/components/deadstock-shared"

type Metric = "count" | "value"

export function DeadstockMonthlyPage() {
  const { data, error, loading, reload } = useDeadstock()
  const [metric, setMetric] = useState<Metric>("count")

  const pick = (m: { count: number; value: number; staleCount: number; staleValue: number }) =>
    metric === "count" ? { total: m.count, stale: m.staleCount } : { total: m.value, stale: m.staleValue }
  const fmt = (n: number) => (metric === "count" ? n.toLocaleString() : baht(n))

  const max = Math.max(1, ...(data?.monthly.map((m) => pick(m).total) ?? [1]))

  return (
    <DeadstockShell data={data} loading={loading} error={error} reload={reload}>
      {data && (
        <>
          <SummaryCards data={data} />

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <h2 style={{ ...mitr, fontSize: 16, fontWeight: 700, margin: 0 }}>ของค้าง ณ สิ้นแต่ละเดือน</h2>
            <div style={{ display: "flex", gap: 4, background: "#F3F4F6", padding: 3, borderRadius: 999 }}>
              {([["count", "จำนวนรายการ"], ["value", "มูลค่า"]] as [Metric, string][]).map(([k, label]) => (
                <button key={k} onClick={() => setMetric(k)} style={{
                  padding: "5px 14px", borderRadius: 999, border: "none", cursor: "pointer",
                  fontSize: 12.5, fontWeight: 700,
                  background: metric === k ? "#111827" : "transparent",
                  color: metric === k ? "#fff" : "#6B7280",
                }}>{label}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 14, marginLeft: "auto", fontSize: 12, color: "#6B7280" }}>
              <span><i style={{ display: "inline-block", width: 10, height: 10, background: "#DC2626", borderRadius: 2, marginRight: 5 }} />ค้างเกิน {data.staleDays} วัน</span>
              <span><i style={{ display: "inline-block", width: 10, height: 10, background: "#D1D5DB", borderRadius: 2, marginRight: 5 }} />ค้างไม่เกิน {data.staleDays} วัน</span>
            </div>
          </div>

          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "22px 20px 12px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 260 }}>
              {data.monthly.map((m) => {
                const { total, stale } = pick(m)
                const h = (total / max) * 210
                const staleH = total > 0 ? (stale / total) * h : 0
                return (
                  <div key={m.ym} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{fmt(total)}</div>
                    <div title={`${m.ym} — ค้าง ${fmt(total)} (เกิน ${data.staleDays} วัน ${fmt(stale)})`}
                      style={{ width: "100%", maxWidth: 62, height: Math.max(h, 2), background: "#D1D5DB", borderRadius: "5px 5px 0 0", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                      <div style={{ height: staleH, background: "#DC2626", borderRadius: h === staleH ? "5px 5px 0 0" : 0 }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
              {data.monthly.map((m) => (
                <div key={m.ym} style={{ flex: 1, textAlign: "center", fontSize: 12, color: "#6B7280" }}>{m.ym.slice(5)}/{m.ym.slice(2, 4)}</div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 18, overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F9FAFB", textAlign: "right" }}>
                  <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>เดือน</th>
                  {["ค้าง (รายการ)", "ค้าง (ชิ้น)", "มูลค่าค้าง", `เกิน ${data.staleDays} วัน (รายการ)`, `เกิน ${data.staleDays} วัน (มูลค่า)`].map((h) => (
                    <th key={h} style={{ padding: "10px 12px", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.monthly.map((m) => (
                  <tr key={m.ym} style={{ borderBottom: "1px solid #F3F4F6", textAlign: "right" }}>
                    <td style={{ padding: "9px 12px", textAlign: "left", fontWeight: 600 }}>{m.ym}</td>
                    <td style={{ padding: "9px 12px" }}>{m.count.toLocaleString()}</td>
                    <td style={{ padding: "9px 12px" }}>{m.qty.toLocaleString()}</td>
                    <td style={{ padding: "9px 12px" }}>{baht(m.value)}</td>
                    <td style={{ padding: "9px 12px", color: "#B91C1C", fontWeight: 600 }}>{m.staleCount.toLocaleString()}</td>
                    <td style={{ padding: "9px 12px", color: "#B91C1C", fontWeight: 600 }}>{baht(m.staleValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </DeadstockShell>
  )
}
```

```tsx
// app/deadstock/page.tsx
import { DeadstockMonthlyPage } from "@/components/deadstock-monthly-page"

export default function Page() {
  return <DeadstockMonthlyPage />
}
```

- [ ] **Step 2: ตรวจด้วยตา** — เปิด `http://localhost:3000/deadstock` เห็นกราฟ 8 แท่ง (2026-01…08) สลับหน่วยจำนวน/มูลค่าได้ ตารางล่างตรงกับกราฟ

- [ ] **Step 3: Commit**

```bash
git add app/deadstock/page.tsx components/deadstock-monthly-page.tsx
git commit -m "deadstock: หน้าภาพรายเดือน"
```

---

### Task 6: หน้ารายรหัสสินค้า

**Files:**
- Create: `app/deadstock/items/page.tsx`
- Create: `components/deadstock-items-page.tsx`

**Interfaces:**
- Consumes: `useDeadstock`, `DeadstockShell`, `BucketBadge`, `baht`, `thaiDate`, `mitr` · `data.items: ItemRow[]`, `data.pending: PendingRow[]`
- Produces: ไม่มีของที่ task อื่นใช้ต่อ

- [ ] **Step 1: สร้างหน้า**

```tsx
// components/deadstock-items-page.tsx
"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Search } from "lucide-react"
import { BucketBadge, DeadstockShell, baht, mitr, thaiDate, useDeadstock } from "@/components/deadstock-shared"

export function DeadstockItemsPage() {
  const { data, error, loading, reload } = useDeadstock()
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<Set<string>>(new Set())

  const toggle = (code: string) => setOpen((prev) => {
    const s = new Set(prev)
    if (s.has(code)) s.delete(code); else s.add(code)
    return s
  })

  const items = useMemo(() => {
    if (!data) return []
    const rx = q.trim() ? new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null
    return data.items.filter((i) => !rx || rx.test(i.itemCode) || rx.test(i.itemName) || rx.test(i.itemGroup))
  }, [data, q])

  return (
    <DeadstockShell data={data} loading={loading} error={error} reload={reload}>
      {data && (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "#9CA3AF" }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหารหัส / ชื่อ / กลุ่มสินค้า"
                style={{ padding: "7px 12px 7px 30px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, width: 290 }} />
            </div>
            <span style={{ fontSize: 13, color: "#6B7280" }}>
              {items.length.toLocaleString()} รหัสสินค้า · {baht(items.reduce((s, i) => s + i.value, 0))}
            </span>
          </div>

          <div style={{ overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  {["", "รหัสสินค้า", "ชื่อสินค้า", "กลุ่ม", "ใบ DD ค้าง", "คงเหลือ", "มูลค่า", "ค้างนานสุด"].map((h, i) => (
                    <th key={h || i} style={{
                      padding: "10px 12px", fontWeight: 700, color: "#374151",
                      borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap",
                      textAlign: i >= 4 ? "right" : "left",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const isOpen = open.has(it.itemCode)
                  const layers = isOpen ? data.pending.filter((p) => p.itemCode === it.itemCode) : []
                  return (
                    <>
                      <tr key={it.itemCode} onClick={() => toggle(it.itemCode)}
                        style={{ borderBottom: "1px solid #F3F4F6", cursor: "pointer" }}>
                        <td style={{ padding: "9px 12px", width: 28 }}>
                          {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </td>
                        <td style={{ padding: "9px 12px", fontFamily: "monospace", whiteSpace: "nowrap" }}>{it.itemCode}</td>
                        <td style={{ padding: "9px 12px", minWidth: 220 }}>{it.itemName}</td>
                        <td style={{ padding: "9px 12px", color: "#6B7280", whiteSpace: "nowrap" }}>{it.itemGroup}</td>
                        <td style={{ padding: "9px 12px", textAlign: "right" }}>{it.layers}</td>
                        <td style={{ padding: "9px 12px", textAlign: "right" }}>{it.remaining.toLocaleString()}</td>
                        <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 600 }}>{baht(it.value)}</td>
                        <td style={{ padding: "9px 12px", textAlign: "right" }}>{it.oldestAgeDays} วัน</td>
                      </tr>
                      {isOpen && layers.map((l) => (
                        <tr key={`${it.itemCode}|${l.dd}|${l.date}`} style={{ background: "#FAFAFA", borderBottom: "1px solid #F3F4F6" }}>
                          <td />
                          <td style={{ padding: "7px 12px", fontFamily: "monospace", fontSize: 12 }}>{l.dd}</td>
                          <td style={{ padding: "7px 12px", fontSize: 12, color: "#6B7280" }}>
                            รับ {thaiDate(l.date)} · ทะเบียน <b>{l.plate}</b>
                          </td>
                          <td />
                          <td />
                          <td style={{ padding: "7px 12px", textAlign: "right", fontSize: 12 }}>{l.remaining.toLocaleString()}</td>
                          <td style={{ padding: "7px 12px", textAlign: "right", fontSize: 12 }}>{baht(l.value)}</td>
                          <td style={{ padding: "7px 12px", textAlign: "right" }}><BucketBadge bucket={l.bucket} days={l.ageDays} /></td>
                        </tr>
                      ))}
                    </>
                  )
                })}
                {items.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 28, textAlign: "center", color: "#9CA3AF" }}>ไม่พบรหัสสินค้าตามเงื่อนไข</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </DeadstockShell>
  )
}
```

```tsx
// app/deadstock/items/page.tsx
import { DeadstockItemsPage } from "@/components/deadstock-items-page"

export default function Page() {
  return <DeadstockItemsPage />
}
```

หมายเหตุ: `<>...</>` ใน `map` ต้องมี `key` — ให้ใช้ `<Fragment key={it.itemCode}>` (import `Fragment` จาก react) แทน `<>` เพื่อไม่ให้ React เตือน

- [ ] **Step 2: ตรวจด้วยตา** — เปิด `http://localhost:3000/deadstock/items` กดขยายรหัสสินค้าแล้วเห็นใบ DD ที่ค้างของรหัสนั้น

- [ ] **Step 3: Commit**

```bash
git add app/deadstock/items/page.tsx components/deadstock-items-page.tsx
git commit -m "deadstock: หน้ารายรหัสสินค้า"
```

---

### Task 7: เมนู sidebar + ตรวจงานรวม + push

**Files:**
- Modify: `components/sidebar.tsx` (เพิ่ม NavGroup — วางต่อจากกลุ่ม "จัดการติดตามสินค้า")

**Interfaces:**
- Consumes: ทุก route จาก Task 4-6
- Produces: ไม่มี

- [ ] **Step 1: เพิ่มกลุ่มเมนู**

ใน `components/sidebar.tsx` เพิ่ม icon ที่ import (`PackageX`) และแทรก NavGroup:

```tsx
{
  label: "ของค้างคลัง",
  items: [
    { href: "/deadstock",         label: "ภาพรายเดือน",   icon: BarChart3, exact: true },
    { href: "/deadstock/pending", label: "สถานะล่าสุด",   icon: PackageX },
    { href: "/deadstock/items",   label: "รายรหัสสินค้า", icon: PackageSearch },
  ],
},
```

- [ ] **Step 2: ตรวจว่า lint และ build ผ่าน**

```bash
npm run lint
npm run build
```
Expected: ทั้งสองคำสั่งจบด้วย exit code 0 ไม่มี error

- [ ] **Step 3: รันสคริปต์ตรวจทั้งหมดอีกครั้ง**

```bash
npx tsx scripts/check-deadstock-core.ts
npx tsx scripts/check-deadstock.ts
```
Expected: ผ่านทั้งคู่

- [ ] **Step 4: ตรวจ 3 หน้าด้วยตาอีกรอบ** — `/deadstock`, `/deadstock/pending`, `/deadstock/items` เข้าได้จากเมนู sidebar ทั้งหมด

- [ ] **Step 5: Commit + push**

```bash
git add components/sidebar.tsx
git commit -m "deadstock: เพิ่มกลุ่มเมนูของค้างคลังใน sidebar"
git pull --rebase
git push
```

---

## Self-Review

**1. ครอบคลุม spec หรือไม่**

| หัวข้อ spec | Task |
|---|---|
| §2 โครงสร้างข้อมูล + index (ห้าม `คลังสินค้า`) | Task 1 (`INVENTORY_ID`), Task 2 (assert IXSCAN) |
| §3 ตัดค่าแรงใน query | Task 1 (`NOT_LABOUR` ใน pipeline ทั้งสอง) |
| §3 ตัดสต็อกกลางตอนแสดงผลเท่านั้น | Task 1 (`plate` filter ใน `buildPayload`) + เทสต์เฉพาะเรื่องนี้ |
| §4 FIFO + อายุ + เกณฑ์ 7 วัน | Task 1 (`consumeFifo`, `STALE_DAYS`, `AGE_BUCKETS`) |
| §4 แสดง unmatched ห้ามซ่อน | Task 4 (`DataQualityNote`) |
| §5 ยุบฝั่ง Mongo + cache | Task 2 |
| §6.1 ภาพรายเดือน | Task 5 |
| §6.2 สถานะล่าสุด + export | Task 4 |
| §6.3 รายรหัสสินค้า | Task 6 |
| §7 acceptance numbers | Task 2 Step 3 |
| §8 การทดสอบ | Task 1 (unit), Task 2 (integration + query plan) |
| สิทธิ์ทุกคนที่ login | ไม่ต้องทำ — `middleware.ts` จัดการแล้ว (ระบุใน Global Constraints) |

**2. Placeholder** — ตรวจแล้ว ไม่มี TBD/TODO ทุก step มีโค้ดจริงและคำสั่งรันจริง

**3. ชื่อและชนิดข้อมูลตรงกันข้าม task** — `DeadstockPayload`, `PendingRow`, `ItemRow`, `MonthPoint`, `BucketKey`, `AGE_BUCKETS`, `STALE_DAYS`, `getDeadstock()`, `useDeadstock()`, `DeadstockShell`, `SummaryCards`, `BucketBadge`, `baht`, `thaiDate` ใช้ชื่อเดียวกันทุกที่ที่อ้างถึง · `buildPayload(layerDocs, issueDocs, asOf)` ลำดับพารามิเตอร์ตรงกันระหว่าง Task 1, 2
