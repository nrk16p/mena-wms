# Change Tire Request — API Specification สำหรับ Mobile App

สรุปการทำงานทั้งหมดของหน้า **ขอเปลี่ยนยาง** (`/tire/<branch>/change-tire-request`)
ในมุมของ API เพื่อให้ mobile dev สร้างหน้าเดียวกันใน app ได้ครบทุก feature

> เวอร์ชันเต็มของ API อื่น ๆ (stock, sync) ดูที่ `docs/mobile-api.md`

---

## 1. ภาพรวม Flow

ผู้ใช้ (คนขับ) กรอกฟอร์ม → ค้นหา → เห็นประวัติยางทุกเส้นของรถ → กดขอเปลี่ยนยางรายเส้น (พร้อมรูป/สาเหตุ) → admin อนุมัติรายเส้นในเว็บ → นัดหมาย → เสร็จสิ้น

```
┌─ ฟอร์ม ──────────────────────────────────────────────┐
│ ชื่อคนขับ* / ทะเบียนรถ* / เบอร์รถ* / เลขไมล์ปัจจุบัน*    │
│ ฟลีท / Plant (เติมอัตโนมัติหลังค้นหา แก้ไขได้)           │
└──────────────────┬───────────────────────────────────┘
                   ▼ กดค้นหา (ยังไม่บันทึกอะไรลง DB!)
   ┌── เรียกพร้อมกัน 4 เส้น ──────────────────────────┐
   │ A. GET /api/tire-change          ประวัติยาง       │
   │ B. GET /api/vehicles             ข้อมูลรถ+ฟลีท+plant│
   │ C. GET /api/tire-stock           ราคา+ระยะทางตามserial│
   │ D. GET /api/tire-change-request  สถานะคำขอเดิมของรถ │
   └──────────────────┬───────────────────────────────┘
                      ▼ แสดงตารางยางรายเส้น
        ผู้ใช้กด "ขอเปลี่ยนยาง" ที่เส้นที่ต้องการ
                      ▼ เส้นแรกเท่านั้น:
        E. POST /api/tire-change-request        ← สร้างคำขอ (เก็บ _id)
                      ▼ ทุกเส้น:
        F. POST /api/tire-change-request/{id}/items  ← แนบรูป+สาเหตุ
```

**กติกาสำคัญ:** ห้ามสร้างคำขอ (ข้อ E) ตอนกดค้นหา — สร้างเฉพาะเมื่อผู้ใช้ส่งคำขอยาง**เส้นแรก**เท่านั้น เพื่อไม่ให้มีคำขอว่างค้างในระบบ แล้วใช้ `_id` เดิมกับเส้นถัดไปของรอบนั้น

---

## 2. Authentication

```
Base URL (production): https://mena-wms.vercel.app
Header ทุก request:    x-api-key: <MOBILE_API_KEY>   (ขอจาก admin)
```

- key ผิด/ไม่ส่ง → `401 {"error":"Unauthorized — login session or valid x-api-key required"}`
- `branch` ที่ใช้ได้: `latkrabang` | `saraburi`

---

## 3. ขั้นค้นหา (เรียก 4 API พร้อมกัน)

### A. ประวัติยางของทะเบียน

```
GET /api/tire-change?branch=latkrabang&vehicle=สบ.71-3569&limit=500
```

(`vehicle` = exact match, อย่าลืม URL-encode)

Response:

```json
{
  "items": [
    {
      "_id": "...",
      "vehicle": "สบ.71-3569",
      "tirePosition": "F1ล้อหน้าข้างซ้าย",
      "product": "ยางผ้าใบดอกสร้อย 1000-20",
      "serialNo": "GLZ-DS C6Y22150",
      "treadMm": 16,
      "mileageStart": 248234,
      "mileageEnd": 0,
      "maintenanceRequest": "LBMR26050968",
      "changeIn": "2026-05-29T05:24:00.000Z",
      "changeOut": null,
      "isLatest": true,
      "sellRepairStatus": "อื่นๆ",
      "updatedAt": "2026-06-10T09:28:00.000Z"
    }
  ],
  "total": 10, "page": 1, "pages": 1, "syncedAt": "..."
}
```

**การเรียงลำดับ:** `isLatest: true` (ยางที่อยู่บนรถตอนนี้) ขึ้นก่อน แล้วเรียงตามตำแหน่ง

### B. ข้อมูลรถ (ประเภท / ยี่ห้อ / รุ่น / ฟลีท / Plant)

```
GET /api/vehicles?plates=สบ.71-3569
```

Response (array ว่างถ้าไม่พบ):

```json
[{
  "plate": "สบ.71-3569",
  "vehicleType": "Mixer 10 ล้อ",
  "brand": "HINO",
  "model": "FM8JNKD",
  "fleetNo": "112",
  "fleet": "Asia",
  "plant": "สรงประภา",
  "fuelType": "ดีเซล", "year": "2013", "engineNo": "...", "chassisNo": "..."
}]
```

ใช้ทำ 2 อย่าง:
1. แสดง card ข้อมูลรถ: ทะเบียน + ประเภท (chip) + ยี่ห้อ/รุ่น — ถ้าไม่พบแสดง "ไม่พบในทะเบียนยานพาหนะ"
2. **เติมค่า `fleet` / `plant` ลงช่องฟอร์มอัตโนมัติ** — ผู้ใช้แก้ไขได้ก่อนส่งคำขอ

### C. ข้อมูลสต๊อกยาง (Unit Price + ระยะทาง) ตาม Serial

```
GET /api/tire-stock?branch=latkrabang&serials=<serial1>,<serial2>,...&limit=2000
```

`serials` = serial ทุกเส้นจากข้อ A คั่น comma (URL-encode)

Response: array — เส้นที่ไม่อยู่ในสต๊อกจะไม่อยู่ใน array (แสดง "—")

```json
[{ "serialNo": "TCS-DS D6A18893", "unitPrice": 4465, "distance": 20000, "...": "..." }]
```

### D. สถานะคำขอเดิมของรถคันนี้ (กันขอซ้ำ)

```
GET /api/tire-change-request?branch=latkrabang&plate=สบ.71-3569&limit=100
```

Response: `{ "items": [ { "_id", "status", "appointmentDate", "items": [ { "serialNo", "status", ... } ] } ], ... }`

**Logic สร้าง map สถานะต่อ serial** (ทำเหมือนหน้าเว็บ):

```
for each request (เรียงใหม่→เก่า, request แรกที่เจอ serial นั้นชนะ):
  ข้าม request ที่ status = done หรือ rejected
  for each item ใน request:
    ข้าม item ที่ status = rejected
    map[serialNo] = { itemStatus: item.status ?? "pending",
                      requestStatus: request.status ?? "pending",
                      appointmentDate }
```

---

## 4. การแสดงผลตารางยางรายเส้น

คอลัมน์และที่มาของข้อมูล:

| คอลัมน์ | ที่มา / สูตร |
|---|---|
| ยานพาหนะ | A: `vehicle` |
| Position | แยกจาก `tirePosition` ด้วย regex `^([A-Z]{1,3}\d{1,2})\s*(.*)$` → group 1 เช่น "F1", "RA5" |
| ชื่อตำแหน่ง | regex group 2 เช่น "ล้อหน้าข้างซ้าย" |
| สินค้า | A: `product` |
| Serial No | A: `serialNo` |
| Unit Price | C: `unitPrice` (ทศนิยม 2 ตำแหน่ง, ไม่พบ = "—") |
| ระยะทาง | C: `distance` (จำนวนเต็มมี comma, ไม่พบ = "—") |
| มม. | A: `treadMm` (มิลยางตอนเปลี่ยนเข้า) |
| ไมล์เริ่มต้น | A: `mileageStart` |
| **ระยะทางใช้งาน** | `เลขไมล์ปัจจุบัน(ฟอร์ม) - mileageStart` — แสดงเมื่อทั้งคู่ > 0 |
| **ประสิทธิภาพคงเหลือ** | `(1 - ระยะทางใช้งาน/distance) × 100` ปัดเป็น % จำนวนเต็ม **ติดลบได้** — badge: > 50% เขียว, 21–50% เหลือง, ≤ 20% แดง |
| **บาทต่อกิโล** | `unitPrice ÷ ระยะทางใช้งาน` (ทศนิยม 2–4 ตำแหน่ง) |
| เปลี่ยนเข้า | A: `changeIn` รูปแบบ dd/mm/yyyy hh:mm |
| **ระยะเวลาใช้งาน** | วันนี้ − `changeIn` แบบ adaptive: < 7 วัน → "X วัน", < 1 เดือน → "X สัปดาห์", < 1 ปี → "X เดือน", ≥ 1 ปี → "X ปี Y เดือน" — badge เตือน: ≥ 1 ปี เหลือง, ≥ 2 ปี แดง |
| **ขอเปลี่ยน** | ดูตารางด้านล่าง |

**คอลัมน์ขอเปลี่ยน** (ใช้ map จากข้อ D):

| เงื่อนไข | แสดง |
|---|---|
| ส่งคำขอในรอบนี้แล้ว | badge เขียว "ส่งคำขอแล้ว" |
| map[serial].requestStatus = "appointment" | badge ม่วง "นัดหมาย dd/mm/yyyy hh:mm" |
| map[serial].itemStatus = "approved" | badge น้ำเงิน "อนุมัติแล้ว" |
| map[serial] มี (pending) | badge เหลือง "รออนุมัติ" |
| ไม่มีใน map | ปุ่ม **"ขอเปลี่ยนยาง"** |

---

## 5. ส่งคำขอเปลี่ยนยาง

### E. สร้างคำขอ (เรียกครั้งเดียว ตอนยางเส้นแรก)

```
POST /api/tire-change-request
Content-Type: application/json
```

```json
{
  "branch": "latkrabang",
  "driverName": "สมชาย ใจดี",
  "plate": "สบ.71-3569",
  "truckNumber": "112",
  "currentOdometer": 250000,
  "fleet": "Asia",
  "plant": "สรงประภา",
  "vehicleType": "Mixer 10 ล้อ",
  "requestedBy": "ชื่อ user ใน app (optional)",
  "requestedByEmail": "email (optional)"
}
```

- บังคับ: `branch`, `driverName`, `plate`, `truckNumber`, `currentOdometer` (> 0, ส่ง "250,000" ก็ได้ระบบตัด comma ให้)
- `fleet`/`plant` = ค่าจากช่องฟอร์ม (เติมอัตโนมัติจากข้อ B แต่ผู้ใช้แก้ได้), `vehicleType` จากข้อ B
- Response `201` → **เก็บ `_id` ไว้ใช้ข้อ F** — record จะมี `"status": "pending"`, `"source": "mobile"`

### F. แนบยางรายเส้น (เรียกต่อเส้น)

```
POST /api/tire-change-request/{_id}/items
Content-Type: application/json
```

```json
{
  "tirePosition": "F1ล้อหน้าข้างซ้าย",
  "positionCode": "F1",
  "positionName": "ล้อหน้าข้างซ้าย",
  "serialNo": "GLZ-DS C6Y22150",
  "product": "ยางผ้าใบดอกสร้อย 1000-20",
  "reason": "หมดดอก",
  "note": "รายละเอียดเพิ่มเติม (optional)",
  "photos": ["data:image/jpeg;base64,...", "data:image/jpeg;base64,..."],
  "currentTreadMm": 3.5,
  "mileageStart": 248234,
  "usedDistance": 41766
}
```

| Field | กติกา |
|---|---|
| `reason` | **บังคับ** — dropdown 5 ตัวเลือก: `หมดดอก` / `ยางระเบิด` / `ยางฉีก` / `ยางบวม` / `รถกินยาง` |
| `note` | optional — หมายเหตุเพิ่มเติม (textarea) |
| `photos` | optional — **สูงสุด 2 รูป** base64 data URL, **ย่อรูปก่อนส่งให้ด้านยาวสุด ~1280px JPEG quality 0.8** — server อัปโหลดขึ้น DigitalOcean Spaces เอง เก็บที่ `tire-change-request/<requestId>/` |
| `currentTreadMm` | optional — มิลยางที่วัดได้ตอนนี้ (ทศนิยมได้) |
| `usedDistance` | = `currentOdometer - mileageStart` |
| `positionCode/Name` | แยกจาก `tirePosition` ด้วย regex ข้างบน |

Response `201`:

```json
{ "ok": true, "itemId": "...", "photoUrls": ["https://mn-bucket.sgp1.digitaloceanspaces.com/tire-change-request/.../xxx.jpg"] }
```

หลังส่งสำเร็จ → เปลี่ยนปุ่มเส้นนั้นเป็น "ส่งคำขอแล้ว" และกดซ้ำไม่ได้

---

## 6. Status Workflow (admin จัดการในเว็บ)

```
อนุมัติรายเส้น (item):    pending → approved | rejected
สถานะคำขอ (request):     คำนวณอัตโนมัติจากรายเส้น
                          - มีเส้น pending เหลือ → pending
                          - ตัดสินครบ + อนุมัติ ≥ 1 เส้น → approved
                          - ถูกปฏิเสธหมด → rejected
หลัง approved:            admin กดนัดหมาย → appointment (มี appointmentDate + note)
หลัง appointment:         admin ปิดงาน → done
```

Mobile แสดงสถานะให้คนขับด้วย GET ข้อ D (มี `status`, `appointmentDate`, `rejectReason`, และ `items[].status` รายเส้น)
หมายเหตุ: เส้นที่ถูก **rejected** หรือคำขอ **done** แล้ว → ปุ่ม "ขอเปลี่ยนยาง" กลับมากดได้อีก (ขอใหม่ได้)

---

## 7. Error Handling

| Status | กรณี | ที่ต้องทำ |
|---|---|---|
| `400` | ข้อมูลไม่ครบ/ผิด — `error` เป็นภาษาไทย เช่น "กรุณาระบุสาเหตุ", "รูปถ่ายได้สูงสุด 2 รูป" | แสดง message ให้ผู้ใช้ตรง ๆ |
| `401` | x-api-key ผิด/หาย | เช็ค config |
| `404` | request `_id` ไม่ถูกต้อง ("ไม่พบคำขอ — กรุณาส่งฟอร์มใหม่อีกครั้ง") | ให้ค้นหาใหม่ |
| `409` | เปลี่ยนสถานะข้ามขั้น (ฝั่ง admin) | refresh ข้อมูล |
| `502` | อัปโหลดรูปไม่สำเร็จ | retry |

---

## 8. ตัวอย่าง curl ครบ flow

```bash
API_KEY="<ขอจาก admin>"
BASE="https://mena-wms.vercel.app"

# A. ประวัติยาง
curl "$BASE/api/tire-change?branch=latkrabang&vehicle=%E0%B8%AA%E0%B8%9A.71-3569&limit=500" \
  -H "x-api-key: $API_KEY"

# B. ข้อมูลรถ
curl "$BASE/api/vehicles?plates=%E0%B8%AA%E0%B8%9A.71-3569" -H "x-api-key: $API_KEY"

# C. สต๊อกยาง
curl "$BASE/api/tire-stock?branch=latkrabang&serials=GLZ-DS%20C6Y22150" -H "x-api-key: $API_KEY"

# D. คำขอเดิมของรถ
curl "$BASE/api/tire-change-request?branch=latkrabang&plate=%E0%B8%AA%E0%B8%9A.71-3569&limit=100" \
  -H "x-api-key: $API_KEY"

# E. สร้างคำขอ (ตอนยางเส้นแรก)
curl -X POST "$BASE/api/tire-change-request" -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"branch":"latkrabang","driverName":"สมชาย ใจดี","plate":"สบ.71-3569","truckNumber":"112","currentOdometer":250000,"fleet":"Asia","plant":"สรงประภา","vehicleType":"Mixer 10 ล้อ"}'
# → เก็บ _id จาก response

# F. แนบยางรายเส้น
curl -X POST "$BASE/api/tire-change-request/<REQUEST_ID>/items" -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tirePosition":"F1ล้อหน้าข้างซ้าย","positionCode":"F1","positionName":"ล้อหน้าข้างซ้าย","serialNo":"GLZ-DS C6Y22150","product":"ยางผ้าใบดอกสร้อย 1000-20","reason":"หมดดอก","note":"","photos":[],"currentTreadMm":3.5,"mileageStart":248234,"usedDistance":1766}'
```
