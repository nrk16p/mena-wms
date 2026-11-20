// GET /api/store-withdraw/hub/stock?inventoryId=&vendorCode= — ยอด Hub ต่อ Sub/อะไหล่ (สิทธิ์ store-hub ดู)
import type { NextRequest } from "next/server"
import { guard, isResponse } from "@/lib/store-withdraw/http"
import { getHubActor, hubStockHandler } from "@/lib/store-withdraw/hub-api"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getHubActor(req, "view")
    if (isResponse(actor)) return actor
    return hubStockHandler(req.nextUrl.searchParams)
  })
}
