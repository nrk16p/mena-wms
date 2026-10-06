import { NextResponse } from "next/server"
import { currentGoogleId, ncacWithSession } from "@/lib/atms-cookie"
import { sharedCache } from "@/lib/shared-cache"
import { cachedIf } from "@/lib/cache-if"

export const dynamic = "force-dynamic"

const HOUR = 3600_000

// GET /api/atms/openjob/options — ค่า dropdown จริงจาก ATMS (อ่านอย่างเดียว ไม่สร้าง job)
// คืน { branch_id: {...}, maintenance_type_id: {...}, "tire_positions[]": {...}, ... }
// PHPSESSID มาจาก cookie ของผู้ใช้ที่ login อยู่ (ผูกกับ google_id) — ดูใน lib/atms-cookie
// แคชแยกตามผู้ใช้: ATMS ขูดฟอร์มด้วย session ของแต่ละคน (api-ncac แคชแยกต่อ PHPSESSID) — สิทธิ์สาขาอาจไม่เท่ากัน
// แคชเฉพาะผลที่สำเร็จ · error (401 session หมดอายุ ฯลฯ) ยิงสดทุกครั้งเหมือนเดิม
export async function GET() {
  try {
    const googleId = await currentGoogleId()
    const res = await cachedIf(sharedCache, {
      key: `atms-openjob-options:${googleId}`,
      load: () => ncacWithSession("/atms/openjob/options", googleId),
      keep: (r) => r.ok,
      freshMs: HOUR,
      maxStaleMs: 24 * HOUR,
    })
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
