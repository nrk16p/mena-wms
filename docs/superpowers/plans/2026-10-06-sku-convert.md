# แปลงรหัส ATMS → SKU ใหม่ (`/sku/convert`) Implementation Plan

> **For agentic workers:** executed as 3 parallel lanes (user 2026-10-06: "manage task into 3 lane to
> complete task faster"). Each lane works in its own worktree/branch; the coordinator merges into
> `feat/sku-convert`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a new tab in จัดการ SKU where staff turn each ATMS code that moved in เม.ย.–ก.ย. 69 into one or
more new-SKU drafts (with stock allocation), saved in the page only (phase 1), in the menaIT V.2 look.

**Architecture:** Mongo collection `master_data.sku_convert_items` (one doc per old code, loaded by a
Python script from the v3 workbook data) → Next.js route handlers (`/api/sku-convert/*`, session-auth,
single-holder row lock) → two client pages under `app/sku/convert` with scoped menaIT styles. Rules live in
the pure module `lib/sku-convert-core.ts` (done, Task 0) used by both server and browser.

**Tech Stack:** Next.js 16 app router, React 19, Tailwind v4, mongodb driver 7, next-auth 4, tsx check
scripts; Python 3 + pymongo for the loader; mongodb-memory-server for local tests.

**Spec:** `docs/superpowers/specs/2026-10-06-sku-convert-design.md`

## Global Constraints

- Item id = `${inv}:${code}`; ATMS codes may contain spaces, Thai, `(`, `)` and `/` → ids travel only as
  a **query string** (`?id=` + `encodeURIComponent`), never as a path segment. Pages: `/sku/convert` and
  `/sku/convert/edit?id=…`; API: `/api/sku-convert`, `/api/sku-convert/codes`, `/api/sku-convert/item?id=`,
  `/api/sku-convert/lock?id=` (POST `{action:"take"|"release"}`; release also via `navigator.sendBeacon`).
- Every API route requires `getServerSession(authOptions)` with an email → else 401.
- The loader never overwrites `entries`, `status`, `lock`, `updatedBy`, `updatedAt` (`$setOnInsert` only).
- Lock: free when absent or `at` older than `LOCK_MS` (30 min); refresh every 2 min; single conditional
  `findOneAndUpdate`.
- No images on this page; no writes to `master_sku`; WMS `app/globals.css` untouched; only the convert
  pages get the menaIT look (`v2-` prefixed classes, scoped fonts).
- Prod Mongo writes and `git push` need the user's explicit go-ahead (Vercel deploys on push).
- Tests: `npx tsx scripts/check-*.ts`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## Review Focus

1. Two people open the same row at once → exactly one gets the lock, the other sees read-only + holder
   name (lane API: concurrent `takeLock` test).
2. A save from someone whose lock expired and was taken over → 409, nothing written (lane API test).
3. Codes with `/`, spaces, Thai → open/save/next work (lane API test uses `S10PM00116 (รับเข้า/ตัดเบิก เป็นลิตร)`; UI links use `encodeURIComponent`).
4. Changing ประเภท to LAB after choosing L1/L2/L3 → lists switch to LAB sets, stale picks flagged, unit
   reset to DAY (UI, mirrors /sku/new; covered by core `entryWrong` tests).
5. Re-running the loader after staff started → work untouched (lane Data: run loader twice on local Mongo,
   compare a doc with entries).

---

### Task 0 (coordinator, DONE `f57ed72`): shared contract

`lib/sku-convert-types.ts` (ConvertItem, Entry, Lot, SupplierRow, Suggest, Lock, ConvertListRow,
ConvertListResponse, ConvertDetailResponse, CodeBook, MasterCodeRow) and `lib/sku-convert-core.ts`
(`emptyEntry`, `entryFromSuggest`, `splitFrom`, `entryMissing`, `entryWrong`, `qtyCheck`, `rowStatus`,
`skuPreview`, `isLockLive`, `sanitizeEntries`, `buildCodeBook`, consts `NO_L3_TYPES`, `NO_PRICE_TYPES`,
`L1_FILTER`, `LAB_UNITS`, `LOCK_MS`, `MAX_ENTRIES`). 25 checks in `scripts/check-sku-convert-core.ts`.

---

## Lane API — worktree `master-sku-web-convert-api`, branch `feat/sku-convert-api`

### Task A1: DB layer `lib/sku-convert-db.ts`

**Files:** Create `lib/sku-convert-db.ts`, `scripts/check-sku-convert-db.ts`.

**Interfaces — Produces** (all take a `Db` so tests inject the local Mongo):
```ts
export const COLL = "sku_convert_items"
export interface ListQuery { wh: Wh; kind: Kind; q?: string; group?: string; status?: RowStatus;
  hint?: boolean; stock?: boolean; page?: number; limit?: number }
export async function listItems(db: Db, q: ListQuery): Promise<ConvertListResponse>
export async function getItem(db: Db, id: string): Promise<ConvertItem | null>
export async function nextTodo(db: Db, item: ConvertItem, meEmail: string, now?: Date): Promise<string | null>
export async function liveStock(db: Db, item: ConvertItem): Promise<{ qty: number; syncedAt: string } | null>
export async function takeLock(db: Db, id: string, user: { email: string; name: string }, now?: Date):
  Promise<{ ok: true; lock: Lock } | { ok: false; notFound?: true; holder?: Lock }>
export async function releaseLock(db: Db, id: string, email: string): Promise<void>
export async function saveEntries(db: Db, id: string, user: { email: string; name: string }, entries: Entry[],
  book: CodeBook, release: boolean, now?: Date):
  Promise<{ ok: true; item: ConvertItem } | { ok: false; status: 404 | 409; holder?: Lock }>
export async function loadCodeBook(db: Db): Promise<CodeBook>   // master_codes → buildCodeBook, 5-min cache
```

Behaviour:
- `listItems`: match `{wh, kind}` + optional `q` (escaped regex, case-insensitive, on `code` or `name`),
  `group` (exact), `status`, `hint` (`splitHint` non-empty), `stock` (`atmsQty > 0`); sort
  `{moves:-1, issueAmt:-1, _id:1}`; `limit` default 50 (max 200); rows project away
  `lots, suppliers, suggest, entries` and add `entryCount: {$size: "$entries"}`; `counts` = status counts +
  `hint` count over `{wh, kind}` only; `groups` = sorted distinct `group` over `{wh, kind}`.
- `nextTodo`: same `{wh, kind}`, `status: "todo"`, `_id ≠ item._id`, not live-locked by someone else, first
  in list sort order **after** the current row (by `moves` desc …); wrap to the first todo if none after.
- `liveStock`: `atms_sku_master.findOne({ code: item.code, inventoryId: item.inv })` → `{ qty: stockQty,
  syncedAt }` or null.
- `takeLock`: `findOneAndUpdate({_id, $or:[{lock:null},{lock:{$exists:false}},{"lock.email":email},
  {"lock.at":{$lt: now-LOCK_MS}}]}, {$set:{lock:{email,name,at:now}}}, {returnDocument:"after"})`; if null
  → read the doc: missing → `{ok:false, notFound:true}` else `{ok:false, holder: doc.lock}`.
- `saveEntries`: same lock filter; `$set entries, status: rowStatus(kind, atmsQty, entries, book), updatedBy,
  updatedAt: now`, and `lock: release ? null : {me, now}`; no match → 404 if the doc is missing, else 409 +
  holder.

- [ ] Write `scripts/check-sku-convert-db.ts` first: connects to `MONGO_TEST_URI`
  (default `mongodb://127.0.0.1:27031`), uses db `sku_convert_test` (dropped at start), inserts 6 fixture
  items (LK parts with moves 50/40/30, one svc, one SR, one id `"3:S10PM00116 (รับเข้า/ตัดเบิก เป็นลิตร)"`) +
  master_codes rows + one atms_sku_master row. Cases: list order/filter/q/hint/stock/counts/groups/entryCount;
  getItem with the slash id; takeLock A ok, B blocked with holder A, A refresh ok, B ok after A's lock is 31
  min old; **concurrent** `Promise.all([takeLock(A), takeLock(B)])` on a free row → exactly one ok; releaseLock
  by non-holder is a no-op; saveEntries by holder → status recomputed (`done` for a complete tied row,
  `draft` otherwise) + lock kept/released per flag; saveEntries by non-holder while live → 409 nothing
  written; missing id → 404; nextTodo skips self, done rows and rows locked by others, wraps around;
  liveStock hit/miss.
- [ ] Run it → fails (module missing). Implement `lib/sku-convert-db.ts`. Run → all pass.
- [ ] `npx tsc --noEmit` clean for the new files. Commit.

### Task A2: route handlers + nav

**Files:** Create `app/api/sku-convert/route.ts` (GET list), `app/api/sku-convert/codes/route.ts` (GET
CodeBook), `app/api/sku-convert/item/route.ts` (GET detail, PUT save), `app/api/sku-convert/lock/route.ts`
(POST take/release). Modify `lib/nav.ts` (item in group `sku` after "เพิ่ม SKU ใหม่":
`{ href: "/sku/convert", label: "แปลงรหัส ATMS", icon: Shuffle (lucide), desc: "แยก/แปลงรหัส ATMS เป็น SKU ใหม่" }`).

- Session: `getServerSession(authOptions)`; no email → 401. `me = { email, name: session.user.name ?? email }`.
- DB: `(await clientPromise).db(process.env.MONGO_DB ?? "master_data")`.
- GET list: parse `wh` (LK|SR, default LK), `kind` (parts|svc, default parts), `q`, `group`, `status`, `hint=1`,
  `stock=1`, `page`. 400 on bad wh/kind/status.
- GET item: `id` required → 404 if missing; returns `ConvertDetailResponse` (`item`, `liveStock`,
  `next: nextTodo(...)`, `me`).
- PUT item: body `{ entries, release }` → `sanitizeEntries` → `saveEntries` with `loadCodeBook`; maps
  404/409 (`{ error, holder }`); 200 → `{ item }`.
- POST lock: body `{ action }` (text/plain beacon bodies too: parse `await req.text()` as JSON); `take` →
  200 `{lock}` / 409 `{holder}` / 404; `release` → 204.
- [ ] Implement; `npx tsc --noEmit`; `npm run lint` on the new files; commit.

---

## Lane UI — worktree `master-sku-web-convert-ui`, branch `feat/sku-convert-ui`

Builds against the Task 0 types and the API contract above (no live API needed to write it; integration
is the coordinator's job).

### Task U1: scoped menaIT V.2 shell

**Files:** Create `app/sku/convert/layout.tsx`, `app/sku/convert/v2.css`,
`components/sku-convert/mascot-v2.tsx`, `components/sku-convert/ui.tsx`.

- `v2.css`: copy from `~/Documents/github/menait-service/app/globals.css` the menaIT tokens as CSS variables
  under `.v2-scope` and the classes `v2-shell`, `v2-canvas`, `v2-glass`, `v2-btn`, `v2-bubble`,
  `v2-tile-*`, `v2-card-in`, `v2-pop-in`, mascot motions + their `@keyframes` (rename keyframes with a
  `v2-` prefix if not already) and the reduced-motion block. Nothing global except `@keyframes`.
- `layout.tsx`: `next/font/google` `Prompt` (400/500/600/700) and `Noto_Sans_Thai` (400/500/600) with CSS
  variables; wrapper `<div className={\`v2-scope ${prompt.variable} ${noto.variable}\`}>`; imports `./v2.css`.
- `mascot-v2.tsx`: copy of menait `components/mascot.tsx` (น้องมีนา), `cn` from `@/lib/utils`.
- `ui.tsx`: `Chip`, `StatusChip` (todo / draft / done / locked-by), `Stepper`, `Field`, `CodeSelect`
  (value = code, shows `CODE ชื่อไทย`), `TagInput`, `MultiCodeSelect`, `Money`, `Qty`, `fmtDate` (d/m/พ.ศ.).

### Task U2: list page `app/sku/convert/page.tsx`

- Hero (`v2-shell`, rounded bottom, mascot) + 5 progress cards from `counts`.
- Tabs ลาดกระบัง | สระบุรี+DIST and อะไหล่ | ค่าแรง-บริการ; filters (search with 300 ms debounce, กลุ่มสินค้า
  from `groups`, status chips, ควรแยก, มีของคงเหลือ). All state in the URL query (`useSearchParams` +
  `router.replace`); store the query in `sessionStorage["skuConvert:list"]` for the back button.
- Table in a `v2-glass` card: ลำดับ · รหัส · ชื่อ · กลุ่ม · ครั้งเคลื่อนไหว · คงเหลือ · มูลค่า · ควรแยก chip ·
  status chip (`isLockLive(lock) && lock.email !== me` → 🔒 กำลังทำโดย {name}; else ยังไม่ทำ / ร่าง /
  ✓ ครบ n รหัส). Row click → `/sku/convert/edit?id=${encodeURIComponent(_id)}`. Pagination 50/page.
  Loading skeleton, empty state, error state.
- Mobile: table scrolls horizontally inside the card; hero stacks.

### Task U3: work page `app/sku/convert/edit/page.tsx` + components

**Files:** Create `app/sku/convert/edit/page.tsx`, `components/sku-convert/use-convert-item.ts` (data +
lock hook), `components/sku-convert/entry-card.tsx`, `components/sku-convert/evidence-panel.tsx`.

- `useConvertItem(id)`: loads `/api/sku-convert/codes` (CodeBook) and `/api/sku-convert/item?id=`; then POST
  lock `take` → `readOnly` + `holder` on 409; heartbeat `take` every 120 s; on unmount and `pagehide`
  `navigator.sendBeacon("/api/sku-convert/lock?id=…", JSON.stringify({action:"release"}))`; state `entries`
  (= saved entries, or `[entryFromSuggest(item)]` when none); `dirty` flag; `save(release)` → PUT; exposes
  `item, book, liveStock, next, me, entries, setEntries, readOnly, holder, saving, error, save`.
- Layout: compact hero (code, name, chips คลัง/กลุ่ม/คงเหลือ 30/09 + live stock with ⚠ when different /
  ครั้งเคลื่อนไหว) + lock banner; Stepper ① ดูหลักฐาน (always done) ② รหัสใหม่ #1 (card #1 has no
  missing/wrong) ③ แยกรหัส (optional: done when ≥ 2 cards, else "ไม่แยก") ④ แบ่งจำนวน (parts only:
  `qtyCheck` ok/none) ⑤ ตรวจ (`rowStatus === "done"`).
- Left column `EvidencePanel`: split-hint banner (sun colours), existing-SKU warning, lots table (date,
  DD/PO, supplier, unit cost, qty left, age), supplier table (supplier, n, qty, min/median/max, last), movement
  figures. Right column: `EntryCard` × n + "+ แยกอีกรหัส" (`splitFrom(entries[0])`) + remove (min 1);
  allocation bar `6 + 4 = 10 / 10 ✓` / `⚠ ขาด 2` / `⚠ เกิน 1` (parts).
- `EntryCard`: fields in /sku/new order — คลัง, ประเภท, L1, L2, L3 (dependent: L1 options =
  `book.l1` ∩ `book.l1ByType[type]`; L2 = `(type==="LAB"?l2Lab:l2)[l1]`; L3 =
  `(type==="LAB"?l3Lab:l3)[\`${l1}:${l2}\`]`; changing L1 clears L2/L3, changing L2 clears L3; switching to LAB
  sets unit DAY when unit ∉ DAY/HR), ชื่อ TH, ชื่อ EN, เบอร์อะไหล่, ตำแหน่ง (multi), ราคา (disabled showing
  "0 (กรอกตอน transaction)" for `NO_PRICE_TYPES`), หน่วย (LAB → DAY/HR only), ยี่ห้อ (input + datalist of
  brands), Grade (LAB → gradeLab), OEM Ref, เบอร์เทียบ (tags), รุ่นรถ (multi), รหัส ATMS (tags; first =
  row code, locked), จำนวน (parts), หมายเหตุ. Header shows `skuPreview` and the card's missing/wrong list.
- Sticky footer: บันทึก · บันทึกแล้วไปรหัสถัดไป (`next`, release lock) · กลับรายการ (sessionStorage query);
  warn on leave when `dirty`. Read-only mode disables everything and shows the holder banner.
- [ ] `npx tsc --noEmit`, `npm run lint` clean; screenshots after integration. Commit per task.

---

## Lane Data — coordinator (+ classification sub-agents)

### Task D1: L1/L2/L3 coverage + per-item L2/L3 suggestions (user 2026-10-06: "review if needed to add in l1 l2 l3 — just create or add to cover all")

- Export the code tree (`master_codes` pickle) and the 4,729 items (code, name, group, kind, suggested
  type/L1) to `sku_split/taxonomy/`.
- Classify every item to (type, L1, L2, L3) in parallel batches; where nothing fits, propose a new code
  (3–4 uppercase letters, Thai name, parent) — reuse an existing code whenever one fits.
- Merge + dedupe proposals → `taxonomy/new_codes.csv` + `taxonomy/item_codes.csv`; show the user the list
  of new codes; after the go-ahead insert them into `master_codes` with the same `_id` scheme as the
  `/api/codes/[dict]` POST (`DICT:parent:code`, `order` after the last sibling, `meta.expenseType: "LAB"` for
  labour codes).

### Task D2: loader `lean_project/sku_split/load_convert.py`

- Builds docs from `build_data.build()` (+ `taxonomy/item_codes.csv` for `suggest.l2/l3`), `_id =
  f"{inv}:{code}"`, fields per `ConvertItem`; dates as datetimes; NaN → absent.
- Default dry-run (counts/value per wh×kind, sample doc); `--write` bulk upsert (`$set` system fields,
  `$setOnInsert` work fields); `--uri` (default local `mongodb://127.0.0.1:27031`, prod needs `--prod`
  explicitly); creates the indexes.
- Local check: load twice, set entries on one doc between runs, verify untouched; counts = 2,540 / 236 /
  1,820 / 133.

### Task D3 (coordinator): integration

- Merge lanes into `feat/sku-convert`; local Mongo with `master_codes` (+ new codes), `atms_sku_master`
  stand-in from the ATMS snapshots, `sku_convert_items` via the loader; `MONGO_URI=… npx next dev`; browser
  test the Review Focus list + split/allocation flow; screenshots desktop + mobile; `tsc`, `lint`, `build`.
- Then ask: push (Vercel) + prod writes (new codes, `sku_convert_items`).
