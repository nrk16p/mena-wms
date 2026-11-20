// GET /api/store-withdraw/hub/items?inventoryId=&q=&limit= — ค้นอะไหล่ Hub ในฟอร์มขอเบิก (สิทธิ์ยื่นคำขอ)
import type { NextRequest } from "next/server"
import { guard, isResponse } from "@/lib/store-withdraw/http"
import { getHubSearchActor, hubItemsHandler } from "@/lib/store-withdraw/hub-api"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getHubSearchActor(req)
    if (isResponse(actor)) return actor
    return hubItemsHandler(req.nextUrl.searchParams)
  })
}
