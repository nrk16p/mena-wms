// GET /api/sku-convert/export — แปลงรหัส ATMS: ทุกแถวทุกคลังทุกประเภท สำหรับทำไฟล์ Excel
// → { rows: ConvertExportRow[], entries: ConvertEntryExportRow[], asOf }
//   rows    = ชีต "รหัส ATMS" ทุกรหัส · entries = ชีต "SKU ใหม่" เฉพาะรหัสที่กรอกไว้แล้ว
//
// แยกจาก GET /api/sku-convert เพราะหน้ารายการจำกัดหน้าละไม่เกิน 200 แถวและบังคับ wh+kind
// (ผู้ใช้สั่ง 13/10/2026: ไฟล์ Excel เอาทั้งหมดในไฟล์เดียว ไม่สนตัวกรองบนหน้า)
// ส่งเฉพาะคอลัมน์ที่ไฟล์ใช้ — ไม่ลาก lots/suppliers/suggest ที่เป็นก้อนใหญ่ของแต่ละรหัส
// (entries ลากมาเฉพาะรหัสที่กรอกไว้แล้ว เพราะชีต "SKU ใหม่" คือตัว entries เอง)
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { exportEntries, exportItems, loadCodeBook } from "@/lib/sku-convert-db"
import { entryExportRows } from "@/lib/sku-convert-export"

const DB = process.env.MONGO_DB ?? "master_data"
export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const db = (await clientPromise).db(DB)
  // ยิงพร้อมกัน — สามคำถามนี้ไม่พึ่งผลของกัน และปุ่มเดียวบนหน้าต้องรอครบทั้งสามอยู่แล้ว
  const [rows, sources, book] = await Promise.all([exportItems(db), exportEntries(db), loadCodeBook(db)])
  return NextResponse.json({
    rows,
    entries: entryExportRows(sources, book),
    asOf: new Date().toISOString(),
  })
}
