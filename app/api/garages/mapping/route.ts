import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { fetchAtmsBoard, normKey } from "@/lib/atms-board"
import { applyMapping, buildMappingRows, recentMappings, undoMapping } from "@/lib/garage-mapping"

export const dynamic = "force-dynamic"
const DB = process.env.MONGO_DB ?? "master_data"

// GET /api/garages/mapping — ชื่ออู่ที่ตั้งเอง (ยังไม่ผูก ATMS) + คู่ที่ระบบเดา + ประวัติการจับคู่
export async function GET() {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const db = (await clientPromise).db(DB)
  // Mena-Next ใช้เดาคู่จากงานเดียวกัน (MR) — ล่มก็ยังทำงานได้ (แค่ไม่มีคำแนะนำจาก Mena-Next)
  const board = await fetchAtmsBoard().catch(() => null)
  const nextByMr = new Map((board?.jobs ?? []).filter((j) => j.vendor && j.mrCode).map((j) => [normKey(j.mrCode), j.vendor]))
  const [rows, history] = await Promise.all([buildMappingRows(db, nextByMr), recentMappings(db)])
  return NextResponse.json({ ok: true, rows, history, nextOk: !!board })
}

// POST /api/garages/mapping { name, atmsId, targets?: [{coll,id}] } — ยืนยันจับคู่
export async function POST(req: NextRequest) {
  const s = await getServerSession(authOptions)
  const email = s?.user?.email ?? ""
  if (!email) return NextResponse.json({ ok: false, error: "กรุณาเข้าสู่ระบบ" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const name = String(body.name ?? "").trim()
  const atmsId = Number(body.atmsId) || 0
  if (!name || !atmsId) return NextResponse.json({ ok: false, error: "ต้องระบุชื่อเดิมและอู่ ATMS" }, { status: 400 })
  const targets = Array.isArray(body.targets)
    ? body.targets.filter((t: { coll?: string; id?: string }) => (t?.coll === "repair" || t?.coll === "plan") && t.id)
    : undefined
  if (targets && !targets.length) return NextResponse.json({ ok: false, error: "ไม่ได้เลือกใบงาน" }, { status: 400 })
  try {
    const r = await applyMapping((await clientPromise).db(DB), { name, atmsId, targets, by: s?.user?.name || email, byEmail: email })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 409 })
  }
}

// DELETE /api/garages/mapping?id=<mapId> — ย้อนการจับคู่
export async function DELETE(req: NextRequest) {
  const s = await getServerSession(authOptions)
  const email = s?.user?.email ?? ""
  if (!email) return NextResponse.json({ ok: false, error: "กรุณาเข้าสู่ระบบ" }, { status: 401 })
  try {
    const r = await undoMapping((await clientPromise).db(DB), { mapId: req.nextUrl.searchParams.get("id") ?? "", by: s?.user?.name || email, byEmail: email })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 409 })
  }
}
