import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { REPAIR_LOG_COLL } from "@/lib/repair-log"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"
type Params = { params: Promise<{ id: string }> }

// POST /api/repair-external/[id]/check
// ยืนยันว่า "วันนี้ตรวจเช็คสถานะรายการนี้แล้ว" — จดเวลา+ผู้เช็ค และลงประวัติ
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const by      = session?.user?.name || session?.user?.email || ""
  const byEmail = session?.user?.email || ""

  const client = await clientPromise
  const db     = client.db(DB)
  const _id    = new ObjectId(id)
  const doc    = await db.collection(COLL).findOne({ _id }, { projection: { plate: 1, fleetNo: 1 } })
  if (!doc) return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 })

  const now = new Date()
  // วันแบบเวลาไทย (+7) — ให้ตรงกับความรู้สึก "วันนี้" ของผู้ใช้
  const dateBKK = new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)
  await db.collection(COLL).updateOne(
    { _id },
    { $set: { lastCheckedAt: now.toISOString(), lastCheckedBy: by, lastCheckedByEmail: byEmail } },
  )
  // เก็บประวัติรายวันสำหรับปฏิทิน — วันละ 1 รายการ (กดซ้ำในวันเดิมไม่เพิ่ม)
  const pushed = await db.collection(COLL).updateOne(
    { _id, "dailyChecks.date": { $ne: dateBKK } },
    // เก็บย้อนหลังไม่เกิน 365 วัน — งานที่เปิดยาวจะได้ไม่บวมจนส่งกลับช้า
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { $push: { dailyChecks: { $each: [{ date: dateBKK, by, at: now.toISOString() }], $slice: -365 } } as any },
  )
  // ลง log เฉพาะการเช็คครั้งแรกของวัน — กดซ้ำ/retry ไม่ต้องเพิ่มแถวประวัติ
  if (pushed.modifiedCount > 0) await db.collection(REPAIR_LOG_COLL).insertOne({
    repairId: id, plate: doc.plate ?? "", fleetNo: doc.fleetNo ?? "",
    action: "update", by, byEmail, at: now,
    changes: [{
      field: "dailyCheck", label: "ตรวจเช็คประจำวัน", from: "",
      to: `ยืนยันแล้ว ${now.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
    }],
  })
  return NextResponse.json({ ok: true, lastCheckedAt: now.toISOString(), lastCheckedBy: by, date: dateBKK })
}
