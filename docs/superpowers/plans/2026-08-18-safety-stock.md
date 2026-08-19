# Safety Stock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้า `/safety-stock` ใน mena-wms ที่บอกทีม store ลาดกระบังว่าวันนี้ต้องสั่งอะไร เท่าไหร่ และ min/max ที่ตั้งไว้ในระบบ ATMS สูงไปหรือต่ำไปเทียบกับการใช้จริง

**Architecture:** cron สองตัวทำงานต่อกัน — ตัวแรกดึง `stock_qty/min_qty/max_qty` จากหน้า SKU index ของ ATMS เข้า `master_data.atms_sku_master` ตัวที่สองรวมกับยอดเบิกและ lead time จาก `atms.stockmovement_v5` + `atms.purchase_requests` เขียนเป็น `master_data.safety_stock_snapshot` แถวละ SKU หน้าเว็บอ่าน snapshot ทั้งก้อนแล้วคำนวณ SS/ROP/สถานะในเบราว์เซอร์ด้วยไฟล์สูตรตัวเดียวกับที่ job ใช้

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · MongoDB driver 7 · Tailwind 4 · `xlsx` · tsx สำหรับสคริปต์ตรวจ

**Spec:** `docs/superpowers/specs/2026-08-18-safety-stock-design.md`

## Global Constraints

- **คลังเดียว:** `inventory_id = "4"` (คลังลาดกระบัง) — แต่ทุกฟังก์ชันรับ `inventoryId` เป็นพารามิเตอร์ ห้าม hardcode ลงกลางฟังก์ชัน
- **Query `stockmovement_v5` ต้องกรองด้วย `{ inventory_id, year_month }` เสมอ** — `คลังสินค้า` ไม่มี index จะ collscan 435k แถว
- **ห้ามยิง ATMS โดยไม่ขออนุมัติ** — ระบบล่มเมื่อโหลดหนัก (วัดจริง 2026-08-17: 176 requests @1s → error rate 40% ใน 35 นาที) ทุก request ต้องหน่วง ≥ 3 วินาที และมี backoff
- **ห้ามรัน query ที่ไม่มีขอบเขตกับ Mongo prod** — เคยทำ CPU 100% มาแล้ว (2026-07-08) ต้อง `explain` ก่อน
- **ตัดกลุ่มค่าแรงเสมอ:** `กลุ่มสินค้า: { $not: /^ค่าแรง/ }`
- **ไม่มี test framework** — ใช้ `import assert from "node:assert/strict"` + `npx tsx scripts/check-*.ts` ตามแพตเทิร์น `scripts/check-deadstock-core.ts`
- **ภาษา UI เป็นไทย** คอมเมนต์ในโค้ดเขียนไทยได้ ตามที่ `lib/deadstock-core.ts` ทำ
- **ค่าคงที่สูตร:** z เริ่มต้น 1.65 (service 95%) · หน้าต่าง ADU เริ่มต้น 6 เดือน · lead time ต้องมี ≥ 3 ตัวอย่างใน 24 เดือน · ทิ้ง lead time ที่ < 0 หรือ > 365 วัน
- **git:** อยู่บน `main` และมี `lib/atms-sku-log.ts` ที่แก้ไว้แล้วยังไม่ commit (คุกกี้ ATMS ที่หมุนใหม่) **ห้ามกลับค่านั้น** · `git pull` ก่อน commit · **ห้าม push จนกว่าจะได้รับอนุญาต**

---

## File Structure

| ไฟล์ | ความรับผิดชอบ |
|---|---|
| `lib/safety-stock-core.ts` | **สูตรล้วน ไม่ import อะไรเลย** — median, stdev, ADU, SD, SS, ROP, DoS, status, minVerdict, suggestQty, `derive()` ใช้ร่วมกันระหว่าง job กับเบราว์เซอร์ |
| `lib/atms-sku-log.ts` | *(แก้)* เพิ่ม `fetchSkuIndexPage()` อ่านคอลัมน์ stock/min/max ที่ `fetchSkuByCode` ทิ้ง |
| `lib/safety-stock-build.ts` | ชั้นคุย Mongo ฝั่งสร้าง — aggregate ยอดเบิก, แกะ PR หา lead time, ประกอบเป็นแถว snapshot |
| `lib/safety-stock.ts` | ชั้นคุย Mongo ฝั่งอ่าน — อ่าน snapshot + sync log ให้ API |
| `app/api/cron/atms-sku-sync/route.ts` | Job 1 |
| `app/api/cron/safety-stock-build/route.ts` | Job 2 |
| `app/api/safety-stock/route.ts` | API อ่านอย่างเดียว |
| `app/safety-stock/page.tsx` | route หลัก (บาง — เรียก component) |
| `app/safety-stock/baseline/page.tsx` | นิยามสูตร |
| `components/safety-stock-page.tsx` | ตาราง + ตัวกรอง + การ์ด + dialog + export |
| `components/sidebar.tsx` | *(แก้)* เพิ่มกลุ่มนำทาง |
| `vercel.json` | *(แก้)* เพิ่ม cron 2 ตัว |
| `scripts/probe-atms-sku-index.mjs` | probe ATMS 1 request ยืนยันลำดับคอลัมน์ |
| `scripts/check-safety-stock-core.ts` | ทดสอบสูตรล้วน |
| `scripts/check-safety-stock.ts` | ตรวจกับข้อมูลจริง อ่านอย่างเดียว |

---

## Task 1: Probe ลำดับคอลัมน์ของ ATMS SKU index

⛔ **ต้องขออนุมัติจากผู้ใช้ก่อนรัน** — ยิง ATMS จริง 1 request

สเปกอนุมานว่า `tds[6]/[7]/[8]` = stock/min/max จากหัวตาราง CSV export ยังไม่เคยยืนยันกับหน้าเว็บสด ถ้าผิดแล้วเขียน job ไปเลย ข้อมูลทั้งระบบจะผิดเงียบๆ

**Files:**
- Create: `scripts/probe-atms-sku-index.mjs`

**Interfaces:**
- Consumes: `ATMS_SKU_SESSION` env หรือ fallback cookie ใน `lib/atms-sku-log.ts:7`
- Produces: ยืนยัน index ของคอลัมน์ให้ Task 3 ใช้

- [ ] **Step 1: เขียนสคริปต์ probe**

```js
// scripts/probe-atms-sku-index.mjs
// รัน: node scripts/probe-atms-sku-index.mjs
// ยิง ATMS 1 request เพื่อยืนยันลำดับคอลัมน์ของหน้า SKU index ก่อนเขียน job จริง
import https from "node:https"

const SESSION = process.env.ATMS_SKU_SESSION || "06loqvjfva9b4l6mgnrjm9h07c"
const agent = new https.Agent({ rejectUnauthorized: false })

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      {
        hostname: u.hostname, path: u.pathname + u.search, method: "GET", agent, timeout: 120000,
        headers: { Cookie: `PHPSESSID=${SESSION}`, "Accept-Language": "th,en;q=0.9" },
      },
      (res) => {
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (c) => (body += c))
        res.on("end", () => resolve(body))
      }
    )
    req.on("error", reject)
    req.on("timeout", () => req.destroy(new Error("timeout")))
    req.end()
  })
}

const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()

const qs = new URLSearchParams({
  code: "", name: "", remark: "", type: "", inventory_id: "4", sku_tag_id: "",
  stock_unit_id: "", brand_id: "", is_tire: "", trackable: "", has_serial_no: "",
  no_gl_code: "0", submit: "ค้นหา", order_by: "s.code asc", page: "1",
})

const html = await fetchHtml(`https://www.mena-atms.com/inv/sku/index?${qs}`)

if (/name=["']LoginForm/i.test(html) || /เข้าสู่ระบบ/.test(html)) {
  console.error("❌ คุกกี้หมดอายุ — ตั้ง ATMS_SKU_SESSION ใหม่ก่อน")
  process.exit(1)
}

const thead = html.match(/<thead[\s\S]*?<\/thead>/)
if (thead) {
  const ths = [...thead[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => strip(m[1]))
  console.log("=== หัวตาราง ===")
  ths.forEach((t, i) => console.log(`  [${i}] ${t}`))
}

const tbody = html.match(/<tbody[\s\S]*?<\/tbody>/)
if (!tbody) { console.error("❌ ไม่พบ tbody"); process.exit(1) }

const rows = [...tbody[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
console.log(`\n=== ${rows.length} แถวในหน้านี้ · ตัวอย่าง 5 แถวแรก ===`)
for (const tr of rows.slice(0, 5)) {
  const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]))
  console.log(`  จำนวน td = ${tds.length}`)
  tds.forEach((t, i) => console.log(`    [${i}] ${t.slice(0, 40)}`))
  console.log("")
}

const total = strip(html).match(/[\d,]+\s*-\s*[\d,]+\s*\/\s*([\d,]+)/)
console.log("=== ยอดรวมจากแถบแบ่งหน้า ===", total ? total[1] : "ไม่พบ")
```

- [ ] **Step 2: ขออนุมัติจากผู้ใช้ แล้วรัน**

Run: `cd ~/Documents/project/master-sku-web && node scripts/probe-atms-sku-index.mjs`

Expected: หัวตารางพิมพ์ออกมาพร้อม index และแถวตัวอย่างที่ `[6]/[7]/[8]` เป็นตัวเลข ส่วน `[9]` เป็นหน่วย (ชิ้น/เส้น/ชุด) ตรงกับที่ `fetchSkuByCode` ใช้อยู่

- [ ] **Step 3: บันทึกผลลงสเปก**

ถ้าลำดับตรงตามที่สเปกเขียน: แก้บรรทัด `> **ยังไม่ยืนยันกับ ATMS สด**` ในสเปกเป็น `> **ยืนยันกับ ATMS สดแล้ว 2026-08-18**`

**ถ้าลำดับไม่ตรง: หยุด แจ้งผู้ใช้ แก้สเปกก่อน แล้วค่อยไป Task 3** — ห้ามเดา

- [ ] **Step 4: Commit**

```bash
git add scripts/probe-atms-sku-index.mjs docs/superpowers/specs/2026-08-18-safety-stock-design.md
git commit -m "safety-stock: probe ยืนยันลำดับคอลัมน์หน้า SKU index ของ ATMS"
```

---

## Task 2: `lib/safety-stock-core.ts` — สูตรล้วน

ไม่แตะ DB ไม่แตะ ATMS ทำได้ทันทีโดยไม่ต้องรอ Task 1

**Files:**
- Create: `lib/safety-stock-core.ts`
- Test: `scripts/check-safety-stock-core.ts`

**Interfaces:**
- Consumes: ไม่มี (ห้าม import อะไรทั้งสิ้น เพื่อให้ทดสอบตรงๆ ด้วย tsx)
- Produces:
  - `INVENTORY_ID: string`, `WAREHOUSE: string`, `DEFAULT_WINDOW: WindowKey`, `DEFAULT_Z: number`, `Z_BY_SERVICE: Record<number, number>`, `LT_MIN_SAMPLES: number`, `LT_MAX_DAYS: number`, `LT_LOOKBACK_MONTHS: number`, `USAGE_LOOKBACK_MONTHS: number`, `DAYS_PER_MONTH: number`, `STATUS_META`, `MIN_VERDICT_META`
  - types: `WindowKey`, `WindowStat`, `LeadTimeSource`, `Status`, `MinVerdict`, `SnapshotRow`, `Derived`, `SafetyStockPayload`
  - functions: `median(xs: number[]): number` · `stdev(xs: number[]): number` · `aduFrom(totalQty: number, months: number): number` · `sdDailyFrom(monthlyQty: number[]): number` · `safetyStockOf(sdDaily: number, leadTimeDays: number, z: number): number` · `reorderPointOf(adu: number, leadTimeDays: number, ss: number): number` · `daysOfSupplyOf(onHand: number, adu: number): number | null` · `statusOf(i: {usage12: number; onHand: number; rop: number; minQty: number; maxQty: number}): Status` · `minVerdictOf(minQty: number, rop: number, source: LeadTimeSource): MinVerdict` · `suggestQtyOf(onHand: number, maxQty: number, rop: number, adu: number, lt: number): number` · `derive(r: SnapshotRow, win: WindowKey, z: number): Derived` · `prCodeFromNote(note: string | null | undefined): string | null` · `leadTimeDaysBetween(prDate: string, receiveDate: string | Date): number | null`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
// scripts/check-safety-stock-core.ts
// รัน: npx tsx scripts/check-safety-stock-core.ts
// repo ไม่มี test framework — ใช้ assert ตามแพตเทิร์น check-deadstock-core.ts
import assert from "node:assert/strict"
import {
  median, stdev, aduFrom, sdDailyFrom, safetyStockOf, reorderPointOf,
  daysOfSupplyOf, statusOf, minVerdictOf, suggestQtyOf, derive,
  prCodeFromNote, leadTimeDaysBetween,
  DAYS_PER_MONTH, DEFAULT_Z, DEFAULT_WINDOW,
  type SnapshotRow,
} from "../lib/safety-stock-core"

// --- median: ทนค่าผิดปกติ จึงเลือกใช้แทน mean สำหรับ lead time ---
assert.equal(median([]), 0)
assert.equal(median([5]), 5)
assert.equal(median([1, 2, 3]), 2)
assert.equal(median([1, 2, 3, 4]), 2.5)
assert.equal(median([3, 1, 2]), 2, "ต้องเรียงก่อนหาค่ากลาง")
assert.equal(median([2, 2, 2, 900]), 2, "ค่าผิดปกติตัวเดียวต้องไม่ลากค่ากลาง")

// --- stdev: sample SD (หาร n-1) ---
assert.equal(stdev([]), 0)
assert.equal(stdev([5]), 0, "ตัวอย่างเดียว วัดความผันผวนไม่ได้ ต้องเป็น 0 ไม่ใช่ NaN")
assert.equal(stdev([4, 4, 4, 4]), 0)
assert.ok(Math.abs(stdev([2, 4, 4, 4, 5, 5, 7, 9]) - 2.13809) < 0.0001)

// --- aduFrom: ยอดเบิกรวม ÷ จำนวนวันในหน้าต่าง ---
assert.equal(aduFrom(0, 6), 0)
assert.ok(Math.abs(aduFrom(60, 6) - 60 / (6 * DAYS_PER_MONTH)) < 1e-9)
assert.equal(aduFrom(10, 0), 0, "หน้าต่าง 0 เดือน ต้องไม่หารด้วยศูนย์")

// --- sdDailyFrom: SD รายเดือน แปลงเป็นรายวัน ---
// ใช้รายเดือนเพราะอะไหล่เบิกเป็นครั้งคราว ถ้าใช้รายวันวันที่ไม่เบิกจะเป็น 0 ทำให้ SD บวม
assert.equal(sdDailyFrom([]), 0)
assert.equal(sdDailyFrom([5, 5, 5]), 0, "เบิกเท่ากันทุกเดือน = ไม่ผันผวน")
{
  const sd = sdDailyFrom([0, 10, 5, 5, 0, 10])
  assert.ok(Math.abs(sd - stdev([0, 10, 5, 5, 0, 10]) / Math.sqrt(DAYS_PER_MONTH)) < 1e-9)
}

// --- safetyStockOf = z × SD × √LT ---
assert.equal(safetyStockOf(0, 30, 1.65), 0, "ไม่ผันผวน = ไม่ต้องมี safety stock")
assert.equal(safetyStockOf(2, 0, 1.65), 0, "lead time 0 = ของมาทันที ไม่ต้องกัน")
assert.ok(Math.abs(safetyStockOf(2, 25, 1.65) - 1.65 * 2 * 5) < 1e-9)
assert.equal(safetyStockOf(2, -5, 1.65), 0, "lead time ติดลบต้องไม่ทำให้ √ เป็น NaN")

// --- reorderPointOf = ADU × LT + SS ---
assert.equal(reorderPointOf(0, 30, 0), 0)
assert.equal(reorderPointOf(2, 10, 5), 25)

// --- daysOfSupplyOf ---
assert.equal(daysOfSupplyOf(100, 0), null, "ไม่มีการใช้ ต้องเป็น null ไม่ใช่ Infinity")
assert.equal(daysOfSupplyOf(0, 2), 0)
assert.equal(daysOfSupplyOf(50, 2), 25)

// --- statusOf: ลำดับสำคัญ no_usage ต้องมาก่อนเสมอ ---
// ถ้าไม่คัด no_usage ออกก่อน ของที่ควร "เลิกตั้ง min/max" จะไปปนกับของที่ "ต้องสั่งเพิ่ม"
assert.equal(statusOf({ usage12: 0, onHand: 0, rop: 0, minQty: 5, maxQty: 10 }), "no_usage")
assert.equal(statusOf({ usage12: 0, onHand: 99, rop: 0, minQty: 5, maxQty: 10 }), "no_usage")
assert.equal(statusOf({ usage12: 20, onHand: 0, rop: 5, minQty: 5, maxQty: 10 }), "out")
assert.equal(statusOf({ usage12: 20, onHand: -3, rop: 5, minQty: 5, maxQty: 10 }), "out", "ยอดติดลบก็คือหมด")
assert.equal(statusOf({ usage12: 20, onHand: 3, rop: 5, minQty: 2, maxQty: 10 }), "below_rop")
assert.equal(statusOf({ usage12: 20, onHand: 4, rop: 3, minQty: 5, maxQty: 10 }), "below_min")
assert.equal(statusOf({ usage12: 20, onHand: 12, rop: 3, minQty: 5, maxQty: 10 }), "over_max")
assert.equal(statusOf({ usage12: 20, onHand: 7, rop: 3, minQty: 5, maxQty: 10 }), "ok")
assert.equal(statusOf({ usage12: 20, onHand: 99, rop: 3, minQty: 5, maxQty: 0 }), "ok", "ไม่ได้ตั้ง max ต้องไม่ฟ้อง over_max")

// --- minVerdictOf ---
assert.equal(minVerdictOf(5, 10, "warehouse"), "unknown", "lead time เป็นค่ากลางทั้งคลัง ห้ามตัดสิน min")
assert.equal(minVerdictOf(0, 10, "sku"), "unknown", "ไม่ได้ตั้ง min ก็ไม่มีอะไรให้ตัดสิน")
assert.equal(minVerdictOf(5, 0, "sku"), "unknown", "ROP = 0 (ไม่มีการใช้) ตัดสินไม่ได้")
assert.equal(minVerdictOf(5, 10, "sku"), "too_low")
assert.equal(minVerdictOf(25, 10, "sku"), "too_high")
assert.equal(minVerdictOf(20, 10, "sku"), "ok", "เท่ากับ 2 เท่าพอดี ยังถือว่าโอเค")
assert.equal(minVerdictOf(10, 10, "group"), "ok")

// --- suggestQtyOf: เติมให้ถึง max ถ้ามี ไม่มีก็เติมถึง ROP + ของที่ใช้ระหว่างรอ ---
assert.equal(suggestQtyOf(3, 10, 5, 0.2, 20), 7)
assert.equal(suggestQtyOf(12, 10, 5, 0.2, 20), 0, "เกิน max แล้ว ต้องไม่แนะนำให้สั่งเพิ่ม")
assert.equal(suggestQtyOf(2, 0, 5, 0.2, 20), 7, "ไม่มี max → ROP(5) + ADU×LT(4) − onHand(2) = 7")
assert.equal(suggestQtyOf(3, 10, 5, 0.2, 20) % 1, 0, "ต้องปัดขึ้นเป็นจำนวนเต็ม สั่งของเศษไม่ได้")

// --- prCodeFromNote: เลข PR ฝังใน หมายเหตุ ของแถวรับ ---
assert.equal(prCodeFromNote("LBPR26050758/71-5742/153/โม่ใหญ่"), "LBPR26050758")
assert.equal(prCodeFromNote("LBPR26050699/STOCK"), "LBPR26050699")
assert.equal(prCodeFromNote("LBPR25120644"), "LBPR25120644", "ไม่มี / ต่อท้ายก็ต้องจับได้")
assert.equal(prCodeFromNote("  LBPR26050758/x  "), "LBPR26050758", "ต้องตัดช่องว่างหัวท้าย")
assert.equal(prCodeFromNote("LBMR26050889/71-5742"), null, "MR ไม่ใช่ PR")
assert.equal(prCodeFromNote("เข้าสต๊อกเพื่อการซ่อมบำรุง"), null)
assert.equal(prCodeFromNote(""), null)
assert.equal(prCodeFromNote(null), null)

// --- leadTimeDaysBetween: PR เป็น DD/MM/YYYY ส่วนวันที่รับเป็น Date ---
assert.equal(leadTimeDaysBetween("01/06/2026", new Date("2026-06-16T00:00:00.000Z")), 15)
assert.equal(leadTimeDaysBetween("01/06/2026", new Date("2026-06-01T00:00:00.000Z")), 0)
assert.equal(leadTimeDaysBetween("16/06/2026", new Date("2026-06-01T00:00:00.000Z")), null, "รับก่อนขอซื้อ = ข้อมูลเพี้ยน ต้องทิ้ง")
assert.equal(leadTimeDaysBetween("01/01/2024", new Date("2026-06-01T00:00:00.000Z")), null, "เกิน 365 วัน ต้องทิ้ง")
assert.equal(leadTimeDaysBetween("ไม่ใช่วันที่", new Date()), null)
assert.equal(leadTimeDaysBetween("", new Date()), null)

// --- derive: ตัวรวมที่ทั้ง job และเบราว์เซอร์เรียกใช้ ---
const ROW: SnapshotRow = {
  code: "LB02MS00149", name: "สายพาน12.5x1250", group: "ระบบเครื่องยนต์", unit: "เส้น",
  brand: "", oracleCode: "", inventoryId: "4",
  minQty: 5, maxQty: 15, stockQty: 10,
  fifoRemaining: 10, oldestAgeDays: 40,
  usage:       { m3: 6, m6: 12, m12: 24 },
  issueCounts: { m3: 3, m6: 6,  m12: 12 },
  adu:         { m3: aduFrom(6, 3), m6: aduFrom(12, 6), m12: aduFrom(24, 12) },
  sdDaily:     { m3: sdDailyFrom([2, 2, 2]), m6: sdDailyFrom([2, 2, 2, 2, 2, 2]), m12: 0 },
  leadTimeDays: 20, leadTimeSource: "sku", leadTimeSamples: 5,
  cost: 250, value: 2500,
}

{
  const d = derive(ROW, DEFAULT_WINDOW, DEFAULT_Z)
  assert.ok(Math.abs(d.adu - aduFrom(12, 6)) < 1e-9)
  assert.equal(d.safetyStock, 0, "เบิกเท่ากันทุกเดือน SD = 0 จึงไม่ต้องมี safety stock")
  assert.ok(Math.abs(d.reorderPoint - aduFrom(12, 6) * 20) < 1e-6)
  assert.equal(d.status, "ok")
  assert.ok(d.daysOfSupply !== null && d.daysOfSupply > 0)
}
// สลับหน้าต่างต้องได้ ADU คนละค่า — นี่คือเหตุผลที่เก็บวัตถุดิบทั้งสามชุดไว้ในแถว
{
  const a = derive(ROW, "m3", DEFAULT_Z).adu
  const b = derive(ROW, "m12", DEFAULT_Z).adu
  assert.ok(Math.abs(a - b) > 1e-9, "m3 กับ m12 ต้องให้ ADU ต่างกัน")
}
// เพิ่ม service level ต้องได้ safety stock มากขึ้น (เมื่อมีความผันผวนจริง)
{
  const volatile: SnapshotRow = { ...ROW, sdDaily: { m3: 0.5, m6: 0.5, m12: 0.5 } }
  const lo = derive(volatile, DEFAULT_WINDOW, 1.28).safetyStock
  const hi = derive(volatile, DEFAULT_WINDOW, 2.33).safetyStock
  assert.ok(hi > lo, "service level สูงขึ้น safety stock ต้องสูงขึ้น")
}
// เคสขอบ: ไม่มีการใช้เลย
{
  const dead: SnapshotRow = {
    ...ROW, stockQty: 0,
    usage: { m3: 0, m6: 0, m12: 0 }, issueCounts: { m3: 0, m6: 0, m12: 0 },
    adu: { m3: 0, m6: 0, m12: 0 }, sdDaily: { m3: 0, m6: 0, m12: 0 },
    leadTimeDays: 30, leadTimeSource: "warehouse", leadTimeSamples: 0,
  }
  const d = derive(dead, DEFAULT_WINDOW, DEFAULT_Z)
  assert.equal(d.status, "no_usage")
  assert.equal(d.daysOfSupply, null)
  assert.equal(d.minVerdict, "unknown")
}
// เคสขอบ: min = max = 0 ต้องไม่ระเบิด (ถึงจะถูกกรองออกตั้งแต่ตอน build ก็ตาม)
{
  const d = derive({ ...ROW, minQty: 0, maxQty: 0 }, DEFAULT_WINDOW, DEFAULT_Z)
  assert.equal(d.minVerdict, "unknown")
  assert.ok(d.suggestQty >= 0)
}

console.log("✅ check-safety-stock-core ผ่านทั้งหมด")
```

- [ ] **Step 2: รัน test ให้เห็นว่าไม่ผ่าน**

Run: `cd ~/Documents/project/master-sku-web && npx tsx scripts/check-safety-stock-core.ts`
Expected: FAIL — `Cannot find module '../lib/safety-stock-core'`

- [ ] **Step 3: เขียน implementation ให้น้อยที่สุดที่ทำให้ผ่าน**

```ts
// lib/safety-stock-core.ts
// ตรรกะล้วนของหน้า /safety-stock — ห้าม import อะไรทั้งสิ้น เพื่อให้ทดสอบตรงๆ ด้วย tsx
// และเพื่อให้เบราว์เซอร์เรียกใช้สูตรตัวเดียวกับที่ cron ใช้ได้ (สูตรมีที่เดียว ไม่มีทางเพี้ยนคนละทาง)

export const INVENTORY_ID = "4"
export const WAREHOUSE = "คลังลาดกระบัง"

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
 *  ปัดขึ้นเสมอ — สั่งของเป็นเศษไม่ได้ */
export function suggestQtyOf(
  onHand: number, maxQty: number, rop: number, adu: number, lt: number
): number {
  const target = maxQty > 0 ? maxQty : rop + adu * Math.max(0, lt)
  return Math.max(0, Math.ceil(target - onHand))
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
    suggestQty: suggestQtyOf(onHand, r.maxQty, rop, adu, lt),
  }
}
```

- [ ] **Step 4: รัน test ให้ผ่าน**

Run: `cd ~/Documents/project/master-sku-web && npx tsx scripts/check-safety-stock-core.ts`
Expected: PASS — `✅ check-safety-stock-core ผ่านทั้งหมด`

- [ ] **Step 5: ตรวจว่า build ไม่พัง**

Run: `cd ~/Documents/project/master-sku-web && npx tsc --noEmit`
Expected: ไม่มี error ใหม่จากไฟล์ที่เพิ่งเพิ่ม

- [ ] **Step 6: Commit**

```bash
git add lib/safety-stock-core.ts scripts/check-safety-stock-core.ts
git commit -m "safety-stock: สูตรล้วน ADU/SD/SS/ROP/status พร้อมชุดทดสอบ"
```

---

## Task 3: อ่านคอลัมน์ stock/min/max จากหน้า SKU index

⛔ **ต้องผ่าน Task 1 ก่อน** — ถ้าลำดับคอลัมน์ไม่ตรงตามที่ probe ยืนยัน ห้ามเขียนต่อ

**Files:**
- Modify: `lib/atms-sku-log.ts` (แก้ `SkuMasterRow` ~บรรทัด 173-176, แก้ `fetchSkuByCode` ~บรรทัด 195-198, เพิ่มฟังก์ชันใหม่ท้ายไฟล์)

**Interfaces:**
- Consumes: `fetchHtml`, `stripTags`, `parseTotal` (private ในไฟล์เดียวกัน) · `AtmsSessionError` จาก `@/lib/atms-sync`
- Produces:
  - `SkuMasterRow` เพิ่มฟิลด์ `stockQty: number`, `minQty: number`, `maxQty: number`
  - `fetchSkuIndexPage(inventoryId: string, page: number, phpsessid: string): Promise<{ rows: SkuMasterRow[]; total: number | null }>`

- [ ] **Step 1: เพิ่มฟิลด์ในชนิดข้อมูลและตัวแกะแถวที่ใช้ร่วมกัน**

แทนที่บล็อก `export type SkuMasterRow = {...}` เดิม (บรรทัด 173-176) ด้วย:

```ts
export type SkuMasterRow = {
  skuPk: number; code: string; name: string; group: string
  warehouse: string; oracleCode: string; brand: string; unit: string
  /** คอลัมน์ 6-8 ของตาราง SKU index — ยืนยันลำดับด้วย scripts/probe-atms-sku-index.mjs แล้ว */
  stockQty: number; minQty: number; maxQty: number
}

/** "1,234.00" → 1234 · ช่องว่าง/ขีด → 0 */
function num(s: string | undefined): number {
  const n = Number((s ?? "").replace(/,/g, "").trim())
  return Number.isFinite(n) ? n : 0
}

/** แกะหนึ่ง <tr> ของตาราง SKU index — ใช้ร่วมกันทั้ง fetchSkuByCode และ fetchSkuIndexPage
 *  คืน null เมื่อแถวไม่ครบคอลัมน์หรือหา pk ไม่เจอ (แถวหัว/แถวสรุป) */
function parseSkuRow(trInner: string): SkuMasterRow | null {
  const raw = [...trInner.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
  if (raw.length < 15) return null
  const tds = raw.map((m) => stripTags(m[1]))
  const pk = raw[14][1].match(/\/inv\/sku\/view\/id\/(\d+)/)
  if (!pk) return null
  return {
    skuPk: Number(pk[1]), code: tds[0], name: tds[1], group: tds[2],
    warehouse: tds[3], oracleCode: tds[4], brand: tds[5], unit: tds[9],
    stockQty: num(tds[6]), minQty: num(tds[7]), maxQty: num(tds[8]),
  }
}
```

- [ ] **Step 2: ให้ `fetchSkuByCode` ใช้ตัวแกะแถวตัวเดียวกัน**

แทนที่ลูปในตัว `fetchSkuByCode` (บรรทัด ~187-200 เดิม) ด้วย:

```ts
  for (const tr of tbody[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = parseSkuRow(tr[1])
    if (!row) continue
    if (row.code.toLowerCase() !== code.toLowerCase()) continue
    return row
  }
  return null
```

- [ ] **Step 3: เพิ่มฟังก์ชันดึงทั้งหน้า**

ต่อท้ายไฟล์:

```ts
/** สร้าง URL ของตาราง SKU index — พารามิเตอร์ชุดเดียวกับที่ fetchSkuByCode ใช้
 *  ต่างกันแค่ปล่อย code ว่างและระบุคลัง + เลขหน้า */
function skuIndexUrl(inventoryId: string, page: number): string {
  const qs = new URLSearchParams({
    code: "", name: "", remark: "", type: "", inventory_id: inventoryId, sku_tag_id: "",
    stock_unit_id: "", brand_id: "", is_tire: "", trackable: "", has_serial_no: "",
    no_gl_code: "0", submit: "ค้นหา", order_by: "s.code asc", page: String(page),
  })
  return `https://www.mena-atms.com/inv/sku/index?${qs}`
}

/** ดึง SKU หนึ่งหน้าของคลังที่ระบุ พร้อมยอดรวมจากแถบแบ่งหน้า
 *  ต้องเรียก ensureRowsPerPage() ก่อน ไม่งั้นได้หน้าละ 20 แถวและต้องยิงเป็นร้อยครั้ง */
export async function fetchSkuIndexPage(
  inventoryId: string, page: number, phpsessid: string
): Promise<{ rows: SkuMasterRow[]; total: number | null }> {
  const html = await fetchHtml(skuIndexUrl(inventoryId, page), phpsessid)
  const tbody = html.match(/<tbody[\s\S]*?<\/tbody>/)
  if (!tbody) return { rows: [], total: parseTotal(html) }
  const rows: SkuMasterRow[] = []
  for (const tr of tbody[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = parseSkuRow(tr[1])
    if (row) rows.push(row)
  }
  return { rows, total: parseTotal(html) }
}
```

- [ ] **Step 4: ตรวจว่า type ยังผ่าน**

Run: `cd ~/Documents/project/master-sku-web && npx tsc --noEmit`
Expected: ไม่มี error — `masterCol.updateOne({...}, { $set: { ...master, updatedAt } })` ใน `app/api/cron/atms-sku-report/route.ts:76` รับฟิลด์ใหม่ได้เองเพราะ spread

- [ ] **Step 5: Commit**

```bash
git add lib/atms-sku-log.ts
git commit -m "safety-stock: อ่าน stock/min/max จากตาราง SKU index ของ ATMS"
```

---

## Task 4: Job ดึง min/max ทั้งคลังเข้า Mongo

⛔ **Step 4 ยิง ATMS จริง ~10 requests — ต้องขออนุมัติจากผู้ใช้ก่อน**

**Files:**
- Create: `app/api/cron/atms-sku-sync/route.ts`

**Interfaces:**
- Consumes: `atmsSkuSession()`, `ensureRowsPerPage()`, `fetchSkuIndexPage()` จาก Task 3 · `INVENTORY_ID`, `WAREHOUSE` จาก Task 2 · `clientPromise` จาก `@/lib/mongo`
- Produces: doc ใน `master_data.atms_sku_master` ที่มี `stockQty/minQty/maxQty/inventoryId/syncedAt` · doc ใน `master_data.safety_stock_sync_log` ที่ `{ trigger: "sku-sync" }`

- [ ] **Step 1: เขียน route**

```ts
// app/api/cron/atms-sku-sync/route.ts
import { NextRequest, NextResponse } from "next/server"
import { AtmsSessionError, AtmsNetworkError } from "@/lib/atms-sync"
import { atmsSkuSession, ensureRowsPerPage, fetchSkuIndexPage } from "@/lib/atms-sku-log"
import { INVENTORY_ID } from "@/lib/safety-stock-core"
import clientPromise from "@/lib/mongo"

const DB = process.env.MONGO_DB ?? "master_data"

export const maxDuration = 300
export const dynamic = "force-dynamic"

const ROWS_PER_PAGE = 1000
/** ATMS ล่มเมื่อยิงรัว — วัดจริง 2026-08-17: 176 requests @1s ทำให้ error rate ไต่ถึง 40% ใน 35 นาที */
const PACE_MS = 3000
const MAX_PAGES = 30
const RETRIES = 3

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// GET /api/cron/atms-sku-sync — ดึง SKU ทั้งคลังจากหน้า index ของ ATMS
// upsert stock/min/max เข้า atms_sku_master ให้ /api/cron/safety-stock-build ใช้ต่อ
// ป้องกันด้วย Authorization: Bearer <CRON_SECRET>
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const inventoryId = req.nextUrl.searchParams.get("inventory") ?? INVENTORY_ID
  const phpsessid = atmsSkuSession()
  const client = await clientPromise
  const db = client.db(DB)
  const syncedAt = new Date()

  let upserted = 0
  let pages = 0
  let total: number | null = null
  let ok = true
  let error: string | null = null

  try {
    await ensureRowsPerPage(phpsessid, ROWS_PER_PAGE)

    const col = db.collection("atms_sku_master")

    for (let page = 1; page <= MAX_PAGES; page++) {
      let res: Awaited<ReturnType<typeof fetchSkuIndexPage>> | null = null
      for (let attempt = 1; attempt <= RETRIES; attempt++) {
        try {
          res = await fetchSkuIndexPage(inventoryId, page, phpsessid)
          break
        } catch (e) {
          // คุกกี้ตายต้องหยุดทันที ไม่ต้อง retry ให้ ATMS โหลดหนักเปล่าๆ
          if (e instanceof AtmsSessionError) throw e
          if (attempt === RETRIES) throw e
          await sleep(PACE_MS * attempt * 2)
        }
      }
      if (!res) break
      pages = page
      if (total === null) total = res.total
      if (res.rows.length === 0) break

      await col.bulkWrite(
        res.rows.map((r) => ({
          updateOne: {
            filter: { skuPk: r.skuPk },
            update: { $set: { ...r, inventoryId, syncedAt } },
            upsert: true,
          },
        })),
        { ordered: false }
      )
      upserted += res.rows.length

      if (res.rows.length < ROWS_PER_PAGE) break
      if (total !== null && upserted >= total) break
      await sleep(PACE_MS)
    }
  } catch (err) {
    // ไม่เขียนทับข้อมูลเดิมเมื่อพัง — ของเก่าที่ถูกต้องดีกว่าตารางว่าง
    ok = false
    if (err instanceof AtmsSessionError) error = "Session expired — ตั้ง ATMS_SKU_SESSION ใหม่ (หรือแก้ fallback ใน lib/atms-sku-log.ts)"
    else if (err instanceof AtmsNetworkError) error = `Network error: ${err.message}`
    else if (err instanceof Error) error = err.message
    else error = "Unknown error"
  }

  await db.collection("safety_stock_sync_log").updateOne(
    { trigger: "sku-sync" },
    { $set: { trigger: "sku-sync", ok, inventoryId, upserted, pages, total, error, syncedAt } },
    { upsert: true }
  )

  return NextResponse.json({ ok, inventoryId, upserted, pages, total, error }, { status: ok ? 200 : 500 })
}
```

- [ ] **Step 2: ตรวจ type**

Run: `cd ~/Documents/project/master-sku-web && npx tsc --noEmit`
Expected: ไม่มี error

- [ ] **Step 3: รัน dev server**

Run: `cd ~/Documents/project/master-sku-web && npm run dev`
Expected: คอมไพล์ผ่าน ไม่มี error

- [ ] **Step 4: ⛔ ขออนุมัติผู้ใช้ แล้วยิงจริงหนึ่งรอบ**

Run: `curl -s "http://localhost:3000/api/cron/atms-sku-sync" | head -c 500`

Expected: `{"ok":true,"inventoryId":"4","upserted":9630,...}` โดย `upserted` ควรใกล้เคียง 9,630 (ยอดจาก CSV 6 ก.ค. 2026) และ `pages` ประมาณ 10

- [ ] **Step 5: ตรวจผลใน Mongo ว่าค่า min/max เข้าจริง**

```bash
cd ~/Documents/project/master-sku-web && npx tsx -e '
import { MongoClient } from "mongodb"
const c = new MongoClient(process.env.MONGO_URI!)
await c.connect()
const col = c.db(process.env.MONGO_DB ?? "master_data").collection("atms_sku_master")
console.log("รวม inv4:", await col.countDocuments({ inventoryId: "4" }))
console.log("มี minQty>0:", await col.countDocuments({ inventoryId: "4", minQty: { $gt: 0 } }))
console.log("มี maxQty>0:", await col.countDocuments({ inventoryId: "4", maxQty: { $gt: 0 } }))
console.log(await col.findOne({ code: "LB02MS00149" }, { projection: { code: 1, name: 1, stockQty: 1, minQty: 1, maxQty: 1, unit: 1, _id: 0 } }))
await c.close()
'
```

Expected: `minQty>0` ประมาณ 776 · `maxQty>0` ประมาณ 4,231 · `LB02MS00149` (สายพาน12.5x1250) มี `minQty: 5, maxQty: 15` ตามที่เห็นใน CSV

**ถ้าตัวเลขต่างจากนี้มาก: หยุด รายงานผู้ใช้** — อาจแปลว่าลำดับคอลัมน์เปลี่ยนหรือคลังมีการแก้ไขเยอะ

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/atms-sku-sync/route.ts
git commit -m "safety-stock: cron ดึง stock/min/max ทั้งคลังลาดกระบังเข้า atms_sku_master"
```

---

## Task 5: รวมยอดเบิกและ lead time เป็นแถว snapshot

⛔ **Step 3 อ่าน `atms.purchase_requests` ซึ่งยังไม่รู้ขนาด — ต้อง `explain` ก่อนและรายงานผู้ใช้**

**Files:**
- Create: `lib/safety-stock-build.ts`
- Test: `scripts/check-safety-stock.ts`

**Interfaces:**
- Consumes: `clientPromise` · ทุกอย่างจาก `lib/safety-stock-core.ts` · `getDeadstock()` จาก `@/lib/deadstock`
- Produces: `buildSnapshotRows(inventoryId: string, asOf: Date): Promise<{ rows: SnapshotRow[]; latestMovementDate: string | null; stats: BuildStats }>` โดย `BuildStats = { skuTotal: number; withMinMax: number; ltFromSku: number; ltFromGroup: number; ltFromWarehouse: number; prMatched: number; prMissed: number }`

- [ ] **Step 1: วัดขนาดและ index ของ `purchase_requests` ก่อนเขียนอะไร**

```bash
cd ~/Documents/project/master-sku-web && npx tsx -e '
import { MongoClient } from "mongodb"
const c = new MongoClient(process.env.MONGO_URI!)
await c.connect()
const col = c.db("atms").collection("purchase_requests")
console.log("จำนวน doc:", await col.estimatedDocumentCount())
console.log("index:", (await col.indexes()).map(i => i.name))
const ex = await col.find({ "ใบขอสั่งซื้อ (PR)": { $in: ["LBPR26050758"] } })
  .project({ "ใบขอสั่งซื้อ (PR)": 1, "วันที่": 1, _id: 0 }).explain("executionStats")
console.log("stage:", JSON.stringify(ex.queryPlanner?.winningPlan)?.slice(0, 300))
console.log("docsExamined:", ex.executionStats?.totalDocsExamined, "ms:", ex.executionStats?.executionTimeMillis)
await c.close()
'
```

Expected: รายงานตัวเลขให้ผู้ใช้ทราบ

**ถ้า `docsExamined` สูงกว่าจำนวนที่ตรงเงื่อนไขมาก (COLLSCAN):** หยุด แจ้งผู้ใช้ เสนอสร้าง index `{ "ใบขอสั่งซื้อ (PR)": 1 }` **แล้วรอคำอนุมัติ** ห้ามสร้าง index บน prod เอง

- [ ] **Step 2: เขียน `lib/safety-stock-build.ts`**

```ts
// lib/safety-stock-build.ts
// ชั้นคุย MongoDB ฝั่งสร้าง snapshot ของหน้า /safety-stock — ตรรกะสูตรอยู่ใน safety-stock-core.ts
import clientPromise from "@/lib/mongo"
import { getDeadstock } from "@/lib/deadstock"
import {
  aduFrom, sdDailyFrom, median, prCodeFromNote, leadTimeDaysBetween,
  LT_MIN_SAMPLES, LT_LOOKBACK_MONTHS, USAGE_LOOKBACK_MONTHS,
  type SnapshotRow, type LeadTimeSource,
} from "@/lib/safety-stock-core"

const MASTER_DB = process.env.MONGO_DB ?? "master_data"
const ATMS_DB = "atms"
const MOVE_COLL = "stockmovement_v5"
const PR_KEY = "ใบขอสั่งซื้อ (PR)"

export type BuildStats = {
  skuTotal: number; withMinMax: number
  ltFromSku: number; ltFromGroup: number; ltFromWarehouse: number
  prMatched: number; prMissed: number
}

/** "YYYY-MM" ของ n เดือนก่อน asOf (รวมเดือนปัจจุบัน) */
function ymBack(asOf: Date, n: number): string {
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - (n - 1), 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/** รายชื่อเดือนย้อนหลัง n เดือนถึงเดือนของ asOf — ต้องเติมเดือนที่ไม่มีการเบิกเป็น 0 ด้วย
 *  ไม่งั้น SD จะคำนวณจากเฉพาะเดือนที่มีการเบิก ซึ่งทำให้ความผันผวนต่ำกว่าความจริงมาก */
function ymList(asOf: Date, n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`)
  }
  return out
}

type IssueDoc = { _id: { i: string | null; m: string | null }; q: number | null; n: number | null }
type RecvDoc = { i: string | null; d: Date | null; note: string | null; c: number | null; g: string | null }

export async function buildSnapshotRows(
  inventoryId: string,
  asOf: Date
): Promise<{ rows: SnapshotRow[]; latestMovementDate: string | null; stats: BuildStats }> {
  const client = await clientPromise
  const atms = client.db(ATMS_DB)
  const move = atms.collection(MOVE_COLL)
  const masterCol = client.db(MASTER_DB).collection("atms_sku_master")

  const usageStartYm = ymBack(asOf, USAGE_LOOKBACK_MONTHS)
  const ltStartYm = ymBack(asOf, LT_LOOKBACK_MONTHS)
  const notLabour = { กลุ่มสินค้า: { $not: /^ค่าแรง/ } }

  // 1) SKU ที่ตั้ง min หรือ max ไว้เท่านั้น — คัดที่ Mongo ไม่ดึงทั้ง 9,630 แถวมา
  const masters = await masterCol
    .find({
      inventoryId,
      $or: [{ minQty: { $gt: 0 } }, { maxQty: { $gt: 0 } }],
      group: { $not: /^ค่าแรง/ },
    })
    .project({ _id: 0, skuPk: 1, code: 1, name: 1, group: 1, unit: 1, brand: 1, oracleCode: 1, stockQty: 1, minQty: 1, maxQty: 1 })
    .toArray()

  const skuTotal = await masterCol.countDocuments({ inventoryId })

  // 2) ยอดเบิกรายเดือน 12 เดือน — ยุบที่ Mongo ก่อนเสมอ (ดึงแถวดิบใช้เวลาต่างกันเป็นร้อยเท่า)
  const issues = await move
    .aggregate<IssueDoc>(
      [
        { $match: { inventory_id: inventoryId, year_month: { $gte: usageStartYm }, จ่าย: { $gt: 0 }, ...notLabour } },
        { $group: { _id: { i: "$รหัสสินค้า", m: "$year_month" }, q: { $sum: "$จ่าย" }, n: { $sum: 1 } } },
      ],
      { maxTimeMS: 60_000 }
    )
    .toArray()

  // 3) แถวรับ 24 เดือน — ต้องได้ `หมายเหตุ` รายแถวเพื่อแกะเลข PR จึงยุบไม่ได้
  const receipts = await move
    .aggregate<RecvDoc>(
      [
        { $match: { inventory_id: inventoryId, year_month: { $gte: ltStartYm }, รับ: { $gt: 0 }, ...notLabour } },
        { $project: { _id: 0, i: "$รหัสสินค้า", d: "$วันที่", note: "$หมายเหตุ", c: "$ราคาทุน", g: "$กลุ่มสินค้า" } },
      ],
      { maxTimeMS: 60_000 }
    )
    .toArray()

  // 4) วันที่ของ PR ที่ถูกอ้างถึงจริงเท่านั้น — bounded ตามจำนวน PR ที่พบในข้อ 3
  const prCodes = [...new Set(receipts.map((r) => prCodeFromNote(r.note)).filter((x): x is string => !!x))]
  const prDocs = prCodes.length
    ? ((await atms
        .collection("purchase_requests")
        .find({ [PR_KEY]: { $in: prCodes } })
        .project({ _id: 0, [PR_KEY]: 1, "วันที่": 1 })
        .toArray()) as Record<string, unknown>[])
    : []
  const prDate = new Map<string, string>()
  for (const d of prDocs) prDate.set(String(d[PR_KEY] ?? ""), String(d["วันที่"] ?? ""))

  // 5) lead time รายรหัส + รายกลุ่ม + ทั้งคลัง
  const ltBySku = new Map<string, number[]>()
  const ltByGroup = new Map<string, number[]>()
  const allLt: number[] = []
  const costBySku = new Map<string, number>()
  let prMatched = 0
  let prMissed = 0

  for (const r of receipts) {
    const code = r.i ?? ""
    if (!code) continue
    if (r.c != null && r.c > 0) costBySku.set(code, r.c) // ราคาทุนล่าสุดที่เจอ
    const pr = prCodeFromNote(r.note)
    if (!pr) continue
    const pd = prDate.get(pr)
    if (!pd) { prMissed++; continue }
    const days = r.d ? leadTimeDaysBetween(pd, r.d) : null
    if (days === null) { prMissed++; continue }
    prMatched++
    if (!ltBySku.has(code)) ltBySku.set(code, [])
    ltBySku.get(code)!.push(days)
    const g = (r.g ?? "").trim() || "ไม่ระบุ"
    if (!ltByGroup.has(g)) ltByGroup.set(g, [])
    ltByGroup.get(g)!.push(days)
    allLt.push(days)
  }

  const warehouseLt = allLt.length ? median(allLt) : 30 // ไม่มีข้อมูลเลย ใช้ 30 วันเป็นค่าตั้งต้น
  const groupLt = new Map<string, number>()
  for (const [g, xs] of ltByGroup) if (xs.length >= LT_MIN_SAMPLES) groupLt.set(g, median(xs))

  // 6) ยอดเบิกรายเดือนต่อรหัส — เติมเดือนที่ไม่มีการเบิกเป็น 0
  const issueByCode = new Map<string, Map<string, { q: number; n: number }>>()
  for (const d of issues) {
    const code = d._id.i ?? ""
    const m = d._id.m ?? ""
    if (!code || !m) continue
    if (!issueByCode.has(code)) issueByCode.set(code, new Map())
    issueByCode.get(code)!.set(m, { q: d.q ?? 0, n: d.n ?? 0 })
  }

  const months12 = ymList(asOf, 12)
  const windows: { key: "m3" | "m6" | "m12"; months: string[] }[] = [
    { key: "m3", months: months12.slice(-3) },
    { key: "m6", months: months12.slice(-6) },
    { key: "m12", months: months12 },
  ]

  // 7) FIFO จากหน้า /deadstock — ข้อมูลประกอบ ใช้ cache เดิม ไม่ยิง DB ซ้ำ
  const dead = await getDeadstock()
  const fifoByCode = new Map(dead.items.map((it) => [it.itemCode, it]))

  const stats: BuildStats = {
    skuTotal, withMinMax: masters.length,
    ltFromSku: 0, ltFromGroup: 0, ltFromWarehouse: 0,
    prMatched, prMissed,
  }

  const rows: SnapshotRow[] = masters.map((m) => {
    const code = String(m.code ?? "")
    const group = (String(m.group ?? "").trim()) || "ไม่ระบุ"
    const perMonth = issueByCode.get(code) ?? new Map()

    const usage = { m3: 0, m6: 0, m12: 0 }
    const issueCounts = { m3: 0, m6: 0, m12: 0 }
    const adu = { m3: 0, m6: 0, m12: 0 }
    const sdDaily = { m3: 0, m6: 0, m12: 0 }

    for (const w of windows) {
      const qs = w.months.map((ym) => perMonth.get(ym)?.q ?? 0)
      const ns = w.months.map((ym) => perMonth.get(ym)?.n ?? 0)
      const totalQ = qs.reduce((a, b) => a + b, 0)
      usage[w.key] = Math.round(totalQ * 100) / 100
      issueCounts[w.key] = ns.reduce((a, b) => a + b, 0)
      adu[w.key] = aduFrom(totalQ, w.months.length)
      sdDaily[w.key] = sdDailyFrom(qs)
    }

    const skuSamples = ltBySku.get(code) ?? []
    let leadTimeDays: number
    let leadTimeSource: LeadTimeSource
    if (skuSamples.length >= LT_MIN_SAMPLES) {
      leadTimeDays = median(skuSamples); leadTimeSource = "sku"; stats.ltFromSku++
    } else if (groupLt.has(group)) {
      leadTimeDays = groupLt.get(group)!; leadTimeSource = "group"; stats.ltFromGroup++
    } else {
      leadTimeDays = warehouseLt; leadTimeSource = "warehouse"; stats.ltFromWarehouse++
    }

    const fifo = fifoByCode.get(code)
    const cost = costBySku.get(code) ?? 0
    const stockQty = Number(m.stockQty ?? 0)

    return {
      code,
      name: String(m.name ?? ""),
      group,
      unit: String(m.unit ?? ""),
      brand: String(m.brand ?? ""),
      oracleCode: String(m.oracleCode ?? ""),
      inventoryId,
      minQty: Number(m.minQty ?? 0),
      maxQty: Number(m.maxQty ?? 0),
      stockQty,
      fifoRemaining: fifo?.remaining ?? 0,
      oldestAgeDays: fifo?.oldestAgeDays ?? 0,
      usage, issueCounts, adu, sdDaily,
      leadTimeDays: Math.round(leadTimeDays * 10) / 10,
      leadTimeSource,
      leadTimeSamples: skuSamples.length,
      cost: Math.round(cost * 100) / 100,
      value: Math.round(stockQty * cost * 100) / 100,
    }
  })

  const latest = await move
    .find({ inventory_id: inventoryId })
    .sort({ วันที่: -1 })   // ใช้ index วันที่_1 ที่มีอยู่แล้ว
    .limit(1)
    .project({ _id: 0, "วันที่": 1 })
    .toArray()
  const latestMovementDate = latest[0]?.["วันที่"] ? new Date(latest[0]["วันที่"] as Date).toISOString() : null

  return { rows, latestMovementDate, stats }
}
```

- [ ] **Step 3: เขียนสคริปต์ตรวจกับข้อมูลจริง (อ่านอย่างเดียว)**

```ts
// scripts/check-safety-stock.ts
// รัน: npx tsx scripts/check-safety-stock.ts
// อ่านอย่างเดียว ไม่เขียนอะไรลง DB — ใช้ตรวจว่าตัวเลขที่ได้สมเหตุสมผลก่อนเปิดใช้จริง
import assert from "node:assert/strict"
import { buildSnapshotRows } from "../lib/safety-stock-build"
import { derive, INVENTORY_ID, DEFAULT_WINDOW, DEFAULT_Z, STATUS_META } from "../lib/safety-stock-core"

const asOf = new Date()
const t0 = Date.now()
const { rows, latestMovementDate, stats } = await buildSnapshotRows(INVENTORY_ID, asOf)
console.log(`⏱  ${((Date.now() - t0) / 1000).toFixed(1)} วินาที`)

console.log("\n=== ขอบเขต ===")
console.log("SKU ทั้งคลัง:", stats.skuTotal)
console.log("มี min หรือ max (เข้าหน้านี้):", stats.withMinMax)
console.log("เคลื่อนไหวล่าสุดใน v5:", latestMovementDate)

assert.ok(rows.length > 0, "ต้องมีอย่างน้อยหนึ่งแถว — ถ้าเป็น 0 แปลว่า sync ยังไม่ได้รัน")
assert.equal(rows.length, stats.withMinMax)
assert.ok(rows.every((r) => r.minQty > 0 || r.maxQty > 0), "ทุกแถวต้องมี min หรือ max")
assert.ok(rows.every((r) => !r.group.startsWith("ค่าแรง")), "ต้องไม่มีกลุ่มค่าแรงหลุดเข้ามา")

console.log("\n=== ที่มาของ lead time ===")
console.log("รายรหัส:", stats.ltFromSku, "· รายกลุ่ม:", stats.ltFromGroup, "· ค่ากลางทั้งคลัง:", stats.ltFromWarehouse)
console.log("จับคู่ PR ได้:", stats.prMatched, "· จับคู่ไม่ได้:", stats.prMissed)

const derived = rows.map((r) => ({ r, d: derive(r, DEFAULT_WINDOW, DEFAULT_Z) }))

console.log("\n=== การกระจายของสถานะ ===")
for (const s of STATUS_META) {
  const n = derived.filter((x) => x.d.status === s.key).length
  console.log(`  ${s.th.padEnd(18)} ${String(n).padStart(5)}  (${((n / derived.length) * 100).toFixed(1)}%)`)
}

console.log("\n=== ตรวจ min ที่ตั้งไว้ ===")
for (const v of ["too_low", "too_high", "ok", "unknown"] as const) {
  console.log(`  ${v.padEnd(10)} ${derived.filter((x) => x.d.minVerdict === v).length}`)
}

console.log("\n=== 10 อันดับแรกที่ต้องสั่ง (เรียงตามมูลค่าคงเหลือ) ===")
derived
  .filter((x) => x.d.status === "out" || x.d.status === "below_rop")
  .sort((a, b) => b.r.value - a.r.value)
  .slice(0, 10)
  .forEach(({ r, d }) =>
    console.log(
      `  ${r.code.padEnd(16)} คงเหลือ ${String(r.stockQty).padStart(6)} ROP ${String(d.reorderPoint).padStart(7)} ` +
      `LT ${String(r.leadTimeDays).padStart(5)}(${r.leadTimeSource}) สั่ง ${String(d.suggestQty).padStart(5)} ${r.name.slice(0, 24)}`
    )
  )

assert.ok(derived.every((x) => x.d.suggestQty >= 0), "จำนวนที่แนะนำให้สั่งต้องไม่ติดลบ")
assert.ok(derived.every((x) => Number.isFinite(x.d.reorderPoint)), "ROP ต้องเป็นตัวเลขเสมอ")
assert.ok(
  derived.filter((x) => x.d.minVerdict !== "unknown").every((x) => x.r.leadTimeSource !== "warehouse"),
  "ห้ามตัดสิน min เมื่อ lead time เป็นค่ากลางทั้งคลัง"
)

console.log("\n✅ check-safety-stock ผ่านทั้งหมด")
process.exit(0)
```

- [ ] **Step 4: รันสคริปต์ตรวจ**

Run: `cd ~/Documents/project/master-sku-web && npx tsx scripts/check-safety-stock.ts`
Expected: PASS พร้อมตัวเลข — `มี min หรือ max` ควรอยู่ราว 4,000 แถว

**รายงานการกระจายของสถานะและที่มาของ lead time ให้ผู้ใช้ดูก่อนไปต่อ** ถ้า `ltFromWarehouse` เกิน 80% แปลว่าจับคู่ PR แทบไม่ติด ต้องหยุดตรวจสูตร `prCodeFromNote` กับข้อมูลจริงก่อน

- [ ] **Step 5: Commit**

```bash
git add lib/safety-stock-build.ts scripts/check-safety-stock.ts
git commit -m "safety-stock: รวมยอดเบิก + lead time จาก PR เป็นแถว snapshot"
```

---

## Task 6: Job เขียน snapshot

**Files:**
- Create: `app/api/cron/safety-stock-build/route.ts`

**Interfaces:**
- Consumes: `buildSnapshotRows()` จาก Task 5 · `derive()`, `INVENTORY_ID`, `DEFAULT_WINDOW`, `DEFAULT_Z` จาก Task 2
- Produces: doc ใน `master_data.safety_stock_snapshot` (`_id = "<inventoryId>|<code>"`) · doc ใน `safety_stock_sync_log` ที่ `{ trigger: "build" }`

- [ ] **Step 1: เขียน route**

```ts
// app/api/cron/safety-stock-build/route.ts
import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { buildSnapshotRows } from "@/lib/safety-stock-build"
import { derive, INVENTORY_ID, DEFAULT_WINDOW, DEFAULT_Z } from "@/lib/safety-stock-core"

const DB = process.env.MONGO_DB ?? "master_data"

export const maxDuration = 300
export const dynamic = "force-dynamic"

// GET /api/cron/safety-stock-build — สร้าง safety_stock_snapshot จาก atms_sku_master + v5 + PR
// ต้องรันหลัง /api/cron/atms-sku-sync
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const inventoryId = req.nextUrl.searchParams.get("inventory") ?? INVENTORY_ID
  const client = await clientPromise
  const db = client.db(DB)
  const syncedAt = new Date()

  let written = 0
  let ok = true
  let error: string | null = null
  let latestMovementDate: string | null = null
  let stats: unknown = null

  try {
    const built = await buildSnapshotRows(inventoryId, syncedAt)
    latestMovementDate = built.latestMovementDate
    stats = built.stats

    const col = db.collection("safety_stock_snapshot")
    if (built.rows.length > 0) {
      await col.bulkWrite(
        built.rows.map((r) => ({
          updateOne: {
            filter: { _id: `${inventoryId}|${r.code}` as unknown as never },
            update: { $set: { ...r, ...derive(r, DEFAULT_WINDOW, DEFAULT_Z), updatedAt: syncedAt } },
            upsert: true,
          },
        })),
        { ordered: false }
      )
      written = built.rows.length
      // ลบของที่หลุดออกจากเงื่อนไขแล้ว (store ถอด min/max ออก) — ทำหลังเขียนสำเร็จเท่านั้น
      await col.deleteMany({ inventoryId, updatedAt: { $lt: syncedAt } })

      await col.createIndex({ status: 1, value: -1 })
      await col.createIndex({ code: 1 })
    }
  } catch (err) {
    ok = false
    error = err instanceof Error ? err.message : "Unknown error"
  }

  await db.collection("safety_stock_sync_log").updateOne(
    { trigger: "build" },
    { $set: { trigger: "build", ok, inventoryId, written, latestMovementDate, stats, error, syncedAt } },
    { upsert: true }
  )

  return NextResponse.json({ ok, inventoryId, written, latestMovementDate, stats, error }, { status: ok ? 200 : 500 })
}
```

- [ ] **Step 2: ตรวจ type**

Run: `cd ~/Documents/project/master-sku-web && npx tsc --noEmit`
Expected: ไม่มี error

- [ ] **Step 3: รันจริงหนึ่งรอบ (เขียน collection ใหม่ ไม่แตะของเดิม)**

Run: `cd ~/Documents/project/master-sku-web && npm run dev` แล้ว `curl -s "http://localhost:3000/api/cron/safety-stock-build" | head -c 800`
Expected: `{"ok":true,"written":<ประมาณ 4000>,...}`

- [ ] **Step 4: ตรวจ snapshot ใน Mongo**

```bash
cd ~/Documents/project/master-sku-web && npx tsx -e '
import { MongoClient } from "mongodb"
const c = new MongoClient(process.env.MONGO_URI!)
await c.connect()
const col = c.db(process.env.MONGO_DB ?? "master_data").collection("safety_stock_snapshot")
console.log("รวม:", await col.countDocuments({}))
for (const s of ["out","below_rop","below_min","over_max","no_usage","ok"]) {
  console.log(" ", s.padEnd(10), await col.countDocuments({ status: s }))
}
console.log(await col.findOne({ code: "LB02MS00149" }))
await c.close()
'
```

Expected: จำนวนรวมตรงกับ `written` · ทุกสถานะมีตัวเลข · แถวตัวอย่างมี `reorderPoint`, `safetyStock`, `suggestQty` ครบ

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/safety-stock-build/route.ts
git commit -m "safety-stock: cron สร้าง safety_stock_snapshot"
```

---

## Task 7: API อ่าน snapshot

**Files:**
- Create: `lib/safety-stock.ts`
- Create: `app/api/safety-stock/route.ts`

**Interfaces:**
- Consumes: `SafetyStockPayload`, `SnapshotRow`, `INVENTORY_ID`, `WAREHOUSE` จาก Task 2
- Produces: `getSafetyStock(inventoryId: string, force?: boolean): Promise<SafetyStockPayload>` · `GET /api/safety-stock?refresh=1`

- [ ] **Step 1: เขียนชั้นอ่าน**

```ts
// lib/safety-stock.ts
// ชั้นคุย MongoDB ฝั่งอ่านของหน้า /safety-stock — snapshot สร้างไว้แล้วโดย cron จึงแค่อ่านออกมา
import clientPromise from "@/lib/mongo"
import { INVENTORY_ID, WAREHOUSE, type SafetyStockPayload, type SnapshotRow } from "@/lib/safety-stock-core"

const DB = process.env.MONGO_DB ?? "master_data"

// snapshot เปลี่ยนวันละครั้ง ไม่มีเหตุให้ยิง DB ทุก request
// เก็บบน globalThis เพื่อให้รอดข้าม hot-reload ตอน dev และข้าม warm invocation บน Vercel
const TTL_MS = 60 * 60 * 1000

declare global {
  var _safetyStockCache: Record<string, { at: number; data: SafetyStockPayload } | undefined> | undefined
}

export async function getSafetyStock(
  inventoryId: string = INVENTORY_ID,
  force = false
): Promise<SafetyStockPayload> {
  globalThis._safetyStockCache ??= {}
  const hit = globalThis._safetyStockCache[inventoryId]
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.data

  const client = await clientPromise
  const db = client.db(DB)

  const [rows, buildLog, skuLog] = await Promise.all([
    db.collection("safety_stock_snapshot")
      .find({ inventoryId })
      .project({ _id: 0, updatedAt: 0 })
      .toArray() as unknown as Promise<SnapshotRow[]>,
    db.collection("safety_stock_sync_log").findOne({ trigger: "build" }),
    db.collection("safety_stock_sync_log").findOne({ trigger: "sku-sync" }),
  ])

  const data: SafetyStockPayload = {
    asOf: new Date().toISOString(),
    warehouse: WAREHOUSE,
    inventoryId,
    latestMovementDate: (buildLog?.latestMovementDate as string | null) ?? null,
    skuSyncedAt: skuLog?.ok ? new Date(skuLog.syncedAt as Date).toISOString() : null,
    rows,
  }

  globalThis._safetyStockCache[inventoryId] = { at: Date.now(), data }
  return data
}
```

- [ ] **Step 2: เขียน route**

```ts
// app/api/safety-stock/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getSafetyStock } from "@/lib/safety-stock"
import { INVENTORY_ID } from "@/lib/safety-stock-core"

export const dynamic = "force-dynamic" // cache จัดการเองใน lib (TTL 1 ชม.)

export async function GET(req: NextRequest) {
  try {
    const inventoryId = req.nextUrl.searchParams.get("inventory") ?? INVENTORY_ID
    const data = await getSafetyStock(inventoryId, req.nextUrl.searchParams.get("refresh") === "1")
    return NextResponse.json(data)
  } catch (e) {
    console.error("[safety-stock] ", e)
    return NextResponse.json({ error: "ดึงข้อมูลไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
```

- [ ] **Step 3: ทดสอบ endpoint**

Run: `cd ~/Documents/project/master-sku-web && npm run dev` แล้ว
```bash
curl -s "http://localhost:3000/api/safety-stock" | npx tsx -e '
let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{
  const d=JSON.parse(s)
  console.log("แถว:", d.rows.length, "· คลัง:", d.warehouse)
  console.log("เคลื่อนไหวล่าสุด:", d.latestMovementDate, "· sync min/max:", d.skuSyncedAt)
  console.log("ตัวอย่าง:", JSON.stringify(d.rows[0], null, 1).slice(0, 400))
})'
```
Expected: ~4,000 แถว มี `latestMovementDate` และ `skuSyncedAt`

- [ ] **Step 4: Commit**

```bash
git add lib/safety-stock.ts app/api/safety-stock/route.ts
git commit -m "safety-stock: API อ่าน snapshot พร้อม cache TTL 1 ชม."
```

---

## Task 8: หน้าเว็บ

**Files:**
- Create: `app/safety-stock/page.tsx`
- Create: `components/safety-stock-page.tsx`
- Modify: `components/sidebar.tsx` (เพิ่ม NavGroup หลังกลุ่ม "ของค้างคลัง (ลาดกระบัง)" ~บรรทัด 108)

**Interfaces:**
- Consumes: `GET /api/safety-stock` · `derive`, `STATUS_META`, `MIN_VERDICT_META`, `Z_BY_SERVICE`, `WINDOW_MONTHS`, types จาก Task 2 · `MultiSelectCombobox` จาก `@/components/multi-select-combobox`
- Produces: หน้า `/safety-stock`

- [ ] **Step 1: เขียน route (บาง)**

```tsx
// app/safety-stock/page.tsx
import SafetyStockPage from "@/components/safety-stock-page"

export const metadata = { title: "จุดสั่งซื้อ (Safety Stock) — คลังลาดกระบัง" }

export default function Page() {
  return <SafetyStockPage />
}
```

- [ ] **Step 2: เขียน component**

โครงที่ต้องมี (เขียนตาม `components/deadstock-pending-page.tsx` เป็นแบบ — โทนสี ฟอนต์ `mitr` การจัดหัวตารางตรึงซ้าย):

```tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import { Download, RefreshCw, TriangleAlert } from "lucide-react"
import { MultiSelectCombobox } from "@/components/multi-select-combobox"
import {
  derive, STATUS_META, MIN_VERDICT_META, Z_BY_SERVICE, WINDOW_MONTHS,
  DEFAULT_WINDOW, DEFAULT_Z,
  type SafetyStockPayload, type SnapshotRow, type WindowKey, type Status,
} from "@/lib/safety-stock-core"

const baht = (n: number) =>
  n.toLocaleString("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 })

export default function SafetyStockPage() {
  const [data, setData]     = useState<SafetyStockPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ]           = useState("")
  const [groups, setGroups] = useState<string[]>([])
  const [statuses, setStatuses] = useState<Status[]>(["out", "below_rop"])
  const [win, setWin]       = useState<WindowKey>(DEFAULT_WINDOW)
  const [service, setService] = useState(95)

  useEffect(() => {
    fetch("/api/safety-stock")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  // คำนวณใหม่ในเครื่องเมื่อผู้ใช้เปลี่ยนหน้าต่างหรือ service level — ไม่ยิง DB ซ้ำ
  const enriched = useMemo(() => {
    if (!data) return []
    const z = Z_BY_SERVICE[service] ?? DEFAULT_Z
    return data.rows.map((r) => ({ r, d: derive(r, win, z) }))
  }, [data, win, service])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return enriched.filter(({ r, d }) => {
      if (statuses.length && !statuses.includes(d.status)) return false
      if (groups.length && !groups.includes(r.group)) return false
      if (needle && !r.code.toLowerCase().includes(needle) && !r.name.toLowerCase().includes(needle)) return false
      return true
    })
  }, [enriched, q, groups, statuses])

  // ...การ์ด 4 ใบ · แถบเตือนความสด · ตาราง · dialog · export
}
```

รายละเอียดที่ต้องทำครบ:

1. **แถบเตือนความสด** — ถ้า `data.latestMovementDate` เก่ากว่า 2 วัน แสดงแถบแดงเต็มความกว้างบนสุด ข้อความ: `⚠ ข้อมูลการเคลื่อนไหวล่าสุดคือ <วันที่> (<n> วันที่แล้ว) — ตัวเลขคงเหลืออาจไม่เป็นปัจจุบัน ตรวจสอบ pipeline ก่อนใช้ตัดสินใจสั่งของ` · ถ้า `data.skuSyncedAt` เป็น `null` แสดงแถบส้ม: `⚠ ยังไม่เคย sync min/max จาก ATMS สำเร็จ`
2. **การ์ด 4 ใบ** — ต้องสั่งวันนี้ (`out` + `below_rop`: จำนวนรหัส + `Σ suggestQty × cost`) · ของหมด (`out`) · เกิน max (`over_max`: จำนวน + `Σ (stockQty − maxQty) × cost`) · min/max ควรทบทวน (`minVerdict` เป็น `too_low`/`too_high` + สถานะ `no_usage`)
3. **ตาราง** คอลัมน์ตามสเปกข้อ 6.1 · `position: sticky; left: 0` ที่คอลัมน์รหัสและชื่อ · ห่อด้วย `overflow-x: auto` · เรียงเริ่มต้นตามมูลค่าที่ต้องสั่งมากไปน้อย · คลิกหัวคอลัมน์เพื่อเรียง
4. **คอลัมน์ LT ต้องแสดงที่มา** — `20 วัน` พร้อมป้ายเล็ก `รายรหัส (5 ครั้ง)` / `กลุ่ม` / `ค่ากลางคลัง` โดยป้าย `ค่ากลางคลัง` เป็นสีเทาจาง
5. **คอลัมน์ "จำนวนครั้งที่เบิก" ห้ามตัดออก** — แสดงคู่กับ ADU เสมอ เช่น `0.03/วัน · 12 ครั้ง/ปี` ถ้าไม่มีตัวนี้ ADU ที่เป็นทศนิยมเล็กๆ จะดูไม่น่าเชื่อจนทีมไม่ใช้ทั้งตาราง
6. **ชิปสถานะ** ใช้ `STATUS_META` เรียงตามลำดับในไฟล์ กดสลับเปิด/ปิดได้ แสดงจำนวนในวงเล็บ
7. **dialog รายรหัส** — เปิดเมื่อคลิกแถว แสดงกราฟแท่งยอดเบิก 12 เดือน (SVG เขียนเอง ไม่เพิ่ม dependency) · ล็อต FIFO ที่ค้าง (`fifoRemaining`, `oldestAgeDays`) · ค่า min/max/ROP/SS เทียบกัน · ที่มาของ lead time
8. **ปุ่ม Export Excel** ใช้ `xlsx` แบบเดียวกับ `components/deadstock-pending-page.tsx` ส่งออกเฉพาะแถวที่กรองอยู่ ชื่อไฟล์ `safety-stock-<YYYY-MM-DD>.xlsx`
9. **ปุ่มดึงข้อมูลใหม่** เรียก `/api/safety-stock?refresh=1` แสดงเฉพาะ `session.user.role === "admin"` (ดูวิธีเช็คที่ `components/sidebar.tsx:155`)

- [ ] **Step 3: เพิ่มกลุ่มใน sidebar**

ใน `components/sidebar.tsx` แทรก NavGroup ใหม่ต่อจากกลุ่ม `"ของค้างคลัง (ลาดกระบัง)"`:

```tsx
  {
    label: "จุดสั่งซื้อ (ลาดกระบัง)",
    collapsible: true,
    items: [
      { href: "/safety-stock", label: "Safety Stock", icon: PackageSearch, exact: true },
      { href: "/safety-stock/baseline", label: "นิยามตัวชี้วัด", icon: BookOpen, exact: true },
    ],
  },
```

`PackageSearch` และ `BookOpen` ถูก import อยู่แล้วในไฟล์นี้ ไม่ต้องเพิ่ม import

- [ ] **Step 4: ตรวจ type และ lint**

Run: `cd ~/Documents/project/master-sku-web && npx tsc --noEmit && npm run lint`
Expected: ไม่มี error

- [ ] **Step 5: ดูของจริงในเบราว์เซอร์**

Run: `cd ~/Documents/project/master-sku-web && npm run dev` แล้วเปิด `http://localhost:3000/safety-stock`

ตรวจด้วยตา:
- การ์ด 4 ใบมีตัวเลข ไม่ใช่ 0 ทั้งหมด
- ตารางเลื่อนแนวนอนได้ คอลัมน์รหัส/ชื่อตรึงอยู่
- สลับหน้าต่าง 3/6/12 แล้ว ADU กับ ROP เปลี่ยนจริง
- เลื่อน service level 90→99 แล้ว SS เพิ่มขึ้นจริง
- กดชิปสถานะแล้วตารางกรองถูก
- Export Excel เปิดไฟล์ได้และมีจำนวนแถวตรงกับที่กรอง

- [ ] **Step 6: Commit**

```bash
git add app/safety-stock components/safety-stock-page.tsx components/sidebar.tsx
git commit -m "safety-stock: หน้าเว็บตาราง ตัวกรอง การ์ด และ export"
```

---

## Task 9: หน้านิยามสูตร และเปิด cron

**Files:**
- Create: `app/safety-stock/baseline/page.tsx`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: ค่าคงที่จาก `lib/safety-stock-core.ts` (อ่านค่าจริงมาแสดง ห้าม hardcode ซ้ำในหน้า)
- Produces: หน้า `/safety-stock/baseline` · cron 2 รายการ

- [ ] **Step 1: เขียนหน้านิยาม**

ทำตามแบบ `app/deadstock/baseline/page.tsx` ต้องอธิบายให้ทีม store อ่านเองเข้าใจ:

- **ที่มาของแต่ละตัวเลข** — on-hand มาจาก ATMS · ยอดเบิกมาจาก `stockmovement_v5` · lead time มาจาก PR→รับของ
- **สูตรทั้ง 6 ตัว** พร้อมตัวอย่างคำนวณจริงหนึ่งรหัส เดินให้ดูทีละขั้น
- **ตารางสถานะ 6 แบบ** พร้อมคำอธิบายว่าต้องทำอะไรเมื่อเจอแต่ละสถานะ
- **ทำไม `no_usage` ต้องมาก่อน** — ของที่ควรเลิกตั้ง min/max กับของที่ต้องสั่งเพิ่ม เป็นการกระทำคนละทางกัน
- **ข้อจำกัดที่ต้องบอกตรงๆ ห้ามซ่อน:**
  - min/max ครอบคลุมแค่ ~44% ของ SKU ในคลัง อีก 56% ยังไม่ได้ตั้ง จึงไม่ปรากฏในหน้านี้เลย
  - lead time ที่มาจาก "ค่ากลางทั้งคลัง" เป็นการเดา — ใช้ประกอบได้แต่ห้ามใช้ตัดสิน min
  - ยอดคงเหลือเป็นตัวเลขจาก ATMS ณ เวลาที่ sync ไม่ใช่การนับของจริงในชั้นวาง
  - ข้อมูลการเคลื่อนไหวอัปเดตวันละครั้ง และ pipeline ต้นทางเคยตายเงียบมาแล้ว 2 ครั้ง ให้ดูแถบวันที่เสมอ

- [ ] **Step 2: เพิ่ม cron**

แก้ `vercel.json` เป็น:

```json
{
  "crons": [
    { "path": "/api/cron/tire-sync", "schedule": "0 2 * * *" },
    { "path": "/api/cron/atms-sku-report", "schedule": "0 3 * * *" },
    { "path": "/api/cron/atms-sku-sync", "schedule": "30 3 * * *" },
    { "path": "/api/cron/safety-stock-build", "schedule": "0 4 * * *" }
  ]
}
```

เวลาเป็น UTC — `30 3` = 10:30 น. ไทย และ `0 4` = 11:00 น. ไทย ทั้งคู่อยู่หลัง pipeline v5 ที่เขียนเสร็จราว 09:25 น. ไทย (02:25 UTC) และห่างจาก cron เดิมที่ 03:00 UTC พอที่จะไม่ยิง ATMS ชนกัน

- [ ] **Step 3: ตรวจ build เต็ม**

Run: `cd ~/Documents/project/master-sku-web && npm run build`
Expected: build ผ่าน ไม่มี type error และเห็น route `/safety-stock`, `/safety-stock/baseline`, `/api/safety-stock` ในผลลัพธ์

- [ ] **Step 4: Commit**

```bash
git add app/safety-stock/baseline vercel.json
git commit -m "safety-stock: หน้านิยามตัวชี้วัด และเปิด cron รายวัน"
```

- [ ] **Step 5: ⛔ ขออนุมัติก่อน push**

Run: `git pull --rebase && git log --oneline origin/main..HEAD`
แสดงรายการ commit ให้ผู้ใช้ดู **แล้วรอคำอนุมัติก่อน `git push`**

หลัง push ต้องแจ้งผู้ใช้ว่า Vercel ต้องมี `CRON_SECRET` และ `ATMS_SKU_SESSION` ตั้งไว้แล้ว ไม่งั้น cron ใหม่จะใช้ fallback cookie ในโค้ดซึ่งหมุนบ่อย

---

## Self-Review

**Spec coverage:**

| หัวข้อในสเปก | Task |
|---|---|
| §2.1 ยืนยันลำดับคอลัมน์ ATMS | 1 |
| §2.2 คัดเฉพาะที่มี min/max | 5 (ขั้น query) |
| §2.3 v5 + index บังคับ | 5 |
| §2.4 purchase_requests + วัด explain | 5 ขั้นที่ 1 |
| §3 กติกาคัดกรอง | 5 |
| §4 สูตรทั้งหมด | 2 |
| §4 lead time ลดหลั่น 3 ชั้น | 5 |
| §4 สถานะ 6 แบบ + no_usage มาก่อน | 2 |
| §4 minVerdict | 2 |
| §5 สถาปัตยกรรม 2 cron | 4, 6 |
| §5 เก็บวัตถุดิบ คำนวณฝั่ง client | 2 (`derive`), 8 (`useMemo`) |
| §5 schema + index | 6 |
| §5 sync log | 4, 6 |
| §6.1 หน้าหลัก | 8 |
| §6.2 baseline | 9 |
| §6.3 สิทธิ์ | 8 ขั้นที่ 2 ข้อ 9 |
| §7 v5 ค้างเกิน 2 วัน | 8 ขั้นที่ 2 ข้อ 1 |
| §7 คุกกี้ตายไม่เขียนทับ | 4 |
| §7 ยังไม่เคยรัน job | 8 ขั้นที่ 2 ข้อ 1 |
| §8 สคริปต์ตรวจ 3 ตัว | 1, 2, 5 |
| §9 ลำดับงาน | ทั้งแผน |

ครบทุกหัวข้อ

**Placeholder scan:** Task 8 ขั้นที่ 2 ให้โครง component พร้อมรายการสิ่งที่ต้องทำครบ 9 ข้อแทนที่จะเขียน JSX เต็ม — เป็นงาน UI ที่ต้องดูของจริงประกอบ และทุกข้อระบุพฤติกรรมที่ตรวจได้ชัดเจนพร้อมไฟล์อ้างอิงที่ลอกแบบได้ ส่วน Task 9 ขั้นที่ 1 ระบุหัวข้อที่ต้องมีครบพร้อมข้อจำกัด 4 ข้อที่ต้องเขียนตรงๆ ไม่ใช่ "เขียนหน้าอธิบาย" ลอยๆ

**Type consistency:** ตรวจแล้ว — `SnapshotRow` ที่ Task 2 นิยาม ถูกใช้ตรงกันใน Task 5 (สร้าง), Task 6 (เขียน), Task 7 (อ่าน), Task 8 (แสดง) · `derive()` ลายเซ็นเดียวกันทั้ง Task 6 และ 8 · `SkuMasterRow` ที่ Task 3 ขยาย ถูกใช้ใน Task 4 ผ่าน spread · `fetchSkuIndexPage` คืน `{ rows, total }` ตรงกับที่ Task 4 เรียกใช้ · `BuildStats` ที่ Task 5 นิยาม ถูกอ้างใน Task 6 ผ่าน `stats` และใน `check-safety-stock.ts`
