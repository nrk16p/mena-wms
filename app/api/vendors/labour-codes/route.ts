// app/api/vendors/labour-codes/route.ts
// รหัสค่าแรง → ประเภทงานซ่อม — master ที่ปลดล็อกกลุ่ม "ค่าแรง" เปล่า ๆ
// ซึ่งกินยอดราว 55% แต่ต้นทางไม่ได้บอกว่าเป็นงานระบบไหน
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isAdmin } from "@/lib/roles"
import { listLabourCodes, setLabourCode } from "@/lib/vendor"
import { SERVICE_TYPES, type ServiceType } from "@/lib/vendor-core"

export const dynamic = "force-dynamic"

const VALID_TYPE = new Set<string>(SERVICE_TYPES)

export async function GET() {
  try {
    return NextResponse.json({ items: await listLabourCodes() })
  } catch (e) {
    console.error("[vendors/labour-codes] GET", e)
    return NextResponse.json({ error: "ดึงรายการไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    const email = session?.user?.email ?? ""
    if (!isAdmin(email)) {
      return NextResponse.json({ error: "ต้องเป็นแอดมินจึงจะตั้งประเภทงานได้" }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const code = String(body.code ?? "").trim()
    const serviceType = String(body.serviceType ?? "").trim()
    if (!code) return NextResponse.json({ error: "ไม่พบรหัสค่าแรง" }, { status: 400 })
    if (serviceType !== "" && !VALID_TYPE.has(serviceType)) {
      return NextResponse.json({ error: `ประเภทงานไม่ถูกต้อง: ${serviceType}` }, { status: 400 })
    }

    await setLabourCode(code, serviceType as ServiceType | "", session?.user?.name || email)
    return NextResponse.json({ ok: true, code, serviceType })
  } catch (e) {
    console.error("[vendors/labour-codes] PATCH", e)
    return NextResponse.json({ error: "บันทึกไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
