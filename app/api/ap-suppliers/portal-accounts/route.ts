// app/api/ap-suppliers/portal-accounts/route.ts — บัญชีพอร์ทัลเจ้าหนี้ (จัดการจากหน้า /ap-tracking/suppliers)
// สิทธิ์: อยู่ใต้ /api/ap-suppliers → middleware คุมด้วยส่วน "ap" (ดู = GET · แก้ = POST) ไม่ต้องเช็คซ้ำที่นี่
// รหัสผ่านโชว์ครั้งเดียวใน response ของ POST แล้วเก็บแค่ hash — ลืม = รีเซ็ตใหม่
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { todayICT } from "@/lib/ap-tracking"
import { vpAccountRows, vpWindowStart, normVpUsername, type VpAccountRow } from "@/lib/vendor-portal"
import { genVpPassword, hashVpPassword } from "@/lib/vendor-portal-auth"
import { VP_ACCOUNTS, vpDbs, vpAmbiguousSet, type VpAccount, type VpDbs } from "@/lib/vendor-portal-db"

export const dynamic = "force-dynamic"
export const maxDuration = 60   // ปุ่มสร้างทุกเจ้า: hash ทีละหลายร้อยรหัส

type Issued = { username: string; password: string; displayName: string }

async function loadRows(db: VpDbs): Promise<VpAccountRow[]> {
  const [sups, accounts] = await Promise.all([
    db.md.collection("ap_supplier").find({}, { projection: { _id: 0, name: 1, atmsCode: 1, lastDdAt: 1 }, maxTimeMS: 10000 }).limit(5000).toArray(),
    db.md.collection<VpAccount>(VP_ACCOUNTS).find({}, { projection: { _id: 0, username: 1, disabled: 1, loginCount: 1, lastLoginAt: 1, passwordSetAt: 1 }, maxTimeMS: 10000 }).limit(5000).toArray(),
  ])
  const names = sups.map((x) => String(x.name ?? "").trim()).filter(Boolean)
  const amb = await vpAmbiguousSet(db.atms, names)
  return vpAccountRows(sups as { name?: string; atmsCode?: unknown; lastDdAt?: string }[], amb, accounts as VpAccount[], vpWindowStart(todayICT()))
}

export async function GET() {
  try {
    const rows = await loadRows(await vpDbs())
    return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    console.error("[portal-accounts GET]", e)
    return NextResponse.json({ error: "โหลดรายชื่อบัญชีไม่สำเร็จ" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = String(body?.action ?? "")
  const code = normVpUsername(body?.atmsCode)
  const session = await getServerSession(authOptions)
  const by = session?.user?.name || session?.user?.email || ""
  const now = new Date().toISOString()

  try {
    const db = await vpDbs()
    const col = db.md.collection<VpAccount>(VP_ACCOUNTS)
    await col.createIndex({ username: 1 }, { unique: true })
    const rows = await loadRows(db)

    const issue = async (row: VpAccountRow): Promise<Issued> => {
      const password = genVpPassword()
      await col.insertOne({
        username: row.username, atmsCode: row.atmsCode, displayName: row.displayName,
        passwordHash: await hashVpPassword(password), passwordSetAt: now, passwordSetBy: by,
        tokenVersion: 0, disabled: false, failedCount: 0, lockedUntil: null, loginCount: 0,
        createdAt: now, createdBy: by,
      })
      return { username: row.username, password, displayName: row.displayName }
    }

    if (action === "bulk") {
      const todo = rows.filter((r) => r.eligible && r.recent && !r.account)
      const issued: Issued[] = []
      // ทีละ 8 — scrypt ใช้ thread pool ของ node ยิงพร้อมกันหมดไม่ได้เร็วขึ้น
      for (let i = 0; i < todo.length; i += 8) {
        const part = await Promise.all(todo.slice(i, i + 8).map((r) => issue(r).catch(() => null)))
        for (const x of part) if (x) issued.push(x)
      }
      return NextResponse.json({ issued })
    }

    const row = rows.find((r) => r.username && r.username === code)
    if (!row) return NextResponse.json({ error: "ไม่พบรหัสผู้ขายนี้" }, { status: 404 })

    if (action === "create") {
      if (!row.eligible) return NextResponse.json({ error: `สร้างบัญชีไม่ได้: ${row.reason}` }, { status: 400 })
      if (row.account) return NextResponse.json({ error: "เจ้านี้มีบัญชีแล้ว ใช้ปุ่มรีเซ็ตรหัสแทน" }, { status: 409 })
      return NextResponse.json({ issued: [await issue(row)] })
    }

    if (!row.account) return NextResponse.json({ error: "เจ้านี้ยังไม่มีบัญชี" }, { status: 404 })

    if (action === "reset") {
      const password = genVpPassword()
      await col.updateOne({ username: row.username }, {
        $set: { passwordHash: await hashVpPassword(password), passwordSetAt: now, passwordSetBy: by, failedCount: 0, lockedUntil: null, displayName: row.displayName },
        $inc: { tokenVersion: 1 },   // session เดิมของเจ้าหนี้หลุดทันที
      })
      return NextResponse.json({ issued: [{ username: row.username, password, displayName: row.displayName }] })
    }
    if (action === "disable" || action === "enable") {
      await col.updateOne({ username: row.username }, {
        $set: { disabled: action === "disable", updatedAt: now, updatedBy: by },
        ...(action === "disable" ? { $inc: { tokenVersion: 1 } } : {}),
      })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: "action ไม่ถูกต้อง" }, { status: 400 })
  } catch (e) {
    console.error("[portal-accounts POST]", e)
    return NextResponse.json({ error: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 })
  }
}
