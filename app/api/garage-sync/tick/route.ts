import { NextResponse, after } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { claimGarageSync, runGarageSync } from "@/lib/garage-sync-run"

const DB = process.env.MONGO_DB ?? "master_data"
// รอบหนึ่งอ่าน timeline ของ Mena-Next ทีละ 10 งาน (~7 วิ/ชุด) — เผื่อเวลาให้ after() ทำจนจบ
export const maxDuration = 120

// POST /api/garage-sync/tick — แท็บ WMS ที่เปิดอยู่ส่งมาทุก 2 นาที (components/garage-sync-heartbeat.tsx)
// ตอบทันที · ถ้าถึงรอบ ทำ sync ต่อหลังตอบ (after) ผู้ใช้ไม่ต้องรอ
export async function POST() {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ ok: false }, { status: 401 })
  const db = (await clientPromise).db(DB)
  const claimed = await claimGarageSync(db)
  if (claimed) after(() => runGarageSync(db).then(() => undefined))
  return NextResponse.json({ ok: true, started: claimed })
}
