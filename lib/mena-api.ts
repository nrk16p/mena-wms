// Mena API — แลก Google id_token เป็น access token + โปรไฟล์พนักงาน (และเป็น base ของ pipeline endpoints)
// POST /auth/login/google  body: { id_token }  → 401 { detail: "Invalid Google token" } ถ้า token ไม่ผ่าน
// หมายเหตุ: OpenAPI ฝั่ง API ไม่ประกาศ response schema ไว้ จึง parse แบบยืดหยุ่น (รองรับหลายชื่อฟิลด์)

import { getToken } from "next-auth/jwt"
import type { NextRequest } from "next/server"

export const MENA_API_BASE = process.env.MENA_API_URL

// API รันบน Render (free tier) — cold start ได้ จึงกันไม่ให้ login ค้างนานเกินไป
const TIMEOUT_MS = Number(process.env.MENA_API_TIMEOUT_MS ?? 12_000)

export type EmployeeProfile = {
  id?: number
  username?: string
  email?: string | null
  employee_id?: string | null
  employee_status?: string | null
  firstname?: string | null
  lastname?: string | null
  department_id?: number | null
  site_id?: number | null
  position_id?: number | null
  department?: string | null
  site?: string | null
  position?: string | null
  position_level?: string | null
}

export type EmployeeLogin = {
  accessToken: string | null
  /** epoch ms ที่ token หมดอายุ (ถ้า API ส่ง expires_in มา) */
  expiresAt: number | null
  profile: EmployeeProfile | null
  /** response ดิบ (mask ฟิลด์ token แล้ว) — ไว้ debug ตอน profile = null */
  raw: Json
}

type Json = Record<string, unknown>

const TOKEN_KEYS = new Set(["access_token", "accessToken", "token", "jwt", "refresh_token", "id_token"])

/** ปิดบังค่า token ก่อนเอาไป log */
function redact(obj: Json): Json {
  const out: Json = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = TOKEN_KEYS.has(k) && typeof v === "string" ? `«${v.length} chars»` : v
  }
  return out
}

function pickString(obj: Json, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string" && v) return v
  }
  return null
}

function looksLikeProfile(v: unknown): v is EmployeeProfile {
  if (!v || typeof v !== "object") return false
  const o = v as Json
  return "employee_id" in o || "username" in o || "email" in o
}

/**
 * อ่าน payload ของ Google id_token (ไม่ verify — ใช้ debug เท่านั้น)
 * ตัวที่ต้องดูคือ `aud`: ฝั่ง API จะ verify ว่า aud ตรงกับ GOOGLE_CLIENT_ID ของมันไหม
 */
export function decodeIdTokenClaims(idToken: string): Json | null {
  const part = idToken.split(".")[1]
  if (!part) return null
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Json
  } catch {
    return null
  }
}

/** เก็บเฉพาะ claim ที่ช่วย diagnose (ไม่เอาทั้งก้อน) */
export function idTokenDebug(idToken: string): Json {
  const c = decodeIdTokenClaims(idToken)
  if (!c) return { parsed: false, parts: idToken.split(".").length, length: idToken.length }
  const exp = typeof c.exp === "number" ? c.exp : null
  return {
    parsed: true,
    aud: c.aud,
    azp: c.azp,
    iss: c.iss,
    email: c.email,
    email_verified: c.email_verified,
    hd: c.hd,
    expiresInSec: exp ? Math.round(exp - Date.now() / 1000) : null,
  }
}

/**
 * แลก Google id_token กับ API
 * โยน Error เมื่อเรียกไม่สำเร็จ — ผู้เรียกเป็นคนตัดสินใจว่าจะ fail-soft หรือไม่
 */
export async function loginWithGoogleIdToken(idToken: string): Promise<EmployeeLogin> {
  const res = await fetch(`${MENA_API_BASE}/auth/login/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_token: idToken }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  const data = (await res.json().catch(() => ({}))) as Json

  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : `HTTP ${res.status}`
    throw new Error(`API login failed: ${detail}`)
  }

  const accessToken = pickString(data, ["access_token", "accessToken", "token", "jwt"])

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : null
  const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null

  // โปรไฟล์อาจมาเป็น data.user / data.profile / data.data หรือมาเป็น object ตรง ๆ
  const candidate = data.user ?? data.profile ?? data.data ?? data
  const profile = looksLikeProfile(candidate) ? (candidate as EmployeeProfile) : null

  return { accessToken, expiresAt, profile, raw: redact(data) }
}

/**
 * อ่าน API access token จาก JWT cookie ของ session (server-side เท่านั้น)
 * ใช้ใน route handler เวลาต้องยิงต่อไปที่ API แทนผู้ใช้ — คืน null ถ้าไม่มี/หมดอายุ
 */
export async function getApiToken(req: NextRequest): Promise<string | null> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token?.apiToken) return null
  if (token.apiTokenExpires && Date.now() >= token.apiTokenExpires) return null
  return token.apiToken
}

/** ดึงโปรไฟล์พนักงานเต็ม (ใช้ต่อยอดเมื่อ /auth/login/google ไม่ได้คืน user มาด้วย) */
export async function fetchEmployee(employeeId: string, accessToken?: string | null): Promise<EmployeeProfile | null> {
  const res = await fetch(`${MENA_API_BASE}/users/${encodeURIComponent(employeeId)}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return null
  const data = await res.json().catch(() => null)
  return looksLikeProfile(data) ? (data as EmployeeProfile) : null
}
