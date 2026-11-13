import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { runBranchSync, BRANCH_IDS, AtmsSessionError, AtmsNetworkError } from "@/lib/atms-sync"
import { AtmsLoginError, AtmsLoginNetworkError, linkedAtmsSession } from "@/lib/atms-login"
import { autoResolveTireRequests } from "@/lib/tire-request-auto"
import { rebuildTireDistance } from "@/lib/tire-distance"

// sync + คำนวณระยะยางทั้งฟลีตต่อท้าย — เกิน default 10 วิ
export const maxDuration = 300

// POST /api/tire-change/sync — { branch: "latkrabang" | "saraburi", phpsessid?, rebuild? }
// rebuild: false = ข้ามคำนวณระยะ (ใช้ตอน sync หลายสาขาต่อกัน แล้วให้สาขาสุดท้ายคำนวณทีเดียว)
//
// session ATMS ที่ใช้ (ตามลำดับ):
//   1. phpsessid ใน body — ทางสำรองของแอดมิน
//   2. บัญชี ATMS ที่ผู้ใช้ผูกไว้ (/api/tire-change/atms-link) — ใช้ session ที่แคชไว้ หลุดก็ login ใหม่เองแล้วลองซ้ำ 1 รอบ
//   3. env ATMS_SESSION
// 401 พร้อม code ให้หน้าเว็บรู้ว่าต้องถามอะไร: need_link = ยังไม่ผูกบัญชี · bad_credentials = รหัสที่ผูกไว้ใช้ไม่ได้แล้ว · expired = PHPSESSID ที่วางมาหมดอายุ
export async function POST(request: NextRequest) {
  const body      = await request.json().catch(() => ({}))
  const branch    = String(body.branch ?? "")
  const manual    = String(body.phpsessid ?? "").trim()
  const rebuild   = body.rebuild !== false

  if (!BRANCH_IDS[branch]) return NextResponse.json({ error: "branch must be latkrabang or saraburi" }, { status: 400 })

  const email = (await getServerSession(authOptions))?.user?.email ?? ""
  let atmsUsername: string | undefined
  let result: Awaited<ReturnType<typeof runBranchSync>>

  try {
    if (manual) {
      result = await runBranchSync(branch, manual)
    } else {
      const linked = email ? await linkedAtmsSession(email) : null
      if (linked) {
        atmsUsername = linked.username
        try {
          result = await runBranchSync(branch, linked.phpsessid)
        } catch (err) {
          if (!(err instanceof AtmsSessionError)) throw err
          const again = await linkedAtmsSession(email, true)
          if (!again) return needLink()
          try {
            result = await runBranchSync(branch, again.phpsessid)
          } catch (err2) {
            // login ผ่านแต่ export ยังเด้งไปหน้า login = บัญชีนี้ไม่มีสิทธิ์หน้ายางใน ATMS
            if (err2 instanceof AtmsSessionError)
              return NextResponse.json({ code: "no_permission", atmsUsername, error: `บัญชี ATMS "${atmsUsername}" เข้าหน้าประวัติยางไม่ได้ ใช้บัญชีที่มีสิทธิ์ดูยาง` }, { status: 403 })
            throw err2
          }
        }
      } else {
        const env = process.env.ATMS_SESSION ?? ""
        if (!env) return needLink()
        try {
          result = await runBranchSync(branch, env)
        } catch (err) {
          if (err instanceof AtmsSessionError) return needLink()
          throw err
        }
      }
    }
  } catch (err) {
    if (err instanceof AtmsLoginError)
      return NextResponse.json({ code: "bad_credentials", atmsUsername, error: "ATMS ไม่รับรหัสผ่านที่ผูกไว้ (อาจเปลี่ยนรหัสใน ATMS แล้ว) กรอกใหม่อีกครั้ง" }, { status: 401 })
    if (err instanceof AtmsSessionError)
      return NextResponse.json({ code: "expired", error: "PHPSESSID หมดอายุ — วางค่าใหม่แล้วลองอีกครั้ง" }, { status: 401 })
    if (err instanceof AtmsNetworkError || err instanceof AtmsLoginNetworkError)
      return NextResponse.json({ error: `ติดต่อ ATMS ไม่ได้: ${err.message}` }, { status: 502 })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  // sync สาขานี้สำเร็จแล้ว — ปิด/ปฏิเสธคำขอเปลี่ยนยางอัตโนมัติต่อเลยเฉพาะสาขานี้
  // (เหมือน cron/tire-sync แต่ขอบเขตแค่สาขาที่เพิ่ง sync) ครอบ try/catch กันพลาดแล้วทำให้
  // response การ sync หลักพัง — sync สำเร็จแล้วต้องคืนผลให้ผู้ใช้ได้ แม้ auto-resolve ล้ม
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let autoResolve: any = null
  try {
    autoResolve = await autoResolveTireRequests({ branches: [branch], rejectBranches: [branch] })
  } catch (err) {
    autoResolve = { error: err instanceof Error ? err.message : String(err) }
  }

  // tire_change เพิ่งเปลี่ยน — คำนวณ "ยางถึงกำหนดเปลี่ยน" ใหม่ด้วย ไม่งั้นแท็บนั้นค้างยางชุดเก่า
  // จนถึง cron รอบถัดไป (เคส สบ.72-3526: เปลี่ยนครบ 6 ล้อแล้วแต่ยังขึ้นเกินกำหนด 117%)
  // rebuild คิดทั้งฟลีต (ระยะจาก GPS/ค่าเที่ยวเป็นรายคัน) · ล้มก็ไม่ทำให้ผล sync หลักพัง
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let distance: any = null
  if (rebuild) {
    try {
      distance = await rebuildTireDistance()
    } catch (err) {
      distance = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  return NextResponse.json({ ...result, atmsUsername, autoResolve, distance })
}

function needLink() {
  return NextResponse.json({ code: "need_link", error: "ยังไม่ได้ผูกบัญชี ATMS — กรอกชื่อผู้ใช้และรหัสผ่าน ATMS ครั้งเดียว" }, { status: 401 })
}
