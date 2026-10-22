// app/api/garages/phone/route.ts
// GET /api/garages/phone?name=ชื่ออู่ — เบอร์โทรอู่ชุดเดียวกับหน้าหาอู่ (/vendors/map) ให้การ์ดหัวใบใน /repair-external
// (ผู้ใช้สั่ง 22/10/2569) · เบอร์มาจาก ATMS + ชีตทะเบียนอู่ยานยนต์ + หมุด My Maps ที่ getGarages รวมไว้แล้ว (cache 10 นาที)
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getGarages } from "@/lib/garage-map"
import { garageMatcher } from "@/lib/garage-in-repair"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const name = (req.nextUrl.searchParams.get("name") ?? "").trim().slice(0, 200)
  if (!name) return NextResponse.json({ matched: null, phone: "" })
  try {
    const hit = garageMatcher(await getGarages())(name)
    return NextResponse.json({ matched: hit?.name ?? null, phone: hit?.phone?.trim() ?? "" })
  } catch (e) {
    console.error("[garages/phone] GET", e)
    return NextResponse.json({ error: "โหลดเบอร์โทรอู่ไม่สำเร็จ" }, { status: 500 })
  }
}
