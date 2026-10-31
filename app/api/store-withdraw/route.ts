// app/api/store-withdraw/route.ts — GET รายการ (?mine=1 | ?inv=&status=) · POST ยื่นคำขอ (session หรือ x-api-key)
import { NextResponse, type NextRequest } from "next/server"
import { clampLimit } from "@/lib/store-withdraw/core"
import { swCol } from "@/lib/store-withdraw/db"
import { getActor, guard, isResponse, readJson, err } from "@/lib/store-withdraw/http"
import { createRequest } from "@/lib/store-withdraw/service"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(req, true)
    if (isResponse(actor)) return actor
    const sp = req.nextUrl.searchParams
    const filter: Record<string, unknown> = {}
    if (sp.get("mine") === "1") {
      filter["requestedBy.email"] = actor.email
    } else {
      if (actor.via === "api") return err("เรียกด้วย API key ดูได้เฉพาะใบของตัวเอง — ใส่ ?mine=1", 403)
      const inv = Number(sp.get("inv"))
      if (!Number.isInteger(inv) || inv <= 0) return err("ระบุคลัง (inv) หรือใช้ ?mine=1", 400)
      filter.inventoryId = inv
    }
    const status = sp.get("status")?.trim()
    if (status) filter.status = { $in: status.split(",").map((s) => s.trim()).filter(Boolean) }
    const limit = clampLimit(sp.get("limit"), 200, 500)
    const items = await (await swCol()).find(filter, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray()
    return NextResponse.json({ items })
  })
}

export function POST(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(req, true)
    if (isResponse(actor)) return actor
    const doc = await createRequest(await readJson(req), actor)
    return NextResponse.json({ no: doc.no }, { status: 201 })
  })
}
