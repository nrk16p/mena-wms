// GET /api/store-withdraw/queue?inv= → { columns: {NEW, PREPARING, READY, DONE_TODAY}, atmsKeyed: [] } (session เท่านั้น)
// atmsKeyed = WD วันนี้ที่คีย์ตรงใน ATMS (แคช 3 นาที · อ่านด้วยบัญชีค้นข้อมูลของ WMS · ช้า/ล่ม = ว่าง ไม่ทำให้คิวหลักรอ) · ต้องมีสิทธิ์ store-queue แก้ได้
import { NextResponse, type NextRequest } from "next/server"
import { getStoreActor, guard, isResponse } from "@/lib/store-withdraw/http"
import { buildQueue, listAtmsKeyed } from "@/lib/store-withdraw/service"

// คิวหลักไม่รอรายการ ATMS เกิน 1.5 วิ — ช้าแค่ไหนก็คืน [] ไปก่อน (ดึงต่อเบื้องหลังลงแคช รอบ poll ถัดไปจะเห็น)
const LIST_BUDGET_MS = 1_500
const withBudget = <T,>(p: Promise<T[]>): Promise<T[]> =>
  Promise.race([p.catch(() => [] as T[]), new Promise<T[]>((r) => setTimeout(() => r([]), LIST_BUDGET_MS))])

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getStoreActor(req)
    if (isResponse(actor)) return actor
    const inv = Number(req.nextUrl.searchParams.get("inv"))
    const validInv = Number.isInteger(inv) && inv > 0
    const [columns, atmsKeyed] = await Promise.all([
      buildQueue(validInv ? inv : null),
      validInv ? withBudget(listAtmsKeyed(inv, new Date())) : Promise.resolve([]),
    ])
    return NextResponse.json({ columns, atmsKeyed })
  })
}
