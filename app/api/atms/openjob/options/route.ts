import { NextResponse } from "next/server"
import { ncacWithSession } from "@/lib/atms-cookie"

export const dynamic = "force-dynamic"

// GET /api/atms/openjob/options — ค่า dropdown จริงจาก ATMS (อ่านอย่างเดียว ไม่สร้าง job)
// คืน { branch_id: {...}, maintenance_type_id: {...}, "tire_positions[]": {...}, ... }
// PHPSESSID มาจาก cookie ของผู้ใช้ที่ login อยู่ (ผูกกับ google_id) — ดูใน lib/atms-cookie
export async function GET() {
  try {
    const res = await ncacWithSession("/atms/openjob/options")
    if (res.ok) return NextResponse.json(res.data)

    // frontend จะ fallback เป็นค่าเริ่มต้นที่ฝังไว้
    return NextResponse.json(
      {
        error: res.expired ? "atms_session_expired" : "options_failed",
        hint: res.expired ? "PHPSESSID หมดอายุ — อัปเดต cookie ของ google_id นี้ที่ /user/atms-cookie แล้วลองใหม่" : undefined,
        hasUserCookie: res.hasUserCookie,
        detail: res.data,
      },
      { status: res.status },
    )
  } catch (e) {
    return NextResponse.json({ error: "options_error", detail: String(e) }, { status: 502 })
  }
}
