// app/api/q/[token]/route.ts — ฝั่งอู่ ไม่มี session · token คือสิทธิ์
import { NextRequest, NextResponse } from "next/server"
import { bkkToday } from "@/lib/bkk-time"
import { getInviteByToken, getCatalog, markOpened, saveContact, saveAnswers, httpError } from "@/lib/rfq"
import { effectiveStatus, canVendorWrite, validateContact, validateAnswer, validatePartAnswer, partKey, jobsForInvite, partsForInvite, type RfqAnswer, type RfqPartAnswer, type RfqInvite } from "@/lib/rfq-core"

export const dynamic = "force-dynamic"
type Params = { params: Promise<{ token: string }> }
const MAX_BATCH = 20

function publicView(inv: RfqInvite, today: string) {
  const { confirm: _c, createdBy: _b, _id: _i, ...rest } = inv
  void _c; void _b; void _i
  return { ...rest, effective: effectiveStatus(inv, today), canWrite: canVendorWrite(inv, today),
    priceValidTo: inv.confirm?.validTo ?? null }   // อู่เห็นได้แค่ว่าราคาตัวเองมีผลถึงเมื่อไหร่
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params
  const inv = await getInviteByToken(token)
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (!inv.openedAt) await markOpened(token)
  const cat = await getCatalog(inv.catalogVersion)
  const today = bkkToday()
  return NextResponse.json({
    invite: publicView({ ...inv, openedAt: inv.openedAt ?? today }, today),
    jobs: jobsForInvite(inv, cat.jobs),
    parts: partsForInvite(inv, cat.parts),
    today,
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { token } = await params
  const inv = await getInviteByToken(token)
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  try {
    if (body.contact !== undefined) {
      const c = validateContact(body.contact)
      if (typeof c === "string") return NextResponse.json({ error: c }, { status: 400 })
      const after = await saveContact(token, c)
      return NextResponse.json({ ok: true, invite: publicView(after, bkkToday()) })
    }
    const items: Record<string, RfqAnswer> = {}
    const parts: Record<string, RfqPartAnswer> = {}
    const cat = await getCatalog(inv.catalogVersion)
    const jobOk = new Set(jobsForInvite(inv, cat.jobs).map((j) => j.jobCode))
    const partOk = new Set(partsForInvite(inv, cat.parts).map((p) => partKey(p.sheet, p.sku)))
    let n = 0
    for (const [k, v] of Object.entries((body.items ?? {}) as Record<string, unknown>)) {
      if (!jobOk.has(k) || /[.$]/.test(k)) return NextResponse.json({ error: `ไม่มีงาน ${k} ในใบนี้` }, { status: 400 })
      const a = validateAnswer(v); if (typeof a === "string") return NextResponse.json({ error: `${k}: ${a}` }, { status: 400 })
      items[k] = a; n++
    }
    for (const [k, v] of Object.entries((body.parts ?? {}) as Record<string, unknown>)) {
      if (!partOk.has(k) || /[.$]/.test(k)) return NextResponse.json({ error: `ไม่มีอะไหล่ ${k} ในใบนี้` }, { status: 400 })
      const a = validatePartAnswer(v); if (typeof a === "string") return NextResponse.json({ error: `${k}: ${a}` }, { status: 400 })
      parts[k] = a; n++
    }
    if (!n) return NextResponse.json({ error: "ไม่มีอะไรให้บันทึก" }, { status: 400 })
    if (n > MAX_BATCH) return NextResponse.json({ error: `บันทึกได้ครั้งละไม่เกิน ${MAX_BATCH} รายการ` }, { status: 400 })
    await saveAnswers(token, items, parts)
    return NextResponse.json({ ok: true, saved: n, at: new Date().toISOString() })
  } catch (e) { const { status, error } = httpError(e); if (status === 500) console.error("[q] PATCH", e); return NextResponse.json({ error }, { status }) }
}
