# แปลงรหัส ATMS → SKU ใหม่ (`/sku/convert`) — design

Date: 2026-10-06 · Branch: `feat/sku-convert` (worktree `~/Documents/project/master-sku-web-convert`)

## Goal

Move the staff workbook `แยกรหัสสินค้าใหม่_…_v3.xlsx` into mena-wms as a new tab in **จัดการ SKU**, so staff
fill the new-SKU fields for every ATMS code that moved in เม.ย.–ก.ย. 2569 directly in the web — including
splitting one old code into several new codes and allocating the old code's ATMS stock between them.

Success = every one of the 4,729 rows can reach "✓ ครบ" in the web with the same checks the Excel had,
several people can work at once without overwriting each other, and the page uses the menaIT V.2 look.

## Decisions (user, 2026-10-06)

| Topic | Decision |
|---|---|
| Excel import | Not needed — team has not started; base data is loaded straight from the build scripts |
| Who works | Anyone logged in picks any row; a row being edited is locked (option A — no assignment, no per-person report) |
| Images | Not required on this page (option C) |
| Output of the work | **Saved in the page only (phase 1).** No `master_sku` documents, no approval. Creating SKUs + approval = phase 2 |
| Work steps | The 5 steps proposed for the Excel: evidence → new code #1 → split → allocate qty → checks |
| Look | menaIT V.2 style on the convert pages only; rest of WMS unchanged |

## Out of scope (phase 2+)

Creating `master_sku` docs from finished rows, approval, image upload, refreshing the row list for a new
cut-off, per-person reports, Excel import/export.

## 1. Data

New collection `master_data.sku_convert_items` — one document per (warehouse, ATMS code). Nothing existing
is modified.

```ts
type ConvertItem = {
  _id: string                 // `${inv}:${code}`  e.g. "4:LB09R00149"
  inv: "4" | "3" | "24"       // ATMS inventory id
  wh: "LK" | "SR"             // DIST (24) grouped with สระบุรี
  warehouse: string           // คลังลาดกระบัง / คลังสระบุรี / คลัง DIST
  code: string                // ATMS code
  kind: "parts" | "svc"       // svc = ค่าแรง*, ค่าบริการ*, น้ำมันเชื้อเพลิง
  name: string; group: string; brand?: string; unit?: string; location?: string
  asOf: Date                  // ATMS snapshot date (2026-09-30)
  atmsQty: number; atmsValue: number          // ATMS ประวัติสต๊อก at asOf
  moves: number               // receipt + issue lines in the period (list sort key)
  recv: number; issue: number; issueDocs: number; issueAmt: number; lastMove?: Date
  use?: { lines: number; qty: number; amt: number }          // svc only
  lastPrice?: number; lastSupplier?: string; nSup: number; priceRatio?: number
  splitHint?: string          // "ราคากลาง 800 (…) vs 1,980 (…) = 2.5 เท่า"
  haveSku?: string            // existing master_sku with this ATMS code
  lots: Lot[]                 // remaining FIFO lots, newest first (1,426 in total, max tens per row)
  suppliers: SupplierRow[]    // receipts since 2025-01 per supplier (15,595 in total)
  suggest: { type, l1?, unit?, vehicle?, partNo?, price? }   // codes, not labels
  // ---- work (never touched by the loader) ----
  entries: Entry[]            // new codes #1..n
  status: "todo" | "draft" | "done"
  lock?: { email: string; name: string; at: Date }
  updatedBy?: { email: string; name: string }; updatedAt?: Date
}

type Lot = {
  seq: number                 // 1 = newest
  date?: Date                 // undefined = no receipt found (stock older than the ledger)
  dd?: string; po?: string; supplier?: string
  unitCost: number; qtyReceived?: number; qtyLeft: number; value: number; ageDays?: number
  note?: string               // e.g. same-day-issued receipt used as fallback
}

type SupplierRow = {
  supplier: string; n: number; qty: number
  pMin: number; pMed: number; pMax: number; last: Date
}

type Entry = {
  wh: string; type: string; l1: string; l2: string; l3: string
  nameTh: string; nameEn: string; partNo: string; positions: string[]
  price: string; unit: string; brand: string; grade: string
  oemRef: string; compatRefs: string[]; vehicles: string[]
  atmsCodes: string[]         // [0] = this row's code; more = merged old codes
  qty: number | null          // parts only
  note: string
}
```

Field names in `Entry` match the `/sku/new` POST body so phase 2 can pass an entry to the existing create
logic unchanged (minus images).

Indexes: `{ wh: 1, kind: 1, moves: -1 }`, `{ status: 1 }`, `{ code: 1 }`.

**Loader** — `lean_project/sku_split/load_convert.py` (reuses `build_data.build()`):
- default = dry run: prints counts/value per sheet and a sample document, writes nothing
- `--write`: bulk upsert by `_id`; `$set` only the system fields, `$setOnInsert` `entries: []`, `status: "todo"`
  → re-running never overwrites staff work
- `--uri` to target the local test Mongo
- writing to prod is a separate, explicitly approved step

**Live stock**: the detail API also reads `atms_sku_master.stockQty` (code + inventoryId, synced daily by the
existing cron) and shows it next to the 30/09 figure; if they differ the page shows ⚠. The qty check always
ties to `atmsQty` (30/09), the same base as the lots.

## 2. Rules (pure module `lib/sku-convert-core.ts`, no imports)

Shared by the API (authoritative) and the browser (live feedback).

- `entryMissing(e)` → list of missing required fields, same as `/sku/new` minus images:
  wh, type, l1, l2, l3 (unless type ∈ LAB/SVC/CLN/TRP), nameTh, unit, atmsCodes ≥ 1.
- `entryWrong(e, codes)` → values not allowed by the code lists: L1 not allowed for the type
  (`L1_FILTER`, same table as `/sku/new`), L2 not under L1, L3 not under L1:L2, unit not DAY/HR for LAB,
  grade not in the type's grade set. LAB uses the LAB-only L2/L3/grade lists (`meta.expenseType = "LAB"`).
- `qtyCheck(item)` (parts only) → Σ `entries[].qty` vs `atmsQty`: `ok` / `short n` / `over n` / `none`
  (atmsQty = 0 and Σ = 0).
- `rowStatus(item)` → `todo` (no entries), `done` (≥ 1 entry, every entry has no missing/wrong, qty ok/none),
  else `draft`.
- `skuPreview(e)` → `WH-TYPE-L1-L2[-L3]-####`.

## 3. API (all require a session, like `/api/sku`)

| Route | Purpose |
|---|---|
| `GET /api/sku-convert?wh=LK&kind=parts&q=&group=&status=&hint=1&stock=1&page=1` | list (projection without lots/suppliers/entries detail), sorted `moves` desc then `issueAmt` desc, 50/page; also returns counts for the progress cards and the group list |
| `GET /api/sku-convert/[id]` | full document + `liveStock` + `next` (id of the next `todo` row in the same list order) |
| `PUT /api/sku-convert/[id]` | save `entries`; only the lock holder (or nobody holds it); server sanitises fields, recomputes `status`, sets `updatedBy/At`, releases the lock if `release: true` |
| `POST /api/sku-convert/[id]/lock` | take or refresh the lock; 409 + holder name if someone else holds a live lock |
| `DELETE /api/sku-convert/[id]/lock` | release (only the holder) |

Lock: taken when the detail page opens, refreshed every 2 min while it is open, expires 30 min after the
last refresh, released on save-and-leave / page leave (`navigator.sendBeacon`). An expired lock counts as
free. Lock checks use a single conditional `findOneAndUpdate` so two people cannot both win.

## 4. Pages

### `/sku/convert` — list
- menaIT hero header: title "แปลงรหัส ATMS → SKU ใหม่", subtitle "ตัดยอด ATMS 30 ก.ย. 2569 · เคลื่อนไหว
  เม.ย.–ก.ย. 69", mascot.
- Progress cards: ทั้งหมด · ✓ ครบ · กำลังทำ (draft) · ยังไม่ทำ · ควรแยก.
- Tabs ลาดกระบัง | สระบุรี+DIST and อะไหล่ | ค่าแรง-บริการ (state in the URL query so back keeps it).
- Filters: search code/name, กลุ่มสินค้า, status chips, ควรแยก, มีของคงเหลือ.
- Table (glass card): ลำดับ · รหัส · ชื่อ · กลุ่ม · ครั้งเคลื่อนไหว · คงเหลือ · มูลค่า · ควรแยก chip ·
  status chip (ยังไม่ทำ / 🔒 กำลังทำโดย X / ร่าง / ✓ ครบ n รหัส). Click → detail.

### `/sku/convert/[id]` — work on one code
- Compact hero: code, name, chips (คลัง, กลุ่ม, คงเหลือ 30/09 + live ⚠, ครั้งเคลื่อนไหว), lock banner.
- Stepper (each step turns green by itself): ① ดูหลักฐาน ② รหัสใหม่ #1 ③ แยกรหัส (ถ้าต้อง) ④ แบ่งจำนวน ⑤ ตรวจ.
- Left column — evidence: split-hint banner, lots table, supplier-history table, movement figures,
  existing SKU warning.
- Right column — entry cards #1..n, fields and order as `/sku/new` (WH, Type, L1→L2→L3 dependent selects
  from `/api/codes`, names, part no, positions, price, unit, brand, grade, OEM, compat refs, vehicles, ATMS
  codes, qty, note), SKU preview + per-card status. A new row starts with card #1 pre-filled from `suggest`.
  "+ แยกอีกรหัส" copies card #1; cards can be removed (min 1).
- Allocation bar (parts): `6 + 4 = 10 / 10 ✓` or `⚠ ขาด 2` / `⚠ เกิน 1`.
- Sticky footer: บันทึก · บันทึกแล้วไปรหัสถัดไป · กลับรายการ. Read-only with a banner when locked by
  someone else.

## 5. Look — menaIT V.2, scoped

- `app/sku/convert/v2.css` (imported by the convert layout only): `v2-shell`, `v2-canvas`, `v2-glass`, `v2-btn`,
  chips, tiles — copied from menait-service `app/globals.css`; every class prefixed `v2-` (WMS has none).
- Fonts Prompt + Noto Sans Thai via `next/font/google` in `app/sku/convert/layout.tsx` (scoped variables).
- Colours as Tailwind arbitrary values / CSS variables inside `.v2-scope` — WMS `globals.css` untouched.
- Mascot: menait's `Mascot` copied to `components/sku-convert/mascot-v2.tsx` (WMS already has its own
  different `components/mascot.tsx`, left as is).
- Nav: one item "แปลงรหัส ATMS" in the จัดการ SKU group of `lib/nav.ts`.

## 6. Testing

- `scripts/check-sku-convert-core.ts` (tsx) — missing/wrong/qty/status/preview cases incl. LAB lists,
  split rows, merged codes, zero stock.
- API + pages against a **local Mongo** (mongodb-memory-server in the scratchpad, as done for AP 2026-10-02):
  copy `master_codes`, `atms_sku_master`; load `sku_convert_items` with `load_convert.py --uri`. Run
  `next dev` with `MONGO_URI` pointing at it. Check: list order/filters/counts, lock contention with two
  sessions, save → status, split + allocation, LAB row, read-only when locked.
- `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- Screenshots of both pages (desktop + mobile width).

## 7. Rollout

1. Merge to `main` locally after review → **ask before push** (push = Vercel production deploy).
2. Load `sku_convert_items` into prod with `load_convert.py --write` → **ask before running** (new
   collection only; dry-run summary shown first).
3. Tell the team the page is ready; the v3 Excel stays as a fallback.
