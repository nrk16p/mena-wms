// GET /api/vendors/onboarding/settings — ค่าตั้ง (ทุกคนที่เห็นส่วน vendor)
// PUT {passThreshold 1..21, reviewerEmails[], approverEmails[], linkDays} — ผู้อนุมัติหรือ admin
import { NextResponse, type NextRequest } from "next/server"
import { guard, readJson } from "@/lib/vendor-onboarding/http"
import { requireSession } from "@/lib/vendor-onboarding/roles"
import { readSettings, writeSettings } from "@/lib/vendor-onboarding/admin"

export const dynamic = "force-dynamic"

export function GET() {
  return guard(async () => NextResponse.json(await readSettings(await requireSession())))
}

export function PUT(req: NextRequest) {
  return guard(async () => {
    const session = await requireSession()
    return NextResponse.json(await writeSettings(await readJson(req), session))
  })
}
