// lib/vendor-portal-auth.ts — รหัสผ่าน + session ของพอร์ทัลเจ้าหนี้ (ฝั่งเซิร์ฟเวอร์เท่านั้น)
//
// แยกขาดจาก next-auth ของพนักงาน: cookie คนละชื่อ (vp_session) และกุญแจเซ็นคนละดอก
// (HMAC ของ NEXTAUTH_SECRET กับป้าย "vendor-portal-v1") — token ของเจ้าหนี้จึงถอดเป็น session พนักงานไม่ได้
// และไม่ต้องตั้ง env ใหม่บน Vercel
import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto"
import { SignJWT, jwtVerify } from "jose"

export const VP_COOKIE        = "vp_session"
export const VP_SESSION_DAYS  = 7
export const VP_MAX_FAILS     = 5
export const VP_LOCK_MINUTES  = 15

// ไม่มี 0 O o 1 l I — เจ้าหนี้พิมพ์ตามจากไลน์บนมือถือ ตัวที่หน้าตาคล้ายกันทำให้ล็อกอินไม่ผ่าน
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"

export function genVpPassword(): string {
  let out = ""
  for (let i = 0; i < 10; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const
const KEYLEN = 32

function scryptAsync(pw: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(pw, salt, KEYLEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))))
}

/** เก็บเป็น "scrypt$<salt>$<hash>" (base64) — ไม่มีทางอ่านรหัสกลับ ลืม = ออกรหัสใหม่ */
export async function hashVpPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(pw, salt)
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`
}

export async function verifyVpPassword(pw: string, stored: string): Promise<boolean> {
  const parts = String(stored ?? "").split("$")
  if (parts.length !== 3 || parts[0] !== "scrypt" || !parts[1] || !parts[2]) return false
  const salt = Buffer.from(parts[1], "base64")
  const want = Buffer.from(parts[2], "base64")
  if (want.length !== KEYLEN) return false
  const got = await scryptAsync(String(pw ?? ""), salt)
  return timingSafeEqual(got, want)
}

function signingKey(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("NEXTAUTH_SECRET ไม่ได้ตั้งค่า — พอร์ทัลเจ้าหนี้เซ็น session ไม่ได้")
  return new Uint8Array(createHmac("sha256", secret).update("vendor-portal-v1").digest())
}

export async function signVpSession(p: { sub: string; tv: number }): Promise<string> {
  return new SignJWT({ tv: p.tv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.sub)
    .setIssuedAt()
    .setExpirationTime(`${VP_SESSION_DAYS}d`)
    .sign(signingKey())
}

export async function readVpSession(token: string | undefined): Promise<{ sub: string; tv: number } | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ["HS256"] })
    const sub = typeof payload.sub === "string" ? payload.sub : ""
    const tv  = typeof payload.tv === "number" ? payload.tv : NaN
    return sub && Number.isInteger(tv) ? { sub, tv } : null
  } catch {
    return null
  }
}

/** session ใช้ได้เมื่อบัญชียังเปิด และ tokenVersion ตรง (รีเซ็ตรหัส/ปิดบัญชี = เพิ่มเลข → session เก่าหลุด) */
export function vpSessionValid(
  acc: { disabled?: boolean; tokenVersion?: number } | null | undefined,
  s: { tv: number } | null | undefined,
): boolean {
  if (!acc || !s || acc.disabled) return false
  return (acc.tokenVersion ?? 0) === s.tv
}

export function vpCookieOptions(maxAgeSec = VP_SESSION_DAYS * 86400) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSec,
  }
}

// ── กันเดารหัส: ผิด VP_MAX_FAILS ครั้งติด ล็อก VP_LOCK_MINUTES นาที (เวลาเป็น ISO UTC) ────────
export function vpIsLocked(acc: { lockedUntil?: string | null }, nowISO: string): boolean {
  return Boolean(acc.lockedUntil) && String(acc.lockedUntil) > nowISO
}

/** ค่าใหม่หลังใส่รหัสผิด 1 ครั้ง — ล็อกที่หมดเวลาแล้วถือว่าเริ่มนับใหม่ */
export function vpFailUpdate(
  acc: { failedCount?: number; lockedUntil?: string | null },
  nowISO: string,
): { failedCount: number; lockedUntil: string | null } {
  const expired = Boolean(acc.lockedUntil) && String(acc.lockedUntil) <= nowISO
  const n = (expired ? 0 : acc.failedCount ?? 0) + 1
  if (n < VP_MAX_FAILS) return { failedCount: n, lockedUntil: null }
  return { failedCount: n, lockedUntil: new Date(Date.parse(nowISO) + VP_LOCK_MINUTES * 60_000).toISOString() }
}
