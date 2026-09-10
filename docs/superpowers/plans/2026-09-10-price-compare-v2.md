# ใบเทียบราคา v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ตัด multi-grade ที่หลุดขึ้น production ออก, ทำ "เลือก supplier รายบรรทัด" ให้ครบ (UI/PDF/list/log + ทดสอบ), และเพิ่ม picker รหัสสินค้า ATMS ในช่องรายการ

**Architecture:** ต่อยอดโค้ด v1 + ร่าง lineSupplier ที่อยู่บน main (`lib/price-compare.ts` pure → API → matrix/form → pdfmake). โหมดผสม = ทุกแถวมี `lineSupplier` (ไม่มี selectionMode แยก). ทุกยอดรวมมาจากฟังก์ชัน pure เดียวกัน (`mixedTotals`).

**Tech Stack:** Next.js 16 · React 19 · Tailwind 4 · MongoDB 7 · pdfmake 0.3 · tsx assert scripts

**Spec:** `docs/superpowers/specs/2026-09-10-price-compare-v2-design.md` (สถานะอนุมัติ) + v1 spec `docs/superpowers/specs/2026-09-08-price-compare-design.md`

## Global Constraints

- ทำงานเฉพาะ worktree `~/Documents/project/master-sku-web-pc` branch `feat/price-compare-v2` (จาก origin/main d5b3a3b) — **ห้ามแตะ** `~/Documents/project/master-sku-web` (session อื่นใช้)
- `lib/price-compare.ts` ห้าม import อะไร; ทุกยอดรวมผ่านฟังก์ชันใน lib (UI/PDF/API ห้ามคิดเอง)
- ไม่มี test framework: `npx tsx scripts/check-price-compare-core.ts`, `check-pdfmake-printer.ts`, `check-price-compare-pdf.ts`; API: dev server + `TOKEN=$(npx tsx scripts/mint-session-token.ts)` + `bash scripts/check-price-compare-api.sh`; lint/tsc ต้อง clean บนไฟล์ที่แตะ
- โหมดผสม: ส่วนลดไม่ปันส่วน (=0), VAT ต่อ supplier ตาม vatMode, `selectionReason` บังคับเมื่อแถวใดไม่เลือกถูกสุด, MIN_QUOTES นับ supplier ที่ราคาครบ
- `components/vendor-combobox.tsx` และ AVL logic ของ session อื่น — คงไว้ ห้ามแก้
- เอกสารเก่าที่มี `extraOptions` ต้องโหลดได้ (normalizeDoc ทิ้ง field เงียบๆ)
- swal แทน alert/confirm; วันที่ผ่าน bkk-time; ทุก API ต้องมี session
- Commit ทุก task; ห้าม push

---

### Task 1: ตัด multi-grade ออก + ทำ core โหมดผสมให้ครบและทดสอบ

**Files:** Modify `lib/price-compare.ts`, `components/price-compare-matrix.tsx` (เฉพาะส่วน extraOptions/Star — UI ใหม่ทำใน Task 3), `scripts/check-price-compare-core.ts`
**Produces (lib):**
```ts
export type PcMixedTotals = { perSupplier: { subtotal: number; vat: number; net: number; lines: number }[]; grand: number; suppliersUsed: number }
export function mixedTotals(doc: Pick<PriceCompare, "items"|"suppliers"|"selectedSupplier"|"lineSupplier">): PcMixedTotals | null  // null ถ้าแถวใดไม่มี supplier ที่ใช้ได้ (effectiveLineSupplier null หรือราคา null)
export function bestMixNet(doc): number | null   // ต่อแถวเลือกเจ้าที่ให้ net ต่ำสุด "หลัง VAT ตาม vatMode ของเจ้านั้น" (แก้ถ้าปัจจุบันเทียบก่อน VAT)
export function pickLowestPerLine(doc): (number|null)[]   // lineSupplier ใหม่ = supplier ถูกสุด (หลัง VAT) ต่อแถว 1-based
```
- ลบ `PcPriceOption`, `extraOptions`, `addPriceOption/removePriceOption/updatePriceOption/promotePriceOption`, `lineNetFor` (ถ้าไม่มีใครใช้หลังลบ) — grep ทั้ง repo ให้แน่ใจว่าไม่มี import ค้าง; normalizeDoc ไม่สร้าง extraOptions และไม่พังเมื่อ input มี
- `mixedNet(doc)` = `mixedTotals(doc)?.grand ?? null` (คง export เดิมไว้ให้ form ใช้ต่อ)
- isComplete/validateDoc: คงกฎ; เพิ่ม validate ว่า lineSupplier[i] ชี้ไป supplier ที่มีราคาในแถว i (ไม่งั้น error "แถว N: เจ้าที่เลือกไม่ได้เสนอราคา")
- Tests (ต่อท้าย check script, ใช้ fixture uh03()): mixedTotals กับ lineSupplier [1,2,2,2,3] → perSupplier[0].subtotal 21000, vat 1470, net 22470; [1] subtotal 18000+1800+1000=20800 → net 22256; [2] 5000 → 5350; grand 50076; suppliersUsed 3; ทดสอบ vatMode incl/none ในโหมดผสม; bestMixNet = grand ของ pickLowestPerLine; null เมื่อแถวใดไม่มี supplier; normalizeDoc ทิ้ง extraOptions; validateDoc ปฏิเสธ lineSupplier ชี้เจ้าที่ราคา null; isComplete ผ่านเมื่อ allLinesAwarded + selectionReason เมื่อไม่ถูกสุด
- Commit: `price-compare v2: remove multi-grade, add mixedTotals/pickLowestPerLine + tests`

### Task 2: SKU picker (ATMS รหัสสินค้า)

**Files:** Create `app/api/price-compare/sku-search/route.ts`, `components/sku-picker.tsx`; Modify `lib/price-compare.ts` (PcItem.sku?), `components/price-compare-matrix.tsx` (ช่องรายการ), `scripts/check-price-compare-core.ts`, `scripts/check-price-compare-api.sh`
- API: session required; `q` < 2 ตัว → `[]`; aggregate บน `master_data.atms_sku_master`: `$match { $or: [{ code: { $regex: "^"+escape(q), $options: "i" } }, { name: { $regex: escape(q), $options: "i" } }] }` → `$group { _id: "$code", name: {$first}, group: {$first}, unit: {$first} }` → `$sort { _id: 1 }` → `$limit 20` → `$project { _id: 0, code: "$_id", name, group, unit }`; ตัด code "-" ออก
- `PcItem.sku?: string` — normalizeDoc `str(it?.sku) || undefined`; validateDoc ไม่บังคับ
- `SkuPicker` props `{ value: string; onChange(name: string): void; onPick(hit: { code; name; group; unit }): void; disabled?: boolean; className?: string }` — debounce 250 ms, dropdown แสดง `code · name · group`, ปุ่มเลือกด้วยเมาส์/Enter/↑↓, Esc ปิด, คลิกนอกปิด, ไม่มีผลลัพธ์ → "ไม่พบสินค้า"; ใช้ fetch `/api/price-compare/sku-search?q=`
- Matrix: แทน input ชื่อรายการด้วย SkuPicker; onPick → `patchItem(r, { name: `${code} : ${name}`, unit: it.unit || unit, sku: code })`; onChange (พิมพ์เอง) → `patchItem(r, { name, sku: undefined })`; แสดง chip `SKU` เล็กเมื่อ `it.sku`
- Tests: core (normalizeDoc sku); api script เพิ่ม `sku-search?q=น้ำมัน` (200, array ≤20, ไม่มี code ซ้ำ), `?q=x` (200 []), ไม่มี session 401
- Commit: `price-compare v2: ATMS SKU picker in item cell + sku-search API`

### Task 3: matrix/form UX โหมดผสม

**Files:** Modify `components/price-compare-matrix.tsx`, `components/price-compare-form.tsx`
- ทุกเซลล์ราคาที่ `p != null` มี `<input type="radio" name={`line-${r}`}>` (aria-label "ใช้ Supplier N สำหรับแถว r") ที่ set/unset `lineSupplier[r]` (คลิกซ้ำ = ล้าง); เซลล์ที่เลือก: พื้น `bg-emerald-100 dark:bg-emerald-900/40` + ✓ ตัวหนา; readOnly → radio disabled
- ปุ่มใต้ตาราง (ไม่ readOnly): "เลือกถูกสุดทุกแถว" (`pickLowestPerLine`) และ "ล้างการเลือกรายแถว"
- footer เพิ่มแถว "ยอดที่เลือกจากเจ้านี้ (ก่อน VAT)" และ "สุทธิที่เลือก" จาก `mixedTotals` เมื่อมีแถวที่เลือก ≥1; ช่องท้ายสุดของแถว "สุทธิที่เลือก" แสดง grand
- §6 สรุปผล: ถ้า `allLinesAwarded` → ซ่อน radio ทั้งใบ, แสดงการ์ด "เลือกรายบรรทัด: สุทธิรวมแบบผสม X · ต่ำสุดที่เป็นไปได้ Y (+Z บาท)" + หมายเหตุส่วนลดไม่ปันส่วน + ปุ่ม "กลับไปเลือกทั้งใบ" (ล้าง lineSupplier ผ่าน swalConfirm); ถ้าเลือกบางแถว → เตือน "เลือกรายบรรทัดยังไม่ครบ (k/M)"; ตั้ง `selectedSupplier = null` เมื่อ allLinesAwarded (ผ่าน patch ตอนเลือกครบ)
- selectionReason textarea แสดงเมื่อ (โหมดทั้งใบ: selected ≠ lowest) หรือ (โหมดผสม: มีแถวไม่ถูกสุด — ใช้ `pickLowestPerLine` เทียบ)
- ตรวจ: tsc/eslint; dev server + Playwright (ถ้ามี) เลือกรายแถว 5 แถว 3 เจ้า → ยอดผสมตรงกับ test ใน Task 1 → ส่งลงนามได้ → PDF 200
- Commit: `price-compare v2: per-line supplier pick UX (radio per cell, lowest-per-line, mixed summary)`

### Task 4: PDF + list + log สำหรับโหมดผสม

**Files:** Modify `lib/price-compare-pdf.ts`, `app/api/price-compare/route.ts` (list), `lib/price-compare-log.ts`, `scripts/check-price-compare-pdf.ts`, `scripts/check-price-compare-core.ts`
- PDF: เซลล์ราคาที่ `lineSupplier[r] === s+1` พิมพ์ `✓ 21,000.00` (ใช้ "√" ถ้า Sarabun ไม่มี ✓ — ดู v1); เมื่อ `allLinesAwarded`: ใต้แถว "รวมราคาทั้งหมด (สุทธิ)" เพิ่ม 2 แถว "ยอดที่เลือกจากเจ้านี้ (ก่อน VAT)" / "สุทธิที่เลือก" ต่อ supplier จาก `mixedTotals` และช่อง Supplier 4 ของแถวสุทธิที่เลือกพิมพ์ `รวมผสม X` ถ้าคอลัมน์ 4 ว่าง (ไม่งั้นพิมพ์บรรทัดใต้ตาราง); ช่อง "ผู้ได้รับเลือก" พิมพ์ `[√] เลือกรายบรรทัด (ผสม N เจ้า)` และไม่ติ๊ก Supplier ใด; หมายเหตุ "ส่วนลดไม่ถูกนำมาคิดเมื่อเลือกผสม" ใต้เหตุผล; หน้า 1 ต้องยังหน้าเดียวกับ fixture 5 แถว
- list: `selectedNet` = grand, `selectedName` = "ผสม N เจ้า", `selectedSupplier` = null เมื่อ allLinesAwarded
- log: TOP_LABELS ไม่เปลี่ยน; diff เพิ่ม `{ field: "lineSupplier", label: "เลือกรายบรรทัด", from: "k/M แถว", to: "k'/M' แถว" }` เมื่อจำนวนแถวที่เลือกเปลี่ยน
- Tests: pdf script fixture ผสม [1,2,2,2,3] → JSON มี "เลือกรายบรรทัด (ผสม 3 เจ้า)", "50,076.00", มี "√" ≥5; core: diff lineSupplier
- Commit: `price-compare v2: mixed-mode PDF summary, list net, audit diff`

### Task 5: QA + build + seed ผสม

**Files:** Modify `scripts/seed-price-compare-uh03.mjs` (เพิ่ม `--mixed` สร้าง PC-2609-002-MIX createdBy seed ที่ lineSupplier [1,2,2,2,3] + selectionReason), run all checks, `npm run build`, prod-style `next start` + PDF ของทั้งสองใบ, ดู PDF ด้วย Read tool; `--clear` ลบทั้งสองใบ
- รายงานความต่างของ PDF โหมดผสมกับ spec; Commit: `price-compare v2: mixed seed + build verified`
