// app/api/safety-stock/live-sync/route.ts — ปุ่ม "ดึงข้อมูลล่าสุดจาก ATMS" ของหน้า /safety-stock
// POST { inventory } = สั่ง api-ncac เริ่มสาย live sync · GET = สถานะรอบล่าสุด (หน้าเว็บถามซ้ำระหว่างรอ)
// ผู้ใช้ที่เห็นหน้านี้กดได้ทุกคน (lib/access-policy.ts) · กันกดถี่ด้วย cooldown นับจากรอบล่าสุดที่เริ่ม
// key ของ api-ncac อยู่ฝั่ง server เท่านั้น เบราว์เซอร์ไม่เห็น
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { MENA_API_BASE } from "@/lib/mena-api"
import { WAREHOUSES } from "@/lib/safety-stock-core"
import { LIVE_SYNC_DAYS, liveSyncWaitMin, type LiveSyncState } from "@/lib/safety-stock-live-sync"

export const dynamic = "force-dynamic"

const DB = process.env.MONGO_DB ?? "master_data"
const COLL = "safety_stock_live_syncs"
const KEY = process.env.MENA_API_KEY ?? ""
// api-ncac อยู่บน Render — ปลุกจาก cold start ได้ช้า
const TIMEOUT_MS = 25_000

async function ncac(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: LiveSyncState & { started?: boolean } }> {
  if (!MENA_API_BASE) throw new Error("ยังไม่ได้ตั้ง MENA_API_URL")
  const res = await fetch(`${MENA_API_BASE}${path}`, {
    ...init,
    headers: { "x-api-key": KEY, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const data = await res.json().catch(() => ({ status: "error", error: `HTTP ${res.status}` }))
  return { ok: res.ok, status: res.status, data }
}

async function lastStart(): Promise<Date | null> {
  const client = await clientPromise
  const doc = await client.db(DB).collection(COLL).find({}).sort({ startedAt: -1 }).limit(1).next()
  return (doc?.startedAt as Date | undefined) ?? null
}

export async function GET() {
  try {
    const [r, last] = await Promise.all([ncac("/pipeline/wms-live-sync"), lastStart()])
    if (!r.ok) return NextResponse.json({ error: "status_failed", detail: r.data }, { status: 502 })
    return NextResponse.json({ state: r.data, waitMin: liveSyncWaitMin(last, Date.now()) })
  } catch (e) {
    return NextResponse.json({ error: "status_error", detail: String(e) }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const inventory = String(body?.inventory ?? "")
  if (!WAREHOUSES.some((w) => w.id === inventory)) {
    return NextResponse.json({ error: "bad_inventory" }, { status: 400 })
  }
  const session = await getServerSession(authOptions)
  const user = session?.user?.name || session?.user?.email || null

  try {
    // รอบก่อนยังเดินอยู่ = ไม่สั่งใหม่ คืนสถานะรอบนั้นให้ดูต่อ (ใครกดก็เห็นรอบเดียวกัน)
    const cur = await ncac("/pipeline/wms-live-sync")
    if (cur.ok && cur.data.status === "running") {
      return NextResponse.json({ started: false, state: cur.data, waitMin: 0 })
    }
    const wait = liveSyncWaitMin(await lastStart(), Date.now())
    if (wait > 0) {
      return NextResponse.json({ error: "rate_limited", retry_after_min: wait, state: cur.ok ? cur.data : null }, { status: 429 })
    }

    const r = await ncac("/pipeline/wms-live-sync", {
      method: "POST",
      body: JSON.stringify({ inventory, days: LIVE_SYNC_DAYS, user }),
    })
    if (!r.ok) return NextResponse.json({ error: "trigger_failed", detail: r.data }, { status: 502 })
    if (r.data.started) {
      const client = await clientPromise
      await client.db(DB).collection(COLL)
        .insertOne({ inventoryId: inventory, days: LIVE_SYNC_DAYS, user, startedAt: new Date() })
        .catch((e) => console.error("[safety-stock live-sync] log", e))
    }
    return NextResponse.json({ started: !!r.data.started, state: r.data, waitMin: 0 })
  } catch (e) {
    return NextResponse.json({ error: "trigger_error", detail: String(e) }, { status: 502 })
  }
}
