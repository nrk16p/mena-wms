# ใบเทียบราคา (price-compare) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** โมดูล `/price-compare` ใน mena-wms สำหรับกรอก "แบบบันทึกผลการเปรียบเทียบราคา" เทียบ supplier 1–4 บันทึกผลกรรมการ และ export PDF ตามฟอร์มเดิมพร้อมหลักฐานแนบต่อท้าย

**Architecture:** ตรรกะคำนวณ/validate อยู่ใน `lib/price-compare.ts` (pure, ไม่ import อะไร) ใช้ร่วมกันทั้ง API, หน้าเว็บ และ PDF. API 4 route ใน `app/api/price-compare/` เก็บ collection `price_compare` + `price_compare_log`. PDF สร้างฝั่ง server ด้วย pdfmake (หน้า 1 + หน้ารูป) แล้วใช้ pdf-lib แทรก PDF ที่อัปโหลดตามลำดับ supplier. UI = หน้า list + ฟอร์มหน้าเดียว แยก matrix เป็น component ของตัวเอง

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · MongoDB driver 7 · Tailwind 4 · next-auth v4 · pdfmake 0.3 · pdf-lib · sharp · tsx สำหรับสคริปต์ตรวจ

**Spec:** `docs/superpowers/specs/2026-09-08-price-compare-design.md`

## Global Constraints

- **ไม่มี test framework** — ใช้ `import assert from "node:assert/strict"` + `npx tsx scripts/check-*.ts` ตามแพตเทิร์น `scripts/check-deadstock-core.ts`
- DB = `process.env.MONGO_DB ?? "master_data"`, client จาก `import clientPromise from "@/lib/mongo"`
- Session = `getServerSession(authOptions)` จาก `next-auth` / `@/lib/auth`; ชื่อผู้ใช้ = `session.user.name || session.user.email`
- "วันนี้"/เวลา ต้องใช้ `bkkToday()`, `toBkkIso()` จาก `@/lib/bkk-time` (Vercel รัน UTC — ห้าม `new Date().toISOString().slice(0,10)`)
- ห้ามใช้ `window.confirm`/`alert` — ใช้ `swalConfirm/swalDeleteConfirm/swalToast/swalError` จาก `@/lib/swal`
- ไฟล์แนบใช้ `ImageUpload` จาก `@/components/image-upload` (props: `onChange(images: SkuImage[])`, `initial?: SkuImage[]`, `max?`, `disabled?`) — รูปเป็น webp บน CDN, PDF ชื่อไฟล์ลงท้าย `.pdf`
- เลขที่เอกสาร `PC-YYMM-NNN` (YY = **ค.ศ.** 2 หลักท้าย ตามฟอร์มต้นแบบ PC-2609-002 = ก.ย. 2026), VAT 7%, ปัด 2 ตำแหน่งด้วย `Math.round(x*100)/100`
- Supplier สูงสุด 4 ราย, กรรมการ 4 ช่องเสมอ, สถานะ `ร่าง | รอลงนาม | เสร็จสิ้น`
- กฎจัดซื้อ (จากการค้นคว้า): ฐาน VAT ต่อ supplier (`vatMode` excl/incl/none — เทียบกันที่สุทธิจริง), ใบเสนอราคาครบ ≥3 ราย ไม่งั้นต้องมี `fewerQuotesReason`, เลือกรายที่ไม่ใช่สุทธิต่ำสุดต้องมี `selectionReason`, เก็บ `quoteDate/validUntil` และเตือนเมื่อหมดอายุ
- ทุก API ต้องมี session (401 ถ้าไม่มี) — ไม่มี public route จึงไม่ต้องแก้ `middleware.ts`
- ฟอนต์ PDF = Sarabun อย่างเดียว ใน `fonts/` และต้องประกาศ `outputFileTracingIncludes` ใน `next.config.ts`
- Commit ทุก task; `git pull --rebase --autostash` ก่อน commit แรกของ session; **ห้าม push** จนกว่าผู้ใช้สั่ง

---

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `lib/price-compare.ts` | types, `DEFAULT_COMMITTEE`, `newDoc()`, คำนวณ (`lineTotal/supplierTotals/lowestPerLine/lowestNet/isComplete`), `normalizeDoc/validateDoc`, `canTransition`, `docNoParts` — **ห้าม import อะไร** |
| `lib/price-compare-log.ts` | `PC_LOG_COLL`, `diffPriceCompare`, `writePcLog` |
| `lib/price-compare-db.ts` | `nextDocNo(db)`, `PC_COLL` — ส่วนที่ต้องแตะ Mongo |
| `lib/pdfmake-printer.ts` | copy จาก mena-partner (เฉพาะ Sarabun) — `renderPdfmake`, `seg`, `fixThaiMarks` |
| `lib/price-compare-pdf.ts` | `buildPriceCompareDocDef(doc, imagePages)` → docDefinition หน้า 1 + หน้ารูป |
| `lib/price-compare-attachments.ts` | `collectAttachments(doc)` → โหลดไฟล์, webp→png, แยกรูป/PDF; `mergePdfAttachments(mainPdf, plan)` |
| `fonts/Sarabun-*.ttf`, `fonts/mena-logo.jpg` | copy จาก mena-partner |
| `app/api/price-compare/route.ts` | GET list, POST create |
| `app/api/price-compare/[id]/route.ts` | GET, PUT, DELETE |
| `app/api/price-compare/[id]/log/route.ts` | GET log |
| `app/api/price-compare/[id]/pdf/route.ts` | GET PDF |
| `app/price-compare/page.tsx`, `app/price-compare/[id]/page.tsx` | route บาง |
| `components/price-compare-list.tsx` | หน้ารายการ |
| `components/price-compare-matrix.tsx` | ตาราง matrix รายการ×supplier + สรุปยอด |
| `components/price-compare-form.tsx` | ฟอร์มทั้งใบ (หัวเอกสาร, matrix, เงื่อนไข, หลักฐาน, กรรมการ, สรุป, ประวัติ) |
| `lib/nav.ts` | เพิ่มกลุ่ม "เปรียบเทียบราคา" |
| `next.config.ts`, `package.json` | fonts tracing, deps |
| `scripts/check-price-compare-core.ts` | test ตรรกะ |
| `scripts/check-price-compare-pdf.ts` | test สร้าง PDF + merge |
| `scripts/ensure-price-compare-indexes.mjs` | index |
| `scripts/seed-price-compare-uh03.mjs` | ใบตัวอย่างจากต้นแบบ |

---

### Task 1: Core logic — types, defaults, คำนวณ, validate (`lib/price-compare.ts`)

**Files:**
- Create: `lib/price-compare.ts`
- Test: `scripts/check-price-compare-core.ts`

**Interfaces:**
- Consumes: ไม่มี (ห้าม import)
- Produces:
  ```ts
  export type PcStatus = "ร่าง" | "รอลงนาม" | "เสร็จสิ้น"
  export type PcFile = { mediaId: number; batchId: string; filename: string; webpUrl: string; thumbnailUrl: string }
  export type PcItem = { name: string; qty: number; unit: string }
  export type PcConditions = { payment: string; leadTime: string; warranty: string; remark: string; bays: string; menaTrucksIn: string; statusA: string; statusB: string }
  export type PcVatMode = "excl" | "incl" | "none"
  export type PcSupplier = { name: string; garageId?: string; note: string; prices: (number | null)[]; discount: number; vatMode: PcVatMode; quoteDate: string; validUntil: string; conditions: PcConditions; quotationFiles: PcFile[] }
  export type PcCommittee = { role: string; name: string; email?: string; pickedSupplier: number | null; reason: string; signedDate: string }
  export type PcLinks = { prCode?: string; plate?: string; fleetNo?: string; repairExternalId?: string }
  export type PriceCompare = { _id?: string; docNo: string; title: string; requestDept: string; preparedBy: { name: string; email: string }; revision: number; createdAt: string; updatedAt: string; status: PcStatus; items: PcItem[]; suppliers: PcSupplier[]; committee: PcCommittee[]; selectedSupplier: number | null; selectionReason: string; fewerQuotesReason: string; links: PcLinks; evidenceFiles: PcFile[]; createdBy: string; editedBy: string }
  export type PcTotals = { subtotal: number; discount: number; afterDiscount: number; vat: number; net: number }
  export const PC_STATUSES: PcStatus[]
  export const MAX_SUPPLIERS = 4
  export const MIN_QUOTES = 3
  export const VAT_RATE = 0.07
  export const VAT_MODE_LABEL: Record<PcVatMode, string>   // excl:"ราคาก่อน VAT", incl:"ราคารวม VAT แล้ว", none:"ไม่มี VAT"
  export const DEFAULT_COMMITTEE_ROLES: string[]   // 4 ตำแหน่งตามฟอร์ม
  export function round2(n: number): number
  export function emptyConditions(): PcConditions
  export function emptySupplier(itemCount: number): PcSupplier
  export function emptyCommittee(): PcCommittee[]
  export function newDoc(preparedBy: { name: string; email: string }): Omit<PriceCompare, "_id" | "docNo" | "createdAt" | "updatedAt">
  export function lineTotal(item: PcItem, price: number | null): number | null
  export function supplierTotals(doc: Pick<PriceCompare, "items" | "suppliers">, idx: number): PcTotals
  export function lowestPerLine(doc: Pick<PriceCompare, "items" | "suppliers">): (number | null)[]   // index supplier ต่อแถว
  export function lowestNet(doc: Pick<PriceCompare, "items" | "suppliers">): number | null
  export function completeSupplierCount(doc: Pick<PriceCompare, "items" | "suppliers">): number   // supplier ที่มีชื่อ + ราคาครบทุกแถว
  export function isQuoteExpired(s: Pick<PcSupplier, "validUntil">, today: string): boolean
  export function isComplete(doc: PriceCompare, opts?: { requireCommitteeNames?: boolean }): { ok: boolean; missing: string[] }
  export function canTransition(from: PcStatus, to: PcStatus, doc: PriceCompare): { ok: boolean; reason?: string }
  export function normalizeDoc(input: unknown): PriceCompare   // เติม default/ตัดฟิลด์แปลก/แปลงตัวเลข
  export function validateDoc(doc: PriceCompare): string[]     // [] = ผ่าน
  export function docNoFor(bkkDate: string, seq: number): string   // ("2026-09-07", 2) → "PC-2609-002"
  export function counterKeyFor(bkkDate: string): string           // → "price_compare:2609"
  export function fmtMoney(n: number | null | undefined): string   // "50,690.00" / ""
  ```

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

```ts
// scripts/check-price-compare-core.ts
// รัน: npx tsx scripts/check-price-compare-core.ts   (repo ไม่มี test framework — ใช้ assert ตามแพตเทิร์น check-deadstock-core.ts)
import assert from "node:assert/strict"
import {
  newDoc, emptySupplier, supplierTotals, lowestPerLine, lowestNet, isComplete, canTransition,
  normalizeDoc, validateDoc, docNoFor, counterKeyFor, fmtMoney, lineTotal, round2,
  completeSupplierCount, isQuoteExpired, MIN_QUOTES,
  type PriceCompare, type PcSupplier,
} from "../lib/price-compare"

// --- ใบต้นแบบ PC-2609-002 (Pump + Motor UH03) 3 supplier 5 รายการ ---
function uh03(): PriceCompare {
  const d = newDoc({ name: "นพรัตน์ อายยืน", email: "n@mena.co.th" }) as PriceCompare
  d.docNo = "PC-2609-002"; d.createdAt = "2026-09-07T09:00:00.000+07:00"; d.updatedAt = d.createdAt
  d.title = "Pump + Motor UH03"; d.requestDept = "ยานยนต์"
  d.items = [
    { name: "Pump Rexroth", qty: 1, unit: "ตัว" },
    { name: "Motor Rexroth", qty: 1, unit: "ตัว" },
    { name: "น้ำมัน HYD.", qty: 18, unit: "ลิตร" },
    { name: "น้ำมันเกียร์", qty: 10, unit: "ลิตร" },
    { name: "ค่าแรงซ่อม+ประกอบทดสอบ", qty: 1, unit: "งาน" },
  ]
  const s = (name: string, prices: number[]): PcSupplier => ({ ...emptySupplier(5), name, prices })
  d.suppliers = [
    s("ช่างหมู", [21000, 18900, 110.56, 180, 7000]),
    s("คุณณัฐ", [30000, 18000, 100, 100, 5500]),
    s("ศศ&ณ",  [30000, 25000, 107.14, 107.14, 5000]),
  ]
  return d
}

// --- round2 / lineTotal ---
assert.equal(round2(3548.299), 3548.3)
assert.equal(lineTotal({ name: "x", qty: 18, unit: "ลิตร" }, 110.56), 1990.08)
assert.equal(lineTotal({ name: "x", qty: 18, unit: "ลิตร" }, null), null)

// --- supplierTotals ตรงกับต้นแบบ (ต้นแบบปัดยอดรายแถวก่อนรวม: 18×110.56 = 1,990.08 → ในฟอร์มเขียน 1,990.00 แต่เราใช้ค่าจริง) ---
const d = uh03()
const t0 = supplierTotals(d, 0)
assert.equal(t0.subtotal, 50690.08)
assert.equal(t0.vat, 3548.31)
assert.equal(t0.net, 54238.39)
const t1 = supplierTotals(d, 1)
assert.deepEqual(t1, { subtotal: 56300, discount: 0, afterDiscount: 56300, vat: 3941, net: 60241 })
const t2 = supplierTotals(d, 2)
assert.equal(t2.subtotal, 62999.92)   // 107.14×18 = 1,928.52 + 107.14×10 = 1,071.40 (ฟอร์มกระดาษปัดเป็น 63,000)
assert.equal(t2.net, 67409.91)

// ส่วนลดหักก่อนคิด VAT
d.suppliers[1].discount = 300
assert.deepEqual(supplierTotals(d, 1), { subtotal: 56300, discount: 300, afterDiscount: 56000, vat: 3920, net: 59920 })
d.suppliers[1].discount = 0

// --- vatMode: incl → สุทธิ = หลังส่วนลด, VAT แยกออกมาให้เห็น; none → VAT 0 ---
d.suppliers[1].vatMode = "incl"
assert.deepEqual(supplierTotals(d, 1), { subtotal: 56300, discount: 0, afterDiscount: 56300, vat: 3683.18, net: 56300 })
d.suppliers[1].vatMode = "none"
assert.deepEqual(supplierTotals(d, 1), { subtotal: 56300, discount: 0, afterDiscount: 56300, vat: 0, net: 56300 })
d.suppliers[1].vatMode = "excl"

// รายการที่ null ไม่ถูกนับ และ supplier ที่ไม่มีราคาเลย → 0
d.suppliers[2].prices[0] = null
assert.equal(supplierTotals(d, 2).subtotal, 32999.92)
d.suppliers[2].prices[0] = 30000
assert.equal(supplierTotals(d, 3).subtotal, 0, "index เกิน → totals ศูนย์ ไม่ throw")

// --- lowestPerLine / lowestNet ---
assert.deepEqual(lowestPerLine(d), [0, 1, 1, 1, 2])
assert.equal(lowestNet(d), 0)
d.suppliers[0].prices = [null, null, null, null, null]
assert.equal(lowestNet(d), 1, "supplier ที่ไม่มีราคาเลย ไม่ถือว่าถูกสุด")
assert.deepEqual(lowestPerLine({ items: d.items, suppliers: [] }), [null, null, null, null, null])
assert.equal(lowestNet({ items: d.items, suppliers: [] }), null)

// --- completeSupplierCount / isQuoteExpired ---
assert.equal(MIN_QUOTES, 3)
assert.equal(completeSupplierCount(uh03()), 3)
{ const x = uh03(); x.suppliers[2].prices[4] = null; assert.equal(completeSupplierCount(x), 2, "ราคาไม่ครบทุกแถว ไม่นับ") }
{ const x = uh03(); x.suppliers[2].name = ""; assert.equal(completeSupplierCount(x), 2, "ไม่มีชื่อ ไม่นับ") }
assert.equal(isQuoteExpired({ validUntil: "2026-09-01" }, "2026-09-08"), true)
assert.equal(isQuoteExpired({ validUntil: "2026-09-08" }, "2026-09-08"), false, "วันสุดท้ายยังใช้ได้")
assert.equal(isQuoteExpired({ validUntil: "" }, "2026-09-08"), false, "ไม่ระบุ = ไม่เตือน")

// --- isComplete ---
const c = uh03()
let r = isComplete(c)
assert.equal(r.ok, false)
assert.ok(r.missing.includes("ผู้ได้รับเลือก"))
assert.ok(r.missing.includes("ชื่อกรรมการ"))
c.selectedSupplier = 1
c.committee = c.committee.map((m) => ({ ...m, name: "กรรมการ" }))
assert.equal(isComplete(c).ok, true)
c.committee[3].name = ""
assert.equal(isComplete(c).ok, false)
assert.equal(isComplete(c, { requireCommitteeNames: false }).ok, true)
// กฎ 3 ราย: เหลือ 2 ราย → ต้องมีเหตุผล
c.suppliers = [c.suppliers[0], c.suppliers[1]]
r = isComplete(c, { requireCommitteeNames: false })
assert.equal(r.ok, false)
assert.ok(r.missing.some((m) => m.includes("3 ราย")))
c.fewerQuotesReason = "อู่ที่รับงาน Rexroth มีแค่ 2 ราย"
assert.equal(isComplete(c, { requireCommitteeNames: false }).ok, true)
// กฎเลือกรายที่ไม่ใช่ถูกสุด: supplier 2 แพงกว่า → ต้องมี selectionReason
c.selectedSupplier = 2
r = isComplete(c, { requireCommitteeNames: false })
assert.equal(r.ok, false)
assert.ok(r.missing.some((m) => m.includes("เหตุผลที่ไม่เลือก")))
c.selectionReason = "ของใหม่ มือ 1 รับประกัน 1 ปี"
assert.equal(isComplete(c, { requireCommitteeNames: false }).ok, true)
c.suppliers = [c.suppliers[0]]; c.selectedSupplier = 1
assert.equal(isComplete(c, { requireCommitteeNames: false }).ok, true, "รายเดียว + มีเหตุผล = ผ่าน (sole source)")
c.fewerQuotesReason = ""
assert.equal(isComplete(c, { requireCommitteeNames: false }).ok, false)

// --- canTransition ---
const tr = uh03()
assert.equal(canTransition("ร่าง", "รอลงนาม", tr).ok, false, "ยังไม่เลือกผู้ได้รับเลือก")
tr.selectedSupplier = 3
assert.equal(canTransition("ร่าง", "รอลงนาม", tr).ok, false, "เลือกรายแพงสุดโดยไม่มีเหตุผล → บล็อก")
tr.selectedSupplier = 1
assert.equal(canTransition("ร่าง", "รอลงนาม", tr).ok, true, "ชื่อกรรมการกรอกทีหลังได้")
assert.equal(canTransition("รอลงนาม", "เสร็จสิ้น", tr).ok, false, "วันที่ลงนามยังไม่ครบ")
tr.committee = tr.committee.map((m) => ({ ...m, name: "ก", signedDate: "2026-09-07" }))
assert.equal(canTransition("รอลงนาม", "เสร็จสิ้น", tr).ok, true)
assert.equal(canTransition("เสร็จสิ้น", "รอลงนาม", tr).ok, true, "เปิดแก้ไขได้")
assert.equal(canTransition("ร่าง", "เสร็จสิ้น", tr).ok, false, "ข้ามขั้นไม่ได้")
assert.equal(canTransition("รอลงนาม", "ร่าง", tr).ok, true, "ถอยกลับร่างได้")
assert.equal(canTransition("ร่าง", "ร่าง", tr).ok, true)

// --- normalizeDoc: เติม default, แปลงเลขจาก string, ตัด supplier เกิน 4, prices ยาวเท่า items ---
const n = normalizeDoc({
  title: " งาน ", items: [{ name: "a", qty: "2", unit: "" }, { name: "b", qty: 1 }],
  suppliers: [{ name: "x", prices: ["10"], vatMode: "incl", quoteDate: "2026-09-03", validUntil: "2026-10-03T00:00:00Z" }, { vatMode: "weird" }, {}, {}, { name: "เกิน" }],
  committee: [{ name: "ก" }],
  selectedSupplier: "2",
  selectionReason: "  ของใหม่  ",
})
assert.equal(n.suppliers[0].vatMode, "incl")
assert.equal(n.suppliers[0].validUntil, "2026-10-03", "ตัดเหลือ YYYY-MM-DD")
assert.equal(n.suppliers[1].vatMode, "excl", "ค่าแปลก → default excl")
assert.equal(n.selectionReason, "ของใหม่")
assert.equal(n.fewerQuotesReason, "")
assert.equal(n.title, "งาน")
assert.equal(n.items[0].qty, 2)
assert.equal(n.suppliers.length, 4)
assert.deepEqual(n.suppliers[0].prices, [10, null])
assert.equal(n.suppliers[1].discount, 0)
assert.equal(n.suppliers[1].conditions.payment, "")
assert.equal(n.committee.length, 4, "กรรมการเติมให้ครบ 4 ช่องเสมอ")
assert.equal(n.committee[0].name, "ก")
assert.equal(n.committee[1].role.length > 0, true, "ช่องที่เติมมี role ตามฟอร์ม")
assert.equal(n.selectedSupplier, 2)
assert.equal(n.status, "ร่าง")
assert.deepEqual(n.evidenceFiles, [])

// --- validateDoc ---
assert.deepEqual(validateDoc(uh03()), [])
const bad = uh03()
bad.items = []
assert.ok(validateDoc(bad).some((m) => m.includes("รายการ")))
const bad2 = uh03(); bad2.suppliers = []
assert.ok(validateDoc(bad2).some((m) => m.includes("supplier")))
const bad3 = uh03(); bad3.items[0].qty = 0
assert.ok(validateDoc(bad3).some((m) => m.includes("จำนวน")))
const bad4 = uh03(); bad4.suppliers[0].discount = -1
assert.ok(validateDoc(bad4).some((m) => m.includes("ส่วนลด")))
const bad5 = uh03(); bad5.selectedSupplier = 4
assert.ok(validateDoc(bad5).some((m) => m.includes("ผู้ได้รับเลือก")))
const bad6 = uh03(); bad6.committee[0].pickedSupplier = 9
assert.ok(validateDoc(bad6).some((m) => m.includes("กรรมการ")))
const bad7 = uh03(); bad7.suppliers[0].prices = [1]
assert.ok(validateDoc(bad7).some((m) => m.includes("ราคา")))

// --- docNo / counter key (ปี ค.ศ. 2 หลักท้าย + เดือน — ตามฟอร์มต้นแบบ PC-2609-002 ลงวันที่ 7/9/2569) ---
assert.equal(docNoFor("2026-09-07", 2), "PC-2609-002")
assert.equal(docNoFor("2026-12-31", 123), "PC-2612-123")
assert.equal(docNoFor("2027-01-01", 1), "PC-2701-001")
assert.equal(counterKeyFor("2026-09-07"), "price_compare:2609")

// --- fmtMoney ---
assert.equal(fmtMoney(50690), "50,690.00")
assert.equal(fmtMoney(3548.3), "3,548.30")
assert.equal(fmtMoney(null), "")

console.log("check-price-compare-core: OK")
```

- [ ] **Step 2: รัน test ให้เห็นว่าไม่ผ่าน**

Run: `cd ~/Documents/project/master-sku-web && npx tsx scripts/check-price-compare-core.ts`
Expected: FAIL — `Cannot find module '../lib/price-compare'`

- [ ] **Step 3: เขียน `lib/price-compare.ts`**

```ts
// lib/price-compare.ts
// ตรรกะล้วนของใบเทียบราคา — ห้าม import อะไรทั้งสิ้น เพื่อให้ทดสอบตรงๆ ด้วย tsx และใช้ได้ทั้ง client/server/PDF

export type PcStatus = "ร่าง" | "รอลงนาม" | "เสร็จสิ้น"
export const PC_STATUSES: PcStatus[] = ["ร่าง", "รอลงนาม", "เสร็จสิ้น"]
export const MAX_SUPPLIERS = 4
export const MIN_QUOTES = 3          // แนวปฏิบัติจัดซื้อ: ใบเสนอราคาครบอย่างน้อย 3 ราย ไม่งั้นต้องระบุเหตุผล
export const VAT_RATE = 0.07
export type PcVatMode = "excl" | "incl" | "none"
export const VAT_MODE_LABEL: Record<PcVatMode, string> = { excl: "ราคาก่อน VAT", incl: "ราคารวม VAT แล้ว", none: "ไม่มี VAT" }

// ตำแหน่งกรรมการ 4 ช่องตามฟอร์ม (ซ้าย→ขวา)
export const DEFAULT_COMMITTEE_ROLES = [
  "หัวหน้าฝ่ายยานยนต์",
  "ผจก.ฝ่ายยานยนต์",
  "ผจก.ฝ่ายจัดซื้อ",
  "ผู้อำนวยการสายงานธุรกิจ",
]

export type PcFile = { mediaId: number; batchId: string; filename: string; webpUrl: string; thumbnailUrl: string }
export type PcItem = { name: string; qty: number; unit: string }
export type PcConditions = {
  payment: string; leadTime: string; warranty: string; remark: string
  bays: string; menaTrucksIn: string; statusA: string; statusB: string
}
export type PcSupplier = {
  name: string; garageId?: string; note: string
  prices: (number | null)[]; discount: number
  vatMode: PcVatMode          // ฐานราคาที่เสนอ — เทียบกันที่ "สุทธิที่ต้องจ่ายจริง"
  quoteDate: string; validUntil: string   // YYYY-MM-DD
  conditions: PcConditions; quotationFiles: PcFile[]
}
export type PcCommittee = { role: string; name: string; email?: string; pickedSupplier: number | null; reason: string; signedDate: string }
export type PcLinks = { prCode?: string; plate?: string; fleetNo?: string; repairExternalId?: string }
export type PriceCompare = {
  _id?: string
  docNo: string; title: string; requestDept: string
  preparedBy: { name: string; email: string }
  revision: number; createdAt: string; updatedAt: string
  status: PcStatus
  items: PcItem[]; suppliers: PcSupplier[]; committee: PcCommittee[]
  selectedSupplier: number | null
  selectionReason: string      // บังคับเมื่อรายที่เลือกไม่ใช่สุทธิต่ำสุด
  fewerQuotesReason: string    // บังคับเมื่อ supplier ที่ราคาครบ < MIN_QUOTES
  links: PcLinks; evidenceFiles: PcFile[]
  createdBy: string; editedBy: string
}
export type PcTotals = { subtotal: number; discount: number; afterDiscount: number; vat: number; net: number }

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

export function emptyConditions(): PcConditions {
  return { payment: "", leadTime: "", warranty: "", remark: "", bays: "", menaTrucksIn: "", statusA: "", statusB: "" }
}
export function emptySupplier(itemCount: number): PcSupplier {
  return { name: "", note: "", prices: Array(itemCount).fill(null), discount: 0, vatMode: "excl", quoteDate: "", validUntil: "", conditions: emptyConditions(), quotationFiles: [] }
}
export function emptyCommittee(): PcCommittee[] {
  return DEFAULT_COMMITTEE_ROLES.map((role) => ({ role, name: "", email: "", pickedSupplier: null, reason: "", signedDate: "" }))
}
export function newDoc(preparedBy: { name: string; email: string }): Omit<PriceCompare, "_id" | "docNo" | "createdAt" | "updatedAt"> {
  return {
    title: "", requestDept: "", preparedBy, revision: 0, status: "ร่าง",
    items: [{ name: "", qty: 1, unit: "" }],
    suppliers: [emptySupplier(1)],
    committee: emptyCommittee(),
    selectedSupplier: null, selectionReason: "", fewerQuotesReason: "", links: {}, evidenceFiles: [],
    createdBy: preparedBy.name, editedBy: preparedBy.name,
  }
}

export function lineTotal(item: PcItem, price: number | null): number | null {
  if (price == null || !isFinite(price)) return null
  return round2(item.qty * price)
}

export function supplierTotals(doc: Pick<PriceCompare, "items" | "suppliers">, idx: number): PcTotals {
  const s = doc.suppliers[idx]
  if (!s) return { subtotal: 0, discount: 0, afterDiscount: 0, vat: 0, net: 0 }
  let subtotal = 0
  doc.items.forEach((it, i) => { const lt = lineTotal(it, s.prices[i] ?? null); if (lt != null) subtotal += lt })
  subtotal = round2(subtotal)
  const discount = round2(s.discount || 0)
  const afterDiscount = round2(subtotal - discount)
  // ฐาน VAT ต่างกันต้อง normalize ก่อนเทียบ: excl บวก 7%, incl ถอด VAT ออกมาแสดงแต่สุทธิเท่าเดิม, none ไม่มี VAT
  if (s.vatMode === "incl") {
    const vat = round2(afterDiscount - afterDiscount / (1 + VAT_RATE))
    return { subtotal, discount, afterDiscount, vat, net: afterDiscount }
  }
  if (s.vatMode === "none") return { subtotal, discount, afterDiscount, vat: 0, net: afterDiscount }
  const vat = round2(afterDiscount * VAT_RATE)
  const net = round2(afterDiscount + vat)
  return { subtotal, discount, afterDiscount, vat, net }
}

// index ของ supplier ที่ราคาต่อหน่วยต่ำสุดในแต่ละแถว (เฉพาะรายที่เสนอราคา) — null ถ้าไม่มีใครเสนอ
export function lowestPerLine(doc: Pick<PriceCompare, "items" | "suppliers">): (number | null)[] {
  return doc.items.map((_, i) => {
    let best: number | null = null, bestPrice = Infinity
    doc.suppliers.forEach((s, si) => {
      const p = s.prices[i]
      if (p != null && p < bestPrice) { bestPrice = p; best = si }
    })
    return best
  })
}

// index ของ supplier ที่สุทธิต่ำสุด — นับเฉพาะรายที่มีราคาอย่างน้อย 1 รายการ
export function lowestNet(doc: Pick<PriceCompare, "items" | "suppliers">): number | null {
  let best: number | null = null, bestNet = Infinity
  doc.suppliers.forEach((s, si) => {
    if (!s.prices.some((p) => p != null)) return
    const { net } = supplierTotals(doc, si)
    if (net < bestNet) { bestNet = net; best = si }
  })
  return best
}

const supplierPricesComplete = (doc: Pick<PriceCompare, "items">, s: PcSupplier) =>
  doc.items.length > 0 && doc.items.every((_, i) => s.prices[i] != null)

/** supplier ที่มีชื่อและราคาครบทุกแถว — นับเป็น "ใบเสนอราคาที่ใช้เทียบได้" */
export function completeSupplierCount(doc: Pick<PriceCompare, "items" | "suppliers">): number {
  return doc.suppliers.filter((s) => s.name.trim() && supplierPricesComplete(doc, s)).length
}

/** ใบเสนอราคาหมดอายุเมื่อ validUntil < วันนี้ (ไม่ระบุ = ไม่เตือน) */
export const isQuoteExpired = (s: Pick<PcSupplier, "validUntil">, today: string): boolean =>
  !!s.validUntil && s.validUntil.slice(0, 10) < today.slice(0, 10)

export function isComplete(doc: PriceCompare, opts: { requireCommitteeNames?: boolean } = {}): { ok: boolean; missing: string[] } {
  const requireNames = opts.requireCommitteeNames ?? true
  const missing: string[] = []
  if (doc.items.length === 0) missing.push("รายการ")
  const full = completeSupplierCount(doc)
  if (full < 1) missing.push("supplier อย่างน้อย 1 รายที่มีราคาครบทุกแถว")
  else if (full < MIN_QUOTES && !doc.fewerQuotesReason.trim()) missing.push(`ใบเสนอราคาครบ ${MIN_QUOTES} ราย หรือระบุเหตุผลที่มีน้อยกว่า ${MIN_QUOTES} ราย`)
  if (requireNames && doc.committee.some((m) => !m.name.trim())) missing.push("ชื่อกรรมการ")
  if (doc.selectedSupplier == null) missing.push("ผู้ได้รับเลือก")
  else {
    const low = lowestNet(doc)
    if (low != null && doc.selectedSupplier !== low + 1 && !doc.selectionReason.trim()) missing.push("เหตุผลที่ไม่เลือกรายสุทธิต่ำสุด")
  }
  return { ok: missing.length === 0, missing }
}

export function canTransition(from: PcStatus, to: PcStatus, doc: PriceCompare): { ok: boolean; reason?: string } {
  if (from === to) return { ok: true }
  if (from === "ร่าง" && to === "รอลงนาม") {
    const r = isComplete(doc, { requireCommitteeNames: false })
    return r.ok ? { ok: true } : { ok: false, reason: `ยังขาด: ${r.missing.join(", ")}` }
  }
  if (from === "รอลงนาม" && to === "เสร็จสิ้น") {
    if (doc.selectedSupplier == null) return { ok: false, reason: "ยังไม่เลือกผู้ได้รับเลือก" }
    if (doc.committee.some((m) => !m.name.trim() || !m.signedDate)) return { ok: false, reason: "ชื่อและวันที่ลงนามของกรรมการยังไม่ครบ 4 ช่อง" }
    return { ok: true }
  }
  if (from === "รอลงนาม" && to === "ร่าง") return { ok: true }
  if (from === "เสร็จสิ้น" && to === "รอลงนาม") return { ok: true }   // เปิดแก้ไข
  return { ok: false, reason: `เปลี่ยนสถานะจาก ${from} เป็น ${to} ไม่ได้` }
}

/* ---------- normalize / validate ---------- */
const str = (v: unknown): string => (v == null ? "" : String(v)).trim()
const num = (v: unknown, dflt = 0): number => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, "")); return isFinite(n) ? n : dflt }
const numOrNull = (v: unknown): number | null => { if (v === "" || v == null) return null; const n = num(v, NaN); return isFinite(n) ? n : null }
const files = (v: unknown): PcFile[] => Array.isArray(v)
  ? v.filter((f) => f && typeof f === "object" && f.mediaId != null).map((f) => ({
      mediaId: Number(f.mediaId), batchId: str(f.batchId), filename: str(f.filename), webpUrl: str(f.webpUrl), thumbnailUrl: str(f.thumbnailUrl),
    }))
  : []
const intInRange = (v: unknown, max: number): number | null => { const n = numOrNull(v); return n != null && Number.isInteger(n) && n >= 1 && n <= max ? n : (n == null ? null : n) }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeDoc(input: unknown): PriceCompare {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, any>
  const items: PcItem[] = (Array.isArray(b.items) ? b.items : []).map((it: any) => ({ name: str(it?.name), qty: num(it?.qty, 0), unit: str(it?.unit) }))
  const suppliers: PcSupplier[] = (Array.isArray(b.suppliers) ? b.suppliers : []).slice(0, MAX_SUPPLIERS).map((s: any) => {
    const c = s?.conditions ?? {}
    const prices = Array.isArray(s?.prices) ? s.prices.map(numOrNull) : []
    return {
      name: str(s?.name), garageId: s?.garageId ? str(s.garageId) : undefined, note: str(s?.note),
      prices: items.map((_, i) => prices[i] ?? null),
      discount: num(s?.discount, 0),
      vatMode: (["excl", "incl", "none"] as PcVatMode[]).includes(s?.vatMode) ? (s.vatMode as PcVatMode) : "excl",
      quoteDate: str(s?.quoteDate).slice(0, 10), validUntil: str(s?.validUntil).slice(0, 10),
      conditions: { ...emptyConditions(), ...Object.fromEntries(Object.keys(emptyConditions()).map((k) => [k, str(c[k])])) } as PcConditions,
      quotationFiles: files(s?.quotationFiles),
    }
  })
  const rawCommittee: any[] = Array.isArray(b.committee) ? b.committee : []
  const committee: PcCommittee[] = DEFAULT_COMMITTEE_ROLES.map((role, i) => {
    const m = rawCommittee[i] ?? {}
    return { role: str(m.role) || role, name: str(m.name), email: str(m.email), pickedSupplier: intInRange(m.pickedSupplier, MAX_SUPPLIERS), reason: str(m.reason), signedDate: str(m.signedDate).slice(0, 10) }
  })
  const status: PcStatus = PC_STATUSES.includes(b.status) ? b.status : "ร่าง"
  const l = b.links ?? {}
  return {
    ...(b._id ? { _id: String(b._id) } : {}),
    docNo: str(b.docNo), title: str(b.title), requestDept: str(b.requestDept),
    preparedBy: { name: str(b.preparedBy?.name), email: str(b.preparedBy?.email) },
    revision: Math.max(0, Math.floor(num(b.revision, 0))),
    createdAt: str(b.createdAt), updatedAt: str(b.updatedAt), status,
    items, suppliers, committee,
    selectedSupplier: intInRange(b.selectedSupplier, MAX_SUPPLIERS),
    selectionReason: str(b.selectionReason), fewerQuotesReason: str(b.fewerQuotesReason),
    links: { prCode: str(l.prCode) || undefined, plate: str(l.plate) || undefined, fleetNo: str(l.fleetNo) || undefined, repairExternalId: str(l.repairExternalId) || undefined },
    evidenceFiles: files(b.evidenceFiles),
    createdBy: str(b.createdBy), editedBy: str(b.editedBy),
  }
}

export function validateDoc(doc: PriceCompare): string[] {
  const errs: string[] = []
  if (doc.items.length === 0) errs.push("ต้องมีรายการอย่างน้อย 1 แถว")
  doc.items.forEach((it, i) => { if (!(it.qty > 0)) errs.push(`รายการที่ ${i + 1}: จำนวนต้องมากกว่า 0`) })
  if (doc.suppliers.length === 0) errs.push("ต้องมี supplier อย่างน้อย 1 ราย")
  if (doc.suppliers.length > MAX_SUPPLIERS) errs.push(`supplier ได้สูงสุด ${MAX_SUPPLIERS} ราย`)
  doc.suppliers.forEach((s, i) => {
    if (s.prices.length !== doc.items.length) errs.push(`Supplier ${i + 1}: จำนวนช่องราคาไม่ตรงกับรายการ`)
    if (s.prices.some((p) => p != null && p < 0)) errs.push(`Supplier ${i + 1}: ราคาติดลบไม่ได้`)
    if (s.discount < 0) errs.push(`Supplier ${i + 1}: ส่วนลดติดลบไม่ได้`)
  })
  const n = doc.suppliers.length
  if (doc.selectedSupplier != null && (doc.selectedSupplier < 1 || doc.selectedSupplier > n)) errs.push(`ผู้ได้รับเลือกต้องอยู่ระหว่าง Supplier 1–${n}`)
  doc.committee.forEach((m, i) => {
    if (m.pickedSupplier != null && (m.pickedSupplier < 1 || m.pickedSupplier > n)) errs.push(`กรรมการช่องที่ ${i + 1}: เลือก supplier ลำดับที่ ${m.pickedSupplier} ซึ่งไม่มี`)
  })
  return errs
}

/* ---------- เลขที่เอกสาร PC-YYMM-NNN (YY = ค.ศ. 2 หลักท้าย ตามฟอร์มต้นแบบ PC-2609-002 = ก.ย. 2026) ---------- */
function yymm(bkkDate: string): string {
  return `${bkkDate.slice(2, 4)}${bkkDate.slice(5, 7)}`
}
export const docNoFor = (bkkDate: string, seq: number): string => `PC-${yymm(bkkDate)}-${String(seq).padStart(3, "0")}`
export const counterKeyFor = (bkkDate: string): string => `price_compare:${yymm(bkkDate)}`

export const fmtMoney = (n: number | null | undefined): string =>
  n == null ? "" : n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
```

- [ ] **Step 4: รัน test ให้ผ่าน**

Run: `cd ~/Documents/project/master-sku-web && npx tsx scripts/check-price-compare-core.ts`
Expected: `check-price-compare-core: OK`

ถ้า assert เรื่อง `subtotal 50690.08 / vat 3548.31 / net 54238.39` ไม่ตรง ให้ตรวจว่า `lineTotal` ปัดรายแถวก่อนรวม (18 × 110.56 = 1990.08) — ห้ามแก้ค่าที่คาดหวังให้ตรงกับฟอร์มกระดาษ (ฟอร์มปัดมือ)

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/project/master-sku-web && git pull --rebase --autostash
git add lib/price-compare.ts scripts/check-price-compare-core.ts
git commit -m "price-compare: core logic (types, totals, validate, docNo) + check script"
```

---

### Task 2: DB helpers — `nextDocNo`, log, indexes

**Files:**
- Create: `lib/price-compare-db.ts`, `lib/price-compare-log.ts`, `scripts/ensure-price-compare-indexes.mjs`
- Test: ต่อท้าย `scripts/check-price-compare-core.ts` (เฉพาะ diff ซึ่ง pure); `nextDocNo` ทดสอบผ่าน API ใน Task 3

**Interfaces:**
- Consumes: `docNoFor`, `counterKeyFor`, `PriceCompare` จาก Task 1
- Produces:
  ```ts
  // lib/price-compare-db.ts
  export const PC_COLL = "price_compare"
  export const PC_COUNTER_COLL = "counters"
  export async function nextDocNo(db: Db, bkkDate: string): Promise<string>
  // lib/price-compare-log.ts
  export const PC_LOG_COLL = "price_compare_log"
  export type PcChange = { field: string; label: string; from: string; to: string }
  export type PcLogEntry = { docId: string; docNo: string; action: "create" | "update" | "delete" | "status"; by: string; byEmail: string; at: Date; statusChange?: { from: string; to: string }; changes?: PcChange[] }
  export function diffPriceCompare(oldDoc: PriceCompare, newDoc: PriceCompare): PcChange[]
  export async function writePcLog(db: Db, entry: PcLogEntry): Promise<void>
  ```

- [ ] **Step 1: เพิ่ม test diff ต่อท้าย check script**

ต่อท้าย `scripts/check-price-compare-core.ts` ก่อนบรรทัด `console.log("check-price-compare-core: OK")`:

```ts
// --- diffPriceCompare (lib/price-compare-log.ts — pure ส่วน diff) ---
import { diffPriceCompare } from "../lib/price-compare-log"
{
  const a = uh03(), b = uh03()
  b.title = "Pump UH03"; b.status = "รอลงนาม"; b.selectedSupplier = 1
  b.items.push({ name: "เพิ่ม", qty: 1, unit: "ชิ้น" }); b.suppliers.forEach((s) => s.prices.push(null))
  b.suppliers.pop(); b.links.prCode = "LBPR26090001"
  const ch = diffPriceCompare(a, b)
  const f = (name: string) => ch.find((c) => c.field === name)
  assert.deepEqual(f("title"), { field: "title", label: "ชื่อสินค้า/งานซ่อม", from: "Pump + Motor UH03", to: "Pump UH03" })
  assert.equal(f("status")?.to, "รอลงนาม")
  assert.deepEqual(f("selectedSupplier"), { field: "selectedSupplier", label: "ผู้ได้รับเลือก", from: "", to: "Supplier 1 (ช่างหมู)" })
  assert.deepEqual(f("items"), { field: "items", label: "รายการ", from: "5 แถว", to: "6 แถว" })
  assert.deepEqual(f("suppliers"), { field: "suppliers", label: "Supplier", from: "3 ราย", to: "2 ราย" })
  assert.deepEqual(f("links.prCode"), { field: "links.prCode", label: "PR", from: "", to: "LBPR26090001" })
  assert.equal(ch.length, 6, "แก้ราคารายช่องต้องไม่ขึ้นใน log (selectionReason/fewerQuotesReason ไม่เปลี่ยน)")
  assert.deepEqual(diffPriceCompare(a, a), [])
}
```

หมายเหตุ: ต้องย้าย `import { diffPriceCompare }` ไปรวมกับ import ด้านบนไฟล์ (ESM ไม่ให้ import กลางไฟล์)

- [ ] **Step 2: รัน test ให้เห็นว่าไม่ผ่าน**

Run: `npx tsx scripts/check-price-compare-core.ts`
Expected: FAIL — `Cannot find module '../lib/price-compare-log'`

- [ ] **Step 3: เขียน `lib/price-compare-log.ts`**

```ts
// lib/price-compare-log.ts — audit log ของใบเทียบราคา (รูปแบบเดียวกับ lib/repair-log.ts)
import type { Db } from "mongodb"
import type { PriceCompare } from "./price-compare"

export const PC_LOG_COLL = "price_compare_log"

export type PcChange = { field: string; label: string; from: string; to: string }
export type PcLogEntry = {
  docId: string; docNo: string
  action: "create" | "update" | "delete" | "status"
  by: string; byEmail: string; at: Date
  statusChange?: { from: string; to: string }
  changes?: PcChange[]
}

const TOP_LABELS: Record<string, string> = {
  title: "ชื่อสินค้า/งานซ่อม",
  requestDept: "หน่วยงานที่ร้องขอ",
  status: "สถานะ",
  selectedSupplier: "ผู้ได้รับเลือก",
  selectionReason: "เหตุผลที่เลือก",
  fewerQuotesReason: "เหตุผลที่มีใบเสนอราคาน้อยกว่า 3 ราย",
  "links.prCode": "PR",
  "links.plate": "ทะเบียนรถ",
  "links.fleetNo": "เบอร์รถ",
}

const supplierLabel = (doc: PriceCompare, n: number | null): string =>
  n == null ? "" : `Supplier ${n}${doc.suppliers[n - 1]?.name ? ` (${doc.suppliers[n - 1].name})` : ""}`

// diff เฉพาะฟิลด์ระดับบน + สรุปจำนวนแถว/ราย — ไม่ diff ราคารายช่องเพื่อไม่ให้ log รก
export function diffPriceCompare(a: PriceCompare, b: PriceCompare): PcChange[] {
  const out: PcChange[] = []
  const get = (d: PriceCompare, f: string): string => {
    if (f === "selectedSupplier") return supplierLabel(d, d.selectedSupplier)
    if (f.startsWith("links.")) return String(d.links[f.slice(6) as keyof PriceCompare["links"]] ?? "")
    return String((d as unknown as Record<string, unknown>)[f] ?? "")
  }
  for (const f of Object.keys(TOP_LABELS)) {
    const from = get(a, f), to = get(b, f)
    if (from !== to) out.push({ field: f, label: TOP_LABELS[f], from, to })
  }
  if (a.items.length !== b.items.length) out.push({ field: "items", label: "รายการ", from: `${a.items.length} แถว`, to: `${b.items.length} แถว` })
  if (a.suppliers.length !== b.suppliers.length) out.push({ field: "suppliers", label: "Supplier", from: `${a.suppliers.length} ราย`, to: `${b.suppliers.length} ราย` })
  return out
}

export async function writePcLog(db: Db, entry: PcLogEntry): Promise<void> {
  await db.collection(PC_LOG_COLL).insertOne(entry)
}
```

- [ ] **Step 4: เขียน `lib/price-compare-db.ts`**

```ts
// lib/price-compare-db.ts — ส่วนที่ต้องแตะ Mongo ของใบเทียบราคา
import type { Db } from "mongodb"
import { docNoFor, counterKeyFor } from "./price-compare"

export const PC_COLL = "price_compare"
export const PC_COUNTER_COLL = "counters"

/** ออกเลขที่ PC-YYMM-NNN แบบ atomic — ลบใบแล้วเลขข้ามไป ไม่นำกลับมาใช้ */
export async function nextDocNo(db: Db, bkkDate: string): Promise<string> {
  const r = await db.collection<{ _id: string; seq: number }>(PC_COUNTER_COLL).findOneAndUpdate(
    { _id: counterKeyFor(bkkDate) },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  )
  const seq = r?.seq ?? 1
  return docNoFor(bkkDate, seq)
}
```

- [ ] **Step 5: เขียน `scripts/ensure-price-compare-indexes.mjs`**

```js
// scripts/ensure-price-compare-indexes.mjs — รันมือครั้งเดียว: node scripts/ensure-price-compare-indexes.mjs
import { MongoClient } from "mongodb"
import fs from "node:fs"

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")] }))
const client = new MongoClient(env.MONGO_URI)
await client.connect()
const db = client.db(env.MONGO_DB || "master_data")
console.log(await db.collection("price_compare").createIndex({ docNo: 1 }, { unique: true }))
console.log(await db.collection("price_compare").createIndex({ status: 1, updatedAt: -1 }))
console.log(await db.collection("price_compare_log").createIndex({ docId: 1, at: -1 }))
await client.close()
```

- [ ] **Step 6: รัน test + typecheck**

Run: `npx tsx scripts/check-price-compare-core.ts && npx tsc --noEmit -p . 2>&1 | grep -E "price-compare" ; echo done`
Expected: `check-price-compare-core: OK` และไม่มี error ที่ไฟล์ price-compare

- [ ] **Step 7: รัน index script (ถามผู้ใช้ก่อน — แตะ DB prod)**

หยุดและถามผู้ใช้ก่อนรัน `node scripts/ensure-price-compare-indexes.mjs` (สร้าง index บน collection ว่าง ใช้เวลาไม่ถึงวินาที แต่เป็น prod DB) ถ้ายังไม่อนุมัติ ข้ามไปทำ task ถัดไปแล้วกลับมาทีหลัง

- [ ] **Step 8: Commit**

```bash
git add lib/price-compare-db.ts lib/price-compare-log.ts scripts/ensure-price-compare-indexes.mjs scripts/check-price-compare-core.ts
git commit -m "price-compare: docNo counter, audit log diff, index script"
```

---

### Task 3: API — list / create / get / put / delete / log

**Files:**
- Create: `app/api/price-compare/route.ts`, `app/api/price-compare/[id]/route.ts`, `app/api/price-compare/[id]/log/route.ts`
- Test: `scripts/check-price-compare-api.sh` (curl ต่อ dev server ด้วย cookie session)

**Interfaces:**
- Consumes: Task 1 (`normalizeDoc, validateDoc, canTransition, newDoc, PriceCompare`), Task 2 (`PC_COLL, nextDocNo, diffPriceCompare, writePcLog, PC_LOG_COLL`)
- Produces: HTTP API ตาม spec ข้อ 5. Response ของ GET/POST/PUT `[id]` = เอกสารเต็มที่ `_id` เป็น string. List item = `{ _id, docNo, title, requestDept, status, preparedBy, updatedAt, revision, supplierCount, selectedSupplier, selectedNet, lowestNet }`

- [ ] **Step 1: เขียน `app/api/price-compare/route.ts`**

```ts
// app/api/price-compare/route.ts — รายการ + สร้างใบเทียบราคา
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { bkkToday, toBkkIso } from "@/lib/bkk-time"
import { newDoc, normalizeDoc, supplierTotals, lowestNet, type PriceCompare } from "@/lib/price-compare"
import { PC_COLL, nextDocNo } from "@/lib/price-compare-db"
import { writePcLog } from "@/lib/price-compare-log"

const DB = process.env.MONGO_DB ?? "master_data"
export const dynamic = "force-dynamic"

async function requireSession() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  return { name: session.user.name || session.user.email || "", email: session.user.email || "" }
}

// GET /api/price-compare?status=&month=YYMM&q=&limit=
export async function GET(req: NextRequest) {
  const me = await requireSession()
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const status = sp.get("status")?.trim() || ""
  const month  = sp.get("month")?.trim() || ""       // "2609"
  const q      = sp.get("q")?.trim() || ""
  const limit  = Math.min(parseInt(sp.get("limit") ?? "500", 10) || 500, 2000)

  const filter: Record<string, unknown> = {}
  if (status) filter.status = status
  if (month) filter.docNo = { $regex: `^PC-${month}-` }
  if (q) {
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" }
    filter.$or = [{ docNo: rx }, { title: rx }, { "suppliers.name": rx }, { requestDept: rx }]
  }
  const client = await clientPromise
  const rows = await client.db(DB).collection(PC_COLL).find(filter).sort({ updatedAt: -1 }).limit(limit).toArray()
  const items = rows.map((r) => {
    const d = normalizeDoc(r)
    const li = lowestNet(d)
    return {
      _id: String(r._id), docNo: d.docNo, title: d.title, requestDept: d.requestDept, status: d.status,
      preparedBy: d.preparedBy, updatedAt: d.updatedAt, createdAt: d.createdAt, revision: d.revision,
      supplierCount: d.suppliers.length, selectedSupplier: d.selectedSupplier,
      selectedName: d.selectedSupplier ? d.suppliers[d.selectedSupplier - 1]?.name ?? "" : "",
      selectedNet: d.selectedSupplier ? supplierTotals(d, d.selectedSupplier - 1).net : null,
      lowestNet: li == null ? null : supplierTotals(d, li).net,
    }
  })
  return NextResponse.json(items)
}

// POST /api/price-compare — สร้างใบใหม่ (ออกเลขที่ทันที)
export async function POST(req: NextRequest) {
  const me = await requireSession()
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const base = normalizeDoc({ ...newDoc(me), ...body, preparedBy: me, status: "ร่าง", revision: 0, createdBy: me.name, editedBy: me.name })

  const client = await clientPromise
  const db = client.db(DB)
  const now = new Date()
  const doc: Omit<PriceCompare, "_id"> = { ...base, docNo: await nextDocNo(db, bkkToday()), createdAt: toBkkIso(now), updatedAt: toBkkIso(now) }
  delete (doc as { _id?: string })._id
  const r = await db.collection(PC_COLL).insertOne(doc)
  await writePcLog(db, { docId: String(r.insertedId), docNo: doc.docNo, action: "create", by: me.name, byEmail: me.email, at: now, statusChange: { from: "", to: "ร่าง" } })
  return NextResponse.json({ ...doc, _id: String(r.insertedId) }, { status: 201 })
}
```

- [ ] **Step 2: เขียน `app/api/price-compare/[id]/route.ts`**

```ts
// app/api/price-compare/[id]/route.ts — อ่าน/บันทึก/ลบ ใบเทียบราคา
import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { toBkkIso } from "@/lib/bkk-time"
import { normalizeDoc, validateDoc, canTransition, type PriceCompare } from "@/lib/price-compare"
import { PC_COLL } from "@/lib/price-compare-db"
import { diffPriceCompare, writePcLog } from "@/lib/price-compare-log"

const DB = process.env.MONGO_DB ?? "master_data"
type Params = { params: Promise<{ id: string }> }

async function me() {
  const s = await getServerSession(authOptions)
  return s?.user ? { name: s.user.name || s.user.email || "", email: s.user.email || "" } : null
}
const oid = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null)

export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await me())) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const _id = oid(id)
  if (!_id) return NextResponse.json({ error: "bad id" }, { status: 400 })
  const raw = await (await clientPromise).db(DB).collection(PC_COLL).findOne({ _id })
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json(normalizeDoc(raw))
}

// PUT — บันทึกทั้งเอกสาร (docNo/preparedBy/createdAt/revision จัดการโดย server)
export async function PUT(req: NextRequest, { params }: Params) {
  const user = await me()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const _id = oid(id)
  if (!_id) return NextResponse.json({ error: "bad id" }, { status: 400 })
  const db = (await clientPromise).db(DB)
  const col = db.collection(PC_COLL)
  const raw = await col.findOne({ _id })
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 })
  const before = normalizeDoc(raw)

  const body = await req.json().catch(() => ({}))
  const next = normalizeDoc({ ...body, _id: id, docNo: before.docNo, preparedBy: before.preparedBy, createdAt: before.createdAt, createdBy: before.createdBy })
  const errs = validateDoc(next)
  if (errs.length) return NextResponse.json({ error: errs.join(" · "), errors: errs }, { status: 400 })
  const tr = canTransition(before.status, next.status, next)
  if (!tr.ok) return NextResponse.json({ error: tr.reason ?? "เปลี่ยนสถานะไม่ได้" }, { status: 400 })

  const now = new Date()
  next.updatedAt = toBkkIso(now)
  next.editedBy = user.name
  next.revision = before.status === "ร่าง" ? before.revision : before.revision + 1
  const { _id: _drop, ...toSave } = next
  void _drop
  await col.replaceOne({ _id }, toSave as Omit<PriceCompare, "_id">)

  const changes = diffPriceCompare(before, next)
  await writePcLog(db, {
    docId: id, docNo: next.docNo, action: before.status !== next.status ? "status" : "update",
    by: user.name, byEmail: user.email, at: now, changes,
    ...(before.status !== next.status ? { statusChange: { from: before.status, to: next.status } } : {}),
  })
  return NextResponse.json(next)
}

// DELETE — ลบได้เฉพาะสถานะร่าง
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await me()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const _id = oid(id)
  if (!_id) return NextResponse.json({ error: "bad id" }, { status: 400 })
  const db = (await clientPromise).db(DB)
  const raw = await db.collection(PC_COLL).findOne({ _id })
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (raw.status !== "ร่าง") return NextResponse.json({ error: "ลบได้เฉพาะใบสถานะร่าง" }, { status: 400 })
  await db.collection(PC_COLL).deleteOne({ _id })
  await writePcLog(db, { docId: id, docNo: String(raw.docNo ?? ""), action: "delete", by: user.name, byEmail: user.email, at: new Date() })
  return NextResponse.json({ ok: true })
}
```

หมายเหตุ: route file ห้าม export ชื่ออื่นนอกจาก HTTP handlers/config — Next จะ build ไม่ผ่าน

- [ ] **Step 3: เขียน `app/api/price-compare/[id]/log/route.ts`**

```ts
// app/api/price-compare/[id]/log/route.ts — ประวัติของใบ (ใหม่→เก่า)
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { PC_LOG_COLL } from "@/lib/price-compare-log"

const DB = process.env.MONGO_DB ?? "master_data"
type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const items = await (await clientPromise).db(DB).collection(PC_LOG_COLL).find({ docId: id }).sort({ at: -1 }).limit(300).toArray()
  return NextResponse.json(items.map((i) => ({ ...i, _id: String(i._id) })))
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "price-compare" ; echo done`
Expected: ไม่มี error

- [ ] **Step 5: ทดสอบ API ผ่าน dev server**

เริ่ม dev server: `npm run dev` (port 3000) แล้วล็อกอินในเบราว์เซอร์ คัดลอกค่า cookie `next-auth.session-token` (หรือ `__Secure-next-auth.session-token`) มาใส่ตัวแปร `TOKEN` ให้สคริปต์นี้:

```bash
# scripts/check-price-compare-api.sh — รัน: TOKEN=<cookie> bash scripts/check-price-compare-api.sh
set -e
H="Cookie: next-auth.session-token=$TOKEN"
B=http://localhost:3000/api/price-compare
echo "== no session → 401"; curl -s -o /dev/null -w "%{http_code}\n" $B | grep -q 401
echo "== create"; NEW=$(curl -s -H "$H" -H "Content-Type: application/json" -X POST $B -d '{"title":"ทดสอบ API"}')
echo "$NEW" | grep -q '"docNo":"PC-'
ID=$(echo "$NEW" | sed -E 's/.*"_id":"([a-f0-9]+)".*/\1/')
echo "id=$ID"
echo "== get"; curl -s -H "$H" $B/$ID | grep -q '"title":"ทดสอบ API"'
echo "== put invalid (qty 0) → 400"
curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -H "Content-Type: application/json" -X PUT $B/$ID -d '{"title":"x","items":[{"name":"a","qty":0,"unit":"ชิ้น"}],"suppliers":[{"name":"s","prices":[1]}]}' | grep -q 400
echo "== put ok"
curl -s -H "$H" -H "Content-Type: application/json" -X PUT $B/$ID -d '{"title":"แก้แล้ว","items":[{"name":"a","qty":2,"unit":"ชิ้น"}],"suppliers":[{"name":"s1","prices":[100]},{"name":"s2","prices":[90]}],"selectedSupplier":2,"status":"ร่าง"}' | grep -q '"title":"แก้แล้ว"'
echo "== status ร่าง→รอลงนาม"
curl -s -H "$H" -H "Content-Type: application/json" -X PUT $B/$ID -d '{"title":"แก้แล้ว","items":[{"name":"a","qty":2,"unit":"ชิ้น"}],"suppliers":[{"name":"s1","prices":[100]},{"name":"s2","prices":[90]}],"selectedSupplier":2,"fewerQuotesReason":"ทดสอบ 2 ราย","status":"รอลงนาม"}' | grep -q '"status":"รอลงนาม"'
echo "== delete non-draft → 400"; curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -X DELETE $B/$ID | grep -q 400
echo "== back to draft + delete"
curl -s -H "$H" -H "Content-Type: application/json" -X PUT $B/$ID -d '{"title":"แก้แล้ว","items":[{"name":"a","qty":2,"unit":"ชิ้น"}],"suppliers":[{"name":"s1","prices":[100]},{"name":"s2","prices":[90]}],"selectedSupplier":2,"status":"ร่าง"}' >/dev/null
curl -s -H "$H" -X DELETE $B/$ID | grep -q '"ok":true'
echo "== log has ≥4 entries"; test "$(curl -s -H "$H" $B/$ID/log | grep -o '"action"' | wc -l)" -ge 4
echo "check-price-compare-api: OK"
```

Run: `TOKEN=... bash scripts/check-price-compare-api.sh`
Expected: `check-price-compare-api: OK`

- [ ] **Step 6: Commit**

```bash
git add app/api/price-compare scripts/check-price-compare-api.sh
git commit -m "price-compare: REST API (list/create/get/put/delete/log) with session guard"
```

---

### Task 4: PDF infrastructure — pdfmake printer, ฟอนต์ Sarabun, deps, tracing

**Files:**
- Create: `lib/pdfmake-printer.ts`, `fonts/Sarabun-Regular.ttf`, `fonts/Sarabun-Bold.ttf`, `fonts/Sarabun-Italic.ttf`, `fonts/Sarabun-BoldItalic.ttf`, `fonts/mena-logo.jpg`
- Modify: `package.json`, `next.config.ts`
- Test: `scripts/check-pdfmake-printer.ts`

**Interfaces:**
- Consumes: ไม่มี
- Produces:
  ```ts
  export async function renderPdfmake(docDefinition: any): Promise<Buffer>
  export function seg(s: string | null | undefined): string      // ตัดคำไทย + แก้สระอำ สำหรับข้อความไทย
  export function fixThaiMarks(s: string): string
  ```

- [ ] **Step 1: ติดตั้ง deps + คัดลอกฟอนต์**

```bash
cd ~/Documents/project/master-sku-web
npm install pdfmake@^0.3.11 pdf-lib@^1.17.1 sharp@^0.34.5
npm install -D @types/pdfmake@^0.3.3
mkdir -p fonts
cp ~/Documents/project/mena-partner-driver/fonts/Sarabun-*.ttf fonts/
cp ~/Documents/project/mena-partner-driver/fonts/mena-logo.jpg fonts/
ls fonts   # ต้องเห็น Sarabun 4 ไฟล์ + mena-logo.jpg
```

- [ ] **Step 2: เขียน test**

```ts
// scripts/check-pdfmake-printer.ts — รัน: npx tsx scripts/check-pdfmake-printer.ts
import assert from "node:assert/strict"
import fs from "node:fs"
import { renderPdfmake, seg, fixThaiMarks } from "../lib/pdfmake-printer"

assert.equal(fixThaiMarks("ค้ำ"), "คํ้า")
assert.ok(seg("ผู้จัดทำ").includes("ผู้จัด"), "ผู้ ต้องไม่ถูกแยกจากคำถัดไป")
assert.equal(seg(""), "")

const pdf = await renderPdfmake({
  pageSize: "A4", pageOrientation: "landscape",
  defaultStyle: { font: "Sarabun", fontSize: 10 },
  content: [{ text: seg("แบบบันทึกผลการเปรียบเทียบราคา — ทดสอบฟอนต์ไทย น้ำมันเกียร์ ค้ำประกัน"), bold: true }],
})
assert.ok(pdf.length > 1000)
assert.equal(pdf.subarray(0, 5).toString(), "%PDF-")
fs.mkdirSync("tmp", { recursive: true })
fs.writeFileSync("tmp/check-pdfmake-printer.pdf", pdf)
console.log("check-pdfmake-printer: OK → tmp/check-pdfmake-printer.pdf")
```

- [ ] **Step 3: รันให้เห็นว่าไม่ผ่าน**

Run: `npx tsx scripts/check-pdfmake-printer.ts`
Expected: FAIL — `Cannot find module '../lib/pdfmake-printer'`

- [ ] **Step 4: เขียน `lib/pdfmake-printer.ts`** (ยกจาก mena-partner ตัด CordiaUPC ออก)

```ts
/**
 * Server-side pdfmake printer (pure JS — รันบน Vercel ได้ ไม่ต้อง chromium)
 * โหลดฟอนต์ Sarabun จาก /fonts เข้า virtualfs ของ pdfmake — ยกมาจาก mena-partner-driver/lib/pdfmake-printer.ts
 */
import "server-only"
import path from "path"
import fs from "fs"

/* eslint-disable @typescript-eslint/no-explicit-any */
import pdfmake from "pdfmake"
// @ts-expect-error no types for subpath
import PrinterMod from "pdfmake/js/Printer"
// @ts-expect-error no types for subpath
import URLResolverMod from "pdfmake/js/URLResolver"

const Printer = (PrinterMod as any).default || PrinterMod
const URLResolver = (URLResolverMod as any).default || URLResolverMod

const SARABUN_FILES = {
  normal: "Sarabun-Regular.ttf",
  bold: "Sarabun-Bold.ttf",
  italics: "Sarabun-Italic.ttf",
  bolditalics: "Sarabun-BoldItalic.ttf",
}

let printer: any = null
function getPrinter() {
  if (printer) return printer
  const vfs = (pdfmake as any).virtualfs
  const dir = path.join(process.cwd(), "fonts")
  for (const f of Object.values(SARABUN_FILES)) vfs.writeFileSync(f, fs.readFileSync(path.join(dir, f)))
  printer = new Printer({ Sarabun: { ...SARABUN_FILES } }, vfs, new URLResolver(vfs), () => true)
  return printer
}

/** สร้าง PDF buffer จาก docDefinition ของ pdfmake */
export async function renderPdfmake(docDefinition: any): Promise<Buffer> {
  const pdfDoc = await getPrinter().createPdfKitDocument(docDefinition)
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    pdfDoc.on("data", (c: Buffer) => chunks.push(c))
    pdfDoc.on("end", () => resolve(Buffer.concat(chunks)))
    pdfDoc.on("error", reject)
    pdfDoc.end()
  })
}

// แก้ลำดับ สระอำ + วรรณยุกต์ ให้เรนเดอร์ถูก (fontkit ไม่ reorder ให้): ค+้+ำ → ค+ํ+้+า
export function fixThaiMarks(s: string): string {
  return s.replace(/([่-๋])ำ/g, "ํ$1า")
}

// ตัดคำไทยด้วย Intl.Segmenter → แทรก ZWSP ให้ pdfmake ขึ้นบรรทัดถูก (ห้ามใช้กับเลข/ทะเบียนที่มี "-")
const SEG = new Intl.Segmenter("th", { granularity: "word" })
export function seg(s: string | null | undefined): string {
  if (!s) return ""
  return Array.from(SEG.segment(s), (x) => x.segment)
    .join("​")
    .replace(/​([)\]”’ๆฯ,.:;!?%])/g, "$1")
    .replace(/([([“‘])​/g, "$1")
    .replace(/​? ​?([ๆฯ])/g, " $1")
    .replace(/ผู้​/g, "ผู้")
    .replace(/([่-๋])ำ/g, "ํ$1า")
}
```

หมายเหตุ `import "server-only"`: สคริปต์ tsx จะ error ว่า `server-only` ใช้ได้เฉพาะ Server Component — ถ้าเจอ ให้ลบบรรทัดนี้ออก (mena-partner มี alias ใน tsconfig) แล้วบันทึกไว้ในคอมเมนต์ว่าไฟล์นี้ import ได้เฉพาะฝั่ง server

- [ ] **Step 5: แก้ `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ฟอนต์ PDF อ่านจาก process.cwd()/fonts ตอนรันบน Vercel — ต้องบอก tracer ให้รวมเข้า bundle ของ route นี้
  outputFileTracingIncludes: {
    "/api/price-compare/[id]/pdf": ["./fonts/**"],
  },
  // pdfmake ใช้ subpath import + virtualfs — ให้ Node โหลดตรงจาก node_modules แทนการ bundle
  serverExternalPackages: ["pdfmake", "sharp"],
};

export default nextConfig;
```

- [ ] **Step 6: รัน test ให้ผ่าน + เปิดดู PDF**

Run: `npx tsx scripts/check-pdfmake-printer.ts && open tmp/check-pdfmake-printer.pdf`
Expected: `check-pdfmake-printer: OK` และ PDF แสดงข้อความไทย สระอำ/วรรณยุกต์ถูกตำแหน่ง

- [ ] **Step 7: เพิ่ม `tmp/` ใน .gitignore (ถ้ายังไม่มี) แล้ว commit**

```bash
grep -q "^tmp/" .gitignore || echo "tmp/" >> .gitignore
git add package.json package-lock.json next.config.ts lib/pdfmake-printer.ts fonts scripts/check-pdfmake-printer.ts .gitignore
git commit -m "price-compare: pdfmake printer + Sarabun fonts + pdf-lib/sharp deps"
```

---

### Task 5: PDF หน้า 1 — docDefinition ตามฟอร์ม (`lib/price-compare-pdf.ts`)

**Files:**
- Create: `lib/price-compare-pdf.ts`
- Test: `scripts/check-price-compare-pdf.ts`

**Interfaces:**
- Consumes: Task 1 (`PriceCompare, supplierTotals, fmtMoney, MAX_SUPPLIERS`), Task 4 (`seg`, `renderPdfmake`)
- Produces:
  ```ts
  export type ImagePage = { heading: string; pngBase64: string }   // หน้ารูปแนบ 1 รูป/หน้า
  export function buildPriceCompareDocDef(doc: PriceCompare, imagePages?: ImagePage[]): any
  export function pdfFilename(doc: PriceCompare): string   // "PC-2609-002 Pump + Motor UH03.pdf"
  ```

- [ ] **Step 1: เขียน test**

```ts
// scripts/check-price-compare-pdf.ts — รัน: npx tsx scripts/check-price-compare-pdf.ts
import assert from "node:assert/strict"
import fs from "node:fs"
import { newDoc, emptySupplier, type PriceCompare, type PcSupplier } from "../lib/price-compare"
import { buildPriceCompareDocDef, pdfFilename } from "../lib/price-compare-pdf"
import { renderPdfmake } from "../lib/pdfmake-printer"

function uh03(): PriceCompare {
  const d = newDoc({ name: "นพรัตน์ อายยืน", email: "n@mena.co.th" }) as PriceCompare
  d.docNo = "PC-2609-002"; d.createdAt = "2026-09-07T09:00:00.000+07:00"; d.updatedAt = "2026-09-07T15:30:00.000+07:00"
  d.title = "Pump + Motor UH03"; d.requestDept = "ยานยนต์"; d.revision = 0; d.selectedSupplier = 1
  d.items = [
    { name: "Pump Rexroth", qty: 1, unit: "ตัว" }, { name: "Motor Rexroth", qty: 1, unit: "ตัว" },
    { name: "น้ำมัน HYD.", qty: 18, unit: "ลิตร" }, { name: "น้ำมันเกียร์", qty: 10, unit: "ลิตร" },
    { name: "ค่าแรงซ่อม+ประกอบทดสอบ", qty: 1, unit: "งาน" },
  ]
  const s = (name: string, note: string, prices: number[]): PcSupplier => ({ ...emptySupplier(5), name, note, prices })
  d.suppliers = [
    s("ช่างหมู", "ราคานี้เป็นราคาซ่อม Pump + Motor ของเดิมติดรถ", [21000, 18900, 110.56, 180, 7000]),
    s("คุณณัฐ", "ราคานี้เป็นราคาเปลี่ยน Pump + Motor ใหม่ มือ 1", [30000, 18000, 100, 100, 5500]),
    s("ศศ&ณ", "ราคานี้เป็นราคาเปลี่ยน Pump + Motor ใหม่ มือ 2", [30000, 25000, 107.14, 107.14, 5000]),
  ]
  d.suppliers[0].conditions.statusA = "2"
  d.suppliers[1].vatMode = "incl"; d.suppliers[1].quoteDate = "2026-09-03"; d.suppliers[1].validUntil = "2026-10-03"
  d.selectionReason = ""; d.fewerQuotesReason = ""
  d.committee = d.committee.map((m, i) => ({ ...m, name: ["คุณเสถียรพงษ์ ชะเอมจันทร์", "บุญภัก พรหมมา", "", "คุณนัชภัค ขจรวุฒิเดช"][i], pickedSupplier: i === 2 ? null : 1, reason: i === 2 ? "" : "ราคาถูกสุด", signedDate: i === 2 ? "" : "2026-09-07" }))
  return d
}

assert.equal(pdfFilename(uh03()), "PC-2609-002 Pump + Motor UH03.pdf")
assert.equal(pdfFilename({ ...uh03(), title: "a/b:c*d?" }), "PC-2609-002 a-b-c-d-.pdf", "อักขระต้องห้ามในชื่อไฟล์ถูกแทนด้วย -")

const dd = buildPriceCompareDocDef(uh03())
assert.equal(dd.pageOrientation, "landscape")
assert.equal(dd.defaultStyle.font, "Sarabun")
const flat = JSON.stringify(dd)
assert.ok(flat.includes("PC-2609-002"))
assert.ok(flat.includes("54,238.39"), "สุทธิ supplier 1")
assert.ok(flat.includes("(รวมในราคา)"), "supplier 2 เป็นราคารวม VAT")
assert.ok(flat.includes("56,300.00"), "สุทธิ supplier 2 (incl) = หลังส่วนลด")
assert.ok(flat.includes("3/9/2569"), "วันที่ใบเสนอราคา")
{ const r = buildPriceCompareDocDef({ ...uh03(), selectionReason: "ของใหม่ มือ 1" }); assert.ok(JSON.stringify(r).includes("เหตุผลที่เลือก")) }
assert.ok(flat.includes("Supplier 4"), "ต้องพิมพ์ 4 คอลัมน์เสมอแม้มี 3 ราย")
assert.ok(flat.includes("ผู้ได้รับเลือก"))

// หน้ารูปแนบ
const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
const dd2 = buildPriceCompareDocDef(uh03(), [{ heading: "หลักฐาน: ใบเสนอราคา Supplier 1 — ช่างหมู", pngBase64: png1x1 }])
assert.ok(JSON.stringify(dd2).includes("data:image/png;base64,"))
assert.ok(JSON.stringify(dd2).includes('"pageBreak":"before"'))

const pdf = await renderPdfmake(dd2)
assert.equal(pdf.subarray(0, 5).toString(), "%PDF-")
fs.mkdirSync("tmp", { recursive: true })
fs.writeFileSync("tmp/price-compare-uh03.pdf", pdf)
console.log("check-price-compare-pdf: OK → tmp/price-compare-uh03.pdf (เปิดเทียบกับต้นแบบหน้า 1)")
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx tsx scripts/check-price-compare-pdf.ts`
Expected: FAIL — `Cannot find module '../lib/price-compare-pdf'`

- [ ] **Step 3: เขียน `lib/price-compare-pdf.ts`**

```ts
// lib/price-compare-pdf.ts — docDefinition ของ "แบบบันทึกผลการเปรียบเทียบราคา" (A4 แนวนอน หน้าเดียว) + หน้ารูปแนบ
// ตัวเลขทุกช่องมาจาก supplierTotals ใน lib/price-compare เพื่อให้ตรงกับหน้าเว็บเสมอ
import fs from "fs"
import path from "path"
import { seg } from "./pdfmake-printer"
import { supplierTotals, fmtMoney, lineTotal, MAX_SUPPLIERS, type PriceCompare } from "./price-compare"

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ImagePage = { heading: string; pngBase64: string }

const COMPANY = "บริษัท มีนาทรานสปอร์ต จำกัด (มหาชน)"
const FORM_TITLE = "แบบบันทึกผลการเปรียบเทียบราคา   (ราคา 5,000 บาทขึ้นไป)"
const GRAY = "#D9D9D9"     // สีคอลัมน์ Supplier 2 ตามฟอร์ม
const LINE = "#000000"
const MIN_ROWS = 14

let LOGO = ""
try { LOGO = fs.readFileSync(path.join(process.cwd(), "fonts", "mena-logo.jpg")).toString("base64") } catch { /* ไม่มีโลโก้ก็พิมพ์ได้ */ }

const thDate = (iso: string): string => {
  if (!iso) return ""
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  return `${d}/${m}/${y + 543}`
}
const t = (text: string, extra: any = {}) => ({ text: seg(text), ...extra })
const money = (n: number | null, extra: any = {}) => ({ text: fmtMoney(n), alignment: "right", ...extra })
const cell = (text: string, extra: any = {}) => ({ text, alignment: "center", ...extra })

export function pdfFilename(doc: PriceCompare): string {
  const safe = doc.title.replace(/[\\/:*?"<>|]/g, "-").trim()
  return `${doc.docNo}${safe ? " " + safe : ""}.pdf`
}

export function buildPriceCompareDocDef(doc: PriceCompare, imagePages: ImagePage[] = []): any {
  const N = MAX_SUPPLIERS
  const sup = (i: number) => doc.suppliers[i]   // undefined ถ้าไม่มี
  const totals = Array.from({ length: N }, (_, i) => (sup(i) ? supplierTotals(doc, i) : null))
  const fill = (i: number) => (i === 1 ? { fillColor: GRAY } : {})   // ฟอร์มเดิมทำคอลัมน์ Supplier 2 เป็นสีเทา

  // ---------- ส่วนหัว ----------
  const header = {
    table: {
      widths: [70, 150, 120, "*", 60, 60, 70, 70],
      body: [
        [
          { rowSpan: 3, ...(LOGO ? { image: `data:image/jpeg;base64,${LOGO}`, fit: [60, 40], alignment: "center", margin: [0, 6, 0, 0] } : { text: "Mena", alignment: "center" }) },
          t(COMPANY, { alignment: "center", fontSize: 8 }), { rowSpan: 2, ...t(doc.title, { alignment: "center", margin: [0, 6, 0, 0] }) },
          { rowSpan: 2, ...t(FORM_TITLE, { bold: true, alignment: "center", margin: [0, 6, 0, 0] }) },
          t("เลขที่ :", { fontSize: 8 }), { colSpan: 2, text: doc.docNo }, {}, t("", {}),
        ],
        [{}, t("ชื่อสินค้า / งานซ่อม :", { fontSize: 8 }), {}, {}, t("วันที่เริ่มจัดทำ :", { fontSize: 8 }), { colSpan: 2, text: thDate(doc.createdAt) }, {}, {}],
        [{}, t("หน่วยงานที่ร้องขอ :", { fontSize: 8 }), t(doc.requestDept, { alignment: "center" }),
          { columns: [t("ผู้จัดทำ :", { fontSize: 8, width: 40 }), t(doc.preparedBy.name, { width: "*" }), t("ครั้งที่แก้ไข :", { fontSize: 8, width: 55 }), { text: String(doc.revision), width: 20 }] },
          t("วันที่แก้ไขล่าสุด :", { fontSize: 8 }), { colSpan: 2, text: thDate(doc.updatedAt) }, {}, {}],
      ],
    },
    layout: { hLineColor: LINE, vLineColor: LINE },
  }

  // ---------- ตารางเทียบราคา ----------
  const supplierHead = Array.from({ length: N }, (_, i) => [
    { colSpan: 2, ...cell(`Supplier ${i + 1}`, { bold: true, ...fill(i) }) }, {},
  ]).flat()
  const supplierName = Array.from({ length: N }, (_, i) => [
    { colSpan: 2, ...t(sup(i)?.name ?? "", { alignment: "center", ...fill(i) }) }, {},
  ]).flat()
  const supplierSub = Array.from({ length: N }, (_, i) => [cell("ราคา/หน่วย", { fontSize: 7, ...fill(i) }), cell("ยอดรวม", { fontSize: 7, ...fill(i) })]).flat()

  const itemRows = doc.items.map((it, r) => [
    cell(String(r + 1)), t(it.name), cell(String(it.qty)), cell(it.unit),
    ...Array.from({ length: N }, (_, i) => {
      const p = sup(i)?.prices[r] ?? null
      return [money(p, fill(i)), money(lineTotal(it, p), fill(i))]
    }).flat(),
  ])
  const noteRow = [
    "", "", "", "",
    ...Array.from({ length: N }, (_, i) => [{ colSpan: 2, ...t(sup(i)?.note ?? "", { fontSize: 7, alignment: "center", bold: true, ...fill(i) }) }, {}]).flat(),
  ]
  const blankRows = Array.from({ length: Math.max(0, MIN_ROWS - doc.items.length) }, () => [
    " ", "", "", "", ...Array.from({ length: N }, (_, i) => [{ text: " ", ...fill(i) }, { text: " ", ...fill(i) }]).flat(),
  ])
  // ช่อง VAT บอกฐานราคาด้วย: none → "ไม่มี VAT", incl → "(รวมในราคา) 3,683.18"
  const vatCell = (i: number) => {
    const s = sup(i), tt = totals[i]
    if (!s || !tt) return money(null, fill(i))
    if (s.vatMode === "none") return t("ไม่มี VAT", { alignment: "right", fontSize: 7, ...fill(i) })
    if (s.vatMode === "incl") return t(`(รวมในราคา) ${fmtMoney(tt.vat)}`, { alignment: "right", fontSize: 7, ...fill(i) })
    return money(tt.vat, fill(i))
  }
  const sumRow = (label: string, key: keyof NonNullable<(typeof totals)[number]>, bold = false) => [
    { colSpan: 4, ...t(label, { alignment: "center", bold }) }, {}, {}, {},
    ...Array.from({ length: N }, (_, i) => [{ text: "", ...fill(i) }, key === "vat" ? vatCell(i) : money(totals[i] ? totals[i]![key] : null, { bold, ...fill(i) })]).flat(),
  ]
  const priceTable = {
    table: {
      headerRows: 3,
      widths: [22, "*", 32, 32, ...Array.from({ length: N * 2 }, () => 52)],
      body: [
        [cell("ลำดับ", { rowSpan: 3, bold: true }), cell("รายการ", { rowSpan: 3, bold: true }), cell("จำนวน", { rowSpan: 3, bold: true }), cell("หน่วย", { rowSpan: 3, bold: true }), ...supplierHead],
        ["", "", "", "", ...supplierName],
        ["", "", "", "", ...supplierSub],
        ...itemRows,
        noteRow,
        ...blankRows,
        sumRow("รวมราคา ก่อนภาษี", "subtotal", true),
        sumRow("ส่วนลด", "discount"),
        sumRow("รวมราคาหลังส่วนลด", "afterDiscount"),
        sumRow("ภาษีมูลค่าเพิ่ม 7 %", "vat"),
        sumRow("รวมราคาทั้งหมด (สุทธิ)", "net", true),
      ],
    },
    layout: { hLineColor: LINE, vLineColor: LINE, paddingTop: () => 1, paddingBottom: () => 1 },
    fontSize: 8,
  }

  // ---------- เงื่อนไขในการคัดเลือก ----------
  const condKeys: [string, keyof PriceCompare["suppliers"][number]["conditions"]][] = [
    ["(1) เงื่อนไขการชำระเงิน", "payment"], ["(2) ระยะเวลาส่งมอบหลังรับ PO", "leadTime"],
    ["(3) เงื่อนไขการรับประกัน", "warranty"], ["หมายเหตุ (ถ้ามี)", "remark"],
    ["(4) จำนวนช่องซ่อมที่อู่มี", "bays"], ["(5) จำนวนรถMena ที่เข้าซ่อมอยู่ในขณะนี้", "menaTrucksIn"],
  ]
  const condRows = condKeys.map(([label, key], r) => [
    r === 0 ? { rowSpan: 8, ...t("เงื่อนไขในการคัดเลือก ต้องระบุให้ครบถ้วน", { alignment: "center", fontSize: 7, fillColor: GRAY, margin: [0, 18, 0, 0] }) } : {},
    t(label),
    ...Array.from({ length: N }, (_, i) => [{ colSpan: 2, ...t(sup(i)?.conditions[key] ?? "", { alignment: "center" }) }, {}]).flat(),
  ])
  const statusRow = [
    {}, t("(6) สถานะ ของรถMena ที่เข้าซ่อมอยู่ในขณะนี้"),
    ...Array.from({ length: N }, (_, i) => [t(`ขA - ${sup(i)?.conditions.statusA ?? ""} คัน`, { alignment: "center", fontSize: 7 }), t(`ขB - ${sup(i)?.conditions.statusB ?? ""} คัน`, { alignment: "center", fontSize: 7 })]).flat(),
  ]
  const quoteRow = [
    {}, t("(7) วันที่ใบเสนอราคา / ใช้ได้ถึง"),
    ...Array.from({ length: N }, (_, i) => [t(thDate(sup(i)?.quoteDate ?? ""), { alignment: "center", fontSize: 7 }), t(thDate(sup(i)?.validUntil ?? ""), { alignment: "center", fontSize: 7 })]).flat(),
  ]
  const condTable = {
    table: { widths: [50, "*", ...Array.from({ length: N * 2 }, () => 52)], body: [...condRows, statusRow, quoteRow] },
    layout: { hLineColor: LINE, vLineColor: LINE, paddingTop: () => 1, paddingBottom: () => 1 },
    fontSize: 8,
  }

  // ---------- คณะกรรมการ ----------
  const member = (i: number) => {
    const m = doc.committee[i]
    return {
      stack: [
        t(`1) เลือก supplier ลำดับที่ ${m?.pickedSupplier ?? "......"}`, { bold: true, fontSize: 8 }),
        t(`2) เหตุผลในการเลือก : ${m?.reason ?? ""}`, { bold: true, fontSize: 8 }),
        { text: " ", margin: [0, 14, 0, 0] },                       // ที่ว่างลงนาม
        t(m?.name ?? "", { alignment: "center" }),
        t(`วันที่ ${m?.signedDate ? thDate(m.signedDate) : "................"}`, { alignment: "center", fontSize: 8 }),
        t(m?.role ?? "", { alignment: "center", bold: true, fontSize: 8 }),
      ],
    }
  }
  const chosen = Array.from({ length: N }, (_, i) => t(`[${doc.selectedSupplier === i + 1 ? "✓" : "  "}] Supplier ${i + 1}`, { fontSize: 8 }))
  const committeeTable = {
    table: {
      widths: [50, "*", "*", "*", "*", 70],
      body: [[
        t("คณะกรรมการพิจารณาคัดเลือกและข้อสรุป", { alignment: "center", fontSize: 7, fillColor: GRAY, margin: [0, 20, 0, 0] }),
        member(0), member(1), member(2), member(3),
        { stack: [t("ผู้ได้รับเลือก", { bold: true, fontSize: 8, decoration: "underline" }), ...chosen] },
      ]],
    },
    layout: { hLineColor: LINE, vLineColor: LINE },
    fontSize: 9,
  }

  // ---------- เหตุผล (พิมพ์เฉพาะที่มีข้อความ) ----------
  const reasons = [
    doc.selectionReason ? t(`เหตุผลที่เลือก: ${doc.selectionReason}`, { fontSize: 8 }) : null,
    doc.fewerQuotesReason ? t(`เหตุผลที่มีใบเสนอราคาน้อยกว่า 3 ราย: ${doc.fewerQuotesReason}`, { fontSize: 8 }) : null,
  ].filter(Boolean)

  // ---------- หน้ารูปแนบ ----------
  const attachments = imagePages.flatMap((p) => [
    { text: seg(p.heading), bold: true, fontSize: 12, pageBreak: "before", pageOrientation: "portrait", margin: [0, 0, 0, 8] },
    { image: `data:image/png;base64,${p.pngBase64}`, fit: [500, 720], alignment: "center" },
  ])

  return {
    pageSize: "A4", pageOrientation: "landscape", pageMargins: [24, 20, 24, 20],
    defaultStyle: { font: "Sarabun", fontSize: 9 },
    info: { title: `${doc.docNo} ${doc.title}` },
    content: [header, priceTable, condTable, committeeTable, ...reasons, ...attachments],
  }
}
```

- [ ] **Step 4: รัน test แล้วเปิดเทียบกับต้นแบบ**

Run: `npx tsx scripts/check-price-compare-pdf.ts && open tmp/price-compare-uh03.pdf`
Expected: `check-price-compare-pdf: OK`; หน้า 1 อยู่ในหน้าเดียว (ถ้าล้นหน้า 2 ให้ลด `MIN_ROWS` หรือ fontSize) มีโลโก้ ตาราง 4 supplier คอลัมน์ 2 เทา สรุปยอด เงื่อนไข กรรมการ 4 ช่อง ช่องติ๊ก ✓ ที่ Supplier 1; หน้า 2 เป็นรูปแนวตั้ง

ถ้า pdfmake โยน error เรื่อง `rowSpan`/`colSpan` ไม่สมดุล (พบบ่อย): นับ cell ต่อแถวให้เท่ากับ `widths.length` ทุกแถว — cell ที่ถูก span ต้องใส่ `{}` ค้างไว้เสมอ

- [ ] **Step 5: Commit**

```bash
git add lib/price-compare-pdf.ts scripts/check-price-compare-pdf.ts
git commit -m "price-compare: pdfmake docDefinition ตามฟอร์มเทียบราคา + หน้ารูปแนบ"
```

---

### Task 6: หลักฐานแนบ + PDF route (`lib/price-compare-attachments.ts`, `app/api/price-compare/[id]/pdf/route.ts`)

**Files:**
- Create: `lib/price-compare-attachments.ts`, `app/api/price-compare/[id]/pdf/route.ts`
- Test: ต่อท้าย `scripts/check-price-compare-pdf.ts`

**Interfaces:**
- Consumes: Task 1 (`PriceCompare, PcFile`), Task 4 (`renderPdfmake`), Task 5 (`buildPriceCompareDocDef, ImagePage, pdfFilename`)
- Produces:
  ```ts
  export type AttachmentPlan = { imagePages: ImagePage[]; pdfInserts: { afterImageIndex: number; bytes: Uint8Array; heading: string }[]; failed: string[] }
  export function attachmentOrder(doc: PriceCompare): { heading: string; file: PcFile }[]
  export async function collectAttachments(doc: PriceCompare, fetchImpl?: typeof fetch): Promise<AttachmentPlan>
  export async function assemblePdf(doc: PriceCompare, plan: AttachmentPlan): Promise<Uint8Array>
  ```

- [ ] **Step 1: ต่อ test**

ต่อท้าย `scripts/check-price-compare-pdf.ts` (ย้าย import ไปบนสุด):

```ts
import { PDFDocument } from "pdf-lib"
import { attachmentOrder, collectAttachments, assemblePdf } from "../lib/price-compare-attachments"

// --- ลำดับหลักฐาน: ทั่วไป → Supplier 1..N ---
{
  const d = uh03()
  const f = (n: string): any => ({ mediaId: 1, batchId: "b", filename: n, webpUrl: `https://cdn.test/${n}`, thumbnailUrl: "" })
  d.evidenceFiles = [f("line-chat.jpg")]
  d.suppliers[0].quotationFiles = [f("q1.jpg")]
  d.suppliers[1].quotationFiles = [f("quote2.pdf"), f("q2b.jpg")]
  const order = attachmentOrder(d)
  assert.deepEqual(order.map((o) => o.file.filename), ["line-chat.jpg", "q1.jpg", "quote2.pdf", "q2b.jpg"])
  assert.equal(order[0].heading, "หลักฐาน: line-chat.jpg")
  assert.equal(order[2].heading, "ใบเสนอราคา Supplier 2 — คุณณัฐ: quote2.pdf")

  // --- collectAttachments ด้วย fetch ปลอม: รูป = PNG 1×1 (sharp แปลงได้), pdf = เอกสาร 2 หน้า, ไฟล์เสีย = 404 ---
  const twoPage = await PDFDocument.create(); twoPage.addPage(); twoPage.addPage()
  const pdfBytes = await twoPage.save()
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")
  d.suppliers[2].quotationFiles = [f("broken.jpg")]
  const fakeFetch = (async (url: string) => {
    if (url.endsWith("broken.jpg")) return new Response(null, { status: 404 })
    if (url.endsWith(".pdf")) return new Response(pdfBytes, { status: 200, headers: { "content-type": "application/pdf" } })
    return new Response(png, { status: 200, headers: { "content-type": "image/png" } })
  }) as unknown as typeof fetch
  const plan = await collectAttachments(d, fakeFetch)
  assert.equal(plan.imagePages.length, 3, "รูป 3 ไฟล์")
  assert.equal(plan.pdfInserts.length, 1)
  assert.equal(plan.pdfInserts[0].afterImageIndex, 1, "PDF ของ supplier 2 อยู่หลังรูปที่ 2 (index 1)")
  assert.deepEqual(plan.failed, ["broken.jpg"])

  const out = await assemblePdf(d, plan)
  const merged = await PDFDocument.load(out)
  // หน้า 1 ฟอร์ม + รูป line-chat + รูป q1 + PDF 2 หน้า + รูป q2b + หน้าแจ้งไฟล์เสีย = 7
  assert.equal(merged.getPageCount(), 7)
  fs.writeFileSync("tmp/price-compare-merged.pdf", out)
  console.log("attachments: OK → tmp/price-compare-merged.pdf")
}
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx tsx scripts/check-price-compare-pdf.ts`
Expected: FAIL — `Cannot find module '../lib/price-compare-attachments'`

- [ ] **Step 3: เขียน `lib/price-compare-attachments.ts`**

```ts
// lib/price-compare-attachments.ts — โหลดหลักฐานแนบของใบเทียบราคา แล้วประกอบเป็น PDF ฉบับเดียว
//   รูป (webp/jpg/png บน CDN) → sharp → PNG → หน้าแนวตั้ง 1 รูป/หน้า (ผ่าน pdfmake)
//   PDF ที่อัปโหลด → pdf-lib copyPages แทรก "ตามลำดับ" หลังหน้ารูปที่อยู่ก่อนหน้า
import sharp from "sharp"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { renderPdfmake } from "./pdfmake-printer"
import { buildPriceCompareDocDef, type ImagePage } from "./price-compare-pdf"
import type { PriceCompare, PcFile } from "./price-compare"

export type AttachmentPlan = {
  imagePages: ImagePage[]
  pdfInserts: { afterImageIndex: number; bytes: Uint8Array; heading: string }[]   // afterImageIndex = -1 → ก่อนรูปแรก
  failed: string[]
}

const MAX_PX = 1600
const isPdf = (f: PcFile) => /\.pdf$/i.test(f.filename)

/** ลำดับหลักฐาน: ทั่วไป → ใบเสนอราคา Supplier 1..N */
export function attachmentOrder(doc: PriceCompare): { heading: string; file: PcFile }[] {
  const out: { heading: string; file: PcFile }[] = []
  for (const f of doc.evidenceFiles) out.push({ heading: `หลักฐาน: ${f.filename}`, file: f })
  doc.suppliers.forEach((s, i) => {
    for (const f of s.quotationFiles) out.push({ heading: `ใบเสนอราคา Supplier ${i + 1}${s.name ? ` — ${s.name}` : ""}: ${f.filename}`, file: f })
  })
  return out
}

export async function collectAttachments(doc: PriceCompare, fetchImpl: typeof fetch = fetch): Promise<AttachmentPlan> {
  const plan: AttachmentPlan = { imagePages: [], pdfInserts: [], failed: [] }
  for (const { heading, file } of attachmentOrder(doc)) {
    try {
      const res = await fetchImpl(file.webpUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0) throw new Error("empty")
      if (isPdf(file)) {
        await PDFDocument.load(buf, { ignoreEncryption: false })   // ตรวจว่าเปิดได้ก่อน
        plan.pdfInserts.push({ afterImageIndex: plan.imagePages.length - 1, bytes: new Uint8Array(buf), heading })
      } else {
        const png = await sharp(buf).rotate().resize({ width: MAX_PX, height: MAX_PX, fit: "inside", withoutEnlargement: true }).png().toBuffer()
        plan.imagePages.push({ heading, pngBase64: png.toString("base64") })
      }
    } catch {
      plan.failed.push(file.filename)
    }
  }
  return plan
}

/** ประกอบ: pdfmake (หน้า 1 + หน้ารูป) → pdf-lib แทรก PDF แนบตามลำดับ → หน้าแจ้งไฟล์ที่แนบไม่ได้ */
export async function assemblePdf(doc: PriceCompare, plan: AttachmentPlan): Promise<Uint8Array> {
  const main = await renderPdfmake(buildPriceCompareDocDef(doc, plan.imagePages))
  const out = await PDFDocument.load(main)
  const font = await out.embedFont(StandardFonts.Helvetica)

  // แทรกจากท้ายมาหน้า เพื่อไม่ให้ index เลื่อน — หน้ารูป i อยู่ที่ index (1 + i)
  const inserts = [...plan.pdfInserts].sort((a, b) => b.afterImageIndex - a.afterImageIndex)
  for (const ins of inserts) {
    const src = await PDFDocument.load(ins.bytes)
    const pages = await out.copyPages(src, src.getPageIndices())
    let at = 1 + ins.afterImageIndex + 1
    for (const p of pages) out.insertPage(at++, p)
  }

  if (plan.failed.length) {
    const page = out.addPage([595.28, 841.89])
    // Helvetica ไม่มีอักษรไทย — เขียนชื่อไฟล์ (มักเป็นละติน) + ข้อความอังกฤษ; รายละเอียดไทยดูในหน้าเว็บ
    page.drawText("Attachments that could not be included:", { x: 48, y: 780, size: 14, font })
    plan.failed.forEach((name, i) => page.drawText(`- ${name.replace(/[^\x20-\x7E]/g, "?")}`, { x: 60, y: 750 - i * 20, size: 11, font }))
  }
  return out.save()
}
```

- [ ] **Step 4: เขียน route**

```ts
// app/api/price-compare/[id]/pdf/route.ts — export PDF ใบเทียบราคา + หลักฐานแนบ
import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { normalizeDoc } from "@/lib/price-compare"
import { PC_COLL } from "@/lib/price-compare-db"
import { pdfFilename } from "@/lib/price-compare-pdf"
import { collectAttachments, assemblePdf } from "@/lib/price-compare-attachments"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"
const DB = process.env.MONGO_DB ?? "master_data"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "bad id" }, { status: 400 })
  const raw = await (await clientPromise).db(DB).collection(PC_COLL).findOne({ _id: new ObjectId(id) })
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 })
  const doc = normalizeDoc(raw)
  try {
    const withAttachments = req.nextUrl.searchParams.get("attachments") !== "0"
    const plan = withAttachments ? await collectAttachments(doc) : { imagePages: [], pdfInserts: [], failed: [] }
    const bytes = await assemblePdf(doc, plan)
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(pdfFilename(doc))}`,
        "X-Attachments-Failed": String(plan.failed.length),
      },
    })
  } catch (e) {
    console.error("[price-compare pdf]", e)
    return NextResponse.json({ error: "pdf generation failed", detail: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
```

- [ ] **Step 5: รัน test + typecheck**

Run: `npx tsx scripts/check-price-compare-pdf.ts && npx tsc --noEmit -p . 2>&1 | grep -E "price-compare|pdfmake" ; echo done`
Expected: `attachments: OK` และ `open tmp/price-compare-merged.pdf` เห็น 7 หน้าเรียงถูก

- [ ] **Step 6: ทดสอบ route จริงบน dev server**

สร้างใบผ่าน API (Task 3 script หรือ UI) แล้วเปิด `http://localhost:3000/api/price-compare/<id>/pdf` ในเบราว์เซอร์ที่ล็อกอินอยู่ → ได้ PDF inline ชื่อไฟล์ถูก

- [ ] **Step 7: Commit**

```bash
git add lib/price-compare-attachments.ts "app/api/price-compare/[id]/pdf/route.ts" scripts/check-price-compare-pdf.ts
git commit -m "price-compare: PDF route — แนบรูป (sharp→png) และ merge PDF ใบเสนอราคาด้วย pdf-lib"
```

---

### Task 7: เมนู + หน้ารายการ (`lib/nav.ts`, `app/price-compare/page.tsx`, `components/price-compare-list.tsx`)

**Files:**
- Modify: `lib/nav.ts` (เพิ่ม group หลัง group `key: "tracking"`)
- Create: `app/price-compare/page.tsx`, `app/price-compare/[id]/page.tsx` (placeholder จนกว่า Task 9), `components/price-compare-list.tsx`

**Interfaces:**
- Consumes: Task 3 list API (`GET /api/price-compare` → `{ _id, docNo, title, requestDept, status, preparedBy, updatedAt, supplierCount, selectedSupplier, selectedName, selectedNet, lowestNet }[]`, `POST` → doc), Task 1 (`fmtMoney, PC_STATUSES, PcStatus`)
- Produces: route `/price-compare`, `/price-compare/[id]`; helper `export const STATUS_STYLE: Record<PcStatus, string>` และ `export function StatusChip({ status })` ใน list component (Task 9 ใช้ซ้ำ)

- [ ] **Step 1: เพิ่มกลุ่มใน `lib/nav.ts`**

เพิ่ม `Scale` ใน import จาก `lucide-react` แล้วแทรก object นี้ต่อจาก group `tracking` (ก่อน group `deadstock`):

```ts
  {
    key: "price-compare",
    label: "เปรียบเทียบราคา",
    homeDesc: "แบบบันทึกผลการเปรียบเทียบราคา (5,000 บาทขึ้นไป) และ export PDF",
    homeIcon: Scale, color: "#0E7490", bg: "#E0F2FE", homeOrder: 11,
    collapsible: true,
    items: [
      { href: "/price-compare", label: "ใบเทียบราคา", icon: Scale, exact: true,
        desc: "เทียบ supplier 1–4 · บันทึกผลกรรมการ · PDF" },
    ],
  },
```

ถ้ามี group อื่นใช้ `homeOrder: 11` อยู่แล้ว ให้ขยับกลุ่มใหม่เป็นเลขถัดไปที่ว่าง (ดูค่าที่มีด้วย `grep -n homeOrder lib/nav.ts`)

- [ ] **Step 2: สร้าง route files**

```tsx
// app/price-compare/page.tsx
import { PriceCompareList } from "@/components/price-compare-list"

export default function Page() {
  return <PriceCompareList />
}
```

```tsx
// app/price-compare/[id]/page.tsx  (แทนที่ด้วยฟอร์มจริงใน Task 9)
export default function Page() {
  return <div className="p-6 text-sm text-gray-500">ฟอร์มใบเทียบราคา (กำลังพัฒนา)</div>
}
```

- [ ] **Step 3: เขียน `components/price-compare-list.tsx`**

```tsx
"use client"
// components/price-compare-list.tsx — รายการใบเทียบราคา (ดึงครั้งเดียว กรอง client-side)
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Scale, Search, Plus, Loader2 } from "lucide-react"
import { fmtMoney, PC_STATUSES, type PcStatus } from "@/lib/price-compare"
import { swalError } from "@/lib/swal"

export type PcListRow = {
  _id: string; docNo: string; title: string; requestDept: string; status: PcStatus
  preparedBy: { name: string; email: string }; updatedAt: string; createdAt: string; revision: number
  supplierCount: number; selectedSupplier: number | null; selectedName: string
  selectedNet: number | null; lowestNet: number | null
}

export const STATUS_STYLE: Record<PcStatus, string> = {
  "ร่าง":      "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200",
  "รอลงนาม":   "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  "เสร็จสิ้น": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
}
export function StatusChip({ status }: { status: PcStatus }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>{status}</span>
}

const fmtDate = (iso: string) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "")
const monthOf = (docNo: string) => docNo.split("-")[1] ?? ""   // "2609"
const monthLabel = (yymm: string) => `${yymm.slice(2)}/25${yymm.slice(0, 2)}`   // "09/2569"

export function PriceCompareList() {
  const router = useRouter()
  const [rows, setRows] = useState<PcListRow[] | null>(null)
  const [q, setQ] = useState("")
  const [fStatus, setFStatus] = useState("")
  const [fMonth, setFMonth] = useState("")
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch("/api/price-compare?limit=500").then((r) => r.json()).then((d) => setRows(Array.isArray(d) ? d : [])).catch(() => setRows([]))
  }, [])

  const months = useMemo(() => Array.from(new Set((rows ?? []).map((r) => monthOf(r.docNo)))).sort().reverse(), [rows])
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (rows ?? []).filter((r) =>
      (!fStatus || r.status === fStatus) &&
      (!fMonth || monthOf(r.docNo) === fMonth) &&
      (!t || [r.docNo, r.title, r.requestDept, r.selectedName, r.preparedBy?.name].some((v) => (v ?? "").toLowerCase().includes(t))))
  }, [rows, q, fStatus, fMonth])

  async function create() {
    setCreating(true)
    try {
      const res = await fetch("/api/price-compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "สร้างไม่สำเร็จ")
      router.push(`/price-compare/${d._id}`)
    } catch (e) { swalError(e instanceof Error ? e.message : "สร้างไม่สำเร็จ"); setCreating(false) }
  }

  const inputCls = "rounded-lg border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-3 py-2 text-sm focus:border-[#1B8C4B] focus:outline-none"

  return (
    <div className="w-full px-4 py-6" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0E7490]/10 text-[#0E7490]"><Scale size={20} /></div>
          <div>
            <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>ใบเทียบราคา</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">แบบบันทึกผลการเปรียบเทียบราคา (ราคา 5,000 บาทขึ้นไป)</p>
          </div>
        </div>
        <button onClick={create} disabled={creating} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-60">
          {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} สร้างใบเทียบราคา
        </button>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา เลขที่ / ชื่องาน / supplier / ผู้จัดทำ" className={`${inputCls} w-full pl-9`} />
        </div>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inputCls}>
          <option value="">ทุกสถานะ</option>
          {PC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} className={inputCls}>
          <option value="">ทุกเดือน</option>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10]">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-white/5 text-xs text-gray-500">
            <tr>
              {["เลขที่", "ชื่อสินค้า / งานซ่อม", "หน่วยงาน", "Supplier", "ผู้ได้รับเลือก", "สุทธิ (บาท)", "สถานะ", "ผู้จัดทำ", "แก้ไขล่าสุด"].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400"><Loader2 className="inline animate-spin" size={16} /> กำลังโหลด…</td></tr>}
            {rows !== null && filtered.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">ไม่มีรายการ</td></tr>}
            {filtered.map((r) => (
              <tr key={r._id} onClick={() => router.push(`/price-compare/${r._id}`)} className="cursor-pointer border-t border-[#EEF2F0] dark:border-white/8 hover:bg-[#F6FAF7] dark:hover:bg-white/5">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.docNo}</td>
                <td className="px-3 py-2 font-medium">{r.title || <span className="text-gray-400">(ยังไม่ระบุ)</span>}</td>
                <td className="px-3 py-2">{r.requestDept}</td>
                <td className="px-3 py-2 text-center">{r.supplierCount}</td>
                <td className="px-3 py-2">{r.selectedSupplier ? `${r.selectedSupplier}. ${r.selectedName}` : <span className="text-gray-400">—</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.selectedNet != null ? fmtMoney(r.selectedNet) : r.lowestNet != null ? <span className="text-gray-400" title="สุทธิต่ำสุด (ยังไม่เลือก)">{fmtMoney(r.lowestNet)}</span> : ""}
                </td>
                <td className="px-3 py-2"><StatusChip status={r.status} /></td>
                <td className="px-3 py-2 whitespace-nowrap">{r.preparedBy?.name}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">{fmtDate(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: ตรวจในเบราว์เซอร์**

`npm run dev` → เปิด `/` เห็นการ์ด "เปรียบเทียบราคา" และ sidebar มีกลุ่มใหม่ → `/price-compare` โหลดรายการ (ว่างหรือมีใบจาก Task 3) → กด "สร้างใบเทียบราคา" ได้ใบใหม่และไปหน้า `[id]` (placeholder) → กลับมาเห็นใบใหม่ในรายการพร้อมเลขที่ `PC-YYMM-NNN` และ chip "ร่าง"

- [ ] **Step 5: Lint + commit**

```bash
npx eslint lib/nav.ts components/price-compare-list.tsx app/price-compare
git add lib/nav.ts app/price-compare components/price-compare-list.tsx
git commit -m "price-compare: เมนูกลุ่มใหม่ + หน้ารายการ"
```

---

### Task 8: Matrix component (`components/price-compare-matrix.tsx`)

**Files:**
- Create: `components/price-compare-matrix.tsx`

**Interfaces:**
- Consumes: Task 1 (`PriceCompare, PcItem, PcSupplier, emptySupplier, supplierTotals, lowestPerLine, lowestNet, fmtMoney, MAX_SUPPLIERS`), `GarageCombobox` + `Garage` จาก `@/components/garage-combobox`
- Produces:
  ```tsx
  export function PriceCompareMatrix(props: {
    doc: PriceCompare
    garages: Garage[]
    onGarageCreated: (g: Garage) => void
    onChange: (patch: Pick<PriceCompare, "items" | "suppliers">) => void
    readOnly?: boolean
  }): JSX.Element
  ```
  ทุกการแก้ (เพิ่ม/ลบแถว, เพิ่ม/ลบ supplier, ราคา, ส่วนลด, ชื่อ/หมายเหตุ supplier) เรียก `onChange({ items, suppliers })` ด้วย array ใหม่ (immutable) และรักษา `prices.length === items.length` เสมอ

- [ ] **Step 1: เขียน component**

```tsx
"use client"
// components/price-compare-matrix.tsx — ตารางเทียบราคา รายการ × Supplier 1–4 + สรุปยอด (คำนวณสดจาก lib/price-compare)
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react"
import { GarageCombobox, inputCls, type Garage } from "@/components/garage-combobox"
import {
  emptySupplier, supplierTotals, lowestPerLine, lowestNet, fmtMoney, MAX_SUPPLIERS, VAT_MODE_LABEL,
  type PriceCompare, type PcItem, type PcSupplier, type PcVatMode,
} from "@/lib/price-compare"

type Props = {
  doc: PriceCompare
  garages: Garage[]
  onGarageCreated: (g: Garage) => void
  onChange: (patch: Pick<PriceCompare, "items" | "suppliers">) => void
  readOnly?: boolean
}

const cellInput = "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-right tabular-nums focus:border-[#1B8C4B] focus:bg-white dark:focus:bg-[#0f1117] focus:outline-none"
const textInput = "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm focus:border-[#1B8C4B] focus:bg-white dark:focus:bg-[#0f1117] focus:outline-none"
const numOrNull = (v: string): number | null => { if (v.trim() === "") return null; const n = parseFloat(v.replace(/,/g, "")); return isFinite(n) ? n : null }

export function PriceCompareMatrix({ doc, garages, onGarageCreated, onChange, readOnly }: Props) {
  const { items, suppliers } = doc
  const low = lowestPerLine(doc)
  const lowNet = lowestNet(doc)
  const totals = suppliers.map((_, i) => supplierTotals(doc, i))

  const setItems = (next: PcItem[], nextSup?: PcSupplier[]) => onChange({ items: next, suppliers: nextSup ?? suppliers })
  const setSuppliers = (next: PcSupplier[]) => onChange({ items, suppliers: next })
  const patchItem = (r: number, p: Partial<PcItem>) => setItems(items.map((it, i) => (i === r ? { ...it, ...p } : it)))
  const patchSupplier = (s: number, p: Partial<PcSupplier>) => setSuppliers(suppliers.map((sp, i) => (i === s ? { ...sp, ...p } : sp)))
  const setPrice = (s: number, r: number, v: number | null) => patchSupplier(s, { prices: suppliers[s].prices.map((p, i) => (i === r ? v : p)) })

  const addItem = () => setItems([...items, { name: "", qty: 1, unit: "" }], suppliers.map((sp) => ({ ...sp, prices: [...sp.prices, null] })))
  const removeItem = (r: number) => setItems(items.filter((_, i) => i !== r), suppliers.map((sp) => ({ ...sp, prices: sp.prices.filter((_, i) => i !== r) })))
  const moveItem = (r: number, dir: -1 | 1) => {
    const j = r + dir
    if (j < 0 || j >= items.length) return
    const swap = <T,>(arr: T[]) => { const a = [...arr]; [a[r], a[j]] = [a[j], a[r]]; return a }
    setItems(swap(items), suppliers.map((sp) => ({ ...sp, prices: swap(sp.prices) })))
  }
  const addSupplier = () => suppliers.length < MAX_SUPPLIERS && setSuppliers([...suppliers, emptySupplier(items.length)])
  const removeSupplier = (s: number) => setSuppliers(suppliers.filter((_, i) => i !== s))

  const th = "px-2 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 border-b border-[#E2E8E4] dark:border-white/10"
  const td = "px-1 py-0.5 border-b border-[#EEF2F0] dark:border-white/8 align-middle"

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={`${th} w-8 text-center`}>#</th>
            <th className={`${th} min-w-[220px] text-left`}>รายการ</th>
            <th className={`${th} w-20 text-right`}>จำนวน</th>
            <th className={`${th} w-20 text-left`}>หน่วย</th>
            {suppliers.map((sp, s) => (
              <th key={s} colSpan={2} className={`${th} min-w-[230px] text-left ${s === lowNet ? "bg-emerald-50 dark:bg-emerald-900/20" : ""}`}>
                <div className="flex items-center gap-1">
                  <span className="shrink-0 rounded bg-[#0E7490]/10 px-1.5 py-0.5 text-[10px] text-[#0E7490]">S{s + 1}</span>
                  <div className="flex-1">
                    {readOnly ? <span className="font-medium">{sp.name}</span> : (
                      <GarageCombobox value={sp.name} garages={garages} onChange={(name) => patchSupplier(s, { name, garageId: garages.find((g) => g.name === name)?._id })} onCreated={onGarageCreated} placeholder={`Supplier ${s + 1}`} />
                    )}
                  </div>
                  {!readOnly && suppliers.length > 1 && (
                    <button type="button" onClick={() => removeSupplier(s)} title="ลบ supplier" className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                  )}
                </div>
                <input value={sp.note} disabled={readOnly} onChange={(e) => patchSupplier(s, { note: e.target.value })} placeholder="หมายเหตุ เช่น ราคานี้เป็นราคาซ่อมของเดิม" className={`${textInput} mt-1 text-xs font-normal`} />
                <select value={sp.vatMode} disabled={readOnly} onChange={(e) => patchSupplier(s, { vatMode: e.target.value as PcVatMode })} title="ฐานราคาที่เสนอ — ระบบ normalize ให้เทียบกันที่สุทธิ" className="mt-1 w-full rounded-md border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-1.5 py-0.5 text-[11px] font-normal">
                  {(Object.keys(VAT_MODE_LABEL) as PcVatMode[]).map((m) => <option key={m} value={m}>{VAT_MODE_LABEL[m]}</option>)}
                </select>
              </th>
            ))}
            {!readOnly && suppliers.length < MAX_SUPPLIERS && (
              <th className={`${th} w-10`}><button type="button" onClick={addSupplier} title="เพิ่ม supplier" className="rounded-md border border-dashed border-[#1B8C4B] p-1 text-[#1B8C4B] hover:bg-[#1B8C4B]/10"><Plus size={14} /></button></th>
            )}
          </tr>
          <tr className="text-[11px] text-gray-500">
            <th className={td} colSpan={4}></th>
            {suppliers.map((_, s) => (<><th key={`u${s}`} className={`${td} text-right`}>ราคา/หน่วย</th><th key={`t${s}`} className={`${td} text-right`}>ยอดรวม</th></>))}
            {!readOnly && suppliers.length < MAX_SUPPLIERS && <th className={td}></th>}
          </tr>
        </thead>
        <tbody>
          {items.map((it, r) => (
            <tr key={r} className="group">
              <td className={`${td} text-center text-xs text-gray-400`}>
                <div className="flex flex-col items-center">
                  <span>{r + 1}</span>
                  {!readOnly && (
                    <span className="hidden group-hover:flex flex-col">
                      <button type="button" onClick={() => moveItem(r, -1)} className="text-gray-300 hover:text-gray-600"><ArrowUp size={10} /></button>
                      <button type="button" onClick={() => moveItem(r, 1)} className="text-gray-300 hover:text-gray-600"><ArrowDown size={10} /></button>
                    </span>
                  )}
                </div>
              </td>
              <td className={td}><input value={it.name} disabled={readOnly} onChange={(e) => patchItem(r, { name: e.target.value })} placeholder="ชื่อรายการ" className={textInput} /></td>
              <td className={td}><input type="number" min={0} step="any" value={it.qty} disabled={readOnly} onChange={(e) => patchItem(r, { qty: parseFloat(e.target.value) || 0 })} className={cellInput} /></td>
              <td className={td}><input value={it.unit} disabled={readOnly} onChange={(e) => patchItem(r, { unit: e.target.value })} placeholder="หน่วย" className={textInput} /></td>
              {suppliers.map((sp, s) => {
                const p = sp.prices[r] ?? null
                const best = low[r] === s && p != null
                return (
                  <td key={s} colSpan={2} className={`${td} ${best ? "bg-emerald-50 dark:bg-emerald-900/20" : ""}`}>
                    <div className="flex items-center gap-1">
                      <input inputMode="decimal" value={p ?? ""} disabled={readOnly} onChange={(e) => setPrice(s, r, numOrNull(e.target.value))} placeholder="—" className={cellInput} />
                      <span className={`w-24 shrink-0 text-right text-xs tabular-nums ${best ? "font-semibold text-emerald-700" : "text-gray-500"}`}>{p != null ? fmtMoney(Math.round(it.qty * p * 100) / 100) : ""}</span>
                    </div>
                  </td>
                )
              })}
              {!readOnly && (
                <td className={`${td} text-center`}>{items.length > 1 && <button type="button" onClick={() => removeItem(r)} title="ลบแถว" className="text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>}</td>
              )}
            </tr>
          ))}
          {!readOnly && (
            <tr><td colSpan={4 + suppliers.length * 2 + 1} className="px-2 py-1.5">
              <button type="button" onClick={addItem} className="inline-flex items-center gap-1 text-xs font-medium text-[#1B8C4B] hover:underline"><Plus size={13} /> เพิ่มรายการ</button>
            </td></tr>
          )}
        </tbody>
        <tfoot className="text-sm">
          {([
            ["รวมราคา ก่อนภาษี", "subtotal", true], ["ส่วนลด", "discount", false], ["รวมราคาหลังส่วนลด", "afterDiscount", false], ["ภาษีมูลค่าเพิ่ม 7%", "vat", false], ["รวมราคาทั้งหมด (สุทธิ)", "net", true],
          ] as [string, keyof ReturnType<typeof supplierTotals>, boolean][]).map(([label, key, bold]) => (
            <tr key={key} className={bold ? "font-semibold" : ""}>
              <td colSpan={4} className={`${td} px-2 py-1 text-right text-xs text-gray-600 dark:text-gray-300`}>{label}</td>
              {suppliers.map((sp, s) => (
                <td key={s} colSpan={2} className={`${td} text-right tabular-nums ${key === "net" && s === lowNet ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20" : ""}`}>
                  {key === "discount" && !readOnly
                    ? <input inputMode="decimal" value={sp.discount || ""} onChange={(e) => patchSupplier(s, { discount: numOrNull(e.target.value) ?? 0 })} placeholder="0.00" className={cellInput} />
                    : key === "vat" && sp.vatMode !== "excl"
                    ? <span className="px-2 text-xs text-gray-400">{sp.vatMode === "none" ? "ไม่มี VAT" : `(รวมในราคา) ${fmtMoney(totals[s].vat)}`}</span>
                    : <span className="px-2">{fmtMoney(totals[s][key])}</span>}
                </td>
              ))}
              {!readOnly && suppliers.length < MAX_SUPPLIERS && <td className={td}></td>}
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  )
}
```

หมายเหตุ: `<>` fragment ภายใน `.map` ต้องมี key — เปลี่ยนเป็น `<Fragment key={s}>` (import `Fragment` จาก react) ถ้า eslint เตือน

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit -p . 2>&1 | grep price-compare-matrix; npx eslint components/price-compare-matrix.tsx`
Expected: ไม่มี error

- [ ] **Step 3: Commit**

```bash
git add components/price-compare-matrix.tsx
git commit -m "price-compare: matrix component รายการ×supplier + สรุปยอด + ไฮไลต์ราคาต่ำสุด"
```

---

### Task 9: ฟอร์มใบเทียบราคา (`components/price-compare-form.tsx`, `app/price-compare/[id]/page.tsx`)

**Files:**
- Create: `components/price-compare-form.tsx`
- Modify: `app/price-compare/[id]/page.tsx` (แทน placeholder)

**Interfaces:**
- Consumes: Task 1 (`PriceCompare, PcCommittee, PcFile, PcStatus, normalizeDoc, validateDoc, canTransition, isComplete, lowestNet, supplierTotals, fmtMoney, PC_STATUSES`), Task 3 API (`GET/PUT/DELETE /api/price-compare/[id]`, `GET .../log`), Task 6 (`GET .../pdf`), Task 7 (`StatusChip`), Task 8 (`PriceCompareMatrix`), `ImageUpload` + `SkuImage` จาก `@/components/image-upload` / `@/lib/media`, `GarageCombobox`/`Garage`, `DEPT_MASTER` จาก `@/lib/order-tracking`, `swalConfirm/swalDeleteConfirm/swalToast/swalError` จาก `@/lib/swal`
- Produces: route `/price-compare/[id]` ใช้งานได้ครบ (แก้ไข, บันทึก, เปลี่ยนสถานะ, ลบร่าง, ดาวน์โหลด PDF, ประวัติ)

- [ ] **Step 1: route**

```tsx
// app/price-compare/[id]/page.tsx
import { PriceCompareForm } from "@/components/price-compare-form"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PriceCompareForm id={id} />
}
```

- [ ] **Step 2: เขียน `components/price-compare-form.tsx`**

```tsx
"use client"
// components/price-compare-form.tsx — ฟอร์มใบเทียบราคาหน้าเดียวเลื่อนลง (pattern เดียวกับ repair-external)
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Save, FileDown, Trash2, Loader2, History, AlertTriangle } from "lucide-react"
import { ImageUpload } from "@/components/image-upload"
import type { SkuImage } from "@/lib/media"
import { inputCls, type Garage } from "@/components/garage-combobox"
import { PriceCompareMatrix } from "@/components/price-compare-matrix"
import { StatusChip } from "@/components/price-compare-list"
import { DEPT_MASTER } from "@/lib/order-tracking"
import { swalConfirm, swalDeleteConfirm, swalToast, swalError } from "@/lib/swal"
import { bkkToday } from "@/lib/bkk-time"
import {
  normalizeDoc, validateDoc, canTransition, isComplete, lowestNet, supplierTotals, fmtMoney,
  completeSupplierCount, isQuoteExpired, MIN_QUOTES,
  type PriceCompare, type PcCommittee, type PcStatus, type PcConditions,
} from "@/lib/price-compare"

type LogRow = { _id: string; action: string; by: string; at: string; statusChange?: { from: string; to: string }; changes?: { label: string; from: string; to: string }[] }

const COND_FIELDS: [keyof PcConditions, string][] = [
  ["payment", "(1) เงื่อนไขการชำระเงิน"], ["leadTime", "(2) ระยะเวลาส่งมอบหลังรับ PO"], ["warranty", "(3) เงื่อนไขการรับประกัน"],
  ["remark", "หมายเหตุ (ถ้ามี)"], ["bays", "(4) จำนวนช่องซ่อมที่อู่มี"], ["menaTrucksIn", "(5) จำนวนรถ Mena ที่เข้าซ่อมอยู่"],
  ["statusA", "(6) สถานะ ขA (คัน)"], ["statusB", "(6) สถานะ ขB (คัน)"],
]
const NEXT_STATUS: Record<PcStatus, { to: PcStatus; label: string }[]> = {
  "ร่าง":      [{ to: "รอลงนาม", label: "ส่งลงนาม" }],
  "รอลงนาม":   [{ to: "เสร็จสิ้น", label: "ปิดใบ (ลงนามครบ)" }, { to: "ร่าง", label: "ถอยกลับเป็นร่าง" }],
  "เสร็จสิ้น": [{ to: "รอลงนาม", label: "เปิดแก้ไข" }],
}
const fmtDT = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}` : "")

function Card({ title, color, children }: { title: string; color: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] p-4" style={{ borderTopColor: color, borderTopWidth: 3 }}>
      <h2 className="mb-3 text-sm font-bold" style={{ color, fontFamily: "'Mitr', sans-serif" }}>{title}</h2>
      {children}
    </section>
  )
}
const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block text-xs text-gray-500 dark:text-gray-400">{label}<div className="mt-1">{children}</div></label>
)

export function PriceCompareForm({ id }: { id: string }) {
  const router = useRouter()
  const [doc, setDoc] = useState<PriceCompare | null>(null)
  const [saved, setSaved] = useState<string>("")           // JSON ล่าสุดที่บันทึกแล้ว เพื่อรู้ว่า dirty
  const [garages, setGarages] = useState<Garage[]>([])
  const [logs, setLogs] = useState<LogRow[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const uploadKey = useRef(0)

  const load = useCallback(async () => {
    const r = await fetch(`/api/price-compare/${id}`)
    if (!r.ok) { swalError("ไม่พบใบเทียบราคา"); router.push("/price-compare"); return }
    const d = normalizeDoc(await r.json())
    setDoc(d); setSaved(JSON.stringify(d)); uploadKey.current++
  }, [id, router])
  useEffect(() => { load() }, [load])
  useEffect(() => { fetch("/api/garage-master").then((r) => r.json()).then((g) => setGarages(Array.isArray(g) ? g.map((x) => ({ _id: String(x._id), name: x.name })) : [])) }, [])
  const loadLogs = useCallback(() => fetch(`/api/price-compare/${id}/log`).then((r) => r.json()).then(setLogs), [id])
  useEffect(() => { if (showLog && logs === null) loadLogs() }, [showLog, logs, loadLogs])

  const dirty = doc !== null && JSON.stringify(doc) !== saved
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = "" } }
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h)
  }, [dirty])

  const patch = (p: Partial<PriceCompare>) => setDoc((d) => (d ? { ...d, ...p } : d))
  const patchSupplier = (s: number, p: Partial<PriceCompare["suppliers"][number]>) => setDoc((d) => d && ({ ...d, suppliers: d.suppliers.map((sp, i) => (i === s ? { ...sp, ...p } : sp)) }))
  const patchCommittee = (i: number, p: Partial<PcCommittee>) => setDoc((d) => d && ({ ...d, committee: d.committee.map((m, k) => (k === i ? { ...m, ...p } : m)) }))

  const readOnly = doc?.status === "เสร็จสิ้น"
  const today = bkkToday()
  const lowNet = useMemo(() => (doc ? lowestNet(doc) : null), [doc])
  const fullCount = useMemo(() => (doc ? completeSupplierCount(doc) : 0), [doc])
  const completeness = useMemo(() => (doc ? isComplete(doc) : { ok: false, missing: [] }), [doc])

  async function save(nextStatus?: PcStatus): Promise<boolean> {
    if (!doc) return false
    const body = { ...doc, status: nextStatus ?? doc.status }
    const errs = validateDoc(normalizeDoc(body))
    if (errs.length) { swalError(errs.join("\n")); return false }
    if (nextStatus) {
      const tr = canTransition(doc.status, nextStatus, normalizeDoc(body))
      if (!tr.ok) { swalError(tr.reason ?? "เปลี่ยนสถานะไม่ได้"); return false }
    }
    setSaving(true)
    try {
      const r = await fetch(`/api/price-compare/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "บันทึกไม่สำเร็จ")
      const n = normalizeDoc(d); setDoc(n); setSaved(JSON.stringify(n)); setLogs(null)
      swalToast("success", nextStatus ? `เปลี่ยนสถานะเป็น ${nextStatus}` : "บันทึกแล้ว")
      return true
    } catch (e) { swalError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ"); return false }
    finally { setSaving(false) }
  }

  async function changeStatus(to: PcStatus, label: string) {
    const ok = await swalConfirm(`${label}?`, to === "เสร็จสิ้น" ? "หลังปิดใบจะแก้ไขไม่ได้ จนกว่าจะกดเปิดแก้ไข (ครั้งที่แก้ไข +1)" : undefined)
    if (ok.isConfirmed) await save(to)
  }
  async function remove() {
    const ok = await swalDeleteConfirm(`ลบใบ ${doc?.docNo} (ร่าง) — ลบแล้วเลขที่นี้จะไม่ถูกนำกลับมาใช้`)
    if (!ok.isConfirmed) return
    const r = await fetch(`/api/price-compare/${id}`, { method: "DELETE" })
    if (!r.ok) { swalError((await r.json()).error || "ลบไม่สำเร็จ"); return }
    setSaved(JSON.stringify(doc)); router.push("/price-compare")
  }
  async function downloadPdf() {
    if (dirty) { const ok = await swalConfirm("มีการแก้ไขที่ยังไม่บันทึก", "บันทึกก่อนสร้าง PDF?"); if (!ok.isConfirmed) return; if (!(await save())) return }
    setPdfBusy(true)
    try {
      const r = await fetch(`/api/price-compare/${id}/pdf`)
      if (!r.ok) throw new Error((await r.json()).error || "สร้าง PDF ไม่สำเร็จ")
      const failed = parseInt(r.headers.get("X-Attachments-Failed") || "0", 10)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank")
      if (failed > 0) swalToast("warning", `แนบไฟล์ไม่ได้ ${failed} ไฟล์ (ดูหน้าสุดท้ายของ PDF)`)
    } catch (e) { swalError(e instanceof Error ? e.message : "สร้าง PDF ไม่สำเร็จ") }
    finally { setPdfBusy(false) }
  }

  if (!doc) return <div className="p-8 text-center text-gray-400"><Loader2 className="inline animate-spin" /> กำลังโหลด…</div>
  const N = doc.suppliers.length

  return (
    <div className="w-full px-4 py-4" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
      {/* หัว sticky */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-[#EEF2F0] dark:border-white/8 bg-white/90 dark:bg-[#0f1117]/90 px-4 py-2 backdrop-blur">
        <button onClick={() => router.push("/price-compare")} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"><ArrowLeft size={18} /></button>
        <span className="font-mono text-sm font-semibold">{doc.docNo}</span>
        <span className="truncate text-sm text-gray-600 dark:text-gray-300">{doc.title || "(ยังไม่ระบุชื่องาน)"}</span>
        <StatusChip status={doc.status} />
        {dirty && <span className="text-xs text-amber-600">● ยังไม่บันทึก</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={() => setShowLog((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs dark:border-white/10"><History size={14} /> ประวัติ</button>
          <button onClick={downloadPdf} disabled={pdfBusy} className="inline-flex items-center gap-1 rounded-lg border border-[#0E7490] px-3 py-1.5 text-xs font-semibold text-[#0E7490] hover:bg-[#0E7490]/10 disabled:opacity-60">
            {pdfBusy ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} ดาวน์โหลด PDF
          </button>
          {NEXT_STATUS[doc.status].map((n) => (
            <button key={n.to} onClick={() => changeStatus(n.to, n.label)} disabled={saving} className="rounded-lg border px-3 py-1.5 text-xs font-semibold dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5">{n.label}</button>
          ))}
          {!readOnly && (
            <button onClick={() => save()} disabled={saving || !dirty} className="inline-flex items-center gap-1 rounded-lg bg-[#1B8C4B] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} บันทึก
            </button>
          )}
        </div>
      </div>

      {showLog && (
        <Card title="ประวัติ" color="#6B7280">
          {logs === null ? <p className="text-xs text-gray-400">กำลังโหลด…</p> : logs.length === 0 ? <p className="text-xs text-gray-400">ยังไม่มีประวัติ</p> : (
            <ul className="space-y-1 text-xs">
              {logs.map((l) => (
                <li key={l._id} className="flex flex-wrap gap-x-2 border-b border-dashed border-gray-100 dark:border-white/5 py-1">
                  <span className="text-gray-400">{fmtDT(String(l.at))}</span><span className="font-medium">{l.by}</span>
                  <span>{l.action === "create" ? "สร้างใบ" : l.action === "delete" ? "ลบ" : l.statusChange ? `สถานะ ${l.statusChange.from} → ${l.statusChange.to}` : "แก้ไข"}</span>
                  {l.changes?.map((c, i) => <span key={i} className="text-gray-500">· {c.label}: {c.from || "—"} → {c.to || "—"}</span>)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="mt-4 space-y-4">
        <Card title="1. หัวเอกสาร" color="#1B8C4B">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="ชื่อสินค้า / งานซ่อม *"><input value={doc.title} disabled={readOnly} onChange={(e) => patch({ title: e.target.value })} className={inputCls} placeholder="เช่น Pump + Motor UH03" /></Field>
            <Field label="หน่วยงานที่ร้องขอ">
              <input list="pc-depts" value={doc.requestDept} disabled={readOnly} onChange={(e) => patch({ requestDept: e.target.value })} className={inputCls} placeholder="เช่น ยานยนต์" />
              <datalist id="pc-depts">{DEPT_MASTER.map((d) => <option key={d} value={d} />)}</datalist>
            </Field>
            <Field label="ผู้จัดทำ"><input value={doc.preparedBy.name} disabled className={`${inputCls} opacity-70`} /></Field>
            <Field label="วันที่เริ่มจัดทำ"><input value={fmtDT(doc.createdAt)} disabled className={`${inputCls} opacity-70`} /></Field>
            <Field label="ครั้งที่แก้ไข / แก้ไขล่าสุด"><input value={`${doc.revision} · ${fmtDT(doc.updatedAt)}`} disabled className={`${inputCls} opacity-70`} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="PR (ถ้ามี)"><input value={doc.links.prCode ?? ""} disabled={readOnly} onChange={(e) => patch({ links: { ...doc.links, prCode: e.target.value } })} className={inputCls} /></Field>
              <Field label="ทะเบียนรถ"><input value={doc.links.plate ?? ""} disabled={readOnly} onChange={(e) => patch({ links: { ...doc.links, plate: e.target.value } })} className={inputCls} /></Field>
              <Field label="เบอร์รถ"><input value={doc.links.fleetNo ?? ""} disabled={readOnly} onChange={(e) => patch({ links: { ...doc.links, fleetNo: e.target.value } })} className={inputCls} /></Field>
            </div>
          </div>
        </Card>

        <Card title="2. ตารางเทียบราคา" color="#EA580C">
          <PriceCompareMatrix doc={doc} garages={garages} onGarageCreated={(g) => setGarages((gs) => [...gs, g])} onChange={(p) => patch(p)} readOnly={readOnly} />
        </Card>

        <Card title="3. เงื่อนไขในการคัดเลือก" color="#2563EB">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr><th className="px-2 py-1 text-left text-xs text-gray-500">เงื่อนไข</th>{doc.suppliers.map((s, i) => <th key={i} className="px-2 py-1 text-left text-xs text-gray-500">S{i + 1} {s.name}</th>)}</tr></thead>
              <tbody>
                {COND_FIELDS.map(([key, label]) => (
                  <tr key={key} className="border-t border-[#EEF2F0] dark:border-white/8">
                    <td className="px-2 py-1 text-xs">{label}</td>
                    {doc.suppliers.map((s, i) => (
                      <td key={i} className="px-1 py-0.5"><input value={s.conditions[key]} disabled={readOnly} onChange={(e) => patchSupplier(i, { conditions: { ...s.conditions, [key]: e.target.value } })} className={inputCls} /></td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-[#EEF2F0] dark:border-white/8">
                  <td className="px-2 py-1 text-xs">(7) วันที่ใบเสนอราคา</td>
                  {doc.suppliers.map((s, i) => <td key={i} className="px-1 py-0.5"><input type="date" value={s.quoteDate} disabled={readOnly} onChange={(e) => patchSupplier(i, { quoteDate: e.target.value })} className={inputCls} /></td>)}
                </tr>
                <tr className="border-t border-[#EEF2F0] dark:border-white/8">
                  <td className="px-2 py-1 text-xs">ใบเสนอราคาใช้ได้ถึง</td>
                  {doc.suppliers.map((s, i) => (
                    <td key={i} className="px-1 py-0.5">
                      <input type="date" value={s.validUntil} disabled={readOnly} onChange={(e) => patchSupplier(i, { validUntil: e.target.value })} className={`${inputCls} ${isQuoteExpired(s, today) ? "border-red-400" : ""}`} />
                      {isQuoteExpired(s, today) && <p className="mt-0.5 text-[11px] text-red-600">⚠ หมดอายุแล้ว — ขอใบใหม่ก่อนอนุมัติ</p>}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="4. หลักฐาน (ใบเสนอราคา / แชท LINE)" color="#0891B2">
          <div className="grid gap-4 md:grid-cols-2">
            {doc.suppliers.map((s, i) => (
              <div key={`${i}-${uploadKey.current}`} className="rounded-xl border border-dashed border-[#E2E8E4] dark:border-white/10 p-3">
                <p className="mb-2 text-xs font-semibold">ใบเสนอราคา Supplier {i + 1} — {s.name || "(ยังไม่ระบุ)"} <span className="font-normal text-gray-400">รูปหรือ PDF</span></p>
                <ImageUpload initial={s.quotationFiles as SkuImage[]} disabled={readOnly} max={10} onChange={(imgs) => patchSupplier(i, { quotationFiles: imgs })} />
              </div>
            ))}
            <div key={`ev-${uploadKey.current}`} className="rounded-xl border border-dashed border-[#E2E8E4] dark:border-white/10 p-3">
              <p className="mb-2 text-xs font-semibold">หลักฐานอื่น <span className="font-normal text-gray-400">เช่น แคปแชท LINE</span></p>
              <ImageUpload initial={doc.evidenceFiles as SkuImage[]} disabled={readOnly} max={10} onChange={(imgs) => patch({ evidenceFiles: imgs })} />
            </div>
          </div>
        </Card>

        <Card title="5. คณะกรรมการพิจารณาคัดเลือก" color="#7C3AED">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {doc.committee.map((m, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-[#EEF2F0] dark:border-white/8 p-3">
                <Field label="ตำแหน่ง"><input value={m.role} disabled={readOnly} onChange={(e) => patchCommittee(i, { role: e.target.value })} className={inputCls} /></Field>
                <Field label="ชื่อ"><input value={m.name} disabled={readOnly} onChange={(e) => patchCommittee(i, { name: e.target.value })} className={inputCls} /></Field>
                <Field label="Email (ไม่บังคับ)"><input value={m.email ?? ""} disabled={readOnly} onChange={(e) => patchCommittee(i, { email: e.target.value })} className={inputCls} /></Field>
                <Field label="เลือก supplier ลำดับที่">
                  <select value={m.pickedSupplier ?? ""} disabled={readOnly} onChange={(e) => patchCommittee(i, { pickedSupplier: e.target.value ? Number(e.target.value) : null })} className={inputCls}>
                    <option value="">—</option>{doc.suppliers.map((s, k) => <option key={k} value={k + 1}>{k + 1}. {s.name}</option>)}
                  </select>
                </Field>
                <Field label="เหตุผลในการเลือก"><textarea value={m.reason} disabled={readOnly} onChange={(e) => patchCommittee(i, { reason: e.target.value })} rows={2} className={inputCls} /></Field>
                <Field label="วันที่ลงนาม"><input type="date" value={m.signedDate} disabled={readOnly} onChange={(e) => patchCommittee(i, { signedDate: e.target.value })} className={inputCls} /></Field>
              </div>
            ))}
          </div>
        </Card>

        <Card title="6. สรุปผล — ผู้ได้รับเลือก" color="#DC2626">
          <div className="flex flex-wrap gap-3">
            {doc.suppliers.map((s, i) => (
              <label key={i} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-sm ${doc.selectedSupplier === i + 1 ? "border-[#1B8C4B] bg-[#1B8C4B]/5" : "border-[#EEF2F0] dark:border-white/8"}`}>
                <input type="radio" name="selected" disabled={readOnly} checked={doc.selectedSupplier === i + 1} onChange={() => patch({ selectedSupplier: i + 1 })} />
                <span className="font-medium">Supplier {i + 1}</span><span>{s.name}</span>
                <span className="tabular-nums text-gray-500">{fmtMoney(supplierTotals(doc, i).net)}</span>
                {i === lowNet && <span className="rounded bg-emerald-100 px-1.5 text-[10px] text-emerald-700">ถูกสุด</span>}
              </label>
            ))}
          </div>
          {doc.selectedSupplier != null && lowNet != null && doc.selectedSupplier !== lowNet + 1 && (
            <div className="mt-3">
              <p className="mb-1 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle size={13} /> เลือกรายที่ไม่ใช่สุทธิต่ำสุด — ต้องระบุเหตุผลก่อนส่งลงนาม</p>
              <textarea value={doc.selectionReason} disabled={readOnly} onChange={(e) => patch({ selectionReason: e.target.value })} rows={2} placeholder="เช่น ของใหม่ มือ 1 รับประกัน 1 ปี / ส่งมอบเร็วกว่า 10 วัน" className={inputCls} />
            </div>
          )}
          {fullCount < MIN_QUOTES && (
            <div className="mt-3">
              <p className="mb-1 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle size={13} /> มีใบเสนอราคาที่ราคาครบเพียง {fullCount} ราย (เกณฑ์ {MIN_QUOTES} ราย) — ต้องระบุเหตุผล</p>
              <textarea value={doc.fewerQuotesReason} disabled={readOnly} onChange={(e) => patch({ fewerQuotesReason: e.target.value })} rows={2} placeholder="เช่น ผู้ขายที่รับงานนี้มีรายเดียว / อีกรายไม่ตอบกลับภายในกำหนด" className={inputCls} />
            </div>
          )}
          {!completeness.ok && <p className="mt-2 text-xs text-gray-500">ยังขาด: {completeness.missing.join(", ")}</p>}
          {doc.status === "ร่าง" && (
            <button onClick={remove} className="mt-4 inline-flex items-center gap-1 text-xs text-red-600 hover:underline"><Trash2 size={13} /> ลบใบร่างนี้</button>
          )}
        </Card>
      </div>
    </div>
  )
}
```

`N` ที่ประกาศแล้วไม่ได้ใช้ → ลบบรรทัด `const N = doc.suppliers.length` ออกก่อน lint

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit -p . 2>&1 | grep price-compare; npx eslint components/price-compare-form.tsx app/price-compare`
Expected: ไม่มี error

- [ ] **Step 4: ทดสอบในเบราว์เซอร์ (dev server)**

1. `/price-compare` → สร้างใบ → เข้าฟอร์ม: กรอกชื่องาน, เพิ่มรายการ 3 แถว, เพิ่ม Supplier เป็น 3 ราย (เลือกอู่จาก combobox + เพิ่มอู่ใหม่ 1 ราย), ใส่ราคา → เห็นเซลล์เขียวที่ราคาต่ำสุดต่อแถวและสุทธิต่ำสุด, ยอด VAT ตรงกับที่คำนวณมือ
2. กด "ส่งลงนาม" ก่อนเลือกผู้ได้รับเลือก → ถูกปฏิเสธพร้อมเหตุผล; เลือกรายแพงกว่าโดยไม่ใส่เหตุผล → ถูกปฏิเสธ; ใส่เหตุผลแล้วส่งได้ → chip เป็น รอลงนาม; ลอง supplier 2 ราย → ต้องกรอกเหตุผลน้อยกว่า 3 ราย; ตั้ง Supplier 2 เป็น "รวม VAT แล้ว" → สุทธิไม่บวก 7%; ใส่ "ใช้ได้ถึง" เป็นวันที่ผ่านมาแล้ว → ป้ายหมดอายุ
3. อัปโหลดรูป 1 ไฟล์ + PDF 1 ไฟล์ให้ Supplier 1 → บันทึก → รีเฟรชแล้วไฟล์ยังอยู่
4. กรอกชื่อ + วันที่ลงนามครบ 4 → "ปิดใบ" → ฟอร์มล็อก → "เปิดแก้ไข" → ครั้งที่แก้ไขเป็น 1
5. "ดาวน์โหลด PDF" → เปิดแท็บใหม่ หน้า 1 ตรงฟอร์ม, หน้าถัดไปคือรูปและ PDF ที่แนบ
6. ปุ่ม "ประวัติ" แสดง create / update / status ครบ
7. สร้างใบใหม่อีกใบแล้ว "ลบใบร่างนี้" → กลับหน้ารายการ ไม่มีใบนั้น

- [ ] **Step 5: Commit**

```bash
git add components/price-compare-form.tsx "app/price-compare/[id]/page.tsx"
git commit -m "price-compare: ฟอร์มใบเทียบราคา (หัวเอกสาร/matrix/เงื่อนไข/หลักฐาน/กรรมการ/สรุป/ประวัติ)"
```

---

### Task 10: Seed ใบตัวอย่าง UH03, build, ตรวจ Vercel preview

**Files:**
- Create: `scripts/seed-price-compare-uh03.mjs`

**Interfaces:**
- Consumes: DB collection `price_compare` (schema Task 1), `counters`

- [ ] **Step 1: เขียน seed script**

```js
// scripts/seed-price-compare-uh03.mjs — ใบตัวอย่างจากต้นแบบ PC-2609-002 เพื่อเทียบ PDF กับกระดาษ
// รัน: node scripts/seed-price-compare-uh03.mjs [--clear]   (ลบเฉพาะ source:"seed-uh03" ก่อนใส่ใหม่)
import { MongoClient } from "mongodb"
import fs from "node:fs"

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")] }))
const client = new MongoClient(env.MONGO_URI)
await client.connect()
const db = client.db(env.MONGO_DB || "master_data")
const col = db.collection("price_compare")
await col.deleteMany({ source: "seed-uh03" })
if (process.argv.includes("--clear")) { console.log("cleared"); await client.close(); process.exit(0) }

const cond = (o = {}) => ({ payment: "", leadTime: "", warranty: "", remark: "", bays: "", menaTrucksIn: "", statusA: "", statusB: "", ...o })
const sup = (name, note, prices, extra = {}, q = {}) => ({ name, note, prices, discount: 0, vatMode: "excl", quoteDate: "", validUntil: "", ...q, conditions: cond(extra), quotationFiles: [] })
const now = new Date("2026-09-07T15:30:00+07:00").toISOString().replace("Z", "+07:00")
const doc = {
  source: "seed-uh03",
  docNo: "PC-2609-002", title: "Pump + Motor UH03", requestDept: "ยานยนต์",
  preparedBy: { name: "นพรัตน์ อายยืน", email: "" }, revision: 0, createdAt: now, updatedAt: now, status: "รอลงนาม",
  items: [
    { name: "Pump Rexroth", qty: 1, unit: "ตัว" }, { name: "Motor Rexroth", qty: 1, unit: "ตัว" },
    { name: "น้ำมัน HYD.", qty: 18, unit: "ลิตร" }, { name: "น้ำมันเกียร์", qty: 10, unit: "ลิตร" },
    { name: "ค่าแรงซ่อม+ประกอบทดสอบ", qty: 1, unit: "งาน" },
  ],
  suppliers: [
    sup("ช่างหมู", "ราคานี้เป็นราคาซ่อม Pump + Motor ของเดิมติดรถ", [21000, 18900, 110.56, 180, 7000]),
    sup("คุณณัฐ", "ราคานี้เป็นราคาเปลี่ยน Pump + Motor ใหม่ มือ 1", [30000, 18000, 100, 100, 5500], {}, { quoteDate: "2026-09-03", validUntil: "2026-10-03" }),
    sup("ศศ&ณ", "ราคานี้เป็นราคาเปลี่ยน Pump + Motor ใหม่ มือ 2", [30000, 25000, 107.14, 107.14, 5000]),
  ],
  committee: [
    { role: "หัวหน้าฝ่ายยานยนต์", name: "คุณเสถียรพงษ์ ชะเอมจันทร์", email: "", pickedSupplier: 1, reason: "", signedDate: "2026-09-07" },
    { role: "ผจก.ฝ่ายยานยนต์", name: "บุญภัก พรหมมา", email: "", pickedSupplier: 1, reason: "", signedDate: "2026-09-07" },
    { role: "ผจก.ฝ่ายจัดซื้อ", name: "", email: "", pickedSupplier: null, reason: "", signedDate: "" },
    { role: "ผู้อำนวยการสายงานธุรกิจ", name: "คุณนัชภัค ขจรวุฒิเดช", email: "", pickedSupplier: 1, reason: "", signedDate: "2026-09-07" },
  ],
  selectedSupplier: 1, selectionReason: "", fewerQuotesReason: "", links: { fleetNo: "UH03" }, evidenceFiles: [],
  createdBy: "seed", editedBy: "seed",
}
// ถ้าเลขที่ชนกับใบจริง (unique index) ให้ต่อท้าย -SEED
try { const r = await col.insertOne(doc); console.log("inserted", r.insertedId) }
catch { const r = await col.insertOne({ ...doc, docNo: "PC-2609-002-SEED" }); console.log("inserted (docNo suffixed)", r.insertedId) }
await client.close()
```

- [ ] **Step 2: ถามผู้ใช้ก่อนรัน seed (เขียน prod DB)** แล้วรัน `node scripts/seed-price-compare-uh03.mjs` → เปิดใบใน `/price-compare` → ดาวน์โหลด PDF → วางเทียบกับ `~/Documents/project/ใบเทียบราคางานซ่อม Pump + Motor UH03.pdf` หน้า 1 ทีละช่อง (หัว, ชื่อ supplier, ราคา, หมายเหตุ, สรุปยอด, กรรมการ, ช่องติ๊ก) จดส่วนต่างที่พบแล้วแก้ `lib/price-compare-pdf.ts` จนใกล้เคียง

- [ ] **Step 3: Build + ทดสอบทั้งชุด**

```bash
npx tsx scripts/check-price-compare-core.ts
npx tsx scripts/check-pdfmake-printer.ts
npx tsx scripts/check-price-compare-pdf.ts
npm run lint
npm run build
```
Expected: ทุก check ผ่าน, build ไม่มี error (ถ้า Turbopack import `pdfmake/js/Printer` ไม่ได้ → ตรวจว่า `serverExternalPackages: ["pdfmake", "sharp"]` อยู่ใน next.config.ts และลอง `import Printer from "pdfmake/js/Printer.js"`)

- [ ] **Step 4: Commit + ถามเรื่อง push**

```bash
git add scripts/seed-price-compare-uh03.mjs lib/price-compare-pdf.ts
git commit -m "price-compare: seed ใบตัวอย่าง UH03 + ปรับ layout PDF ให้ตรงต้นแบบ"
```
จากนั้น **ถามผู้ใช้ก่อน `git push`** — push ไป main = deploy prod ทันที; แนะนำ push แล้วเปิด PDF บน Vercel เพื่อยืนยันว่าฟอนต์ถูก trace (ถ้าไม่ จะได้ 500 "ENOENT fonts/…" → ตรวจ `outputFileTracingIncludes`)

- [ ] **Step 5: อัปเดต memory**

บันทึกใน `proj_master_sku_web.md`: โมดูล price-compare (collection, docNo counter, pdfmake stack ที่ยกมาจาก mena-partner, กับดัก Turbopack/fonts tracing ที่เจอจริง)
