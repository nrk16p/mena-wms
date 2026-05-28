import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "master_codes"

type Params = { params: Promise<{ dict: string; code: string }> }

// GET /api/codes/[dict]/[code]
export async function GET(_: NextRequest, { params }: Params) {
  const { dict, code } = await params
  const client = await clientPromise
  const docId  = `${dict}:${code}`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = await client.db(DB).collection(COLL).findOne({ _id: docId as any })
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(doc)
}

// PUT /api/codes/[dict]/[code]
export async function PUT(req: NextRequest, { params }: Params) {
  const { dict, code } = await params
  const body   = await req.json() as { th?: string; en?: string; meta?: Record<string, unknown> }
  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)
  const docId  = `${dict}:${code}`

  const update: Record<string, unknown> = {}
  if (body.th   !== undefined) update.th   = body.th
  if (body.en   !== undefined) update.en   = body.en
  if (body.meta !== undefined) update.meta = body.meta

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await col.updateOne({ _id: docId as any }, { $set: update })
  if (result.matchedCount === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/codes/[dict]/[code]
export async function DELETE(_: NextRequest, { params }: Params) {
  const { dict, code } = await params
  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)
  const docId  = `${dict}:${code}`

  // Delete the entry + cascade children (L2 under L1, L3 under L1:L2)
  const codeOnly     = code.includes(":") ? code.split(":").slice(1).join(":") : code
  const childPattern = new RegExp(`^${codeOnly.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)

  await col.deleteMany({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $or: [
      { _id: docId as any },
      { dict: "SUB_ASSEMBLY_L2", parent: childPattern } as any,
      { dict: "COMPONENT_L3", parent: childPattern }    as any,
    ],
  })

  return NextResponse.json({ ok: true })
}
