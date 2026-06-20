เบื้องต้น
ตั้ง Folder ใน S3 ขื่อ mena-wms -> folder ตามชื่อ SKU -> ใส่ภาพ

.env.local : 
# S3 Amazon Bucket
region = 
endpoint = 
accessKeyId = 
secretAccessKey = 
bucketName = 

flow ย่อ 
1.frontend ขอ presign 
2.api ตัวนี้ขอคืน upload url 
3.frontend put ผ่าน url นี้ไม่ต้องหนัก backedn เข้า s3 ตรง
4.ถ้า 200 ให้ frontend ส่งค่า complete อีกครั้ง  ระบบมันจะไปทำ worker คืนค่า webp และ thumbnail 

5.system หรือระบบ เก็บค่า media_id และ batch id หรือจะเก็บ url เลยตาม pattern เข้า db ปกติ

# Media API — คู่มือ Frontend & Business API

Base URL (production): https://presign-api-548129382487.asia-southeast1.run.app

ทุก request ต้องมี header:

http
X-User-Id: {user_id}


## 1. Flow ทั้งหมด (Frontend)

 → POST /media/presign          (presign-api สร้าง record + upload_url)
  → PUT upload_url               (Frontend → S3 โดยตรง, ไม่ผ่าน presign-api)
  → POST /media/{id}/complete    (presign-api → publish worker)

presign-api **ไม่รู้** entity

--> POST /media/presign

### Frontend ส่ง

http
POST /media/presign
Content-Type: application/json
X-User-Id: user-123

json
{
  "filename": "photo.jpg",
  "content_type": "image/jpeg",
  "file_size": 123456,
  "batch_id": "optional-uuid",
  "source_type": "ocr"
}

| Field | บังคับ | หมายเหตุ |
|-------|--------|----------|
| filename | ✅ | นามสกุลภาพเท่านั้น (.jpg, .png, .webp, …) |
| content_type | ✅ | ต้องขึ้นต้น image/ ตรงกับไฟล์จริง |
| file_size | ✅ | bytes, สูงสุด 25MB (default) |
| batch_id | ❌ | ไม่ส่ง = batch ใหม่; ส่ง = อัปโหลดหลายรูปชุดเดียวกัน |
| source_type | ❌ | tag ฝั่ง business เช่น `ocr`, receipt |

### presign-api ตอบ (200)

json
{
  "media_id": 6,
  "batch_id": "8b5a10f4-7c22-482c-812d-86eb90eec0c3",
  "upload_url": "https://mn-bucket.../original/photo.jpg?X-Amz-Signature=..."
}

PUT upload_url (Frontend → S3)

bash
curl -X PUT "{upload_url}" \
  -H "Content-Type: image/jpeg" \
  --data-binary @/path/to/photo.jpg

- Content-Type **ต้องตรง** กับ content_type ตอน presign
- สำเร็จ = HTTP **200** หรือ **204**
- upload_url หมดอายุ **5 นาที**

---

## 4. POST /media/{media_id}/complete

เรียกหลัง PUT S3 สำเร็จ

http
POST /media/6/complete
X-User-Id: user-123

### ตอบ (200)

json
{
  "success": true,
  "media_id": 6,
  "status": "uploaded"
}

7. DELETE /media/{media_id} — user ลบรูปก่อน Submit

http
DELETE /media/6
X-User-Id: user-123

json
{ "success": true, "media_id": 6, "status": "deleted" }

การใช้งานไม่ต้องรอทำงานพร้อม handle submit ถ้าอัพโหลดใน process preview หรือ เลือกรูปก็สามารถเรียก presign ได้เลย มันจะทำให้ ux เร็วขึ้น 

ถ้าเปลี่ยนใจไม่เอา ทำปุ่ม frontend กดลบ แล้วเรียก delete มันจะ soft delete แล้ว 7 วัน มันจะมี script ไป delete ทิ้ง ไม่ทำให้ storage บวม 

คืนค่าเป็น media-id + batch 

สำหรับ url ของ webp 

https://mn-bucket.sgp1.digitaloceanspaces.com/media/{batch_id}/{media_id}/webp/{ชื่อไฟล์}.webp

https://mn-bucket.sgp1.digitaloceanspaces.com/media/{batch_id}/{media_id}/thumbnail/{ชื่อไฟล์}-thumbnail.webp