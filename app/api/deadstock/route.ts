// app/api/deadstock/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getDeadstock } from "@/lib/deadstock"

export const dynamic = "force-dynamic" // cache จัดการเองใน lib (TTL 1 ชม.) ไม่พึ่ง route cache

export async function GET(req: NextRequest) {
  try {
    const data = await getDeadstock(req.nextUrl.searchParams.get("refresh") === "1")
    return NextResponse.json(data)
  } catch (e) {
    console.error("[deadstock] ", e)
    return NextResponse.json({ error: "ดึงข้อมูลไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
