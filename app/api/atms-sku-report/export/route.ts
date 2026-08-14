import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB = process.env.MONGO_DB ?? "master_data"

// รายชื่อ SKU ใหม่ต่อ 1 เดือน มากที่สุดเท่านี้ — เดือนที่หนักที่สุดในประวัติยังไม่ถึงหลักพัน
// เพดานนี้จึงไม่ตัดของจริงในทางปฏิบัติ แต่กันไฟล์ระเบิดถ้าข้อมูลผิดรูปหรือ month ซ้ำกันทั้ง collection
const MAX_ROWS = 5000

// GET /api/atms-sku-report/export?month=YYYY-MM&warehouse=<name>[,<name>...]
// รายการรหัสสินค้าใหม่ของเดือนนั้น สำหรับให้หน้าเว็บสร้างไฟล์ Excel
// (คิวรีเบากว่าหน้ารายงานที่ยิง $group ทั้ง collection 4 ชุดทุกครั้งที่เปิดอยู่แล้ว)
export async function GET(req: NextRequest) {
  try {
    const month = (req.nextUrl.searchParams.get("month") ?? "").trim()
    // ต้องเป็นเดือนจริง — ไม่ปล่อยค่าที่ผู้ใช้ส่งมาลงไปเป็นเงื่อนไขคิวรีดิบ ๆ
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ error: "ต้องระบุเดือนในรูปแบบ YYYY-MM" }, { status: 400 })
    }
    const selected = (req.nextUrl.searchParams.get("warehouse") ?? "").split(",").map((s) => s.trim()).filter(Boolean)

    const match: Record<string, unknown> = { month }
    if (selected.length) match.warehouse = { $in: selected }

    const client = await clientPromise
    const rows = await client.db(DB).collection("atms_sku_add_events")
      .find(match, {
        projection: { _id: 0, skuPk: 1, code: 1, name: 1, group: 1, warehouse: 1, username: 1, addedAt: 1, addedAtText: 1 },
      })
      .sort({ addedAt: -1 })
      .limit(MAX_ROWS)
      .toArray()

    // truncated = ชนเพดานพอดี → อาจมีของที่ไม่ได้ส่งมา ต้องบอกผู้ใช้ ไม่ใช่เงียบแล้วให้เข้าใจว่าครบ
    return NextResponse.json({ rows, truncated: rows.length >= MAX_ROWS, limit: MAX_ROWS })
  } catch (e) {
    console.error("[atms-sku-report/export] failed", e)
    return NextResponse.json({ error: "ดึงข้อมูลไม่สำเร็จ" }, { status: 500 })
  }
}
