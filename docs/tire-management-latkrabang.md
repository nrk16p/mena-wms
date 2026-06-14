# Tire Management System — Latkrabang

> Applies to both branches: `latkrabang` and `saraburi` — all logic is parameterized by `branch`.

---

## 1. Pages & Entry Points

| URL | Component | Purpose |
|-----|-----------|---------|
| `/tire/latkrabang` | redirect | → `/tire/latkrabang/stock-tire` |
| `/tire/latkrabang/stock-tire` | `TireStockPage` | Stock management + PR Report |
| `/tire/latkrabang/stock-tire/new` | `TireStockAddPage` | Add new tire (single or bulk paste) |
| `/tire/latkrabang/change-history` | `TireChangePage` | ATMS sync + full change history table |
| `/tire/latkrabang/change-tire-request` | `TireChangeRequestPage` | Driver submits tire change request |
| `/tire/latkrabang/requests` | `TireRequestsAdminPage` | Manager reviews/approves requests |

---

## 2. MongoDB Collections

| Collection | Description | Key Fields |
|------------|-------------|------------|
| `tire_stock` | Master inventory — one doc per tire | `branch`, `serialNo`, `prCode`, `ddCode`, `depositDate`, `productName`, `unitPrice`, `distance`, `status`, `brand`, `tireSize`, `tireModel`, `tireType`, `warrantyUntil` |
| `tire_change` | History synced from ATMS — all position changes | `branch`, `vehicle`, `serialNo`, `tirePosition`, `mileageStart`, `mileageEnd`, `changeIn`, `changeOut`, `isLatest`, `sellRepairStatus`, `syncedAt` |
| `tire_change_request` | Change requests submitted by drivers | `branch`, `plate`, `truckNumber`, `driverName`, `fleet`, `plant`, `currentOdometer`, `status`, `items[]`, `createdAt` |
| `vehicle_master` | Truck master data (external) | `plate`, `vehicleType`, `fleet`, `fleetNo`, `plant` |

---

## 3. Stock Status Values

| Status | Meaning | Set By |
|--------|---------|--------|
| `In Stock` | Available in warehouse | Default on add; ATMS sync (no match) |
| `Withdraw` | Issued to a truck (อื่นๆ in ATMS) | ATMS sync auto-update |
| `Sold` | Sold (ขายแล้ว in ATMS) | ATMS sync auto-update |
| `Retreaded` | Sent for retreading (หล่อดอกเรียบร้อย / A2) | ATMS sync auto-update |
| `Pending Sale` | Awaiting sale (รอขาย in ATMS) | ATMS sync auto-update |

**ATMS → Stock status mapping** (applied after every sync):

```
อื่นๆ           → Withdraw
ขายแล้ว         → Sold
หล่อดอกเรียบร้อย → Retreaded
รอขาย           → Pending Sale
A2              → Retreaded
(no match)      → In Stock
```

---

## 4. Request Lifecycle

```
Driver submits form
        │
        ▼
  [pending] ────────────────────────────────────► [rejected]
        │
        │  Manager approves all items
        ▼
  [approved]
        │
        │  Manager sets appointment date
        ▼
 [appointment]
        │
        │  Work done
        ▼
   [done]
```

**Item-level status** (per tire inside a request):
- `pending` → `approved` or `rejected` (manager decides per tire)
- Request status is **derived** from item statuses:
  - Any item still `pending` → request stays `pending`
  - All items decided, at least one `approved` → request → `approved`
  - All items `rejected` → request → `rejected`

---

## 5. Automated Sync (Vercel Cron)

Runs **every 6 hours** (00:00 / 06:00 / 12:00 / 18:00 UTC) via `vercel.json`:

```
GET /api/cron/tire-sync
  Authorization: Bearer <CRON_SECRET>
```

- Reads `ATMS_SESSION` from env — no manual PHPSESSID needed
- Syncs both `latkrabang` and `saraburi` sequentially
- Calls `runBranchSync()` from `lib/atms-sync.ts` (same logic as manual sync)
- Upserts result into `tire_sync_log` collection (one doc per branch, trigger="cron")
- Change History page reads `tire_sync_log` and shows a status chip: green = ok, red = session expired

**Required env vars:**

| Variable | Purpose |
|----------|---------|
| `ATMS_SESSION` | PHPSESSID from ATMS — update when session expires |
| `CRON_SECRET` | Secret Vercel sends in `Authorization` header to authenticate cron calls |

**Session expiry:** If `ATMS_SESSION` expires, the cron logs `error: "Session expired"` and the UI shows a red dot. Update `ATMS_SESSION` on Vercel and redeploy (or use "Edit" in Vercel env settings which takes effect on next invocation).

---

## 6. Data Flow — ATMS Sync (Manual)

```
Manager clicks "Sync ATMS"  (provides PHPSESSID)
        │
        ▼
POST /api/tire-change/sync
        │
        ├─ Fetch Excel from https://www.mena-atms.com/veh/tire/index.export/
        │   (no filter — syncs ALL statuses)
        │
        ├─ Parse Excel rows → map to tire_change documents
        │   - branch, vehicle, serialNo, tirePosition
        │   - mileageStart, mileageEnd, changeIn, changeOut
        │   - isLatest, sellRepairStatus, maintenanceRequest
        │
        ├─ deleteMany({ branch })  ← replaces entire branch history
        ├─ insertMany(docs)
        │
        └─ Auto-update tire_stock.status
            Filter: isLatest=true AND serialNo not empty
            bulkWrite updateOne per serial → STATUS_MAP lookup
            Returns { branch, count, syncedAt, stockUpdated }
```

---

## 6. Data Flow — Change Tire Request (Driver)

```
Driver opens /change-tire-request
        │
        ├─ Enters plate + odometer
        │
        ▼
GET /api/tire-change-request/lookup?branch=&plate=&odometer=
        │
        ├─ Queries tire_change WHERE branch + vehicle + sellRepairStatus="อื่นๆ"
        │   (only currently-installed tires = Withdraw status)
        │
        ├─ Joins tire_stock by serialNo → unitPrice, distance (standard)
        │
        ├─ Joins vehicle_master → fleet, plant, vehicleType
        │
        ├─ Calculates per tire:
        │   - usedDistance  = currentOdometer − mileageStart
        │   - remainingPct  = (1 − usedDist / stockDist) × 100
        │   - bahtPerKm     = unitPrice / usedDist
        │   - age           = today − changeIn  (adaptive text + warn level)
        │   - remainingLevel = red ≤20% / amber ≤50% / green >50%
        │
        └─ Returns sorted list (isLatest first, then by position)

Driver selects tires to replace
        │
        ├─ POST /api/tire-change-request   ← creates request header (pending)
        │   Fields: branch, plate, truckNumber, driverName, currentOdometer,
        │           fleet, plant, vehicleType, requestedBy, source
        │
        └─ POST /api/tire-change-request/[id]/items  ← one call per tire
            Fields: tirePosition, positionCode, positionName, serialNo,
                    product, reason, note, photos (base64 → Spaces URL),
                    currentTreadMm, mileageStart, usedDistance
```

---

## 7. Data Flow — Admin Requests Page

```
GET /api/tire-change-request?branch=&status=&q=&page=&limit=
        │
        ├─ Filters: branch, status (pending/approved/done/rejected), text search
        │
        ├─ Joins tire_stock by serialNo → unitPrice, distance
        │
        ├─ Joins tire_change (isLatest=true) by serialNo → lastPR, lastChangeIn
        │
        └─ Enriches each item with:
            - unitPrice, stockDistance
            - remainingPct = (1 − usedDist / stockDist) × 100
            - bahtPerKm    = unitPrice / usedDist           (actual)
            - bahtPerKmStock = unitPrice / stockDist        (standard)
            - lastPR       = last maintenance request number
            - lastChangeIn = date tire was last installed

Manager actions:
  PATCH /api/tire-change-request/[id]
        action: "approve"      → status: approved
        action: "reject"       → status: rejected + rejectReason
        action: "appointment"  → status: appointment + appointmentDate
        action: "done"         → status: done

  PATCH /api/tire-change-request/[id]/items/[itemId]
        action: "approve" / "reject" (per-tire)
        → updates item status, then recalculates request status automatically
```

---

## 8. Data Flow — PR Report (Stock Page)

```
Manager switches to "รายงาน PR" tab
        │
GET /api/tire-stock/pr-report?branch=           ← distinct prCodes list
GET /api/tire-stock/pr-report?branch=&prCode=X  ← full report for one PR
        │
        ├─ Queries tire_stock WHERE branch + prCode
        │
        ├─ Queries tire_change_request WHERE items.serialNo IN [serials]
        │   (joins requests → items → matched serials)
        │
        └─ Enriches each stock row with matching request data:
            - plate, truckNumber, driverName, fleet, plant, currentOdometer
            - tirePosition, positionCode, positionName, reason, note, photoUrls
            - currentTreadMm, mileageStart, usedDistance
            - remainingPct, bahtPerKm, bahtPerKmStock
            - requestStatus (pending / approved / done)

Summary cards computed client-side from report rows:
  - ยางใน PR       = reportRows.length
  - countIssued    = rows with at least one request
  - totalValue     = Σ unitPrice
  - avgUsedDist    = avg usedDistance across request items
  - avgRemaining   = avg remainingPct
  - avgBahtPerKm   = avg actual ฿/km
  - avgBahtPerKmStock = avg standard ฿/km
  - reasonBreakdown = grouped count by reason (horizontal bar chart)
```

---

## 9. Key Calculations

| Metric | Formula | Notes |
|--------|---------|-------|
| ระยะทางใช้งาน | `currentOdometer − mileageStart` | km |
| ประสิทธิภาพคงเหลือ | `(1 − usedDist / stockDist) × 100` | % — can be negative if over-used |
| บาทต่อกิโล (จริง) | `unitPrice / usedDist` | Actual cost efficiency |
| บาทต่อกิโล (มาตรฐาน) | `unitPrice / stockDist` | Standard/expected cost |
| อายุยาง | `today − changeIn` | Shown as days/weeks/months/years; warn ≥1 yr, danger ≥2 yr |

---

## 10. API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tire-stock` | List stock (`q`, `status`, `prCode`, `dateFrom`, `dateTo`, `serials`) |
| POST | `/api/tire-stock` | Add single tire |
| PUT | `/api/tire-stock/[id]` | Edit tire |
| DELETE | `/api/tire-stock/[id]` | Delete tire |
| POST | `/api/tire-stock/bulk` | Bulk insert (skips duplicates, reports skipped) |
| GET | `/api/tire-stock/pr-report` | PR list or full PR report with request join |
| GET | `/api/tire-change` | Change history list — also returns `cronStatus` from `tire_sync_log` |
| POST | `/api/tire-change/sync` | Manual sync from ATMS + auto-update stock status |
| GET | `/api/cron/tire-sync` | **Vercel Cron** — auto-sync all branches every 6h (needs `Authorization: Bearer <CRON_SECRET>`) |
| GET | `/api/tire-change-request` | Admin request list with enriched items |
| POST | `/api/tire-change-request` | Driver creates new request header |
| PATCH | `/api/tire-change-request/[id]` | Approve / reject / appointment / done |
| POST | `/api/tire-change-request/[id]/items` | Add tire item to request (with photo upload) |
| PATCH | `/api/tire-change-request/[id]/items/[itemId]` | Approve / reject individual tire |
| GET | `/api/tire-change-request/lookup` | Driver lookup: tires on truck + computed metrics |

---

## 11. File Structure

```
app/
  tire/latkrabang/
    page.tsx                     ← redirect to stock-tire
    stock-tire/
      page.tsx                   ← renders TireStockPage
      new/page.tsx               ← renders TireStockAddPage
    change-history/page.tsx      ← renders TireChangePage
    change-tire-request/page.tsx ← renders TireChangeRequestPage
    requests/page.tsx            ← renders TireRequestsAdminPage

app/api/
  tire-stock/
    route.ts                     ← GET list, POST single
    [id]/route.ts                ← PUT, DELETE
    bulk/route.ts                ← POST bulk
    pr-report/route.ts           ← GET PR list / PR detail report
  tire-change/
    route.ts                     ← GET change history
    sync/route.ts                ← POST sync from ATMS
  tire-change-request/
    route.ts                     ← GET admin list, POST create
    lookup/route.ts              ← GET driver lookup
    [id]/route.ts                ← PATCH request status
    [id]/items/route.ts          ← POST add item
    [id]/items/[itemId]/route.ts ← PATCH item status

components/
  tire-stock-page.tsx            ← Stock view + PR Report tab
  tire-stock-add-page.tsx        ← Single / bulk add form
  tire-change-page.tsx           ← Sync + history table
  tire-change-request-page.tsx   ← Driver request form
  tire-requests-admin-page.tsx   ← Admin approval UI

lib/
  tire.ts                        ← normStatus, splitPosition, tireAge, remainingLevel

docs/
  tire-management-latkrabang.md  ← this file
  change-tire-request-api.md     ← API reference (Postman companion)
```
