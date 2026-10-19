// app/api/vendors/map/history/route.ts
// ประวัติการซ่อมของอู่รายเดียว — ใช้ตอนกดดูในหน้า "หาอู่ใกล้ที่สุด"
//
// ⚠ ห้ามยิง stockmovement_v5 ตรง ๆ ต่อการกด 1 ครั้ง: filter ด้วยชื่อซัพพลายเออร์ไม่มี index
// วัดแล้วกินเวลา 1.7 วิ และอ่าน 310,000 เอกสารต่อครั้ง (19/10/2569)
// จึงอ่านจาก getVendors() ที่สรุปไว้ให้ทุกอู่พร้อมกันและ cache 1 ชม. อยู่แล้ว
import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { getVendors } from "@/lib/vendor"
import { garageKey } from "@/lib/atms-garage"

export const dynamic = "force-dynamic"

const DB = process.env.MONGO_DB ?? "master_data"

export async function GET(req: NextRequest) {
  const vendor = (req.nextUrl.searchParams.get("vendor") ?? "").trim()
  if (!vendor) return NextResponse.json({ error: "ไม่พบชื่ออู่" }, { status: 400 })

  try {
    const k = garageKey(vendor)
    const db = (await clientPromise).db(DB)

    const [payload, jobs, dds] = await Promise.all([
      getVendors(),
      // ใบซ่อมนอกใน WMS (คอลเลกชันเล็ก กรองด้วยชื่ออู่ตรง ๆ ได้)
      db.collection("repair_external")
        .find({ garage: vendor }, {
          projection: { _id: 0, receivedDate: 1, completedDate: 1, mrNo: 1, plate: 1, fleetNo: 1, symptom: 1, status: 1, repairPrice: 1, warranty: 1 },
          sort: { receivedDate: -1 }, limit: 50,
        }).toArray(),
      // ใบรับของจาก ATMS — อู่หลายเจ้าไม่เคยถูกเปิดใบใน WMS แต่มีประวัติจัดซื้อยาว
      // วันที่ใน ATMS เป็นสตริง "DD/MM/YYYY HH:mm" — เรียงใน Mongo จะได้ลำดับผิด
      // (30/07 มาก่อน 29/01) จึงดึงของอู่นี้มาทั้งหมดแล้วเรียงด้วยวันที่จริงในโค้ด
      (await clientPromise).db("atms").collection("deposit_header")
        .find({ supplier: vendor }, {
          projection: { _id: 0, deposit_id: 1, deposit_code: 1, created_at: 1, received_at: 1, grand_total: 1, warehouse: 1, purchase_order: 1 },
        }).toArray(),
    ])

    const summary = payload.vendors.find((v) => garageKey(v.vendor) === k) ?? null
    const byService = payload.byService
      .filter((r) => garageKey(r.vendor) === k)
      .sort((a, b) => b.baht - a.baht)
      .map((r) => ({ serviceType: r.serviceType, jobs: r.jobs, baht: r.baht, avg: r.avg, vsMedian: r.vsMedian, lastYm: r.lastYm }))

    const money = (v: unknown) => Number(String(v ?? "0").replace(/,/g, "")) || 0
    /** "30/07/2026 10:50" → 20260730 (ใช้เรียงเท่านั้น) · อ่านไม่ออกให้ไปท้ายสุด */
    const dkey = (v: unknown) => {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v ?? ""))
      return m ? Number(m[3] + m[2] + m[1]) : 0
    }
    const ddSorted = [...dds]
      .sort((a, b) => dkey(b.received_at || b.created_at) - dkey(a.received_at || a.created_at))
      .slice(0, 50)
    // รายการสินค้า/ค่าแรงในใบที่จะแสดง — deposit_items มี index ที่ deposit_id จึงดึงเป็นชุดได้เร็ว
    const ids = ddSorted.map((d) => d.deposit_id).filter(Boolean)
    const items = ids.length
      ? await (await clientPromise).db("atms").collection("deposit_items")
          .find({ deposit_id: { $in: ids } }, { projection: { _id: 0, deposit_id: 1, item: 1, parts_group: 1, qty: 1, total: 1 } })
          .toArray()
      : []
    const itemsByDd = new Map<string, { item: string; group: string; qty: number; total: number }[]>()
    for (const it of items) {
      const key = String(it.deposit_id)
      const list = itemsByDd.get(key) ?? []
      list.push({ item: String(it.item ?? ""), group: String(it.parts_group ?? ""), qty: money(it.qty), total: money(it.total) })
      itemsByDd.set(key, list)
    }

    return NextResponse.json({
      vendor,
      status: summary?.status ?? "pending",
      totals: {
        jobs: summary?.jobs ?? 0,
        baht: summary?.baht ?? 0,
        lastYm: summary?.lastYm ?? "",
        monthsSince: summary?.monthsSince ?? null,
        wmsJobs: jobs.length,
        ddCount: dds.length,
        ddBaht: dds.reduce((s, d) => s + money(d.grand_total), 0),
      },
      byService,
      jobs,
      dds: ddSorted.map((d) => ({
        ...d,
        grand_total: money(d.grand_total),
        items: itemsByDd.get(String(d.deposit_id)) ?? [],
      })),
      fromYm: payload.fromYm,
    })
  } catch (e) {
    console.error("[vendors/map/history] ", e)
    return NextResponse.json({ error: "ดึงประวัติไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
