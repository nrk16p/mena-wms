// POST /api/vendor-portal/login — เจ้าหนี้ล็อกอินด้วยรหัสผู้ขาย + รหัสผ่าน (ไม่ผ่าน next-auth)
// ตอบข้อความเดียวเสมอเมื่อไม่ผ่าน ไม่บอกว่าผิดที่ชื่อหรือรหัส · ผิด 5 ครั้งล็อก 15 นาที
import { NextRequest, NextResponse } from "next/server"
import { vpCanonUsername } from "@/lib/vendor-portal"
import {
  VP_COOKIE, signVpSession, verifyVpPassword, vpCookieOptions, vpIsLocked, vpFailUpdate,
} from "@/lib/vendor-portal-auth"
import { VP_ACCOUNTS, vpDbs, type VpAccount } from "@/lib/vendor-portal-db"

export const dynamic = "force-dynamic"

const BAD    = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
const LOCKED = "ลองผิดหลายครั้ง รอ 15 นาทีแล้วลองใหม่"
// hash ของรหัสสุ่มที่ไม่มีใครรู้ — ใช้ตอนหาบัญชีไม่เจอ ให้เวลาตอบใกล้เคียงกับกรณีมีบัญชี (เดาชื่อผู้ใช้จากเวลาไม่ได้)
const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const raw      = typeof body?.username === "string" ? body.username.trim() : ""
  const password = typeof body?.password === "string" ? body.password : ""
  if (!raw || !password) {
    return NextResponse.json({ error: "กรอกชื่อผู้ใช้และรหัสผ่านให้ครบ" }, { status: 400 })
  }
  // ชื่อผู้ใช้ต้องเป็นรูป Vendor-NNNNN · รูปอื่น = ไม่มีบัญชี (ตอบแบบเดียวกับรหัสผิด)
  const username = vpCanonUsername(raw)
  if (!username) {
    await verifyVpPassword(password, DUMMY_HASH)
    return NextResponse.json({ error: BAD }, { status: 401 })
  }

  const db  = await vpDbs()
  const col = db.md.collection<VpAccount>(VP_ACCOUNTS)
  const acc = await col.findOne({ username }, { projection: { _id: 0 }, maxTimeMS: 10000 })
  const now = new Date().toISOString()

  if (!acc) {
    await verifyVpPassword(password, DUMMY_HASH)
    return NextResponse.json({ error: BAD }, { status: 401 })
  }
  if (vpIsLocked(acc, now)) return NextResponse.json({ error: LOCKED }, { status: 429 })

  const ok = !acc.disabled && await verifyVpPassword(password, acc.passwordHash)
  if (!ok) {
    const upd = vpFailUpdate(acc, now)
    await col.updateOne({ username }, { $set: upd })
    return upd.lockedUntil
      ? NextResponse.json({ error: LOCKED }, { status: 429 })
      : NextResponse.json({ error: BAD }, { status: 401 })
  }

  await col.updateOne({ username }, { $set: { failedCount: 0, lockedUntil: null, lastLoginAt: now }, $inc: { loginCount: 1 } })
  const token = await signVpSession({ sub: username, tv: acc.tokenVersion ?? 0 })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(VP_COOKIE, token, vpCookieOptions())
  return res
}
