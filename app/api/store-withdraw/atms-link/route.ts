// /api/store-withdraw/atms-link — ผูก/ดู/เลิกผูกบัญชี ATMS ของสโตร์ (session เท่านั้น · ไม่คืนรหัสผ่านออกไปเด็ดขาด)
import { NextResponse, type NextRequest } from "next/server"
import { credStatus, deleteCreds } from "@/lib/store-withdraw/creds"
import { getActor, guard, isResponse, readJson } from "@/lib/store-withdraw/http"
import { linkAtmsAccount } from "@/lib/store-withdraw/link"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(req, false)
    if (isResponse(actor)) return actor
    return NextResponse.json(await credStatus(actor.email))
  })
}

export function POST(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(req, false)
    if (isResponse(actor)) return actor
    const b = await readJson(req)
    const username = String(b.username ?? "").trim()
    const password = String(b.password ?? "")
    return NextResponse.json(await linkAtmsAccount(actor, username, password))
  })
}

export function DELETE(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(req, false)
    if (isResponse(actor)) return actor
    await deleteCreds(actor.email)
    return NextResponse.json({ linked: false })
  })
}
