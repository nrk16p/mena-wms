# เบิกอะไหล่ออนไลน์ + คิวงานสโตร์ (store withdraw) — design

Date: 2026-10-31 · Branch: `docs/store-withdraw` (worktree `~/Documents/project/master-sku-web-store-wd`)
· ระบบ: mena-wms (Next.js 16, Mongo `master_data`, NextAuth Google) + api-ncac (FastAPI บน Render) สำหรับยิง ATMS

## ทำไมต้องมี

ทุกวันนี้ยานยนต์เขียนใบเบิกด้วยมือแล้วเดินไปยื่นสโตร์ สโตร์จัดของ แล้วค่อยไปคีย์ใบเบิก (WD) ใน ATMS อีกรอบ
ระหว่างทางไม่มีใครเห็นว่าใบไหนรออยู่ ใบไหนกำลังจัด ใบไหนส่งไปแล้ว ของที่คืนก็ตามยาก
งานนี้ทำให้ยานยนต์ยื่นคำขอเบิกออนไลน์ใน WMS ได้ คำขอเข้าคิวที่จอของสโตร์เหมือนจอในครัวร้านอาหาร
พอสโตร์กดส่งของ ระบบจะสร้าง WD ใน ATMS ให้เองด้วยบัญชี ATMS ของสโตร์คนนั้น ไม่ต้องคีย์ซ้ำ

## ที่ผู้ใช้ตัดสินใจแล้ว (2026-10-31)

| เรื่อง | ตัดสินใจ |
|---|---|
| ยานยนต์ | ใช้แค่ login WMS ตามปกติ ไม่ต้องมีบัญชี ATMS |
| บัญชีที่ใช้ตัดสต๊อกใน ATMS | บัญชี ATMS ของ **สโตร์** คนที่กดส่งของ/รับคืน (ATMS ขึ้นชื่อคนนั้นเป็นผู้ทำรายการ) |
| API | ทุกขั้นต้องเรียกผ่าน API ได้ด้วย ไม่ใช่แค่หน้าจอ เผื่อระบบอื่น (น่าจะ Mena-Next) มาเรียก |
| จอสโตร์ | แบบจอครัว: ใบงานเข้ามาเป็น order เรียงคิว เลื่อนช่อง ใหม่ → กำลังจัด → พร้อมส่ง → ส่งแล้ว ("ใช่ๆ ทำแบบนี้") |
| คืนของ | ต้องรองรับการคืนอะไหล่ด้วย |
| ซิงก์ ATMS | ต้องตรงกับ ATMS อัตโนมัติ |

## เป้าหมาย

1. ยานยนต์ยื่นคำขอเบิกในเว็บ: เลือก MR (รายการแจ้งซ่อม), คลัง, จุดประสงค์, SKU + จำนวน เห็นสต๊อกคงเหลือตอนเลือก
2. สโตร์มีจอคิวงานแยกตามคลัง ใบใหม่เด้งเองพร้อมเสียง รับงาน → จัดของ (แก้จำนวนจริง/ทำเครื่องหมายของขาด) → ส่งของ
3. ตอนกด **ส่งของ** สร้าง WD ใน ATMS ครบ 3 จังหวะ (หัวใบ → รายการทีละบรรทัดผูก MR item → อนุมัติ) แล้วเก็บเลข WD กลับมา
4. ยานยนต์กด **รับแล้ว** แทนการเซ็นกระดาษ
5. คืนของ: ยานยนต์ขอคืนโดยอ้าง WD เดิม → สโตร์รับคืน → ระบบสร้างใบรับ (DD) ไม่มี PO อ้าง WD ใน ATMS แล้วอนุมัติ
6. ทุกขั้นมี API (REST) ให้ระบบภายนอกเรียกได้
7. สถานะใน WMS ตรงกับ ATMS: ถ้ามีคนไปแก้/ลบ WD ที่ WMS สร้างใน ATMS ต้องรู้

## ไม่ทำในรอบนี้ (non-goals)

- ไม่สร้าง PR อัตโนมัติเมื่อของขาด — แค่ทำเครื่องหมาย "ของขาด" ให้สโตร์ไปทำ PR ตามขั้นเดิม
- ไม่แก้ WD ที่อนุมัติแล้วจาก WMS — แก้ใน ATMS เหมือนเดิม (ATMS แก้ = ถอนอนุมัติ → ลบบรรทัด → เพิ่มใหม่) แล้ว WMS ตามสถานะ
- ไม่ทำแอปมือถือ — หน้าเว็บต้องใช้บนแท็บเล็ต/มือถือได้
- ไม่ย้าย WD ที่คนทำตรงใน ATMS เข้าคิว (แสดงให้เห็นอย่างเดียวถ้าทำ — ดูเรื่องเปิด)

## สิ่งที่ห้ามเกิด (anti-goals)

- **WD ซ้ำ** — กดส่งสองครั้ง/เน็ตหลุดกลางทาง แล้วได้หัวใบ WD สองใบหรือบรรทัดซ้ำ = ตัดสต๊อกเกิน
- ตัดสต๊อกใต้ชื่อคนอื่น — ห้าม fallback ไปบัญชีกลาง/ของคนอื่นตอน session สโตร์หมดอายุ
- WD ขึ้นว่าสำเร็จใน WMS แต่ใน ATMS ยังไม่อนุมัติ (สต๊อกไม่ถูกตัด)
- ยิง ATMS รัวจนระบบทรุด (เคยเกิดแล้ว: 176 คำขอติดกัน ATMS error 40%)

## ATMS ที่สำรวจแล้ว (31/10/2026, เปิดดูอย่างเดียว ไม่ได้สร้างอะไร)

Zend form ไม่มี CSRF → POST form-urlencoded ได้ตรง; สำเร็จ = 302 ที่ Location มี id (แพทเทิร์นเดียวกับ api-ncac `/atms/openjob`)
session หมดอายุ = ได้หน้า login กลับมาด้วย HTTP 200 (เช็กลิงก์ `ออกจากระบบ` ไม่ใช่ status code)

**1. หัวใบ WD** `POST /inv/withdraw/add`
`type=withdraw` (hidden) · `inventory_id` (คลัง 22 ตัวเลือก เช่น 3=สระบุรี 4=ลาดกระบัง) · `pick_to_id` จุดประสงค์ในการเบิก (60 ตัวเลือก CM-/AC-/OTH- ...) · `extra_cost` (0.00) · `remark` · `extra_type` (hidden, `normal`)
หัวใบไม่มีช่อง MR

**2. รายการ** `POST /inv/withdraw.item/add/good_movement_id/<id>/inventory_id/<inv>` — 1 POST = 1 บรรทัด

| field | บังคับ | ค่าจาก |
|---|---|---|
| `good_movement_id`, `inventory_id` (hidden) | ✓ | หัวใบที่เพิ่งสร้าง |
| `maintenance_request_item_id` (+ text `maintenance_request_item`) | – | `GET /veh/maintenance.request.item/code.json/?q=&limit=` → `{id, name:"LBMR26100001 อู่ใน-CM-ระบบไฟ : 257041", driver, driver_id, mechanic, mechanic_id, accident_id}` |
| `sku_tag_id` กลุ่มสินค้า (28) | – | ใช้กรองการค้น SKU เท่านั้น |
| `sku_id` (+ text `sku`) | ✓ | `GET /inv/sku/sku.json/?q=&limit=&inventory_id=&sku_tag_id=` → `{id, code, name, inventory_id, sku_tag_id, has_serial_no}` (ไม่มียอดคงเหลือ) |
| `serial_no_id` (+ text) | เมื่อ `has_serial_no=1` | `GET /inv/deposit.item/serial.no.json/?q=&sku_id=` |
| `amount` | ✓ | จำนวนที่สโตร์จ่ายจริง |
| `remark` | – | |

**3. อนุมัติ** ลิงก์ `GET /inv/withdraw/approve/id/<id>` (จากหน้า view) — **ยังไม่ได้ลอง** ต้องทดสอบว่ามีหน้า confirm/POST ต่อหรือไม่ และตัดสต๊อกตอนนี้จริง
หน้า view `/inv/withdraw/view/id/<id>` มี รหัส (เช่น `LBWD26102206`), คลัง, จุดประสงค์, ประเภทพิเศษ, ค่าใช้จ่ายเสริม, **คืนอะไหล่ครบแล้ว**, หมายเหตุ, บันทึกเมื่อ, ผู้ใช้งาน + ปุ่ม แก้ไข / เพิ่มสินค้า / อนุมัติ
ค้นเลข WD: `GET /inv/withdraw/code.json/?q=LBWD2610&sku_id=` → `[{id, name}]` · list `/inv/withdraw/index` กรองได้ด้วย `code, pick_to, user, remark, inventory_id, spare_part_returned, from/to_created_at`

**4. คืนของ = ใบรับ (DD)** `POST /inv/deposit/add`
`type=deposit` · `purchase_order_id` ว่าง · `inventory_id` · `withdraw_id` (+ text `withdraw`, ค้นผ่าน `/inv/withdraw/code.json/?sku_id=`) · `supplier_ref_no` · `supplier_inv_date` · `extra_cost` · `remark` · `extra_type`
ตรงกับกฎที่รู้อยู่: DD ไม่มี PO แต่มี `withdraw_ref` = ของคืนเข้าสต๊อก
**ยังไม่ได้สำรวจ:** ฟอร์ม `deposit.item/add` (field บรรทัดคืน) และวิธีติ๊ก "คืนอะไหล่ครบแล้ว" (`spare_part_returned`) — ต้องดูในขั้นแรกของแผน

**5. ผู้ใช้ ATMS** `/account/user/profile` (ไม่มีฟอร์ม): ผู้ใช้งาน, อีเมล์ (@menatransport.co.th), ชื่อ, โทรศัพท์, สาขา, แผนก, เป็น พจส., เป็นช่าง, บริษัท

ใบทดสอบที่มีอยู่: WD id 560724 `LBWD26102206` คลังลาดกระบัง AC-เคสอุบัติเหตุ สร้างโดยผู้ใช้เอง 31/10/2026 11:57 ยังว่างและยังไม่อนุมัติ

## โครงที่มีอยู่แล้วใน WMS / api-ncac ให้ใช้ต่อ

- `lib/atms-cookie.ts` — PHPSESSID ของ ATMS ต่อผู้ใช้ เก็บที่ main-api (`/user/atms-cookie/<google_id>`, encrypt) + `ncacWithSession()` ยิง api-ncac พร้อม header `X-PHPSESSID`
- api-ncac `routes/atms/openjob.py` — ตัวอย่างการยิงฟอร์ม ATMS แทนผู้ใช้ (แจ้งซ่อม) ใช้แบบเดียวกัน
- `lib/atms-sku-live.ts` — อ่าน SKU สดผ่าน api-ncac (เพดาน 20 รหัส/คำขอ, fail-open)
- `atms_sku_master.stockQty` — สต๊อกคงเหลือ ซิงก์วันละครั้ง (ค้างได้ถึง 1 วัน)
- `lib/access-policy.ts` / `lib/dept-access.ts` / `/admin/users` — สิทธิ์ตามแผนก + ตั้งทับรายคน
- `middleware.ts` — รายการ API ที่เรียกด้วย `x-api-key` (+ `x-user`) แทน session ได้

## การออกแบบ

### บทบาท

| บทบาท | ทำอะไรได้ | ได้สิทธิ์จาก |
|---|---|---|
| ผู้ขอเบิก (ยานยนต์) | ยื่น/ยกเลิกคำขอ (ก่อนสโตร์รับงาน), กดรับแล้ว, ขอคืน, ดูคำขอตัวเอง | แผนกยานยนต์/ช่าง ผ่าน access-policy (section ใหม่ `store-withdraw.request`) |
| สโตร์ | จอคิว, รับงาน, จัด, ส่งของ (→ WD), รับคืน (→ DD), ปฏิเสธคำขอพร้อมเหตุผล | section ใหม่ `store-withdraw.store` + ต้องผูกบัญชี ATMS แล้ว |
| ระบบภายนอก | เรียก API ฝั่งผู้ขอเบิก | `x-api-key` แยกต่อระบบ + `x-user` (อีเมลคนที่ทำจริง) |
| แอดมิน | ทุกอย่าง + กดลองยิง ATMS ซ้ำเมื่อค้าง | `isAdmin` |

งานที่แตะ ATMS (ส่งของ, รับคืน) ทำผ่าน API key ไม่ได้ ต้องเป็นสโตร์ที่ login อยู่ (ต้องใช้ session ATMS ของคนนั้น) — **ผมตัดสินใจเอง**

### ผูกบัญชี ATMS ของสโตร์

ครั้งแรกที่สโตร์เปิดจอคิว: กรอก username/password ATMS → server ส่งต่อให้ api-ncac login → ได้ PHPSESSID → เก็บที่ main-api ตาม google_id (ทางเดิมของ `lib/atms-cookie.ts`) → อ่าน `/account/user/profile` เก็บ `atmsUsername`, ชื่อ, สาขา, แผนก ไว้กับผู้ใช้ WMS
อีเมลใน profile ต้องตรงกับอีเมล Google ที่ login WMS ไม่งั้นไม่ให้ผูก (กันผูกบัญชีคนอื่น) — **ผมตัดสินใจเอง**
คลังเริ่มต้นของจอคิว = map จากสาขาใน profile (เปลี่ยนเองได้ ดูได้หลายคลัง)
**เรื่องเปิด:** เก็บรหัสผ่าน ATMS (encrypt) เพื่อ login ใหม่เองเมื่อ session หมด (~30 นาที) หรือไม่เก็บแล้วให้สโตร์กรอกใหม่ทุกครั้งที่หมด

### ประเภทคำขอ

- **เบิกจากสต๊อกจริง** — ผ่านทุกช่อง: ใหม่ → กำลังจัด → พร้อมส่ง → ส่งแล้ว → รับแล้ว
- **เบิกตัดยอด** — ของถูกใช้ลงรถไปแล้ว แค่ตัดยอดในระบบ (ผู้ใช้ยืนยันคำเดาว่า "ใช่ๆ" แต่ยังไม่เคยอธิบายเอง) → ข้ามช่องกำลังจัด/พร้อมส่ง สโตร์ตรวจแล้วกด "ตัดยอด" = สร้าง WD เลย ไม่มีขั้นรับแล้ว

### สถานะคำขอ

```
NEW ──รับงาน──► PREPARING ──จัดครบ──► READY ──ส่งของ──► ISSUING ──ATMS ok──► ISSUED ──รับแล้ว──► RECEIVED
 │                 │                                       │
 ├─ยกเลิก (ผู้ขอ)   └─ปฏิเสธ (สโตร์, ต้องมีเหตุผล) ─► REJECTED   └─ATMS พัง──► ISSUE_FAILED ──ลองใหม่──► ISSUING
 ▼
CANCELLED
เบิกตัดยอด: NEW ──ตัดยอด──► ISSUING ──► ISSUED (จบ)
```

ต่อบรรทัด: `requestedQty`, `issuedQty` (สโตร์แก้ได้ถึง ≤ requested), `short` (ของขาด), `returnedQty`
บรรทัดที่ `issuedQty = 0` ไม่ส่งเข้า ATMS ถ้าทุกบรรทัดเป็น 0 → กดส่งไม่ได้ ต้องปฏิเสธแทน

คืนของเป็นเอกสารลูกของคำขอเดิม: `RETURN_REQUESTED ──รับคืน──► RETURNING ──ATMS ok──► RETURNED` (`RETURN_FAILED` เหมือนกัน)
คืนได้ไม่เกิน `issuedQty − returnedQty` ต่อบรรทัด · คืนครบทุกบรรทัด → ติ๊ก "คืนอะไหล่ครบแล้ว" ใน ATMS (วิธียังต้องสำรวจ)

### การยิง ATMS (หัวใจของงาน — ห้าม WD ซ้ำ)

ยิงจาก **api-ncac** (route ใหม่ `/atms/withdraw/*`, `/atms/deposit-return/*`) ด้วย `X-PHPSESSID` ของสโตร์ ตามแพทเทิร์น openjob — ไม่ยิงจาก Vercel ตรง เพราะ 1 ใบมีหลายคำขอติดกัน (หัวใบ + N บรรทัด + อนุมัติ) เสี่ยงชน timeout ของ Vercel — **ผมตัดสินใจเอง**

ขั้นตอน "ส่งของ" แบบกลับมาทำต่อได้ (resumable):
1. WMS ล็อกคำขอ (`status: NEW/READY → ISSUING` แบบ atomic `findOneAndUpdate` เงื่อนไขสถานะเดิม) — กดซ้ำ/สองแท็บ ได้แค่ครั้งเดียว
2. ถ้ายังไม่มี `atms.gmId` → POST หัวใบ → เก็บ `atms.gmId` ทันที **ก่อน** ทำขั้นต่อไป · `remark` หัวใบใส่เลขคำขอ WMS (เช่น `WMS SW-2610-012`) ไว้ใช้ตามหาใบถ้า response หาย
3. แต่ละบรรทัดที่ยังไม่มี `atmsItemDone` → POST รายการ → ติ๊ก done ทันที
4. อนุมัติ → เปิดหน้า view ตรวจว่าอนุมัติแล้ว + จำนวนบรรทัดตรง → เก็บ `atms.code` (LBWD…) → `ISSUED`
5. พังกลางทาง → `ISSUE_FAILED` พร้อมข้อความ · กดลองใหม่ = เริ่มขั้นที่ค้าง ไม่สร้างหัวใบใหม่
6. ถ้า response ของขั้น 2 หาย (ไม่รู้ว่าสร้างแล้วหรือยัง) → ค้น WD ที่ remark มีเลขคำขอก่อนสร้างใหม่

pacing: ระหว่างคำขอ ~1 วินาที, ไม่เกิน 1 ใบพร้อมกันต่อสโตร์ · session หมด → หยุด ขอให้สโตร์ login ATMS ใหม่ แล้วทำต่อจากขั้นที่ค้าง (ไม่ fallback บัญชีอื่น)

คืนของใช้กลไกเดียวกัน: DD หัวใบ (`withdraw_id` = WD เดิม, `purchase_order_id` ว่าง) → รายการคืน → อนุมัติ

### ซิงก์กลับจาก ATMS

- ทุกใบที่ WMS สร้าง: ตรวจหน้า view ซ้ำเมื่อเปิดดูใบนั้น และรอบเบื้องหลังสำหรับใบ 7 วันล่าสุด — ถ้าถูกถอนอนุมัติ/จำนวนบรรทัดเปลี่ยน/ถูกลบ ขึ้นธง "ATMS ถูกแก้" ให้สโตร์เห็น ไม่แก้ข้อมูลเองอัตโนมัติ
- รอบเบื้องหลังรันจาก api-ncac (Render) ไม่ใช่ Vercel cron — WMS ใช้ cron ครบ 2 ตัวของ Hobby แล้ว — **ผมตัดสินใจเอง**
- ใช้ activity log กรอง `model=good_movement` + `app_controller=withdraw` หา WD ที่ถูกแก้ แทนการไล่เปิดทุกใบ ถ้าทำได้

### จอคิวสโตร์ `/store-withdraw/queue`

ช่อง: ใหม่ · กำลังจัด · พร้อมส่ง · ส่งแล้ว (วันนี้) — ใบคืนอยู่ในจอเดียวกันแต่คนละสี
ใบงาน: เลขคำขอ, ทะเบียนรถ, MR, ประเภท, รายการ+จำนวน, ผู้ขอ, เวลารอ (เกินเกณฑ์ขึ้นสี), ชื่อสโตร์ที่รับงาน, เลข WD เมื่อส่งแล้ว
เรียงคิว: มาก่อนได้ก่อน ยกเว้นติดป้าย **"รถจอดรออะไหล่"** (ผู้ขอติดตอนยื่น) แซงขึ้นบน — **ผมตัดสินใจเอง**
อัปเดตเอง: poll ทุก ~10 วินาที (Vercel ไม่มี websocket) + เสียงเตือนเมื่อมีใบใหม่ — **ผมตัดสินใจเอง**
กรองคลัง (ค่าเริ่มต้นจากสาขาสโตร์) · ใช้บนแท็บเล็ตได้

### หน้าผู้ขอเบิก `/store-withdraw`

ฟอร์มยื่นคำขอ: ประเภท, คลัง, จุดประสงค์ (`pick_to`), MR (ค้นแล้วเลือก MR item), ป้ายรถจอดรอ, หมายเหตุ, รายการ SKU (ค้น + จำนวน + เห็นสต๊อก)
สต๊อกที่โชว์ = `atms_sku_master.stockQty` ตอนค้น และอ่านสด (`atms-sku-live`) ตอนสโตร์จัดของ — **ผมตัดสินใจเอง**
รายการคำขอของฉันพร้อมสถานะสด เหมือนดูว่าอาหารใกล้ได้หรือยัง · ปุ่มรับแล้ว / ขอคืน

### ข้อมูล (Mongo `master_data`)

- `store_withdraw_requests` — เลข `SW-YYMM-NNN` (YY = ค.ศ. ตามแบบ price-compare) ผ่าน `counters`, header + lines + `atms {gmId, code, itemDone[], approvedAt, lastCheckAt, drift}` + `returns[]`
- `store_withdraw_log` — ทุกการเปลี่ยนสถานะ ใคร เมื่อไร ช่องทาง (web/api)
- ข้อมูลผูกบัญชี ATMS ของสโตร์ (ที่เดียวกับข้อมูลผู้ใช้ที่มีอยู่ หรือ collection ใหม่ — ให้ผู้สร้างเลือก)

### API (ทุกขั้นเรียกได้)

```
GET    /api/store-withdraw/lookup/mr?q=          ค้น MR item (ผ่าน api-ncac)
GET    /api/store-withdraw/lookup/sku?q=&inv=    ค้น SKU + สต๊อก
GET    /api/store-withdraw/options               คลัง, จุดประสงค์
POST   /api/store-withdraw                       ยื่นคำขอ                     ผู้ขอ / x-api-key
GET    /api/store-withdraw?mine=1|inv=&status=   รายการ / คิว
GET    /api/store-withdraw/:no                   รายละเอียด + log
POST   /api/store-withdraw/:no/cancel            ยกเลิก (สถานะ NEW)           ผู้ขอ / x-api-key
POST   /api/store-withdraw/:no/claim             รับงาน                      สโตร์
PATCH  /api/store-withdraw/:no/lines             แก้จำนวนจ่าย / ของขาด         สโตร์
POST   /api/store-withdraw/:no/ready             จัดครบ                      สโตร์
POST   /api/store-withdraw/:no/issue             ส่งของ/ตัดยอด → WD (ลองใหม่ก็ endpoint นี้)  สโตร์ (session เท่านั้น)
POST   /api/store-withdraw/:no/reject            ปฏิเสธ + เหตุผล              สโตร์
POST   /api/store-withdraw/:no/receive           รับแล้ว                      ผู้ขอ / x-api-key
POST   /api/store-withdraw/:no/returns           ขอคืน                       ผู้ขอ / x-api-key
POST   /api/store-withdraw/:no/returns/:rid/accept  รับคืน → DD              สโตร์ (session เท่านั้น)
POST   /api/store-withdraw/atms-link             ผูกบัญชี ATMS ของสโตร์
```
หน้าคู่มือ API แบบ `/repair-external/api-guide`

## เรื่องที่ยังเปิด (ต้องถามผู้ใช้)

1. "เบิกตัดยอด" ทำงานจริงยังไง (ผู้ใช้ยังไม่ได้เล่าเอง)
2. "Safety Stock" กับ "อะไหล่ลงคัน" ในโน้ตคืออะไร — จุดประสงค์? ประเภทคำขอ?
3. เก็บรหัสผ่าน ATMS ของสโตร์ไว้ login ใหม่อัตโนมัติ หรือให้กรอกใหม่เมื่อหมด
4. ต้องมีหัวหน้าอนุมัติคำขอก่อนเข้าคิวสโตร์ไหม
5. เริ่มนำร่องคลังไหน (คาดว่าลาดกระบัง inv 4)
6. ใบที่คนคีย์ตรงใน ATMS ต้องโชว์ในจอคิวไหม

## ให้ผู้สร้างตัดสินใจเอง

ชื่อ collection/field ปลีกย่อย, หน้าตา component (ใช้ UX system เดิมของโปรเจกต์), จังหวะ poll, เกณฑ์สีเวลารอ, โครง route ใน api-ncac
