// app/api/ap-suppliers/route.ts
// เครดิตเทอมเจ้าหนี้ = ค่าที่ sync มาจาก master ซัพพลายเออร์ของ ATMS (atmsTerm)
// ทับได้ด้วย override ที่คนตั้งเองในหน้า /ap-tracking/suppliers
// ตัวเลขที่ใช้จริงบนใบ DD คิดอีกชั้นใน resolveCreditTerm() (override > ap term บน PO > ค่าตรงนี้)
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { CREDIT_TERMS } from "@/lib/ap-tracking"

export const dynamic = "force-dynamic"

const DB = process.env.MONGO_DB ?? "master_data"
const COLL = "ap_supplier"
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

// GET /api/ap-suppliers — เครดิตเทอมของซัพพลายเออร์ทั้งหมด
// ddCount/lastDdAt ถูกคำนวณไว้ตอน sync แล้ว (ไม่ aggregate deposit_header ตอนเปิดหน้า)
export async function GET() {
  const client = await clientPromise
  const items = await client.db(DB).collection(COLL)
    .find({}, { projection: {
      _id: 0, name: 1, creditTerm: 1, override: 1, atmsTerm: 1,
      atmsCode: 1, atmsType: 1, atmsBranch: 1, ddCount: 1, lastDdAt: 1,
      syncedAt: 1, updatedBy: 1, updatedAt: 1,
    } })
    .sort({ name: 1 })
    .limit(5000)                // master ซัพพลายเออร์มีหลักพัน — กันคิวรีไม่มีขอบเขตไว้ก่อน
    .toArray()
  // เวลา sync ล่าสุดของทั้งชุด — หน้าเว็บใช้บอกว่าข้อมูลสดแค่ไหน
  const syncedAt = items.reduce((max, x) => (s(x.syncedAt) > max ? s(x.syncedAt) : max), "")
  return NextResponse.json({ items, syncedAt })
}

// PUT /api/ap-suppliers — ตั้ง/แก้เครดิตเทอมของซัพพลายเออร์หนึ่งราย
// ค่าที่ตั้งตรงนี้เป็น override ของคน · เลือก "ไม่ระบุ" = ล้าง override แล้วถอยไปใช้ค่าจาก ATMS
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const name = String(body?.name ?? "").trim()
  const creditTerm = String(body?.creditTerm ?? "").trim()
  if (!name) return NextResponse.json({ error: "ต้องระบุชื่อซัพพลายเออร์" }, { status: 400 })
  if (creditTerm && !(CREDIT_TERMS as readonly string[]).includes(creditTerm)) {
    return NextResponse.json({ error: `creditTerm ต้องเป็นหนึ่งใน ${CREDIT_TERMS.join(", ")}` }, { status: 400 })
  }

  const session = await getServerSession(authOptions)
  const by = session?.user?.name || session?.user?.email || ""

  const client = await clientPromise
  const col = client.db(DB).collection(COLL)
  // ต้องรู้ค่าจาก ATMS ก่อน เพื่อให้ "ไม่ระบุ" ถอยไปใช้ของ ATMS ได้แทนที่จะกลายเป็นว่างเปล่า
  const cur = await col.findOne({ name }, { projection: { _id: 0, atmsTerm: 1 } })
  const effective = creditTerm || s(cur?.atmsTerm)

  await col.updateOne(
    { name },
    { $set: {
      name, creditTerm: effective, override: creditTerm,
      updatedBy: by, updatedAt: new Date().toISOString(),
    } },
    { upsert: true },
  )
  return NextResponse.json({ ok: true, name, creditTerm: effective, override: creditTerm })
}
