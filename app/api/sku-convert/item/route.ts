// แปลงรหัส ATMS: รหัสเดียว — id อยู่ใน query string เสมอ (รหัส ATMS มี / ช่องว่าง วงเล็บ ภาษาไทยได้)
//   GET /api/sku-convert/item?id=…  → ConvertDetailResponse { item, liveStock, next, me }
//   PUT /api/sku-convert/item?id=…  body { entries, release } → 200 { item } · 404 · 409 { error, holder }
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { sanitizeEntries } from "@/lib/sku-convert-core"
import { getItem, liveStock, loadCodeBook, nextTodo, saveEntries } from "@/lib/sku-convert-db"
import type { ConvertDetailResponse } from "@/lib/sku-convert-types"

const DB = process.env.MONGO_DB ?? "master_data"
export const dynamic = "force-dynamic"

async function requireMe() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return null
  return { email, name: session.user?.name || email }
}

export async function GET(req: NextRequest) {
  const me = await requireMe()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "ต้องระบุ id" }, { status: 400 })

  const db = (await clientPromise).db(DB)
  const item = await getItem(db, id)
  if (!item) return NextResponse.json({ error: "ไม่พบรหัสนี้" }, { status: 404 })
  const [stock, next] = await Promise.all([liveStock(db, item), nextTodo(db, item, me.email)])
  const res: ConvertDetailResponse = { item, liveStock: stock, next, me }
  return NextResponse.json(res)
}

export async function PUT(req: NextRequest) {
  const me = await requireMe()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "ต้องระบุ id" }, { status: 400 })

  let body: { entries?: unknown; release?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "body ต้องเป็น JSON" }, { status: 400 })
  }
  // ไม่ใช่ array = request เสีย — ห้ามตีความเป็น [] (จะล้างงานที่บันทึกไว้)
  if (!body || typeof body !== "object" || !Array.isArray(body.entries)) {
    return NextResponse.json({ error: "entries ต้องเป็น array" }, { status: 400 })
  }

  const db = (await clientPromise).db(DB)
  const book = await loadCodeBook(db)
  const r = await saveEntries(db, id, me, sanitizeEntries(body.entries), book, body.release === true)
  if (r.ok) return NextResponse.json({ item: r.item })
  if (r.status === 404) return NextResponse.json({ error: "ไม่พบรหัสนี้" }, { status: 404 })
  return NextResponse.json(
    { error: `${r.holder?.name ?? "คนอื่น"} กำลังแก้รหัสนี้อยู่ — บันทึกไม่ได้`, holder: r.holder ?? null },
    { status: 409 },
  )
}
