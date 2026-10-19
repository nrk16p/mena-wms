import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import clientPromise from "@/lib/mongo"
import { authOptions } from "@/lib/auth"
import { isAdmin } from "@/lib/roles"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "master_codes"

type Params = { params: Promise<{ dict: string }> }

// GET /api/codes/[dict]?parent=ENG&expenseType=LAB
export async function GET(req: NextRequest, { params }: Params) {
  const { dict }      = await params
  const parent        = req.nextUrl.searchParams.get("parent") ?? undefined
  const expenseType   = req.nextUrl.searchParams.get("expenseType") ?? undefined
  const client        = await clientPromise
  const col           = client.db(DB).collection(COLL)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = { dict }
  if (parent !== undefined) filter.parent = parent

  if (expenseType === "LAB") {
    filter["meta.expenseType"] = "LAB"
  } else if (expenseType) {
    // PRT, PM, SVC, CLN, TRP, ACC — exclude labor-specific codes
    filter["meta.expenseType"] = { $ne: "LAB" }
  }
  // No expenseType → return all (used by Code Dictionary admin page)

  const items = await col.find(filter).sort({ order: 1, code: 1 }).toArray()
  return NextResponse.json(items)
}

// dict ที่ผู้ใช้ทั่วไป (ไม่ใช่แอดมิน) เพิ่มได้เอง — เพิ่มยี่ห้อจากในฟอร์มสร้าง SKU ได้เลย
// dict อื่น (คลัง · ประเภทค่าใช้จ่าย · L1/L2/L3 ฯลฯ) กระทบโครงรหัส SKU จึงยังจำกัดไว้ที่แอดมิน
const USER_WRITABLE_DICTS = new Set(["BRAND"])

// POST /api/codes/[dict]
export async function POST(req: NextRequest, { params }: Params) {
  const { dict } = await params

  const session = await getServerSession(authOptions)
  const email   = session?.user?.email
  if (!email) {
    return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 })
  }
  if (!isAdmin(email) && !USER_WRITABLE_DICTS.has(dict)) {
    return NextResponse.json({ error: `เพิ่มรหัสในชุด ${dict} ได้เฉพาะแอดมิน` }, { status: 403 })
  }

  const body = await req.json() as { code: string; th: string; en?: string; parent?: string; meta?: Record<string, unknown> }

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
    meta:   { ...(body.meta ?? {}), createdBy: email, createdAt: new Date() },
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await col.insertOne(doc as any)
  return NextResponse.json(doc, { status: 201 })
}
