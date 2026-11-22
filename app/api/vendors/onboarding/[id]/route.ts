// GET /api/vendors/onboarding/:id — รายละเอียดใบ + บทบาท + เงื่อนไขส่งรีวิว + ลิงก์ส่งเอกสารเพิ่มที่ยังใช้ได้
import { NextResponse, type NextRequest } from "next/server"
import { guard, publicOrigin } from "@/lib/vendor-onboarding/http"
import { requireSession } from "@/lib/vendor-onboarding/roles"
import { getApplication } from "@/lib/vendor-onboarding/admin"

export const dynamic = "force-dynamic"
type Ctx = { params: Promise<{ id: string }> }

export function GET(req: NextRequest, { params }: Ctx) {
  return guard(async () => {
    const session = await requireSession()
    const { id } = await params
    return NextResponse.json(await getApplication(id, session, publicOrigin(req)))
  })
}
