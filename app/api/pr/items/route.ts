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

    // po codes ของ PR นี้
    const poDocs = await db.collection("purchase_orders").find({ [PR_KEY]: pr }).project({ [PO_KEY]: 1, _id: 0 }).toArray() as Doc[]
    const poCodes = poDocs.map((d) => s(d[PO_KEY])).filter(Boolean)

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
        const totalMatch = Math.abs(p!.total - o!.total) < 0.01 || Math.abs(o!.total - p!.total * 1.07) < 0.05
        status = !qtyMatch ? "qty" : (totalMatch ? "ok" : "price")
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

    return NextResponse.json({
      pr,
      has_pr_items: prItems.length > 0,
      has_po_items: poItems.length > 0,
      pr_item_count: prItems.length,
      po_item_count: poItems.length,
      rows,
      summary,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
