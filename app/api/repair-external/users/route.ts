import { NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { REPAIR_LOG_COLL } from "@/lib/repair-log"

const DB = process.env.MONGO_DB ?? "master_data"

// GET /api/repair-external/users → รายชื่อผู้ใช้สำหรับ dropdown ตัวกรอง
// ดึงจาก log collection: สร้างโดย = action "create", แก้ไขโดย = action "update"
export async function GET() {
  const client = await clientPromise
  const log    = client.db(DB).collection(REPAIR_LOG_COLL)
  const [createdBy, editedBy] = await Promise.all([
    log.distinct("by", { action: "create" }),
    log.distinct("by", { action: "update" }),
  ])
  const clean = (a: unknown[]) =>
    a.map((x) => String(x ?? "").trim()).filter(Boolean).sort((x, y) => x.localeCompare(y, "th"))
  return NextResponse.json({ createdBy: clean(createdBy), editedBy: clean(editedBy) })
}
