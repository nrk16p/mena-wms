# Mena WMS — Mobile API: Change Tire Request

API สำหรับ mobile app ทำหน้า **Change Tire Request** (เหมือนหน้าเว็บ `/tire/<branch>/change-tire-request`)

## Base URL & Authentication

```
Base URL (production): https://mena-wms.vercel.app
Base URL (local dev):  http://localhost:3001
```

ทุก request ต้องส่ง header:

```
x-api-key: <MOBILE_API_KEY>
```

- ขอ key จาก admin (เก็บเป็น secret ห้าม hardcode ใน repo สาธารณะ)
- ถ้า key ผิด/ไม่ส่ง → `401 {"error": "Unauthorized — login session or valid x-api-key required"}`

ค่า `branch` ที่ใช้ได้: `latkrabang` | `saraburi`

---

## Flow ของหน้า Change Tire Request

ผู้ใช้กรอก 4 ช่อง: ชื่อคนขับ, ทะเบียนรถ, เบอร์รถ, เลขไมล์ปัจจุบัน แล้วกด submit
จากนั้น app เรียก API ตามลำดับ:

```
1. POST /api/tire-change-request        → บันทึกคำขอ
2. GET  /api/tire-change?vehicle=...    → ประวัติยางของทะเบียนนี้
3. GET  /api/vehicles?plates=...        → ประเภทรถ + ยี่ห้อ/รุ่น        (ทำพร้อมข้อ 2 ได้)
4. GET  /api/tire-stock?serials=...     → unit price + ระยะทาง ของยางแต่ละเส้น (ใช้ serial จากข้อ 2)
```

---

## 1. บันทึกคำขอเปลี่ยนยาง

```
POST /api/tire-change-request
Content-Type: application/json
```

Body:

```json
{
  "branch": "latkrabang",
  "driverName": "สมชาย ใจดี",
  "plate": "สบ.71-3569",
  "truckNumber": "112",
  "currentOdometer": 250000,
  "requestedBy": "ชื่อผู้ใช้ใน app (optional)",
  "requestedByEmail": "email ผู้ใช้ใน app (optional)"
}
```

ทุก field บังคับ ยกเว้น `requestedBy` / `requestedByEmail`
`currentOdometer` ต้องเป็นตัวเลข > 0 (ส่งเป็น number หรือ string ก็ได้ เช่น `"250,000"` ระบบตัด comma ให้)

Response `201`:

```json
{
  "_id": "6849...",
  "branch": "latkrabang",
  "driverName": "สมชาย ใจดี",
  "plate": "สบ.71-3569",
  "truckNumber": "112",
  "currentOdometer": 250000,
  "requestedBy": "",
  "requestedByEmail": "",
  "source": "mobile",
  "createdAt": "2026-06-12T03:30:00.000Z"
}
```

Errors `400`: `{"error": "กรุณาระบุชื่อคนขับ"}` ฯลฯ ตาม field ที่ขาด

ตัวอย่าง curl:

```bash
curl -X POST https://mena-wms.vercel.app/api/tire-change-request \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"branch":"latkrabang","driverName":"สมชาย ใจดี","plate":"สบ.71-3569","truckNumber":"112","currentOdometer":250000}'
```

---

## 2. ประวัติยางตามทะเบียน

```
GET /api/tire-change?branch=latkrabang&vehicle=สบ.71-3569&limit=500
```

| Param | จำเป็น | ความหมาย |
|---|---|---|
| `branch` | ✓ | `latkrabang` / `saraburi` |
| `vehicle` | ✓ | ทะเบียนรถ ตรงตัว (exact match) — อย่าลืม URL-encode |
| `limit` | – | default 100, max 500 |
| `latest` | – | `yes` = เฉพาะยางที่อยู่บนรถตอนนี้, `no` = ที่ถอดออกแล้ว |
| `q` | – | ค้นหาแบบ fuzzy (ทะเบียน/serial/สินค้า/เลขแจ้งซ่อม) ใช้แทน `vehicle` ได้ |
| `page` | – | หน้าที่ (เมื่อข้อมูลเกิน limit) |

Response `200`:

```json
{
  "items": [
    {
      "_id": "6849...",
      "branch": "latkrabang",
      "vehicle": "สบ.71-3569",
      "tirePosition": "F2ล้อหน้าข้างขวา",
      "product": "ยางผ้าใบดอกสร้อย 1000-20",
      "serialNo": "GLZ-DS C6A01495",
      "treadMm": 16,
      "mileageStart": 230000,
      "mileageEnd": 0,
      "maintenanceRequest": "LBMR26050968",
      "changeIn": "2026-05-29T05:24:00.000Z",
      "changeOut": null,
      "isLatest": true,
      "sellRepairStatus": "อื่นๆ",
      "updatedAt": "2026-06-10T09:28:00.000Z",
      "syncedAt": "2026-06-11T16:30:00.000Z"
    }
  ],
  "total": 10,
  "page": 1,
  "pages": 1,
  "syncedAt": "2026-06-11T16:30:00.000Z"
}
```

ค่าที่หน้าเว็บคำนวณต่อจาก response นี้ (mobile ควรทำเหมือนกัน):

- **ระยะทางใช้งาน** = `currentOdometer - mileageStart` (แสดงเมื่อทั้งคู่ > 0)
- **ระยะเวลาใช้งาน** = วันนี้ − `changeIn` แสดงแบบ adaptive: `< 7 วัน → "X วัน"`, `< 1 เดือน → "X สัปดาห์"`, `< 1 ปี → "X เดือน"`, `≥ 1 ปี → "X ปี Y เดือน"` พร้อมเตือน: ≥ 1 ปี = เหลือง, ≥ 2 ปี = แดง
- เรียงให้ `isLatest: true` (ยางที่อยู่บนรถ) ขึ้นก่อน

---

## 3. ข้อมูลรถจากทะเบียน (ประเภท / ยี่ห้อ / รุ่น)

```
GET /api/vehicles?plates=สบ.71-3569
```

`plates` รับหลายทะเบียนคั่นด้วย comma ได้

Response `200` (array — ว่าง `[]` ถ้าไม่พบ):

```json
[
  {
    "_id": "...",
    "plate": "สบ.71-3569",
    "fleetNo": "112",
    "fleet": "...",
    "brand": "HINO",
    "model": "FM8JNKD",
    "vehicleType": "Mixer 10 ล้อ",
    "fuelType": "ดีเซล",
    "year": "2013",
    "engineNo": "...",
    "chassisNo": "..."
  }
]
```

---

## 4. ข้อมูลสต๊อกยางตาม Serial No (Unit Price + ระยะทาง)

```
GET /api/tire-stock?branch=latkrabang&serials=GLZ-DS%20C6A01495,TCS-DS%20D6A18893&limit=2000
```

`serials` = serial ทุกเส้นจากข้อ 2 คั่นด้วย comma (exact match, URL-encode ด้วย)

Response `200` (array — เส้นที่ไม่อยู่ในสต๊อกจะไม่อยู่ใน array):

```json
[
  {
    "_id": "...",
    "branch": "latkrabang",
    "prCode": "LBPR26060136",
    "ddCode": "LBDD26060136",
    "depositDate": "05-06-2026",
    "productCode": "LB09R00151",
    "productName": "ยางผ้าใบดอกสร้อย 1000-20",
    "serialNo": "TCS-DS D6A18893",
    "unitPrice": 4465,
    "brand": "Deestone",
    "tireSize": "1000-20",
    "tireModel": "DSS111",
    "distance": 20000,
    "status": "In Stock",
    "tireType": "",
    "warrantyUntil": ""
  }
]
```

หน้าเว็บใช้แค่ `unitPrice` กับ `distance` มา join เข้าตารางประวัติด้วย `serialNo` — เส้นที่หาไม่เจอแสดง "—"

---

## สรุป Error ที่ต้อง handle

| Status | ความหมาย |
|---|---|
| `401` | ไม่มี/ผิด `x-api-key` |
| `400` | ข้อมูลใน body ไม่ครบ/ไม่ถูกต้อง (มี `error` message ภาษาไทย แสดงให้ผู้ใช้ได้เลย) |
| `5xx` | server error — ให้ retry |
