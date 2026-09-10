import { NextRequest, NextResponse } from "next/server"
import { submitInvite, httpError } from "@/lib/rfq"
export const dynamic = "force-dynamic"
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const body = await req.json().catch(() => ({}))
  if (body.acknowledgeBlank !== true) return NextResponse.json({ error: "กรุณายืนยันว่างานที่เว้นว่าง = ไม่เสนอราคา" }, { status: 400 })
  try {
    const inv = await submitInvite(token, String(body.submitNote ?? ""))
    return NextResponse.json({ ok: true, status: inv.status, submittedAt: inv.submittedAt })
  } catch (e) { const { status, error } = httpError(e); if (status === 500) console.error("[q] submit", e); return NextResponse.json({ error }, { status }) }
}
