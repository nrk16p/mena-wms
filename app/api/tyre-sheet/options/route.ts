import { NextResponse } from "next/server"
import { getOptions } from "@/lib/tyre-sheet-db"

// GET /api/tyre-sheet/options — รายการ dropdown (นำเข้าจากแท็บ options ของชีต)
export async function GET() {
  return NextResponse.json(await getOptions())
}
