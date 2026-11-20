# อะไหล่ Hub (consignment) — design

วันที่ 2026-11-20 · branch `feat/hub-parts` · นำร่องคลังลาดกระบัง (inventoryId 4)

## 1. ทำไม

อะไหล่ Hub = อะไหล่ที่ Sub (supplier) เอามาวางไว้ที่สโตร์ก่อน เราจ่ายเงินทีหลังเฉพาะที่เบิกไปใช้จริง ตอนนี้มี Sub 1 เจ้า

ปัญหาวันนี้: ยานยนต์ขอเบิกโดยยังไม่มี PR → ไม่มี PR ก็จ่ายเงิน Sub ไม่ได้ → Sub ไม่เติมของ
เป้าหมาย: ทุกการเบิกของ Hub ต้องมี PR ผูก ภายใน 1 วันหลังสโตร์จ่ายของ ถ้าเกินระบบต้องเตือนให้เห็น และของที่จ่ายต้องตัด WD ใน ATMS

## 2. เป้าหมาย / ไม่ใช่เป้าหมาย / ห้ามเป็น

เป้าหมาย
- master อะไหล่ Hub + vendor + ยอดคงเหลือ Hub (ใน WMS อย่างเดียว)
- สโตร์รับของ Hub เข้า WMS แบบลอย (ยังไม่เข้า ATMS)
- ฟอร์ม `/store-withdraw/new` มีกล่องที่ 4 "รายการอะไหล่ Hub" ค้นจาก master Hub
- สโตร์จ่ายของ → ตัดยอด Hub + ตัด WD ใน ATMS แยกใบจากของปกติ
- ผูก PR (ยานยนต์เปิดเองใน ATMS) · เกิน 1 วันยังไม่มี = เตือนในระบบ
- Sub ล็อกอิน `/vendor-portal` เห็นยอดคงเหลือ Hub ของตัวเอง

ไม่ใช่เป้าหมาย (phase 1)
- ขารับของเข้า ATMS (ทำแยกงาน), PO, DD, สร้าง PR อัตโนมัติ
- คืนของให้ Sub, ตรวจนับ, ของเสียหาย, LINE, เทียบราคา
- คลังอื่นนอกจากลาดกระบัง (ออกแบบให้ขยายได้ แต่ไม่เปิด)

ห้ามเป็น (ถึงจะทำงานได้ก็ถือว่าพัง)
- ยอด Hub ติดลบ หรือตัดซ้ำเมื่อกดลองใหม่
- WD ของ Hub ล้มแล้วทำให้ WD ของปกติในใบเดียวกันค้าง (หรือกลับกัน)
- Sub เห็นข้อมูลภายใน (ใครเบิก ทะเบียนรถ PR ราคา) หรือเห็นของ Sub เจ้าอื่น
- บรรทัด Hub หลุดเข้า WD ของปกติ

## 3. ข้อจำกัด

- ไม่เขียนลง ATMS / prod DB ระหว่าง dev · live test ผู้ใช้ทำเอง
- ไม่ push main จนผู้ใช้สั่ง (main auto-deploy Vercel)
- WD ใช้ endpoint เดิม `POST /atms/withdraw/issue` ของ api-ncac (ไม่ต้องแก้ api-ncac) ด้วยบัญชี ATMS ของสโตร์คนที่กด
- ค้น PR ใช้ `/atms/withdraw/doc/search` + `/doc/pr/{id}` เดิม (อ่านอย่างเดียว)
- รหัสอะไหล่ Hub = SKU เดียวกับ ATMS (มี skuId จาก `atms_sku_master`) — ไม่งั้นตัด WD ไม่ได้
- WD ของ Hub จะผ่านได้เมื่อ ATMS มีสต๊อก SKU นั้นแล้ว (ขารับทำแยก) → ต้องรองรับ "ลองใหม่"

## 4. แนวทางที่พิจารณา

1. **บรรทัด Hub อยู่ในใบ SW เดิม + กลุ่ม WD ของ Hub แยก (เลือก)** — ติดธง `hub` ที่บรรทัด, มี `hubWd: AtmsProgress` ของตัวเองแบบเดียวกับ `settleGroups` ของ Mobile/PM. จอคิว การ์ด audit ใช้ของเดิม ยานยนต์/สโตร์เห็นใบเดียว. ต้องแก้ `runIssue` ให้กรองบรรทัด Hub ออก
2. แตกเป็นใบลูก SW-…-H ตอนยื่น — แตะโค้ดเดิมน้อยสุด แต่จอคิวมี 2 การ์ด สโตร์จัด 2 รอบ เลขสองเลข
3. โมดูล Hub แยก มีคิวเอง — ทำซ้ำเกือบทั้งหมด ไม่ตรงกับที่ผู้ใช้อยากได้ (กล่องในฟอร์มเดิม)

ผู้ใช้เลือกแบบ 1 (2026-11-20) · ผู้ใช้เลือกให้ใบที่ปนของปกติ+Hub แยก WD ได้

## 5. สิ่งที่ผู้ใช้ตัดสินแล้ว

- PR ยานยนต์เปิดเองใน ATMS ระบบแค่ผูกเลข
- ไม่มี PR ก็เบิกได้ · นับ 1 วันจากเวลาจ่ายของ · เกิน = เตือนในระบบ ไม่บล็อก ไม่ LINE
- ไม่มี PO/DD · ตัด WD ตอนจ่ายของ · ปิดงาน Hub = มี PR + WD Hub สำเร็จ
- 1 ใบเบิก = PR เดียวสำหรับส่วน Hub
- ราคาใน master ใช้อ้างอิงเท่านั้น
- Sub เห็นแค่ยอดคงเหลือ
- กล่องใหม่ "รายการอะไหล่ Hub" ในฟอร์มเดิม ใช้ฐานข้อมูลอะไหล่ Hub
- ใบปนของปกติ + Hub ได้ แยก WD
- ของ Hub ใน ATMS อยู่ **คลังแยก** สำหรับ Hub → WD Hub ส่ง `inventory_id` = คลัง Hub นั้น ไม่ใช่คลังของใบ (เลขคลังรอผู้ใช้ให้ · เก็บเป็น config ไม่ hardcode)
- Mobile/PM (pending flow): ตัดยอด Hub ตอนจ่ายของ (handOut) · ตัด WD Hub ตอนสรุป/settle ตามจำนวนที่ใช้จริง · ของเหลือคืนเข้ายอด Hub

## 5.1 การตัดสินของผู้เขียน (ผู้ใช้ยังไม่ได้ยืนยันทีละข้อ)

- ใบถูก reject / closeManual หลังตัดยอด Hub แล้ว และ WD Hub ยังไม่สำเร็จ → คืนยอด Hub อัตโนมัติ (move `adjust` +) · WD Hub สำเร็จแล้ว = ไม่คืน
- phase 1 บรรทัด Hub ใช้ flow คืนของ (returns) ไม่ได้ — ปุ่มคืนซ่อน + API ปฏิเสธ (ยกเว้นของเหลือจากสรุป Mobile/PM ที่คืนเข้ายอด Hub ตามข้อบน)
- บรรทัดซาก (core-return) ของบรรทัด Hub สร้างเหมือนของปกติ แต่หลัง WD Hub สำเร็จเท่านั้น
- Sub ที่ยังไม่มีบัญชี vendor-portal → สร้างจากปุ่มเดิมที่ `/ap-tracking/suppliers` ไม่ต้องทำอะไรเพิ่ม

## 6. การออกแบบ

### 6.1 ข้อมูล (Mongo db เดียวกับ store-withdraw)

`hub_sites` — `{ inventoryId (คลังของใบเบิก เช่น 4), atmsHubInventoryId (คลัง Hub ใน ATMS ที่ WD Hub ตัด), active }` · ไม่มีแถว active = คลังนั้นไม่มีกล่อง Hub

`hub_vendors` — `{ code (ATMS supplier code), name, active, createdAt }`

`hub_items` — `{ vendorCode, inventoryId, skuId, skuCode, skuName, unit, price, active, updatedAt }` unique `(inventoryId, vendorCode, skuId)`

`hub_stock` — ยอดคงเหลือ `{ inventoryId, vendorCode, skuId, qty }` unique key เดียวกัน · แก้ด้วย `$inc` แบบมีเงื่อนไข (`qty >= n`) เท่านั้น

`hub_moves` — สมุดเคลื่อนไหว append-only `{ type: "receive"|"issue"|"return"|"adjust", inventoryId, vendorCode, skuId, qty (+/-), refNo (เลขเอกสารส่งของของ Sub หรือ SW no), lineIndex?, by, at }` unique `(type, refNo, lineIndex)` สำหรับ issue → กันตัดซ้ำ. ยอดใน `hub_stock` ต้องเท่ากับผลรวม `hub_moves` เสมอ (มีสคริปต์เช็ก)

### 6.2 ใบ SW (เพิ่ม field ไม่แตะของเดิม)

- `SwLine.hub?: { vendorCode: string }` — มี = บรรทัด Hub
- `SwRequest.hubWd?: AtmsProgress` — WD ของบรรทัด Hub (remark_token = `${no}-H`)
- `SwRequest.hubPr?: { code, id, by, at } | null`
- `SwRequest.hubIssuedAt?: Date | null` — เวลาจ่ายของ Hub (จุดเริ่มนับ 1 วัน)
- `SwRequest.hubStatus?: "WAIT_ISSUE" | "WAIT_PR" | "WAIT_WD" | "WAIT_PR_WD" | "DONE"` — คำนวณจาก field ด้านบน เก็บไว้เพื่อ index/กรอง

สถานะหลักของใบ (`status`) เดินตามเดิมสำหรับส่วนปกติ. ใบที่มี **แต่** บรรทัด Hub: ใช้ `status` เดิมเหมือนกัน (ISSUED = จ่ายแล้ว) และดู `hubStatus` ประกอบ

### 6.3 ฟอร์มขอเบิก (`components/store-withdraw/request-form.tsx`)

- กล่อง 4 "รายการอะไหล่ Hub" ใต้กล่อง 3 · โชว์เมื่อคลังที่เลือกมี `hub_items` active
- ช่องค้น `HubPicker` ค้น `hub_items` ของคลังนั้น (รหัส/ชื่อ) โชว์ชื่อ Sub + คงเหลือ Hub
- บรรทัดหน้าตาเหมือน `renderLine` (จำนวน, หมายเหตุ, ประเภทการซ่อม MR) + ป้าย "Hub"
- ขอเกินคงเหลือ Hub = เตือนแบบเดียวกับของปกติ (ไม่บล็อกตอนยื่น)
- PR: ถ้ามีบรรทัด Hub ให้โชว์ข้อความใต้กล่อง 4 "มี PR แล้วผูกได้เลย ถ้ายังไม่มี ต้องผูกภายใน 1 วันหลังรับของ" + ปุ่มผูก PR (ใช้ `DocRefPicker` kind=pr ตัวเดิม). การเลือก PR ตรงนี้ **ไม่** นำเข้าบรรทัดอะไหล่
- เงื่อนไขยื่น: รายการปกติ + Hub รวมกัน ≥ 1 (เดิมบังคับกล่อง 3 ≥ 1)
- API `POST /api/store-withdraw` รับ `lines[].hub` + `hubPr` · ฝั่ง server เช็กว่า SKU นั้นอยู่ใน `hub_items` active ของคลังนั้นจริง

### 6.4 จอคิวสโตร์ + จ่ายของ

- การ์ดโชว์ป้าย "Hub n รายการ" · แผงรายละเอียดแยกหัวข้อ "รายการอะไหล่ Hub"
- สโตร์กด "ส่งของ" (action `issue` เดิม):
  1. ตัดยอด Hub ทุกบรรทัด Hub (ตาม `issuedQty ?? requestedQty`) แบบ atomic: ไม่พอ = ไม่ตัดเลยสักบรรทัด แจ้ง "ยอด Hub ไม่พอ" แล้วหยุดทั้งการกด (สโตร์แก้จำนวนแล้วกดใหม่) · บันทึก `hub_moves` + `hubIssuedAt`
  2. WD ของปกติ: `runIssue` เดิม แต่ `issueLines` กรองบรรทัด Hub ออก · ใบที่ไม่มีบรรทัดปกติ = ข้ามขั้นนี้แล้วถือว่าส่วนปกติเสร็จ
  3. WD ของ Hub: เรียก `/atms/withdraw/issue` อีกครั้งเฉพาะบรรทัด Hub ด้วย `inventory_id: hub_sites.atmsHubInventoryId`, `remark_token: ${no}-H` · progress เก็บที่ `hubWd`
  - ลำดับ: ตัดยอด Hub ก่อน แล้วยิง WD ปกติกับ WD Hub (ไม่ขึ้นต่อกัน) · ใบปิดแบบไม่สำเร็จทีหลัง → ดู 5.1
- **Mobile/PM (pending flow)**: action `issue` ไม่มีในสายนี้ (`nextStatus` คืน null) จึงผูกกับ `handOut` แทน
  - handOut → ตัดยอด Hub ตามจำนวนที่จ่าย + บันทึก `hubIssuedAt` (เริ่มนับ 1 วัน PR) · ยังไม่ยิง WD Hub
  - settle → นอกจาก `settleGroups` ปกติ ให้สร้างกลุ่ม Hub ต่อทะเบียน (`settleGroups` ที่มี `hub: true`, token `${no}-H${n}`, inventory = คลัง Hub) ตามจำนวนที่สรุปว่าใช้ · บรรทัดปกติกับ Hub ไม่อยู่กลุ่มเดียวกัน
  - ของ Hub ที่เหลือจากสรุป (เบิก − ใช้) → `hub_stock +` move `return` ตอนสโตร์ยืนยันรับคืน (returnConfirmed เดิม)
  - `hubStatus` DONE = มี PR + กลุ่ม Hub ทุกกลุ่ม DONE
  - ข้อ 2 กับ 3 ไม่ขึ้นต่อกัน: ข้อ 3 ล้ม → `hubStatus` = WAIT_WD (หรือ WAIT_PR_WD) ส่วนปกติยัง ISSUED ได้
  - ปุ่ม "ลองตัด WD Hub ใหม่" บนการ์ด/แผงรายละเอียด (สิทธิ์ store-queue) · ลองใหม่ไม่ตัดยอด Hub ซ้ำ (unique ใน `hub_moves`)
- การ์ดคอลัมน์ "ส่งแล้ว" ที่ยังไม่มี PR ขึ้น "ส่งแล้ววันนี้ → รอ PR อะไหล่ Hub" · เกิน 24 ชม. จาก `hubIssuedAt` = ป้ายแดง "เกินกำหนด PR"

### 6.5 ผูก PR ทีหลัง

- หน้าใบของฉัน (ผู้ขอ) และแผงรายละเอียด (สโตร์) มีปุ่ม "ผูก PR อะไหล่ Hub" → `DocRefPicker` kind=pr → `POST /api/store-withdraw/:no/hub-pr`
- ผูกแล้วเปลี่ยนได้ (เก็บ log ทุกครั้ง) · ต้องเป็น PR ที่ค้นเจอใน ATMS
- `hubStatus` = DONE เมื่อ `hubPr` มี และ `hubWd.code && hubWd.approved`

### 6.6 แจ้งเตือนในระบบ

- เดิม WMS มี alerts widget? → ถ้ามีใช้ของเดิม ถ้าไม่มี: แถบเตือนบนหัวหน้า `/store-withdraw` (ผู้ขอ: "มี n ใบรอผูก PR อะไหล่ Hub · เกินกำหนด m ใบ") และบนจอคิวสโตร์ (ตัวกรอง "รอ PR Hub")
- นับเกินกำหนดตอนอ่าน (ไม่ต้องมี cron)

### 6.7 หน้า Hub ของสโตร์ `/store-withdraw/hub`

สิทธิ์: ใหม่ section `store-hub` (ให้รายคนที่ `/admin/users` แบบเดียวกับ store-queue)

- แท็บ "คงเหลือ": ตาราง คลัง × Sub × SKU × คงเหลือ × ราคา
- แท็บ "รับเข้า": เลือก Sub → เพิ่มบรรทัด (ค้น SKU จาก `atms_sku_master`) จำนวน + เลขเอกสารส่งของ → บันทึก (เพิ่ม `hub_stock` + `hub_moves` receive) · SKU ที่ยังไม่อยู่ใน `hub_items` ถูกเพิ่มให้อัตโนมัติ (ราคาใส่ได้)
- แท็บ "รายการอะไหล่": แก้ราคา/หน่วย/ปิดใช้งาน
- แท็บ "Sub": เพิ่ม/ปิด vendor (เลือกจาก supplier master ATMS)
- แท็บ "ความเคลื่อนไหว": `hub_moves` กรองตาม Sub/SKU/วันที่ + Excel

### 6.8 Vendor portal

- `/vendor-portal` เพิ่มแท็บ "สต๊อกฝากขาย" เห็นแค่ `hub_stock` ที่ `vendorCode` = รหัสของบัญชีที่ล็อกอิน: รหัส ชื่อ คงเหลือ หน่วย (ไม่มีราคา ไม่มีประวัติ)
- แท็บโชว์เฉพาะบัญชีที่มี `hub_vendors` active

### 6.9 Audit

ทุก action ใหม่ (hubIssue, hubWdRetry, hubPr, hubReceive) เขียน `store_withdraw_log` (hash chain เดิม) · รับเข้า/แก้ master เขียน log ของ hub เอง

## 7. ทดสอบ

- unit แบบไม่ต้องใช้ DB สำหรับ: ตัดยอด atomic, คำนวณ hubStatus, เกินกำหนด, issueLines กรอง Hub, idempotent retry
- integration กับ mongodb-memory-server (ถ้าโปรเจกต์ใช้อยู่) สำหรับ `$inc` มีเงื่อนไข + unique moves
- ไม่ยิง ATMS จริง: mock `callNcac`

## 8. ปล่อยให้คนสร้างตัดสินเอง

ชื่อ component/route ย่อย, layout ตาราง, ข้อความ UI (ภาษาคนพูด ตาม humanizer), วิธี index, รูปแบบ Excel
