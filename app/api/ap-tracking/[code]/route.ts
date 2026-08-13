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

// "YYYY-MM-DD" ที่เป็นวันที่จริง (ปฏิเสธ 2026-13-99 ฯลฯ) — ไม่ใช่แค่รูปแบบ
function isValidYmd(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3])
  if (month < 1 || month > 12) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day >= 1 && day <= daysInMonth
}

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set: Record<string, any> = { depositCode, updatedAt: at, updatedBy: by }
  const log: Record<string, string>[] = []

  // ติ๊กแต่ละช่องเขียนแบบ dotted path (docs.<key>) แทนการแทนที่ทั้ง object —
  // กัน race เวลาสองคนติ๊กคนละช่องพร้อมกันแล้วคนหลังทับคนแรก
  if (body?.docs && typeof body.docs === "object") {
    for (const [k, v] of Object.entries(body.docs as Record<string, unknown>)) {
      if (!DOC_KEYS.has(k)) return NextResponse.json({ error: `ช่องเอกสารไม่ถูกต้อง: ${k}` }, { status: 400 })
      if (typeof v !== "boolean") return NextResponse.json({ error: `ค่าของ ${k} ต้องเป็นจริง/เท็จ` }, { status: 400 })
    }
    for (const [k, v] of Object.entries(body.docs as Record<string, boolean>)) {
      const checked = v
      set[`docs.${k as ApDocKey}`] = { checked, by, at }
      log.push({ action: checked ? "ติ๊ก" : "ยกเลิกติ๊ก", field: k, by, byEmail, at })
    }
  }

  if (body?.sentType !== undefined || body?.sentDate !== undefined) {
    const bodySentType = body?.sentType !== undefined ? s(body.sentType) : undefined
    const sentType = s(bodySentType ?? current?.sentType)
    const sentDate = s(body?.sentDate ?? current?.sentDate)
    if (!SENT_TYPES.has(sentType)) return NextResponse.json({ error: "sentType ต้องเป็น นอกรอบ หรือ ตามรอบ" }, { status: 400 })
    if (sentDate && !isValidYmd(sentDate)) return NextResponse.json({ error: "sentDate ต้องเป็น YYYY-MM-DD" }, { status: 400 })
    if (sentDate && !sentType) return NextResponse.json({ error: "ต้องเลือกว่าเป็น นอกรอบ หรือ ตามรอบ" }, { status: 400 })
    // ระบุ sentType โดยไม่มี sentDate (ทั้งจาก body และของเดิม) = ค่าจะถูกทิ้งเงียบๆ ไม่ยอมให้ทำ
    if (bodySentType && !sentDate) return NextResponse.json({ error: "ต้องระบุ sentDate เมื่อเลือก sentType" }, { status: 400 })

    const hadSentDate = Boolean(s(current?.sentDate))
    set.sentType = sentDate ? sentType : ""
    set.sentDate = sentDate
    if (sentDate) {
      log.push({ action: `ส่งบัญชี (${sentType})`, field: "sent", detail: sentDate, by, byEmail, at })
    } else if (hadSentDate) {
      // ยกเลิกจริง (เคยมี sentDate มาก่อน) เท่านั้นถึงจะลง log — ล้างค่าที่ว่างอยู่แล้วไม่ควรลง log หลอกๆ
      log.push({ action: "ยกเลิกส่งบัญชี", field: "sent", detail: sentDate, by, byEmail, at })
    }
  }

  if (body?.note !== undefined) {
    set.note = s(body.note).slice(0, 500)
    log.push({ action: "แก้หมายเหตุ", field: "note", detail: set.note, by, byEmail, at })
  }

  if (!log.length) return NextResponse.json({ error: "ไม่มีข้อมูลให้บันทึก" }, { status: 400 })

  // findOneAndUpdate คืน state หลังเขียนจริง (ไม่ใช่ค่าที่ merge เองในหน่วยความจำ) กัน response
  // เพี้ยนจาก DB จริงเวลามีคนอื่นเขียนแทรกระหว่างนี้
  const doc = await col.findOneAndUpdate(
    { depositCode },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { $set: set, $push: { log: { $each: log } }, $setOnInsert: { createdAt: at, createdBy: by } } as any,
    { upsert: true, returnDocument: "after" },
  )

  if (!doc) return NextResponse.json({ error: "บันทึกไม่สำเร็จ" }, { status: 500 })

  const docsOut = (doc.docs ?? {}) as ApDocs
  const sentDateOut = s(doc.sentDate)
  return NextResponse.json({
    ok: true,
    docs: docsOut,
    sentType: s(doc.sentType),
    sentDate: sentDateOut,
    note: s(doc.note),
    status: apStatusOf(docsOut, sentDateOut),
  })
}
