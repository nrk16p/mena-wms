import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { AI_MIXER_ALLOWED_EMAILS, resolveKbConfig, kbHealth } from "@/lib/ai-mixer"

// POST /api/ai-mixer-maintenance/kb-test — ทดสอบเชื่อมต่อ Mixer Repair KB API
// (เรียกผ่าน server เพื่อเลี่ยง CORS ของ ngrok/FastAPI)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!AI_MIXER_ALLOWED_EMAILS.includes(session?.user?.email ?? "")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const kb = resolveKbConfig(body?.kb)
  if (!kb) return NextResponse.json({ ok: false, error: "กรุณาระบุ URL และ API Key" }, { status: 400 })

  try {
    const health = await kbHealth(kb)
    return NextResponse.json({ ok: true, health })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "เชื่อมต่อไม่สำเร็จ" })
  }
}
