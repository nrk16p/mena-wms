import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import clientPromise from "@/lib/mongo"
import { authOptions } from "@/lib/auth"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "master_sku"

// PUT /api/sku/[id]/resubmit — user resubmits a rejected SKU back to pending
export async function PUT(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id }   = await params
  const client   = await clientPromise
  const col      = client.db(DB).collection(COLL)

  // Only the creator can resubmit their own rejected SKU
  const doc = await col.findOne({ SKU: id } as never)
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (doc.createdBy !== session.user.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (doc.status !== "rejected") {
    return NextResponse.json({ error: "Only rejected SKUs can be resubmitted" }, { status: 400 })
  }

  await col.updateOne(
    { SKU: id } as never,
    {
      $set:   { status: "pending", updatedAt: new Date() },
      $unset: { rejectedReason: "", rejectedBy: "", rejectedAt: "" },
    }
  )

  return NextResponse.json({ ok: true })
}
