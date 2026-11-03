// app/api/store-withdraw/route.ts — GET รายการ (?mine=1[&q=] | ?inv=&status=) · POST ยื่นคำขอ (session หรือ x-api-key)
import { NextResponse, type NextRequest } from "next/server"
import { clampLimit, searchActive } from "@/lib/store-withdraw/core"
import { countAttachments } from "@/lib/store-withdraw/attachments"
import { swCol, withRef } from "@/lib/store-withdraw/db"
import { getActor, guard, isResponse, readJson, err } from "@/lib/store-withdraw/http"
import { createRequest, searchMine } from "@/lib/store-withdraw/service"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(req, true)
    if (isResponse(actor)) return actor
    const sp = req.nextUrl.searchParams
    const filter: Record<string, unknown> = {}
    // ?mine=1&q= ค้นย้อนหลังในใบของตัวเอง (ล่าสุด 500 ใบ → กรอง → ไม่เกิน 100) · q สั้นกว่า 2 ตัว = ไม่กรอง ใช้รายการปกติ
    const q = (sp.get("q") ?? "").slice(0, 100)
    if (sp.get("mine") === "1" && searchActive(q)) {
      const found = await searchMine(actor.email, q)
      const counts = await countAttachments(found.map((d) => d.no))
      return NextResponse.json({ items: found.map((d) => ({ ...withRef(d), attachCount: counts.get(d.no) ?? 0 })), q })
    }
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
    const counts = await countAttachments(items.map((d) => d.no))
    return NextResponse.json({ items: items.map((d) => ({ ...withRef(d), attachCount: counts.get(d.no) ?? 0 })) })
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
