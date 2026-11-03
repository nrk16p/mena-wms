// POST /api/core-return/bulk/follow-up { keys: string[], note, nextDate? } — ตามหลายแถวด้วยข้อความเดียวกัน
// สิทธิ์ = follow_up (เหมือนตามทีละแถว · policy จับ /:key/follow-up) · แต่ละแถว atomic แยกกัน · คืน { ok, failed }
import { NextResponse, type NextRequest } from "next/server"
import { getCoreActor, guard, isResponse, readJson } from "@/lib/core-return/http"
import { followUpMany } from "@/lib/core-return/service"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "follow_up")
    if (isResponse(ctx)) return ctx
    const body = await readJson(req)
    return NextResponse.json(await followUpMany(body.keys, body, ctx.actor))
  })
}
