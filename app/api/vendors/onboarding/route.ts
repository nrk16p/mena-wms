// GET /api/vendors/onboarding — รายการใบสมัคร vendor ใหม่ (รวมใบแบบเก่า) + จำนวนต่อสถานะ + บทบาทของผู้ใช้
import { NextResponse } from "next/server"
import { guard } from "@/lib/vendor-onboarding/http"
import { requireSession } from "@/lib/vendor-onboarding/roles"
import { listApplications } from "@/lib/vendor-onboarding/admin"

export const dynamic = "force-dynamic"

export function GET() {
  return guard(async () => NextResponse.json(await listApplications(await requireSession())))
}
