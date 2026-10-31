# Store withdraw (เบิกอะไหล่คลัง) — env vars

## WMS (Vercel)

- `NCAC_BASE` — URL ของ api-ncac (Render) ที่ WMS ยิงไปหา ATMS
- `NCAC_API_KEY` — key ที่ส่งใน header `x-api-key` ไป api-ncac · ค่าเท่ากับ `PIPELINE_API_KEY` ของ api-ncac
- `STORE_ATMS_CRED_KEY` — กุญแจเข้ารหัสบัญชี ATMS ที่ผู้ใช้บันทึกไว้ · สร้างด้วย `openssl rand -base64 32` ตั้งครั้งเดียว ห้ามเปลี่ยน ไม่งั้นบัญชีที่บันทึกไว้ถอดรหัสไม่ได้ทั้งหมด
- `ATMS_LOOKUP_USERNAME` / `ATMS_LOOKUP_PASSWORD` — บัญชี ATMS แบบอ่านอย่างเดียวที่เห็นคลังลาดกระบัง ใช้ค้นสินค้า/ใบเบิก
- `STORE_WITHDRAW_API_KEYS` — key ของผู้ขอจากระบบภายนอก คั่นด้วยจุลภาค
- `STORE_WITHDRAW_TICK_KEY` — key ของ endpoint `/api/store-withdraw/drift-tick` · ต้องเท่ากับ `WMS_STORE_WITHDRAW_KEY` ของ api-ncac
- `STORE_WITHDRAW_DB` — (ไม่บังคับ) ชื่อ database ถ้าไม่ตั้งใช้ `master_data`

## api-ncac (Render)

- `PIPELINE_API_KEY` — key ของ api-ncac เอง ต้องเท่ากับ `NCAC_API_KEY` ฝั่ง WMS
- `WMS_BASE` — URL ของ WMS (เช่น https://mena-wms.vercel.app)
- `WMS_STORE_WITHDRAW_KEY` — ต้องเท่ากับ `STORE_WITHDRAW_TICK_KEY` ฝั่ง WMS
- รัน uvicorn แบบ worker เดียว เพราะล็อกต่อผู้ใช้อยู่ใน process
- ตั้งเวลาเรียก `POST /pipeline/run/store-withdraw-drift` ทุก 30 นาที ช่วง 07:00-20:00 · คนตั้งเองบน Render (ห้าม agent แก้)
