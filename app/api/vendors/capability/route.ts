// app/api/vendors/capability/route.ts
// ตารางติ๊ก "อู่ไหนทำงานประเภทไหนได้" — บันทึกทีละช่อง
// แยกจาก /api/vendors เพราะตัวนั้น cache 1 ชม. ส่วนติ๊กต้องเห็นผลทันที
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { setVendorCapability } from "@/lib/vendor"
import { byCode } from "@/lib/repair-type-master"

export const dynamic = "force-dynamic"

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    const email = session?.user?.email ?? ""
    // เปิดให้ทุกคนที่ล็อกอินติ๊กได้ (2026-09-02) — ความรู้ว่าอู่ไหนทำอะไรได้อยู่กับคนหน้างาน
    // ไม่ได้อยู่กับจัดซื้อคนเดียว · ที่กล้าเปิดเพราะทุกการติ๊กถูกบันทึกลง vendor_capability_log
    // ว่าใครทำเมื่อไหร่ ย้อนดูได้ทั้งหมด · ส่วน "สถานะอนุมัติ" ยังเป็นของแอดมินเหมือนเดิม
    if (!email) {
      return NextResponse.json({ error: "ต้องล็อกอินก่อนจึงจะแก้ตารางนี้ได้" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const vendor = String(body.vendor ?? "").trim()
    const code   = String(body.code ?? "").trim().toUpperCase()
    const on     = body.on === true

    if (!vendor) return NextResponse.json({ error: "ไม่พบชื่ออู่" }, { status: 400 })
    // รหัสต้องมีอยู่จริงในทะเบียนฝ่ายยานยนต์ ไม่งั้นข้อมูลจะเน่าเงียบ ๆ
    if (!byCode(code)) {
      return NextResponse.json({ error: `ไม่รู้จักรหัสประเภทการซ่อม: ${code}` }, { status: 400 })
    }

    await setVendorCapability(vendor, code, on, session?.user?.name || email, email)
    return NextResponse.json({ ok: true, vendor, code, on })
  } catch (e) {
    console.error("[vendors/capability] PATCH", e)
    return NextResponse.json({ error: "บันทึกไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
