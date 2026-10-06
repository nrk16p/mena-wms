// lib/ap-search-index.ts
// ค้นข้ามเดือนของหน้า AP (/api/ap-tracking/search) แบบในหน่วยความจำ — logic ล้วน ไม่แตะ DB
// ทดสอบด้วย scripts/check-ap-search-index.ts (เทียบกับคิวรี Mongo เดิมทุกตัวอักษร)
//
// เดิมยิง regex ไม่ยึดหัว (/q/i) 4–5 คิวรีต่อการพิมพ์หนึ่งครั้ง — ทุกคิวรี collscan ทั้ง collection
// (ไม่มี index ที่ใช้ได้: deposit_header มีแค่ deposit_id · purchase_orders มีแค่ รหัส)
// ตอนนี้ดึง "ภาพรวม" เฉพาะฟิลด์ที่ต้องใช้มาครั้งเดียว (lib/ap-search-db.ts) แล้วค้นตรงนี้
//
// ต้องได้ผลเหมือนคิวรีเดิมทุกตัวอักษร:
//   • จับคู่แบบ Mongo — regex จับเฉพาะค่าสตริง (หรือสมาชิกสตริงของอาร์เรย์) · $in เทียบเท่ากันตรงตัว (ไม่ trim)
//   • ลำดับ = natural order (ภาพรวมดึงแบบไม่ sort เหมือน .find().limit() เดิม) → เพดาน 40/60/60/60/60 ตัดชุดเดียวกัน
//   • แถวที่ไม่มีค่าให้จับเลยถูกทิ้งตอนสร้าง (ไม่มีทางติดผล จึงไม่กระทบเพดานหรือลำดับ)
// ทุกแถวเป็น JSON ล้วน (สตริง/ตัวเลข/boolean/null) — แคชกลางเก็บเป็น JSON ได้โดยไม่เพี้ยน
import { AP_NO_FIELDS, parseAmount, parseDmy } from "@/lib/ap-tracking"

type Doc = Record<string, unknown>

export const AP_SEARCH_LIMIT = 20
export const AP_SEARCH_MIN_Q = 3      // สั้นกว่านี้ = กว้างเกินกว่าจะมีความหมาย และกันยิงถี่ระหว่างพิมพ์

const PR_KEY = "ใบขอสั่งซื้อ (PR)"
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

// ค่าที่ regex/$in ของ Mongo "มองเห็น" ที่ฟิลด์นั้น: สตริง หรือสมาชิกที่เป็นสตริงของอาร์เรย์ (ไม่ trim)
const strs = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []

// dotted path แบบ Mongo — แตกอาร์เรย์ของ object ระหว่างทาง (เช่น paid เป็นลิสต์)
function strsAt(v: unknown, path: string[]): string[] {
  if (!path.length) return strs(v)
  if (Array.isArray(v)) return v.flatMap((el) => (el && typeof el === "object" && !Array.isArray(el) ? strsAt(el, path) : []))
  if (v && typeof v === "object") return strsAt((v as Doc)[path[0]], path.slice(1))
  return []
}

// ── แถวของภาพรวม ─────────────────────────────────────────────────────────────
/** master_data.ap_tracking — เลขที่เอกสาร 5 ช่อง + เลข PV (paid.paymentNos) */
export type ApTrackRow = { code: string; nos: string[] }
/** atms.purchase_orders — ทะเบียนรถ (ยานพาหนะ) + PR ที่ผูก */
export type ApPoRow = { code: string; vehicle: string[]; pr: string[] }
/** atms.purchase_requests — หมายเหตุ (เลขใบแจ้งซ่อม/ทะเบียน/ช่าง) */
export type ApPrRow = { pr: string; note: string[] }
/** atms.deposit_header — ทุกใบ (รวมคืนสต๊อกภายใน เพราะ /api/ap-tracking/[code] เปิดใบพวกนี้ได้) */
export type ApDdRow = {
  // ค่าที่ส่งออก (คิดจากค่าดิบด้วยสูตรเดียวกับ route เดิม)
  depositCode: string; purchaseOrder: string; supplier: string; warehouse: string; amount: number; receivedAt: string
  // ค่าดิบไว้จับคู่
  mCode: string[]; mRef: string[]; mSupplier: string[]; mPo: string[]
  internal: boolean          // supplier = "" และ purchase_order = "" → ตัดออกจากผลค้น ($nor เดิม)
  // สำหรับหัวใบของ [code]: deposit_id ดิบ · if (head.purchase_order) ดิบ
  depositId: number | string | null
  hasPo: boolean
  oddId?: true               // deposit_id ไม่ใช่ตัวเลข/สตริง — เก็บผ่าน JSON ไม่ได้ ให้ route อ่าน DB ตรงแทน
}
export type ApSearchIndex = { tracks: ApTrackRow[]; pos: ApPoRow[]; prs: ApPrRow[]; dds: ApDdRow[] }
export type ApSearchRaw = { apTracking: Doc[]; purchaseOrders: Doc[]; purchaseRequests: Doc[]; depositHeaders: Doc[] }

/** projection ที่ต้องดึง (ไม่มี filter ไม่มี sort — ลำดับต้องเป็น natural order) */
export const AP_SEARCH_PROJECTION = {
  tracks: { _id: 0, depositCode: 1, ...Object.fromEntries(AP_NO_FIELDS.map((f) => [f.key, 1])), "paid.paymentNos": 1 },
  pos: { _id: 0, "รหัส": 1, "ยานพาหนะ": 1, [PR_KEY]: 1 },
  prs: { _id: 0, [PR_KEY]: 1, "หมายเหตุ": 1 },
  dds: { _id: 0, deposit_id: 1, deposit_code: 1, purchase_order: 1, supplier: 1, supplier_ref_no: 1, warehouse: 1, amount: 1, received_at: 1 },
} as const

export function toTrackRow(d: Doc): ApTrackRow | null {
  const nos = [...AP_NO_FIELDS.flatMap((f) => strs(d[f.key])), ...strsAt(d, ["paid", "paymentNos"])]
  return nos.length ? { code: s(d.depositCode), nos } : null
}
export function toPoRow(d: Doc): ApPoRow | null {
  const vehicle = strs(d["ยานพาหนะ"]), pr = strs(d[PR_KEY])
  return vehicle.length || pr.length ? { code: s(d["รหัส"]), vehicle, pr } : null
}
export function toPrRow(d: Doc): ApPrRow | null {
  const note = strs(d["หมายเหตุ"])
  return note.length ? { pr: s(d[PR_KEY]), note } : null
}
export function toDdRow(d: Doc): ApDdRow {
  const mSupplier = strs(d.supplier), mPo = strs(d.purchase_order)
  const id = d.deposit_id
  const plainId = typeof id === "number" || typeof id === "string"
  return {
    depositCode: s(d.deposit_code), purchaseOrder: s(d.purchase_order), supplier: s(d.supplier), warehouse: s(d.warehouse),
    amount: parseAmount(d.amount), receivedAt: parseDmy(d.received_at),
    mCode: strs(d.deposit_code), mRef: strs(d.supplier_ref_no), mSupplier, mPo,
    internal: mSupplier.includes("") && mPo.includes(""),
    depositId: plainId ? id : null,
    hasPo: Boolean(d.purchase_order),
    ...(id != null && !plainId ? { oddId: true as const } : {}),
  }
}

const rows = <T>(docs: Doc[], f: (d: Doc) => T | null): T[] => {
  const out: T[] = []
  for (const d of docs) { const x = f(d); if (x) out.push(x) }
  return out
}
export function buildApSearchIndex(raw: ApSearchRaw): ApSearchIndex {
  return {
    tracks: rows(raw.apTracking, toTrackRow),
    pos: rows(raw.purchaseOrders, toPoRow),
    prs: rows(raw.purchaseRequests, toPrRow),
    dds: raw.depositHeaders.map(toDdRow),
  }
}

// ── ค้น ──────────────────────────────────────────────────────────────────────
export type ApSearchHit = {
  depositCode: string; purchaseOrder: string; supplier: string
  warehouse: string; amount: number; receivedAt: string; month: string
}

// n แถวแรกตามลำดับเดิมที่ผ่านเงื่อนไข (= .find(filter).limit(n) บน collscan)
function firstN<T>(list: T[], n: number, ok: (x: T) => boolean): T[] {
  const out: T[] = []
  for (const x of list) {
    if (!ok(x)) continue
    out.push(x)
    if (out.length >= n) break
  }
  return out
}

/** คืน { hits: [] } เมื่อคำค้นสั้นเกิน (ไม่มี total) · ไม่งั้น { hits, total } — รูปเดียวกับ route เดิม */
export function searchApIndex(ix: ApSearchIndex, rawQ: string): { hits: ApSearchHit[]; total?: number } {
  const q = String(rawQ ?? "").trim()
  if (q.length < AP_SEARCH_MIN_Q) return { hits: [] }
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
  const hit = (vals: string[]) => vals.some((v) => rx.test(v))

  // เลขที่เอกสาร (ใบกำกับ/ใบวางบิล/บิลเงินสด/NC-AC/Voucher) + เลข PV อยู่ใน ap_tracking ไม่ใช่ ATMS
  const docNoCodes = firstN(ix.tracks, 40, (t) => hit(t.nos)).map((t) => t.code).filter(Boolean)

  // ทะเบียนรถอยู่บน PO · หมายเหตุ (เลขใบแจ้งซ่อม/ทะเบียน/ช่าง) อยู่บน PR — ไล่กลับเป็นเลข PO เพื่อชี้ใบ DD
  const poByVehicle = firstN(ix.pos, 60, (p) => hit(p.vehicle))
  const prCodes = firstN(ix.prs, 60, (p) => hit(p.note)).map((p) => p.pr).filter(Boolean)
  const prSet = new Set(prCodes)
  const poFromPr = prCodes.length ? firstN(ix.pos, 60, (p) => p.pr.some((x) => prSet.has(x))) : []
  const poCodes = [...new Set([...poByVehicle, ...poFromPr].map((p) => p.code).filter(Boolean))]

  // ไม่ค้นเลข PO ตรง ๆ (ผู้ใช้สั่ง 01/10/2026) — poCodes มาจากทะเบียน/หมายเหตุ PR ไม่ใช่คำค้นเลข PO
  const docSet = new Set(docNoCodes), poSet = new Set(poCodes)
  const heads = firstN(ix.dds, AP_SEARCH_LIMIT * 3, (h) => !h.internal && (
    hit(h.mCode) || hit(h.mRef) || hit(h.mSupplier)
    || h.mCode.some((c) => docSet.has(c)) || h.mPo.some((p) => poSet.has(p))
  ))

  const hits = heads
    .map((h) => ({
      depositCode: h.depositCode,
      purchaseOrder: h.purchaseOrder,
      supplier: h.supplier,
      warehouse: h.warehouse,
      amount: h.amount,
      receivedAt: h.receivedAt,
      month: h.receivedAt.slice(0, 7),
    }))
    .filter((h) => h.month)                       // ไม่มีวันรับของที่อ่านได้ = กระโดดไปเดือนไหนไม่ได้
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, AP_SEARCH_LIMIT)
  return { hits, total: hits.length }
}

/** = findOne({ deposit_code }) บน collscan: ตัวแรกตามลำดับเดิม (ไม่ตัดใบคืนสต๊อกภายใน) · ไม่เจอ = null */
export function findDdHead(dds: ApDdRow[], depositCode: string): ApDdRow | null {
  return dds.find((r) => r.mCode.includes(depositCode)) ?? null
}
