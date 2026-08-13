# ติดตามเจ้าหนี้ (AP Document Tracking) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มหน้า `/ap-tracking` "ติดตามเจ้าหนี้" ใน mena-wms ให้ผู้ใช้ประกบชุดเอกสารต่อใบ DD (DD + PO + อย่างน้อย 1 ใน 5 เอกสารการเงิน) แล้วส่งบัญชีจ่ายเงิน พร้อมติดตาม credit term

**Architecture:** อ่านแถวสดจาก `atms.deposit_header` (join `atms.purchase_orders`) แบบ read-only ตาม pattern หน้า `/pr` แล้ว overlay ข้อมูลที่ผู้ใช้กรอกไว้ใน `master_data.ap_tracking` (สร้าง doc ตอนติ๊กครั้งแรก แบบ lazy เหมือน `pr_tracking`) · credit term มาจาก master ใหม่ `master_data.ap_supplier` · สถานะทั้งหมด **คำนวณ** จาก checkbox + วันที่ ไม่มี dropdown สถานะ

**Tech Stack:** Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · MongoDB driver v7 · next-auth (getServerSession) · Tailwind v4 · lucide-react · sweetalert2 (lib/swal) · xlsx (seed script)

**Spec:** `docs/superpowers/specs/2026-08-12-ap-tracking-design.md`

## Global Constraints

- **ไม่มี test framework ใน repo นี้** (ไม่มี jest/vitest) — pure function ทดสอบด้วย assertion script รัน `npx tsx scripts/check-ap-tracking.ts` (repo มี `tsx` เป็น devDependency แล้ว) · UI/API ตรวจด้วย `npm run lint`, `npm run build` และเปิดเบราว์เซอร์จริง
- **ห้ามแตะข้อมูลใน `atms.*`** — read-only ทุกจุด (write เฉพาะ `master_data.ap_tracking` / `master_data.ap_supplier`)
- **ห้ามรัน query หนัก/ไม่มีขอบเขตบน Mongo prod** ทุก query ต้องมี `$match` จำกัดเดือน + `limit` เสมอ (เคยทำ prod CPU 100% มาแล้ว) · การสร้าง index บน `atms.*` ต้องขอผู้ใช้ก่อนเสมอ (Task 10)
- **ห้ามใช้ Vercel cron slot เพิ่ม** — เต็ม 2/2 (Hobby) แล้ว
- ภาษา UI ทั้งหมดเป็นภาษาไทย · comment ในโค้ดเขียนไทยได้ตาม convention repo
- ทุก API ต้องผ่าน login (middleware เดิมคุมอยู่แล้ว) · ทุกคนที่ login แล้ว CRUD ได้ ไม่มี admin gate (ตาม convention repair-external)
- ชื่อ collection: `master_data.ap_tracking`, `master_data.ap_supplier` — ห้ามเปลี่ยน
- ค่า `sentType` ที่ถูกต้องมีแค่ `""` | `"นอกรอบ"` | `"ตามรอบ"` · `creditTerm` มีแค่ `Immediate` | `7D` | `15D` | `30D` | `60D`
- วันที่ที่เก็บใน `master_data.*` ทั้งหมดเป็น string `YYYY-MM-DD` · วันที่ใน `atms.*` เป็น string `DD/MM/YYYY` (แปลงด้วย `parseDmy` เสมอ ห้าม `new Date(str)` ตรง ๆ)

---

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `lib/ap-tracking.ts` (สร้าง) | pure logic ทั้งหมด: ประเภท, รายการช่องเอกสาร, เงื่อนไขครบชุด, สถานะ, credit term → due date, พฤหัสถัดไป, parser วันที่/จำนวนเงินจาก ATMS |
| `scripts/check-ap-tracking.ts` (สร้าง) | assertion script ของ `lib/ap-tracking.ts` (แทน unit test) |
| `scripts/probe-deposit-shape.mjs` (สร้าง) | probe read-only ดูรูปแบบข้อมูลจริงของ `deposit_header`/`deposit_items` (Task 1) |
| `scripts/seed-ap-suppliers.mjs` (สร้าง) | seed `ap_supplier` จาก Excel เจ้าหนี้ กค. 2026 |
| `app/api/ap-suppliers/route.ts` (สร้าง) | GET list / PUT upsert credit term |
| `app/api/ap-tracking/route.ts` (สร้าง) | GET list แถว DD + summary (join atms + overlay) |
| `app/api/ap-tracking/[code]/route.ts` (สร้าง) | GET detail (deposit_items + PO + log) / PATCH เขียน tracking + log |
| `app/ap-tracking/page.tsx` (สร้าง) | route wrapper |
| `app/ap-tracking/suppliers/page.tsx` (สร้าง) | route wrapper หน้า master |
| `components/ap-tracking-page.tsx` (สร้าง) | UI หลัก: แถบสรุป, ตัวกรอง, ตารางติ๊ก inline, popover ส่งบัญชี |
| `components/ap-tracking-detail.tsx` (สร้าง) | modal รายละเอียดใบ DD (รายการสินค้า + PO + log) |
| `components/ap-suppliers-page.tsx` (สร้าง) | UI จัดการ credit term ต่อซัพพลายเออร์ |
| `components/sidebar.tsx` (แก้ ~บรรทัด 84-92) | เพิ่ม 2 เมนูในกลุ่ม "จัดการติดตามสินค้า" |

---

### Task 1: ยืนยันรูปแบบข้อมูลจริงใน ATMS (ก่อนเขียน parser)

`deposit_header` ถูกเขียนจาก atms-extractor โดย **ทุกคอลัมน์เป็น string ที่ scrape จาก HTML** (`extractor/config.py:DEPOSIT_INDEX_COLUMN_MAP`) — ต้องรู้รูปแบบจริงของ `received_at`, `created_at`, `amount` ก่อน เพราะ parser ทั้งระบบขึ้นกับมัน

**Files:**
- Create: `scripts/probe-deposit-shape.mjs`

**Interfaces:**
- Produces: ข้อเท็จจริงเรื่องรูปแบบวันที่/จำนวนเงิน ที่ Task 2 ใช้เขียน `parseDmy` / `parseAmount`

- [ ] **Step 1: เขียน probe script (read-only, bounded)**

```js
// scripts/probe-deposit-shape.mjs
// ดูรูปแบบข้อมูลจริงของ deposit_header / deposit_items — READ ONLY, จำกัด 5 เอกสาร
import { MongoClient } from "mongodb"
import { readFileSync } from "node:fs"

// convention เดิมของ repo: ดึง URI จาก env หรือจากสคริปต์เดิมที่ hardcode ไว้
const src = readFileSync(new URL("./check-sku-vehicles.mjs", import.meta.url), "utf8")
const uri = process.env.MONGO_URI || src.match(/mongodb(?:\+srv)?:\/\/[^"']+/)[0]

const client = new MongoClient(uri)
await client.connect()
const atms = client.db("atms")

const headers = await atms.collection("deposit_header").find({}).limit(5).toArray()
console.log("=== deposit_header (5) ===")
for (const h of headers) console.log(JSON.stringify(h, null, 1))

const items = await atms.collection("deposit_items").find({}).limit(3).toArray()
console.log("=== deposit_items (3) ===")
for (const i of items) console.log(JSON.stringify(i, null, 1))

console.log("=== ขนาด collection ===")
console.log("deposit_header count:", await atms.collection("deposit_header").estimatedDocumentCount())
console.log("indexes:", (await atms.collection("deposit_header").indexes()).map((i) => i.name))

await client.close()
```

- [ ] **Step 2: ขออนุญาตผู้ใช้ก่อนรัน แล้วรัน**

Run: `node scripts/probe-deposit-shape.mjs`
Expected: เห็นค่าจริงของ `received_at`, `created_at` (คาดว่า `"DD/MM/YYYY"`), `amount` (คาดว่า `"1,234.56"` มี comma), `warehouse`, `supplier` และจำนวน document รวม

- [ ] **Step 3: จดผลลงหัวไฟล์ plan นี้**

เพิ่มบล็อก `<!-- PROBE RESULT: received_at="..." amount="..." count=N -->` ไว้ท้ายไฟล์ plan
**ถ้ารูปแบบไม่ตรงที่คาด (เช่น วันที่มีเวลาต่อท้าย หรือ amount เป็น number อยู่แล้ว) ให้แก้ `parseDmy`/`parseAmount` ใน Task 2 ตามของจริง**

- [ ] **Step 4: Commit**

```bash
git add scripts/probe-deposit-shape.mjs docs/superpowers/plans/2026-08-13-ap-tracking.md
git commit -m "chore: probe ATMS deposit data shape สำหรับ ap-tracking"
```

---

### Task 2: lib/ap-tracking.ts — logic ล้วน + assertion script

**Files:**
- Create: `lib/ap-tracking.ts`
- Create: `scripts/check-ap-tracking.ts`

**Interfaces:**
- Consumes: ผลรูปแบบข้อมูลจาก Task 1
- Produces (ทุก task ถัดไปเรียกใช้ชื่อเหล่านี้ตรง ๆ):
  - `AP_DOC_FIELDS: { key: ApDocKey; label: string; short: string }[]` (7 ช่อง เรียง dd, po, bill, invoice, taxInvoice, receipt, billingNote)
  - `FINANCE_DOC_KEYS: ApDocKey[]` (5 ช่องการเงิน)
  - `type ApDocKey = "dd"|"po"|"bill"|"invoice"|"taxInvoice"|"receipt"|"billingNote"`
  - `type ApDocMark = { checked: boolean; by: string; at: string }`
  - `type ApDocs = Partial<Record<ApDocKey, ApDocMark>>`
  - `type ApStatus = "รอประกบ" | "ครบชุด" | "ส่งบัญชีแล้ว"`
  - `isDocSetComplete(docs: ApDocs): boolean`
  - `apStatusOf(docs: ApDocs, sentDate: string): ApStatus`
  - `apStatusMeta(s: ApStatus): { value: ApStatus; emoji: string; cls: string; color: string }`
  - `CREDIT_TERMS: readonly ["Immediate","7D","15D","30D","60D"]`
  - `termDays(term: string): number | null`
  - `dueDateOf(receivedISO: string, term: string): string`
  - `overdueDays(dueISO: string, todayISO: string): number`
  - `nextThursday(fromISO: string): string`
  - `parseDmy(s: unknown): string`
  - `parseAmount(s: unknown): number`
  - `thaiDate(iso: string): string`

- [ ] **Step 1: เขียน assertion script ให้ fail ก่อน**

```ts
// scripts/check-ap-tracking.ts
// รัน: npx tsx scripts/check-ap-tracking.ts  (repo ไม่มี test framework — ใช้ assert แทน)
import assert from "node:assert/strict"
import {
  parseDmy, parseAmount, dueDateOf, overdueDays, nextThursday,
  isDocSetComplete, apStatusOf, termDays, AP_DOC_FIELDS, FINANCE_DOC_KEYS,
} from "../lib/ap-tracking"

const mark = { checked: true, by: "test", at: "2026-08-13T00:00:00.000Z" }

// --- parseDmy ---
assert.equal(parseDmy("13/08/2026"), "2026-08-13")
assert.equal(parseDmy("01/07/2026 14:30"), "2026-07-01", "ต้องตัดเวลาท้ายออกได้")
assert.equal(parseDmy(""), "")
assert.equal(parseDmy(null), "")
assert.equal(parseDmy("ไม่ใช่วันที่"), "")

// --- parseAmount ---
assert.equal(parseAmount("1,234.56"), 1234.56)
assert.equal(parseAmount("800"), 800)
assert.equal(parseAmount(2467.5), 2467.5)
assert.equal(parseAmount(""), 0)
assert.equal(parseAmount(null), 0)

// --- termDays / dueDateOf ---
assert.equal(termDays("30D"), 30)
assert.equal(termDays("Immediate"), 0)
assert.equal(termDays("ไม่รู้จัก"), null)
assert.equal(dueDateOf("2026-07-01", "30D"), "2026-07-31")
assert.equal(dueDateOf("2026-07-01", "Immediate"), "2026-07-01")
assert.equal(dueDateOf("2026-07-31", "60D"), "2026-09-29", "ต้องข้ามเดือนถูก")
assert.equal(dueDateOf("", "30D"), "", "ไม่มีวันรับของ = ไม่มี due")
assert.equal(dueDateOf("2026-07-01", ""), "", "ไม่มีเครดิตเทอม = ไม่มี due")

// --- overdueDays ---
assert.equal(overdueDays("2026-08-01", "2026-08-13"), 12)
assert.equal(overdueDays("2026-08-13", "2026-08-13"), 0, "ครบกำหนดวันนี้ ยังไม่เกิน")
assert.equal(overdueDays("2026-09-01", "2026-08-13"), 0)
assert.equal(overdueDays("", "2026-08-13"), 0)

// --- nextThursday (บัญชีโอนทุกวันพฤหัส) ---
assert.equal(nextThursday("2026-08-13"), "2026-08-13", "วันพฤหัสอยู่แล้ว = วันนี้")
assert.equal(nextThursday("2026-08-14"), "2026-08-20", "ศุกร์ → พฤหัสหน้า")
assert.equal(nextThursday("2026-08-10"), "2026-08-13", "จันทร์ → พฤหัสสัปดาห์นี้")

// --- โครงช่องเอกสาร ---
assert.equal(AP_DOC_FIELDS.length, 7)
assert.deepEqual(AP_DOC_FIELDS.map((f) => f.key), ["dd","po","bill","invoice","taxInvoice","receipt","billingNote"])
assert.deepEqual(FINANCE_DOC_KEYS, ["bill","invoice","taxInvoice","receipt","billingNote"])

// --- เงื่อนไขครบชุด: DD + PO + อย่างน้อย 1 ใน 5 ---
assert.equal(isDocSetComplete({}), false)
assert.equal(isDocSetComplete({ dd: mark, po: mark }), false, "มีแค่ DD+PO ยังไม่ครบ")
assert.equal(isDocSetComplete({ dd: mark, bill: mark }), false, "ขาด PO")
assert.equal(isDocSetComplete({ po: mark, bill: mark }), false, "ขาด DD")
assert.equal(isDocSetComplete({ dd: mark, po: mark, bill: mark }), true)
assert.equal(isDocSetComplete({ dd: mark, po: mark, receipt: mark }), true, "ใบเสร็จอย่างเดียวก็ครบ")
assert.equal(
  isDocSetComplete({ dd: mark, po: mark, bill: { ...mark, checked: false } }),
  false,
  "checked=false ไม่นับ",
)

// --- สถานะ ---
assert.equal(apStatusOf({}, ""), "รอประกบ")
assert.equal(apStatusOf({ dd: mark, po: mark, bill: mark }, ""), "ครบชุด")
assert.equal(apStatusOf({ dd: mark, po: mark, bill: mark }, "2026-08-13"), "ส่งบัญชีแล้ว")
assert.equal(apStatusOf({}, "2026-08-13"), "ส่งบัญชีแล้ว", "ลงวันที่ส่งแล้วถือว่าจบ แม้ติ๊กไม่ครบ")

console.log("✅ ap-tracking logic ผ่านทั้งหมด")
```

- [ ] **Step 2: รันให้เห็นว่า fail**

Run: `npx tsx scripts/check-ap-tracking.ts`
Expected: FAIL — `Cannot find module '../lib/ap-tracking'`

- [ ] **Step 3: เขียน lib/ap-tracking.ts ให้ผ่าน**

```ts
// lib/ap-tracking.ts
// ติดตามเจ้าหนี้ — logic ล้วน (ไม่แตะ DB/React) ทดสอบด้วย scripts/check-ap-tracking.ts
//
// กติกาหลัก: 1 แถว = 1 ใบ DD ต้อง "ประกบชุดเอกสาร" ให้ครบก่อนส่งบัญชี
//   ครบชุด = ✓DD + ✓PO + อย่างน้อย 1 ใน 5 เอกสารการเงิน

export type ApDocKey = "dd" | "po" | "bill" | "invoice" | "taxInvoice" | "receipt" | "billingNote"
export type ApDocMark = { checked: boolean; by: string; at: string }
export type ApDocs = Partial<Record<ApDocKey, ApDocMark>>
export type ApSentType = "" | "นอกรอบ" | "ตามรอบ"
export type ApStatus = "รอประกบ" | "ครบชุด" | "ส่งบัญชีแล้ว"

export const AP_DOC_FIELDS: { key: ApDocKey; label: string; short: string }[] = [
  { key: "dd",          label: "DD (ใบรับของ)",        short: "DD" },
  { key: "po",          label: "PO (ใบสั่งซื้อ)",       short: "PO" },
  { key: "bill",        label: "บิล/ใบส่งของ",          short: "บิล" },
  { key: "invoice",     label: "ใบแจ้งหนี้",            short: "แจ้งหนี้" },
  { key: "taxInvoice",  label: "ต้นฉบับใบกำกับภาษี",   short: "ใบกำกับ" },
  { key: "receipt",     label: "ใบเสร็จรับเงิน",        short: "ใบเสร็จ" },
  { key: "billingNote", label: "ใบวางบิล",              short: "วางบิล" },
]

// 5 ช่องการเงิน — ต้องมีอย่างน้อย 1 ช่องถึงจะครบชุด
export const FINANCE_DOC_KEYS: ApDocKey[] = ["bill", "invoice", "taxInvoice", "receipt", "billingNote"]

const isOn = (m?: ApDocMark) => Boolean(m?.checked)

export function isDocSetComplete(docs: ApDocs): boolean {
  if (!isOn(docs.dd) || !isOn(docs.po)) return false
  return FINANCE_DOC_KEYS.some((k) => isOn(docs[k]))
}

export function apStatusOf(docs: ApDocs, sentDate: string): ApStatus {
  if (sentDate) return "ส่งบัญชีแล้ว"
  return isDocSetComplete(docs) ? "ครบชุด" : "รอประกบ"
}

const AP_STATUS_META: Record<ApStatus, { value: ApStatus; emoji: string; cls: string; color: string }> = {
  "รอประกบ":       { value: "รอประกบ",       emoji: "🔴", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",       color: "#f43f5e" },
  "ครบชุด":        { value: "ครบชุด",        emoji: "🟡", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",    color: "#f59e0b" },
  "ส่งบัญชีแล้ว":  { value: "ส่งบัญชีแล้ว",  emoji: "✅", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",     color: "#22c55e" },
}
export const AP_STATUSES: ApStatus[] = ["รอประกบ", "ครบชุด", "ส่งบัญชีแล้ว"]
export function apStatusMeta(s: ApStatus) {
  return AP_STATUS_META[s] ?? AP_STATUS_META["รอประกบ"]
}

export const CREDIT_TERMS = ["Immediate", "7D", "15D", "30D", "60D"] as const
const TERM_DAYS: Record<string, number> = { Immediate: 0, "7D": 7, "15D": 15, "30D": 30, "60D": 60 }

export function termDays(term: string): number | null {
  const d = TERM_DAYS[String(term ?? "").trim()]
  return d === undefined ? null : d
}

// "DD/MM/YYYY" (อาจมีเวลาต่อท้าย) → "YYYY-MM-DD" · ค่าอื่น → ""
export function parseDmy(s: unknown): string {
  const t = String(s ?? "").trim().split(" ")[0]
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
  if (!m) return ""
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
}

// "1,234.56" หรือ number → number · ค่าที่แปลงไม่ได้ → 0
export function parseAmount(s: unknown): number {
  if (typeof s === "number") return Number.isFinite(s) ? s : 0
  const n = Number(String(s ?? "").replace(/,/g, "").trim())
  return Number.isFinite(n) ? n : 0
}

// คำนวณด้วย UTC เสมอ กัน timezone เลื่อนวัน
const toUTC = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN
}
const fromUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const DAY = 86_400_000

export function dueDateOf(receivedISO: string, term: string): string {
  const days = termDays(term)
  const base = toUTC(receivedISO)
  if (days === null || Number.isNaN(base)) return ""
  return fromUTC(base + days * DAY)
}

export function overdueDays(dueISO: string, todayISO: string): number {
  const due = toUTC(dueISO), today = toUTC(todayISO)
  if (Number.isNaN(due) || Number.isNaN(today) || today <= due) return 0
  return Math.round((today - due) / DAY)
}

// บัญชีโอน "นอกรอบ" ทุกวันพฤหัส — คืนวันพฤหัสที่ใกล้ที่สุดที่ >= วันที่ให้มา
export function nextThursday(fromISO: string): string {
  const base = toUTC(fromISO)
  if (Number.isNaN(base)) return ""
  const dow = new Date(base).getUTCDay()      // 0=อา, 4=พฤ
  return fromUTC(base + ((4 - dow + 7) % 7) * DAY)
}

const TH_MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."]
export function thaiDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "")
  if (!m) return "—"
  return `${+m[3]} ${TH_MONTHS[+m[2] - 1]} ${(+m[1] + 543) % 100}`
}
```

- [ ] **Step 4: รันให้ผ่าน + lint**

Run: `npx tsx scripts/check-ap-tracking.ts && npm run lint`
Expected: `✅ ap-tracking logic ผ่านทั้งหมด` และ lint ไม่มี error ใหม่

- [ ] **Step 5: Commit**

```bash
git add lib/ap-tracking.ts scripts/check-ap-tracking.ts
git commit -m "feat(ap-tracking): logic ประกบชุดเอกสาร + credit term + วันพฤหัส"
```

---

### Task 3: master เครดิตเทอมซัพพลายเออร์ (`ap_supplier`) + seed จาก Excel

**Files:**
- Create: `app/api/ap-suppliers/route.ts`
- Create: `scripts/seed-ap-suppliers.mjs`

**Interfaces:**
- Consumes: `CREDIT_TERMS` จาก `lib/ap-tracking`
- Produces:
  - `GET /api/ap-suppliers` → `{ name: string; creditTerm: string }[]` (เรียงตาม name)
  - `PUT /api/ap-suppliers` body `{ name: string; creditTerm: string }` → `{ ok: true }`
  - collection `master_data.ap_supplier` `{ name, creditTerm, updatedBy, updatedAt }`

- [ ] **Step 1: เขียน API**

```ts
// app/api/ap-suppliers/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { CREDIT_TERMS } from "@/lib/ap-tracking"

export const dynamic = "force-dynamic"

const DB = process.env.MONGO_DB ?? "master_data"
const COLL = "ap_supplier"

// GET /api/ap-suppliers — เครดิตเทอมของซัพพลายเออร์ทั้งหมด
export async function GET() {
  const client = await clientPromise
  const items = await client.db(DB).collection(COLL)
    .find({}, { projection: { _id: 0, name: 1, creditTerm: 1, updatedBy: 1, updatedAt: 1 } })
    .sort({ name: 1 })
    .toArray()
  return NextResponse.json(items)
}

// PUT /api/ap-suppliers — ตั้ง/แก้เครดิตเทอมของซัพพลายเออร์หนึ่งราย
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const name = String(body?.name ?? "").trim()
  const creditTerm = String(body?.creditTerm ?? "").trim()
  if (!name) return NextResponse.json({ error: "ต้องระบุชื่อซัพพลายเออร์" }, { status: 400 })
  if (creditTerm && !(CREDIT_TERMS as readonly string[]).includes(creditTerm)) {
    return NextResponse.json({ error: `creditTerm ต้องเป็นหนึ่งใน ${CREDIT_TERMS.join(", ")}` }, { status: 400 })
  }

  const session = await getServerSession(authOptions)
  const by = session?.user?.name || session?.user?.email || ""

  const client = await clientPromise
  await client.db(DB).collection(COLL).updateOne(
    { name },
    { $set: { name, creditTerm, updatedBy: by, updatedAt: new Date().toISOString() } },
    { upsert: true },
  )
  return NextResponse.json({ ok: true, name, creditTerm })
}
```

- [ ] **Step 2: เขียน seed script จาก Excel เจ้าหนี้ กค. 2026**

```js
// scripts/seed-ap-suppliers.mjs
// seed เครดิตเทอมจากไฟล์ Excel เจ้าหนี้ (คอลัมน์ E=ซัพพลายเออร์, F=เครดิต) — idempotent
// รัน: node scripts/seed-ap-suppliers.mjs [path/to/file.xlsx] [--dry]
import { MongoClient } from "mongodb"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import XLSX from "xlsx"

const DRY = process.argv.includes("--dry")
const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"))
const FILE = fileArg || path.join(homedir(), "Documents/project/debt/เจ้าหนี้เดือน กค. 2026.xlsx")
const VALID = new Set(["Immediate", "7D", "15D", "30D", "60D"])

const wb = XLSX.readFile(FILE)
const counts = new Map()   // supplier -> Map(term -> n)
for (const sheet of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" })
  for (const r of rows.slice(1)) {
    const name = String(r[4] ?? "").trim()          // E = ซัพพลายเออร์
    const term = String(r[5] ?? "").trim()          // F = เครดิต
    if (!name || !VALID.has(term)) continue
    if (!counts.has(name)) counts.set(name, new Map())
    const m = counts.get(name)
    m.set(term, (m.get(term) ?? 0) + 1)
  }
}

const docs = []
const conflicts = []
for (const [name, terms] of counts) {
  const sorted = [...terms.entries()].sort((a, b) => b[1] - a[1])
  docs.push({ name, creditTerm: sorted[0][0] })
  if (sorted.length > 1) conflicts.push({ name, terms: Object.fromEntries(sorted) })
}

console.log(`ซัพพลายเออร์ที่พบ: ${docs.length} ราย`)
if (conflicts.length) {
  console.log(`⚠️ มีเครดิตเทอมไม่ตรงกัน ${conflicts.length} ราย (ใช้ค่าที่พบบ่อยสุด):`)
  for (const c of conflicts.slice(0, 20)) console.log("  ", c.name, JSON.stringify(c.terms))
}
if (DRY) { console.log("(--dry ไม่เขียน DB)"); process.exit(0) }

const src = readFileSync(new URL("./check-sku-vehicles.mjs", import.meta.url), "utf8")
const uri = process.env.MONGO_URI || src.match(/mongodb(?:\+srv)?:\/\/[^"']+/)[0]
const client = new MongoClient(uri)
await client.connect()
const col = client.db("master_data").collection("ap_supplier")
await col.createIndex({ name: 1 }, { unique: true })
const res = await col.bulkWrite(
  docs.map((d) => ({
    updateOne: {
      filter: { name: d.name },
      update: { $set: { ...d, updatedBy: "seed", updatedAt: new Date().toISOString() } },
      upsert: true,
    },
  })),
  { ordered: false },
)
console.log(`upsert แล้ว: เพิ่มใหม่ ${res.upsertedCount} · แก้ ${res.modifiedCount}`)
await client.close()
```

- [ ] **Step 3: รันแบบ --dry ก่อน (ไม่แตะ DB)**

Run: `node scripts/seed-ap-suppliers.mjs --dry`
Expected: เห็นจำนวนซัพพลายเออร์ (คาดว่า ~200-400 ราย) + รายการ conflict ถ้ามี · ไม่มี error

- [ ] **Step 4: ขออนุญาตผู้ใช้ แล้วรันจริง**

Run: `node scripts/seed-ap-suppliers.mjs`
Expected: `upsert แล้ว: เพิ่มใหม่ N · แก้ 0`

- [ ] **Step 5: ตรวจ API ด้วย dev server**

Run: `npm run dev` แล้วเปิดอีกเทอร์มินัล `curl -s localhost:3000/api/ap-suppliers | head -c 400`
Expected: JSON array มี `{"name":"...","creditTerm":"30D"}` (ถ้าโดน redirect login = ปกติ ให้ทดสอบผ่านหน้าเว็บใน Task 9 แทน)

- [ ] **Step 6: Commit**

```bash
git add app/api/ap-suppliers/route.ts scripts/seed-ap-suppliers.mjs
git commit -m "feat(ap-tracking): master เครดิตเทอมซัพพลายเออร์ + seed จาก Excel"
```

---

### Task 4: GET /api/ap-tracking — รวมแถว DD + overlay + summary

**Files:**
- Create: `app/api/ap-tracking/route.ts`

**Interfaces:**
- Consumes: `parseDmy`, `parseAmount`, `dueDateOf`, `overdueDays`, `apStatusOf`, `nextThursday`, `ApDocs`, `ApStatus` จาก `lib/ap-tracking`
- Produces (UI ใน Task 6-7 ใช้รูปนี้ตรง ๆ):

```ts
type ApRow = {
  depositCode: string; depositId: number | null; warehouse: string
  purchaseOrder: string; supplier: string; supplierRefNo: string
  amount: number; receivedAt: string; createdAt: string        // ISO YYYY-MM-DD
  creditTerm: string; dueDate: string; overdue: number
  docs: ApDocs; sentType: string; sentDate: string; note: string
  status: ApStatus; carryover: boolean
  poTotal: number; poDue: string; poStatus: string
}
type ApListResponse = {
  rows: ApRow[]
  summary: {
    total: number
    byStatus: Record<ApStatus, { n: number; amount: number }>
    overdue: { n: number; amount: number }
    thisThursday: { date: string; n: number; amount: number }
    unsentAging: { notDue: { n: number; amount: number }; due7: { n: number; amount: number }; overdue: { n: number; amount: number } }
    dataAsOf: string           // วันที่ล่าสุดที่ scraper ดึงมา (max created_at)
  }
}
```

- [ ] **Step 1: เขียน API**

```ts
// app/api/ap-tracking/route.ts
import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import {
  parseDmy, parseAmount, dueDateOf, overdueDays, apStatusOf, nextThursday,
  type ApDocs, type ApStatus,
} from "@/lib/ap-tracking"

export const dynamic = "force-dynamic"

const MD = process.env.MONGO_DB ?? "master_data"
type Doc = Record<string, unknown>
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

// regex จับ received_at รูป "DD/MM/YYYY" ของเดือนที่ต้องการ (ฟิลด์เป็น string ใน ATMS)
const monthRe = (ym: string) => {
  const [y, m] = ym.split("-")
  return new RegExp(`^\\d{1,2}/${m}/${y}$`)
}
const prevMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (i + 1), 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
  })
}

// GET /api/ap-tracking?month=YYYY-MM&carryover=1&warehouse=&supplier=&status=&q=&limit=
export async function GET(req: NextRequest) {
  try {
    const sp        = req.nextUrl.searchParams
    const today     = new Date().toISOString().slice(0, 10)
    const month     = sp.get("month")?.trim() || today.slice(0, 7)
    const carryover = sp.get("carryover") !== "0"
    const warehouse = sp.get("warehouse")?.trim() ?? ""
    const supplier  = sp.get("supplier")?.trim()  ?? ""
    const status    = sp.get("status")?.trim()    ?? ""
    const q         = sp.get("q")?.trim()         ?? ""
    const limit     = Math.min(parseInt(sp.get("limit") ?? "4000"), 8000)

    const client = await clientPromise
    const atms   = client.db("atms")
    const md     = client.db(MD)

    // 1) แถว DD ของเดือนที่เลือก (+ ย้อนหลัง 3 เดือนสำหรับใบค้าง) — bounded เสมอ
    const months  = carryover ? [month, ...prevMonths(month, 3)] : [month]
    const match: Record<string, unknown> = { $or: months.map((m) => ({ received_at: { $regex: monthRe(m) } })) }
    if (warehouse) match.warehouse = warehouse
    if (supplier)  match.supplier  = supplier

    const heads = await atms.collection("deposit_header")
      .find(match, { projection: {
        _id: 0, deposit_id: 1, deposit_code: 1, warehouse: 1, purchase_order: 1,
        supplier: 1, supplier_ref_no: 1, amount: 1, created_at: 1, received_at: 1,
      } })
      .limit(limit)
      .toArray() as Doc[]

    const codes    = heads.map((h) => s(h.deposit_code)).filter(Boolean)
    const poCodes  = [...new Set(heads.map((h) => s(h.purchase_order)).filter(Boolean))]
    const supNames = [...new Set(heads.map((h) => s(h.supplier)).filter(Boolean))]

    // 2) overlay: tracking + เครดิตเทอม + ข้อมูล PO (ทุกอันจำกัดด้วย $in จากชุดข้างบน)
    const [tracks, sups, pos] = await Promise.all([
      codes.length ? md.collection("ap_tracking").find({ depositCode: { $in: codes } }, { projection: { _id: 0, log: 0 } }).toArray() as Promise<Doc[]> : [],
      supNames.length ? md.collection("ap_supplier").find({ name: { $in: supNames } }, { projection: { _id: 0, name: 1, creditTerm: 1 } }).toArray() as Promise<Doc[]> : [],
      poCodes.length ? atms.collection("purchase_orders").find({ "รหัส": { $in: poCodes } }, { projection: { _id: 0, "รหัส": 1, "รวม": 1, "กำหนดส่งสินค้า": 1, "สถานะการรับสินค้า": 1 } }).toArray() as Promise<Doc[]> : [],
    ])
    const trackBy = new Map(tracks.map((t) => [s(t.depositCode), t]))
    const termBy  = new Map(sups.map((x) => [s(x.name), s(x.creditTerm)]))
    const poBy    = new Map(pos.map((p) => [s(p["รหัส"]), p]))

    // 3) ประกอบแถว + คำนวณสถานะ
    const monthPrefix = month
    let rows = heads.map((h) => {
      const code       = s(h.deposit_code)
      const t          = trackBy.get(code)
      const docs       = (t?.docs ?? {}) as ApDocs
      const sentDate   = s(t?.sentDate)
      const receivedAt = parseDmy(h.received_at)
      const creditTerm = termBy.get(s(h.supplier)) ?? ""
      const dueDate    = dueDateOf(receivedAt, creditTerm)
      const po         = poBy.get(s(h.purchase_order))
      return {
        depositCode: code,
        depositId:   typeof h.deposit_id === "number" ? h.deposit_id : null,
        warehouse:   s(h.warehouse),
        purchaseOrder: s(h.purchase_order),
        supplier:    s(h.supplier),
        supplierRefNo: s(h.supplier_ref_no),
        amount:      parseAmount(h.amount),
        receivedAt,
        createdAt:   parseDmy(h.created_at),
        creditTerm, dueDate,
        overdue:     sentDate ? 0 : overdueDays(dueDate, today),
        docs,
        sentType:    s(t?.sentType),
        sentDate,
        note:        s(t?.note),
        status:      apStatusOf(docs, sentDate),
        carryover:   receivedAt.slice(0, 7) !== monthPrefix,
        poTotal:     parseAmount(po?.["รวม"]),
        poDue:       parseDmy(po?.["กำหนดส่งสินค้า"]),
        poStatus:    s(po?.["สถานะการรับสินค้า"]),
      }
    })

    // ใบเดือนก่อนแสดงเฉพาะที่ยังไม่ส่งบัญชี (ค้างยกมา) — ที่จบแล้วไม่ต้องรก
    rows = rows.filter((r) => !r.carryover || r.status !== "ส่งบัญชีแล้ว")

    if (status) rows = rows.filter((r) => r.status === status)
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      rows = rows.filter((r) => rx.test(r.depositCode) || rx.test(r.purchaseOrder) || rx.test(r.supplier) || rx.test(r.supplierRefNo))
    }
    rows.sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || "") || b.depositCode.localeCompare(a.depositCode))

    // 4) summary
    const blank = () => ({ n: 0, amount: 0 })
    const byStatus: Record<string, { n: number; amount: number }> = {
      "รอประกบ": blank(), "ครบชุด": blank(), "ส่งบัญชีแล้ว": blank(),
    }
    const overdue = blank(), unsentAging = { notDue: blank(), due7: blank(), overdue: blank() }
    const thu = nextThursday(today)
    const thisThursday = { date: thu, n: 0, amount: 0 }
    for (const r of rows) {
      const b = byStatus[r.status]; b.n++; b.amount += r.amount
      if (r.status !== "ส่งบัญชีแล้ว") {
        if (r.overdue > 0) { overdue.n++; overdue.amount += r.amount; unsentAging.overdue.n++; unsentAging.overdue.amount += r.amount }
        else if (r.dueDate && overdueDays(r.dueDate, addDays(today, 7)) > 0) { unsentAging.due7.n++; unsentAging.due7.amount += r.amount }
        else { unsentAging.notDue.n++; unsentAging.notDue.amount += r.amount }
      }
      if (r.sentType === "นอกรอบ" && r.sentDate === thu) { thisThursday.n++; thisThursday.amount += r.amount }
    }

    const dataAsOf = rows.reduce((mx, r) => (r.createdAt > mx ? r.createdAt : mx), "")
    return NextResponse.json({
      rows,
      summary: { total: rows.length, byStatus: byStatus as Record<ApStatus, { n: number; amount: number }>, overdue, thisThursday, unsentAging, dataAsOf },
    })
  } catch (e) {
    console.error("[ap-tracking] GET failed", e)
    return NextResponse.json({ error: "โหลดข้อมูลไม่สำเร็จ" }, { status: 500 })
  }
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
```

- [ ] **Step 2: ตรวจ type + lint**

Run: `npm run lint && npx tsc --noEmit -p tsconfig.json`
Expected: ไม่มี error ในไฟล์ใหม่ (ถ้า tsc ช้าเกินไป ใช้ `npm run build` แทนใน Task 10)

- [ ] **Step 3: ทดสอบกับข้อมูลจริงผ่านเบราว์เซอร์**

Run: `npm run dev` แล้วล็อกอิน เปิด `http://localhost:3000/api/ap-tracking?month=2026-07&limit=200`
Expected: JSON มี `rows[]` และ `summary` · ตรวจ 3 อย่าง: (ก) `amount` เป็นตัวเลข ไม่ใช่ 0 หมด (ข) `receivedAt` เป็น `YYYY-MM-DD` (ค) `creditTerm` มีค่าในแถวที่ supplier อยู่ใน master

- [ ] **Step 4: Commit**

```bash
git add app/api/ap-tracking/route.ts
git commit -m "feat(ap-tracking): API รวมใบ DD + overlay tracking + summary"
```

---

### Task 5: GET/PATCH /api/ap-tracking/[code] — รายละเอียด + บันทึกการติ๊ก

**Files:**
- Create: `app/api/ap-tracking/[code]/route.ts`

**Interfaces:**
- Consumes: `AP_DOC_FIELDS`, `ApDocKey`, `apStatusOf` จาก `lib/ap-tracking`
- Produces:
  - `PATCH /api/ap-tracking/<depositCode>` body `{ docs?: Partial<Record<ApDocKey, boolean>>; sentType?: string; sentDate?: string; note?: string }` → `{ ok: true; docs: ApDocs; sentType: string; sentDate: string; note: string; status: ApStatus }`
  - `GET /api/ap-tracking/<depositCode>` → `{ tracking: {...} | null; items: DepositItem[]; po: Doc | null }`
  - `type DepositItem = { parts_group: string; item: string; serial_no: string; qty: string; unit_price: string; total: string; remark: string }`

- [ ] **Step 1: เขียน route**

```ts
// app/api/ap-tracking/[code]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { AP_DOC_FIELDS, apStatusOf, type ApDocKey, type ApDocs } from "@/lib/ap-tracking"

export const dynamic = "force-dynamic"

const MD = process.env.MONGO_DB ?? "master_data"
const COLL = "ap_tracking"
const DOC_KEYS = new Set<string>(AP_DOC_FIELDS.map((f) => f.key))
const SENT_TYPES = new Set(["", "นอกรอบ", "ตามรอบ"])
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

// GET — รายละเอียดใบ DD: รายการสินค้า + PO + tracking (พร้อม log)
export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params            // Next 16: params เป็น Promise
  const depositCode = decodeURIComponent(code).trim()
  if (!depositCode) return NextResponse.json({ error: "ไม่พบเลขที่ใบรับของ" }, { status: 400 })

  const client = await clientPromise
  const atms = client.db("atms"), md = client.db(MD)

  const head = await atms.collection("deposit_header").findOne(
    { deposit_code: depositCode },
    { projection: { _id: 0, deposit_id: 1, purchase_order: 1 } },
  )
  const [tracking, items, po] = await Promise.all([
    md.collection(COLL).findOne({ depositCode }, { projection: { _id: 0 } }),
    head?.deposit_id != null
      ? atms.collection("deposit_items").find({ deposit_id: head.deposit_id }, { projection: { _id: 0 } }).limit(300).toArray()
      : [],
    head?.purchase_order
      ? atms.collection("purchase_orders").findOne({ "รหัส": s(head.purchase_order) }, { projection: { _id: 0 } })
      : null,
  ])
  return NextResponse.json({ tracking: tracking ?? null, items, po })
}

// PATCH — บันทึกการติ๊ก/วันที่ส่งบัญชี/หมายเหตุ (สร้าง doc ครั้งแรกแบบ lazy) + ลง log ทุกครั้ง
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params
  const depositCode = decodeURIComponent(code).trim()
  if (!depositCode) return NextResponse.json({ error: "ไม่พบเลขที่ใบรับของ" }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const session = await getServerSession(authOptions)
  const by = session?.user?.name || session?.user?.email || ""
  const byEmail = session?.user?.email || ""
  const at = new Date().toISOString()

  const client = await clientPromise
  const col = client.db(MD).collection(COLL)
  const current = await col.findOne({ depositCode })
  const docs: ApDocs = { ...((current?.docs ?? {}) as ApDocs) }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set: Record<string, any> = { depositCode, updatedAt: at, updatedBy: by }
  const log: Record<string, string>[] = []

  if (body?.docs && typeof body.docs === "object") {
    for (const [k, v] of Object.entries(body.docs as Record<string, unknown>)) {
      if (!DOC_KEYS.has(k)) return NextResponse.json({ error: `ช่องเอกสารไม่ถูกต้อง: ${k}` }, { status: 400 })
      const checked = Boolean(v)
      docs[k as ApDocKey] = { checked, by, at }
      log.push({ action: checked ? "ติ๊ก" : "ยกเลิกติ๊ก", field: k, by, byEmail, at })
    }
    set.docs = docs
  }

  if (body?.sentType !== undefined || body?.sentDate !== undefined) {
    const sentType = s(body?.sentType ?? current?.sentType)
    const sentDate = s(body?.sentDate ?? current?.sentDate)
    if (!SENT_TYPES.has(sentType)) return NextResponse.json({ error: "sentType ต้องเป็น นอกรอบ หรือ ตามรอบ" }, { status: 400 })
    if (sentDate && !/^\d{4}-\d{2}-\d{2}$/.test(sentDate)) return NextResponse.json({ error: "sentDate ต้องเป็น YYYY-MM-DD" }, { status: 400 })
    if (sentDate && !sentType) return NextResponse.json({ error: "ต้องเลือกว่าเป็น นอกรอบ หรือ ตามรอบ" }, { status: 400 })
    set.sentType = sentDate ? sentType : ""
    set.sentDate = sentDate
    log.push({ action: sentDate ? `ส่งบัญชี (${sentType})` : "ยกเลิกส่งบัญชี", field: "sent", detail: sentDate, by, byEmail, at })
  }

  if (body?.note !== undefined) {
    set.note = s(body.note).slice(0, 500)
    log.push({ action: "แก้หมายเหตุ", field: "note", detail: set.note, by, byEmail, at })
  }

  if (!log.length) return NextResponse.json({ error: "ไม่มีข้อมูลให้บันทึก" }, { status: 400 })

  await col.updateOne(
    { depositCode },
    { $set: set, $push: { log: { $each: log } }, $setOnInsert: { createdAt: at, createdBy: by } },
    { upsert: true },
  )

  const sentDate = set.sentDate !== undefined ? set.sentDate : s(current?.sentDate)
  return NextResponse.json({
    ok: true,
    docs: set.docs ?? docs,
    sentType: set.sentType !== undefined ? set.sentType : s(current?.sentType),
    sentDate,
    note: set.note !== undefined ? set.note : s(current?.note),
    status: apStatusOf(set.docs ?? docs, sentDate),
  })
}
```

- [ ] **Step 2: สร้าง unique index ของ ap_tracking (collection ใหม่ ของเราเอง ไม่ใช่ atms)**

Run: `node -e "const {MongoClient}=require('mongodb');const fs=require('fs');const uri=process.env.MONGO_URI||fs.readFileSync('scripts/check-sku-vehicles.mjs','utf8').match(/mongodb(?:\+srv)?:\/\/[^\"']+/)[0];(async()=>{const c=new MongoClient(uri);await c.connect();console.log(await c.db('master_data').collection('ap_tracking').createIndex({depositCode:1},{unique:true}));await c.close()})()"`
Expected: `depositCode_1`

- [ ] **Step 3: ทดสอบ PATCH จากเบราว์เซอร์ (มี session)**

เปิด devtools console ที่หน้าเว็บที่ล็อกอินแล้ว รัน (เปลี่ยน `<CODE>` เป็น deposit_code จริงจาก Task 4):

```js
await (await fetch("/api/ap-tracking/<CODE>", {
  method: "PATCH", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ docs: { dd: true, po: true, bill: true } }),
})).json()
```

Expected: `{ok:true, status:"ครบชุด", docs:{dd:{checked:true,...},...}}` · เรียก `GET /api/ap-tracking/<CODE>` ต่อ ต้องเห็น `tracking.log` 3 รายการ

- [ ] **Step 4: ทดสอบ validation ว่าปฏิเสธค่าผิด**

```js
await (await fetch("/api/ap-tracking/<CODE>", { method:"PATCH", headers:{"Content-Type":"application/json"},
  body: JSON.stringify({ docs: { hacker: true } }) })).json()
await (await fetch("/api/ap-tracking/<CODE>", { method:"PATCH", headers:{"Content-Type":"application/json"},
  body: JSON.stringify({ sentType: "มั่ว", sentDate: "2026-08-13" }) })).json()
```

Expected: ทั้งสองคืน error 400 (`ช่องเอกสารไม่ถูกต้อง: hacker` / `sentType ต้องเป็น นอกรอบ หรือ ตามรอบ`)

- [ ] **Step 5: Commit**

```bash
git add app/api/ap-tracking/[code]/route.ts
git commit -m "feat(ap-tracking): API รายละเอียด + บันทึกติ๊กเอกสารพร้อม log"
```

---

### Task 6: หน้าหลัก — ตารางติ๊ก inline + เมนู sidebar

**Files:**
- Create: `app/ap-tracking/page.tsx`
- Create: `components/ap-tracking-page.tsx`
- Modify: `components/sidebar.tsx` (กลุ่ม "จัดการติดตามสินค้า" ~บรรทัด 84-92 และบรรทัด import icon)

**Interfaces:**
- Consumes: `GET /api/ap-tracking`, `PATCH /api/ap-tracking/[code]`, ทุก export จาก `lib/ap-tracking`
- Produces: `<ApTrackingPage />` (default export ของ `components/ap-tracking-page.tsx` เป็น named export `ApTrackingPage` ตาม convention repo)

- [ ] **Step 1: route wrapper**

```tsx
// app/ap-tracking/page.tsx
import { ApTrackingPage } from "@/components/ap-tracking-page"

export default function Page() {
  return <ApTrackingPage />
}
```

- [ ] **Step 2: เขียน component หลัก (ตาราง + ติ๊ก inline แบบ optimistic)**

```tsx
// components/ap-tracking-page.tsx
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Banknote, RefreshCw, Search } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import {
  AP_DOC_FIELDS, AP_STATUSES, apStatusMeta, thaiDate, nextThursday,
  type ApDocKey, type ApDocs, type ApStatus,
} from "@/lib/ap-tracking"

const mitr = { fontFamily: "var(--font-mitr), sans-serif" }

export type ApRow = {
  depositCode: string; depositId: number | null; warehouse: string
  purchaseOrder: string; supplier: string; supplierRefNo: string
  amount: number; receivedAt: string; createdAt: string
  creditTerm: string; dueDate: string; overdue: number
  docs: ApDocs; sentType: string; sentDate: string; note: string
  status: ApStatus; carryover: boolean
  poTotal: number; poDue: string; poStatus: string
}
type Summary = {
  total: number
  byStatus: Record<ApStatus, { n: number; amount: number }>
  overdue: { n: number; amount: number }
  thisThursday: { date: string; n: number; amount: number }
  unsentAging: { notDue: { n: number; amount: number }; due7: { n: number; amount: number }; overdue: { n: number; amount: number } }
  dataAsOf: string
}

const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const thisMonth = () => new Date().toISOString().slice(0, 7)

export function ApTrackingPage() {
  const [rows, setRows]       = useState<ApRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [month, setMonth]     = useState(thisMonth())
  const [warehouse, setWarehouse] = useState("")
  const [fStatus, setFStatus] = useState<ApStatus | "">("")
  const [q, setQ]             = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/ap-tracking?month=${month}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "โหลดข้อมูลไม่สำเร็จ")
      setRows(data.rows); setSummary(data.summary)
    } catch (e) {
      swalError("โหลดข้อมูลไม่สำเร็จ", e instanceof Error ? e.message : "")
    } finally { setLoading(false) }
  }, [month])

  useEffect(() => { load() }, [load])

  // ติ๊ก/ยกเลิกติ๊กในตาราง — อัปเดตจอทันที แล้วค่อยยิง API (ผิดพลาดค่อยย้อนคืน)
  const toggleDoc = async (row: ApRow, key: ApDocKey) => {
    const next = !row.docs[key]?.checked
    const prev = rows
    setRows((rs) => rs.map((r) => r.depositCode === row.depositCode
      ? { ...r, docs: { ...r.docs, [key]: { checked: next, by: "", at: "" } } } : r))
    try {
      const res  = await fetch(`/api/ap-tracking/${encodeURIComponent(row.depositCode)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docs: { [key]: next } }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "บันทึกไม่สำเร็จ")
      setRows((rs) => rs.map((r) => r.depositCode === row.depositCode
        ? { ...r, docs: data.docs, status: data.status } : r))
    } catch (e) {
      setRows(prev)
      swalError("บันทึกไม่สำเร็จ", e instanceof Error ? e.message : "")
    }
  }

  const shown = useMemo(() => {
    let out = rows
    if (fStatus)   out = out.filter((r) => r.status === fStatus)
    if (warehouse) out = out.filter((r) => r.warehouse === warehouse)
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      out = out.filter((r) => rx.test(r.depositCode) || rx.test(r.purchaseOrder) || rx.test(r.supplier))
    }
    return out
  }, [rows, fStatus, warehouse, q])

  const warehouses = useMemo(
    () => [...new Set(rows.map((r) => r.warehouse).filter(Boolean))].sort(),
    [rows],
  )

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Banknote className="w-6 h-6 text-emerald-600" />
        <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={mitr}>ติดตามเจ้าหนี้</h1>
        {summary?.dataAsOf && (
          <span className="text-xs text-gray-500 dark:text-gray-400">ข้อมูล ATMS ล่าสุด {thaiDate(summary.dataAsOf)}</span>
        )}
        <button onClick={load} className="ml-auto inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-white/5">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> รีเฟรช
        </button>
      </div>

      {/* ตัวกรอง */}
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm bg-white dark:bg-white/5" />
        <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm bg-white dark:bg-white/5">
          <option value="">ทุกคลัง</option>
          {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา DD / PO / ซัพพลายเออร์"
            className="rounded-lg border pl-8 pr-3 py-1.5 text-sm w-64 bg-white dark:bg-white/5" />
        </div>
        {fStatus && (
          <button onClick={() => setFStatus("")} className="text-xs text-blue-600 hover:underline">ล้างตัวกรองสถานะ</button>
        )}
        <span className="ml-auto text-sm text-gray-500">{shown.length} ใบ · {baht(shown.reduce((s, r) => s + r.amount, 0))} บาท</span>
      </div>

      {/* ตาราง */}
      <div className="overflow-x-auto rounded-xl border dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-white/5 text-xs text-gray-600 dark:text-gray-300">
            <tr>
              <th className="px-3 py-2 text-left">DD · วันรับ</th>
              <th className="px-3 py-2 text-left">PO</th>
              <th className="px-3 py-2 text-left">ซัพพลายเออร์</th>
              <th className="px-3 py-2 text-right">ยอดเงิน</th>
              <th className="px-3 py-2 text-left">ครบกำหนด</th>
              {AP_DOC_FIELDS.map((f) => (
                <th key={f.key} className="px-2 py-2 text-center whitespace-nowrap" title={f.label}>{f.short}</th>
              ))}
              <th className="px-3 py-2 text-left">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const meta = apStatusMeta(r.status)
              return (
                <tr key={r.depositCode}
                  className={`border-t dark:border-white/10 ${r.overdue > 0 ? "bg-rose-50/60 dark:bg-rose-950/20" : ""}`}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="font-medium">{r.depositCode}</div>
                    <div className="text-xs text-gray-500">
                      {thaiDate(r.receivedAt)}{r.carryover && <span className="ml-1 text-amber-600">ค้างยกมา</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{r.purchaseOrder || "—"}</td>
                  <td className="px-3 py-2 max-w-[260px]">
                    <div className="truncate" title={r.supplier}>{r.supplier}</div>
                    <div className="text-xs text-gray-500">{r.creditTerm || "ยังไม่ตั้งเครดิต"}</div>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{baht(r.amount)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {r.dueDate ? thaiDate(r.dueDate) : "—"}
                    {r.overdue > 0 && <div className="text-rose-600 font-medium">⏰ เกิน {r.overdue} วัน</div>}
                  </td>
                  {AP_DOC_FIELDS.map((f) => (
                    <td key={f.key} className="px-2 py-2 text-center">
                      <input type="checkbox" checked={Boolean(r.docs[f.key]?.checked)}
                        onChange={() => toggleDoc(r, f.key)}
                        title={r.docs[f.key]?.by ? `${r.docs[f.key]!.by} · ${thaiDate((r.docs[f.key]!.at || "").slice(0, 10))}` : f.label}
                        className="w-4 h-4 accent-emerald-600 cursor-pointer" />
                    </td>
                  ))}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${meta.cls}`}>
                      {meta.emoji} {meta.value}
                    </span>
                    {r.sentDate && <div className="text-xs text-gray-500 mt-0.5">{r.sentType} {thaiDate(r.sentDate)}</div>}
                  </td>
                </tr>
              )
            })}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={13} className="px-3 py-10 text-center text-gray-400">ไม่พบรายการ</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

> หมายเหตุสำหรับผู้ทำ: `AP_STATUSES`, `nextThursday`, `swalToast` ถูก import ไว้ให้ Task 7 ใช้ (แถบสรุป + popover ส่งบัญชี) — ถ้า lint เตือน unused ในขั้นนี้ ให้ทำ Task 7 ต่อทันทีในรอบเดียวกัน หรือลบ import ที่ยังไม่ใช้ออกก่อนแล้วค่อยเพิ่มกลับ

- [ ] **Step 3: เพิ่มเมนูใน sidebar**

แก้ `components/sidebar.tsx` — เพิ่ม `Banknote` และ `Landmark` ในบรรทัด import จาก `lucide-react` แล้วเพิ่ม 2 รายการในกลุ่ม `"จัดการติดตามสินค้า"` (ต่อจาก `/order-tracking`):

```tsx
      { href: "/ap-tracking", label: "ติดตามเจ้าหนี้", icon: Banknote, exact: true },
      { href: "/ap-tracking/suppliers", label: "เครดิตเทอมเจ้าหนี้", icon: Landmark },
```

- [ ] **Step 4: ตรวจในเบราว์เซอร์**

Run: `npm run dev` → เปิด `http://localhost:3000/ap-tracking`
Expected: (ก) เมนู "ติดตามเจ้าหนี้" อยู่ในกลุ่มจัดการติดตามสินค้า (ข) ตารางขึ้นแถวของเดือนปัจจุบัน (ค) **ติ๊ก checkbox แล้วรีเฟรชหน้า ค่ายังอยู่** (ง) ติ๊กครบ DD+PO+บิล แล้ว chip สถานะเปลี่ยนเป็น 🟡 ครบชุด ทันที

- [ ] **Step 5: Commit**

```bash
git add app/ap-tracking/page.tsx components/ap-tracking-page.tsx components/sidebar.tsx
git commit -m "feat(ap-tracking): หน้าติดตามเจ้าหนี้ + ตารางติ๊กเอกสาร inline"
```

---

### Task 7: แถบสรุป + ปุ่มส่งบัญชี (นอกรอบวันพฤหัส / ตามรอบ) + หมายเหตุ

**Files:**
- Modify: `components/ap-tracking-page.tsx`

**Interfaces:**
- Consumes: `summary` จาก `GET /api/ap-tracking`, `nextThursday`, `AP_STATUSES`
- Produces: `setSent(row, type, date)` และ `saveNote(row, text)` ภายใน component (ไม่ export)

- [ ] **Step 1: เพิ่มฟังก์ชันบันทึกส่งบัญชี + หมายเหตุ**

แทรกใต้ `toggleDoc` ใน `components/ap-tracking-page.tsx`:

```tsx
  // บันทึกวันส่งบัญชี — นอกรอบ = โอนทุกวันพฤหัส · ตามรอบ = วันที่ส่งเอกสาร
  const setSent = async (row: ApRow, type: "" | "นอกรอบ" | "ตามรอบ", date: string) => {
    try {
      const res  = await fetch(`/api/ap-tracking/${encodeURIComponent(row.depositCode)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentType: type, sentDate: date }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "บันทึกไม่สำเร็จ")
      setRows((rs) => rs.map((r) => r.depositCode === row.depositCode
        ? { ...r, sentType: data.sentType, sentDate: data.sentDate, status: data.status, overdue: data.sentDate ? 0 : r.overdue } : r))
      setSentFor(null)
      swalToast("success", date ? `ส่งบัญชี ${type} ${thaiDate(date)}` : "ยกเลิกการส่งบัญชีแล้ว")
    } catch (e) {
      swalError("บันทึกไม่สำเร็จ", e instanceof Error ? e.message : "")
    }
  }

  const saveNote = async (row: ApRow, note: string) => {
    if (note === row.note) return
    try {
      const res  = await fetch(`/api/ap-tracking/${encodeURIComponent(row.depositCode)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "บันทึกไม่สำเร็จ")
      setRows((rs) => rs.map((r) => r.depositCode === row.depositCode ? { ...r, note: data.note } : r))
    } catch (e) {
      swalError("บันทึกหมายเหตุไม่สำเร็จ", e instanceof Error ? e.message : "")
    }
  }
```

เพิ่ม state ข้าง ๆ state เดิม:

```tsx
  const [sentFor, setSentFor] = useState<ApRow | null>(null)
```

- [ ] **Step 2: เพิ่มแถบสรุปเหนือ "ตัวกรอง"**

```tsx
      {/* แถบสรุป — คลิก chip เพื่อกรอง */}
      {summary && (
        <div className="flex flex-wrap gap-2">
          {AP_STATUSES.map((st) => {
            const m = apStatusMeta(st), v = summary.byStatus[st]
            const on = fStatus === st
            return (
              <button key={st} onClick={() => setFStatus(on ? "" : st)}
                className={`rounded-xl border px-3 py-2 text-left transition ${on ? "ring-2 ring-offset-1" : ""} ${m.cls}`}>
                <div className="text-xs">{m.emoji} {st}</div>
                <div className="text-sm font-bold">{v.n} ใบ · {baht(v.amount)}</div>
              </button>
            )
          })}
          <div className="rounded-xl border px-3 py-2 bg-rose-50 dark:bg-rose-950/20">
            <div className="text-xs text-rose-700 dark:text-rose-300">⏰ เกินกำหนดเครดิต</div>
            <div className="text-sm font-bold text-rose-700 dark:text-rose-300">{summary.overdue.n} ใบ · {baht(summary.overdue.amount)}</div>
          </div>
          <div className="rounded-xl border px-3 py-2 bg-emerald-50 dark:bg-emerald-950/20">
            <div className="text-xs text-emerald-700 dark:text-emerald-300">💸 เข้าโอนพฤหัสนี้ ({thaiDate(summary.thisThursday.date)})</div>
            <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{summary.thisThursday.n} ใบ · {baht(summary.thisThursday.amount)}</div>
          </div>
          <div className="rounded-xl border px-3 py-2">
            <div className="text-xs text-gray-500">ยอดค้างส่งบัญชี (ยังไม่ครบกำหนด / ≤7 วัน / เกิน)</div>
            <div className="text-sm font-bold">
              {baht(summary.unsentAging.notDue.amount)} · {baht(summary.unsentAging.due7.amount)} ·{" "}
              <span className="text-rose-600">{baht(summary.unsentAging.overdue.amount)}</span>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 3: เพิ่มคอลัมน์ "ส่งบัญชี" และ "หมายเหตุ" ในตาราง**

เพิ่ม 2 `<th>` ต่อท้ายหัวตาราง (หลัง "สถานะ"):

```tsx
              <th className="px-3 py-2 text-left">ส่งบัญชี</th>
              <th className="px-3 py-2 text-left">หมายเหตุ</th>
```

และ 2 `<td>` ต่อท้ายแถว (หลัง cell สถานะ) — และแก้ `colSpan={13}` เป็น `colSpan={15}`:

```tsx
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button onClick={() => setSentFor(r)}
                      className={`rounded-lg border px-2 py-1 text-xs ${r.sentDate ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300" : "hover:bg-gray-50 dark:hover:bg-white/5"}`}>
                      {r.sentDate ? `✅ ${r.sentType} ${thaiDate(r.sentDate)}` : "ส่งบัญชี"}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <input defaultValue={r.note} placeholder="—"
                      onBlur={(e) => saveNote(r, e.target.value.trim())}
                      className="w-40 rounded border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-gray-300 focus:border-gray-400 focus:bg-white dark:focus:bg-white/10" />
                  </td>
```

- [ ] **Step 4: เพิ่ม popover เลือกวันส่งบัญชี (ท้าย component ก่อนปิด `</div>` นอกสุด)**

```tsx
      {sentFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSentFor(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#161a23] p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="font-bold" style={mitr}>ส่งบัญชี · {sentFor.depositCode}</div>
            <div className="text-xs text-gray-500">{sentFor.supplier} · {baht(sentFor.amount)} บาท</div>

            <div className="space-y-2">
              <div className="text-sm font-medium">💸 นอกรอบ (โอนทุกวันพฤหัส)</div>
              <div className="flex gap-2">
                <button onClick={() => setSent(sentFor, "นอกรอบ", nextThursday(new Date().toISOString().slice(0, 10)))}
                  className="flex-1 rounded-lg border px-2 py-1.5 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
                  พฤหัสนี้ {thaiDate(nextThursday(new Date().toISOString().slice(0, 10)))}
                </button>
                <button onClick={() => {
                  const thu = nextThursday(new Date().toISOString().slice(0, 10))
                  const [y, m, d] = thu.split("-").map(Number)
                  setSent(sentFor, "นอกรอบ", new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10))
                }}
                  className="flex-1 rounded-lg border px-2 py-1.5 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
                  พฤหัสหน้า
                </button>
              </div>

              <div className="text-sm font-medium pt-2">📋 ตามรอบ (วันที่ส่งเอกสาร)</div>
              <input type="date" defaultValue={new Date().toISOString().slice(0, 10)}
                onChange={(e) => e.target.value && setSent(sentFor, "ตามรอบ", e.target.value)}
                className="w-full rounded-lg border px-2 py-1.5 text-sm bg-white dark:bg-white/5" />
            </div>

            <div className="flex justify-between pt-2">
              {sentFor.sentDate && (
                <button onClick={() => setSent(sentFor, "", "")} className="text-xs text-rose-600 hover:underline">ยกเลิกการส่งบัญชี</button>
              )}
              <button onClick={() => setSentFor(null)} className="ml-auto rounded-lg border px-3 py-1.5 text-sm">ปิด</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: ตรวจในเบราว์เซอร์**

Run: `npm run dev` → `/ap-tracking`
Expected: (ก) แถบสรุปแสดงตัวเลข คลิก chip แล้วกรองตาราง (ข) กด "ส่งบัญชี" → เลือก "พฤหัสนี้" → แถวเปลี่ยนเป็น ✅ นอกรอบ + สถานะ ส่งบัญชีแล้ว + tile "เข้าโอนพฤหัสนี้" เพิ่มขึ้นหลังกดรีเฟรช (ค) พิมพ์หมายเหตุแล้วคลิกออก → รีเฟรชหน้าแล้วยังอยู่ (ง) กดยกเลิกการส่งบัญชี → กลับเป็นสถานะเดิม

- [ ] **Step 6: Commit**

```bash
git add components/ap-tracking-page.tsx
git commit -m "feat(ap-tracking): แถบสรุป + ส่งบัญชีนอกรอบ/ตามรอบ + หมายเหตุ"
```

---

### Task 8: modal รายละเอียดใบ DD

**Files:**
- Create: `components/ap-tracking-detail.tsx`
- Modify: `components/ap-tracking-page.tsx` (ทำให้เลข DD กดได้ + render modal)

**Interfaces:**
- Consumes: `GET /api/ap-tracking/[code]`, type `ApRow` จาก `components/ap-tracking-page`
- Produces: `<ApTrackingDetail row={ApRow} onClose={() => void} />`

- [ ] **Step 1: เขียน modal**

```tsx
// components/ap-tracking-detail.tsx
"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { AP_DOC_FIELDS, thaiDate } from "@/lib/ap-tracking"
import type { ApRow } from "@/components/ap-tracking-page"

type DepositItem = { parts_group?: string; item?: string; serial_no?: string; qty?: string; unit_price?: string; total?: string; remark?: string }
type LogEntry = { action?: string; field?: string; detail?: string; by?: string; at?: string }
type Detail = {
  tracking: { log?: LogEntry[] } | null
  items: DepositItem[]
  po: Record<string, unknown> | null
}

const mitr = { fontFamily: "var(--font-mitr), sans-serif" }
const labelOf = (k: string) => AP_DOC_FIELDS.find((f) => f.key === k)?.label ?? k

export function ApTrackingDetail({ row, onClose }: { row: ApRow; onClose: () => void }) {
  const [data, setData]       = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/ap-tracking/${encodeURIComponent(row.depositCode)}`)
        const d   = await res.json()
        if (alive && res.ok) setData(d)
      } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [row.depositCode])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#161a23] p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <div>
            <div className="text-lg font-bold" style={mitr}>{row.depositCode}</div>
            <div className="text-sm text-gray-500">
              {row.supplier} · {row.warehouse} · รับของ {thaiDate(row.receivedAt)}
              {row.creditTerm && <> · เครดิต {row.creditTerm} · ครบกำหนด {thaiDate(row.dueDate)}</>}
            </div>
          </div>
          <button onClick={onClose} className="ml-auto rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>

        <section>
          <h3 className="text-sm font-bold mb-1" style={mitr}>ใบสั่งซื้อ (PO)</h3>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {row.purchaseOrder
              ? <>{row.purchaseOrder} · ยอด PO {row.poTotal.toLocaleString("th-TH")} · กำหนดส่ง {thaiDate(row.poDue)} · {row.poStatus || "—"}</>
              : "ไม่มี PO ผูกกับใบนี้ในระบบ ATMS"}
          </div>
        </section>

        <section>
          <h3 className="text-sm font-bold mb-1" style={mitr}>รายการสินค้า</h3>
          {loading ? <div className="text-sm text-gray-400">กำลังโหลด…</div> : (
            <div className="overflow-x-auto rounded-lg border dark:border-white/10">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 dark:bg-white/5">
                  <tr>
                    <th className="px-2 py-1.5 text-left">รายการ</th>
                    <th className="px-2 py-1.5 text-right">จำนวน</th>
                    <th className="px-2 py-1.5 text-right">ราคา/หน่วย</th>
                    <th className="px-2 py-1.5 text-right">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items ?? []).map((it, i) => (
                    <tr key={i} className="border-t dark:border-white/10">
                      <td className="px-2 py-1.5">{it.item}</td>
                      <td className="px-2 py-1.5 text-right">{it.qty}</td>
                      <td className="px-2 py-1.5 text-right">{it.unit_price}</td>
                      <td className="px-2 py-1.5 text-right">{it.total}</td>
                    </tr>
                  ))}
                  {!loading && (data?.items ?? []).length === 0 && (
                    <tr><td colSpan={4} className="px-2 py-4 text-center text-gray-400">ไม่มีรายการสินค้าในระบบ</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h3 className="text-sm font-bold mb-1" style={mitr}>ประวัติการติ๊ก/แก้ไข</h3>
          <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
            {(data?.tracking?.log ?? []).slice().reverse().map((l, i) => (
              <li key={i}>
                {thaiDate((l.at ?? "").slice(0, 10))} · {l.action} {l.field && l.field !== "sent" && l.field !== "note" ? labelOf(l.field) : ""} {l.detail ?? ""} · โดย {l.by || "—"}
              </li>
            ))}
            {!loading && (data?.tracking?.log ?? []).length === 0 && <li className="text-gray-400">ยังไม่มีประวัติ</li>}
          </ul>
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: ต่อเข้ากับหน้าหลัก**

ใน `components/ap-tracking-page.tsx` เพิ่ม import + state + ทำให้เลข DD กดได้ + render modal:

```tsx
import { ApTrackingDetail } from "@/components/ap-tracking-detail"
// ...
  const [detailFor, setDetailFor] = useState<ApRow | null>(null)
```

เปลี่ยน cell เลข DD จาก `<div className="font-medium">{r.depositCode}</div>` เป็น:

```tsx
                    <button onClick={() => setDetailFor(r)} className="font-medium text-blue-600 hover:underline">{r.depositCode}</button>
```

และเพิ่มท้าย component:

```tsx
      {detailFor && <ApTrackingDetail row={detailFor} onClose={() => setDetailFor(null)} />}
```

- [ ] **Step 3: ตรวจในเบราว์เซอร์**

Expected: คลิกเลข DD → modal เปิด แสดงรายการสินค้าจริงจาก `deposit_items` (ใบที่ scraper ดึง detail ไว้) + ประวัติการติ๊กที่เพิ่งทำใน Task 6-7 · ใบที่ไม่มี items แสดง "ไม่มีรายการสินค้าในระบบ" ไม่ใช่หน้าขาว

- [ ] **Step 4: Commit**

```bash
git add components/ap-tracking-detail.tsx components/ap-tracking-page.tsx
git commit -m "feat(ap-tracking): modal รายละเอียดใบ DD + ประวัติการติ๊ก"
```

---

### Task 9: หน้าจัดการเครดิตเทอมซัพพลายเออร์

**Files:**
- Create: `app/ap-tracking/suppliers/page.tsx`
- Create: `components/ap-suppliers-page.tsx`

**Interfaces:**
- Consumes: `GET /api/ap-suppliers`, `PUT /api/ap-suppliers`, `CREDIT_TERMS`
- Produces: `<ApSuppliersPage />`

- [ ] **Step 1: route wrapper**

```tsx
// app/ap-tracking/suppliers/page.tsx
import { ApSuppliersPage } from "@/components/ap-suppliers-page"

export default function Page() {
  return <ApSuppliersPage />
}
```

- [ ] **Step 2: เขียน component**

```tsx
// components/ap-suppliers-page.tsx
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Landmark, Search } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { CREDIT_TERMS } from "@/lib/ap-tracking"

const mitr = { fontFamily: "var(--font-mitr), sans-serif" }
type Supplier = { name: string; creditTerm: string; updatedBy?: string }

export function ApSuppliersPage() {
  const [items, setItems] = useState<Supplier[]>([])
  const [q, setQ]         = useState("")
  const [newName, setNewName] = useState("")

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ap-suppliers")
      const d   = await res.json()
      if (!res.ok) throw new Error(d?.error ?? "โหลดไม่สำเร็จ")
      setItems(d)
    } catch (e) { swalError("โหลดไม่สำเร็จ", e instanceof Error ? e.message : "") }
  }, [])
  useEffect(() => { load() }, [load])

  const save = async (name: string, creditTerm: string) => {
    setItems((xs) => xs.some((x) => x.name === name)
      ? xs.map((x) => (x.name === name ? { ...x, creditTerm } : x))
      : [...xs, { name, creditTerm }].sort((a, b) => a.name.localeCompare(b.name)))
    try {
      const res = await fetch("/api/ap-suppliers", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, creditTerm }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")
      swalToast("success", `บันทึก ${name} · ${creditTerm || "ไม่ระบุ"}`)
    } catch (e) {
      swalError("บันทึกไม่สำเร็จ", e instanceof Error ? e.message : "")
      load()
    }
  }

  const shown = useMemo(() => {
    if (!q) return items
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    return items.filter((x) => rx.test(x.name))
  }, [items, q])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Landmark className="w-6 h-6 text-emerald-600" />
        <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={mitr}>เครดิตเทอมเจ้าหนี้</h1>
        <span className="text-xs text-gray-500">{items.length} ราย</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาซัพพลายเออร์"
            className="rounded-lg border pl-8 pr-3 py-1.5 text-sm w-72 bg-white dark:bg-white/5" />
        </div>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="เพิ่มซัพพลายเออร์ใหม่"
          className="rounded-lg border px-3 py-1.5 text-sm w-72 bg-white dark:bg-white/5" />
        <button onClick={() => { const n = newName.trim(); if (n) { save(n, "30D"); setNewName("") } }}
          className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-white/5">เพิ่ม (30D)</button>
      </div>

      <div className="rounded-xl border dark:border-white/10 overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-white/5 text-xs text-gray-600 dark:text-gray-300">
            <tr>
              <th className="px-3 py-2 text-left">ซัพพลายเออร์</th>
              <th className="px-3 py-2 text-left w-40">เครดิตเทอม</th>
              <th className="px-3 py-2 text-left w-40">แก้ไขล่าสุดโดย</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((x) => (
              <tr key={x.name} className="border-t dark:border-white/10">
                <td className="px-3 py-2">{x.name}</td>
                <td className="px-3 py-2">
                  <select value={x.creditTerm} onChange={(e) => save(x.name, e.target.value)}
                    className="rounded-lg border px-2 py-1 text-sm bg-white dark:bg-white/5">
                    <option value="">ไม่ระบุ</option>
                    {CREDIT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">{x.updatedBy || "—"}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={3} className="px-3 py-10 text-center text-gray-400">ไม่พบซัพพลายเออร์</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: ตรวจในเบราว์เซอร์**

Expected: `/ap-tracking/suppliers` แสดงรายชื่อที่ seed มา · เปลี่ยน dropdown แล้ว toast ขึ้น · กลับไป `/ap-tracking` กดรีเฟรช เห็นคอลัมน์เครดิต + ครบกำหนดของซัพพลายเออร์นั้นเปลี่ยนตาม

- [ ] **Step 4: Commit**

```bash
git add app/ap-tracking/suppliers/page.tsx components/ap-suppliers-page.tsx
git commit -m "feat(ap-tracking): หน้าจัดการเครดิตเทอมเจ้าหนี้"
```

---

### Task 10: ตรวจรวบยอด + index + บันทึกความรู้

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-ap-tracking.md` (จดผล)

- [ ] **Step 1: รัน assertion + lint + build**

Run: `npx tsx scripts/check-ap-tracking.ts && npm run lint && npm run build`
Expected: assertion ผ่าน · lint ไม่มี error ใหม่ · build สำเร็จ และเห็น route `/ap-tracking`, `/ap-tracking/suppliers`, `/api/ap-tracking`, `/api/ap-tracking/[code]`, `/api/ap-suppliers` ในผลลัพธ์

- [ ] **Step 2: ทดสอบ flow ปลายทางจริงในเบราว์เซอร์**

ทำตามลำดับนี้กับใบ DD จริง 1 ใบ แล้วยืนยันทุกข้อ:
1. เปิด `/ap-tracking` เลือกเดือน 2026-07 → แถวขึ้น พร้อมยอดเงินและครบกำหนด
2. ติ๊ก DD + PO → สถานะยังเป็น 🔴 รอประกบ (ยังขาดเอกสารการเงิน)
3. ติ๊กใบเสร็จเพิ่ม → สถานะเปลี่ยนเป็น 🟡 ครบชุด ทันที
4. กด "ส่งบัญชี" → พฤหัสนี้ → สถานะ ✅ ส่งบัญชีแล้ว, tile "เข้าโอนพฤหัสนี้" เพิ่มขึ้นหลังรีเฟรช
5. คลิกเลข DD → modal แสดงรายการสินค้า + ประวัติ 4 บรรทัดที่เพิ่งทำ
6. รีเฟรชหน้า (F5) → ทุกอย่างยังอยู่ครบ

- [ ] **Step 3: ตัดสินใจเรื่อง index บน atms (ต้องถามผู้ใช้ก่อน)**

วัดเวลา `GET /api/ap-tracking?month=2026-07` จาก devtools Network
- ถ้า < 2 วินาที: **ไม่ต้องสร้าง index** จดไว้ว่ายังไม่จำเป็น
- ถ้า ≥ 2 วินาที: เสนอผู้ใช้สร้าง `db.deposit_header.createIndex({ received_at: 1 })` + `{ deposit_code: 1 }` แบบ `background: true` **และรอคำอนุมัติก่อนรันทุกครั้ง** (เขียนบน prod)

- [ ] **Step 4: Commit + บันทึกความรู้**

```bash
git add -A
git commit -m "docs(ap-tracking): สรุปผลตรวจและการตัดสินใจเรื่อง index"
```

จากนั้นอัปเดตหน่วยความจำโปรเจกต์ (`proj_master_sku_web.md`) เพิ่มย่อหน้า ap-tracking: route, collection, กติกาครบชุด, seed script, และข้อจำกัดความสดข้อมูลจาก atms-extractor

- [ ] **Step 5: ถามผู้ใช้ก่อน push**

`git push` ต้องขออนุญาตผู้ใช้เสมอ (การ push = deploy ขึ้น Vercel production ทันที)

---

## Notes / ผลการตรวจ

<!-- Task 1 จดผล probe ที่นี่: received_at="..." created_at="..." amount="..." deposit_header count=N indexes=[...] -->
