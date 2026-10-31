// GET /api/store-withdraw/options — คลัง + จุดประสงค์การเบิก (แคชสั้น ๆ ไม่ยิง ATMS ทุกครั้งที่เปิดหน้า)
import { NextResponse, type NextRequest } from "next/server"
import { getActor, guard, isResponse } from "@/lib/store-withdraw/http"
import { getOptions } from "@/lib/store-withdraw/service"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(req, true)
    if (isResponse(actor)) return actor
    return NextResponse.json(await getOptions())
  })
}
