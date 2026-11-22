// PATCH /api/vendors/onboarding/:id/documents {slot, status:"passed"|"redo"|"waiting", note?} — จัดซื้อตรวจเอกสาร (สถานะกำลังตรวจ)
import { NextResponse, type NextRequest } from "next/server"
import { guard, readJson } from "@/lib/vendor-onboarding/http"
import { requireSession } from "@/lib/vendor-onboarding/roles"
import { patchDocument } from "@/lib/vendor-onboarding/admin"

export const dynamic = "force-dynamic"
type Ctx = { params: Promise<{ id: string }> }

export function PATCH(req: NextRequest, { params }: Ctx) {
  return guard(async () => {
    const session = await requireSession()
    const { id } = await params
    return NextResponse.json({ doc: await patchDocument(id, await readJson(req), session) })
  })
}
