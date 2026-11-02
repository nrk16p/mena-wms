# Store withdraw (เบิกอะไหล่คลัง) — env vars

ใช้ค่าที่มีอยู่แล้วเป็นค่าเริ่มต้น ตั้งตัวใหม่เฉพาะเมื่ออยากแยกออกจากของเดิม (โค้ด: `lib/store-withdraw/env.ts`, `lib/store-withdraw/crypto.ts`, api-ncac `routes/atms/withdraw.py`)

## WMS (Vercel)

| ตัวแปร | ต้องตั้งไหม | ไม่ตั้ง = ใช้ |
|---|---|---|
| `NCAC_BASE` | มีอยู่แล้ว | — (URL ของ api-ncac) |
| `NCAC_API_KEY` | มีอยู่แล้ว | — ต้องเท่ากับ `PIPELINE_API_KEY` ของ api-ncac |
| `STORE_ATMS_CRED_KEY` | ไม่บังคับ | กุญแจที่สร้างจาก `NEXTAUTH_SECRET` (HKDF-SHA256) · ถ้าตั้งเอง: `openssl rand -base64 32` · เปลี่ยนกุญแจ (หรือเปลี่ยน `NEXTAUTH_SECRET` ตอนไม่ได้ตั้ง) = สโตร์ต้องผูกบัญชี ATMS ใหม่ |
| `ATMS_LOOKUP_USERNAME` / `ATMS_LOOKUP_PASSWORD` | ไม่บังคับ | ไม่ส่งบัญชี → api-ncac ใช้ `ATMS_USERNAME`/`ATMS_PASSWORD` ของตัวเอง (เฉพาะงานอ่าน) |
| `STORE_WITHDRAW_API_KEYS` | ไม่บังคับ | `ATMS_API_KEY` (กุญแจที่ Mena-Next ใช้อยู่) · ตั้งเอง = ใช้แค่ที่ตั้ง คั่นด้วยจุลภาค |
| `STORE_WITHDRAW_TICK_KEY` | ไม่บังคับ | `NCAC_API_KEY` · กุญแจ tick ใช้เป็นกุญแจผู้ขอไม่ได้เสมอ |
| `STORE_WITHDRAW_DB` | ไม่บังคับ | `master_data` |

## api-ncac (Render)

| ตัวแปร | ต้องตั้งไหม | ไม่ตั้ง = ใช้ |
|---|---|---|
| `PIPELINE_API_KEY` | มีอยู่แล้ว | — |
| `ATMS_USERNAME` / `ATMS_PASSWORD` | มีอยู่แล้ว | — ใช้เป็นบัญชีอ่านของงานนี้ด้วย (งานเขียน/ตัดสต๊อกใช้บัญชีสโตร์เสมอ) |
| `WMS_BASE` | ไม่บังคับ | `https://mena-wms.vercel.app` |
| `WMS_STORE_WITHDRAW_KEY` | ไม่บังคับ | `PIPELINE_API_KEY` (ตรงกับกุญแจ tick ฝั่ง WMS อยู่แล้วเพราะ `NCAC_API_KEY` = `PIPELINE_API_KEY`) |

อื่น ๆ (คนตั้งเองบน Render · ห้าม agent แก้)
- รัน uvicorn แบบ worker เดียว เพราะล็อกต่อผู้ใช้อยู่ใน process
- ตั้งเวลาเรียก `POST /pipeline/run/store-withdraw-drift` ทุก 30 นาที ช่วง 07:00–20:00 (หลังขึ้นระบบ)
- บัญชี `ATMS_USERNAME` ถูกใช้ร่วมกับ pipeline อื่น: งานอ่านรายการตั้ง rows-per-page ชั่วคราวแล้วคืนค่า ถ้าเจอรายการ pipeline ถูกตัดสั้นช่วงกลางวัน ให้แยกบัญชีอ่าน (ตั้ง `ATMS_LOOKUP_*` ฝั่ง WMS)

## ไฟล์แนบหลักฐาน (DO Spaces)

ใช้ตัวแปร `DO_SPACES_*` ชุดเดิม ไม่มีตัวแปรใหม่ · ไฟล์เก็บใต้ `store-withdraw/<เลขใบ>/` ใน bucket เดียวกัน (ไม่ใส่ `DO_SPACES_PREFIX`) และเป็น private ดูผ่านลิงก์ที่ระบบออกให้ อายุ 5 นาที

- เก็บ 7 ปี: **อย่าตั้ง lifecycle rule ของ bucket ให้ลบหรือหมดอายุ object ใต้ `store-withdraw/`** (ตั้งกฎลบเฉพาะ prefix อื่น) โค้ดไม่มีส่วนไหนลบไฟล์เหล่านี้
- bucket ต้องอนุญาต CORS `PUT` จากโดเมน WMS (ตั้งไว้แล้วถ้าอัปโหลด PDF ของ AP ใช้งานได้อยู่)
- การทำงานของ audit ใช้ collection `store_withdraw_attachments` (เพิ่มอย่างเดียว) และ `store_withdraw_log` ที่มี `seq` + `hash` ต่อโซ่ · index ใหม่สร้างเองตอนเรียกใช้ครั้งแรก (`{no, seq}` unique แบบ partial, `{createdAt}`)
- สิทธิ์ดูหน้าตรวจสอบย้อนหลัง: ส่วน `store-audit` ให้รายคนที่ /admin/users (ค่าเริ่มต้น ไม่มีใครเห็น ยกเว้นผู้ดูแลระบบ)
