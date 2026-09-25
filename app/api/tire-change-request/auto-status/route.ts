import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { autoResolveTireRequests } from "@/lib/tire-request-auto"

// ปิด/ปฏิเสธคำขอเปลี่ยนยางอัตโนมัติ เรียกเองนอกรอบ sync (ดู lib/tire-request-auto.ts สำหรับกติกา)
// รันจริงพ่วงท้าย cron/tire-sync และ tire-change/sync อยู่แล้ว — เส้นนี้ไว้ preview/สั่งรันซ้ำเอง
export const dynamic = "force-dynamic"
export const maxDuration = 300

// ป้องกันแบบเดียวกับ endpoint cron อื่น ๆ (Bearer CRON_SECRET) แต่ยอมรับ session ที่ login
// อยู่แล้วด้วย — เพราะ endpoint นี้มีไว้ให้ admin เรียกเช็ค/สั่งรันเองจากหน้าเว็บได้เช่นกัน ไม่ใช่
// แค่ระบบอัตโนมัติ
async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true
  const session = await getServerSession(authOptions)
  return !!session?.user
}

// GET /api/tire-change-request/auto-status?branch=latkrabang — preview อย่างเดียว ไม่เขียน DB (สั่งรันจริงใช้ POST)
export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = req.nextUrl
  const branch = searchParams.get("branch")?.trim()
  const branches = branch ? [branch] : undefined

  const result = await autoResolveTireRequests({
    branches,
    // preview ต้องการเห็นทั้งสองขั้น (ปิด + ปฏิเสธ) ครบทุกสาขาที่ขอ — ไม่ต้องรอผล sync จริง
    rejectBranches: branches,
    dryRun: true,
  })

  return NextResponse.json(result)
}

// POST /api/tire-change-request/auto-status — { branch?, rejectBranches?, dryRun? } รันจริง (default: เขียนจริง)
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body   = await req.json().catch(() => ({}))
  const branch = typeof body.branch === "string" ? body.branch.trim() : ""
  const branches = branch ? [branch] : (Array.isArray(body.branches) ? body.branches.map(String) : undefined)
  const rejectBranches = Array.isArray(body.rejectBranches)
    ? body.rejectBranches.map(String)
    : branches // ไม่ระบุ rejectBranches มา = ใช้สาขาเดียวกับที่ตรวจ (สั่งรันเองถือว่ามั่นใจแล้วว่าข้อมูลสด)
  const dryRun = body.dryRun === true

  const result = await autoResolveTireRequests({ branches, rejectBranches, dryRun })
  return NextResponse.json(result)
}
