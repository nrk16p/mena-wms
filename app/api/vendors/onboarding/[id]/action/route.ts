// POST /api/vendors/onboarding/:id/action {action, note?, requestedSlots?} → {doc, linkUrl}
// บทบาทตาม ACTIONS (lib/vendor-onboarding/types.ts) · ผู้ทำรายการจาก session เท่านั้น
import { NextResponse, type NextRequest } from "next/server"
import { guard, publicOrigin, readJson } from "@/lib/vendor-onboarding/http"
import { requireSession } from "@/lib/vendor-onboarding/roles"
import { runAction } from "@/lib/vendor-onboarding/admin"

export const dynamic = "force-dynamic"
type Ctx = { params: Promise<{ id: string }> }

export function POST(req: NextRequest, { params }: Ctx) {
  return guard(async () => {
    const session = await requireSession()
    const { id } = await params
    return NextResponse.json(await runAction(id, await readJson(req), session, publicOrigin(req)))
  })
}
