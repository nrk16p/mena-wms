import { NextRequest, NextResponse } from "next/server"
import { runBranchSync, BRANCH_IDS, AtmsSessionError, AtmsNetworkError } from "@/lib/atms-sync"
import { rebuildTireDistance } from "@/lib/tire-distance"
import { autoResolveTireRequests } from "@/lib/tire-request-auto"
import clientPromise from "@/lib/mongo"

const DB       = process.env.MONGO_DB ?? "master_data"
const BRANCHES = Object.keys(BRANCH_IDS) // ["latkrabang", "saraburi"]

// sync ATMS + คำนวณระยะยางต่อท้าย — รอบเต็มใช้เวลาเกิน default 10 วิ
export const maxDuration = 300

// ⏰ ตารางเวลา (vercel.json ใช้ UTC): รอบนี้ตั้งไว้ 04:00 UTC = 11:00 น.ไทย
// ต้องรัน *หลัง* งานค่าเที่ยวที่อัปเดต atms.truck_distance_summary ราว 02:35 UTC (09:35 น.ไทย)
// ไม่งั้นการคำนวณระยะยางจะหยิบค่าเที่ยวของเมื่อวานมาใช้ ช้าไป 1 วันโดยไม่จำเป็น
// ถ้าจะขยับเวลา ให้เช็คก่อนว่างานค่าเที่ยวเสร็จแล้ว (ดู updated_at ใน truck_distance_summary)

export type SyncLogEntry = {
  branch:       string
  ok:           boolean
  count:        number
  stockUpdated: number
  error:        string | null
  trigger:      "cron" | "manual"
  syncedAt:     Date
}

// GET /api/cron/tire-sync — invoked by Vercel Cron every 6 hours
// Protected by Authorization: Bearer <CRON_SECRET>
export async function GET(req: NextRequest) {
  // Auth check — skip in local dev when CRON_SECRET is not configured
  const secret = process.env.CRON_SECRET
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const phpsessid = process.env.ATMS_SESSION ?? ""
  if (!phpsessid) {
    return NextResponse.json({ error: "ATMS_SESSION env var not configured" }, { status: 500 })
  }

  const client   = await clientPromise
  const logCol   = client.db(DB).collection<SyncLogEntry>("tire_sync_log")
  const results: SyncLogEntry[] = []

  for (const branch of BRANCHES) {
    let entry: SyncLogEntry
    try {
      const r = await runBranchSync(branch, phpsessid)
      entry = { branch, ok: true, count: r.count, stockUpdated: r.stockUpdated, error: null, trigger: "cron", syncedAt: r.syncedAt }
    } catch (err) {
      let msg = "Unknown error"
      if (err instanceof AtmsSessionError) msg = "Session expired — update ATMS_SESSION env var"
      else if (err instanceof AtmsNetworkError) msg = `Network error: ${err.message}`
      else if (err instanceof Error) msg = err.message
      entry = { branch, ok: false, count: 0, stockUpdated: 0, error: msg, trigger: "cron", syncedAt: new Date() }
    }

    // upsert — keep latest cron result per branch
    await logCol.updateOne(
      { branch, trigger: "cron" },
      { $set: entry },
      { upsert: true }
    )
    results.push(entry)
  }

  const allOk = results.every((r) => r.ok)

  // sync เสร็จแล้ว tire_change เพิ่งอัปเดต — คำนวณ "ยางถึงกำหนดเปลี่ยน" ต่อเลยในรอบเดียวกัน
  // (ไม่แยก cron ใหม่ เพราะต้องรันหลัง sync เสมอ ถ้าแยกแล้วจับเวลาพลาดจะได้ข้อมูลรอบเก่า)
  const distance = await rebuildTireDistance()

  // ปิด/ปฏิเสธคำขอเปลี่ยนยางอัตโนมัติ ต่อท้ายในรอบเดียวกัน — ต้องรันหลัง sync เสมอเหมือนกัน
  // ปิดงานได้ทุกสาขา (แค่ตรวจ tire_change ที่มีอยู่) แต่ปฏิเสธอัตโนมัติทำเฉพาะสาขาที่ sync
  // สำเร็จรอบนี้เท่านั้น — กัน sync ล้มเหลว/ข้อมูลเก่าทำให้ auto-close มองไม่เห็นเส้นที่เปลี่ยนจริง
  // แล้วดันไปปฏิเสธเส้นนั้นซ้ำ ครอบด้วย try/catch กันพลาดแล้วทำให้ response ของ cron หลักพัง
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let autoResolve: any = null
  try {
    const okBranches = results.filter((r) => r.ok).map((r) => r.branch)
    const full = await autoResolveTireRequests({ rejectBranches: okBranches })
    autoResolve = { ...full, details: full.details.slice(0, 50) }
  } catch (err) {
    autoResolve = { error: err instanceof Error ? err.message : String(err) }
  }

  return NextResponse.json({ ok: allOk, results, distance, autoResolve })
}
