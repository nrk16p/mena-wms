// app/api/rfq/[id]/route.ts — อ่านใบเต็ม + การกระทำของจัดซื้อ
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { canApproveVendor } from "@/lib/roles"
import { getInvite, getCatalog, actOnInvite, httpError } from "@/lib/rfq"
import { jobsForInvite, partsForInvite } from "@/lib/rfq-core"

export const dynamic = "force-dynamic"
type Params = { params: Promise<{ id: string }> }
async function me() {
  const s = await getServerSession(authOptions)
  return s?.user ? { name: s.user.name || s.user.email || "", email: s.user.email || "" } : null
}

export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await me())) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const invite = await getInvite(id)
  if (!invite) return NextResponse.json({ error: "not found" }, { status: 404 })
  const cat = await getCatalog(invite.catalogVersion)
  return NextResponse.json({ invite, jobs: jobsForInvite(invite, cat.jobs), parts: partsForInvite(invite, cat.parts) })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await me()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = String(body.action ?? "")
  if (!["confirm", "return", "cancel", "extend"].includes(action)) return NextResponse.json({ error: "action ไม่ถูกต้อง" }, { status: 400 })
  if ((action === "confirm" || action === "cancel") && !canApproveVendor(user.email)) {
    return NextResponse.json({ error: "ต้องเป็นแอดมินหรือผู้อนุมัติอู่" }, { status: 403 })
  }
  try {
    const inv = await actOnInvite(id, action as "confirm" | "return" | "cancel" | "extend",
      { validFrom: body.validFrom, validTo: body.validTo, note: body.note, deadline: body.deadline }, user)
    return NextResponse.json({ ok: true, invite: inv })
  } catch (e) { const { status, error } = httpError(e); if (status === 500) console.error("[rfq] PATCH", e); return NextResponse.json({ error }, { status }) }
}
