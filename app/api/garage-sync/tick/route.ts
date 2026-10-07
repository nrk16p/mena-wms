import { NextRequest, NextResponse, after } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { claimGarageSync, hasGarageSyncApiKey, runGarageSync } from "@/lib/garage-sync-run"

const DB = process.env.MONGO_DB ?? "master_data"
// รอบหนึ่ง = อ่าน open-jobs สด 1 ครั้ง + เทียบใบงาน WMS (~1–3 วิ)
export const maxDuration = 30

// POST /api/garage-sync/tick — แท็บ WMS ที่เปิดอยู่ส่งมาทุก 2 นาที (components/garage-sync-heartbeat.tsx)
// ตอบทันที · ถ้าถึงรอบ ทำ sync ต่อหลังตอบ (after) ผู้ใช้ไม่ต้องรอ
// เรียกด้วย x-api-key (server-to-server / ทดสอบ) → ทำทันทีแบบรอผล ไม่สนรอบ 2 นาที แล้วตอบผลกลับ
export async function POST(req: NextRequest) {
  const db = (await clientPromise).db(DB)
  if (hasGarageSyncApiKey(req)) {
    await claimGarageSync(db, true)
    return NextResponse.json({ ok: true, started: true, result: await runGarageSync(db) })
  }
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ ok: false }, { status: 401 })
  const claimed = await claimGarageSync(db)
  if (claimed) after(() => runGarageSync(db).then(() => undefined))
  return NextResponse.json({ ok: true, started: claimed })
}
