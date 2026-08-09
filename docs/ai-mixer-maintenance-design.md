# ระบบ AI ช่วยจัดการงานซ่อมรถโม่ (Fleet Mixer Truck Maintenance) — ทดสอบระบบ

> สถานะ: ทดสอบระบบ · เห็นเฉพาะ `narongkorn.a@menatransport.co.th` (sidebar + server guard 404)
> ออกแบบ 2026-08-09

## แนวคิด

ทุกขั้นตอนเป็น loop เดียวกัน: **Input → AI วิเคราะห์ (ข้อเสนอ) → User ยืนยัน/แก้ → ขั้นถัดไป**
AI ไม่ใช่ผู้ตัดสินใจสุดท้าย — ผู้ใช้ (ผู้แจ้ง / QC / Mechanic Supervisor) ยืนยันทุกขั้น และระบบเก็บทั้ง "ผล AI" และ "ผลที่ยืนยัน" เป็น audit trail

## Flow 3 ขั้นตอน

| ขั้น | ผู้รับผิดชอบ | Input | AI ทำอะไร | User ยืนยันอะไร |
|---|---|---|---|---|
| 1. รับแจ้งซ่อม | Mena Go / Trainer / ผู้แจ้ง | ข้อความแจ้งซ่อมดิบ + ทะเบียน (map vehicle master) | แยกอาการเป็นรายการ, จัดหมวดระบบ, ประเมินความเร่งด่วน+ความปลอดภัย | รายการอาการ + ข้อมูลรถ |
| 2. QC ตรวจก่อนซ่อม | QC | ใบแจ้งซ่อมที่ยืนยันแล้ว | สร้าง Checklist ตรวจเฉพาะอาการ (รวมจุดข้างเคียง) + อะไหล่คาดว่าต้องใช้ | ผลตรวจต่อข้อ (ปกติ/พบปัญหา/ไม่ได้ตรวจ), ยืนยันอาการ (พบจริง/ไม่พบ), อาการพบเพิ่ม |
| 3. Supervisor วิเคราะห์ | Mechanic Supervisor | ผลตรวจ QC | วิเคราะห์สาเหตุ, จัดลำดับความสำคัญ, ประเมิน Impact+เวลาซ่อม, สรุปอะไหล่+Spec, แยกซ่อมตอนนี้/เลื่อนได้ | อาการ, ลำดับงาน, ซ่อม/ไม่ซ่อม (toggle ได้), Spec อะไหล่ → บันทึก |

ขั้นถัดไป (เฟสหน้า): เชื่อมผลที่ยืนยันเข้ากับการเปิดงานซ่อมจริง (openjob / repair-external)

## Implementation

| ส่วน | ไฟล์ |
|---|---|
| Prompt + JSON schema ทั้ง 3 ขั้น + allowed emails | `lib/ai-mixer.ts` |
| API เรียก Claude (`claude-opus-5`, structured outputs, system prompt cache) | `app/api/ai-mixer-maintenance/analyze/route.ts` |
| บันทึก session ที่ยืนยันครบ (collection `ai_mixer_sessions`) | `app/api/ai-mixer-maintenance/sessions/route.ts` |
| หน้า wizard 3 ขั้น + server guard (404 ถ้าไม่ใช่ email ที่อนุญาต) | `app/ai-mixer-maintenance/page.tsx` + `components/ai-mixer-maintenance-page.tsx` |
| กลุ่มเมนู sidebar เฉพาะ email (`visibleToEmails`) | `components/sidebar.tsx` |

- ทุกครั้งที่เรียก AI จะ log ลง collection `ai_mixer_logs` (input, output, usage) — fail-soft
- ข้อมูลรถดึงจาก `vehicle_master` ผ่าน `/api/vehicles?plates=` แล้วผู้ใช้แก้/เติมได้ (ลูกค้า, อายุรถ, เลขไมล์ กรอกเอง)
- ต้องตั้ง env `ANTHROPIC_API_KEY` (local `.env.local` + Vercel)

## Prompt design

- **System prompt เดียวใช้ร่วมทุกขั้น** (มี `cache_control` ประหยัด token): กำหนดบทบาท "AI ผู้ช่วยจัดการงานซ่อมรถโม่", ตอบไทยศัพท์ช่าง, ใช้ข้อมูลรถประกอบเสมอ, ความปลอดภัย (เบรก/พวงมาลัย/ล้อ/ลม) priority สูงสุด, ห้ามฟันธงเกินข้อมูล
- **Structured outputs** (`output_config.format = json_schema`) ทุกขั้น → ได้ JSON ตรง schema มา render หน้า confirm ได้ทันที ไม่ต้อง parse เอง
- Schema เต็มอยู่ใน `lib/ai-mixer.ts` (STEP1_SCHEMA / STEP2_SCHEMA / STEP3_SCHEMA)

## ตัวอย่างข้อมูลทดสอบ

- แจ้งซ่อม: "ลูกปืนล้อหน้าข้างซ้ายแตกและฝาครอบหลุดหาย"
- รถ: ทะเบียน สบ.71-1256 · เลขรถ TH1090 · ลูกค้า SCCO · แพล้นท์ บางนา2 · ประเภท MS · อายุ 13 ปี 6 เดือน · ไมล์ 153,656 km
