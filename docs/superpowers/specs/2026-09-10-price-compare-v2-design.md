# ใบเทียบราคา v2 — เพิ่มรายการจากรหัสสินค้า ATMS + เลือก supplier รายบรรทัด — Design

วันที่: 2026-09-10 · สถานะ: **อนุมัติแล้ว (ok 2026-09-10)** — ปรับให้ตรงกับโค้ดที่อยู่บน main แล้ว (ร่าง agent ถูก merge ผ่าน bb492b9 + AVL combobox 189ed24) · ต่อยอดจาก `2026-09-08-price-compare-design.md` (v1 อยู่บน production แล้ว)

## 0. ที่มา

ผู้ใช้ขอเพิ่ม (2026-09-10) หลังใช้งาน v1:
1. เพิ่มรายการโดยค้นหา **รหัสสินค้า ATMS** แบบเดียวกับตัวเลือกสินค้าในหน้า price-benchmark ของ mena-intelligence
2. เลือก supplier **รายบรรทัด** ได้ (ผสมหลายเจ้าในใบเดียวเพื่อให้ยอดรวมต่ำสุด)
3. UI ดาว/เกรดหลาย option ต่อรายการ — **ยังไม่ทำ** (ร่างของ agent เก็บไว้ที่ branch `feat/price-compare-multi-grade-wip` ไม่ผ่าน review)

## A. เพิ่มรายการจากรหัสสินค้า ATMS (bounded)

**แหล่งข้อมูล:** `master_data.atms_sku_master` (sync รายวันจาก ATMS โดย cron safety-stock; ~21,000 แถว = SKU × คลัง; index `code`, `skuPk`) ฟิลด์ที่ใช้ `code, name, group, unit`

**API:** `GET /api/price-compare/sku-search?q=<text>` (ต้องมี session)
- q ว่างหรือสั้นกว่า 2 ตัวอักษร → `[]`
- ค้นด้วย regex (escape แล้ว) บน `code` (anchored `^` ใช้ index) **หรือ** `name` (unanchored, case-insensitive) — 21k แถว scan ได้ในหลักสิบ ms; ถ้าช้าค่อยเพิ่ม text index ภายหลัง
- `$group` ตาม `code` (SKU เดียวกันมีหลายคลัง) เอา name/group/unit ตัวแรก, `$limit 20`, เรียง code
- ตอบ `{ code, name, group, unit }[]`

**Data model:** `PcItem` เพิ่ม `sku?: string` (รหัส ATMS ถ้าเลือกจาก picker; ว่างถ้าพิมพ์เอง) — `normalizeDoc` รับ/ตัดช่องว่าง, ไม่บังคับ, diff log ไม่สนใจ

**UI (`components/price-compare-matrix.tsx`):** ช่อง "รายการ" เป็น `SkuPicker` (component ใหม่ `components/sku-picker.tsx`) — input ธรรมดาที่เปิด dropdown ใต้ช่องเมื่อพิมพ์ ≥2 ตัวอักษร, debounce 250 ms, แสดง `code · name · group` สูงสุด 20 แถว, คลิก → `name = "CODE : ชื่อ"`, `unit` = หน่วยจาก SKU (ถ้าช่องหน่วยว่าง), `sku = code`; ปิดด้วย Esc/คลิกนอก; พิมพ์เองต่อได้ (งานบริการ/ค่าแรงที่ไม่มีรหัส) — ถ้าผู้ใช้แก้ชื่อหลังเลือก ให้ล้าง `sku`
- แสดง chip เล็ก `SKU` หลังชื่อเมื่อ `sku` มี
- readOnly → input ปิดเหมือนเดิม ไม่มี dropdown

**PDF:** ไม่เปลี่ยน (ชื่อที่พิมพ์ออกมาคือ `CODE : ชื่อ` อยู่แล้ว)

**ทดสอบ:** `scripts/check-price-compare-core.ts` เพิ่ม normalizeDoc(sku) ; curl `sku-search?q=น้ำมัน` และ `?q=S9WR` ผ่าน dev server (401 เมื่อไม่มี session, ≤20 แถว, ไม่มี code ซ้ำ)

## B. เลือก supplier รายบรรทัด (architectural)

**ฐานที่มีอยู่บน main แล้ว (ร่างที่ไม่ผ่าน review — ต้องรีวิว/ทดสอบใน v2):** `lib/price-compare.ts` มี `PriceCompare.lineSupplier: (number|null)[]` (ยาวเท่า items, 1-based, null = ใช้ `selectedSupplier` ของทั้งใบ — `effectiveLineSupplier`), `allLinesAwarded`, `mixedNet`, `bestMixNet`, `lineNetFor`; isComplete ผ่านเมื่อ selectedSupplier หรือ allLinesAwarded; selectionReason บังคับเมื่อแถวใดไม่เลือกถูกสุด; validateDoc ตรวจความยาว/ช่วงของ lineSupplier. **เก็บโมเดลนี้ไว้** (ไม่ใช้ `selectionMode` แยก — โหมดผสม = ทุกแถวมี lineSupplier) และเพิ่มสิ่งที่ยังขาด:

1. **ตัด multi-grade ออกทั้งหมด** (`PcPriceOption`, `PcSupplier.extraOptions`, add/remove/update/promotePriceOption, ปุ่ม "+เกรด"/Star ใน matrix) — normalizeDoc ต้องทน field `extraOptions` ที่ค้างในเอกสารเก่าโดยทิ้งเงียบๆ; log diff ไม่สน
2. **UI เลือกรายบรรทัด**: ทุกเซลล์ราคาที่มีค่ามี radio เล็ก "ใช้เจ้านี้" (แทน Star); เซลล์ที่เลือกพื้นเขียวเข้ม + ✓; ปุ่ม "เลือกถูกสุดทุกแถว" และ "ล้างการเลือกรายแถว"; footer เพิ่มแถว "ยอดที่เลือกจากเจ้านี้ (ก่อน VAT)" ต่อ supplier; §6 สรุปผล แสดง "สุทธิรวมแบบผสม X · ต่ำสุดที่เป็นไปได้ Y (+Z)" เมื่อ allLinesAwarded และซ่อน radio ทั้งใบ (หรือแสดงว่า "เลือกรายบรรทัดอยู่") — เลือกทั้งใบ (radio Supplier N) ยังใช้ได้เมื่อไม่มี lineSupplier
3. **ส่วนลด**: โหมดผสมไม่ปันส่วนส่วนลด (mixedNet ใช้ราคาต่อแถว × qty + VAT ตาม vatMode ของเจ้านั้น) — แสดงหมายเหตุใน UI/PDF "ส่วนลดไม่ถูกนำมาคิดเมื่อเลือกผสม"
4. **ยอดรวมโหมดผสม (pure)**: `mixedTotals(doc)` → ต่อ supplier `{ subtotal(ที่เลือก), vat, net }` + `grand` — ใช้ทั้ง UI/PDF/list; `bestMixNet` ต้องคิด VAT ตาม vatMode ของเจ้าที่ถูกสุดในแต่ละแถว (ตรวจ/แก้)
5. **API/list/log**: list `selectedNet` = mixedNet เมื่อ allLinesAwarded, `selectedName` = "ผสม N เจ้า"; log diff เพิ่มสรุป "เลือกรายบรรทัด N/M แถว"
6. **PDF**: เซลล์ที่เลือกมี ✓ หน้าราคา; บล็อกใหม่ใต้สรุปยอด 2 แถว "ยอดที่เลือกจากเจ้านี้ (ก่อน VAT)" / "สุทธิที่เลือก" ต่อ supplier + ช่องขวาสุด "รวมสุทธิแบบผสม"; ช่อง "ผู้ได้รับเลือก" พิมพ์ `[√] เลือกรายบรรทัด (ผสม N เจ้า)`; กรรมการลงนามครั้งเดียว
7. **AVL combobox** (`components/vendor-combobox.tsx`, จาก session อื่น): คงไว้ ไม่แตะ

**ไม่ทำ:** เกรด/option หลายราคาต่อเซลล์, ปันส่วนส่วนลด, เปลี่ยนจำนวนคอลัมน์ (คง 4)

## ลำดับทำ
T1 ตัด multi-grade + ทดสอบ core โหมดผสม → T2 SKU picker (A) → T3 matrix/form UX โหมดผสม → T4 PDF + list + log → T5 QA/build บน branch `feat/price-compare-v2` จาก origin/main ใน worktree `master-sku-web-pc` เท่านั้น (ห้ามแตะ checkout หลักที่ session อื่นใช้)
