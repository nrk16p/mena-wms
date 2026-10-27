// POST /api/form-vendor — ฟอร์มลงทะเบียน Vendor (public ไม่ต้อง login) → datawarehouse.vendor_registration
// schema อยู่หัวไฟล์ lib/vendor-register.ts
import { NextRequest, NextResponse } from "next/server"
import type { Collection } from "mongodb"
import clientPromise from "@/lib/mongo"
import { onceUntilOk } from "@/lib/once"
import { VR_DB, VR_COLL, normalizeVendorRegister, validateVendorRegister } from "@/lib/vendor-register"

export const dynamic = "force-dynamic"

/** ลิงก์สาธารณะ — ไอพีเดียวส่งได้ไม่เกินเท่านี้ใน 10 นาที
 *  นับในหน่วยความจำของ process (ไม่เก็บไอพีลง DB) — บน Vercel แยกตาม instance จึงเป็นแบบ best-effort */
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 10 * 60 * 1000
const hits = new Map<string, number[]>()

function rateLimited(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_LIMIT) { hits.set(ip, recent); return true }
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k)
  return false
}

/** ยืนยัน LIFF ID token กับ LINE → userId + ชื่อ · channel ID = ส่วนหน้า "-" ของ LIFF ID
 *  token หมดอายุ/ไม่ผ่าน → null (ยังบันทึกฟอร์มได้ แค่ไม่มี lineId) */
async function verifyLineIdToken(idToken: string): Promise<{ lineId: string; lineDisplayName: string | null } | null> {
  const channelId = process.env.NEXT_PUBLIC_LIFF_ID?.split("-")[0]
  if (!channelId) return null
  try {
    const r = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
      signal: AbortSignal.timeout(5000),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || typeof j.sub !== "string") { console.warn("[form-vendor] line verify", r.status, j.error_description ?? j.error); return null }
    return { lineId: j.sub, lineDisplayName: typeof j.name === "string" ? j.name.slice(0, 200) : null }
  } catch (e) { console.warn("[form-vendor] line verify", e); return null }
}

async function collection() {
  const col = (await clientPromise).db(VR_DB).collection(VR_COLL)
  await ensureIndexes(col)
  return col
}

const ensureIndexes = onceUntilOk(async (col: Collection) => {
  await Promise.all([
    col.createIndex({ taxId: 1 }),
    col.createIndex({ lineId: 1 }),
    col.createIndex({ status: 1, createdAt: -1 }),
    col.createIndex({ createdAt: -1 }),
  ])
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const input = normalizeVendorRegister(body)
  const errors = validateVendorRegister(input)
  if (Object.keys(errors).length) return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง", errors }, { status: 400 })

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || null
  const now = new Date()
  if (ip && rateLimited(ip, now.getTime())) return NextResponse.json({ error: "ส่งข้อมูลบ่อยเกินไป — ลองใหม่อีกครั้งในภายหลัง" }, { status: 429 })

  const idToken = typeof body?.lineIdToken === "string" ? body.lineIdToken : ""
  const line = idToken ? await verifyLineIdToken(idToken) : null

  try {
    const col = await collection()
    const { insertedId } = await col.insertOne({
      firstName: input.firstName,
      lastName: input.lastName,
      fullName: `${input.firstName} ${input.lastName}`,
      onBehalf: input.onBehalf || null,
      address: input.address,
      phone: input.phone,
      taxId: input.taxId,
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      vendorCode: null,
      lineId: line?.lineId ?? null,
      lineDisplayName: line?.lineDisplayName ?? null,
      source: "form-vendor",
      createdAt: now,
      updatedAt: now,
    })
    return NextResponse.json({ ok: true, id: insertedId.toString(), createdAt: now.toISOString() }, { status: 201 })
  } catch (e) {
    console.error("[form-vendor] insert", e)
    return NextResponse.json({ error: "บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง" }, { status: 500 })
  }
}
