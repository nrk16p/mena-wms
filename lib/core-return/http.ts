// lib/core-return/http.ts — ตัวช่วยฝั่ง route ของงานติดตามซาก: session เท่านั้น · เช็กสิทธิ์ซ้ำ (coreReturnCan) นอกเหนือจาก middleware
import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { coreReturnCan, type Access, type CoreReturnAction } from "@/lib/access-policy"
import { CoreHttpError, type Actor } from "./core"

export const err = (message: string, status: number) => NextResponse.json({ error: message }, { status })

const DENY: Record<CoreReturnAction, string> = {
  read: "ยังไม่มีสิทธิ์ดูหน้าติดตามซาก ขอสิทธิ์จากผู้ดูแลระบบ",
  return: "คืนซากได้เฉพาะทีมยานยนต์ที่เบิก หรือสโตร์",
  sold: "บันทึกขายได้เฉพาะสโตร์",
  rebuilt: "บันทึกรีบิ้วเสร็จได้เฉพาะสโตร์",
  follow_up: "บันทึกการตามได้เฉพาะจัดซื้อ หรือสโตร์",
  round: "จัดรอบขายซากได้เฉพาะสโตร์ หรือจัดซื้อ",
}

export type CoreCtx = { actor: Actor; access: Access }

export async function getCoreActor(_req: NextRequest, action: CoreReturnAction): Promise<CoreCtx | NextResponse> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email?.trim().toLowerCase()
  if (!email) return err("ยังไม่ได้ล็อกอิน เข้าสู่ระบบแล้วลองใหม่", 401)
  const access = (session?.user as { access?: Access } | undefined)?.access
  if (!access || !coreReturnCan(access, action)) return err(DENY[action], 403)
  return { actor: { email, name: session!.user!.name || email, via: "web" }, access }
}

export const isResponse = (x: unknown): x is NextResponse => x instanceof NextResponse

export async function guard(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof CoreHttpError) return err(e.message, e.status)
    console.error("[core-return]", e)
    return err("ระบบขัดข้อง ลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแล", 500)
  }
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const b = await req.json()
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export const xlsx = (buffer: Buffer, filename: string) => new NextResponse(new Uint8Array(buffer), {
  headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  },
})
