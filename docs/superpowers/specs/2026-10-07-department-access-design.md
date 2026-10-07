# สิทธิ์ตามแผนก (department access) — design

Date: 2026-10-07 · Branch: `feat/superadmin-users` · แทนที่ส่วน "กลุ่ม (groups)" ของ
`2026-10-06-superadmin-user-access-design.md` — ส่วนที่ยังใช้จาก spec เดิม: หน้า superadmin, `wms_users`,
รีเฟรชสิทธิ์ใน session ทุก 5 นาที, ตรวจ JWT จริงใน middleware, superadmin = narongkorn.a เท่านั้น

## Decisions (user, 2026-10-07)

| Topic | Decision |
|---|---|
| ที่มาของสิทธิ์ | **แผนกจาก HR (api-ncac) อัตโนมัติ** + superadmin ตั้งทับรายคนได้ |
| ระดับ | 3 ระดับต่อส่วนงาน: `none` (ไม่เห็น) · `view` (ดูอย่างเดียว) · `edit` (แก้ได้) |
| การบังคับ | `none` → ซ่อนเมนู + บล็อกหน้า + บล็อก API · `view` → บล็อก API เขียน (POST/PUT/PATCH/DELETE) |
| ตารางสิทธิ์ | ตามร่างที่อนุมัติ 2026-10-07 (ด้านล่าง) |
| แผนกที่ไม่อยู่ในตาราง / ไม่มีข้อมูล HR | ใช้สิทธิ์ "ทั่วไป" |
| เมนู "ติดตามสินค้า" | แยกเป็น 2 ส่วน: `pr` (PR / คำขอเปิด PO) กับ `ap` (เจ้าหนี้) |

## ส่วนงาน (sections)

`sku` · `pr` · `ap` · `price-compare` · `vendor` · `safety-stock` · `deadstock` · `tire` · `repair` ·
`driver-handover` · `ai-mixer` — หน้าหลักเห็นเสมอ · `/admin/*` เฉพาะ superadmin

## ตารางสิทธิ์ (E = edit, V = view, — = none)

| ส่วนงาน | ยานยนต์ | Procurement | Accounting | Finance | จัดส่ง×3 / Operation Support / Safety Management | Recruitment - Mass | Chief-Level / Compliance / Company Secretary & Compliance | ทั่วไป |
|---|---|---|---|---|---|---|---|---|
| sku | E | E | V | — | V | — | V | V |
| pr | E | E | V | V | E | — | V | E |
| ap | — | V | E | E | — | — | V | — |
| price-compare | V | E | V | — | — | — | V | — |
| vendor | E | E | V | — | — | — | V | — |
| safety-stock / deadstock | V | E | V | — | — | — | V | — |
| tire | E | V | — | — | V | — | V | — |
| repair | E | E | V | — | V | — | V | — |
| driver-handover | V | — | — | — | E | E | V | — |
| ai-mixer | — | — | — | — | — | — | — | — |

- Information Technology, admin (lib/roles.ts) และ superadmin → `edit` ทุกส่วน
- ai-mixer ยังจำกัดอีเมลตาม `visibleToEmails` เดิม (สองคนนั้นเป็น admin อยู่แล้ว)
- กฎเดิมยังทำงานซ้อน: บัญชี/การเงิน (ปุ่มใน AP), ผู้อนุมัติอู่, สาขายาง, adminOnly

## API ที่ใช้ร่วมกัน (อ่านได้ทุกคนที่ล็อกอิน)

`/api/vehicles`, `/api/vehicle-daily`, `/api/codes`, `/api/garage-master`, `/api/vendors/names`,
`/api/repair-history`, `/api/sku` (GET), `/api/media`, `/api/atms/*` — การเขียนยังคุมตามส่วนงานเจ้าของ
(ยกเว้น `/api/atms/*`, `/api/media` ไม่คุม)

## การบังคับ (middleware)

หลังเส้นทาง public / cron / mobile x-api-key เดิม: `getToken()` (cookie ปลอม → login / 401) →
`/admin` เฉพาะ superadmin → คำนวณสิทธิ์จาก token (แผนก + override + admin) → หน้า: `none` → `/unauthorized`
· API: GET ต้อง ≥ view (ยกเว้น API ร่วม) · เขียนต้อง edit → 403 `{ error: <ข้อความไทย>, code: "no_access", section, need }`

## Session

jwt callback: ตอน login และทุก 5 นาที อ่าน `wms_access_overrides` ของผู้ใช้ + upsert `wms_users`
(ชื่อ แผนก สาขา lastSeen) · DB ล่ม → ใช้ค่าเดิมใน token · `session.user.access` = สิทธิ์ที่คำนวณแล้ว (ให้ UI ใช้)

## UI

Sidebar/หน้าหลักซ่อนส่วนงาน `none` · หน้าส่วนงาน `view` มีแถบ "ดูอย่างเดียว" ด้านบน ·
`/unauthorized` · `/admin/users` (superadmin): รายชื่อผู้ใช้ + แผนก + สิทธิ์ที่ได้จริง, ตั้งทับรายคนรายส่วนงาน
(ตามแผนก / none / view / edit), ประวัติการเปลี่ยน (`wms_access_log`)

## Data (master_data, ใหม่ทั้งหมด)

`wms_users` (email unique) · `wms_access_overrides` ({email, overrides: {section: level}, updatedAt, updatedBy}) ·
`wms_access_log` ({at, by, target, before, after})

## Out of scope

ซ่อนปุ่มแก้ไขทีละหน้า (v1 ใช้แถบ + ข้อความ 403) · คุม `/api/atms/*` · API key ให้ sync API (แผนแยก)
