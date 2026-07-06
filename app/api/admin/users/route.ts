import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { SUPERADMIN_EMAIL } from "@/lib/permissions"
import clientPromise from "@/lib/mongo"

const DB = process.env.MONGO_DB ?? "master_data"

async function requireSuperAdmin(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions)
  if (session?.user?.email !== SUPERADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden — superadmin only" }, { status: 403 })
  }
  return null
}

// GET /api/admin/users — everyone who has signed in, unassigned first
export async function GET() {
  const forbidden = await requireSuperAdmin()
  if (forbidden) return forbidden

  const client = await clientPromise
  const users = await client.db(DB).collection("app_users")
    .find({}, { projection: { _id: 0 } })
    .sort({ group_id: 1, last_seen: -1 })
    .toArray()
  return NextResponse.json({ users })
}

// PATCH /api/admin/users — { email, group_id: string | null }
export async function PATCH(req: NextRequest) {
  const forbidden = await requireSuperAdmin()
  if (forbidden) return forbidden

  const body = await req.json()
  const email = String(body.email ?? "").trim()
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 })

  const client = await clientPromise
  const db     = client.db(DB)

  let groupId: ObjectId | null = null
  let groupName: string | null = null
  if (body.group_id) {
    try { groupId = new ObjectId(String(body.group_id)) }
    catch { return NextResponse.json({ error: "invalid group_id" }, { status: 400 }) }
    const group = await db.collection("permission_groups").findOne({ _id: groupId })
    if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 })
    groupName = group.name
  }

  const r = await db.collection("app_users").updateOne(
    { email },
    { $set: { group_id: groupId, group_name: groupName } }
  )
  if (r.matchedCount === 0) return NextResponse.json({ error: "user not found" }, { status: 404 })
  return NextResponse.json({ ok: true, email, group_name: groupName })
}
