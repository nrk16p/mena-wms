import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { sheetDb, toObjectId } from "@/lib/tyre-sheet-db"
import { ROWS_COLL, SIZES, sizeFromText, type TyreSize } from "@/lib/tyre-sheet"

// POST /api/tyre-sheet/send { ids } — แทนปุ่ม Run ETL: ย้ายแถวจากเตรียมข้อมูลไปตารางตามไซซ์
// ต่างจากเดิม: ไม่ลบแถว แค่เปลี่ยน stage → ส่งพังกลางทางก็ไม่หาย ไม่ซ้ำ
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const ids = (Array.isArray(body.ids) ? body.ids : []).map((x: unknown) => toObjectId(String(x))).filter(Boolean)
  if (!ids.length) return NextResponse.json({ error: "ยังไม่ได้เลือกแถว" }, { status: 400 })

  const db = await sheetDb()
  const col = db.collection(ROWS_COLL)
  const rows = await col.find({ _id: { $in: ids }, stage: "prep" }).sort({ createdAt: 1, _id: 1 }).toArray()
  const skipped: string[] = []
  const bySize = new Map<TyreSize, typeof rows>()
  for (const r of rows) {
    const size = sizeFromText(r.tyreType) ?? (SIZES.includes(r.size) ? (r.size as TyreSize) : null)
    if (!size) { skipped.push(`${r.plate || "-"} ${r.position || ""} (ยังไม่ได้เลือกชนิดยาง)`); continue }
    if (!bySize.has(size)) bySize.set(size, [])
    bySize.get(size)!.push(r)
  }

  const user = session.user?.name ?? session.user?.email ?? ""
  const now = new Date()
  const summary: Record<string, number> = {}
  for (const [size, list] of bySize) {
    const last = await col.find({ stage: "sent", size }).sort({ seq: -1 }).limit(1).project({ seq: 1 }).toArray()
    let seq = Number(last[0]?.seq ?? 0) || 0
    for (const r of list) {
      seq++
      await col.updateOne({ _id: r._id, stage: "prep" }, { $set: { stage: "sent", size, seq, sentAt: now, sentBy: user, updatedAt: now, updatedBy: user } })
    }
    summary[size] = list.length
  }
  return NextResponse.json({ ok: true, total: rows.length - skipped.length, bySize: summary, skipped })
}
