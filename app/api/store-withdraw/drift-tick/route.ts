// POST /api/store-withdraw/drift-tick — งานตั้งเวลา (api-ncac pipeline) ตรวจใบที่ตัดแล้วว่าถูกแก้ใน ATMS หรือไม่
// x-api-key เท่านั้น (STORE_WITHDRAW_TICK_KEY · แยกจากกุญแจผู้ขอ STORE_WITHDRAW_API_KEYS) ไม่รับ session · middleware ปล่อยผ่านโดยไม่มี session แล้ว route ตรวจกุญแจซ้ำที่นี่
import { NextResponse, type NextRequest } from "next/server"
import { driftTick } from "@/lib/store-withdraw/drift"
import { settleDriftTick } from "@/lib/store-withdraw/settle-drift"
import { err, guard, tickKeyValid } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export function POST(req: NextRequest) {
  return guard(async () => {
    if (!tickKeyValid(req.headers.get("x-api-key"))) return err("ต้องส่ง x-api-key ที่ถูกต้อง", 401)
    const started = Date.now()
    const a = await driftTick()
    // WD ต่อทะเบียนของ Mobile/PM ใช้เวลาที่เหลือในรอบเดียวกัน (งบรวม 50 วิ เท่าเดิม)
    const b = await settleDriftTick({ budgetMs: Math.max(0, 50_000 - (Date.now() - started)) })
    return NextResponse.json({ checked: a.checked + b.checked, drifted: a.drifted + b.drifted, skipped: a.skipped + b.skipped })
  })
}
