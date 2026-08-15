// app/api/deadstock/action/route.ts
// ป้าย "การจัดการ" ของค้าง — แยกจาก /api/deadstock เพราะตัวนั้น cache 1 ชม.
// ป้ายต้องเห็นผลทันทีที่กดบันทึก จึงห้ามอยู่ในของที่ถูก cache
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { listActions, setAction } from "@/lib/deadstock-action"
import { DEADSTOCK_ACTIONS, type ActionKey } from "@/lib/deadstock-core"

export const dynamic = "force-dynamic"

const VALID = new Set<string>(DEADSTOCK_ACTIONS.map((a) => a.key))

export async function GET() {
  try {
    return NextResponse.json({ actions: await listActions() })
  } catch (e) {
    console.error("[deadstock/action] GET", e)
    return NextResponse.json({ error: "ดึงป้ายไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const key = String(body.key ?? "").trim()
    const action = String(body.action ?? "").trim()
    const note = String(body.note ?? "").trim().slice(0, 500)

    if (!key) return NextResponse.json({ error: "ไม่พบคีย์ของรายการ" }, { status: 400 })
    if (action !== "" && !VALID.has(action)) {
      return NextResponse.json({ error: `การจัดการไม่ถูกต้อง: ${action}` }, { status: 400 })
    }

    const session = await getServerSession(authOptions)
    const by = session?.user?.name || session?.user?.email || ""
    const byEmail = session?.user?.email || ""

    const entry = await setAction(key, action as ActionKey | "", note, by, byEmail)
    return NextResponse.json({ ok: true, key, entry })
  } catch (e) {
    console.error("[deadstock/action] PATCH", e)
    return NextResponse.json({ error: "บันทึกไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
