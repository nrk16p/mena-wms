// GET /api/sku-convert/export — แปลงรหัส ATMS: ทุกแถวทุกคลังทุกประเภท สำหรับทำไฟล์ Excel
// → { rows: ConvertExportRow[], asOf }
//
// แยกจาก GET /api/sku-convert เพราะหน้ารายการจำกัดหน้าละไม่เกิน 200 แถวและบังคับ wh+kind
// (ผู้ใช้สั่ง 13/10/2026: ไฟล์ Excel เอาทั้งหมดในไฟล์เดียว ไม่สนตัวกรองบนหน้า)
// ส่งเฉพาะคอลัมน์ที่ไฟล์ใช้ — ไม่ลาก lots/suppliers/entries/suggest ที่เป็นก้อนใหญ่ของแต่ละรหัส
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { exportItems } from "@/lib/sku-convert-db"

const DB = process.env.MONGO_DB ?? "master_data"
export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const db = (await clientPromise).db(DB)
  const rows = await exportItems(db)
  return NextResponse.json({ rows, asOf: new Date().toISOString() })
}
