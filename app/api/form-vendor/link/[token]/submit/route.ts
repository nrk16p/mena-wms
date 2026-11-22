// POST /api/form-vendor/link/:token/submit {documents:[{slot, files}]} → {ref} · ใบกลับไป "กำลังตรวจ" (public · token คือสิทธิ์)
import { NextResponse, type NextRequest } from "next/server"
import { clientIp, guard, rateLimit, readJson } from "@/lib/vendor-onboarding/http"
import { submitLink } from "@/lib/vendor-onboarding/public"

export const dynamic = "force-dynamic"
type Ctx = { params: Promise<{ token: string }> }

export function POST(req: NextRequest, { params }: Ctx) {
  return guard(async () => {
    rateLimit("link-submit", clientIp(req), 5, 10 * 60_000)
    const { token } = await params
    return NextResponse.json(await submitLink(token, await readJson(req)))
  })
}
