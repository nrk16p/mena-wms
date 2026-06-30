# Mena WMS — Tire Management System
## Current Version Overview · Flow · User Stories

> **Last updated:** 2026-06-29  
> **Branches covered:** ลาดกระบัง (latkrabang), สระบุรี (saraburi)  
> **Scope:** Web app at `mena-wms` — tire module only

---

## Roles

| Role | Thai | Access level |
|------|------|-------------|
| **Driver** | คนขับ | Submit change requests only |
| **Admin / Staff** | เจ้าหน้าที่ | All tire pages except Requests approval |
| **Manager** | ผู้จัดการ | All pages including Requests approval |
| **System (Cron)** | ระบบอัตโนมัติ | Nightly ATMS sync at 02:00 |

---

## System Map

```
/tire
 ├── /latkrabang
 │    ├── /stock-tire          Stock list + PR Report
 │    ├── /stock-tire/new      Bulk add tires
 │    ├── /change-history      ATMS sync + tire history
 │    ├── /change-tire-request Driver request form
 │    └── /requests            Admin approval queue
 ├── /saraburi                 (same structure as latkrabang)
 │    └── ...
 └── /master                   Tire Spec Master (global)
```

---

## Full System Flow

```
┌──────────────────────────────────────────────────────────────┐
│  1. SETUP — Admin adds tire specs to master                   │
│  /tire/master → define brand / size / model / distance        │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  2. RECEIVING — Admin adds tires to stock                     │
│  /stock-tire/new → paste from Excel → distance auto-fills     │
│  from Tire Spec Master                                        │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  3. REQUEST — Driver reports a tire problem                   │
│  /change-tire-request                                         │
│  · Enter plate + odometer + odometer photo                    │
│  · System shows all tires on that truck + health metrics      │
│  · Driver picks tire → fills reason + tire photos + tread mm  │
│  · If reason = "รถกินยาง" → MR auto-created in external API  │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  4. APPROVAL — Manager reviews request                        │
│  /requests → approve / reject per item → set appointment date │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  5. EXECUTION — Tire physically replaced                      │
│  Technician records change in ATMS                            │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  6. SYNC — System pulls data from ATMS                        │
│  /change-history → Manual sync OR auto at 02:00 daily         │
│  Stock status auto-updates (In Stock → เบิกใช้แล้ว)           │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  7. ANALYSIS — Manager reviews PR batch performance           │
│  /stock-tire → รายงาน PR tab                                  │
│  · ฿/km actual vs standard · % efficiency remaining           │
│  · MR status per truck · reason breakdown                     │
│  → Informs next purchase decision                             │
└──────────────────────────────────────────────────────────────┘
```

---

## User Stories

### Driver (คนขับ)

**US-01 — ขอเปลี่ยนยาง**
> "As a driver, I want to submit a tire change request from my phone so the manager can arrange a replacement."

**Flow:**
1. Open `/change-tire-request`
2. Fill in: ชื่อคนขับ, ทะเบียนรถ, เบอร์รถ, เลขไมล์ปัจจุบัน
3. Take odometer photo with phone camera
4. Tap "บันทึกคำขอ & ดูประวัติยาง"
5. System shows all tires currently fitted on the truck with health status
6. Also shows current **MR status** for that truck (e.g. รอประเมิน / ซ่อมเสร็จ) — driver knows if the truck already has an open repair job
7. Tap "ขอเปลี่ยนยาง" on the problematic tire
8. Fill in: สาเหตุ (required), มิลยาง, หมายเหตุ, up to 3 tire photos
9. Odometer photo auto-appears in the modal as confirmation
10. Tap "ส่งคำขอ"

**Special case — รถกินยาง:**
- System auto-creates a Maintenance Request (MR) in the external repair system
- MR fields: truck plate, status = `estimate_pending`, remark = position + serial no, today's date
- Success toast: "ส่งคำขอเปลี่ยนยาง สำเร็จ — สร้าง MR แล้ว"
- If MR fails: warning toast, tire request still saved, staff must create MR manually

**Acceptance criteria:**
- [ ] Form requires: ชื่อคนขับ, ทะเบียน, เบอร์รถ, เลขไมล์, สาเหตุ
- [ ] Up to 3 tire condition photos per tire
- [ ] 1 odometer photo per request (shared across all tire items)
- [ ] MR auto-created only when reason = "รถกินยาง"
- [ ] MR failure does not block the tire request from saving

---

### Admin / Staff (เจ้าหน้าที่)

**US-02 — รับยางเข้าสต็อก**
> "As a staff member, I want to record new tires received into the warehouse so the manager can track inventory."

**Flow:**
1. Open `/stock-tire/new`
2. Paste rows from Excel (columns: PR Code, DD Code, Deposit Date, รหัสสินค้า, ชื่อสินค้า, Serial No, Unit Price, ยี่ห้อ, ขนาดยาง, รุ่นยาง, ระยะทาง, Status, ประเภทยาง, วันหมดประกัน)
3. **Auto-fill:** when ยี่ห้อ + ขนาดยาง + รุ่นยาง are filled, system looks up Tire Spec Master and auto-fills ระยะทาง, รหัสสินค้า, ชื่อสินค้า — no need to type distance manually
4. Review table, edit any cell, remove bad rows
5. Tap "บันทึกทั้งหมด" — duplicate serials are skipped and reported

**Acceptance criteria:**
- [ ] Paste from Excel supported
- [ ] Auto-fill fires 300ms after last keystroke on brand/size/model
- [ ] Auto-fill also fires after paste
- [ ] Only fills empty cells (never overwrites manual entries)
- [ ] Duplicate serial no in same branch rejected with error message

---

**US-03 — จัดการสเปคยาง**
> "As a staff member, I want to maintain a master list of tire specs so that staff adding stock never need to manually look up the rated distance."

**Flow:**
1. Open `/tire/master`
2. View existing specs sorted by brand → size → model
3. Add new: fill ยี่ห้อ, ขนาดยาง, รุ่นยาง, ระยะทาง, รหัสสินค้า, ชื่อสินค้า
4. Edit existing: click pencil icon → form pre-fills → save
5. Delete: click trash → confirm dialog

**Acceptance criteria:**
- [ ] Duplicate brand+size+model rejected with error
- [ ] Distance must be > 0
- [ ] Edits and deletes take effect immediately in the table

---

**US-04 — Sync ข้อมูลจาก ATMS**
> "As a staff member, I want to pull the latest tire data from ATMS so that change history and stock status are always current."

**Flow:**
1. Open `/change-history`
2. Click "Sync from ATMS"
3. System fetches latest records from ATMS for this branch
4. Table updates: new positions shown, stock statuses reflect reality
5. Auto-sync also runs every night at 02:00 — no action needed

---

### Manager (ผู้จัดการ)

**US-05 — อนุมัติคำขอเปลี่ยนยาง**
> "As a manager, I want to review all tire change requests with full context so I can approve, reject, or schedule replacements."

**Flow:**
1. Open `/requests`
2. See all pending requests in chronological order (newest first)
3. Each request shows: ทะเบียน / เบอร์รถ / คนขับ / ฟลีท / Plant / เลขไมล์
4. Each tire item shows: ตำแหน่ง / Serial No / สาเหตุ / มม. / รูปถ่าย / ระยะทางใช้ไป / % คงเหลือ / ฿/กม. จริง vs มาตรฐาน (red = over budget)
5. Approve or reject per item, or the whole request
6. On approve: set appointment date → driver notified
7. When physically done: mark Done to close the job

**Status workflow:**
```
pending → approved → appointment → done
       ↘ rejected
```

---

**US-06 — วิเคราะห์ประสิทธิภาพยางต่อ PR**
> "As a manager, I want to see how efficiently each PR batch was used so I can decide which brand/model to buy next."

**Flow:**
1. Open `/stock-tire` → tab "รายงาน PR"
2. Pick a PR code from the dropdown
3. See per-tire performance:
   - ระยะทางใช้งาน vs มาตรฐาน
   - % ประสิทธิภาพคงเหลือ (green / amber / red)
   - ฿/กม. จริง vs ฿/กม. มาตรฐาน
   - รูปถ่ายหลักฐาน (tire photos + odometer photo)
   - **MR status** for each truck (badge in plate column)
4. Click any MR badge → popup shows full repair log history for that truck
5. Summary section: total PR value / avg distance / avg remaining % / avg ฿/กม. / reason breakdown chart
6. Share link — URL encodes the selected PR so it can be sent to stakeholders

**Acceptance criteria:**
- [ ] MR status loaded after report rows appear (non-blocking — report shows first)
- [ ] MR badge colors: green = ซ่อมเสร็จ, amber = รอประเมิน, red = กำลังซ่อม
- [ ] Clicking badge opens log history modal (all status changes in reverse order)
- [ ] Share link preserves PR selection in URL

---

## Page Reference

### `/tire/master` — Tire Spec Master
**Who:** Admin, Manager  
**What:** Global catalog of tire brands/sizes/models with rated distance. One record = one unique combination of brand + tireSize + tireModel.

| Field | Description |
|-------|-------------|
| ยี่ห้อ | Brand name e.g. Bridgestone |
| ขนาดยาง | Size e.g. 295/80R22.5 |
| รุ่นยาง | Model e.g. R249 |
| ระยะทาง | Rated distance in km |
| รหัสสินค้า | Internal product code (optional) |
| ชื่อสินค้า | Full product name (optional) |

---

### `/tire/{branch}/stock-tire` — Stock Management

**Tab: Stock**

| Feature | Detail |
|---------|--------|
| Filter | PR Code, Status, Deposit Date range, search text |
| Summary cards | Total tires, In Stock count + %, total value, in-stock value |
| Edit inline | Click pencil → edit any field → save |
| Delete | Trash icon with confirm |
| Export | Downloads filtered list as .xlsx |

**Tab: รายงาน PR**

| Feature | Detail |
|---------|--------|
| PR selector | Searchable dropdown of all PR codes for this branch |
| Per-tire row | Stock info + linked request info + performance metrics |
| MR badge | Shows latest MR status for that truck; click → full log modal |
| Evidence | Tire photos + odometer photo thumbnails; click to open full-size |
| Summary | Cards + reason pie chart |
| Share link | Copy URL button |

---

### `/tire/{branch}/stock-tire/new` — Bulk Add Tires

| Feature | Detail |
|---------|--------|
| Excel paste | Paste TSV from spreadsheet; multiple paste sessions stack rows |
| Manual row | "เพิ่มแถวว่าง" button |
| Auto-fill | brand + size + model lookup → fills distance, productCode, productName from Tire Spec Master (300ms debounce; fires on paste too) |
| Validation | Red row highlight if Serial No is empty; submit blocked |
| Conflict handling | Duplicate serials skipped, reported; failed rows kept for correction |

---

### `/tire/{branch}/change-tire-request` — Driver Request Form

**Main form fields:**

| Field | Required | Notes |
|-------|----------|-------|
| ชื่อคนขับ | Yes | |
| ทะเบียนรถ | Yes | Used to lookup tire history |
| เบอร์รถ | Yes | |
| เลขไมล์ปัจจุบัน | Yes | Numeric |
| ฟลีท | No | Auto-filled from vehicle master after search |
| Plant | No | Auto-filled from vehicle master after search |
| รูปเลขไมล์รถ | No | Photo of odometer; single image; shared across all tire items in this request |

**After searching:** vehicle card shows ทะเบียน / ประเภท / ยี่ห้อ-รุ่น / **MR status** (latest from external API)

**Per-tire modal fields:**

| Field | Required | Notes |
|-------|----------|-------|
| รูปถ่าย | No | Up to 3 tire condition photos |
| รูปเลขไมล์รถ | — | Read-only preview of the odometer photo from main form |
| มิลยาง (มม.) | No | Decimal |
| สาเหตุ | Yes | หมดดอก / ยางระเบิด / ยางฉีก / ยางบวม / รถกินยาง |
| หมายเหตุ | No | Free text |

---

### `/tire/{branch}/change-history` — Change History

| Feature | Detail |
|---------|--------|
| Source | ATMS (external) |
| Sync | Manual button OR automatic daily at 02:00 |
| Search | Plate, serial no, product name, maintenance request no |
| Shows | Latest tire per position per truck; full history available |

---

### `/tire/{branch}/requests` — Approval Queue (Manager only)

| Feature | Detail |
|---------|--------|
| Filter | Status: pending / approved / done / rejected |
| Per-request | Driver info, truck info, all tire items with full metrics |
| Actions | Approve / Reject (with reason) / Set appointment / Mark done |
| Evidence | Tire photos visible inline |

---

## External API Integration — Maintenance Request (MR)

**Base URL:** `https://fastapinextjs-548129382487.asia-southeast3.run.app`

All calls proxied through Next.js API routes to keep the external URL server-side.

### Endpoints used

| Internal route | Method | External endpoint | When called |
|----------------|--------|-------------------|-------------|
| `/api/maintenance-request` | POST | `/maintenancerequest/pending-status` | Auto on รถกินยาง submit |
| `/api/maintenance-request/latest` | POST | `/maintenancerequest/pending-status/latest` | Report tab + change-request page after search |
| `/api/maintenance-request/logs` | GET | `/maintenancerequest/pending-status/{plate}/logs` | MR log modal open |

### Status values (confirmed from live data)

| Value | Display (TH) | Chip colour |
|-------|-------------|-------------|
| `estimate_pending` | รอประเมิน | Amber |
| `completed` | ซ่อมเสร็จ | Green |
| `In Maintenance` | กำลังซ่อม | Red |

### Auto-create MR payload (reason = รถกินยาง)

```json
{
  "truckplate": "<plate>",
  "status": "In Maintenance",
  "useradd": "<session user name>",
  "remark": "รถกินยาง — ตำแหน่ง <positionCode> (<serialNo>)",
  "date_log": "<YYYY-MM-DD today>"
}
```

> ⚠️ `"In Maintenance"` has not been confirmed as a valid status in live data. Consider switching to `"estimate_pending"` if the external system rejects it.

---

## MongoDB Collections

| Collection | DB | Purpose |
|------------|----|---------|
| `tire_stock` | master_data | One doc per tire serial per branch |
| `tire_change` | master_data | Synced from ATMS — one doc per position per truck (isLatest flag) |
| `tire_change_request` | master_data | Driver requests + embedded items array |
| `tire_spec_master` | master_data | Global tire spec catalog (brand+size+model → distance) |

---

## Key Business Rules

1. **Serial No is unique per branch** — duplicate rejected on add
2. **Distance comes from Tire Spec Master** — staff never types it manually when specs are set up
3. **Odometer photo is per-request** — one photo shared across all tire items in the same submission
4. **MR is only auto-created for "รถกินยาง"** — all other reasons are tire-only, no MR
5. **MR failure is non-blocking** — tire request saves regardless; warning toast tells staff to create MR manually
6. **ATMS is the source of truth for tire history** — web system only stores stock + requests; actual change records come from ATMS sync
7. **PR Report efficiency** — ฿/กม. in red = actual cost exceeded the tire's rated cost per km (worn out before rated distance)
