// GET /api/core-return/rounds/:no — รอบ + รายการซากในรอบ
import { NextResponse, type NextRequest } from "next/server"
import { getCoreActor, guard, isResponse } from "@/lib/core-return/http"
import { getRound } from "@/lib/core-return/rounds"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest, { params }: { params: Promise<{ no: string }> }) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "read")
    if (isResponse(ctx)) return ctx
    return NextResponse.json(await getRound((await params).no))
  })
}
