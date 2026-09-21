// จัดซื้ออัปโหลดเทมเพลตแทนอู่ (อู่ส่งไฟล์มาทางไลน์/อีเมล) — log บันทึกชื่อเจ้าหน้าที่ที่อัปโหลด
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getInvite, httpError } from "@/lib/rfq"
import { runImport } from "@/lib/rfq-import-file"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const inv = await getInvite(id)
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 })
  try {
    const by = { name: `${s.user.name || s.user.email || "จัดซื้อ"} (จัดซื้ออัปโหลดแทน)`, email: s.user.email || "" }
    const r = await runImport(inv, await req.formData(), by)
    return "error" in r ? NextResponse.json({ error: r.error }, { status: r.status }) : NextResponse.json(r.body)
  } catch (e) { const { status, error } = httpError(e); if (status === 500) console.error("[rfq] import", e); return NextResponse.json({ error }, { status }) }
}
