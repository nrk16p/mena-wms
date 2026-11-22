// GET /api/form-vendor/link/:token — ลิงก์ส่งเอกสารเพิ่ม: ใบไหน ขออะไร หมดอายุหรือยัง (public · token คือสิทธิ์)
import { NextResponse, type NextRequest } from "next/server"
import { clientIp, guard, rateLimit } from "@/lib/vendor-onboarding/http"
import { getLinkView } from "@/lib/vendor-onboarding/public"

export const dynamic = "force-dynamic"
type Ctx = { params: Promise<{ token: string }> }

export function GET(req: NextRequest, { params }: Ctx) {
  return guard(async () => {
    rateLimit("link", clientIp(req), 60, 10 * 60_000)
    const { token } = await params
    return NextResponse.json(await getLinkView(token))
  })
}
