// lib/store-withdraw/http.ts — ตัวช่วยฝั่ง route: ผู้ทำรายการ (session / x-api-key) · รูปแบบ error · ห่อ handler
import { timingSafeEqual } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { atLeast, type Access } from "@/lib/access-policy"
import { validApiUser } from "./core"
import { ConflictError, NotFoundError, type Actor } from "./db"

export const err = (message: string, status: number) => NextResponse.json({ error: message }, { status })

function keyIn(key: string | null, keys: string[]): boolean {
  if (!key) return false
  const a = Buffer.from(key)
  let hit = false
  for (const k of keys) {
    const b = Buffer.from(k)
    // เทียบทุกกุญแจเสมอ (ไม่หยุดเมื่อเจอ) และเทียบแบบเวลาคงที่
    if (a.length === b.length && timingSafeEqual(a, b)) hit = true
  }
  return hit
}
const list = (v: string | undefined) => (v ?? "").split(",").map((k) => k.trim()).filter(Boolean)

/** กุญแจ drift-tick (STORE_WITHDRAW_TICK_KEY) · แยกจากกุญแจผู้ขอโดยเด็ดขาด */
export const tickKeys = () => list(process.env.STORE_WITHDRAW_TICK_KEY)

/** กุญแจฝั่งผู้ขอ (STORE_WITHDRAW_API_KEYS) · กุญแจที่ตรงกับกุญแจ tick ใช้ไม่ได้ ต่อให้ตั้งซ้ำกันพลาด */
export function apiKeyValid(key: string | null): boolean {
  const tick = tickKeys()
  const keys = list(process.env.STORE_WITHDRAW_API_KEYS).filter((k) => !tick.includes(k))
  return keyIn(key, keys)
}

/** กุญแจของงานตั้งเวลา drift-tick เท่านั้น */
export function tickKeyValid(key: string | null): boolean {
  return keyIn(key, tickKeys())
}

/**
 * ผู้ทำรายการ: session ก่อน · ไม่มี session แต่มี x-api-key ที่ถูกต้อง + x-user (อีเมล) → via "api"
 * allowApi=false (ส่งของ/รับคืน/รับงาน ฯลฯ) = รับ session เท่านั้น ต่อให้มีกุญแจก็ไม่ยอม
 */
export async function getActor(req: NextRequest, allowApi: boolean): Promise<Actor | NextResponse> {
  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    return { email: session.user.email.trim().toLowerCase(), name: session.user.name || session.user.email, via: "web" }
  }
  const key = req.headers.get("x-api-key")
  if (key) {
    if (!allowApi) return err("งานนี้ต้องล็อกอินเข้า WMS เอง เรียกด้วย API key ไม่ได้", 403)
    if (!apiKeyValid(key)) return err("API key ไม่ถูกต้อง ตรวจกุญแจกับผู้ดูแลระบบ", 401)
    const user = (req.headers.get("x-user") ?? "").trim().toLowerCase()
    if (!validApiUser(user)) return err("ต้องส่งอีเมล @menatransport.co.th ของคนที่ทำจริงใน header x-user", 400)
    return { email: user, name: user, via: "api" }
  }
  return err("ยังไม่ได้ล็อกอิน เข้าสู่ระบบแล้วลองใหม่", 401)
}

/**
 * งานของสโตร์: ต้องเป็น session และมีสิทธิ์ "คิวงานสโตร์" ระดับแก้ได้ (เช็กซ้ำที่ route นอกเหนือจาก middleware)
 * อ่าน access จาก session เหมือนที่ middleware/หน้าอื่นอ่าน
 */
export async function getStoreActor(req: NextRequest): Promise<Actor | NextResponse> {
  const actor = await getActor(req, false)
  if (isResponse(actor)) return actor
  const session = await getServerSession(authOptions)
  const access = (session?.user as { access?: Access } | undefined)?.access
  if (!access || !atLeast(access["store-queue"], "edit")) return err("งานนี้เฉพาะสโตร์ ขอสิทธิ์คิวงานสโตร์จากผู้ดูแลระบบ", 403)
  return actor
}

export const isResponse = (x: Actor | NextResponse): x is NextResponse => x instanceof NextResponse

export type RouteCtx<P extends Record<string, string> = Record<string, string>> = { params: Promise<P> }

/** แปลง error ที่คาดไว้เป็นข้อความไทยสั้น ๆ · อย่างอื่น log ฝั่งเซิร์ฟเวอร์แล้วตอบกลาง ๆ (ไม่หลุดข้อความดิบ) */
export async function guard(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof NotFoundError) return err(e.message, 404)
    if (e instanceof ConflictError) return err(e.message, 409)
    if (e instanceof HttpError) return err(e.message, e.status)
    console.error("[store-withdraw]", e)
    return err("ระบบขัดข้อง ลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแล", 500)
  }
}

export class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message)
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

/** ผู้ขอต้องเป็นเจ้าของใบ (เทียบอีเมล) */
export function assertOwner(reqDoc: { requestedBy: { email: string } }, actor: Actor) {
  if (reqDoc.requestedBy.email.trim().toLowerCase() !== actor.email) {
    throw new HttpError("ใบนี้ไม่ใช่ของคุณ ทำรายการได้เฉพาะใบที่ตัวเองยื่น", 403)
  }
}
