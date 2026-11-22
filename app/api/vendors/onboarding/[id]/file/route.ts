// GET /api/vendors/onboarding/:id/file?key=… → 302 ไปลิงก์อ่านไฟล์อายุสั้น (key ต้องเป็นไฟล์ของใบนี้)
import { NextResponse, type NextRequest } from "next/server"
import { bad, guard } from "@/lib/vendor-onboarding/http"
import { requireSession } from "@/lib/vendor-onboarding/roles"
import { fileUrl } from "@/lib/vendor-onboarding/admin"

export const dynamic = "force-dynamic"
type Ctx = { params: Promise<{ id: string }> }

export function GET(req: NextRequest, { params }: Ctx) {
  return guard(async () => {
    await requireSession()
    const { id } = await params
    const key = req.nextUrl.searchParams.get("key")
    if (!key) throw bad("ไม่ได้ระบุไฟล์")
    const res = NextResponse.redirect(await fileUrl(id, key), 302)
    res.headers.set("Cache-Control", "no-store")
    return res
  })
}
