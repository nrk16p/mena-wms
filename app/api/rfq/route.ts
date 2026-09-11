// app/api/rfq/route.ts — สร้างลิงก์หลายอู่ + รายการ
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { createInvites, listInvites, catalogSummary, httpError } from "@/lib/rfq"
import { SHEET_ORDER, validateCustomJobs, type RfqSection } from "@/lib/rfq-core"
import clientPromise from "@/lib/mongo"

export const dynamic = "force-dynamic"
const DB = process.env.MONGO_DB ?? "master_data"

async function me() {
  const s = await getServerSession(authOptions)
  return s?.user ? { name: s.user.name || s.user.email || "", email: s.user.email || "" } : null
}

export async function GET(req: NextRequest) {
  if (!(await me())) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const rows = await listInvites({ status: sp.get("status") ?? "", title: sp.get("title") ?? "", q: sp.get("q") ?? "" })
  return NextResponse.json({ invites: rows })
}

export async function POST(req: NextRequest) {
  const user = await me()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const title = String(body.title ?? "").trim().slice(0, 120)
    const deadline = String(body.deadline ?? "")
    if (!title) return NextResponse.json({ error: "กรุณาตั้งชื่อรอบ" }, { status: 400 })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return NextResponse.json({ error: "วันปิดรับไม่ถูกต้อง" }, { status: 400 })
    const raw = Array.isArray(body.invites) ? body.invites : []
    if (!raw.length || raw.length > 200) return NextResponse.json({ error: "เลือกอู่ 1–200 ราย" }, { status: 400 })
    const { sheets: known, jobs: knownJobs, version } = await catalogSummary()
    const knownSet = new Set(known.map((s) => s.sheet))
    const jobSheet = new Map(knownJobs.map((j) => [j.jobCode, j.sheet]))
    const vendorsInDb = new Set((await (await clientPromise).db(DB).collection("vendor_approval").find({}, { projection: { vendor: 1 } }).toArray()).map((v) => v.vendor as string))
    const invites = []
    for (const r of raw) {
      const vendor = String(r?.vendor ?? "").trim()
      if (!vendor || !vendorsInDb.has(vendor)) return NextResponse.json({ error: `ไม่พบอู่ใน AVL: ${vendor || "(ว่าง)"}` }, { status: 400 })
      const sheets = (Array.isArray(r.sheets) ? r.sheets : []).map(String).filter((s: string) => knownSet.has(s) && SHEET_ORDER.includes(s))
      const sections = (Array.isArray(r.sections) ? r.sections : ["labour", "parts"]).filter((s: string): s is RfqSection => s === "labour" || s === "parts")
      // ข้อย่อย: รับเฉพาะรหัสงานที่มีจริงและอยู่ในชีตที่ให้ · ว่าง = ทุกงาน
      const rawCodes: string[] = Array.isArray(r.jobCodes) ? r.jobCodes.map((c: unknown) => String(c)) : []
      const jobCodes = [...new Set(rawCodes)].filter((c) => sheets.includes(jobSheet.get(c) ?? ""))
      const sheetsWithSvc = [...new Set([...sheets, "SVC"])]
      const customJobs = validateCustomJobs(r.customJobs, sheetsWithSvc, version)
      if (typeof customJobs === "string") return NextResponse.json({ error: customJobs }, { status: 400 })
      for (const cj of customJobs) cj.sheetTitle = known.find((k) => k.sheet === cj.sheet)?.title ?? cj.sheetTitle
      invites.push({ vendor, sheets, sections, jobCodes, customJobs })
    }
    const created = await createInvites({ title, deadline, invites }, user)
    const origin = req.nextUrl.origin
    return NextResponse.json({ ok: true, invites: created.map((c) => ({ id: c._id, vendor: c.vendor, token: c.token, url: `${origin}/q/${c.token}` })) })
  } catch (e) { const { status, error } = httpError(e); console.error("[rfq] POST", e); return NextResponse.json({ error }, { status }) }
}
