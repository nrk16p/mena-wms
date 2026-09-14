import { NextRequest, NextResponse } from "next/server"
import { rebuildTireDistance } from "@/lib/tire-distance"

// คำนวณ "ยางถึงกำหนดเปลี่ยน" ใหม่โดยไม่ต้อง sync ATMS ก่อน
// รอบปกติพ่วงอยู่ท้าย /api/cron/tire-sync (02:00) แล้ว — เส้นนี้ไว้รันซ้ำเองตอนที่
// รอบกลางคืนดึง GPS ไม่ครบ หรือหลังแก้ระยะกำหนดที่ /tire/master แล้วอยากเห็นผลทันที
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const result = await rebuildTireDistance()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
