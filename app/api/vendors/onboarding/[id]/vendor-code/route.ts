// PATCH /api/vendors/onboarding/:id/vendor-code {vendorCode} — จัดซื้อใส่รหัส vendor ใน ATMS หลังอนุมัติ
import { NextResponse, type NextRequest } from "next/server"
import { guard, readJson } from "@/lib/vendor-onboarding/http"
import { requireSession } from "@/lib/vendor-onboarding/roles"
import { patchVendorCode } from "@/lib/vendor-onboarding/admin"

export const dynamic = "force-dynamic"
type Ctx = { params: Promise<{ id: string }> }

export function PATCH(req: NextRequest, { params }: Ctx) {
  return guard(async () => {
    const session = await requireSession()
    const { id } = await params
    return NextResponse.json({ doc: await patchVendorCode(id, await readJson(req), session) })
  })
}
