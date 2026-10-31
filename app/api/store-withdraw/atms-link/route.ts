// /api/store-withdraw/atms-link — ผูก/ดู/เลิกผูกบัญชี ATMS ของสโตร์ (session เท่านั้น · ไม่คืนรหัสผ่านออกไปเด็ดขาด)
import { NextResponse, type NextRequest } from "next/server"
import { credStatus, deleteCreds, saveCreds, type AtmsProfile } from "@/lib/store-withdraw/creds"
import { getActor, guard, isResponse, readJson, err } from "@/lib/store-withdraw/http"
import { ncac } from "@/lib/store-withdraw/ncac"

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
    if (!username || !password) return err("กรอกชื่อผู้ใช้และรหัสผ่าน ATMS ให้ครบ", 400)

    let r: { status: number; data: AtmsProfile | null }
    try {
      r = await ncac<AtmsProfile | null>("GET", "/atms/withdraw/whoami", { creds: { username, password } })
    } catch {
      return err("ติดต่อ ATMS ไม่ได้ในตอนนี้ — รอสักครู่แล้วลองผูกใหม่", 502)
    }
    if (r.status === 401) return err("ATMS ไม่รับชื่อผู้ใช้หรือรหัสผ่านนี้ — ตรวจแล้วลองใหม่", 422)
    if (r.status < 200 || r.status >= 300 || !r.data) return err("อ่านโปรไฟล์จาก ATMS ไม่ได้ — ลองใหม่อีกครั้ง", 502)
    const atmsEmail = String(r.data.email ?? "").trim().toLowerCase()
    if (atmsEmail !== actor.email) {
      return err("อีเมลของบัญชี ATMS นี้ไม่ตรงกับอีเมลที่ล็อกอิน WMS — ผูกได้เฉพาะบัญชีของตัวเอง", 403)
    }
    await saveCreds(actor.email, username, password, r.data)
    return NextResponse.json(await credStatus(actor.email))
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
