# Vendor Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A separate login page for vendors (`/vendor-portal`) that shows only their own DD bills (3 statuses, item lines) — plus account create/reset/disable inside `/ap-tracking/suppliers`.

**Architecture:** Pure rules in `lib/vendor-portal.ts` (shared by API, UI, tests) · server-only auth in `lib/vendor-portal-auth.ts` (scrypt + jose JWT in cookie `vp_session`) · Mongo access in `lib/vendor-portal-db.ts` · public routes under `/api/vendor-portal/*` that check the vendor cookie themselves · admin routes under `/api/ap-suppliers/portal-accounts` so the existing `ap` access policy guards them.

**Tech Stack:** Next.js 16 app router · MongoDB driver · `jose` 6 · `node:crypto` scrypt · Tailwind · lucide-react · `xlsx` (already in package.json)

**Spec:** `docs/superpowers/specs/2026-10-27-vendor-portal-design.md` (mockup: `docs/superpowers/specs/assets/2026-10-27-vendor-portal-mockup.html`)

## Global Constraints

- Vendor API responses contain only: `depositCode receivedAt supplierRefNo vehicle fleetNo amount status payDate paidDate` per bill.
- Status order: paid (apPaidConfirmed) → scheduled (review.status "ผ่าน") → processing.
- Window: receivedAt ≥ first day of (this month − 5) OR (not paid AND receivedAt ≥ lookback); lookback = max(`AP_GO_LIVE`, first day of (this month − 12)). Bangkok dates (`todayICT()`).
- Hide warehouse where `w.includes("สระบุรี") && !w.includes("DIST")`.
- Names shared by >1 code in `atms.supplier_master` never show for anyone. Names starting "เงินสด" get no account.
- Password: 10 chars from `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789`, shown once, stored `scrypt$<saltB64>$<hashB64>`.
- Session cookie `vp_session`, httpOnly, SameSite=Lax, Secure in production, 7 days, HS256 key = HMAC-SHA256(NEXTAUTH_SECRET, "vendor-portal-v1"). Lockout 5 fails → 15 min.
- Middleware bypass matches `/vendor-portal` exactly or prefix `/vendor-portal/` and `/api/vendor-portal/` — never `startsWith("/vendor")`.
- No writes to real Mongo during build/test. Do not edit `app/api/ap-tracking/route.ts` (other sessions work there) — the portal query mirrors its joins in its own module.
- Screen copy in Thai, short, plain (humanizer rules). Login error always "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง".

## Review Focus

1. Vendor A requests items of vendor B's DD (or an out-of-window / Saraburi DD) → 404, same body as not found. (Task 3 test `vpCanSeeHead`)
2. A bill paid AND later rejected by accounting → vendor sees "โอนแล้ว", not processing. (Task 1 test)
3. Window in January → months cross the year (2027-01-10 → window 2026-08-01, lookback 2026-01-01). (Task 1 test)
4. Reset password while vendor is logged in → old cookie rejected (tokenVersion). (Task 2/3 test `vpSessionValid`)
5. Only `vp_session` cookie on `/ap-tracking` or `/api/ap-tracking` → still redirected / 401. (Task 4 manual check)

---

### Task 1: Pure rules — `lib/vendor-portal.ts`

**Files:** Create `lib/vendor-portal.ts`, `scripts/check-vendor-portal.ts`

**Interfaces — Produces:**
- `type VpStatus = "processing" | "scheduled" | "paid"`
- `type VpBill = { depositCode: string; receivedAt: string; supplierRefNo?: string; vehicle?: string; fleetNo?: string; amount: number; status: VpStatus; payDate?: string; paidDate?: string }`
- `vpStatusOf(t: { review?: { status?: string } | null; pay?: { payDate?: string } | null; paid?: { paymentNos?: string[]; date?: string } | null } | null | undefined): VpStatus`
- `vpWindowStart(todayISO: string): string` · `vpLookbackStart(todayISO: string): string` · `vpMonths(fromISO: string, todayISO: string): string[]` (YYYY-MM ascending)
- `vpVisible(receivedAt: string, status: VpStatus, todayISO: string): boolean`
- `isSaraburiWarehouse(w: string): boolean` · `isCashVendor(name: string): boolean`
- `normVpUsername(v: unknown): string` (trim, uppercase, "6.0"→"6")
- `vpBillOf(x: {...raw fields}): VpBill` — builds only whitelisted keys, drops empty optionals
- `vpNextTransfer(bills: VpBill[], todayISO: string): { date: string; count: number; amount: number } | null`
- `type VpItem = { code: string; name: string; qty: string; unitPrice: number; total: number }`
- `vpItemsOf(items: { item?: string; qty?: string; unit_price?: string; total?: string }[]): VpItem[]`
- `VP_STATUS_LABEL: Record<VpStatus, string>` = กำลังดำเนินการ / รอโอน / โอนแล้ว

- [ ] Step 1: write `scripts/check-vendor-portal.ts` with node:assert:
  - `vpStatusOf({review:{status:"ไม่ผ่าน"}, paid:{date:"2026-10-01"}})` → "paid"; `{review:{status:"ผ่าน"}}` → "scheduled"; `{review:{status:"ไม่ผ่าน"}}` → "processing"; `null` → "processing"
  - `vpWindowStart("2026-10-27")` = "2026-05-01"; `vpWindowStart("2027-01-10")` = "2026-08-01"; `vpLookbackStart("2026-10-27")` = "2026-01-01"; `vpLookbackStart("2027-06-01")` = "2026-06-01"
  - `vpVisible("2026-04-30","paid","2026-10-27")` false; same with "scheduled" true; `vpVisible("2026-05-01","paid",…)` true
  - `isSaraburiWarehouse("คลังสระบุรี")` true, `("สระบุรี DIST")` false · `isCashVendor("เงินสด (ไม่มีVAT)")` true
  - `normVpUsername(" ven-00008 ")` "VEN-00008"; `normVpUsername(6)` "6"; `("6.0")` "6"
  - `Object.keys(vpBillOf({...raw with extra keys like note, review, sentDate}))` ⊆ whitelist
  - `vpNextTransfer` picks min payDate ≥ today among scheduled, sums amount, ignores past dates
  - `vpItemsOf([{item:"S16CSE0021 : ผ้าเบรก", qty:"2", unit_price:"3,800.00", total:"7,600.00"}])` → code "S16CSE0021", name "ผ้าเบรก", unitPrice 3800, total 7600
- [ ] Step 2: `npx tsx scripts/check-vendor-portal.ts` → fails (module missing)
- [ ] Step 3: implement; reuse `apPaidConfirmed`, `parseAmount`, `normVendorCode` (lib/ap-doc-template), `AP_GO_LIVE`
- [ ] Step 4: run → prints ok
- [ ] Step 5: commit `vendor-portal: กติกาสถานะ/ช่วงเวลา/whitelist`

### Task 2: Auth — `lib/vendor-portal-auth.ts`

**Files:** Create `lib/vendor-portal-auth.ts`; extend `scripts/check-vendor-portal.ts`; add `"jose"` to package.json dependencies (same version as installed, ^6.2.3)

**Interfaces — Produces:**
- `VP_COOKIE = "vp_session"`, `VP_SESSION_DAYS = 7`, `VP_MAX_FAILS = 5`, `VP_LOCK_MINUTES = 15`
- `genVpPassword(): string` · `hashVpPassword(pw: string): Promise<string>` · `verifyVpPassword(pw: string, stored: string): Promise<boolean>`
- `signVpSession(p: { sub: string; tv: number }): Promise<string>` · `readVpSession(token: string | undefined): Promise<{ sub: string; tv: number } | null>`
- `vpSessionValid(acc: { disabled?: boolean; tokenVersion?: number } | null, s: { tv: number } | null): boolean`

- [ ] Step 1: tests: password length 10 + only alphabet chars + 50 samples not all equal; hash→verify true, wrong pw false, malformed stored false; sign→read roundtrip (set `process.env.NEXTAUTH_SECRET="test"`), tampered token → null, token signed with other secret → null; `vpSessionValid({tokenVersion:2},{tv:1})` false, disabled false, match true
- [ ] Step 2: run → fail · Step 3: implement (crypto.randomInt, scrypt N=16384 r=8 p=1 keylen 32, timingSafeEqual; jose SignJWT/jwtVerify with `algorithms:["HS256"]`, exp 7d) · Step 4: run → ok
- [ ] Step 5: commit `vendor-portal: รหัสผ่าน + session`

### Task 3: Data layer — `lib/vendor-portal-db.ts`

**Files:** Create `lib/vendor-portal-db.ts`; extend check script for the pure helper

**Interfaces — Consumes:** Task 1, Task 2. **Produces:**
- `VP_ACCOUNTS = "vendor_portal_accounts"`; `type VpAccount = { username; atmsCode; displayName; passwordHash; passwordSetAt; passwordSetBy; tokenVersion; disabled; failedCount; lockedUntil?; lastLoginAt?; loginCount; createdAt; createdBy }`
- `vpSupplierNames(db: { md: Db; atms: Db }, atmsCode: string): Promise<string[]>` — ap_supplier names for the code, minus names that `atms.supplier_master` lists with >1 distinct `code`
- `vpAmbiguousNames(atms: Db, names: string[]): Promise<Set<string>>`
- `loadVpBills(db, names: string[], todayISO: string): Promise<VpBill[]>` — `deposit_header` match `{supplier:{$in:names}, $nor:[{supplier:"",purchase_order:""}], $or: vpMonths(lookback,today).map(received_at regex)}` limit 3000, maxTimeMS 20000; drop Saraburi; join `ap_tracking` (projection review.status, pay.payDate, paid.date, paid.paymentNos), `purchase_orders` ("รหัส","ยานพาหนะ"), fleet via vehiclemaster + vehicle_daily (same rule as route.ts lines 228-241); amount = `apNetOf(h)`; filter `vpVisible`; sort receivedAt desc
- `vpCanSeeHead(head: { supplier?: string; warehouse?: string; receivedAt: string }, names: string[], status: VpStatus, todayISO: string): boolean` (pure, exported, tested)
- `loadVpItems(db, code: string, names: string[], todayISO: string): Promise<{ items: VpItem[]; subtotal: number; vat: number; net: number; pending: boolean } | null>` — null when `!vpCanSeeHead`; pending when `apItemVerification(...).amountOk === false` (items then [])
- `requireVpAccount(req: NextRequest): Promise<VpAccount | null>`

- [ ] Step 1: tests for `vpCanSeeHead`: other vendor's name → false; Saraburi → false; out of window paid → false; in window → true
- [ ] Step 2–4: fail → implement → ok
- [ ] Step 5: commit `vendor-portal: ดึงใบ DD + รายการสินค้าเฉพาะของเจ้านั้น`

### Task 4: Vendor API + middleware + shell

**Files:** Create `app/api/vendor-portal/login/route.ts`, `logout/route.ts`, `bills/route.ts`, `bills/[code]/items/route.ts`; Modify `middleware.ts` (add bypass beside the `/q/` block), `components/app-shell.tsx` (`isVendorPage` adds `pathname === "/vendor-portal" || pathname.startsWith("/vendor-portal/")`)

- POST login `{username,password}` → 400 when empty · locked → 429 `{error:"ลองผิดหลายครั้ง รอ 15 นาทีแล้วลองใหม่"}` · wrong/disabled/unknown → 401 `{error:"ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"}` (increment failedCount, set lockedUntil at 5) · ok → reset counters, lastLoginAt, loginCount+1, set cookie, `{ok:true}`
- POST logout → clear cookie
- GET bills → 401 without valid session · `{ vendor:{ name, username }, today, windowStart, bills, next }`
- GET items → 401 / 404 `{error:"ไม่พบใบนี้"}` / 200
- [ ] Step 1: implement · Step 2: `npx tsc --noEmit` clean for new files
- [ ] Step 3: commit `vendor-portal: API + ปล่อยผ่าน middleware`

### Task 5: Admin API — `app/api/ap-suppliers/portal-accounts/route.ts`

- GET → per atmsCode group: `{ atmsCode, username, names[], displayName, lastDdAt, eligible, reason?, account?: { disabled, lastLoginAt, loginCount, passwordSetAt } }` (reason: "ไม่มีรหัสผู้ขาย" / "เงินสด" / "ชื่อซ้ำใน ATMS")
- POST `{ action: "create"|"reset"|"disable"|"enable", atmsCode }` and `{ action: "bulk" }` → create/reset return `{ username, password, displayName }` (bulk returns array); reset/disable bump tokenVersion; actor from getServerSession; bulk = eligible + lastDdAt within window + no account yet
- [ ] Step 1: implement · Step 2: tsc clean · Step 3: commit `vendor-portal: API จัดการบัญชีเจ้าหนี้`

### Task 6: Admin UI in `components/ap-suppliers-page.tsx`

- New column "บัญชีเจ้าหนี้" + row buttons; modal showing password once + "คัดลอกข้อความส่งไลน์" (text from spec); bulk button with confirm count + table + Excel download (`xlsx`, columns รหัสคู่ค้า/ชื่อ/ชื่อผู้ใช้/รหัสผ่าน/ลิงก์)
- Uses existing toast/confirm components of the repo where present
- [ ] Step 1: implement · Step 2: tsc + eslint on file · Step 3: commit `vendor-portal: ปุ่มสร้าง/รีเซ็ตบัญชีในหน้ารายชื่อเจ้าหนี้`

### Task 7: Vendor UI

**Files:** `app/vendor-portal/login/page.tsx`, `app/vendor-portal/page.tsx`, `components/vendor-portal/*` (split by part: header/search bar, status chips, filter sheet, bill card with items, toast)

- Follows mockup v3; own scroll container (`h-full overflow-y-auto`, body is `overflow-hidden`); 44px tap targets; filters client-side (status multi, months, date range, sort); search matches depositCode/fleetNo/vehicle/supplierRefNo case-insensitive; copy single + copy all filtered (newline-joined); items fetched on first expand; 401 → `/vendor-portal/login`
- Scheduled with payDate < today → "ครบกำหนดโอน {date} · รอยืนยันยอดโอน"
- [ ] Step 1: implement · Step 2: tsc + eslint · Step 3: Playwright at 375px and 1280px with mocked `/api/vendor-portal/*` + `/api/auth/*` (no DB) — screenshots of login, list, filter sheet, search "ME042", expanded items
- [ ] Step 4: commit `vendor-portal: หน้าเจ้าหนี้ (มือถือก่อน)`

### Task 8: Whole-branch check and ship

- [ ] `npx tsx scripts/check-vendor-portal.ts` ok · `npx tsc --noEmit` · `npm run build` (dummy env if build needs it)
- [ ] fresh reviewer on the branch diff (security focus: whitelist, ownership, middleware bypass, cookie)
- [ ] ship-it: pull/rebase on origin/main → push main (user said push 2026-10-27)
- [ ] after Vercel deploy: `/vendor-portal/login` 200, `/api/vendor-portal/bills` 401 without cookie, `/ap-tracking` with forged `vp_session` only → redirect to /login
