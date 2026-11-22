// PATCH /api/vendors/onboarding/:id/scores {scores:[{key, value:"pass"|"fail"|null, note?}]} — จัดซื้อให้คะแนน (สถานะกำลังตรวจ)
import { NextResponse, type NextRequest } from "next/server"
import { guard, readJson } from "@/lib/vendor-onboarding/http"
import { requireSession } from "@/lib/vendor-onboarding/roles"
import { patchScores } from "@/lib/vendor-onboarding/admin"

export const dynamic = "force-dynamic"
type Ctx = { params: Promise<{ id: string }> }

export function PATCH(req: NextRequest, { params }: Ctx) {
  return guard(async () => {
    const session = await requireSession()
    const { id } = await params
    return NextResponse.json({ doc: await patchScores(id, await readJson(req), session) })
  })
}
