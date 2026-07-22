# mena-wms — Framework & Architecture

เอกสารอธิบายว่า **mena-wms** (Mena Warehouse Management System) สร้างด้วยอะไร วางโครงสร้างยังไง และเพิ่มฟีเจอร์ใหม่ยังไง

---

## 1. Tech Stack

| ชั้น | เทคโนโลยี | หมายเหตุ |
|---|---|---|
| **Framework** | **Next.js 16** (App Router + Turbopack) | full-stack — หน้าเว็บ + API ในโปรเจกต์เดียว |
| **UI** | **React 19** + **TypeScript 5** | |
| **Styling** | **Tailwind CSS v4** (`@tailwindcss/postcss`) | utility-first + design tokens |
| **Components** | **shadcn/ui** + **radix-ui** + `class-variance-authority` | primitive ใน `components/ui/` |
| **Icons** | **lucide-react** | |
| **Dialog / Toast** | **sweetalert2** | ครอบด้วย `lib/swal.ts` |
| **Database** | **MongoDB** (native driver `mongodb`) | DigitalOcean cluster |
| **Auth** | **next-auth v4** (Google provider) | จำกัดโดเมน `@menatransport.co.th` |
| **Files / รูป** | **presign-api + S3** (`@aws-sdk/client-s3`) | `lib/media.ts`, `lib/spaces.ts` |
| **Excel** | **xlsx** | import/export + สคริปต์ข้อมูล |
| **Deploy** | **Vercel** | deploy อัตโนมัติเมื่อ push `main` |

`cn()` helper (`lib/utils.ts`) = `twMerge(clsx(...))` สำหรับรวม class

---

## 2. โครงสร้างโปรเจกต์

```
app/                     ← Next.js App Router
  layout.tsx             ← root layout (fonts, providers, sidebar shell)
  <feature>/page.tsx     ← หน้า (บางๆ) → render component จริง
  api/<name>/route.ts    ← API endpoint (GET/POST)
  api/<name>/[id]/route.ts ← (PUT/DELETE) + sub-routes เช่น [id]/log
  api/cron/<job>/route.ts  ← งาน cron (เรียกจาก Vercel)

components/              ← client components (UI จริงของแต่ละฟีเจอร์)
  <feature>-page.tsx     ← component ใหญ่ 1 ตัวต่อฟีเจอร์
  ui/                    ← shadcn primitives (button, card, label)
  sidebar.tsx, navbar.tsx, providers.tsx, app-shell.tsx

lib/                     ← โค้ด/คอนฟิกที่ใช้ร่วม
  mongo.ts               ← MongoDB client (singleton)
  auth.ts, roles.ts      ← next-auth config + รายชื่อ admin
  swal.ts                ← dialog/toast
  media.ts, spaces.ts    ← อัปโหลดไฟล์
  utils.ts               ← cn()
  <domain>.ts            ← config เฉพาะโดเมน (repair-external.ts, tire.ts, codes.ts)

middleware.ts            ← auth gate + CORS + cron passthrough
scripts/                 ← สคริปต์ข้อมูลครั้งเดียว (seed/migrate/clean) รัน node ตรง
vercel.json              ← ตั้งเวลา cron
```

**หลักสำคัญ:** `app/**/page.tsx` เป็น **wrapper บางๆ** ที่ import component ใหญ่จาก `components/` — ตรรกะ UI ทั้งหมดอยู่ใน component (client) ไม่ได้อยู่ในไฟล์ page

---

## 3. Data Layer — MongoDB

- **Client singleton** (`lib/mongo.ts`): cache `clientPromise` ไว้บน `global` กัน connection รั่วตอน hot-reload
  ```ts
  import clientPromise from "@/lib/mongo"
  const db  = (await clientPromise).db(process.env.MONGO_DB ?? "master_data")
  const col = db.collection("repair_external")
  ```
- **Databases** (cluster เดียวกัน):
  - `master_data` — DB หลักของแอป (SKU, tire, repair_external, garage_master, vehicle_master …)
  - `atms` — ข้อมูลจากระบบ ATMS (เช่น `vehicle_daily` — ฟลีท/แพล้นท์)
- ไม่มี ORM — เขียน query กับ collection ตรงๆ (native driver)
- **Env:** `MONGO_URI`, `MONGO_DB`

---

## 4. Authentication & Access

- **next-auth v4** + Google (`lib/auth.ts`) — `signIn` อนุญาตเฉพาะอีเมล `@menatransport.co.th`
- **middleware.ts** ป้องกันทุก route ยกเว้น `/login`, `/api/auth/*`, `/api/cron/*`
  - รองรับ **mobile app** ผ่าน header `x-api-key` (บาง API) + CORS
- **Role:** `lib/roles.ts` เก็บอีเมล admin แบบ hardcoded → `session.user.role = "admin" | "user"`
- **ฝั่ง server (API):** `getServerSession(authOptions)` เพื่อรู้ว่าใครทำ (เก็บ `createdBy`/`editedBy`, log)
- **ฝั่ง client:** `useSession()` (จาก `components/providers.tsx`)

---

## 5. API Route Conventions

รูปแบบ REST มาตรฐานต่อ resource:

```
app/api/<resource>/route.ts          GET (list + filter via query params) · POST (create)
app/api/<resource>/[id]/route.ts     GET (single) · PUT (update) · DELETE
app/api/<resource>/[id]/<sub>/route.ts   sub-resource เช่น /log, /comment
app/api/<resource>/stats/route.ts    ตัวเลขสรุป (aggregate)
app/api/<resource>/users/route.ts    distinct values สำหรับ dropdown
```

- ตัวกรองส่งเป็น **query param** แล้วประกอบเป็น Mongo `filter` object
- ตัวอย่างในโปรเจกต์: `repair-external`, `tire-stock`, `sku`, `garage-master`, `vehicle-daily`
- **Cron** (`app/api/cron/*`) ตรวจ `Bearer CRON_SECRET` เอง (Vercel cron ไม่มี session) — ตั้งเวลาใน `vercel.json`

---

## 6. Client Component Pattern

component ฟีเจอร์ (เช่น `components/repair-external-page.tsx`) ทำงานแบบ:

```ts
"use client"
const [rows, setRows] = useState([])
const [q, setQ]       = useState("")          // ตัวกรอง = state

const load = useCallback(async () => {         // ประกอบ query → fetch
  const p = new URLSearchParams(); if (q) p.set("q", q)
  setRows(await (await fetch(`/api/...?${p}`)).json())
}, [q])

useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])  // debounce 250ms
```

- **แจ้งผล:** `swalToast("success", ...)`, `swalError(...)`, ยืนยันด้วย `swalConfirm/swalDeleteConfirm`
- **Config เฉพาะโดเมนอยู่ใน `lib/`** ไม่ hardcode ใน component — เช่น `lib/repair-external.ts` เก็บ list สถานะ, ฟิลด์บังคับต่อสถานะ, เกณฑ์ SLA → ทั้งฟอร์ม/ตาราง/คู่มือ ดึงจากที่เดียว แก้ที่เดียวมีผลทุกที่

---

## 7. Media / File Upload

flow อัปโหลด (`lib/media.ts` + `components/image-upload.tsx`):
1. `POST /api/media/presign` → ได้ upload URL
2. Browser `PUT` ไฟล์ขึ้น S3 (DigitalOcean Spaces) ตรง
3. `POST /api/media/{id}/complete` → worker สร้าง webp + thumbnail
4. เก็บ URL รูปไว้บน document

---

## 8. Design System

- **แบรนด์:** เขียว `#1B8C4B` (hover `#0F6A3C`), พื้น `#F6FAF7`, border `#EEF2F0`/`#E2E8E4`
- **ฟอนต์:** `Mitr` (หัวข้อ/ตัวเลข) + `IBM Plex Sans Thai` (เนื้อหา) — โหลดใน `app/layout.tsx`
- **Radius:** การ์ด 16px · input/chip 11px · pill 999px
- ทั้งหมดใช้ token เดียวกันทุกหน้า (ดูตัวอย่างการใช้ครบใน `components/repair-external-page.tsx`)

---

## 9. วิธีเพิ่มฟีเจอร์ใหม่ (recipe)

1. **Config/type** → `lib/<feature>.ts` (type ของ document + ค่าคงที่/กติกา)
2. **API** → `app/api/<feature>/route.ts` (GET/POST) + `[id]/route.ts` (PUT/DELETE) — query กับ Mongo
3. **UI** → `components/<feature>-page.tsx` (client component) + `app/<feature>/page.tsx` (wrapper บาง)
4. **เมนู** → เพิ่มใน `components/sidebar.tsx` (`NAV_GROUPS`)
5. **ข้อมูลตั้งต้น/ย้ายข้อมูล** → `scripts/*.cjs` (รัน `node` ตรง, ใส่ `--dry` ก่อนเขียนจริง)
6. **Deploy** → commit + push `main` → Vercel deploy อัตโนมัติ

> ตัวอย่างครบวงจร: ฟีเจอร์ **รถซ่อมอู่นอก** (`repair-external`) — มี lib config, API หลาย route (list/stats/users/comment/log), client component ใหญ่ (ตาราง + Kanban + ฟอร์ม 3 ขั้น + drawer), สคริปต์ seed/clean, และหน้าคู่มือในตัว

---

## 10. Environment Variables (หลัก)

| ตัวแปร | ใช้ทำอะไร |
|---|---|
| `MONGO_URI`, `MONGO_DB` | เชื่อม MongoDB |
| `GOOGLE_CLIENT_ID` / `_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | next-auth |
| `MEDIA_API_URL`, `NEXT_PUBLIC_MEDIA_CDN_BASE` | อัปโหลด/แสดงไฟล์ |
| `CRON_SECRET` | ยืนยันงาน cron |
| `MOBILE_API_KEY` | ให้ mobile app เรียก API บางตัว |

---

*Next.js 16 gotchas ในโปรเจกต์นี้:* dynamic route `params` เป็น `Promise` (ต้อง `await`) · `middleware.ts` ถูกเตือนว่า deprecated (แนะนำ `proxy`)
