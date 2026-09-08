# ใบเทียบราคา (แบบบันทึกผลการเปรียบเทียบราคา) — Design

วันที่: 2026-09-08 · สถานะ: อนุมัติแนวทางแล้ว (รอ review spec)

## 1. ปัญหาและเป้าหมาย

ฝ่ายจัดซื้อต้องทำ **"แบบบันทึกผลการเปรียบเทียบราคา (ราคา 5,000 บาทขึ้นไป)"** ทุกครั้งที่ซื้อของหรือจ้างซ่อมเกินเกณฑ์ ปัจจุบันทำใน Excel แล้วพิมพ์ให้กรรมการ 4 คนเซ็น พร้อมแนบหลักฐาน (แชท LINE, ใบเสนอราคาของแต่ละราย) รวมเป็น PDF ชุดเดียว

ต้นแบบ: `~/Documents/project/ใบเทียบราคางานซ่อม Pump + Motor UH03.pdf` (เลขที่ PC-2609-002, 3 supplier, 5 รายการ, หน้า 2–4 เป็นหลักฐานแนบ)

ปัญหาของวิธีเดิม:
- เลขที่เอกสาร/ครั้งที่แก้ไข/วันที่ ต้องจำและพิมพ์เอง
- ยอดรวม/VAT คิดมือ ผิดง่าย ไม่มีการไฮไลต์ว่ารายไหนถูกสุด
- ไฟล์ Excel + รูปแนบกระจายอยู่ในเครื่องคนทำ ค้นย้อนหลังไม่ได้ว่างานนี้เคยเทียบราคากับใคร
- ต้องรวมไฟล์เป็น PDF เองทุกครั้ง

**สิ่งที่มีอยู่แล้วและทำไมยังไม่พอ:**

| ของเดิม | ที่อยู่ | ทำอะไร | ทำไมไม่พอ |
|---|---|---|---|
| ช่อง "ใบเสนอราคา" ใน `/repair-external` | mena-wms | ข้อความอิสระ + แนบไฟล์ ต่องานซ่อม 1 งาน | เก็บได้แค่ 1 ราย ไม่มีตารางเทียบ ไม่มีกรรมการ ไม่ออกฟอร์ม |
| quote-comparison ใน mena-procurement | แอปแยก ยังไม่ deploy | matrix เทียบราคา RFQ | คนละระบบ คนละ DB ผู้ใช้ไม่ได้ใช้ |
| pdfmake + ฟอนต์ Sarabun + ต่อรูปแนบ | mena-partner-driver | สร้าง PDF สัญญา/ใบเสนอราคาฝั่ง server | ยังไม่มีใน mena-wms — ยกมาใช้ได้ |

**เป้าหมาย:** โมดูล `/price-compare` ใน mena-wms ที่
1. กรอกใบเทียบราคาในเว็บ แทน Excel — ใช้ได้กับการซื้อทุกประเภท (อะไหล่, งานซ่อม, บริการ) ไม่ผูกกับงานซ่อมอย่างเดียว
2. คำนวณยอด/VAT/สุทธิ และไฮไลต์ราคาต่ำสุดให้อัตโนมัติ
3. **export PDF** หน้าเดียวตามฟอร์มเดิม + หลักฐานแนบต่อท้ายเป็นหน้าถัดไป (รูปและ PDF ใบเสนอราคา) เป็นไฟล์เดียว
4. บันทึกผลกรรมการในระบบ (จัดซื้อกรอกแทน) แล้วพิมพ์ให้เซ็นจริง — เก็บ email กรรมการไว้เผื่อให้ลงมติในระบบภายหลัง

**ไม่ทำในรอบนี้ (YAGNI):** ลงมติในระบบโดยกรรมการเอง, inbox รออนุมัติ, เชื่อม PR/PO ของ ATMS อัตโนมัติ, public API, ราคากลางเทียบอัตโนมัติ

## 2. Data model

### 2.1 Collection `master_data.price_compare`

```ts
type PriceCompare = {
  _id: ObjectId
  docNo: string            // "PC-2609-002" — รันอัตโนมัติ (ดู 2.3)
  title: string            // ชื่อสินค้า / งานซ่อม เช่น "Pump + Motor UH03"
  requestDept: string      // หน่วยงานที่ร้องขอ เช่น "ยานยนต์"
  preparedBy: { name: string; email: string }   // จาก session ตอนสร้าง
  revision: number         // ครั้งที่แก้ไข เริ่ม 0 (+1 ทุกครั้งที่ PUT หลังสถานะพ้น "ร่าง")
  createdAt: string        // ISO +07:00 (toBkkIso)
  updatedAt: string        // ISO +07:00 — แสดงเป็น "วันที่แก้ไขล่าสุด" บนฟอร์ม
  status: "ร่าง" | "รอลงนาม" | "เสร็จสิ้น"

  items: PriceCompareItem[]          // แถวรายการ (ลำดับตาม array)
  suppliers: PriceCompareSupplier[]  // 1–4 ราย (ลำดับ = Supplier 1..4)
  committee: CommitteeMember[]       // 4 ช่องเสมอ (ว่างได้)
  selectedSupplier: number | null    // 1–4 ผู้ได้รับเลือก (ช่องติ๊กมุมขวาล่างของฟอร์ม)

  links: { prCode?: string; plate?: string; fleetNo?: string; repairExternalId?: string }
  evidenceFiles: RepairImage[]       // หลักฐานทั่วไป เช่น แคปแชท LINE

  createdBy: string; editedBy: string   // ชื่อ (pattern เดียวกับ repair-external)
}

type PriceCompareItem = { name: string; qty: number; unit: string }

type PriceCompareSupplier = {
  name: string             // ชื่ออู่/ร้าน (จาก garage_master หรือพิมพ์เอง)
  garageId?: string        // _id ใน garage_master ถ้าเลือกจาก master
  note: string             // หมายเหตุใต้คอลัมน์ เช่น "ราคานี้เป็นราคาซ่อม Pump + Motor ของเดิม"
  prices: (number | null)[]   // ราคา/หน่วย index ตรงกับ items[] — null = ไม่เสนอรายการนี้
  discount: number         // ส่วนลด (บาท)
  conditions: {
    payment: string        // (1) เงื่อนไขการชำระเงิน
    leadTime: string       // (2) ระยะเวลาส่งมอบหลังรับ PO
    warranty: string       // (3) เงื่อนไขการรับประกัน
    remark: string         // หมายเหตุ (ถ้ามี)
    bays: string           // (4) จำนวนช่องซ่อมที่อู่มี
    menaTrucksIn: string   // (5) จำนวนรถ Mena ที่เข้าซ่อมอยู่ในขณะนี้
    statusA: string        // (6) สถานะ ขA - คัน
    statusB: string        //     สถานะ ขB - คัน
  }
  quotationFiles: RepairImage[]   // ใบเสนอราคาของรายนี้ (รูป/PDF) — ไปต่อท้าย PDF
}

type CommitteeMember = {
  role: string             // หัวหน้าฝ่ายยานยนต์ / ผจก.ฝ่ายยานยนต์ / ผจก.ฝ่ายจัดซื้อ / ผู้อำนวยการสายงานธุรกิจ
  name: string
  email?: string           // เผื่อ workflow ลงมติในระบบภายหลัง
  pickedSupplier: number | null   // 1–4 "เลือก supplier ลำดับที่"
  reason: string           // เหตุผลในการเลือก
  signedDate: string       // YYYY-MM-DD วันที่ลงนาม (จัดซื้อกรอก)
}
```

`RepairImage` = type เดิมใน `lib/repair-external.ts` (mediaId/batchId/filename/webpUrl/thumbnailUrl) ใช้ร่วมกับ `components/image-upload.tsx` ได้ทันที

Default ตอนสร้างใหม่: `committee` = 4 ช่องพร้อม `role` ตามฟอร์ม (name ว่าง), `suppliers` = 1 ราย, `items` = 1 แถว, `status` = ร่าง

### 2.2 ค่าที่คำนวณสด (ไม่เก็บลง DB)

ฟังก์ชัน pure ใน `lib/price-compare.ts` ใช้ทั้งหน้าเว็บและ PDF เพื่อให้ตรงกันเสมอ:

| ฟังก์ชัน | ผลลัพธ์ |
|---|---|
| `lineTotal(item, price)` | qty × price (null → null) |
| `supplierTotals(doc, idx)` | `{ subtotal, discount, afterDiscount, vat, net }` โดย vat = afterDiscount × 7% ปัด 2 ตำแหน่ง |
| `lowestPerLine(doc)` | index ของ supplier ที่ถูกสุดต่อแถว (เฉพาะรายที่เสนอ) |
| `lowestNet(doc)` | index ของ supplier ที่สุทธิต่ำสุด |
| `isComplete(doc)` | ครบเงื่อนไขปิดใบ: มีรายการ ≥1, supplier ≥2 ที่มีราคาครบทุกแถว, กรรมการมีชื่อครบ 4, selectedSupplier ไม่ว่าง |

ตัวเลขทั้งหมดปัด 2 ตำแหน่งด้วยวิธีเดียวกัน (`Math.round(x*100)/100`) แล้วค่อยแสดงผลด้วย `toLocaleString("th-TH", {minimumFractionDigits: 2})`

### 2.3 เลขที่เอกสาร

รูปแบบ `PC-YYMM-NNN`: YY = ปี พ.ศ. 2 หลักท้าย, MM = เดือน, NNN = ลำดับในเดือนนั้น เริ่ม 001 (ต้นแบบ 7 ก.ย. 2569 = `PC-2609-002`)

รันด้วย `findOneAndUpdate` บน collection `master_data.counters` `{ _id: "price_compare:2609" }` `$inc: { seq: 1 }` upsert — atomic กันชนเมื่อสร้างพร้อมกัน เดือนอ้างอิง `bkkToday()` (เวลาไทย ห้ามใช้ UTC — ดูหมายเหตุใน `lib/bkk-time.ts`)

เลขที่ออกตอน **POST สร้างใบ** ทันที (ไม่รอออกจากร่าง) เพื่อให้อ้างอิงได้ตั้งแต่แรก ถ้าลบใบ เลขนั้นข้ามไป ไม่นำกลับมาใช้

Unique index บน `docNo`

### 2.4 Audit log — collection `master_data.price_compare_log`

รูปแบบเดียวกับ `repair_external_log`: `{ docId, action: create|update|delete|status, by, byEmail, at, changes[] }` โดย `changes` = diff ฟิลด์ระดับบน (title, requestDept, status, selectedSupplier, links.*) + สรุปจำนวน (`items 5→6 แถว`, `supplier 3→4 ราย`) ไม่ diff ราคารายช่องเพื่อไม่ให้ log รก

## 3. หน้าจอ

เมนู sidebar: **กลุ่มใหม่** `price-compare` ชื่อ "เปรียบเทียบราคา" ใน `lib/nav.ts` (วางต่อจากกลุ่ม "จัดการติดตามสินค้า") มีลิงก์ **"ใบเทียบราคา"** (`/price-compare`, icon `Scale` จาก lucide, exact) — การ์ด QUICK_LINKS หน้าแรกเกิดจากกลุ่มอัตโนมัติตาม pattern เดิม

### 3.1 `/price-compare` — รายการ

- ตาราง: เลขที่ · ชื่องาน · หน่วยงาน · จำนวน supplier · **สุทธิรายที่เลือก** (หรือสุทธิต่ำสุดถ้ายังไม่เลือก) · สถานะ (chip 3 สี) · ผู้จัดทำ · แก้ไขล่าสุด
- แถบบน: ค้นหา (เลขที่/ชื่องาน/ชื่อ supplier), กรองสถานะ, กรองเดือน (จาก docNo), ปุ่ม "สร้างใบเทียบราคา"
- คลิกแถว → `/price-compare/[id]`
- ดึงครั้งเดียว กรอง client-side (ปริมาณไม่กี่สิบใบ/เดือน) — `GET /api/price-compare?limit=500`

### 3.2 `/price-compare/[id]` — ฟอร์ม (หน้าเดียวเลื่อนลง pattern เดียวกับ repair-external)

หัวหน้า sticky: เลขที่ + ชื่องาน + chip สถานะ + ปุ่ม **บันทึก** / **ดาวน์โหลด PDF** / เปลี่ยนสถานะ

หมวด (การ์ดสีตาม pattern ฟอร์ม repair-external):

1. **หัวเอกสาร** — ชื่อสินค้า/งานซ่อม, หน่วยงานที่ร้องขอ (combobox จาก DEPT_MASTER ของ order-tracking + พิมพ์เอง), ผู้จัดทำ (อ่านอย่างเดียว), ครั้งที่แก้ไข/วันที่ (อ่านอย่างเดียว), ลิงก์อ้างอิง (PR / ทะเบียน / เบอร์รถ — ช่องข้อความธรรมดา; autocomplete ทะเบียนจาก `vehicle_master` ไว้รอบหลัง)
2. **ตารางเทียบราคา** — matrix แถว = รายการ, คอลัมน์ = Supplier 1–4
   - หัวคอลัมน์: ชื่อ supplier (combobox `garage_master` + เพิ่มในที่ ผ่าน `components/garage-combobox.tsx` เดิม) + ช่องหมายเหตุใต้ชื่อ + ปุ่มลบคอลัมน์
   - แต่ละเซลล์: input ราคา/หน่วย · ยอดรวมแสดงข้างๆ (คำนวณสด) · เซลล์ถูกสุดต่อแถวพื้นเขียวอ่อน
   - ท้ายตาราง: รวมก่อนภาษี / ส่วนลด (input) / รวมหลังส่วนลด / VAT 7% / **สุทธิ** (ต่ำสุดตัวหนาเขียว)
   - ปุ่ม "+ รายการ" / "+ Supplier" (สูงสุด 4), ลบแถว, ลากเรียงไม่ทำ (ใช้ปุ่มขึ้น/ลง)
3. **เงื่อนไขในการคัดเลือก** — ตาราง 6 ข้อ × supplier (input ข้อความสั้น) ตามฟอร์ม
4. **หลักฐาน** — ต่อ supplier: `ImageUpload` ใบเสนอราคา (รูป/PDF) + ช่อง "หลักฐานอื่น" (แชท LINE ฯลฯ) 1 ชุด
5. **คณะกรรมการพิจารณา** — 4 ช่องเรียงตามฟอร์ม: ตำแหน่ง (แก้ได้), ชื่อ, email (ไม่บังคับ), เลือก supplier ลำดับที่ (select 1–N), เหตุผล, วันที่ลงนาม
6. **สรุปผล** — ผู้ได้รับเลือก (radio Supplier 1–N พร้อมชื่อ+สุทธิ), แจ้งเตือนถ้าเลือกรายที่ไม่ใช่สุทธิต่ำสุดว่า "ควรระบุเหตุผลในช่องกรรมการ" (เตือน ไม่บล็อก)
7. **ประวัติ** — timeline จาก `price_compare_log` (collapsed)

พฤติกรรมสถานะ:
- ร่าง → รอลงนาม: ต้องผ่าน `isComplete()` ยกเว้นชื่อกรรมการ (กรอกทีหลังได้)
- รอลงนาม → เสร็จสิ้น: ต้องมี selectedSupplier และวันที่ลงนามครบ 4
- เสร็จสิ้น: ฟอร์มล็อก (อ่านอย่างเดียว) ยกเว้นปุ่ม "เปิดแก้ไข" ที่ย้อนเป็นรอลงนามและ +revision
- ลบได้เฉพาะสถานะร่าง (swal confirm)

บันทึก: ปุ่มบันทึกส่งทั้งเอกสาร (`PUT`) ไม่ autosave; เตือน `beforeunload` ถ้ามีการแก้ยังไม่บันทึก

## 4. PDF — `GET /api/price-compare/[id]/pdf`

### 4.1 โครงสร้างพื้นฐาน (ยกจาก mena-partner-driver)

คัดลอกมาไว้ใน mena-wms:
- `lib/pdfmake-printer.ts` (`renderPdfmake`, `fixThaiMarks`, `seg`) — ตัด CordiaUPC ออก ใช้ **Sarabun** อย่างเดียว
- `fonts/Sarabun-{Regular,Bold,Italic,BoldItalic}.ttf` + `fonts/mena-logo.jpg`
- `next.config.ts` เพิ่ม `outputFileTracingIncludes: { "/api/price-compare/[id]/pdf": ["./fonts/**"] }`
- route ตั้ง `runtime = "nodejs"`, `maxDuration = 60` (merge ไฟล์แนบอาจนานกว่าสัญญา)
- dependency ใหม่: `pdfmake@^0.3`, `@types/pdfmake`, `pdf-lib`

### 4.2 หน้า 1 — ใบเทียบราคา (A4 landscape ตามฟอร์มเดิม)

`lib/price-compare-pdf.ts` → `buildPriceCompareDoc(doc): TDocumentDefinitions`

| ส่วน | รายละเอียด |
|---|---|
| หัว | โลโก้ Mena · บริษัท มีนาทรานสปอร์ต จำกัด (มหาชน) · ชื่อฟอร์ม "แบบบันทึกผลการเปรียบเทียบราคา (ราคา 5,000 บาทขึ้นไป)" · เลขที่/วันที่เริ่มจัดทำ/วันที่แก้ไขล่าสุด · ชื่อสินค้า/งานซ่อม · หน่วยงาน · ผู้จัดทำ · ครั้งที่แก้ไข |
| ตาราง | คอลัมน์ ลำดับ · รายการ · จำนวน · หน่วย · Supplier 1–4 (ราคา/หน่วย, ยอดรวม) — พิมพ์ 4 คอลัมน์เสมอ (รายที่ไม่มี = ว่าง) ให้ตรงฟอร์ม · แถวหมายเหตุ supplier ใต้รายการ · เติมแถวว่างให้ครบ 15 แถวขั้นต่ำ |
| สรุปยอด | รวมก่อนภาษี / ส่วนลด / รวมหลังส่วนลด / VAT 7% / รวมทั้งหมด (สุทธิ) ต่อ supplier |
| เงื่อนไข | 6 ข้อ × supplier (ข้อ 6 แยก ขA / ขB) |
| กรรมการ | 4 ช่อง: "1) เลือก supplier ลำดับที่ __ 2) เหตุผล __" · ที่ว่างลงนาม · ชื่อ · วันที่ · ตำแหน่ง + ช่องติ๊ก "ผู้ได้รับเลือก [ ] Supplier 1–4" (ติ๊ก ✓ ตาม selectedSupplier) |

ข้อความไทยทุกช่องผ่าน `seg()`/`fixThaiMarks()`; ตัวเลขผ่านฟังก์ชันคำนวณเดียวกับหน้าเว็บ (2.2); ราคาต่ำสุดต่อแถว **ไม่**ไฮไลต์ใน PDF (ฟอร์มทางการ ขาว-ดำ)

### 4.3 หน้าถัดไป — หลักฐานแนบ

`lib/price-compare-attachments.ts` → `appendAttachments(pdfBytes, doc): Promise<Uint8Array>`

ลำดับ: หลักฐานทั่วไป (`evidenceFiles`) → ใบเสนอราคา Supplier 1 → 2 → 3 → 4

| ชนิดไฟล์ | วิธี |
|---|---|
| รูป (webp บน CDN) | fetch `webpUrl` → `sharp().png()` → เพิ่มเป็นหน้า A4 portrait ผ่าน pdfmake (หัวข้อ "หลักฐาน: ใบเสนอราคา Supplier 1 — ช่างหมู" + รูป `fit` เต็มหน้า) — ทำเป็น content ของ docDef หน้า 1 เลย (แบบ `appendContractAttachments`) |
| PDF ที่อัปโหลด (`filename` ลงท้าย .pdf) | fetch ไฟล์ → `pdf-lib` `PDFDocument.load` → `copyPages` ทุกหน้าไปต่อท้ายเอกสารหลัก (หลังจาก pdfmake render เสร็จ) |

ข้อผิดพลาดต่อไฟล์ (fetch ไม่ได้ / ไฟล์เสีย / PDF เข้ารหัส) → **ข้ามไฟล์นั้น** และใส่หน้าแจ้ง "ไม่สามารถแนบไฟล์ <ชื่อ> ได้" แทน เพื่อให้ผู้ใช้รู้ว่าขาด ไม่ให้ PDF ทั้งฉบับล้ม

ลำดับการประกอบ: pdfmake (หน้า 1 + หน้ารูปทั้งหมด) → pdf-lib โหลดผลลัพธ์ → แทรก PDF แนบ **ณ ตำแหน่งตามลำดับ supplier** (ใช้ `insertPage` ที่ index ที่คำนวณไว้ ไม่ใช่ต่อท้ายทั้งหมด เพื่อให้ใบเสนอราคาของ Supplier 2 ที่เป็น PDF อยู่หลังรูปของ Supplier 1) → `save()`

Response: `Content-Type: application/pdf`, `Content-Disposition: inline; filename*=UTF-8''PC-2609-002 Pump + Motor UH03.pdf`

### 4.4 ขนาด/เวลา

ไฟล์แนบ ≤ 25MB/ไฟล์ (เพดาน presign-api) รูปแปลงเป็น PNG กว้างสูงสุด 1600px เพื่อคุมขนาด PDF; ทดสอบใบที่มีแนบรวม ~10 ไฟล์ให้จบใน 60 วินาที ถ้าเกินให้ลด `maxWidth` เป็น 1200px

## 5. API

ทุก route เช็ค `getServerSession(authOptions)` → 401 ถ้าไม่มี (ไม่มี public API, ไม่ต้องแก้ middleware bypass)

| Method / path | ทำอะไร |
|---|---|
| `GET /api/price-compare?status=&month=&q=&limit=` | รายการ เรียง updatedAt ล่าสุดก่อน ไม่ส่ง items/prices/files (list projection) |
| `POST /api/price-compare` | สร้างใบ (ออก docNo, preparedBy จาก session, default ตาม 2.1) → 201 พร้อมเอกสาร |
| `GET /api/price-compare/[id]` | เอกสารเต็ม |
| `PUT /api/price-compare/[id]` | บันทึกทั้งเอกสาร: validate (suppliers 1–4, items ≥1, prices length = items length, qty > 0, discount ≥ 0, status transition ถูกต้องตาม 3.2), `updatedAt`, `editedBy`, `revision+1` ถ้า status เดิม ≠ ร่าง, เขียน log |
| `DELETE /api/price-compare/[id]` | ลบได้เฉพาะ status ร่าง → log delete |
| `GET /api/price-compare/[id]/pdf` | ตาม ข้อ 4 |
| `GET /api/price-compare/[id]/log` | ประวัติจาก `price_compare_log` |

Validation อยู่ใน `lib/price-compare.ts` (`normalizeDoc`, `validateDoc`) ให้ฝั่ง client เรียกก่อนส่งได้ด้วย

Index: `price_compare` → `{ docNo: 1 }` unique, `{ status: 1, updatedAt: -1 }`; `price_compare_log` → `{ docId: 1, at: -1 }` — สร้างผ่าน script `scripts/ensure-price-compare-indexes.mjs` (รันมือครั้งเดียว ไม่สร้างใน request path)

## 6. ไฟล์ที่เพิ่ม/แก้

| ไฟล์ | สถานะ | หน้าที่ |
|---|---|---|
| `lib/price-compare.ts` | ใหม่ | types, defaults, คำนวณ, validate, `nextDocNo` |
| `lib/price-compare-log.ts` | ใหม่ | diff + write log |
| `lib/price-compare-pdf.ts` | ใหม่ | docDefinition หน้า 1 + หน้ารูป |
| `lib/price-compare-attachments.ts` | ใหม่ | โหลดไฟล์แนบ, sharp→png, pdf-lib merge |
| `lib/pdfmake-printer.ts` | ใหม่ (copy) | printer + Thai helpers |
| `fonts/*` | ใหม่ (copy) | Sarabun 4 ไฟล์ + โลโก้ |
| `app/api/price-compare/route.ts`, `[id]/route.ts`, `[id]/pdf/route.ts`, `[id]/log/route.ts` | ใหม่ | API |
| `app/price-compare/page.tsx`, `[id]/page.tsx` | ใหม่ | หน้า |
| `components/price-compare-list.tsx`, `price-compare-form.tsx`, `price-compare-matrix.tsx` | ใหม่ | UI (แยก matrix ออกเพราะเป็นส่วนที่ซับซ้อนสุด) |
| `lib/nav.ts` | แก้ | เพิ่มกลุ่มเมนูใหม่ "เปรียบเทียบราคา" |
| `next.config.ts`, `package.json` | แก้ | fonts tracing, deps |
| `scripts/ensure-price-compare-indexes.mjs` | ใหม่ | index |
| `scripts/seed-price-compare-uh03.mjs` | ใหม่ | ใบตัวอย่างจากต้นแบบ (ใช้ทดสอบ PDF เทียบต้นฉบับ) |

## 7. การทดสอบ

- **Unit (`lib/price-compare.ts`)**: `supplierTotals` ตรงกับต้นแบบ (ช่างหมู 50,690 → VAT 3,548.30 → 54,238.30; คุณณัฐ 56,300 → 60,241.00; ศศ&ณ 63,000 → 67,410.00), `lowestPerLine`/`lowestNet`, `isComplete`, `nextDocNo` format + เดือนข้ามปี, validate ปฏิเสธ suppliers 5 ราย / prices ยาวไม่ตรง / status transition ผิด
- **Unit (`price-compare-attachments`)**: merge เอกสารหลัก 1 หน้า + รูป 2 + PDF แนบ 2 หน้า → ได้ 5 หน้า เรียงถูก; ไฟล์เสีย 1 ไฟล์ → ยังได้ PDF พร้อมหน้าแจ้งเตือน
- **Manual**: seed ใบ UH03 → เปิด `/price-compare/[id]` ตรวจตัวเลขทุกช่อง → ดาวน์โหลด PDF เทียบกับต้นฉบับหน้า 1 ด้วยตา (ตำแหน่งช่อง, ฟอนต์ไทย สระอำ/วรรณยุกต์, ตัวเลขคั่นหลักพัน) → แนบรูป webp + PDF จริงจากระบบอัปโหลดแล้วดาวน์โหลดอีกครั้ง
- **Deploy**: ตรวจบน Vercel preview ว่า fonts ถูก trace เข้าไป (ถ้าไม่ จะได้ error "font not found" ที่ route pdf) ก่อน merge main

## 8. ความเสี่ยงและข้อสังเกต

- pdfmake 0.3 บน Next 16/Turbopack: mena-partner ใช้ Next 15.5 (webpack) ได้ — ต้องลอง `next build` ก่อน ถ้า Turbopack import subpath `pdfmake/js/Printer` ไม่ได้ ให้ใส่ `serverExternalPackages: ["pdfmake"]`
- sharp บน Vercel: Next ใช้อยู่แล้วสำหรับ image optimization จึงมีใน bundle แต่ import ตรงต้องเพิ่ม `sharp` ใน dependencies ให้ชัด
- ฟอร์มมีช่อง Supplier 4 คอลัมน์เสมอ → ถ้าอนาคตต้องการมากกว่า 4 ต้องออกแบบหน้า PDF ใหม่ (นอกขอบเขต)
- `garage_master` รวมอู่และร้านอะไหล่ในชุดเดียว ใช้เป็นแหล่ง supplier ได้เลย ไม่สร้าง master ใหม่
