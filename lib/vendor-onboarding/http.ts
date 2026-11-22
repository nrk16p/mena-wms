// lib/vendor-onboarding/http.ts — ตัวช่วยฝั่ง route: error ภาษาไทย · ห่อ handler · ไอพี · จำกัดจำนวนครั้ง · origin
import { NextResponse, type NextRequest } from "next/server"
import type { FieldErrors } from "./validate"

export class HttpError extends Error {
  constructor(message: string, public status: number, public errors?: FieldErrors) { super(message) }
}

export const bad = (message: string, errors?: FieldErrors) => new HttpError(message, 400, errors)
export const notFound = (message = "ไม่พบใบสมัครนี้") => new HttpError(message, 404)
export const conflict = (message = "ใบนี้มีคนแก้ไปแล้ว โหลดหน้าใหม่แล้วลองอีกครั้ง") => new HttpError(message, 409)
export const forbidden = (message: string) => new HttpError(message, 403)

/** ห่อ handler: HttpError → JSON {error, errors?} ตาม status · อื่น ๆ → 500 */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.errors ? { error: e.message, errors: e.errors } : { error: e.message }, { status: e.status })
    }
    console.error("[vendor-onboarding]", e)
    return NextResponse.json({ error: "ระบบขัดข้อง ลองใหม่อีกครั้ง" }, { status: 500 })
  }
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object" || Array.isArray(b)) throw bad("ข้อมูลที่ส่งมาไม่ถูกต้อง")
  return b as Record<string, unknown>
}

export function clientIp(req: NextRequest): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || null
}

/** origin ที่ผู้ใช้เห็นจริง (หลัง proxy/rewrite) — ใช้สร้างลิงก์ส่งให้ vendor */
export function publicOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host")
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || req.nextUrl.protocol.replace(/:$/, "")
  return host ? `${proto}://${host}` : req.nextUrl.origin
}

/** จำกัดจำนวนครั้งต่อไอพี (นับในหน่วยความจำ process — best-effort แบบเดียวกับ /form-vendor เดิม ไม่เก็บไอพีลง DB) */
const buckets = new Map<string, Map<string, number[]>>()
export function rateLimit(bucket: string, ip: string | null, limit: number, windowMs: number): void {
  if (!ip) return
  const now = Date.now()
  let hits = buckets.get(bucket)
  if (!hits) { hits = new Map(); buckets.set(bucket, hits) }
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= limit) {
    hits.set(ip, recent)
    throw new HttpError("ส่งบ่อยเกินไป รอสักครู่แล้วลองใหม่", 429)
  }
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k)
}
