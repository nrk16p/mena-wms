// app/api/ap-tracking/audit/route.ts
// ผลตรวจความครบถ้วน ATMS ↔ Mongo — ตัวตรวจอยู่ที่ api-ncac (pipeline atms_audit) ไม่ใช่ที่นี่
// เพราะการถาม ATMS ต้อง login ซึ่งฝั่งนั้นมี auto-login อยู่แล้ว ส่วนนี่แค่อ่านผลที่เก็บไว้
import { NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { MENA_API_BASE } from "@/lib/mena-api"

export const dynamic = "force-dynamic"

const KEY = process.env.MENA_API_KEY ?? ""      // server-side เท่านั้น ไม่หลุดถึง browser
const RATE_LIMIT_MIN = 5                        // ตรวจ 1 ครั้ง/5 นาที (งานเบา ~8 request)
const ETA_SEC = 30

// GET — ผลตรวจล่าสุด
export async function GET() {
  const client = await clientPromise
  const doc = await client.db("atms").collection("deposit_audit")
    .find({}, { projection: { _id: 0 } }).sort({ created_at: -1, at: -1 }).limit(1).next()
  if (!doc) return NextResponse.json({ audit: null })
  return NextResponse.json({ audit: doc })
}

// POST — สั่งตรวจเดี๋ยวนี้ โดยไม่ต้องรอรอบ 06:00
export async function POST() {
  const client = await clientPromise
  const col = client.db("atms").collection("deposit_audit")
  const last = await col.find({}).sort({ created_at: -1 }).limit(1).next()
  if (last?.created_at) {
    const ageMin = (Date.now() - new Date(last.created_at as string | Date).getTime()) / 60000
    if (ageMin < RATE_LIMIT_MIN) {
      return NextResponse.json(
        { error: "rate_limited", retry_after_min: Math.max(1, Math.ceil(RATE_LIMIT_MIN - ageMin)) },
        { status: 429 },
      )
    }
  }
  try {
    const res = await fetch(`${MENA_API_BASE}/pipeline/run/atms_audit`, {
      method: "POST", headers: { "x-api-key": KEY }, cache: "no-store",
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return NextResponse.json({ error: "trigger_failed", detail: data }, { status: 502 })
    return NextResponse.json({ status: data.status === "already_running" ? "already_running" : "started", eta_sec: ETA_SEC })
  } catch (e) {
    return NextResponse.json({ error: "trigger_error", detail: String(e) }, { status: 502 })
  }
}
