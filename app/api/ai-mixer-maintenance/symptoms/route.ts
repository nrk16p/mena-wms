import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { AI_MIXER_ALLOWED_EMAILS, resolveKbConfig, kbListSymptoms } from "@/lib/ai-mixer"

// POST /api/ai-mixer-maintenance/symptoms — proxy แคตาล็อกอาการจาก KB API (ใช้ทำ autocomplete)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!AI_MIXER_ALLOWED_EMAILS.includes(session?.user?.email ?? "")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const kb = resolveKbConfig(body?.kb)
  if (!kb) return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า KB API" }, { status: 400 })

  try {
    const symptoms = await kbListSymptoms(kb)
    return NextResponse.json({ symptoms })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ดึงแคตาล็อกอาการไม่สำเร็จ" }, { status: 502 })
  }
}
