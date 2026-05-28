import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "master_codes"

type Params = { params: Promise<{ dict: string }> }

// GET /api/codes/[dict]?parent=ENG
export async function GET(req: NextRequest, { params }: Params) {
  const { dict } = await params
  const parent   = req.nextUrl.searchParams.get("parent") ?? undefined
  const client   = await clientPromise
  const col      = client.db(DB).collection(COLL)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = { dict }
  if (parent !== undefined) filter.parent = parent

  const items = await col.find(filter).sort({ order: 1, code: 1 }).toArray()
  return NextResponse.json(items)
}

// POST /api/codes/[dict]
export async function POST(req: NextRequest, { params }: Params) {
  const { dict } = await params
  const body     = await req.json() as { code: string; th: string; en?: string; parent?: string; meta?: Record<string, unknown> }

  if (!body.code || !body.th) {
    return NextResponse.json({ error: "code and th are required" }, { status: 400 })
  }

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  const parentKey = body.parent ? `${body.parent}:` : ""
  const docId     = `${dict}:${parentKey}${body.code}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await col.findOne({ _id: docId as any })
  if (existing) {
    return NextResponse.json({ error: `Code ${body.code} already exists in ${dict}` }, { status: 409 })
  }

  const lastOrder = await col
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .find({ dict, parent: body.parent ?? null } as any)
    .sort({ order: -1 })
    .limit(1)
    .toArray()
  const order = (lastOrder[0]?.order ?? -1) + 1

  const doc = {
    _id:    docId,
    dict,
    code:   body.code.toUpperCase(),
    th:     body.th,
    en:     body.en ?? "",
    parent: body.parent ?? null,
    order,
    meta:   body.meta ?? {},
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await col.insertOne(doc as any)
  return NextResponse.json(doc, { status: 201 })
}
