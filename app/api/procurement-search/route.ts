import clientPromise from "@/lib/mongo"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

function detectType(q: string): "WD" | "DD" | "MR" | "PO" | "PR" | "unknown" {
  const u = q.toUpperCase()
  if (u.includes("WD")) return "WD"
  if (u.includes("DD")) return "DD"
  if (u.includes("MR")) return "MR"
  if (/PO\d/.test(u)) return "PO"
  if (/PR\d/.test(u)) return "PR"
  return "unknown"
}

function summariseMR(rows: Record<string, unknown>[]) {
  if (!rows.length) return null
  const first = rows[0]
  return {
    request_id:        first.request_id,
    request_code:      first.request_code,
    reported_at:       first.reported_at,
    branch:            first.branch,
    plate_no:          first.plate_no,
    owner_type:        first.owner_type,
    mechanic:          first.mechanic,
    mileage_at_report: first.mileage_at_report,
    step:              first.step,
  }
}

// Normalise a purchase_orders doc to consistent English field aliases
function normalisePO(doc: Record<string, unknown>): Record<string, unknown> {
  return {
    ...doc,
    po_code:   doc["รหัส"],
    pr_code:   doc["ใบขอสั่งซื้อ (PR)"],
    supplier:  doc["ซัพพลายเออร์"],
    warehouse: doc["คลังสินค้า"],
    date:      doc["วันที่"],
    total:     doc["รวม"],
    status:    doc["สถานะการรับสินค้า"],
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const q = (searchParams.get("q") || "").trim()
    if (!q) return NextResponse.json({ error: "q is required" }, { status: 400 })

    const type = detectType(q)
    const client = await clientPromise
    const db = client.db("atms")

    const repairCol  = db.collection("repair-analysis")
    const ddCol      = db.collection("deposit_header")
    const itemsCol   = db.collection("deposit_items")
    const poCol      = db.collection("purchase_orders")
    const prCol      = db.collection("purchase_requests")

    let result: Record<string, unknown> = { query: q, type }

    // ── DD ────────────────────────────────────────────────────────────────────
    if (type === "DD") {
      const dd = await ddCol.findOne({ deposit_code: q }, { projection: { _id: 0 } })
      const ddDoc = dd as Record<string, unknown> | null
      const items = ddDoc
        ? await itemsCol.find({ deposit_id: ddDoc.deposit_id }, { projection: { _id: 0 } }).toArray()
        : []

      // WD → MR chain (repair-linked DDs)
      let mr = null
      let mr_parts: unknown[] = []
      const wd_code = (ddDoc?.withdraw_ref as string) || null
      if (wd_code) {
        const rows = await repairCol.find({ requisition_no: wd_code }, { projection: { _id: 0 } }).toArray()
        mr = summariseMR(rows as Record<string, unknown>[])
        mr_parts = rows
      }

      // PO → PR chain (purchase-linked DDs via deposit_header.purchase_order)
      const po_code = (ddDoc?.purchase_order as string) || null
      let po: Record<string, unknown> | null = null
      let pr_detail = null
      let pr_code: string | null = null
      if (po_code) {
        const poRaw = await poCol.findOne({ "รหัส": po_code }, { projection: { _id: 0 } })
        if (poRaw) {
          po = normalisePO(poRaw as Record<string, unknown>)
          pr_code = po["ใบขอสั่งซื้อ (PR)"] as string || null
          if (pr_code) {
            pr_detail = await prCol.findOne({ "ใบขอสั่งซื้อ (PR)": pr_code }, { projection: { _id: 0 } })
          }
        }
      }

      result = {
        ...result,
        dd: ddDoc, dd_items: items,
        mr, mr_parts, related_wds: wd_code ? [wd_code] : [],
        po, po_code: po_code || undefined,
        pr_code: pr_code || undefined, pr_detail,
      }
    }

    // ── WD ────────────────────────────────────────────────────────────────────
    else if (type === "WD") {
      const raRows = await repairCol.find({ requisition_no: q }, { projection: { _id: 0 } }).toArray()
      const mr = summariseMR(raRows as Record<string, unknown>[])

      const dds = await ddCol.find({ withdraw_ref: q }, { projection: { _id: 0 } }).toArray()
      const dep_ids = (dds as Record<string, unknown>[]).map(d => d.deposit_id)
      const dd_items = dep_ids.length
        ? await itemsCol.find({ deposit_id: { $in: dep_ids } }, { projection: { _id: 0 } }).toArray()
        : []

      result = { ...result, mr, mr_parts: raRows, dds, dd_items }
    }

    // ── MR — regex on request_code ───────────────────────────────────────────
    else if (type === "MR") {
      // Repair side: repair-analysis → WDs → repair DDs
      const raRows = await repairCol
        .find({ request_code: { $regex: q, $options: "i" } }, { projection: { _id: 0 } })
        .toArray()
      const mr = summariseMR(raRows as Record<string, unknown>[])

      const wds = [...new Set(
        (raRows as Record<string, unknown>[]).map(r => r.requisition_no as string).filter(Boolean)
      )]
      const repairDDs = wds.length
        ? await ddCol.find({ withdraw_ref: { $in: wds } }, { projection: { _id: 0 } }).toArray()
        : []

      // Purchase side: purchase_requests.หมายเหตุ contains MR code → PR → POs → purchase DDs
      const prsForMR = await prCol
        .find({ "หมายเหตุ": { $regex: q, $options: "i" } }, { projection: { _id: 0 } })
        .toArray()

      let pr_detail: Record<string, unknown> | null = null
      let pr_code: string | null = null
      let pos: Record<string, unknown>[] = []
      let purchaseDDs: Record<string, unknown>[] = []

      if (prsForMR.length > 0) {
        const prDoc = prsForMR[0] as Record<string, unknown>
        pr_detail = prDoc
        pr_code = prDoc["ใบขอสั่งซื้อ (PR)"] as string

        const posRaw = await poCol
          .find({ "ใบขอสั่งซื้อ (PR)": pr_code }, { projection: { _id: 0 } })
          .toArray()
        pos = (posRaw as Record<string, unknown>[]).map(normalisePO)
        const po_codes = pos.map(p => p.po_code as string).filter(Boolean)

        if (po_codes.length) {
          purchaseDDs = await ddCol
            .find({ purchase_order: { $in: po_codes } }, { projection: { _id: 0 } })
            .toArray()
        }
      }

      // Merge both DD sets (dedupe by deposit_id)
      const allDDs = [...repairDDs, ...(purchaseDDs as Record<string, unknown>[])]
      const seenIds = new Set<unknown>()
      const dds = allDDs.filter(d => {
        if (seenIds.has(d.deposit_id)) return false
        seenIds.add(d.deposit_id); return true
      })
      const dep_ids = dds.map(d => d.deposit_id)
      const dd_items = dep_ids.length
        ? await itemsCol.find({ deposit_id: { $in: dep_ids } }, { projection: { _id: 0 } }).toArray()
        : []

      result = {
        ...result,
        mr, mr_parts: raRows, wds, dds, dd_items,
        pos, pr_code: pr_code || undefined, pr_detail,
        linked_mr_code: q,
      }
    }

    // ── PO ────────────────────────────────────────────────────────────────────
    else if (type === "PO") {
      const dds = await ddCol.find({ purchase_order: q }, { projection: { _id: 0 } }).toArray()
      const dep_ids = (dds as Record<string, unknown>[]).map(d => d.deposit_id)
      const dd_items = dep_ids.length
        ? await itemsCol.find({ deposit_id: { $in: dep_ids } }, { projection: { _id: 0 } }).toArray()
        : []

      const poRaw = await poCol.findOne({ "รหัส": q }, { projection: { _id: 0 } })
      const po = poRaw ? normalisePO(poRaw as Record<string, unknown>) : null

      result = { ...result, po, dds, dd_items, po_code: q }
    }

    // ── PR ────────────────────────────────────────────────────────────────────
    else if (type === "PR") {
      // PR header doc (with หมายเหตุ)
      const pr_detail = await prCol.findOne(
        { "ใบขอสั่งซื้อ (PR)": q },
        { projection: { _id: 0 } }
      ) as Record<string, unknown> | null

      // Purchase side: POs → purchase DDs
      const posRaw = await poCol
        .find({ "ใบขอสั่งซื้อ (PR)": q }, { projection: { _id: 0 } })
        .toArray()
      const pos = (posRaw as Record<string, unknown>[]).map(normalisePO)
      const po_codes = pos.map(p => p.po_code as string).filter(Boolean)

      const purchaseDDs = po_codes.length
        ? await ddCol.find({ purchase_order: { $in: po_codes } }, { projection: { _id: 0 } }).toArray()
        : []

      // Repair side: extract MR code from หมายเหตุ → repair-analysis → WDs → repair DDs
      const note = (pr_detail?.["หมายเหตุ"] as string) || ""
      const mrMatch = note.match(/([A-Z]{2,4}MR\d{8})/i)
      const linked_mr_code = mrMatch ? mrMatch[1].toUpperCase() : null

      let mr = null
      let mr_parts: unknown[] = []
      let wds: string[] = []
      let repairDDs: Record<string, unknown>[] = []

      if (linked_mr_code) {
        const raRows = await repairCol
          .find({ request_code: { $regex: linked_mr_code, $options: "i" } }, { projection: { _id: 0 } })
          .toArray()
        mr = summariseMR(raRows as Record<string, unknown>[])
        mr_parts = raRows
        wds = [...new Set((raRows as Record<string, unknown>[]).map(r => r.requisition_no as string).filter(Boolean))]
        if (wds.length) {
          repairDDs = await ddCol
            .find({ withdraw_ref: { $in: wds } }, { projection: { _id: 0 } })
            .toArray()
        }
      }

      // Merge both DD sets (dedupe by deposit_id)
      const allDDs = [...(purchaseDDs as Record<string, unknown>[]), ...repairDDs]
      const seenIds = new Set<unknown>()
      const dds = allDDs.filter(d => {
        if (seenIds.has(d.deposit_id)) return false
        seenIds.add(d.deposit_id); return true
      })
      const dep_ids = dds.map(d => d.deposit_id)
      const dd_items = dep_ids.length
        ? await itemsCol.find({ deposit_id: { $in: dep_ids } }, { projection: { _id: 0 } }).toArray()
        : []

      result = {
        ...result,
        pr_detail, pos, dds, dd_items, pr_code: q,
        mr, mr_parts, wds,
        linked_mr_code: linked_mr_code || undefined,
      }
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
