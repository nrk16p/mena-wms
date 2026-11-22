// POST /api/form-vendor — ส่งใบสมัคร vendor ใหม่ (public ไม่ต้อง login) → datawarehouse.vendor_registration (schemaVersion 2)
// ตรรกะอยู่ที่ lib/vendor-onboarding/public.ts · LIFF idToken ส่งมาก็ยืนยันเก็บ lineId ไม่ส่งก็ได้
import { NextResponse, type NextRequest } from "next/server"
import { clientIp, guard, rateLimit, readJson } from "@/lib/vendor-onboarding/http"
import { submitApplication } from "@/lib/vendor-onboarding/public"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest) {
  return guard(async () => {
    const ip = clientIp(req)
    rateLimit("submit", ip, 15, 10 * 60_000) // นับรวมรอบที่กรอกผิดแล้วแก้ จึงเผื่อมากกว่าฟอร์มเดิม
    const body = await readJson(req)
    const r = await submitApplication(body, { ip, userAgent: req.headers.get("user-agent") })
    return NextResponse.json(r, { status: 201 })
  })
}
