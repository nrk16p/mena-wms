// app/api/admin/users/[email]/access/route.ts
// PUT /api/admin/users/{email}/access  body { overrides: { [section]: "none" | "view" | "edit" } }
//   → เก็บเฉพาะข้อยกเว้นจริง (ค่าที่เท่ากับแผนกตัดทิ้ง · ว่าง = ลบเอกสาร) + บันทึกประวัติ wms_access_log
//   ผู้ใช้เห็นผลภายใน 5 นาที (jwt callback รีเฟรช — lib/access-refresh.ts)
// superadmin เท่านั้น · ตั้งทับ superadmin / admin ไม่ได้ (400)
import { NextRequest, NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/admin-guard"
import { ACCESS_LOG_COLL, ACCESS_OVERRIDES_COLL, WMS_USERS_COLL } from "@/lib/access-refresh"
import { buildUserRow, cleanOverrides, diffOverrides, normalizeOverrides, overrideBlockedReason, type WmsUser } from "@/lib/access-admin"

export const dynamic = "force-dynamic"

const DB = () => process.env.MONGO_DB ?? "master_data"
type Params = { params: Promise<{ email: string }> }

function decodeEmail(raw: string): string {
  try { return decodeURIComponent(raw).trim().toLowerCase() } catch { return raw.trim().toLowerCase() }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.res

  const email = decodeEmail((await params).email)
  if (!email.includes("@")) return NextResponse.json({ error: "อีเมลไม่ถูกต้อง" }, { status: 400 })
  const blocked = overrideBlockedReason(email)
  if (blocked) return NextResponse.json({ error: blocked }, { status: 400 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "body ต้องเป็น JSON" }, { status: 400 }) }
  const input = (body as { overrides?: unknown } | null)?.overrides

  try {
    const db = (await (await import("@/lib/mongo")).default).db(DB())
    const user = await db.collection(WMS_USERS_COLL).findOne({ email }, { projection: { _id: 0 } })
    if (!user) return NextResponse.json({ error: "ไม่พบผู้ใช้นี้ (ต้องเข้า WMS อย่างน้อย 1 ครั้งก่อน)" }, { status: 404 })

    const norm = normalizeOverrides(input, user.department as string | null)
    if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 })
    const after = norm.overrides

    const coll = db.collection(ACCESS_OVERRIDES_COLL)
    const prev = await coll.findOne({ email }, { projection: { overrides: 1 } })
    const before = cleanOverrides(prev?.overrides)
    const changes = diffOverrides(before, after)

    if (changes.length > 0) {
      const now = new Date()
      if (Object.keys(after).length === 0) {
        await coll.deleteOne({ email })
      } else {
        await coll.updateOne(
          { email },
          { $set: { email, overrides: after, updatedAt: now, updatedBy: guard.email } },
          { upsert: true },
        )
      }
      await db.collection(ACCESS_LOG_COLL).insertOne({ at: now, by: guard.email, target: email, before, after })
    }

    return NextResponse.json({ ok: true, changed: changes.length, user: buildUserRow(user as unknown as WmsUser, after) })
  } catch (e) {
    console.error("[admin/users/access] PUT", e)
    return NextResponse.json({ error: "บันทึกสิทธิ์ไม่สำเร็จ" }, { status: 500 })
  }
}
