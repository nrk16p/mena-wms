// อู่อัปโหลดเทมเพลตที่กรอกแล้ว — ไม่มี session · token คือสิทธิ์ · ส่งครั้งแรก = ขอสรุป, ส่งพร้อม confirm=1 = บันทึกจริง
import { NextRequest, NextResponse } from "next/server"
import { bkkToday } from "@/lib/bkk-time"
import { getInviteByToken, httpError } from "@/lib/rfq"
import { canVendorWrite } from "@/lib/rfq-core"
import { runImport } from "@/lib/rfq-import-file"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const inv = await getInviteByToken(token)
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (!canVendorWrite(inv, bkkToday())) return NextResponse.json({ error: "ลิงก์นี้ปิดรับแล้ว" }, { status: 409 })
  if (!inv.contact) return NextResponse.json({ error: "กรุณากรอกข้อมูลผู้ติดต่อก่อน" }, { status: 409 })
  try {
    const r = await runImport(inv, await req.formData(), { name: `${inv.contact.name} (อู่ ผ่านลิงก์)`, email: inv.contact.email })
    return "error" in r ? NextResponse.json({ error: r.error }, { status: r.status }) : NextResponse.json(r.body)
  } catch (e) { const { status, error } = httpError(e); if (status === 500) console.error("[q] import", e); return NextResponse.json({ error }, { status }) }
}
