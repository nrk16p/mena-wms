// GET /api/core-return/by-request?nos=SW-2611-001,SW-2611-002 — สถานะซากต่อบรรทัดของใบเบิก WMS (ชิปในหน้าใบของฉัน / คิวสโตร์)
import { NextResponse, type NextRequest } from "next/server"
import { getCoreActor, guard, isResponse } from "@/lib/core-return/http"
import { rowsForRequests } from "@/lib/core-return/service"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "read")
    if (isResponse(ctx)) return ctx
    const nos = (req.nextUrl.searchParams.get("nos") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    return NextResponse.json({ items: await rowsForRequests(nos) })
  })
}
