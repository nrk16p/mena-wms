# Handoff: รถซ่อมอู่นอก (Repair-External) — Page Improvements

## Overview
Improvements to the **external-garage repair tracker** (`/repair-external`) in the Mena WMS app.
Goal of this redesign round (agreed with the product owner):

1. Make **urgency / overdue** obvious at a glance.
2. **De-clutter the dense 13-column table** → fewer, roomier grouped columns.
3. Make the **Kanban board carry more signal** (progress, aging, cost).
4. Make the **add/edit form** faster (stepped, status-aware, with file upload).
5. Add **aging breakdown** and **average repair days** insights.
6. New supporting features requested during review: **click-to-copy MR/PR/PO**, **search + filter bar** (search, garage, created-by, edited-by), **comments/notes thread with reply**, **file/image attachments**.

Brand, fonts, colors, and the status workflow are **unchanged** — this is a reorganization, not a rebrand.

## About the Design Files
The file in this bundle — **`Repair External Ideas.dc.html`** — is a **design reference created in HTML**, a prototype showing the intended look and behavior. It is **not production code to copy directly**.

The task is to **recreate these designs inside the existing Next.js + React + Tailwind codebase**, using its established patterns:
- Component to edit: **`components/repair-external-page.tsx`** (single client component, ~1000 lines, already contains table + Kanban + modal + log drawer).
- Shared status/workflow config: **`lib/repair-external.ts`** (statuses, colors, required-field-per-status map).
- API routes: **`app/api/repair-external/*`** (list, stats, `[id]`, `[id]/log`).
- Toasts/dialogs: **`lib/swal.ts`** (`swalToast`, `swalError`, `swalDeleteConfirm`) — already used.
- Icons: **`lucide-react`** — already used (`Search`, `Plus`, `Pencil`, `Wrench`, `Flag`, `History`, `Columns3`, `Table as TableIcon`, `GripVertical`, etc.). Use lucide icons in place of the emoji glyphs the prototype uses for UI controls (copy, upload, etc.). Keep the **status emojis** (⏳🔧🔍⏰🛠️✅🏁) — those are part of `REPAIR_STATUSES` already.

To open the HTML prototype: it is a "Design Component" — open `Repair External Ideas.dc.html` in a browser (it loads `support.js` next to it). Pan/zoom canvas; each variant has a badge (1a, 1b, 1c, 1d, 1e, 0a).

## Fidelity
**High-fidelity.** Colors, spacing, typography, and copy are final and brand-accurate. Recreate pixel-closely using existing Tailwind classes and the tokens below. The prototype's sample data is illustrative — wire everything to the real API.

---

## Screens / Views

The prototype shows the current design (**0a**) for reference, plus 5 improvement variants. Implement 1a–1e into the existing page.

### 1a — Priority Table (primary "ตาราง" view)
**Purpose:** Default active-repairs view; scan urgency, filter, act.

**Layout (top → bottom):**
1. **Page header** — same as today: 42px rounded-13px icon tile `bg-[#1B8C4B]/10 text-[#1B8C4B]`, title `รถซ่อมอู่นอก` (Mitr 19px/600), subtitle (12px `#5B7568`) + count. Right side: table/board segmented toggle + `＋ เพิ่มรายการ` button (`bg-[#1B8C4B]`).
2. **Insight strip** — 3 cards in a `grid-template-columns: 220px 200px 1fr; gap:14px`:
   - **ค่าเฉลี่ยวันซ่อม**: label (11px uppercase `#9AA8A0`), big number Mitr 34px `#14271C`, unit `วัน / คัน`, delta line (`▲ ช้ากว่าเดือนก่อน 2 วัน`, `#DC2626`). Card `bg-#fff border-#EEF2F0 radius-16 p-16`.
   - **⚠ เลยกำหนด**: red card `bg-#FEECEC border-#F7CFCF`; number Mitr 34px `#DC2626`; sublist of overdue plates.
   - **การกระจายตามอายุงาน (aging breakdown)**: header + total; a 12px stacked bar (`#1B8C4B` / `#E8A317` / `#DC2626`); legend rows `0–7 / 8–14 / 15+ วัน` each with a color swatch + count.
3. **Search + filter bar** — flex row, gap 10: search input (flex:1, `🔍` + placeholder `ค้นหา MR / ทะเบียน / เบอร์รถ / อาการ / PR / PO`), **อู่** select (`🏭 ทุกอู่`), **สร้างโดย** select (`👤`), **แก้ไขโดย** select (`✎`), **ล้าง** button. All `bg-#fff border-#E2E8E4 radius-11 p-[10px_14px]`. (Date range was intentionally dropped.)
4. **Status filter chips** — a `สถานะ:` label then pill chips: an "ทั้งหมด" chip (active = `bg-#14271C text-#fff`) + one chip per active status with a color dot + emoji + name + count. Clicking sets/clears the status filter (reuse existing `fStatus` state).
5. **Roomy table** — replaces the 13-column table. CSS grid `grid-template-columns: 116px 1.5fr 2.4fr 1fr 1.7fr 88px`, header row `bg-#F6FAF7`, 10.5px/700 uppercase `#9AA8A0`. Six groups:
   - **อายุงาน**: a 4px full-height rounded aging rail + big number (Mitr 20px, colored by aging) + `วัน`.
   - **รถ**: plate (14px/600 `#14271C`), `เบอร์ {fleetNo}` (11px `#5B7568`), MR (mono 10.5px `#9AA8A0`) — **click-to-copy** with a ⧉ affordance.
   - **อาการ**: symptom (12.5px `#4B5F54`, line-height 1.45), then tags: `฿ {price}` (`bg-#ECFDF3 text-#1B8C4B`) and `🛡 {warranty}` (`bg-#F1F5F2 text-#5B7568`).
   - **อู่**: garage name.
   - **สถานะ · เอกสาร**: status chip (bg/text from `statusMeta`), `📅 กำหนด {dueDate}` (red if overdue), then **PR / PO** mono chips — **click-to-copy**.
   - **จัดการ**: history + edit icon buttons (26px squares, `bg-#F6FAF7`).
   - **Urgent rows** (aging ≥ 15): row background `#FFFBFB`.

### 1b — Signal Board (enhanced "บอร์ด" Kanban)
**Purpose:** Drag cards between statuses; richer per-card signal.
- Horizontal scroll row of 188px columns (one per active status; keep existing drag-to-move behavior and the `รถเสร็จ` drop target).
- **Column header**: 3px top border in the status color, name + emoji, count pill (`bg` = statusColor+soft, `text` = statusColor), and a sub-line **`อายุเฉลี่ย {n} วัน`** (new — compute mean aging of cards in column).
- **Card** (`bg-#fff border-#EEF2F0 radius-11 p-10`):
  - Row: plate (13px/600) + `เบอร์ {fleetNo}` (10px `#9AA8A0`); right: aging pill **`{days} วัน`** colored by aging bucket.
  - Symptom: 10.5px `#5B7568`, **clamped to 2 lines** (`-webkit-line-clamp:2` + ellipsis), full text on `title` hover.
  - **Workflow progress bar**: 6 segments, filled up to current status index in the status color, rest `#E5E7EB`.
  - Footer: garage (10px) + `📅 {dueDate}` (red if overdue).
  - Cost: `฿ {price}` 11px/600 `#1B8C4B`.

### 1c — Guided Form (create) — modal "รายการแจ้งซ่อม"
**Purpose:** Replace the single long 15-field modal with a 3-step flow. Keep the existing `save()` / validation logic; only add a `step` state (1..3) that shows a subset of fields.
- Header: `รายการแจ้งซ่อม` (Mitr 17/600) + ✕.
- **Step nav**: 3 equal segments — `1 ข้อมูลรถ` / `2 งานซ่อม` / `3 สถานะ · เอกสาร`; active segment has a `#1B8C4B` underline + filled number badge; inactive = `#F1F5F2 / #9AA8A0`.
- **Step 1 body** (shown): ทะเบียนรถ combobox (reuse existing `PlateCombobox`, `#1B8C4B` focus ring + dropdown of matches with `เบอร์ · type`), เบอร์รถ (auto-filled, `bg-#F6FAF7`, shows `✓`), วันที่รับแจ้ง.
  - **File upload** (new): dashed dropzone `border-#C7D6CD radius-12 bg-#F9FCFA`, `⬆`, `ลากไฟล์มาวาง หรือ เลือกไฟล์`, hint `รองรับ JPG, PNG, PDF · สูงสุด 10 MB/ไฟล์`; below it 62px thumbnails (image = striped placeholder w/ filename + ✕; pdf = `📄` tile).
- Footer: `ขั้น 1 จาก 3` + `ยกเลิก` / `ถัดไป →`.
- Steps 2 & 3 group the remaining existing fields (symptom/garage on 2; status, PR, PO, price, warranty, note on 3). The `REPAIR_STATUS_REQUIRED_FIELD` hint/highlight logic already exists — keep it and surface it on step 3.

### 1d — Guided Form (edit) — modal "แก้ไขรายการแจ้งซ่อม"
Same shell as 1c but **edit mode**:
- Header adds a chip: `🚚 {plate} · {fleetNo}`.
- Step nav: completed steps show a green `✓` badge and are all clickable (jump freely when editing).
- Fields **prefilled**. Example shown on step 3 with status `รออนุมัติ` → the required **รหัส PO** field is highlighted `border-#E8A317 + ring rgba(232,163,23,0.15)` with hint `⚠ สถานะนี้ต้องกรอก "รหัส PO" ก่อนบันทึก` — reuse `reqField` / `reqCls` logic already in the component.
- Attachments section shows existing files + a `＋` add tile.
- Footer: `🕘 แก้ไขล่าสุด …` + `← ย้อนกลับ` / `✓ บันทึกการแก้ไข`.

### 1e — Comments / Notes drawer
**Purpose:** Per-repair discussion thread (new feature). Model it on the existing **log drawer** pattern (right-side panel, same header style).
- Header: `💬` tile, title `ความคิดเห็น / โน้ต` + count badge, subtitle `{plate} · เบอร์ {fleetNo}`, ✕.
- **Thread** (scroll area): each comment = 34px avatar (initial, `bg-#1B8C4B text-#fff`), name (13px/600) + timestamp (11px `#9AA8A0`), bubble `bg-#F6FAF7 radius-[4px_12px_12px_12px] p-[9px_12px]`, then actions **`↩ ตอบกลับ`** (`#1B8C4B` 12px/600), `👍 {n}`, `แก้ไข`.
  - **Nested reply**: indented block with `border-left:2px #EEF2F0`, 28px avatar, supports `@mention` (mention rendered `#1B8C4B`/600).
  - A comment can carry an **attachment chip** (`📄 filename`).
- **Composer** (bottom, `bg-#F9FCFA border-top`): 30px avatar + input placeholder `เขียนความคิดเห็น… ใช้ @ เพื่อแท็กเพื่อนร่วมทีม`, action icons `📎 🖼 @`, and a `ส่ง` button (`bg-#1B8C4B`).

---

## Interactions & Behavior
- **Table/Board toggle**: existing `view` state (`"table" | "board"`).
- **Status chip / summary click**: toggles `fStatus` (existing debounced `load()`).
- **Search + filters**: bind to existing `q`, `fGarage` and NEW `fCreatedBy`, `fEditedBy` query params; keep the 250ms debounce. `ล้าง` resets all.
- **Click-to-copy (MR/PR/PO)**: `navigator.clipboard.writeText(value)` then `swalToast("success", \`คัดลอก ${value} แล้ว\`)`. No-op on empty/`—`.
- **Kanban drag**: keep existing `dragId` + `moveStatus()`; if the target status has a required field that's empty, keep the current behavior of opening the edit modal pre-set to that status.
- **Stepped form**: `ถัดไป/ย้อนกลับ` change `step`; validation on final save uses the existing `save()` + `REPAIR_STATUS_REQUIRED_FIELD`. In edit mode all steps are directly navigable.
- **Comments**: reply expands an inline composer under the target comment; posting calls a new API (below); optimistic append is fine.
- **File upload**: use the existing **`/api/media`** route; store returned URLs on the repair doc / comment.

## State Management
Existing (keep): `rows`, `garages`, `loading`, `q`, `fStatus`, `fGarage`, `dateFrom/To`, `open`, `editId`, `form`, `saving`, `logFor`, `logEntries`, `view`, `stats`, `dragId`.
Add:
- `fCreatedBy: string`, `fEditedBy: string` (filter selects; feed into `load()` query).
- `step: number` (1–3) for the modal.
- `files: UploadedFile[]` in `form` (attachments).
- Comments drawer: `commentFor: RepairExternal | null`, `comments: Comment[]`, `commentsLoading`, `replyTo: string | null`, `draft: string`.
- `stats` extended with `avgDays: number` and `agingBuckets: { lt8:number; d8_14:number; gte15:number }`.

## Data / API changes
- **`GET /api/repair-external`**: accept `createdBy`, `editedBy` query params (filter). It already accepts `q`, `status`, `garage`, `dateFrom`, `dateTo`, `scope`.
- **`GET /api/repair-external/stats`**: add `avgDays` and aging buckets to the response (mean of `today − receivedDate`; bucket counts by that day-diff).
- **Distinct users** for the created-by / edited-by dropdowns: derive from the existing log collection, or add an endpoint returning distinct `by`/`byEmail`.
- **Comments (new)**: `GET/POST /api/repair-external/[id]/comments`. Suggested doc shape: `{ _id, repairId, by, byEmail, text, parentId?: string, files?: string[], at: ISOString }`. Model the handler on the existing `[id]/log` route.
- **Attachments**: reuse `POST /api/media`; persist URLs on the repair doc (`files: string[]`) and/or comment.

## Design Tokens
**Colors**
- Brand green: `#1B8C4B` (hover `#0F6A3C`); soft `#F0FDF4` / `#EAF6EE` / `#ECFDF3`; tint bg `rgba(27,140,75,0.1)`.
- Ink / text: `#14271C` (headings), `#4B5F54` / `#5B7568` (body), `#9AA8A0` (muted), `#B3C0B8` (faint).
- Surfaces: page `#F6FAF7`; cards `#fff`; borders `#EEF2F0` / `#E2E8E4`; row divider `#F1F5F2`; subtle fill `#F1F5F2` / `#F9FCFA`.
- Amber (admin / warning): `#E8A317`, text `#B07D12`, bg `#FEF7E6` / `#FDF3DD`.
- Danger / overdue: `#DC2626`, text `#B4534F`, bg `#FEECEC` / `#FEF5F5`, border `#F7CFCF`.
- **Status colors** (from `lib/repair-external.ts`, used for dots/rails/bars): รอรถเข้า `#9ca3af` · รถเข้าอู่ซ่อม `#3b82f6` · รอใบเสนอราคา `#06b6d4` · รออนุมัติ `#eab308` · ซ่อมไม่มีกำหนด `#f97316` · ซ่อมมีกำหนดเสร็จ `#14b8a6` · รถเสร็จ `#22c55e`.
- **Aging buckets**: `<8` → text `#1B8C4B` / bg `#ECFDF3`; `8–14` → `#B07D12` / `#FEF7E6`; `≥15` → `#DC2626` / `#FEECEC`.

**Typography**
- Headings/numbers: **Mitr** 400/500/600.
- Body/labels: **IBM Plex Sans Thai** 300/400/500/600.
- Codes (MR/PR/PO): **IBM Plex Mono** (in prototype) — or keep existing `font-mono`.
- Both Thai fonts are already loaded in `app/layout.tsx`.

**Radius**: cards 16px; big containers 18–20px; inputs/chips 10–11px; pills 999px; small chips 5–8px.
**Spacing**: card padding 16px; page section gaps 12–18px; grid gaps 8–14px.
**Shadow**: cards `0 1px 2px rgba(20,39,28,0.04)`; drawers/modals `0 8px 24px -12px rgba(20,39,28,0.25)`.

## Assets
None external. Icons come from `lucide-react` (already installed). Status glyphs are emoji defined in `REPAIR_STATUSES`. No image files to import.

## Files
- **Design reference (this bundle):** `Repair External Ideas.dc.html` (+ `support.js` runtime — needed only to open the prototype in a browser).
- **Codebase files to change:**
  - `components/repair-external-page.tsx` — main implementation target (table 1a, board 1b, form 1c/1d, comments drawer 1e).
  - `lib/repair-external.ts` — status/workflow config (reuse; no change needed unless adding aging helpers here).
  - `app/api/repair-external/route.ts` — add `createdBy` / `editedBy` filters.
  - `app/api/repair-external/stats/route.ts` — add `avgDays` + aging buckets.
  - `app/api/repair-external/[id]/comments/route.ts` — NEW (model on `[id]/log`).
  - `app/api/media/*` — reuse for uploads.
  - `lib/swal.ts` — reuse toasts.

## Suggested implementation order (lowest risk first)
1. Click-to-copy MR/PR/PO (frontend only).
2. Board card enrichment 1b (frontend only; uses existing helpers).
3. Search + filter bar incl. created-by / edited-by (frontend + small API param add).
4. Insight strip 1a incl. avgDays + aging buckets (extend stats API).
5. Stepped form 1c/1d (frontend; keep existing save/validation).
6. Attachments + Comments drawer 1e (new API + `/api/media`) — largest, do last.
