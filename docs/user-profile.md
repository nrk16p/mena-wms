# Mena WMS — User Profile & Session

คู่มือสำหรับ dev (และ Claude) ที่ต้องดึงข้อมูลผู้ใช้ที่ login อยู่ มาใช้ในหน้าเว็บ / API route

**ไฟล์ที่เกี่ยวข้อง:** [`lib/auth.ts`](../lib/auth.ts) · [`lib/mena-api.ts`](../lib/mena-api.ts) · [`lib/roles.ts`](../lib/roles.ts) · [`types/next-auth.d.ts`](../types/next-auth.d.ts) · [`middleware.ts`](../middleware.ts)

---

## 1. Flow ตอน login

```
ผู้ใช้กด "Sign in with Google"  (/login)
        ↓
Google OAuth  (ส่ง hd=menatransport.co.th + prompt=select_account)  → next-auth ได้ id_token + profile
        ↓
callback signIn()   ① โดเมนต้องเป็น @menatransport.co.th   (ไม่ผ่าน → /login?error=AccessDenied)
                    ② claim email_verified ต้อง = true      (ไม่ผ่าน → /login?error=EmailNotVerified)
                    ③ claim hd (ถ้ามี) ต้องตรงองค์กร        (ไม่ผ่าน → /login?error=AccessDenied)
        ↓
callback jwt()      POST {MENA_API_URL}/auth/login/google  { id_token }
                    ├─ สำเร็จ → เก็บ access token + โปรไฟล์พนักงานลง JWT
                    │           (ถ้าโปรไฟล์ไม่ครบ → ดึงเต็มต่อจาก GET /users/{employee_id})
                    └─ ล้มเหลว → fail-soft: เข้าระบบได้ แต่ไม่มีข้อมูลพนักงาน
        ↓
JWT ถูก encrypt เก็บใน cookie (HttpOnly)   next-auth.session-token / __Secure-next-auth.session-token
        ↓
callback session()  แปลง JWT → object ที่ client อ่านได้
        ↓
<SessionGuard />    ตรวจฝั่ง client ทุกหน้า — session หมดอายุ / โปรไฟล์ไม่ครบ → Swal → login ใหม่
```

### เทียบกับ MenaIT service

ใช้ API ตัวเดียวกัน (`/auth/login/google`) และรูปแบบเดียวกัน ต่างกันแค่ที่เก็บ session:

| | MenaIT service | Mena WMS |
|---|---|---|
| แลก id_token | client POST `/api/login` → API | ทำใน `jwt()` callback ฝั่ง server |
| ที่เก็บโปรไฟล์ | JWT ของตัวเอง (`jose`) cookie `session-token` | JWT ของ next-auth (encrypted, HttpOnly) |
| ฟิลด์โปรไฟล์ | `UserInfo` | `EmployeeProfile` — **ฟิลด์ชุดเดียวกัน** |
| API ล่ม | login ไม่ผ่าน เข้าระบบไม่ได้ | fail-soft + [`SessionGuard`](../components/session-guard.tsx) เตือนแล้วบังคับ login ใหม่ |
| เช็ค session | `SessionContext` → `/api/session` | `useSession()` + `SessionGuard` |
| role | คำนวณจาก `department_id` / `employee_id` | คำนวณจากอีเมลใน [`lib/roles.ts`](../lib/roles.ts) |

> **ไม่มีการใช้ `sessionStorage` / `localStorage` เก็บข้อมูลผู้ใช้** — ทุกอย่างอยู่ใน JWT cookie
> (`localStorage` ในโปรเจกต์นี้ใช้แค่ flag UI เช่น theme, tour, welcome popup)

---

## 2. หน้าตาของ session

```ts
{
  user: {
    name:  "Kittaboon Laingern (Bew)",
    email: "kittaboon.l@menatransport.co.th",
    image: "https://lh3.googleusercontent.com/...",
    id:    "111642723032661668999",   // Google sub
    role:  "admin" | "user",
    employee?: {                       // จาก Mena API — อาจ undefined!
      id, username, email,
      employee_id, employee_status,
      firstname, lastname,
      department_id, department,
      site_id, site,
      position_id, position, position_level, position_level_id,
      image_url,
    },
  },
  expires: "2026-09-05T01:38:32.782Z",
  apiAuthError?: "API login failed: Invalid Google token",   // มีเมื่อแลก token ไม่ผ่าน
}
```

| ฟิลด์ | มาจาก | เชื่อได้เสมอไหม |
|---|---|---|
| `user.name` / `email` / `image` / `id` | Google | ✅ มีเสมอเมื่อ login แล้ว |
| `user.role` | [`lib/roles.ts`](../lib/roles.ts) (รายชื่ออีเมล admin) | ✅ มีเสมอ |
| `user.employee` | Mena API `/auth/login/google` | ⚠️ **อาจ undefined** — ต้องเช็คก่อนใช้ |
| `apiAuthError` | ข้อความ error จากการแลก token | มีเฉพาะตอนพลาด |

**access token ของ Mena API ไม่อยู่ใน session** — เก็บไว้ใน JWT cookie (HttpOnly) เท่านั้น เข้าถึงได้จากฝั่ง server ผ่าน `getApiToken(req)` เพื่อไม่ให้ token หลุดไปที่ browser

---

## 3. วิธีเรียกใช้

### 3.1 Client Component

```tsx
"use client"
import { useSession } from "next-auth/react"

export function Header() {
  const { data: session, status } = useSession()
  if (status === "loading") return null

  const emp = session?.user.employee
  return (
    <div>
      <span>{session?.user.name}</span>
      {emp && <span>{emp.department} · {emp.position}</span>}
    </div>
  )
}
```

Provider ถูกครอบไว้แล้วใน [`components/providers.tsx`](../components/providers.tsx) — ไม่ต้องครอบเพิ่ม

### 3.2 Server Component / Page

```tsx
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export default async function Page() {
  const session = await getServerSession(authOptions)
  const emp = session?.user.employee
  return <div>{emp?.firstname} — {emp?.site}</div>
}
```

### 3.3 API Route Handler

```ts
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  // middleware กัน 401 ให้แล้ว แต่ยังต้องเช็คเพื่อให้ TypeScript แคบ type ลง
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  await col.insertOne({
    ...body,
    createdBy:   session.user.email,
    createdByEmployeeId: session.user.employee?.employee_id ?? null,
    createdAt:   new Date(),
  })
}
```

> **convention ของโปรเจกต์:** เก็บผู้ทำรายการเป็น `createdBy` / `editedBy` = **email** (ไม่ใช่ employee_id)
> เพราะ `employee` อาจ undefined ได้ — ถ้าอยากเก็บ employee_id ให้เก็บ **เพิ่ม** ไม่ใช่แทนที่

### 3.4 เช็คสิทธิ์ admin

```ts
if (session?.user.role !== "admin") {
  return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 })
}
```

เพิ่ม/ลบ admin ที่ [`lib/roles.ts`](../lib/roles.ts) — role ถูกคำนวณใหม่ทุกครั้งที่อ่าน session จึงมีผลทันทีโดยไม่ต้องให้ผู้ใช้ login ใหม่

### 3.5 ยิงต่อไปที่ Mena API แทนผู้ใช้

```ts
import { getApiToken, fetchEmployee, MENA_API_BASE } from "@/lib/mena-api"

export async function GET(req: NextRequest) {
  const token = await getApiToken(req)      // null ถ้าไม่มี/หมดอายุ
  if (!token) return NextResponse.json({ error: "no api token" }, { status: 401 })

  const res = await fetch(`${MENA_API_BASE}/departments/`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  return NextResponse.json(await res.json())
}
```

ถ้าอยากได้โปรไฟล์เต็มกว่าที่ login คืนมา ใช้ `fetchEmployee(employeeId, token)` → `GET /users/{employee_id}`

---

## 4. ข้อควรระวัง

| เรื่อง | รายละเอียด |
|---|---|
| **`employee` อาจ undefined** | Mena API อยู่บน Render (free tier) — cold start / ล่ม ได้ ระบบออกแบบให้ **fail-soft** คือ login เข้า WMS ได้เสมอ ห้ามเขียนโค้ดที่พังเมื่อไม่มี `employee` |
| **`SessionGuard` เตือนเมื่อไม่ครบ** | [`components/session-guard.tsx`](../components/session-guard.tsx) เช็ค `username` / `department` / `position` ทุกหน้า ถ้าขาด → Swal แล้วบังคับ login ใหม่ (รอบสองให้เลือก "ใช้งานต่อ" ได้ เพื่อไม่วนลูปตอน API ล่ม) — แก้รายการฟิลด์จำเป็นที่ [`lib/session-profile.ts`](../lib/session-profile.ts) |
| **ข้อมูลถูก freeze ตอน login** | โปรไฟล์ถูกดึงครั้งเดียวตอน sign-in แล้วฝังใน JWT — ถ้าฝั่ง API แก้ department/position ผู้ใช้ต้อง **logout แล้ว login ใหม่** ถึงจะเห็นค่าใหม่ (ยกเว้น `role` ที่คำนวณสดทุกครั้ง) |
| **อย่าใส่ข้อมูลก้อนใหญ่ลง JWT** | JWT อยู่ใน cookie — เกิน ~4KB browser จะตัดทิ้งแล้ว session พังทั้งระบบ |
| **อย่าส่ง token ออกไป client** | `apiToken` ต้องอยู่ใน JWT/`getApiToken()` เท่านั้น ห้าม expose ผ่าน `session()` callback |
| **middleware กันไว้ชั้นแรกแล้ว** | ทุก path ยกเว้น `/login`, `/api/auth/*`, `/api/cron/*` และ mobile API (x-api-key) ต้องมี session cookie — API ได้ JSON 401, หน้าเว็บถูก redirect ไป `/login` |

---

## 5. Debug

ทุกครั้งที่ login สำเร็จจะมี log ฝั่ง server (`[auth] google login`):

```
[auth] google login {
  "at": "2026-08-06T01:38:32.782Z",
  "email": "kittaboon.l@menatransport.co.th",
  "name": "Kittaboon Laingern (Bew)",
  "googleSub": "1116427230326...",
  "role": "admin",
  "apiStatus": "ok",
  "apiTokenReceived": true,
  "employee": { "employee_id": "...", "department": "...", "position_level": "..." }
}
```

ดูที่ไหน:
- **dev** → terminal ที่รัน `next dev`
- **production** → **Vercel → Deployment → Runtime Logs** (ไม่ใช่ Web Analytics ซึ่งเก็บแค่ pageview ฝั่ง client)

| `apiStatus` | แปลว่า | ทำอะไรต่อ |
|---|---|---|
| `ok` + `employee` มีค่า | ปกติ | — |
| `ok` แต่ `employee: null` | API ตอบ 200 แต่ field ไม่ตรงที่ parser รู้จัก | ดู `apiRaw` ใน log แล้วปรับ `looksLikeProfile()` / `pickString()` ใน [`lib/mena-api.ts`](../lib/mena-api.ts) |
| `failed` + `Invalid Google token` | ฝั่ง API verify id_token ไม่ผ่าน | เทียบ `idToken.aud` ใน log กับ `GOOGLE_CLIENT_ID` ของฝั่ง API — ปกติคือ **คนละ OAuth client กัน** |
| `failed` + `TimeoutError` | API cold start เกิน 12 วิ | ลอง login ใหม่ หรือปรับ `MENA_API_TIMEOUT_MS` |
| `ok` แต่ `missingFields` ไม่ว่าง | API คืนโปรไฟล์มาไม่ครบ (ดึงเต็มจาก `/users/{id}` แล้วยังขาด) | เทียบกับ MenaIT ว่า user คนนี้มี department/position ในระบบ HR จริงไหม |

log ไม่มี token ใด ๆ — ค่า token ถูก mask เป็น `«1234 chars»` โดย `redact()` ใน [`lib/mena-api.ts`](../lib/mena-api.ts)

---

## 6. Environment variables

| ตัวแปร | ใช้ทำอะไร | จำเป็น |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth ของ WMS | ✅ |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | next-auth (secret ใช้ encrypt JWT cookie) | ✅ |
| `MENA_API_URL` | base URL ของ Mena API (auth / employee / pipeline) | ✅ |
| `MENA_API_KEY` | `x-api-key` สำหรับ pipeline endpoints | ✅ (หน้า PR refresh) |
| `MENA_API_TIMEOUT_MS` | timeout ตอนเรียก API (default 12000) | — |

ตั้งให้ครบทั้ง `.env` (local) และ **Vercel Environment Variables** (production)

---

## 7. เช็คลิสต์ก่อนเขียนโค้ดที่ใช้โปรไฟล์

- [ ] อ่าน session ผ่าน `useSession()` (client) หรือ `getServerSession(authOptions)` (server) — **ห้าม** อ่าน cookie เองหรือเก็บซ้ำใน storage
- [ ] เช็ค `session?.user.employee` ว่ามีค่าก่อนใช้ทุกครั้ง (optional chaining + fallback)
- [ ] ถ้าต้องการฟิลด์ใหม่ในโปรไฟล์ → เพิ่มใน `EmployeeProfile` ([`lib/mena-api.ts`](../lib/mena-api.ts)) พร้อมกัน ไม่ต้องแก้ `types/next-auth.d.ts` (มัน import type มาใช้ต่อ)
- [ ] ถ้าต้องการฟิลด์ใหม่ที่ **ไม่ได้** มาจาก API → เพิ่มใน `jwt()` + `session()` callback ที่ [`lib/auth.ts`](../lib/auth.ts) และอัปเดต [`types/next-auth.d.ts`](../types/next-auth.d.ts)
- [ ] เก็บผู้ทำรายการลง DB เป็น `email` เสมอ (จะเก็บ `employee_id` เพิ่มก็ได้)
