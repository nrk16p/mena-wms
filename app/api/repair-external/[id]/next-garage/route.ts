import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import clientPromise from "@/lib/mongo"
import { fetchOpenJobsFresh, normKey } from "@/lib/atms-board"
import { garageKey } from "@/lib/atms-garage"
import { followNextGarages } from "@/lib/garage-mapping"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"
type Params = { params: Promise<{ id: string }> }

// GET /api/repair-external/[id]/next-garage[?apply=1] — อู่ปัจจุบันใน Mena-Next ของใบงานนี้ (open-jobs สด)
// เรียกตอนคนเปิดใบงาน (apply=1: ต่างกัน → ปรับ WMS ตาม Mena-Next ทันที ตามกติกาเดียวกับรอบ sync)
// และตอนก่อนบันทึก (ไม่ apply: แค่ดูว่าระหว่างเปิดฟอร์ม Mena-Next เปลี่ยนไปหรือยัง)
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 })
  const db  = (await clientPromise).db(DB)
  const doc = await db.collection(COLL).findOne({ _id: new ObjectId(id) })
  if (!doc) return NextResponse.json({ ok: false, error: "ไม่พบรายการ" }, { status: 404 })
  if (!String(doc.mrNo ?? "").trim()) return NextResponse.json({ ok: true, found: false })

  let job
  try {
    job = (await fetchOpenJobsFresh()).find((j) => normKey(j.mrCode) === normKey(doc.mrNo))
  } catch (e) {
    return NextResponse.json({ ok: false, error: `อ่าน Mena-Next ไม่สำเร็จ: ${e instanceof Error ? e.message : e}` }, { status: 502 })
  }
  if (!job?.vendor) return NextResponse.json({ ok: true, found: false })

  const same = garageKey(job.vendor) === garageKey(doc.garage)
  let applied = false
  if (!same && req.nextUrl.searchParams.get("apply") === "1") {
    const done = await followNextGarages(db, [{
      id: doc._id, plate: String(doc.plate ?? ""), fleetNo: String(doc.fleetNo ?? ""),
      garage: (doc.garage as string | undefined) ?? null, garageAtmsId: doc.garageAtmsId,
      nextPushAt: doc.nextPushAt ?? null, nextPushFrom: doc.nextPushFrom ?? null, garageSyncHold: doc.garageSyncHold, vendor: job.vendor,
    }])
    applied = done.length > 0
  }
  const now = applied ? await db.collection(COLL).findOne({ _id: doc._id }, { projection: { garage: 1, garageAtmsId: 1 } }) : doc
  return NextResponse.json({
    ok: true, found: true, nextVendor: job.vendor, same, applied,
    garage: String(now?.garage ?? ""), garageAtmsId: Number(now?.garageAtmsId) || null,
    held: !!doc.garageSyncHold,
  })
}
