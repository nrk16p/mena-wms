// app/api/admin/users/route.ts
// GET /api/admin/users — ผู้ใช้ทั้งหมดที่เคยเข้า WMS (wms_users) + override + สิทธิ์ตามแผนก + สิทธิ์จริง
// superadmin เท่านั้น (middleware บล็อกแล้ว + ตรวจซ้ำที่นี่)
import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/admin-guard"
import { ACCESS_OVERRIDES_COLL, WMS_USERS_COLL } from "@/lib/access-refresh"
import { buildUserRow, sortUsers, type WmsUser } from "@/lib/access-admin"

export const dynamic = "force-dynamic"

const DB = () => process.env.MONGO_DB ?? "master_data"

export async function GET() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.res

  try {
    const db = (await (await import("@/lib/mongo")).default).db(DB())
    const [users, overrides] = await Promise.all([
      db.collection(WMS_USERS_COLL).find({}, { projection: { _id: 0 } }).toArray(),
      db.collection(ACCESS_OVERRIDES_COLL).find({}, { projection: { _id: 0, email: 1, overrides: 1 } }).toArray(),
    ])
    const byEmail = new Map(overrides.map((o) => [String(o.email ?? "").toLowerCase(), o.overrides]))
    const rows = sortUsers(users as unknown as WmsUser[]).map((u) => buildUserRow(u, byEmail.get(u.email.toLowerCase())))
    return NextResponse.json({ users: rows })
  } catch (e) {
    console.error("[admin/users] GET", e)
    return NextResponse.json({ error: "โหลดรายชื่อผู้ใช้ไม่สำเร็จ" }, { status: 500 })
  }
}
