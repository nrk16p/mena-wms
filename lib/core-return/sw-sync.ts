// lib/core-return/sw-sync.ts — ใบเบิก WMS ที่ได้ WD แล้ว → แถว "รอคืนซาก" ใน core_return_base
//   อู่ใน/อู่นอก: ตอน ISSUED · หนึ่งแถวต่อบรรทัดที่จ่ายจริง (issuedQty > 0)  key = sw:<no>:<lineIndex>
//   Mobile/PM:   ตอน SETTLED · หนึ่งแถวต่อแถวสรุปการใช้ (ทะเบียน/MR ของแถวนั้น) key = sw:<no>:<lineIndex>:<usageIndex>
// รันซ้ำได้ ($setOnInsert ไม่ทับสถานะที่บันทึกแล้ว) · เรียกหลังบันทึกผล ATMS สำเร็จเท่านั้น · พังก็ไม่กระทบใบเบิก (syncCoreRowsSafe)
// กันซ้ำกับฐาน ATMS (load_base.py): แถว ATMS ที่มี wdCode+skuCode ตรงกับแถว source "wms.store-withdraw" = ข้าม (hasWmsRow)
import type { SwRequest } from "@/lib/store-withdraw/types"
import { todayBkk, type Actor, type CoreStatus } from "./core"
import { baseCol, writeCoreLog } from "./db"

export const WMS_SOURCE = "wms.store-withdraw"

// จุดประสงค์ที่ไม่มีซากคืน — ชุดเดียวกับที่ build_local.py ตัดทิ้งตอนทำฐาน ATMS
const NO_CORE_PURPOSE = new Set([
  "เบิกเพื่อทำความสะอาด", "PM-บำรุงรักษารถร่วม", "ยาง", "ค่ายางรถร่วม", "ค่าซ่อม/ค่าอะไหล่รถร่วม",
  "ค่าซ่อม/ค่าอะไหล่รถร่วมภายนอก(พจน.)", "คืนสินค้าซัพพลายเออร์",
])
export function purposeHasCore(pickToName: string | null | undefined): boolean {
  const p = (pickToName ?? "").trim()
  return !(NO_CORE_PURPOSE.has(p) || p.startsWith("T-") || p.includes("ร่วม"))
}

export const swCoreKey = (no: string, lineIndex: number, usageIndex?: number | null) =>
  usageIndex == null ? `sw:${no}:${lineIndex}` : `sw:${no}:${lineIndex}:${usageIndex}`

type Planned = { row_key: string; lineIndex: number; usageIndex: number | null; plate: string; mrCode: string | null; mrItemLabel: string | null; wdCode: string | null; qty: number }

/** อู่ของแถวจากใบเบิก WMS ตามประเภทงาน (อู่ใน = อู่ของสาขา · อู่นอก = ยังไม่รู้ชื่อ เว้นแต่อ้าง PO/DD · Mobile/PM) */
export function garageOf(r: Pick<SwRequest, "workType" | "kind" | "inventoryName" | "ref">): { garageType: string; garage: string; garageSource: string } {
  const wt = r.workType ?? (r.kind === "cutoff" ? "garage_out" : "garage_in")
  const branch = (r.inventoryName ?? "").replace(/^คลัง\s*/, "").trim()
  if (wt === "mobile_pm") return { garageType: "Mobile/PM", garage: `Mobile/PM ${branch}`.trim(), garageSource: "ใบเบิก WMS (Mobile/PM)" }
  if (wt === "garage_out") {
    const ref = r.ref?.code ? ` (อ้าง ${r.ref.type.toUpperCase()} ${r.ref.code})` : ""
    return { garageType: "อู่นอก", garage: "ไม่ทราบชื่ออู่", garageSource: `ใบเบิก WMS อู่นอก${ref}` }
  }
  return { garageType: "อู่ใน", garage: `อู่ใน ${branch}`.trim(), garageSource: "ใบเบิก WMS (อู่ใน)" }
}

/** แถวที่ควรมีของใบนี้ (ยังไม่ได้ WD = ว่าง) */
export function planCoreRows(r: SwRequest): Planned[] {
  if (!purposeHasCore(r.pickToName)) return []
  const out: Planned[] = []
  if (r.status === "SETTLED" && r.summary) {
    r.summary.usages.forEach((u, ui) => {
      if (!(u.qty > 0)) return
      const g = (r.settleGroups ?? []).find((x) => x.status === "DONE" && x.plate === u.plate && x.lines.some((l) => l.lineIndex === u.lineIndex && l.mrItemId === u.mrItemId))
      const wd = g?.atms.code ?? null
      if (!wd) return
      out.push({ row_key: swCoreKey(r.no, u.lineIndex, ui), lineIndex: u.lineIndex, usageIndex: ui, plate: u.plate, mrCode: u.mrCode || null, mrItemLabel: u.mrItemLabel || null, wdCode: wd, qty: u.qty })
    })
    return out
  }
  if ((r.status === "ISSUED" || r.status === "RECEIVED") && r.atms.code && r.atms.approved) {
    r.lines.forEach((l, i) => {
      const qty = l.issuedQty ?? l.requestedQty
      if (!(qty > 0)) return
      out.push({ row_key: swCoreKey(r.no, i), lineIndex: i, usageIndex: null, plate: r.plate, mrCode: r.mrCode, mrItemLabel: l.mrItemLabel, wdCode: r.atms.code, qty })
    })
  }
  return out
}

/** สร้างแถวที่ยังไม่มี · คืน {created, keys} · แข่งกันสร้าง = unique row_key ตัวเดียวได้ (อีกตัวถือว่ามีแล้ว) */
export async function syncCoreRowsForRequest(r: SwRequest, actor: Actor, now = new Date()) {
  const plan = planCoreRows(r)
  if (!plan.length) return { created: 0, keys: [] as string[] }
  const col = await baseCol()
  const issuedDate = todayBkk(r.updatedAt ?? now) // วันที่ได้ WD (ISSUED/SETTLED อัปเดต updatedAt ตอนเปลี่ยนสถานะ)
  let created = 0
  for (const p of plan) {
    const l = r.lines[p.lineIndex]
    let upserted = false
    try {
      const res = await col.updateOne({ row_key: p.row_key }, {
        $setOnInsert: {
          row_key: p.row_key, issuedDate, yearMonth: issuedDate.slice(0, 7), warehouse: r.inventoryName, wdCode: p.wdCode, mrCode: p.mrCode,
          purpose: r.pickToName, skuCode: l.skuCode, skuName: l.skuName, productGroup: null, vehicleNo: null, plate: p.plate,
          driver: null, serialNo: null, qtyIssued: p.qty, unitCost: null, amount: null, remark: r.remark || null, source: WMS_SOURCE,
          legacySheet: null, legacyRound: null, legacyNote: null, coreStatus: "pending" as CoreStatus, coreQtyReturned: 0, createdAt: now, loadedAt: now,
          ...garageOf(r),
          swNo: r.no, swLineIndex: p.lineIndex, swUsageIndex: p.usageIndex, mrItemLabel: p.mrItemLabel,
          requester: { email: r.requestedBy.email.trim().toLowerCase(), name: r.requestedBy.name },
        },
      }, { upsert: true })
      upserted = res.upsertedCount > 0
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e
    }
    if (upserted) {
      created++
      await writeCoreLog({ row_key: p.row_key, action: "create", from: null, to: "pending", actor: { email: actor.email, name: actor.name, via: actor.via }, data: { swNo: r.no, lineIndex: p.lineIndex, usageIndex: p.usageIndex, wdCode: p.wdCode } }, now)
    }
  }
  return { created, keys: plan.map((p) => p.row_key) }
}

/** เรียกจากขั้นตอนตัดสต๊อก: ห้าม throw · ห้ามทำให้ใบเบิกล้ม — พลาดให้ log แล้วค่อยเก็บตกด้วย scripts/backfill-core-return-from-sw.ts */
export async function syncCoreRowsSafe(r: SwRequest, actor: Actor): Promise<void> {
  try {
    await syncCoreRowsForRequest(r, actor)
  } catch (e) {
    console.error("[core-return] สร้างแถวรอคืนซากไม่สำเร็จ (ใบเบิกไม่กระทบ) ", r.no, e instanceof Error ? e.message : e)
  }
}

/** กติกากันซ้ำให้ loader ฝั่ง ATMS: มีแถว WMS ที่ WD+SKU เดียวกันแล้ว = ข้ามแถว ATMS นั้น */
export async function hasWmsRow(wdCode: string, skuCode: string): Promise<boolean> {
  return (await (await baseCol()).countDocuments({ wdCode, skuCode, source: WMS_SOURCE }, { limit: 1 })) > 0
}
