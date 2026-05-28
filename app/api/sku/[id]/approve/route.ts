import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import clientPromise from "@/lib/mongo"
import { authOptions } from "@/lib/auth"
import { isAdmin } from "@/lib/roles"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "master_sku"

export async function PUT(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id }  = await params
  const client  = await clientPromise
  const result  = await client.db(DB).collection(COLL).updateOne(
    { SKU: id },
    { $set: { status: "approved", approvedBy: session!.user!.email, approvedAt: new Date(), updatedAt: new Date() } }
  )

  if (result.matchedCount === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id }    = await params
  const body      = await req.json().catch(() => ({}))
  const reason    = typeof body.reason === "string" ? body.reason.trim() : ""

  const client  = await clientPromise
  const result  = await client.db(DB).collection(COLL).updateOne(
    { SKU: id },
    { $set: { status: "rejected", rejectedBy: session!.user!.email, rejectedAt: new Date(), rejectedReason: reason, updatedAt: new Date() } }
  )

  if (result.matchedCount === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
