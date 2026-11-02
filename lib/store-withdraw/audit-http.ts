// lib/store-withdraw/audit-http.ts — ผู้เรียก audit: ต้องเป็น session และมีสิทธิ์ store-audit อย่างน้อยดูได้ (เช็กซ้ำจาก middleware)
import { getServerSession } from "next-auth"
import type { NextRequest, NextResponse } from "next/server"
import { authOptions } from "@/lib/auth"
import { atLeast, type Access } from "@/lib/access-policy"
import { err, getActor, isResponse } from "./http"
import type { Actor } from "./db"

export async function getAuditActor(req: NextRequest): Promise<Actor | NextResponse> {
  const actor = await getActor(req, false)
  if (isResponse(actor)) return actor
  const session = await getServerSession(authOptions)
  const access = (session?.user as { access?: Access } | undefined)?.access
  if (!access || !atLeast(access["store-audit"], "view")) return err("หน้านี้เฉพาะผู้ได้รับสิทธิ์ตรวจสอบย้อนหลัง ขอสิทธิ์จากผู้ดูแลระบบ", 403)
  return actor
}
