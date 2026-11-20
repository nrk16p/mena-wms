// POST /api/store-withdraw/hub/receive — รับของเข้า Hub ของ Sub ตามเลขเอกสารส่งของ (สิทธิ์ store-hub แก้ได้)
import type { NextRequest } from "next/server"
import { guard, isResponse, readJson } from "@/lib/store-withdraw/http"
import { getHubActor, hubReceiveHandler } from "@/lib/store-withdraw/hub-api"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest) {
  return guard(async () => {
    const actor = await getHubActor(req, "edit")
    if (isResponse(actor)) return actor
    return hubReceiveHandler(await readJson(req), actor)
  })
}
