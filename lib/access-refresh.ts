// lib/access-refresh.ts — รีเฟรชสิทธิ์ใน JWT (เรียกจาก jwt callback ใน lib/auth.ts)
//
// ตอน login และทุก 5 นาที: อ่าน override ที่ superadmin ตั้งทับ + บันทึกผู้ใช้ลง wms_users (หน้า /admin/users)
// DB ล่ม → คงค่าเดิมใน token แล้วลองใหม่ในอีก ~1 นาที (ไม่ล็อกใครออก และไม่ขยายสิทธิ์)
// middleware อ่านค่าจาก token อย่างเดียว ไม่แตะ DB

export const ACCESS_REFRESH_MS = 5 * 60_000
const RETRY_MS = 60_000
const DB = () => process.env.MONGO_DB ?? "master_data"
// import Mongo ตอนใช้จริงเท่านั้น — lib/mongo ต่อ DB ทันทีที่ถูก import
const mongo = async () => (await import("@/lib/mongo")).default

export const ACCESS_OVERRIDES_COLL = "wms_access_overrides"
export const WMS_USERS_COLL = "wms_users"
export const ACCESS_LOG_COLL = "wms_access_log"

type TokenLike = {
  email?: string | null
  name?: string | null
  picture?: string | null
  employee?: { department?: string | null; site_id?: number | null; position?: string | null; employee_id?: string | null } | null
  accessOverrides?: Record<string, unknown>
  accessAt?: number
}

export type RefreshDeps = {
  now: () => number
  loadOverrides: (email: string) => Promise<Record<string, unknown> | null>
  touchUser: (u: { email: string; name: string; image: string; department: string | null; siteId: number | null; position: string | null; employeeId: string | null }) => Promise<void>
}

const realDeps: RefreshDeps = {
  now: Date.now,
  async loadOverrides(email) {
    const db = (await mongo()).db(DB())
    const doc = await db.collection(ACCESS_OVERRIDES_COLL).findOne({ email }, { projection: { overrides: 1 } })
    return (doc?.overrides as Record<string, unknown>) ?? null
  },
  async touchUser(u) {
    const db = (await mongo()).db(DB())
    const now = new Date()
    await db.collection(WMS_USERS_COLL).updateOne(
      { email: u.email },
      {
        $set: { name: u.name, image: u.image, department: u.department, siteId: u.siteId, position: u.position, employeeId: u.employeeId, lastSeenAt: now },
        $setOnInsert: { email: u.email, firstSeenAt: now },
      },
      { upsert: true },
    )
  },
}

export async function refreshAccess(token: TokenLike, deps: RefreshDeps = realDeps, force = false): Promise<void> {
  const email = (token.email ?? "").toLowerCase()
  if (!email) return
  const now = deps.now()
  if (!force && token.accessAt !== undefined && now - token.accessAt < ACCESS_REFRESH_MS) return
  try {
    const e = token.employee ?? {}
    const [overrides] = await Promise.all([
      deps.loadOverrides(email),
      deps.touchUser({
        email, name: token.name ?? "", image: token.picture ?? "",
        department: e.department ?? null, siteId: e.site_id ?? null, position: e.position ?? null, employeeId: e.employee_id ?? null,
      }),
    ])
    token.accessOverrides = overrides ?? {}
    token.accessAt = now
  } catch (err) {
    console.warn("[access] refresh failed — keeping previous access:", err instanceof Error ? err.message : err)
    token.accessOverrides = token.accessOverrides ?? {}
    token.accessAt = now - ACCESS_REFRESH_MS + RETRY_MS
  }
}
