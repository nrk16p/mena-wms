// app/api/safety-stock/sku/route.ts
// รายละเอียดรายรหัสที่ payload รายการไม่ได้ส่งมาด้วย — ตอนนี้คือ "ประวัติรับเข้า" (ดู receipts ใน SnapshotRow)
//
// ทำไมต้องแยก endpoint: ประวัติรับเข้าเก็บได้ถึง 20 ครั้ง/รหัส ถ้าส่งไปกับรายการทุกแถว (ลาดกระบัง ~4,100 แถว)
// payload จะทะลุเพดาน response 4.5 MB ของ Vercel — คนเปิดดูทีละรหัสอยู่แล้ว ดึงตอนเปิดหน้าต่างจึงพอ
//
// ราคาที่จ่ายต่อการเปิดหนึ่งครั้ง: findOne บน safety_stock_snapshot ด้วย index {inventoryId, code} ที่ build
// สร้างไว้อยู่แล้ว = อ่าน 1 doc · ไม่แตะ stockmovement_v5 เลย (ประวัติถูก build เก็บไว้ในแถวแล้ว)
import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { INVENTORY_ID, type ReceiptEntry } from "@/lib/safety-stock-core"

export const dynamic = "force-dynamic"

const DB = process.env.MONGO_DB ?? "master_data"

export async function GET(req: NextRequest) {
  try {
    const code = (req.nextUrl.searchParams.get("code") ?? "").trim()
    const inventoryId = req.nextUrl.searchParams.get("inventory") ?? INVENTORY_ID
    if (!code) return NextResponse.json({ error: "ต้องระบุ code" }, { status: 400 })

    const client = await clientPromise
    const doc = await client
      .db(DB)
      .collection("safety_stock_snapshot")
      .findOne({ inventoryId, code }, { projection: { _id: 0, code: 1, receipts: 1 }, maxTimeMS: 10_000 })

    // ไม่เจอแถว หรือเจอแต่ไม่มีประวัติ — ตอบเหมือนกันคือรายการว่าง ไม่ใช่ 404
    // (แถวที่ build ไว้ก่อนมีฟีเจอร์นี้ก็ไม่มีฟิลด์ receipts ฝั่งหน้าเว็บต้องแสดงผลได้ตามปกติ)
    const receipts = (doc?.receipts as ReceiptEntry[] | undefined) ?? []
    return NextResponse.json({ code, inventoryId, receipts })
  } catch (e) {
    console.error("[safety-stock/sku] ", e)
    return NextResponse.json({ error: "ดึงประวัติรับเข้าไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
