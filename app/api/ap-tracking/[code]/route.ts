// app/api/ap-tracking/[code]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { AP_DOC_FIELDS, apStatusOf, type ApDocKey, type ApDocs } from "@/lib/ap-tracking"

export const dynamic = "force-dynamic"

const MD = process.env.MONGO_DB ?? "master_data"
const COLL = "ap_tracking"
const DOC_KEYS = new Set<string>(AP_DOC_FIELDS.map((f) => f.key))
const SENT_TYPES = new Set(["", "นอกรอบ", "ตามรอบ"])
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

// GET — รายละเอียดใบ DD: รายการสินค้า + PO + tracking (พร้อม log)
export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params            // Next 16: params เป็น Promise
  const depositCode = decodeURIComponent(code).trim()
  if (!depositCode) return NextResponse.json({ error: "ไม่พบเลขที่ใบรับของ" }, { status: 400 })

  const client = await clientPromise
  const atms = client.db("atms"), md = client.db(MD)

  const head = await atms.collection("deposit_header").findOne(
    { deposit_code: depositCode },
    { projection: { _id: 0, deposit_id: 1, purchase_order: 1 } },
  )
  const [tracking, items, po] = await Promise.all([
    md.collection(COLL).findOne({ depositCode }, { projection: { _id: 0 } }),
    head?.deposit_id != null
      ? atms.collection("deposit_items").find({ deposit_id: head.deposit_id }, { projection: { _id: 0 } }).limit(300).toArray()
      : [],
    head?.purchase_order
      ? atms.collection("purchase_orders").findOne({ "รหัส": s(head.purchase_order) }, { projection: { _id: 0 } })
      : null,
  ])
  return NextResponse.json({ tracking: tracking ?? null, items, po })
}

// PATCH — บันทึกการติ๊ก/วันที่ส่งบัญชี/หมายเหตุ (สร้าง doc ครั้งแรกแบบ lazy) + ลง log ทุกครั้ง
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params
  const depositCode = decodeURIComponent(code).trim()
  if (!depositCode) return NextResponse.json({ error: "ไม่พบเลขที่ใบรับของ" }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const session = await getServerSession(authOptions)
  const by = session?.user?.name || session?.user?.email || ""
  const byEmail = session?.user?.email || ""
  const at = new Date().toISOString()

  const client = await clientPromise
  const col = client.db(MD).collection(COLL)
  const current = await col.findOne({ depositCode })
  const docs: ApDocs = { ...((current?.docs ?? {}) as ApDocs) }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set: Record<string, any> = { depositCode, updatedAt: at, updatedBy: by }
  const log: Record<string, string>[] = []

  if (body?.docs && typeof body.docs === "object") {
    for (const [k, v] of Object.entries(body.docs as Record<string, unknown>)) {
      if (!DOC_KEYS.has(k)) return NextResponse.json({ error: `ช่องเอกสารไม่ถูกต้อง: ${k}` }, { status: 400 })
      const checked = Boolean(v)
      docs[k as ApDocKey] = { checked, by, at }
      log.push({ action: checked ? "ติ๊ก" : "ยกเลิกติ๊ก", field: k, by, byEmail, at })
    }
    set.docs = docs
  }

  if (body?.sentType !== undefined || body?.sentDate !== undefined) {
    const sentType = s(body?.sentType ?? current?.sentType)
    const sentDate = s(body?.sentDate ?? current?.sentDate)
    if (!SENT_TYPES.has(sentType)) return NextResponse.json({ error: "sentType ต้องเป็น นอกรอบ หรือ ตามรอบ" }, { status: 400 })
    if (sentDate && !/^\d{4}-\d{2}-\d{2}$/.test(sentDate)) return NextResponse.json({ error: "sentDate ต้องเป็น YYYY-MM-DD" }, { status: 400 })
    if (sentDate && !sentType) return NextResponse.json({ error: "ต้องเลือกว่าเป็น นอกรอบ หรือ ตามรอบ" }, { status: 400 })
    set.sentType = sentDate ? sentType : ""
    set.sentDate = sentDate
    log.push({ action: sentDate ? `ส่งบัญชี (${sentType})` : "ยกเลิกส่งบัญชี", field: "sent", detail: sentDate, by, byEmail, at })
  }

  if (body?.note !== undefined) {
    set.note = s(body.note).slice(0, 500)
    log.push({ action: "แก้หมายเหตุ", field: "note", detail: set.note, by, byEmail, at })
  }

  if (!log.length) return NextResponse.json({ error: "ไม่มีข้อมูลให้บันทึก" }, { status: 400 })

  await col.updateOne(
    { depositCode },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { $set: set, $push: { log: { $each: log } }, $setOnInsert: { createdAt: at, createdBy: by } } as any,
    { upsert: true },
  )

  const sentDate = set.sentDate !== undefined ? set.sentDate : s(current?.sentDate)
  return NextResponse.json({
    ok: true,
    docs: set.docs ?? docs,
    sentType: set.sentType !== undefined ? set.sentType : s(current?.sentType),
    sentDate,
    note: set.note !== undefined ? set.note : s(current?.note),
    status: apStatusOf(set.docs ?? docs, sentDate),
  })
}
