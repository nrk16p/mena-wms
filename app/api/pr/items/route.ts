import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

export const dynamic = "force-dynamic"

const PR_KEY = "ใบขอสั่งซื้อ (PR)"
const PO_KEY = "รหัส"
type Doc = Record<string, unknown>
const s = (v: unknown) => (v == null ? "" : String(v)).trim()
const n = (v: unknown) => Number(v) || 0
const round2 = (x: number) => Math.round(x * 100) / 100

type Line = { sku: string; name: string; group: string; qty: number; total: number }

// รวม item ตาม SKU
function groupBySku(items: Doc[]): Map<string, Line & { received: number; outstanding: number }> {
  const m = new Map<string, Line & { received: number; outstanding: number }>()
  for (const it of items) {
    const sku = s(it.sku) || s(it.name)
    if (!sku) continue
    const cur = m.get(sku) ?? { sku, name: s(it.name), group: s(it.group), qty: 0, total: 0, received: 0, outstanding: 0 }
    cur.qty   += n(it.amount)
    cur.total += n(it.total)
    cur.received    += n(it.received)
    cur.outstanding += n(it.outstanding)
    if (!cur.name) cur.name = s(it.name)
    m.set(sku, cur)
  }
  return m
}

// GET /api/pr/items?pr=SBPR26070562 — เทียบรายการสินค้า PR ↔ PO ราย SKU
export async function GET(req: NextRequest) {
  try {
    const pr = req.nextUrl.searchParams.get("pr")?.trim() ?? ""
    if (!pr) return NextResponse.json({ error: "pr is required" }, { status: 400 })

    const client = await clientPromise
    const db = client.db("atms")

    // po codes ของ PR นี้ — ไม่นับ PO ที่ถูกยกเลิก (จะได้ไม่ขึ้น "เกินใน PO"/ยอดเพี้ยน)
    const poDocs = await db.collection("purchase_orders").find({ [PR_KEY]: pr }).project({ [PO_KEY]: 1, "สถานะการรับสินค้า": 1, _id: 0 }).toArray() as Doc[]
    const poCodes = poDocs
      .filter((d) => !s(d["สถานะการรับสินค้า"]).includes("ยกเลิก"))
      .map((d) => s(d[PO_KEY])).filter(Boolean)

    const prItems = await db.collection("purchase_request_items").find({ pr_code: pr }).toArray() as Doc[]
    const poItems = poCodes.length
      ? await db.collection("purchase_order_items").find({ po_code: { $in: poCodes } }).toArray() as Doc[]
      : []

    const prBy = groupBySku(prItems)
    const poBy = groupBySku(poItems)
    const skus = [...new Set([...prBy.keys(), ...poBy.keys()])]

    const rows = skus.map((sku) => {
      const p = prBy.get(sku)
      const o = poBy.get(sku)
      let status: "ok" | "qty" | "price" | "missing_po" | "extra_po"
      if (p && !o)      status = "missing_po"        // มีใน PR ไม่มีใน PO
      else if (!p && o) status = "extra_po"          // มีใน PO ไม่มีใน PR
      else {
        const qtyMatch = Math.abs((p!.qty) - (o!.qty)) < 0.001
        // PO ถูกกว่า/เท่ากับ PR(+VAT) = ตรง · "ราคาต่าง" เฉพาะ PO แพงกว่าที่คาด
        const amountOk = o!.total <= p!.total * 1.07 + 0.05
        status = !qtyMatch ? "qty" : (amountOk ? "ok" : "price")
      }
      return {
        sku,
        name:  p?.name || o?.name || "",
        group: p?.group || o?.group || "",
        pr_qty:   p ? p.qty : null,
        pr_total: p ? round2(p.total) : null,
        po_qty:   o ? o.qty : null,
        po_total: o ? round2(o.total) : null,
        received:    o ? o.received : null,
        outstanding: o ? o.outstanding : null,
        status,
      }
    }).sort((a, b) => (a.status === "ok" ? 1 : 0) - (b.status === "ok" ? 1 : 0) || a.sku.localeCompare(b.sku))

    const summary = { ok: 0, qty: 0, price: 0, missing_po: 0, extra_po: 0 }
    for (const r of rows) summary[r.status]++

    // ── ยังไม่มี PO (ขั้นเปิด PR) → เทียบกับราคากลาง (atms.price_benchmark, snapshot ล่าสุด) ──
    // ต่อ SKU: ราคากลางรวม = median ถ่วงด้วยจำนวนครั้งซื้อของแต่ละร้าน · ช่วง min–max · เจ้าถูกสุด
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let benchmark: any[] | null = null
    let benchmark_month = ""
    if (poCodes.length === 0 && prItems.length > 0) {
      const bmCol = db.collection("price_benchmark")
      const latest = await bmCol.find({}).project({ snapshot_month: 1, _id: 0 }).sort({ snapshot_month: -1 }).limit(1).next() as Doc | null
      benchmark_month = s(latest?.snapshot_month)
      if (benchmark_month) {
        const skus = [...prBy.keys()]
        const bmDocs = await bmCol.find({ snapshot_month: benchmark_month, "รหัสสินค้า": { $in: skus } })
          .project({ "รหัสสินค้า": 1, "ซัพพลายเออร์": 1, benchmark_price: 1, min_price_trimmed: 1, max_price_trimmed: 1, min_price: 1, max_price: 1, total_records: 1, _id: 0 })
          .toArray() as Doc[]
        const bySku = new Map<string, Doc[]>()
        for (const d of bmDocs) {
          const k = s(d["รหัสสินค้า"]); if (!k) continue
          if (!bySku.has(k)) bySku.set(k, [])
          bySku.get(k)!.push(d)
        }
        benchmark = skus.map((sku) => {
          const p = prBy.get(sku)!
          const unitPrice = p.qty > 0 ? round2(p.total / p.qty) : p.total
          const docs = bySku.get(sku) ?? []
          if (!docs.length) {
            return { sku, name: p.name, pr_qty: p.qty, pr_total: round2(p.total), pr_unit: unitPrice, found: false }
          }
          // median ถ่วงน้ำหนักด้วยจำนวนครั้งซื้อ
          const weighted: number[] = []
          for (const d of docs) {
            const w = Math.max(1, n(d.total_records))
            for (let i = 0; i < w; i++) weighted.push(n(d.benchmark_price))
          }
          weighted.sort((a, b) => a - b)
          const mid = round2(weighted[Math.floor(weighted.length / 2)])
          const mins = docs.map((d) => n(d.min_price_trimmed) || n(d.min_price)).filter((x) => x > 0)
          const maxs = docs.map((d) => n(d.max_price_trimmed) || n(d.max_price)).filter((x) => x > 0)
          const cheapest = docs.reduce((a, d) => (n(d.benchmark_price) < n(a.benchmark_price) ? d : a), docs[0])
          const diffPct = mid > 0 ? round2(((unitPrice - mid) / mid) * 100) : null
          return {
            sku, name: p.name, pr_qty: p.qty, pr_total: round2(p.total), pr_unit: unitPrice,
            found: true,
            mid_price: mid,
            min_price: mins.length ? Math.min(...mins) : null,
            max_price: maxs.length ? Math.max(...maxs) : null,
            cheapest_price: n(cheapest.benchmark_price),
            cheapest_supplier: s(cheapest["ซัพพลายเออร์"]),
            supplier_count: docs.length,
            record_count: docs.reduce((a, d) => a + n(d.total_records), 0),
            diff_pct: diffPct,
          }
        })
      }
    }

    return NextResponse.json({
      pr,
      has_pr_items: prItems.length > 0,
      has_po_items: poItems.length > 0,
      pr_item_count: prItems.length,
      po_item_count: poItems.length,
      rows,
      summary,
      benchmark,
      benchmark_month,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
