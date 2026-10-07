import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { fetchOpenJobsFresh, moveNextGarage, normKey } from "@/lib/atms-board"
import { garageKey, getAtmsGarages } from "@/lib/atms-garage"
import { writeRepairLog } from "@/lib/repair-log"
import { API_KEY_ACTOR, hasGarageSyncApiKey } from "@/lib/garage-sync-run"
import { PUSH_MAX, recentGarageChanges } from "@/lib/garage-mapping"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"
type Params = { params: Promise<{ id: string }> }

// POST /api/repair-external/[id]/push-next-garage — ส่งอู่ของใบงานนี้ไป Mena-Next (จับคู่ด้วย MR)
// ใช้ endpoint เดียวกับปุ่มแก้อู่ในหน้าเว็บ Mena-Next (moveNextGarage) → open-jobs / หน้า Pending Maintenance เปลี่ยนทันที
// อ่านค่าสดก่อนยิง — อู่ตรงกันอยู่แล้ว = ไม่ยิง · ส่งไม่ได้ = WMS คงอู่ที่คนแก้ไว้ (ไม่ถูกปรับกลับ)
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 })
  // ผู้ใช้ที่ login (กดจากฟอร์ม) หรือระบบภายนอกที่ส่ง x-api-key = ATMS_API_KEY
  const viaKey  = hasGarageSyncApiKey(req)
  const session = viaKey ? null : await getServerSession(authOptions)
  const email   = session?.user?.email ?? ""
  if (!viaKey && !email) return NextResponse.json({ ok: false, error: "กรุณาเข้าสู่ระบบ" }, { status: 401 })
  const by = viaKey ? API_KEY_ACTOR : (session?.user?.name || email)

  const db  = (await clientPromise).db(DB)
  const doc = await db.collection(COLL).findOne({ _id: new ObjectId(id) })
  if (!doc) return NextResponse.json({ ok: false, error: "ไม่พบรายการ" }, { status: 404 })
  const garage = String(doc.garage ?? "").trim()
  if (!garage || !Number(doc.garageAtmsId)) return NextResponse.json({ ok: false, error: "อู่ในใบงานนี้ยังไม่ผูกกับ ATMS — เลือกอู่จากรายการ ATMS ก่อน" }, { status: 400 })
  if (!String(doc.mrNo ?? "").trim()) return NextResponse.json({ ok: false, error: "ใบงานนี้ยังไม่มีเลข MR — จับคู่กับ Mena-Next ไม่ได้" }, { status: 400 })

  // กันยิงไป Mena-Next รัว ๆ — ไม่เกิน PUSH_MAX ครั้ง / ใบ / ชม.
  if (await recentGarageChanges(db, id, { field: "nextGarage" }) >= PUSH_MAX) {
    return NextResponse.json({ ok: false, error: `ใบนี้ส่งอู่ไป Mena-Next ครบ ${PUSH_MAX} ครั้งใน 1 ชม. แล้ว — รอสักพักแล้วลองใหม่ (กันแก้ไปมาเกิน)` }, { status: 429 })
  }

  // ส่งไม่ได้ → คงอู่ WMS + จำอู่ที่ Mena-Next แสดงอยู่ (followNextGarages จะไม่ดึงอู่นั้นกลับมาทับ จนกว่า Mena-Next เปลี่ยนเป็นอู่อื่น)
  const keep = async (shown: string, error: string) => {
    await db.collection(COLL).updateOne({ _id: doc._id }, { $set: { nextPushAt: new Date(), nextPushFrom: shown } })
    return NextResponse.json({ ok: false, kept: true, error: `${error} · อู่ใน WMS คงไว้ตามที่แก้ (ไม่ถูกปรับกลับ)` }, { status: 409 })
  }

  let job
  try {
    job = (await fetchOpenJobsFresh()).find((j) => normKey(j.mrCode) === normKey(doc.mrNo))
  } catch (e) {
    return keep("", `อ่านข้อมูล Mena-Next ไม่สำเร็จ (${e instanceof Error ? e.message : e})`)
  }
  if (!job?.mrId) return keep("", `Mena-Next ไม่มีงานอู่นอกที่เปิดอยู่ของ MR ${doc.mrNo}`)
  if (garageKey(job.vendor) === garageKey(garage)) {
    return NextResponse.json({ ok: true, skipped: true, message: "อู่ใน Mena-Next ตรงกันอยู่แล้ว" })
  }

  // ส่งชื่อดิบตาม ATMS (ช่องว่างตรงตัว) ให้เหมือนที่หน้าเว็บ Mena-Next เลือกจากรายชื่อซัพพลายเออร์
  const raw = (await getAtmsGarages().catch(() => [])).find((g) => g.atmsId === Number(doc.garageAtmsId))?.rawName || garage
  try {
    await moveNextGarage(job.mrId, raw)
  } catch (e) {
    return keep(job.vendor, `ส่งอู่ไป Mena-Next ไม่สำเร็จ — ${e instanceof Error ? e.message : e}`)
  }
  await db.collection(COLL).updateOne({ _id: doc._id }, { $set: { nextPushAt: new Date(), nextPushFrom: job.vendor } })
  await writeRepairLog(db, {
    repairId: id,
    plate: String(doc.plate ?? ""), fleetNo: String(doc.fleetNo ?? ""),
    action: "update",
    by, byEmail: email, at: new Date(),
    changes: [{ field: "nextGarage", label: "อู่ใน Mena-Next", from: job.vendor || "-", to: garage }],
  })
  return NextResponse.json({ ok: true, mrId: job.mrId, from: job.vendor, to: garage })
}
