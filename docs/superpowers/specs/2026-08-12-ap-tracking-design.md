# ติดตามเจ้าหนี้ (AP Document Tracking) — Design

วันที่: 2026-08-12 · สถานะ: อนุมัติแนวทางแล้ว (รอ review spec)

## 1. ปัญหาและเป้าหมาย

ปัจจุบันทีมคลังคุมเอกสารเจ้าหนี้ด้วย Excel รายเดือน (`เจ้าหนี้เดือน กค. 2026.xlsx` — 3 ชีทตามคลัง ศลบ/DIST/ศขก, ~2,500 แถว/เดือน) ปัญหาที่พบจากการ review ไฟล์จริง:

- แถวซ้ำ/บล็อกแปะท้ายชีททำยอดรวมเพี้ยน, คอลัมน์เลื่อน, วันที่พิมพ์ผิด (13/11/2026), supplier name โดนแปะวันที่ทับ
- ไม่รู้ยอดค้างส่งบัญชี / เกินกำหนด credit term โดยไม่มานั่งกรองเอง
- ติ๊กแล้วไม่รู้ใครติ๊กเมื่อไหร่ ตรวจย้อนหลังไม่ได้

**เป้าหมาย:** หน้าเว็บใน mena-wms ให้ผู้ใช้ (ทีมคลัง/ธุรการ) **ประกบชุดเอกสารต่อใบ DD** แล้วส่งบัญชีเพื่อจ่ายเงิน พร้อมติดตามยอดตาม credit term

## 2. Business rules (หัวใจระบบ)

**1 แถว = 1 ใบ DD = 1 ชุดเอกสาร**

เงื่อนไข **"ครบชุด"** (ระบบคำนวณอัตโนมัติ):

```
✓ DD (ตัวจริง) + ✓ PO (ตัวจริง) + ✓ อย่างน้อย 1 ใน 5 เอกสารการเงิน:
   บิล/ใบส่งของ · ใบแจ้งหนี้ · ต้นฉบับใบกำกับภาษี · ใบเสร็จรับเงิน · ใบวางบิล
```

**สถานะอัตโนมัติ** (ไม่มี dropdown ให้เลือก — คำนวณจาก checkbox + วันที่เท่านั้น):

| สถานะ | เงื่อนไข |
|---|---|
| 🔴 รอประกบ | ยังไม่เข้าเงื่อนไขครบชุด |
| 🟡 ครบชุด–รอส่งบัญชี | ครบชุดแล้ว แต่ยังไม่มีวันที่ส่ง |
| ✅ ส่งบัญชีแล้ว | มีวันที่ นอกรอบ/วันที่โอน หรือ ตามรอบ/วันที่ส่ง อย่างใดอย่างหนึ่ง |
| ⏰ เกินกำหนด (badge ทับสถานะ) | ยังไม่ส่งบัญชี และวันนี้ > due date |

**การส่งบัญชี 2 แบบ** (ช่องเดียวเลือก type + วันที่):

- **นอกรอบ/วันที่โอน** — บัญชีโอน**ทุกวันพฤหัส** → date picker default พฤหัสถัดไป + ปุ่มลัด "พฤหัสนี้ / พฤหัสหน้า"
- **ตามรอบ/วันที่ส่ง** — ส่งเอกสารเข้ารอบวางบิลปกติ ลงวันที่ส่งเฉย ๆ (ไม่มีกฎวันตายตัว)

**Credit term / due date:**

- `due date = received_at (วันรับของใน DD) + creditTerm ของ supplier`
- creditTerm มาจาก supplier master (ข้อ 4) ค่า: Immediate / 7D / 15D / 30D / 60D
- supplier ที่ไม่มีใน master → ไม่มี due date, แสดง "– ตั้งเครดิต" ชวนให้ไปกรอก

## 3. Data architecture — Read-join + Tracking overlay

ตาม pattern หน้า `/pr` (ไม่ copy ข้อมูล ATMS):

- **แหล่งแถว (read-only):** `atms.deposit_header` — fields ที่มีอยู่แล้ว: `deposit_id, deposit_code, warehouse, purchase_order, withdraw_ref, supplier, supplier_ref_no, amount, created_at, received_at, approver, user` · ทุกคลังใน ATMS (ไม่กรองเฉพาะ LB/SB/KK)
- **join PO:** `atms.purchase_orders` ด้วย `purchase_order` → `รหัส` เอา ยอดรวม, วันที่, กำหนดส่งสินค้า, สถานะการรับสินค้า
- **detail รายการสินค้า:** `atms.deposit_items` (lazy load ใน modal)
- **tracking overlay (เขียนได้):** `master_data.ap_tracking` — สร้าง doc ตอนติ๊กครั้งแรก (lazy, แบบ `pr_tracking`)

```ts
// master_data.ap_tracking — unique index: depositCode
{
  depositCode: string,            // key ประกบกับ deposit_header.deposit_code
  docs: {                         // checkbox 7 ช่อง
    dd, po, bill, invoice, taxInvoice, receipt, billingNote:
      { checked: boolean, by: string, at: string } | null
  },
  sentType: "" | "นอกรอบ" | "ตามรอบ",
  sentDate: string,               // YYYY-MM-DD
  note: string,
  log: [{ action, by, byEmail, at, detail }],   // ทุก write ลง log (แบบ order_tracking)
  updatedAt: string,
}
```

```ts
// master_data.ap_supplier — unique index: name (normalized)
{ name: string, creditTerm: "Immediate"|"7D"|"15D"|"30D"|"60D", updatedBy, updatedAt }
```

**Seed script:** `scripts/seed-ap-suppliers.cjs` อ่าน `~/Documents/project/debt/เจ้าหนี้เดือน กค. 2026.xlsx` ทั้ง 3 ชีท → distinct (supplier, เครดิต) → upsert `ap_supplier` (ถ้า supplier มีหลาย term ใช้ term ที่พบบ่อยสุด + รายงาน conflict ให้ดู) · idempotent

**ความสดข้อมูล:** `deposit_header` มาจาก atms-extractor รันมือ (PHPSESSID) — MVP แสดง banner "ข้อมูล ATMS ล่าสุด: {max(created_at)}" · Phase 2 ค่อย automate (launchd แบบ RMC pipeline) · Vercel cron เต็ม 2 slot แล้ว ห้ามใช้

## 4. หน้าจอ

**Route `/ap-tracking`** — sidebar group **"จัดการติดตามสินค้า"** (label: ติดตามเจ้าหนี้ · icon: Banknote) + หน้า guide `/ap-tracking/guide` ภายหลัง

**แถบสรุปบน (คลิก chip = filter):**

- chips สถานะ: รอประกบ (N ใบ/บาท) · ครบชุด–รอส่ง · ส่งแล้ว · เกินกำหนด
- tile **"เข้าโอนรอบพฤหัสนี้"** — นับใบที่ sentType=นอกรอบ และ sentDate = พฤหัสที่จะถึง (X ใบ / Y บาท)
- aging ยอดค้างส่ง: ยังไม่ครบกำหนด / ครบใน 7 วัน / เกินกำหนด

**ตารางหลัก** — default เดือนปัจจุบัน (จาก `received_at`), filter: เดือน / คลัง / supplier / สถานะ, ค้นหา DD/PO/supplier:

| DD · วันรับ | PO | ซัพพลายเออร์ · เครดิต | ยอดเงิน | due | ✓DD | ✓PO | ✓บิล | ✓ใบแจ้งหนี้ | ✓ใบกำกับ | ✓ใบเสร็จ | ✓ใบวางบิล | ส่งบัญชี | หมายเหตุ |

- **ติ๊กในตารางได้เลย** — คลิก checkbox → PATCH ทันที (optimistic update) ให้เร็วเท่า Excel
- ช่องส่งบัญชี: ปุ่มเปิด popover เลือก นอกรอบ (default พฤหัสถัดไป) / ตามรอบ (default วันนี้) → แสดงเป็น badge "✅ นอกรอบ 13/08"
- แถวเกินกำหนด: พื้นหลังโทนแดงอ่อน + badge ⏰ N วัน
- หมายเหตุ: คลิกแก้ inline (input เล็ก)

**Detail modal (คลิก DD code):** รายการสินค้าจาก `deposit_items` · ข้อมูล PO · timeline log การติ๊ก/แก้ไข · หมายเหตุเต็ม

**หน้า supplier master `/ap-tracking/suppliers`:** ตาราง name + creditTerm แก้ inline + เพิ่มเอง (ใช้ pattern หน้า `/garages`)

## 5. API

- `GET /api/ap-tracking?month=YYYY-MM&carryover=1&warehouse=&supplier=&status=&q=&limit=` — aggregate deposit_header (match เดือนจาก received_at; `carryover=1` = รวมใบเดือนก่อน ๆ ที่ยังไม่ส่งบัญชีเข้ามาด้วย — เป็น default ของหน้า) + $lookup purchase_orders + join ap_tracking + ap_supplier ใน code → คืน rows พร้อม status/dueDate ที่คำนวณแล้ว + summary counts
- `PATCH /api/ap-tracking/[depositCode]` — body บางส่วน `{ docs?: {bill: true}, sentType?, sentDate?, note? }` → upsert + push log entry (session user) · ยกเลิกติ๊ก = ส่ง `{bill: false}` (เก็บ log)
- `GET /api/ap-tracking/[depositCode]` — detail: deposit_items + PO + tracking doc เต็ม (log)
- `GET/PUT /api/ap-suppliers` — list / upsert supplier credit term
- ทุก endpoint: ต้อง login (middleware เดิม), ทุกคน CRUD ได้ (ไม่มี admin gate — ตาม convention repair-external)

**Index ที่ต้องสร้าง:** `ap_tracking.depositCode` (unique), `ap_supplier.name` (unique), และเพิ่มใน `atms.deposit_header`: `received_at`, `deposit_code` — ปัจจุบัน join ทั้งหมด collection scan (ปัญหาเดิมของ /pr ด้วย)
> ⚠️ การสร้าง index บน atms.* = เขียนบน prod Mongo — ต้องขอ user ก่อนรันเสมอ

## 6. Edge cases

- **DD ไม่มี PO / PO ไม่อยู่ใน purchase_orders** (scraper ยังไม่ครอบช่วงเวลา): แสดงแถวปกติ, ช่อง PO = "–", ติ๊ก ✓PO ได้ (เอกสารจริงมีแต่ระบบยังไม่ sync)
- **เงินสด (ไม่มีVAT):** supplier ตั้ง Immediate ได้; เงื่อนไขครบชุดเหมือนกันทุกเจ้า (≥1 ใน 5 — ไม่บังคับใบกำกับ)
- **DD ข้ามเดือน:** filter เดือนเป็นแค่ view — แถวไม่หาย, chip "ค้างจากเดือนก่อน" (received_at < เดือนที่เลือก และยังไม่ส่ง) แก้ปัญหา carryover ของ Excel
- **ยกเลิก DD ใน ATMS:** deposit_header ไม่มี status ยกเลิกชัดเจน → MVP ไม่จัดการ, ใช้หมายเหตุ; ทบทวน Phase 2
- **แก้ tracking ของ DD ที่ส่งบัญชีไปแล้ว:** อนุญาต (แก้ผิดได้) แต่ลง log เสมอ

## 7. Testing

- unit: ฟังก์ชัน `apStatusOf(docs, sentDate)` + `dueDateOf(received_at, term)` + next-Thursday helper (lib/ap-tracking.ts, pure functions)
- API: PATCH สร้าง doc ใหม่ lazy / merge docs บางส่วน / log ครบ
- manual: ติ๊กในตารางเร็ว ๆ หลายช่องติดกัน (optimistic + รอ save) ไม่ทับกัน

## 8. Phase 2 (out of scope รอบนี้)

แนบสแกนเอกสาร (ImageUpload เดิม) · ปุ่ม 📢 ตามเอกสารค้าง (copy ข้อความไลน์) · export Excel ให้บัญชี · จัดกลุ่มใบวางบิล/รอบจ่ายต่อ supplier · automate scraper (launchd) · import ประวัติจาก Excel กค. เข้า ap_tracking (ถ้าอยากเห็นเดือนเก่าในระบบ)
