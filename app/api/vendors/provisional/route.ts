// app/api/vendors/provisional/route.ts
// ทะเบียน "ชื่อชั่วคราว" ของเจ้าใหม่ที่ยังไม่ขึ้นทะเบียน ATMS (ผู้ใช้อนุมัติแนวทาง 16/10/2026)
//
// ทำไมต้องมี: รายชื่อใน /vendors (AVL) สร้างจากประวัติเบิกค่าแรงจริง (lib/vendor-core) เจ้าที่ยังไม่เคย
// ทำงานกับเราจึงไม่มีทางโผล่ในรายชื่อ — แต่ตอนขอราคาเรายังไม่รู้ว่าจะได้ใช้เจ้านี้ไหม จะบังคับให้
// ขึ้นทะเบียน ATMS ก่อนทุกเจ้าก็ช้าเกินจริง · เก็บชื่อชั่วคราวไว้ที่นี่ แล้วบังคับ "ผูกตัวจริง" ตอนจะปิดใบ
// (canTransition ใน lib/price-compare เป็นด่าน) เพราะปลายทาง PR/PO/ตั้งเบิก ดึงผู้ขายจาก ATMS
//
// คอลเลกชันนี้ไม่ปนเข้า AVL — AVL ยังหมายถึง "เคยทำงานจริง" เหมือนเดิม
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { toBkkIso } from "@/lib/bkk-time"
import { getVendors } from "@/lib/vendor"
import { getAtmsGarages, garageKey } from "@/lib/atms-garage"
import { likelySameGarage } from "@/lib/repair-external"

export const dynamic = "force-dynamic"

const DB = () => process.env.MONGO_DB ?? "master_data"
export const PROVISIONAL_COLL = "vendor_provisional"
const NAME_MAX = 120

type Me = { name: string; email: string }
async function me(): Promise<Me | null> {
  const s = await getServerSession(authOptions)
  return s?.user ? { name: s.user.name || s.user.email || "", email: s.user.email || "" } : null
}
const str = (v: unknown, max = NAME_MAX) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max)

/** ชื่อที่ใกล้เคียงจากทุกแหล่ง — กันสร้างชื่อซ้ำที่สะกดต่างกันนิดเดียว (ปัญหาเดิมของ garage_name_map) */
async function similarNames(name: string): Promise<{ source: "avl" | "atms" | "provisional"; name: string; atmsId?: number }[]> {
  const db = (await clientPromise).db(DB())
  const [avl, atms, prov] = await Promise.all([
    getVendors().then((d) => d.vendors.map((v) => v.vendor)).catch(() => [] as string[]),
    getAtmsGarages().catch(() => []),
    db.collection(PROVISIONAL_COLL).find({}, { projection: { _id: 0, name: 1, atmsId: 1 } }).toArray(),
  ])
  const out: { source: "avl" | "atms" | "provisional"; name: string; atmsId?: number }[] = []
  for (const v of avl) if (likelySameGarage(v, name)) out.push({ source: "avl", name: v })
  for (const g of atms) if (likelySameGarage(g.name, name)) out.push({ source: "atms", name: g.name, atmsId: g.atmsId })
  for (const p of prov) {
    const n = String(p.name ?? "")
    if (n && likelySameGarage(n, name)) out.push({ source: "provisional", name: n, ...(p.atmsId ? { atmsId: Number(p.atmsId) } : {}) })
  }
  return out.slice(0, 12)
}

// GET /api/vendors/provisional — คิวชื่อชั่วคราวทั้งหมด (?pending=1 = เฉพาะที่ยังไม่ผูก ATMS)
export async function GET(req: NextRequest) {
  if (!(await me())) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const onlyPending = req.nextUrl.searchParams.get("pending") === "1"
    const db = (await clientPromise).db(DB())
    const filter = onlyPending ? { $or: [{ atmsId: null }, { atmsId: { $exists: false } }] } : {}
    const rows = await db.collection(PROVISIONAL_COLL).find(filter).sort({ createdAt: -1 }).limit(500).toArray()
    return NextResponse.json({
      vendors: rows.map((r) => ({
        key: String(r.key ?? ""), name: String(r.name ?? ""), kind: String(r.kind ?? ""),
        contact: r.contact ?? {}, docNos: Array.isArray(r.docNos) ? r.docNos.map(String) : [],
        createdBy: String(r.createdBy ?? ""), createdAt: String(r.createdAt ?? ""),
        atmsId: r.atmsId ? Number(r.atmsId) : null, atmsName: String(r.atmsName ?? ""),
        linkedBy: String(r.linkedBy ?? ""), linkedAt: String(r.linkedAt ?? ""),
      })),
    })
  } catch (e) {
    console.error("[vendors/provisional] GET", e)
    return NextResponse.json({ error: "โหลดคิวชื่อชั่วคราวไม่สำเร็จ" }, { status: 500 })
  }
}

// POST { name, kind?, contact?, docNo?, force? } — จองชื่อชั่วคราว
// 409 + similar[] เมื่อมีชื่อใกล้เคียง (ให้คนเลือกใช้ชื่อเดิม) · ส่ง force=true เพื่อยืนยันว่าเป็นเจ้าใหม่จริง
export async function POST(req: NextRequest) {
  const user = await me()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const name = str(b?.name)
  if (name.length < 2) return NextResponse.json({ error: "ต้องระบุชื่อผู้ขาย/อู่ อย่างน้อย 2 ตัวอักษร" }, { status: 400 })
  const kind = str(b?.kind, 40)
  const contact = {
    person: str(b?.contact?.person, 80), phone: str(b?.contact?.phone, 40), taxId: str(b?.contact?.taxId, 20),
  }
  const docNo = str(b?.docNo, 20)
  try {
    const db = (await clientPromise).db(DB())
    const key = garageKey(name)
    const existing = await db.collection(PROVISIONAL_COLL).findOne({ key })
    if (!existing && !b?.force) {
      const similar = await similarNames(name)
      if (similar.length) return NextResponse.json({ error: "มีชื่อใกล้เคียงอยู่แล้ว", similar }, { status: 409 })
    }
    const now = toBkkIso(new Date())
    await db.collection(PROVISIONAL_COLL).updateOne(
      { key },
      {
        $set: { name, ...(kind ? { kind } : {}), contact, updatedAt: now, updatedBy: user.name },
        $setOnInsert: { key, createdAt: now, createdBy: user.name, createdByEmail: user.email, atmsId: null },
        ...(docNo ? { $addToSet: { docNos: docNo } } : {}),
      },
      { upsert: true },
    )
    return NextResponse.json({ ok: true, name, kind, contact, reused: !!existing }, { status: existing ? 200 : 201 })
  } catch (e) {
    console.error("[vendors/provisional] POST", e)
    return NextResponse.json({ error: "บันทึกชื่อชั่วคราวไม่สำเร็จ" }, { status: 500 })
  }
}

// PATCH { name, atmsId } — ผูกชื่อชั่วคราวกับซัพพลายเออร์ตัวจริงใน atms.supplier_master
// คืนชื่อมาตรฐานจาก ATMS กลับไปให้ฝั่งเรียกเขียนทับชื่อในใบ (ชื่อสะกดเดียวกับที่ ATMS/AP ใช้)
export async function PATCH(req: NextRequest) {
  const user = await me()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const name = str(b?.name)
  const atmsId = Number(b?.atmsId)
  if (!name) return NextResponse.json({ error: "ต้องระบุชื่อชั่วคราว" }, { status: 400 })
  if (!Number.isInteger(atmsId) || atmsId <= 0) return NextResponse.json({ error: "atmsId ไม่ถูกต้อง" }, { status: 400 })
  try {
    const target = (await getAtmsGarages()).find((g) => g.atmsId === atmsId)
    if (!target) return NextResponse.json({ error: "ไม่พบซัพพลายเออร์รายนี้ใน ATMS" }, { status: 404 })
    const db = (await clientPromise).db(DB())
    const now = toBkkIso(new Date())
    await db.collection(PROVISIONAL_COLL).updateOne(
      { key: garageKey(name) },
      {
        $set: { atmsId, atmsName: target.name, linkedBy: user.name, linkedByEmail: user.email, linkedAt: now, updatedAt: now },
        $setOnInsert: { key: garageKey(name), name, createdAt: now, createdBy: user.name, contact: {} },
      },
      { upsert: true },
    )
    return NextResponse.json({ ok: true, atmsId, atmsName: target.name, type: target.type })
  } catch (e) {
    console.error("[vendors/provisional] PATCH", e)
    return NextResponse.json({ error: "ผูกทะเบียนไม่สำเร็จ" }, { status: 500 })
  }
}
