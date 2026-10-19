// app/api/vendors/coverage/route.ts — สรุปอู่รายจังหวัดเทียบจำนวนรถ (หน้า /vendors/coverage)
import { NextResponse } from "next/server"
import { getCoverage } from "@/lib/garage-coverage"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return NextResponse.json(await getCoverage())
  } catch (e) {
    console.error("[vendors/coverage] ", e)
    return NextResponse.json({ error: "สรุปข้อมูลอู่ไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
