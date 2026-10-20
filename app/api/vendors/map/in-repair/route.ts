// app/api/vendors/map/in-repair/route.ts — รถที่ยังซ่อมไม่เสร็จ แยกตามอู่ (หน้า "หาอู่ใกล้ที่สุด")
import { NextResponse } from "next/server"
import { getCarsInRepair } from "@/lib/garage-in-repair"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return NextResponse.json({ cars: await getCarsInRepair() })
  } catch (e) {
    console.error("[vendors/map/in-repair] ", e)
    return NextResponse.json({ error: "โหลดรถที่ซ่อมอยู่ไม่สำเร็จ" }, { status: 500 })
  }
}
