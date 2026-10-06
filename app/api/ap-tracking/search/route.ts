// app/api/ap-tracking/search/route.ts
// ค้นข้ามเดือนทั้งฐาน — ใช้ตอนช่องค้นหาหลัก (ซึ่งค้นเฉพาะเดือนที่เปิดอยู่) หาไม่เจอ
// คืนแค่ "ใบไหน อยู่เดือนไหน" พอให้กดกระโดดไป ไม่ใช่ข้อมูลเต็มแถว (เดือนปลายทางโหลดเองอยู่แล้ว)
//
// ค้นในหน่วยความจำจากภาพรวมที่แคชไว้ (lib/ap-search-db.ts) แทน regex collscan 4–5 คิวรีต่อการพิมพ์หนึ่งครั้ง
// กติกาการจับคู่/เพดาน/ลำดับเหมือนคิวรีเดิมทุกตัวอักษร — ดู lib/ap-search-index.ts
import { NextRequest, NextResponse } from "next/server"
import { AP_SEARCH_MIN_Q, searchApIndex } from "@/lib/ap-search-index"
import { getApSearchIndex } from "@/lib/ap-search-db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  // สั้นกว่า 3 ตัวอักษร = กว้างเกินกว่าจะมีความหมาย — ตอบทันทีโดยไม่โหลดภาพรวม
  if (q.length < AP_SEARCH_MIN_Q) return NextResponse.json({ hits: [] })
  return NextResponse.json(searchApIndex(await getApSearchIndex(), q))
}
