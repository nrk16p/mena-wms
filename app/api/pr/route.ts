import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

export const dynamic = "force-dynamic"

const PR_KEY = "ใบขอสั่งซื้อ (PR)"
const PO_KEY = "รหัส"

type Doc = Record<string, unknown>
const s = (v: unknown) => (v == null ? "" : String(v)).trim()
const round2 = (n: number) => Math.round(n * 100) / 100

const nn = (v: unknown) => Number(v) || 0

// "DD/MM/YYYY" → "YYYY-MM-DD" (ปี ค.ศ.)
function toISO(d: string): string {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ""
}

// เทียบ line item PR↔PO → ครบไหม (ทุก SKU ใน PR มีใน PO + จำนวน/ยอดตรง; เผื่อ VAT 7%)
function itemsComplete(prItems: Doc[], poItems: Doc[]): { hasItems: boolean; complete: boolean } {
  const group = (arr: Doc[]) => {
    const m = new Map<string, { qty: number; total: number }>()
    for (const it of arr) {
      const k = s(it.sku) || s(it.name)
      if (!k) continue
      const c = m.get(k) ?? { qty: 0, total: 0 }
      c.qty += nn(it.amount); c.total += nn(it.total)
      m.set(k, c)
    }
    return m
  }
  const P = group(prItems), O = group(poItems)
  if (P.size === 0 && O.size === 0) return { hasItems: false, complete: false }
  for (const [sku, p] of P) {
    const o = O.get(sku)
    if (!o) return { hasItems: true, complete: false }               // ขาดใน PO
    const qtyMatch = Math.abs(p.qty - o.qty) < 0.001
    const totalMatch = Math.abs(p.total - o.total) < 0.01 || Math.abs(o.total - p.total * 1.07) < 0.05
    if (!qtyMatch || !totalMatch) return { hasItems: true, complete: false }
  }
  return { hasItems: true, complete: true }
}

// กฎ VAT ของ PR ตามคลัง/สาขา:
//  incl = PR ราคารวม VAT อยู่แล้ว → คาดว่า PR = PO        (DIST, สระบุรี)
//  excl = PR ราคาไม่รวม VAT (ที่เหลือทุกสาขา) → คาดว่า PO = PR×1.07
function vatRule(warehouse: string): "incl" | "excl" {
  if (/สระบุรี|DIST/i.test(warehouse)) return "incl"
  return "excl"
}

// ความสัมพันธ์ยอดจริง PR↔PO
function relationOf(prTotal: number, poTotal: number): "eq" | "po7" | "other" {
  if (Math.abs(prTotal - poTotal) < 0.01) return "eq"          // เท่ากัน
  if (Math.abs(poTotal - prTotal * 1.07) < 0.05) return "po7"  // PO = PR + VAT 7%
  return "other"
}

// สถานะสรุป: ถูกต้องตามกฎสาขา (ok) / ผิดปกติ (anomaly) / ยังไม่มี PO (no_po)
function statusOf(rule: "incl" | "excl", rel: "eq" | "po7" | "other", poCount: number): "ok" | "anomaly" | "no_po" {
  if (poCount === 0) return "no_po"
  if (rule === "incl") return rel === "eq"  ? "ok" : "anomaly"
  return rel === "po7" ? "ok" : "anomaly"   // excl
}

// GET /api/pr — PR ที่อนุมัติแล้ว (is approved = true) แต่ยังไม่มี DD (ไม่มีการรับของ)
// join: PR → PO (ใบขอสั่งซื้อ (PR)) → DD (deposit_header.purchase_order)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const q         = searchParams.get("q")?.trim()         ?? ""
    const warehouse = searchParams.get("warehouse")?.trim() ?? ""
    const dept      = searchParams.get("dept")?.trim()      ?? ""
    const limit     = Math.min(parseInt(searchParams.get("limit") ?? "1000"), 5000)

    const client = await clientPromise
    const db     = client.db("atms")
    const prCol  = db.collection("purchase_requests")
    const poCol  = db.collection("purchase_orders")
    const ddCol  = db.collection("deposit_header")

    // 1) PR ที่อนุมัติแล้ว + ตัวกรอง
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prFilter: Record<string, any> = { "is approved": true }
    if (warehouse) prFilter["คลังสินค้า"] = warehouse
    if (dept)      prFilter["แผนก"]       = dept
    if (q) {
      prFilter["$or"] = [
        { [PR_KEY]:      { $regex: q, $options: "i" } },
        { "ทะเบียน":     { $regex: q, $options: "i" } },
        { "ผู้ขอซื้อ":    { $regex: q, $options: "i" } },
        { "หมายเหตุ":    { $regex: q, $options: "i" } },
        { "คลังสินค้า":   { $regex: q, $options: "i" } },
        { "แผนก":        { $regex: q, $options: "i" } },
      ]
    }

    const prs = await prCol.find(prFilter).sort({ "วันที่": -1, _id: -1 }).limit(limit).toArray() as Doc[]
    const prCodes = prs.map((p) => s(p[PR_KEY])).filter(Boolean)

    // 2) PO ของ PR เหล่านี้ → map pr → [po], po → received status
    const pos = prCodes.length
      ? await poCol.find({ [PR_KEY]: { $in: prCodes } }).project({ [PO_KEY]: 1, [PR_KEY]: 1, "สถานะการรับสินค้า": 1, "ซัพพลายเออร์": 1, "รวม": 1, "วันที่": 1, "กำหนดส่งสินค้า": 1, "ผู้ใช้งาน": 1, "approver": 1, _id: 0 }).toArray() as Doc[]
      : []
    const posByPr = new Map<string, Doc[]>()
    const allPoCodes: string[] = []
    for (const po of pos) {
      const pr = s(po[PR_KEY]); const code = s(po[PO_KEY])
      if (!pr) continue
      if (!posByPr.has(pr)) posByPr.set(pr, [])
      posByPr.get(pr)!.push(po)
      if (code) allPoCodes.push(code)
    }

    // 3) DD ที่อ้าง PO เหล่านี้ → เซ็ตของ po ที่มีการรับของแล้ว
    const ddPoCodes = allPoCodes.length
      ? await ddCol.distinct("purchase_order", { purchase_order: { $in: allPoCodes } }) as string[]
      : []
    const receivedPo = new Set(ddPoCodes.map(s).filter(Boolean))

    // 3.5) ข้อมูลติดตาม (master_data.pr_tracking) — วันกำหนดส่งที่ผู้ใช้กรอก
    const trackDocs = prCodes.length
      ? await client.db("master_data").collection("pr_tracking").find({ prCode: { $in: prCodes } }).toArray() as Doc[]
      : []
    const trackByPr = new Map(trackDocs.map((t) => [s(t.prCode), t]))
    const todayBKK = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)  // วันนี้ (Asia/Bangkok)

    // 3.6) line items (detail_id สำหรับลิงก์ + เทียบความครบราย SKU)
    const prItemDocs = prCodes.length
      ? await db.collection("purchase_request_items").find({ pr_code: { $in: prCodes } }).project({ pr_code: 1, detail_id: 1, sku: 1, name: 1, amount: 1, total: 1, _id: 0 }).toArray() as Doc[]
      : []
    const prDetailId = new Map<string, string>()
    const prItemsByPr = new Map<string, Doc[]>()
    for (const d of prItemDocs) {
      const c = s(d.pr_code); if (!c) continue
      if (!prDetailId.has(c)) prDetailId.set(c, s(d.detail_id))
      if (!prItemsByPr.has(c)) prItemsByPr.set(c, [])
      prItemsByPr.get(c)!.push(d)
    }
    const poItemDocs = allPoCodes.length
      ? await db.collection("purchase_order_items").find({ po_code: { $in: allPoCodes } }).project({ po_code: 1, detail_id: 1, sku: 1, name: 1, amount: 1, total: 1, _id: 0 }).toArray() as Doc[]
      : []
    const poDetailId = new Map<string, string>()
    const poItemsByPo = new Map<string, Doc[]>()
    for (const d of poItemDocs) {
      const c = s(d.po_code); if (!c) continue
      if (!poDetailId.has(c)) poDetailId.set(c, s(d.detail_id))
      if (!poItemsByPo.has(c)) poItemsByPo.set(c, [])
      poItemsByPo.get(c)!.push(d)
    }

    // 4) เก็บเฉพาะ PR ที่ "ไม่มี DD" (ไม่มี PO ตัวไหนถูกรับของเลย — รวม PR ที่ยังไม่มี PO)
    const rows = prs
      .map((p) => {
        const pr = s(p[PR_KEY])
        const myPos = posByPr.get(pr) ?? []
        const hasDD = myPos.some((po) => receivedPo.has(s(po[PO_KEY])))
        return { p, pr, myPos, hasDD }
      })
      .filter((r) => !r.hasDD)
      .map(({ p, pr, myPos }) => {
        const warehouse = s(p["คลังสินค้า"])
        const prTotal = typeof p["รวม"] === "number" ? (p["รวม"] as number) : Number(p["รวม"]) || 0
        const poTotal = round2(myPos.reduce((a, po) => a + (Number(po["รวม"]) || 0), 0))
        const rule = vatRule(warehouse)
        const rel  = relationOf(prTotal, poTotal)
        const cmp  = statusOf(rule, rel, myPos.length)

        // ── ติดตามสินค้า ──
        // วันกำหนดส่งตั้งต้นจาก PO (เอาวันเร็วสุด) แล้วให้ manual override
        const poDues = myPos.map((po) => toISO(s(po["กำหนดส่งสินค้า"]))).filter(Boolean).sort()
        const poDue  = poDues[0] || ""
        const tr = trackByPr.get(pr)
        const manualDue = tr ? s(tr.expectedDelivery) : ""
        const expectedDelivery = manualDue || poDue
        const expectedSource: "manual" | "po" | "none" = manualDue ? "manual" : (poDue ? "po" : "none")
        // สถานะติดตาม: pr (ยังไม่มี PO) → po (มี PO) → waiting (มีวันกำหนดส่งแล้ว)
        const track: "pr" | "po" | "waiting" = myPos.length === 0 ? "pr" : (expectedDelivery ? "waiting" : "po")
        // เทียบวันกำหนดส่งกับวันนี้ (BKK)
        const daysToDue = expectedDelivery ? Math.round((Date.parse(expectedDelivery) - Date.parse(todayBKK)) / 86400000) : null
        const overdue = track === "waiting" && daysToDue !== null && daysToDue < 0
        // ความครบราย SKU (ยอด+รายการ) — ใช้ item ถ้ามี ไม่งั้น fallback ยอดรวม (cmp)
        const prItems = prItemsByPr.get(pr) ?? []
        const poItems = myPos.flatMap((po) => poItemsByPo.get(s(po[PO_KEY])) ?? [])
        const cmpItems = itemsComplete(prItems, poItems)
        const complete = cmpItems.hasItems ? cmpItems.complete : (cmp === "ok")
        // สถานะหลัก (pipeline):
        //  เปิด PR → เปิด PO ไม่ครบ (บล็อก) → [ครบ] กำหนดส่ง/เกินกำหนด (หรือ เปิด PO ยอดครบ ถ้ายังไม่มีวัน)
        const stage: "pr" | "po_ok" | "po_bad" | "due" | "overdue" =
          myPos.length === 0 ? "pr"
          : !complete        ? "po_bad"
          : expectedDelivery ? (overdue ? "overdue" : "due")
          : "po_ok"

        return {
          pr_code:   pr,
          date:      s(p["วันที่"]),
          warehouse,
          dept:      s(p["แผนก"]),
          plate:     s(p["ทะเบียน"]),
          requester: s(p["ผู้ขอซื้อ"]),
          total:     prTotal,        // ยอด PR
          po_total:  poTotal,        // ยอด PO รวม
          po_diff:   round2(poTotal - prTotal),
          vat_rule:  rule,            // incl (PR=PO) | excl (PO=PR+7%)
          relation:  myPos.length ? rel : "none",
          cmp,                        // ok | anomaly | no_po
          note:      s(p["หมายเหตุ"]),
          po_codes:  myPos.map((po) => s(po[PO_KEY])).filter(Boolean),
          po_count:  myPos.length,
          received_status: myPos.map((po) => s(po["สถานะการรับสินค้า"])).filter(Boolean),
          suppliers: [...new Set(myPos.map((po) => s(po["ซัพพลายเออร์"])).filter(Boolean))],
          pr_detail_id: prDetailId.get(pr) || "",
          pos: myPos.map((po) => ({
            code:     s(po[PO_KEY]),
            date:     s(po["วันที่"]),
            supplier: s(po["ซัพพลายเออร์"]),
            total:    Number(po["รวม"]) || 0,
            received: s(po["สถานะการรับสินค้า"]),
            approver: s(po["approver"]),
            due:      toISO(s(po["กำหนดส่งสินค้า"])),
            detail_id: poDetailId.get(s(po[PO_KEY])) || "",
          })),
          // ติดตาม
          po_due:            poDue,             // วันกำหนดส่งจาก PO (ISO)
          expected_delivery: expectedDelivery,  // วันคาดว่าจะได้รับ (manual || po)
          expected_source:   expectedSource,    // manual | po | none
          track,                                // pr | po | waiting
          stage,                                // pr | po_ok | po_bad | due | overdue (สถานะหลัก)
          complete,                             // ยอด+รายการครบไหม
          days_to_due:       daysToDue,         // >0 เหลืออีก, <0 เกินมาแล้ว, null ไม่มีวัน
          overdue,
        }
      })

    // นับตามสถานะสรุป + สถานะหลัก
    const byCmp = { ok: 0, anomaly: 0, no_po: 0 }
    for (const r of rows) byCmp[r.cmp]++
    const byStage = { pr: 0, po_ok: 0, po_bad: 0, due: 0, overdue: 0 }
    for (const r of rows) byStage[r.stage]++

    return NextResponse.json({
      count: rows.length,
      total_value: rows.reduce((a, r) => a + (r.total || 0), 0),
      no_po: byCmp.no_po,
      by_cmp: byCmp,
      by_stage: byStage,
      rows,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// GET filters helper is inline; distinct lists for dropdowns
export async function POST() {
  return NextResponse.json({ error: "not supported" }, { status: 405 })
}
