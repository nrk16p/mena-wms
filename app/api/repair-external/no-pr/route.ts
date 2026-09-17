import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { DONE_STATUSES, JOB_TYPE_GARAGE, JOB_TYPE_PARTS } from "@/lib/repair-external"
import { loadNoPrRows } from "@/lib/repair-nopr-db"

const DB = process.env.MONGO_DB ?? "master_data"

// GET /api/repair-external/no-pr?type=อู่นอก|อะไหล่ลงคัน
// งานที่ยังไม่ปิดและยังไม่มี PR + noPrSince (วันที่ PR ถูกลบครั้งล่าสุด) — สำหรับคัดลอกส่งไลน์รายคนสร้าง
// ขอบเขตเดียวกับ noPrByCreator ใน stats (scope=active) ตัวเลขใน dropdown กับข้อความจึงตรงกัน
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type")?.trim() ?? ""
  const match: Record<string, unknown> = { status: { $nin: DONE_STATUSES } }
  if (type === JOB_TYPE_PARTS)       match.jobType = JOB_TYPE_PARTS
  else if (type === JOB_TYPE_GARAGE) match.jobType = { $ne: JOB_TYPE_PARTS }
  const db = (await clientPromise).db(DB)
  return NextResponse.json(await loadNoPrRows(db, match))
}
