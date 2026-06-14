# Tire Management — User Guide
### Latkrabang Branch

This guide explains how to use the tire system day-to-day. No technical knowledge needed.

---

## Who Uses What

| Role | Pages they use |
|------|---------------|
| **Driver (คนขับ)** | Change Tire Request |
| **Manager** | Requests (approval), Stock, PR Report |
| **Warehouse / Admin** | Stock, Change History (sync), Add Tire |

---

## The 4 Main Pages

### 1. Stock (`/stock-tire`)
**Who:** Manager, Admin
**What it does:** Shows every tire the branch owns — both tires sitting in the warehouse and tires already fitted on trucks.

**Two tabs inside this page:**

#### Stock tab
This is the default view when you open the page. You see a table of all tires with their serial number, product name, price, brand, size, model, distance rating, current status, and type.

**Filters available:**
- **Search box** — type any serial number, product name, or brand to narrow the list
- **Status dropdown** — filter by In Stock / Withdraw / Sold / etc.
- **PR Code** — type a PR number to see only tires from that purchase
- **Deposit Date range** — pick a From and To date to see tires received in that period

**Summary cards** at the top (visible after filtering) show:
- How many tires total are shown
- How many are still In Stock and what percentage that is
- Total value of all tires shown
- Value of tires still in stock

**Export Excel** — downloads the current filtered list as a spreadsheet.

**Tire statuses explained:**

| Status | Meaning |
|--------|---------|
| In Stock | Sitting in the warehouse, ready to use |
| Withdraw | Currently fitted on a truck |
| Sold | Sold off |
| Retreaded | Sent out for retreading |
| Pending Sale | Waiting to be sold |

> Statuses update automatically every time someone runs a sync from ATMS. You do not need to change them manually.

---

#### รายงาน PR tab
This tab lets you pull a full report for any single Purchase Request (PR).

**How to use:**
1. Click the **รายงาน PR** button (top right of the page)
2. Type or click to select a PR Code from the dropdown
3. The report loads automatically

**What the report shows:**
- Every tire that was in that PR
- Which truck it ended up on, who the driver was, which position it was fitted
- The reason it was changed, mileage readings, tread depth, and photos
- Performance metrics: distance used, % efficiency remaining, cost per km (actual vs standard)

**Summary cards at the top of the report:**
- ยางใน PR — how many tires were in this PR
- มูลค่า PR — total purchase value
- ระยะทางเฉลี่ย — average km the tires lasted
- ประสิทธิภาพเฉลี่ย — average % of life remaining when tires were pulled
- ฿/กม. เฉลี่ย — average actual cost vs standard cost per km

**สาเหตุ breakdown chart** — a horizontal bar chart showing the reasons tires were changed (worn out / blowout / cut / bulge / vehicle eating tires) and how many per reason.

**Share this report:** Click the link icon next to the PR Code to copy a shareable URL. Anyone you send the link to will open the exact same PR report.

---

### 2. Change History (`/change-history`)
**Who:** Admin, Manager
**What it does:** Shows the full history of every tire fitted to every truck — every time a tire was moved, changed in, or changed out. This data comes directly from ATMS.

**Auto-sync (every 6 hours):**
The system automatically pulls the latest data from ATMS at 00:00, 06:00, 12:00, and 18:00 every day. You do not need to do anything — it runs in the background. The page header shows a status chip: a **green dot** means the last auto-sync succeeded; a **red dot + "Session หมดอายุ"** means the session has expired and someone needs to update it (see below).

**Manual Sync:**
If you need fresher data between auto-syncs, click the **Sync from ATMS** button at the top right. You may need to paste a fresh PHPSESSID if the session has expired (open ATMS in the browser → DevTools → Application → Cookies → copy PHPSESSID value).

**What happens after any sync (auto or manual):**
- The change history table refreshes with the latest data
- **Tire stock statuses update automatically** based on the latest state of each serial number

> **Session expiry:** ATMS login sessions expire periodically. When this happens, the auto-sync will fail (red dot) and manual sync will ask you to paste a new PHPSESSID. To keep auto-sync running without interruption, the IT admin should update the `ATMS_SESSION` environment variable on Vercel whenever the session is refreshed.

**What the table shows:**
Each row is one tire-on-truck record: the truck plate, tire position, serial number, product, tread reading, start/end mileage, date fitted and removed, whether it is the current tire on that position, and the sell/repair status.

You can search by truck plate, serial number, product name, or PR number.

---

### 3. Change Tire Request (`/change-tire-request`)
**Who:** Driver
**What it does:** Lets a driver submit a request to have one or more tires on their truck changed.

**Steps for the driver:**
1. Enter your truck's **license plate** and **current odometer reading**
2. The system loads a table showing all tires currently on your truck
3. Each tire row shows: position, serial number, product, tread depth, mileage since fitted, estimated life remaining (%), and cost per km
4. Tires highlighted in **red** have used more than 80% of their rated distance — these need changing soon
5. Click the **ขอเปลี่ยน** button on the tire(s) you want to replace
6. For each tire, fill in:
   - **สาเหตุ** (reason) — worn out, blowout, cut, bulge, vehicle eating tires, etc.
   - **หมายเหตุ** — any extra notes
   - **รูปถ่าย** — up to 2 photos of the damaged tire
   - Current tread reading in mm
7. Submit the form — your request is sent to the manager for approval

> Once submitted, you can track the status of your request in the same form. A tire already submitted and waiting for approval will show a badge so you do not submit it twice.

---

### 4. Requests (`/requests`)
**Who:** Manager
**What it does:** The manager's inbox for all tire change requests submitted by drivers. This is where you review, approve, and track each request to completion.

**The request list:**
Each card or row shows the truck plate, driver name, fleet, current odometer, number of tires requested, when the request was submitted, and the current status.

**Status colours:**
- **Amber** — Pending (waiting for your action)
- **Blue** — Approved (scheduled for change)
- **Green** — Done (tires changed)

**Expanding a request:**
Click a request to see the full details — one row per tire including:
- Position on the truck and tire serial number
- Reason for change, tread depth, mileage, photos
- Performance data: distance used, % life remaining, actual vs standard cost per km (shown in red if the tire cost more per km than expected)

**Actions you can take:**

| Action | When | What happens |
|--------|------|-------------|
| **อนุมัติ** (Approve) | Pending | Moves request to Approved |
| **ปฏิเสธ** (Reject) | Pending | Closes request with a reason |
| **นัดหมาย** (Appointment) | After Approved | Sets the date tires will be changed |
| **เสร็จสิ้น** (Done) | After Appointment | Closes the job as complete |

You can also approve or reject **individual tires** within a request — useful if only some of the tires requested are actually ready to change.

**Search and filter:**
- Search by plate, driver name, or truck number
- Filter by status (Pending / Approved / Done / Rejected)

---

## Typical Day-to-Day Flow

```
1. Admin runs ATMS Sync (once a day or when needed)
        ↓
   Change history updates, tire statuses auto-refresh

2. Driver notices a tire issue
        ↓
   Opens Change Tire Request, fills in plate + odometer
        ↓
   Selects the bad tire(s), adds reason + photos, submits

3. Manager opens Requests page
        ↓
   Reviews the request — sees tire history, efficiency, cost per km
        ↓
   Approves (or rejects), sets an appointment date
        ↓
   After the change is done, marks as Done

4. New tires arrive (new PR)
        ↓
   Admin adds them to Stock via "เพิ่มรายการ" or bulk paste
        ↓
   Tires appear in Stock with status In Stock

5. Manager wants to review past PR performance
        ↓
   Opens Stock → รายงาน PR tab
        ↓
   Selects the PR Code → full report with usage stats and breakdown
```

---

## Status at a Glance

### Tire Stock Status
```
In Stock  →  fitted on truck (ATMS sync)  →  Withdraw
In Stock  →  sold                          →  Sold
In Stock  →  sent for retreading           →  Retreaded
```

### Request Status
```
pending  →  approved  →  appointment  →  done
pending  →  rejected
```

---

## Tips

- **Stock statuses update automatically** after every ATMS sync — you do not need to edit them manually.
- **PR Report link is shareable** — copy it and send to a colleague; they will see the same report without needing to search.
- **Red ฿/กม.** in a request means the actual cost per km is higher than the standard (the tire did not last as long as expected).
- **% ประสิทธิภาพ** colour guide: green = still has good life, amber = getting low (≤50%), red = critically low (≤20%).
- **Deposit Date filter** on the Stock page is useful at end-of-month to see what was received in a specific period.
