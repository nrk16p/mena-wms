import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { SUPERADMIN_EMAIL, SECTION_KEYS } from "@/lib/permissions"
import clientPromise from "@/lib/mongo"

const DB = process.env.MONGO_DB ?? "master_data"

async function requireSuperAdmin(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions)
  if (session?.user?.email !== SUPERADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden — superadmin only" }, { status: 403 })
  }
  return null
}

function sanitizeAccess(access: unknown): string[] {
  if (!Array.isArray(access)) return []
  return access.filter((k): k is string => typeof k === "string" && (SECTION_KEYS as readonly string[]).includes(k))
}

// GET /api/admin/groups — all permission groups with member counts
export async function GET() {
  const forbidden = await requireSuperAdmin()
  if (forbidden) return forbidden

  const client = await clientPromise
  const db     = client.db(DB)
  const groups = await db.collection("permission_groups").find().sort({ created_at: 1 }).toArray()
  const counts = await db.collection("app_users").aggregate([
    { $match: { group_id: { $ne: null } } },
    { $group: { _id: "$group_id", count: { $sum: 1 } } },
  ]).toArray()
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]))
  return NextResponse.json({
    groups: groups.map((g) => ({
      id: String(g._id), name: g.name, access: g.access ?? [],
      memberCount: countMap.get(String(g._id)) ?? 0,
    })),
  })
}

// POST /api/admin/groups — { name, access }
export async function POST(req: NextRequest) {
  const forbidden = await requireSuperAdmin()
  if (forbidden) return forbidden

  const body = await req.json()
  const name = String(body.name ?? "").trim()
  if (!name) return NextResponse.json({ error: "ต้องระบุชื่อกลุ่ม" }, { status: 400 })

  const client = await clientPromise
  const now = new Date()
  const r = await client.db(DB).collection("permission_groups").insertOne({
    name, access: sanitizeAccess(body.access), created_at: now, updated_at: now,
  })
  return NextResponse.json({ ok: true, id: String(r.insertedId) })
}

// PATCH /api/admin/groups — { id, name, access }
export async function PATCH(req: NextRequest) {
  const forbidden = await requireSuperAdmin()
  if (forbidden) return forbidden

  const body = await req.json()
  let id: ObjectId
  try { id = new ObjectId(String(body.id)) }
  catch { return NextResponse.json({ error: "invalid id" }, { status: 400 }) }
  const name = String(body.name ?? "").trim()
  if (!name) return NextResponse.json({ error: "ต้องระบุชื่อกลุ่ม" }, { status: 400 })

  const client = await clientPromise
  const db     = client.db(DB)
  await db.collection("permission_groups").updateOne(
    { _id: id },
    { $set: { name, access: sanitizeAccess(body.access), updated_at: new Date() } }
  )
  // keep denormalized group_name in sync
  await db.collection("app_users").updateMany({ group_id: id }, { $set: { group_name: name } })
  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/groups — { id }; refuses when members are still assigned
export async function DELETE(req: NextRequest) {
  const forbidden = await requireSuperAdmin()
  if (forbidden) return forbidden

  const body = await req.json()
  let id: ObjectId
  try { id = new ObjectId(String(body.id)) }
  catch { return NextResponse.json({ error: "invalid id" }, { status: 400 }) }

  const client = await clientPromise
  const db     = client.db(DB)
  const memberCount = await db.collection("app_users").countDocuments({ group_id: id })
  if (memberCount > 0) {
    return NextResponse.json(
      { error: `มีผู้ใช้ ${memberCount} คนอยู่ในกลุ่มนี้ — ย้ายออกก่อนจึงจะลบได้`, memberCount },
      { status: 409 }
    )
  }
  await db.collection("permission_groups").deleteOne({ _id: id })
  return NextResponse.json({ ok: true })
}
