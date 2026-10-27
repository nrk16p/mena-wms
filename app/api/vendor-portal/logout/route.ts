// POST /api/vendor-portal/logout — ล้าง cookie ของพอร์ทัลเจ้าหนี้
import { NextResponse } from "next/server"
import { VP_COOKIE, vpCookieOptions } from "@/lib/vendor-portal-auth"

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(VP_COOKIE, "", vpCookieOptions(0))
  return res
}
