// POST /api/form-vendor/link/:token/presign {slot, name, size, contentType} → {key, url} (public · token คือสิทธิ์)
import { NextResponse, type NextRequest } from "next/server"
import { clientIp, guard, rateLimit, readJson } from "@/lib/vendor-onboarding/http"
import { presignLink } from "@/lib/vendor-onboarding/public"

export const dynamic = "force-dynamic"
type Ctx = { params: Promise<{ token: string }> }

export function POST(req: NextRequest, { params }: Ctx) {
  return guard(async () => {
    rateLimit("link-presign", clientIp(req), 120, 10 * 60_000)
    const { token } = await params
    return NextResponse.json(await presignLink(token, await readJson(req)))
  })
}
