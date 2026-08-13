// app/api/ap-tracking/route.ts
import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import {
  parseDmy, parseAmount, dueDateOf, overdueDays, apStatusOf, nextThursday,
  type ApDocs, type ApStatus,
} from "@/lib/ap-tracking"

export const dynamic = "force-dynamic"

const MD = process.env.MONGO_DB ?? "master_data"
type Doc = Record<string, unknown>
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

// regex จับ received_at รูป "DD/MM/YYYY" ของเดือนที่ต้องการ (ฟิลด์เป็น string ใน ATMS)
const monthRe = (ym: string) => {
  const [y, m] = ym.split("-")
  return new RegExp(`^\\d{1,2}/${m}/${y}$`)
}
const prevMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (i + 1), 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
  })
}

// GET /api/ap-tracking?month=YYYY-MM&carryover=1&warehouse=&supplier=&status=&q=&limit=
export async function GET(req: NextRequest) {
  try {
    const sp        = req.nextUrl.searchParams
    const today     = new Date().toISOString().slice(0, 10)
    const rawMonth  = sp.get("month")?.trim() || today.slice(0, 7)
    const month     = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth) ? rawMonth : today.slice(0, 7)
    const carryover = sp.get("carryover") !== "0"
    const warehouse = sp.get("warehouse")?.trim() ?? ""
    const supplier  = sp.get("supplier")?.trim()  ?? ""
    const status    = sp.get("status")?.trim()    ?? ""
    const q         = sp.get("q")?.trim()         ?? ""
    const limitRaw  = parseInt(sp.get("limit") || "", 10)
    const limit     = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 8000) : 4000

    const client = await clientPromise
    const atms   = client.db("atms")
    const md     = client.db(MD)

    // 1) แถว DD ของเดือนที่เลือก (+ ย้อนหลัง 3 เดือนสำหรับใบค้าง) — bounded เสมอ
    const months  = carryover ? [month, ...prevMonths(month, 3)] : [month]
    const match: Record<string, unknown> = { $or: months.map((m) => ({ received_at: { $regex: monthRe(m) } })) }
    if (warehouse) match.warehouse = warehouse
    if (supplier)  match.supplier  = supplier

    const heads = await atms.collection("deposit_header")
      .find(match, { projection: {
        _id: 0, deposit_id: 1, deposit_code: 1, warehouse: 1, purchase_order: 1,
        supplier: 1, supplier_ref_no: 1, amount: 1, created_at: 1, received_at: 1,
      } })
      .limit(limit)
      .toArray() as Doc[]

    const codes    = heads.map((h) => s(h.deposit_code)).filter(Boolean)
    const poCodes  = [...new Set(heads.map((h) => s(h.purchase_order)).filter(Boolean))]
    const supNames = [...new Set(heads.map((h) => s(h.supplier)).filter(Boolean))]

    // 2) overlay: tracking + เครดิตเทอม + ข้อมูล PO (ทุกอันจำกัดด้วย $in จากชุดข้างบน)
    const [tracks, sups, pos] = await Promise.all([
      codes.length ? md.collection("ap_tracking").find({ depositCode: { $in: codes } }, { projection: { _id: 0, log: 0 } }).toArray() as Promise<Doc[]> : [],
      supNames.length ? md.collection("ap_supplier").find({ name: { $in: supNames } }, { projection: { _id: 0, name: 1, creditTerm: 1 } }).toArray() as Promise<Doc[]> : [],
      poCodes.length ? atms.collection("purchase_orders").find({ "รหัส": { $in: poCodes } }, { projection: { _id: 0, "รหัส": 1, "รวม": 1, "กำหนดส่งสินค้า": 1, "สถานะการรับสินค้า": 1 } }).toArray() as Promise<Doc[]> : [],
    ])
    const trackBy = new Map(tracks.map((t) => [s(t.depositCode), t]))
    const termBy  = new Map(sups.map((x) => [s(x.name), s(x.creditTerm)]))
    const poBy    = new Map(pos.map((p) => [s(p["รหัส"]), p]))

    // 3) ประกอบแถว + คำนวณสถานะ
    const monthPrefix = month
    let rows = heads.map((h) => {
      const code       = s(h.deposit_code)
      const t          = trackBy.get(code)
      const docs       = (t?.docs ?? {}) as ApDocs
      const sentDate   = s(t?.sentDate)
      const receivedAt = parseDmy(h.received_at)
      const creditTerm = termBy.get(s(h.supplier)) ?? ""
      const dueDate    = dueDateOf(receivedAt, creditTerm)
      const po         = poBy.get(s(h.purchase_order))
      return {
        depositCode: code,
        depositId:   typeof h.deposit_id === "number" ? h.deposit_id : null,
        warehouse:   s(h.warehouse),
        purchaseOrder: s(h.purchase_order),
        supplier:    s(h.supplier),
        supplierRefNo: s(h.supplier_ref_no),
        amount:      parseAmount(h.amount),
        receivedAt,
        createdAt:   parseDmy(h.created_at),
        creditTerm, dueDate,
        overdue:     sentDate ? 0 : overdueDays(dueDate, today),
        docs,
        sentType:    s(t?.sentType),
        sentDate,
        note:        s(t?.note),
        status:      apStatusOf(docs, sentDate),
        carryover:   receivedAt.slice(0, 7) !== monthPrefix,
        poTotal:     parseAmount(po?.["รวม"]),
        poDue:       parseDmy(po?.["กำหนดส่งสินค้า"]),
        poStatus:    s(po?.["สถานะการรับสินค้า"]),
      }
    })

    // ใบเดือนก่อนแสดงเฉพาะที่ยังไม่ส่งบัญชี (ค้างยกมา) — ที่จบแล้วไม่ต้องรก
    rows = rows.filter((r) => !r.carryover || r.status !== "ส่งบัญชีแล้ว")

    if (status) rows = rows.filter((r) => r.status === status)
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      rows = rows.filter((r) => rx.test(r.depositCode) || rx.test(r.purchaseOrder) || rx.test(r.supplier) || rx.test(r.supplierRefNo))
    }
    rows.sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || "") || b.depositCode.localeCompare(a.depositCode))

    // 4) summary
    const blank = () => ({ n: 0, amount: 0 })
    const byStatus: Record<string, { n: number; amount: number }> = {
      "รอประกบ": blank(), "ครบชุด": blank(), "ส่งบัญชีแล้ว": blank(),
    }
    const overdue = blank(), unsentAging = { notDue: blank(), due7: blank(), overdue: blank() }
    const thu = nextThursday(today)
    const thisThursday = { date: thu, n: 0, amount: 0 }
    for (const r of rows) {
      const b = byStatus[r.status]; b.n++; b.amount += r.amount
      if (r.status !== "ส่งบัญชีแล้ว") {
        if (r.overdue > 0) { overdue.n++; overdue.amount += r.amount; unsentAging.overdue.n++; unsentAging.overdue.amount += r.amount }
        else if (r.dueDate && overdueDays(r.dueDate, addDays(today, 7)) > 0) { unsentAging.due7.n++; unsentAging.due7.amount += r.amount }
        else { unsentAging.notDue.n++; unsentAging.notDue.amount += r.amount }
      }
      if (r.sentType === "นอกรอบ" && r.sentDate === thu) { thisThursday.n++; thisThursday.amount += r.amount }
    }

    const dataAsOf = heads.reduce((mx, h) => {
      const c = parseDmy(h.created_at)
      return c > mx ? c : mx
    }, "")
    return NextResponse.json({
      rows,
      summary: { total: rows.length, byStatus: byStatus as Record<ApStatus, { n: number; amount: number }>, overdue, thisThursday, unsentAging, dataAsOf },
    })
  } catch (e) {
    console.error("[ap-tracking] GET failed", e)
    return NextResponse.json({ error: "โหลดข้อมูลไม่สำเร็จ" }, { status: 500 })
  }
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
