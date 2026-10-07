// lib/admin-guard.ts — ด่านตรวจ superadmin ใน API /api/admin/*
// middleware บล็อกให้แล้วชั้นหนึ่ง แต่ route ตรวจซ้ำเองเสมอ (กัน matcher ของ middleware พลาด/ถูกแก้)
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isSuperAdmin } from "@/lib/roles"

export type SuperAdminCheck = { ok: true; email: string; name: string } | { ok: false; res: NextResponse }

export async function requireSuperAdmin(): Promise<SuperAdminCheck> {
  const session = await getServerSession(authOptions)
  const email = (session?.user?.email ?? "").toLowerCase()
  if (!email) return { ok: false, res: NextResponse.json({ error: "ต้องล็อกอินก่อน" }, { status: 401 }) }
  if (!isSuperAdmin(email)) {
    return { ok: false, res: NextResponse.json({ error: "no_access", need: "superadmin" }, { status: 403 }) }
  }
  return { ok: true, email, name: session?.user?.name ?? "" }
}
