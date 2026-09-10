# ใบเทียบราคา v2 — เพิ่มรายการจากรหัสสินค้า ATMS + เลือก supplier รายบรรทัด — Design

วันที่: 2026-09-10 · สถานะ: **ร่าง รอผู้ใช้อนุมัติ** · ต่อยอดจาก `2026-09-08-price-compare-design.md` (v1 อยู่บน production แล้ว)

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

**Data model**
```ts
PriceCompare.selectionMode: "document" | "line"   // default "document" (เอกสารเก่าทุกใบ)
PcItem.pickedSupplier: number | null              // 1..N ใช้เมื่อ selectionMode === "line"
```
- โหมด document = พฤติกรรม v1 ทั้งหมด (selectedSupplier + กรรมการ + เหตุผล)
- โหมด line: `selectedSupplier` ต้องเป็น null; ทุกแถวที่มีราคาต้องมี `pickedSupplier` ที่มีราคาในแถวนั้น (validateDoc)

**คำนวณ (pure, lib/price-compare.ts)**
- `lineSelectionTotals(doc)` → ต่อ supplier: subtotal ของแถวที่เลือกเจ้านั้น → หัก discount ตามสัดส่วน? **ไม่** — ส่วนลดเป็นของทั้งใบเสนอราคา ไม่ปันส่วน; ในโหมด line ใช้ส่วนลด = 0 และแสดงหมายเหตุใน UI ว่า "ส่วนลดไม่ถูกนำมาคิดเมื่อเลือกผสม" (ผู้ใช้ตกลงราคาสุทธิใหม่ได้ในช่องหมายเหตุ) → vat ตาม vatMode ของ supplier นั้น → net; `mixedNet` = ผลรวม net ของทุก supplier ที่ถูกเลือก
- `bestMixedNet(doc)` = ผลรวมของราคาต่ำสุดต่อแถว (ก่อน VAT ปรับตาม vatMode ของเจ้าที่ถูกสุดในแถวนั้น) — ใช้เทียบว่าการเลือกผสมของผู้ใช้ห่างจากดีที่สุดเท่าไร
- `isComplete`: โหมด line → ทุกแถวมี pickedSupplier; ถ้ามีแถวใดที่ pickedSupplier ≠ supplier ถูกสุดของแถว → ต้องมี `selectionReason` (ข้อความเดียวทั้งใบ); MIN_QUOTES นับ supplier ที่ราคาครบเหมือนเดิม
- `canTransition`: ใช้ isComplete เดิม

**API:** `PUT` ผ่าน normalizeDoc/validateDoc ใหม่; list API เพิ่ม `selectionMode` และ `selectedNet` = mixedNet ในโหมด line; log diff เพิ่มฟิลด์ `selectionMode`

**UI**
- หัวการ์ด §6 สรุปผล: toggle "เลือกทั้งใบ / เลือกรายบรรทัด" (เปลี่ยนโหมดล้างค่าของอีกโหมด พร้อม swalConfirm)
- โหมด line: matrix เพิ่มปุ่ม radio เล็กในทุกเซลล์ราคา (เลือกเจ้านี้สำหรับแถวนี้), เซลล์ที่เลือกพื้นเขียวเข้ม, แถว footer ใหม่ "ที่เลือก (ยอดรวมต่อเจ้า)" + กล่องสรุป "สุทธิรวมแบบผสม X บาท · ต่ำสุดที่เป็นไปได้ Y บาท (+Z)"; ปุ่ม "เลือกถูกสุดทุกแถว" เติมอัตโนมัติ
- selectionReason แสดงเมื่อมีแถวที่ไม่เลือกถูกสุด

**PDF**
- โหมด line: เซลล์ที่เลือกมี ✓ หน้าราคา; ใต้ตารางสรุปยอดเพิ่มบล็อก 2 แถว "ยอดที่เลือกจากเจ้านี้ (ก่อน VAT)" และ "สุทธิที่เลือก" ต่อ supplier + ช่องขวาสุด "รวมสุทธิแบบผสม"; ช่อง "ผู้ได้รับเลือก" พิมพ์ `[√] เลือกรายบรรทัด (ผสม N เจ้า)`; กรรมการลงนามครั้งเดียวเหมือนเดิม

**ไม่ทำ:** เกรด/option หลายราคาต่อเซลล์ (ข้อ C), ปันส่วนส่วนลด, เปลี่ยนจำนวนคอลัมน์

## ลำดับทำ
A ก่อน (1 task, ~1 ชม.) → B (5 tasks: core+tests, API/log, matrix+form, PDF, QA/seed) บน branch `feat/price-compare-v2` จาก origin/main ใน worktree `master-sku-web-pc` เท่านั้น (ห้ามแตะ checkout หลักที่ session อื่นใช้)
