// /api/store-withdraw/hub/master?type=items|vendors|sites
//   GET (ดู) · PATCH items/vendors · POST vendors · PUT sites (แก้ได้)
import type { NextRequest } from "next/server"
import { guard, isResponse, readJson } from "@/lib/store-withdraw/http"
import { getHubActor, hubMasterGet, hubMasterWrite } from "@/lib/store-withdraw/hub-api"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getHubActor(req, "view")
    if (isResponse(actor)) return actor
    return hubMasterGet(req.nextUrl.searchParams)
  })
}

const write = (method: "POST" | "PATCH" | "PUT") => (req: NextRequest) =>
  guard(async () => {
    const actor = await getHubActor(req, "edit")
    if (isResponse(actor)) return actor
    return hubMasterWrite(method, req.nextUrl.searchParams, await readJson(req), actor)
  })
export const POST = write("POST")
export const PATCH = write("PATCH")
export const PUT = write("PUT")
