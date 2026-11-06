import { NextRequest, NextResponse } from "next/server"
import { getRound, buildRoundReport } from "@/lib/tyre-sheet-db"

type Params = { params: Promise<{ id: string }> }

// GET /api/tyre-sheet/rounds/{id}/report — ข้อมูลใบขออนุมัติเปลี่ยนยาง (แทน getDataWithSummary_Two)
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const round = await getRound(id)
  if (!round) return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 })
  return NextResponse.json(await buildRoundReport(round))
}
