// POST /api/form-vendor/uploads/presign {draftId, slot, name, size, contentType} → {key, url} (public)
// browser PUT ไฟล์ไปที่ url ด้วย Content-Type เดียวกัน แล้วส่ง key กลับมากับฟอร์ม
import { NextResponse, type NextRequest } from "next/server"
import { clientIp, guard, rateLimit, readJson } from "@/lib/vendor-onboarding/http"
import { presignDraft } from "@/lib/vendor-onboarding/public"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest) {
  return guard(async () => {
    rateLimit("presign", clientIp(req), 120, 10 * 60_000)
    return NextResponse.json(await presignDraft(await readJson(req)))
  })
}
