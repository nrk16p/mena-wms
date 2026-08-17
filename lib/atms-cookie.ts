import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

// เก็บ PHPSESSID ของ ATMS ไว้ที่ main-api (encrypt + cache) — ผูกกับ google_id ของผู้ใช้
const MAIN_API = process.env.MAIN_API_BASE ?? "https://main-api-mena-548129382487.asia-southeast1.run.app"

/** รับได้ทั้ง "abc", "PHPSESSID=abc" หรือทั้ง Cookie header → คืนเฉพาะค่า session id */
function normalizePhpsessid(v: string) {
  const m = v.match(/PHPSESSID=([^;\s]+)/i)
  return (m ? m[1] : v).trim()
}

/** google_id ของผู้ใช้ที่ login อยู่ (NextAuth เก็บ Google sub ไว้ที่ user.id) */
export async function currentGoogleId(): Promise<string> {
  const session = await getServerSession(authOptions)
  return (session?.user as { id?: string } | undefined)?.id ?? ""
}

/** ดึง PHPSESSID ล่าสุดของผู้ใช้จาก main-api — ไม่มี/ล้มเหลวคืน "" */
export async function fetchAtmsCookie(googleId: string): Promise<string> {
  if (!googleId) return ""
  try {
    const res = await fetch(`${MAIN_API}/user/atms-cookie/${encodeURIComponent(googleId)}`, { cache: "no-store" })
    if (!res.ok) return ""            // 404 = ผู้ใช้ยังไม่เคยเก็บ cookie ไว้
    const d = await res.json().catch(() => ({}))
    const raw = String(d?.cookie_key ?? d?.x_phpsessid ?? d?.phpsessid ?? d?.cookie ?? "")
    return normalizePhpsessid(raw)
  } catch {
    return ""
  }
}

/** ATMS เด้งกลับหน้า login = session หมดอายุ (NCAC ตอบ 401 พร้อม detail) */
export function isAtmsSessionExpired(status: number, body: unknown): boolean {
  if (status === 401) return true
  const text = JSON.stringify(body ?? "")
  return /PHPSESSID|login/i.test(text)
}

const NCAC = process.env.NCAC_BASE ?? "https://api-ncac.onrender.com"

/**
 * ยิง NCAC (ที่ต้องใช้ session ATMS) แทนผู้ใช้ที่ login อยู่
 * ใช้ PHPSESSID ของผู้ใช้ก่อน แล้วค่อย fallback env — เจอ session หมดอายุจะสลับไปอีกค่าแล้วลองซ้ำ 1 รอบ
 */
export async function ncacWithSession(path: string) {
  const googleId   = await currentGoogleId()
  const envCookie  = process.env.ATMS_SESSION ?? ""
  const userCookie = await fetchAtmsCookie(googleId)

  const call = async (phpsessid: string) => {
    const res = await fetch(`${NCAC}${path}`, {
      headers: phpsessid ? { "X-PHPSESSID": phpsessid } : {},
      cache: "no-store",
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  }

  const first = userCookie || envCookie
  let res = await call(first)

  if (!res.ok && isAtmsSessionExpired(res.status, res.data)) {
    const retryWith = first === userCookie ? envCookie : await fetchAtmsCookie(googleId)
    if (retryWith && retryWith !== first) res = await call(retryWith)
  }

  return { ...res, expired: !res.ok && isAtmsSessionExpired(res.status, res.data), hasUserCookie: Boolean(userCookie) }
}
