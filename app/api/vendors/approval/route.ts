// app/api/vendors/approval/route.ts
// อนุมัติอู่รายประเภทงาน — แยกจาก /api/vendors เพราะตัวนั้น cache 1 ชม.
// การอนุมัติต้องเห็นผลทันทีที่กด จึงห้ามอยู่ในของที่ถูก cache
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isAdmin } from "@/lib/roles"
import { setVendorApproval } from "@/lib/vendor"
import { byCode } from "@/lib/repair-type-master"

export const dynamic = "force-dynamic"

const VALID_STATUS = new Set(["approved", "rejected", "pending"])

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    const email = session?.user?.email ?? ""
    // อนุมัติผู้ขายเป็นการตัดสินใจเชิงจัดซื้อ — คนทั่วไปดูได้ แต่แก้ไม่ได้
    if (!isAdmin(email)) {
      return NextResponse.json({ error: "ต้องเป็นแอดมินจึงจะอนุมัติอู่ได้" }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const vendor = String(body.vendor ?? "").trim()
    if (!vendor) return NextResponse.json({ error: "ไม่พบชื่ออู่" }, { status: 400 })

    const patch: Parameters<typeof setVendorApproval>[1] = {}

    if (body.status !== undefined) {
      const status = String(body.status).trim()
      if (!VALID_STATUS.has(status)) {
        return NextResponse.json({ error: `สถานะไม่ถูกต้อง: ${status}` }, { status: 400 })
      }
      patch.status = status as "approved" | "rejected" | "pending"
    }

    if (body.codes !== undefined) {
      if (!Array.isArray(body.codes)) {
        return NextResponse.json({ error: "codes ต้องเป็น array" }, { status: 400 })
      }
      const codes = [...new Set(body.codes.map((t: unknown) => String(t).trim().toUpperCase()))] as string[]
      const bad = codes.find((c) => !byCode(c))
      if (bad) return NextResponse.json({ error: `ไม่รู้จักรหัสประเภทการซ่อม: ${bad}` }, { status: 400 })
      patch.codes = codes
    }

    if (body.note !== undefined) patch.note = String(body.note).trim().slice(0, 500)

    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "ไม่มีอะไรให้บันทึก" }, { status: 400 })
    }

    await setVendorApproval(vendor, patch, session?.user?.name || email)
    return NextResponse.json({ ok: true, vendor, ...patch })
  } catch (e) {
    console.error("[vendors/approval] PATCH", e)
    return NextResponse.json({ error: "บันทึกไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
