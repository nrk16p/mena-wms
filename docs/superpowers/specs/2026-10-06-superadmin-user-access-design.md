# ผู้ใช้และสิทธิ์ (`/admin/users`) — superadmin user & access page — design

Date: 2026-10-06 · Branch: `feat/superadmin-users` (worktree `~/Documents/project/master-sku-web-users`)

## Goal

One page, visible only to the superadmin, that lists everyone who uses WMS and lets the superadmin
(1) put people into access groups that decide which menu sections they can see and open, and
(2) grant/remove roles on top of the roles set in code — **without changing anything for anyone until
the superadmin acts**.

Success = after deploy every user sees and can do exactly what they could before; the superadmin can
then restrict a person to some sections (menu hidden + page URL blocked) or grant them a role, and the
change reaches that person within ~5 minutes.

## Decisions (user, 2026-10-06)

| Topic | Decision |
|---|---|
| Page can | View users · grant/remove roles · show/hide menus (no "block user") |
| Hiding a section | Hides the menu **and** blocks its pages (→ `/unauthorized`). Data APIs are NOT blocked |
| How access is set | **Groups, by section**. A user may be in several groups → union of sections |
| User with no group | Sees everything (today's behaviour) |
| Superadmin | `narongkorn.a@menatransport.co.th` only, fixed in code, not grantable, never restricted |
| Keep current setting | Code lists (`lib/roles.ts`), HR-department rules, `visibleToEmails`, `adminOnly`, branch scope and `hidden` all keep working. Page grants are **added** to them; groups can only hide more |
| Who appears in the list | People who use WMS after deploy (first visit). No manual add-by-email |
| Mechanism | Approach A — access stored in the login session (JWT), refreshed every 5 minutes |

## Out of scope

Blocking data APIs per group · blocking a user from signing in · adding users before their first visit ·
per-page (instead of per-section) access · editing the code lists from the UI · letting other admins
use this page · backfilling users from Vercel logs. The July 2026 collections `app_users` /
`permission_groups` are left untouched.

## 1. Sections

A section = one `NavGroup` in `lib/nav.ts`, identified by its `key`. Grantable sections (10):

`sku` จัดการ SKU · `tire` จัดการยาง · `tracking` จัดการติดตามสินค้า · `price-compare` เปรียบเทียบราคา ·
`deadstock` ของค้างคลัง · `safety-stock` จุดสั่งซื้อ · `repair` อู่นอก & อะไหล่ลงคัน · `vendor` Vendor List ·
`driver-handover` ส่งมอบรถ พจส.ใหม่ · `ai-mixer` AI รถโม่

Not grantable: `overview` (หน้าหลัก — always visible) and the new `admin` group (superadmin only).

`sectionForPath(pathname)` — pure function:
- Candidate prefixes = every item `href` of every grantable group (skip `#…` subheaders).
- Match on whole path segments: `/pr` matches `/pr` and `/pr/…`, never `/price-compare`.
- Longest matching href wins → its group key. No match → `null` (never blocked).
- So pages that are not themselves menu items are still covered by their section
  (`/sku/pending`, `/tire/latkrabang/…`, hidden `/atms-new-sku-report` → `sku`).
- Always `null`: `/`, `/login`, `/unauthorized`, `/admin/…`, public paths already bypassed in
  middleware (`/q/…`, `/repair-external/api-guide`, `/tire/api-guide`).

Section keys that no longer exist in `NAV_GROUPS` are ignored wherever they are read.

## 2. Data (db `master_data`, all new)

```ts
// wms_users — one per person, created on first visit
type WmsUser = {
  _id: ObjectId
  email: string            // lower-case, unique index
  name: string
  image: string
  department: string | null   // from HR profile (session employee)
  siteId: number | null
  groups: string[]         // wms_access_groups _id hex strings
  grantedRoles: Role[]     // granted on this page only
  firstSeenAt: Date
  lastSeenAt: Date
}

// wms_access_groups
type WmsAccessGroup = {
  _id: ObjectId
  name: string
  nameKey: string          // name.trim().toLowerCase(), unique index
  sections: string[]       // grantable section keys
  createdAt: Date; createdBy: string
  updatedAt: Date; updatedBy: string
}

// wms_access_log — index { at: -1 }
type WmsAccessLog = {
  at: Date
  by: string               // superadmin email
  action: "user.update" | "users.bulk" | "group.create" | "group.update" | "group.delete"
  target: string           // user email(s) or group name
  before: unknown
  after: unknown
}

type Role = "admin" | "vendor_approver" | "accounting" | "finance"
```

Indexes are created by `scripts/create-access-indexes.mjs` — run on production only with the user's
go-ahead.

## 3. Session refresh (approach A)

In the NextAuth `jwt` callback (`lib/auth.ts`), run `refreshAccess(token)` when signing in **or** when
`Date.now() - token.accessAt > 5 min`:

1. `findOneAndUpdate` `wms_users` by email, upsert: `$set` name/image/department/siteId/lastSeenAt,
   `$setOnInsert` firstSeenAt + `groups: []` + `grantedRoles: []`, return the new doc.
2. Load the user's groups (`_id $in`); unknown ids are ignored.
3. `token.sections` = union of the groups' sections, or `null` when the user has no (known) group
   (= everything). `token.grantedRoles` = doc.grantedRoles. `token.accessAt = Date.now()`.
4. `token.role = "admin"` when the email is in `ADMIN_EMAILS` **or** `grantedRoles` has `admin`.

On any Mongo error: keep the token's previous `sections` / `grantedRoles` (on first sign-in: `null` /
`[]` = today's default), set `accessAt` so the next try is ~1 minute later, `console.warn`.

Write load: one small indexed upsert per active user per 5 minutes. Server components / API routes
calling `getServerSession` also run the callback but cannot rewrite the cookie, so while a token is
stale each such request repeats the refresh until the browser's next `/api/auth/session` call
(at most 5 minutes later, see below) — acceptable for an indexed single-document upsert.
Middleware never refreshes (`getToken` only decodes).

`session` callback copies `sections`, `grantedRoles`, `isSuperAdmin` to `session.user`
(types in `types/next-auth.d.ts`). `components/providers.tsx`: `SessionProvider refetchInterval={300}`
so open tabs rewrite the cookie at least every 5 minutes.

## 4. Enforcement

**Middleware (`middleware.ts`), page requests only (path not under `/api/`), after the existing
cookie-presence check:**
- `getToken()`; no valid token → redirect to `/login?callbackUrl=…` (today only cookie presence is
  checked — a forged cookie now fails for pages).
- `/admin/…` and email ≠ superadmin → redirect `/unauthorized`.
- Superadmin → allow.
- `section = sectionForPath(pathname)`; if `section && token.sections && !token.sections.includes(section)`
  → redirect `/unauthorized?from=<path>`.
- API routes keep today's behaviour exactly.

`sectionForPath` needs the hrefs from `NAV_GROUPS`. `lib/nav.ts` imports lucide icons; if pulling it
into the middleware bundle causes build/size problems, move the plain href/key data into a React-free
`lib/nav-sections.ts` that `lib/nav.ts` builds on (single source kept).

**`/unauthorized` page:** "ไม่มีสิทธิ์เข้าหน้านี้" + the blocked path + link to หน้าหลัก + "ติดต่อผู้ดูแลระบบ".

**Sidebar + home page:** `Viewer` gets `sections?: string[] | null` and `isSuperAdmin?: boolean`.
`groupVisible` also requires `sections == null || group.key === "overview" || sections.includes(group.key)`
(superadmin: always true for grantable groups). Existing rules still apply after this, so a group can
never reveal something the code hides.

**New nav group** `admin` "ผู้ดูแลระบบ" with item `/admin/users` "ผู้ใช้และสิทธิ์", flag
`superadminOnly: true` on the group (shown in sidebar and home only for the superadmin).

**Roles (`lib/roles.ts`):**
- `SUPERADMIN_EMAIL = "narongkorn.a@menatransport.co.th"`, `isSuperAdmin(email)`.
- `isAdmin`, `canApproveVendor`, `isAccounting`, `isFinance`, `canImportPayment` take a last optional
  argument `granted?: readonly Role[]`; result = code list ∪ HR rule ∪ granted. Behaviour without the
  argument is unchanged.
- Update the 21 call sites (API routes + components using `isAdmin(`, `canApproveVendor(`,
  `isAccounting(`, `canImportPayment(`) to pass `session?.user?.grantedRoles`.
- The 17 `role === "admin"` checks need no change (step 4 of §3).

## 5. Admin APIs (`/api/admin/*`)

Every handler: `getServerSession` → 403 unless `isSuperAdmin(session.user.email)` (checked per call,
not from the 5-minute token).

| Route | Does |
|---|---|
| `GET /api/admin/users` | All `wms_users` + per user: group names, `rolesFromCode`, `rolesFromHr` (department regex), `grantedRoles` |
| `PATCH /api/admin/users/[email]` | Set `groups` and/or `grantedRoles`; validates group ids exist and roles are known; superadmin row is read-only (400) |
| `POST /api/admin/users/bulk` | `{ emails, addGroup? , removeGroup? }` |
| `GET/POST /api/admin/groups` | List with member counts / create (`name`, `sections`); duplicate name → 409 |
| `PATCH/DELETE /api/admin/groups/[id]` | Rename / change sections / delete (delete also `$pull`s the id from every user) |
| `GET /api/admin/access-log?limit=200` | Newest first |

Every write appends a `wms_access_log` entry with before/after.

## 6. Page `/admin/users`

Three tabs, standard WMS look (existing table/drawer/toast/confirm components).

**ผู้ใช้** — table: name, email, department/site, group chips, role chips, first seen, last seen.
Search (name/email) + filter by group + filter by role. Row click → edit drawer:
- Groups: checkbox list.
- Roles: 4 rows; each shows its source chip — **จากโค้ด** / **จาก HR** (disabled, can't untick) or a
  checkbox for **ให้บนหน้านี้**.
- Superadmin row: everything read-only with a "superadmin" badge.
Row checkboxes + bulk bar: add to group / remove from group.

**กลุ่ม** — list of groups (name, sections as chips, member count) + create/edit form (name + 10 section
checkboxes). Saving with zero sections asks for confirmation ("สมาชิกจะเห็นแค่หน้าหลัก").
Delete asks for confirmation and states how many members are affected.

**ประวัติ** — last 200 log entries: time, by, action, target, before → after.

Empty state on first deploy: "ผู้ใช้จะขึ้นในรายการเมื่อเข้าใช้ WMS ครั้งถัดไป (ภายใน ~5 นาที)".

## 7. Error handling

| Case | Behaviour |
|---|---|
| Mongo down during refresh | Keep previous access; retry in ~1 min. Never lock out, never widen |
| First visit while Mongo down | `sections = null`, `grantedRoles = []` (today's default) |
| Group deleted | Removed from all members in the same request; stale ids ignored anyway |
| Section key removed from nav | Ignored |
| Group with no sections | Allowed after confirmation; members see only หน้าหลัก |
| Superadmin lockout | Impossible — fixed in code, middleware always allows |
| Concurrent edits | Last write wins; both in the log |
| Non-superadmin calls admin API | 403 |

## 8. Testing

1. `scripts/check-wms-access.ts` (tsx, repo pattern): `sectionForPath` (incl. `/pr` vs `/price-compare`,
   hidden pages, public paths), union of sections across groups, role merge (code ∪ HR ∪ granted),
   `sidebarGroups`/`homeModules` with `sections`.
2. Local end-to-end against a **local Mongo in Docker** (never production): dev server with `MONGO_URI`
   pointed at it, tokens from `scripts/mint-session-token.ts` for superadmin / user with no group /
   user in a restricted group / user granted admin. Check sidebar, blocked URL → `/unauthorized`,
   `/admin/users` blocked for non-superadmin, admin APIs 403, granted admin can approve SKU.
3. Browser check of `/admin/users` at desktop and 390 px width.
4. `npx tsc --noEmit` and `next build` (middleware bundle).

## 9. Rollout

1. Push only with the user's go-ahead (Vercel deploys `main`).
2. Run `scripts/create-access-indexes.mjs` on production only with the user's go-ahead.
3. No groups exist after deploy → nobody's access changes; only the superadmin sees the new menu.
