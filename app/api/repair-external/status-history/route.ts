import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { REPAIR_LOG_COLL } from "@/lib/repair-log"

const DB = process.env.MONGO_DB ?? "master_data"

// GET /api/repair-external/status-history?ids=id1,id2,... — เฉพาะ entry ที่มีการเปลี่ยนสถานะ
// (create + update ที่ status เปลี่ยน) เรียงเก่า→ใหม่ ใช้วาด timeline หลายสีต่อคันในแท็บแผนซ่อม
// คืนเป็น map repairId → [{to, at}] แทน array แบนเพื่อให้ client กลุ่มได้ทันที
export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get("ids") ?? ""
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500)
  if (!ids.length) return NextResponse.json({})

  const client = await clientPromise
  const rows = await client.db(DB).collection(REPAIR_LOG_COLL)
    .find({ repairId: { $in: ids }, "statusChange.to": { $exists: true, $ne: "" } })
    .project({ repairId: 1, at: 1, "statusChange.to": 1 })
    .sort({ at: 1 })
    .limit(5000)
    .toArray()

  const map: Record<string, { to: string; at: string }[]> = {}
  for (const r of rows) {
    const id = String(r.repairId)
    ;(map[id] ??= []).push({ to: String(r.statusChange?.to ?? ""), at: new Date(r.at).toISOString() })
  }
  return NextResponse.json(map)
}
