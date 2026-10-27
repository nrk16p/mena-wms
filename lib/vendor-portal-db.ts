// lib/vendor-portal-db.ts — อ่าน/เขียน Mongo ของพอร์ทัลเจ้าหนี้ (ฝั่งเซิร์ฟเวอร์เท่านั้น)
//
// คิวรีใบ DD ใช้ join ชุดเดียวกับ GET /api/ap-tracking (deposit_header → ap_tracking → PO → เบอร์รถ)
// แต่เขียนแยกไว้ที่นี่ ดึงเฉพาะ field ที่พอร์ทัลต้องใช้ — route.ts เดิมใหญ่และมีหลาย session แก้อยู่
// ถ้ากติกาฝั่งนั้นเปลี่ยน (เช่นการตัดแถวคืนสต๊อกภายใน หรือที่มาของเบอร์รถ) ต้องตามมาแก้ที่นี่ด้วย
import type { Db } from "mongodb"
import type { NextRequest } from "next/server"
import clientPromise from "./mongo"
import { parseDmy, apNetOf, apGrossOf, apVatOf, apItemVerification } from "./ap-tracking"
import {
  vpStatusOf, vpBillOf, vpMonths, vpLookbackStart, vpCanSeeHead, vpAmbiguousNames, vpItemsOf,
  isSaraburiWarehouse, normVpUsername, vpPortalNames, type VpBill, type VpItem,
} from "./vendor-portal"
import { VP_COOKIE, readVpSession, vpSessionValid } from "./vendor-portal-auth"

export const VP_ACCOUNTS = "vendor_portal_accounts"
const MD = process.env.MONGO_DB ?? "master_data"

export type VpAccount = {
  username: string
  atmsCode: string
  displayName: string
  passwordHash: string
  passwordSetAt: string
  passwordSetBy: string
  tokenVersion: number
  disabled: boolean
  failedCount: number
  lockedUntil?: string | null
  lastLoginAt?: string
  loginCount: number
  createdAt: string
  createdBy: string
}

export type VpDbs = { md: Db; atms: Db }
type Doc = Record<string, unknown>
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

export async function vpDbs(): Promise<VpDbs> {
  const client = await clientPromise
  return { md: client.db(MD), atms: client.db("atms") }
}

// received_at เป็น string "D/M/YYYY HH:mm" — regex ต่อเดือนแบบเดียวกับ monthRe ใน app/api/ap-tracking/route.ts
const monthRe = (ym: string) => {
  const [y, m] = ym.split("-")
  return new RegExp(`^\\d{1,2}/0?${String(Number(m))}/${y}(?:\\s.*)?$`)
}

/** ชื่อใน ATMS ที่มีมากกว่า 1 รหัส (จากชุดชื่อที่ถามมา) */
export async function vpAmbiguousSet(atms: Db, names: string[]): Promise<Set<string>> {
  if (!names.length) return new Set()
  const rows = await atms.collection("supplier_master")
    .find({ name: { $in: names } }, { projection: { _id: 0, name: 1, code: 1 }, maxTimeMS: 10000 })
    .limit(2000).toArray() as { name?: string; code?: string }[]
  return vpAmbiguousNames(rows)
}

/** ชื่อผู้ขายทุกชื่อที่บัญชีนี้ครอบ = ทุกแถว ap_supplier ที่รหัสตรงกัน · ตัดเงินสดและชื่อที่ ATMS มีหลายรหัสออก */
export async function vpSupplierNames(db: VpDbs, atmsCode: string): Promise<string[]> {
  const code = normVpUsername(atmsCode)
  if (!code) return []
  const sups = await db.md.collection("ap_supplier")
    .find({ atmsCode: { $exists: true, $ne: "" } }, { projection: { _id: 0, name: 1, atmsCode: 1 }, maxTimeMS: 10000 })
    .limit(5000).toArray() as { name?: string; atmsCode?: unknown }[]
  const names = [...new Set(sups.filter((x) => normVpUsername(x.atmsCode) === code).map((x) => s(x.name)).filter(Boolean))]
  return vpPortalNames(names, await vpAmbiguousSet(db.atms, names))
}

// เบอร์รถต่อทะเบียน — กติกาเดียวกับ route.ts: vehicle_daily ทับ vehiclemaster · ตัด "NaN"
async function fleetByPlates(atms: Db, plates: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!plates.length) return out
  const [vm, vd] = await Promise.all([
    atms.collection("vehiclemaster").find({ "ทะเบียน": { $in: plates } }, { projection: { _id: 0, "ทะเบียน": 1, "เลขรถ": 1 }, maxTimeMS: 10000 }).toArray() as Promise<Doc[]>,
    atms.collection("vehicle_daily").find({ "ทะเบียน": { $in: plates } }, { projection: { _id: 0, "ทะเบียน": 1, "เบอร์รถ": 1 }, maxTimeMS: 10000 }).toArray() as Promise<Doc[]>,
  ])
  const clean = (v: unknown) => { const t = s(v); return t === "NaN" ? "" : t }
  for (const v of vm) { const p = s(v["ทะเบียน"]), f = clean(v["เลขรถ"]);  if (p && f) out.set(p, f) }
  for (const v of vd) { const p = s(v["ทะเบียน"]), f = clean(v["เบอร์รถ"]); if (p && f) out.set(p, f) }
  return out
}

const TRACK_PROJ = { _id: 0, depositCode: 1, "review.status": 1, "pay.payDate": 1, "paid.date": 1, "paid.paymentNos": 1 }

/** ใบ DD ของเจ้านี้ที่เจ้าหนี้มีสิทธิ์เห็น (ผ่าน vpBillOf แล้ว — ไม่มีข้อมูลภายในหลุด) เรียงรับของล่าสุดก่อน */
export async function loadVpBills(db: VpDbs, names: string[], todayISO: string): Promise<VpBill[]> {
  if (!names.length) return []
  const months = vpMonths(vpLookbackStart(todayISO), todayISO)
  const heads = await db.atms.collection("deposit_header").find(
    {
      supplier: { $in: names },
      $nor: [{ supplier: "", purchase_order: "" }],
      $or: months.map((m) => ({ received_at: { $regex: monthRe(m) } })),
    },
    { projection: {
      _id: 0, deposit_code: 1, warehouse: 1, purchase_order: 1, supplier: 1, supplier_ref_no: 1,
      amount: 1, amount_net: 1, grand_total: 1, vat_amount: 1, vat_rate: 1, received_at: 1,
    }, maxTimeMS: 20000 },
  ).limit(3000).toArray() as Doc[]

  const usable = heads.filter((h) => s(h.deposit_code) && !isSaraburiWarehouse(s(h.warehouse)))
  const codes = usable.map((h) => s(h.deposit_code))
  const poCodes = [...new Set(usable.map((h) => s(h.purchase_order)).filter(Boolean))]
  const [tracks, pos] = await Promise.all([
    codes.length ? db.md.collection("ap_tracking").find({ depositCode: { $in: codes } }, { projection: TRACK_PROJ, maxTimeMS: 15000 }).toArray() as Promise<Doc[]> : [],
    poCodes.length ? db.atms.collection("purchase_orders").find({ "รหัส": { $in: poCodes } }, { projection: { _id: 0, "รหัส": 1, "ยานพาหนะ": 1 }, maxTimeMS: 15000 }).toArray() as Promise<Doc[]> : [],
  ])
  const trackBy = new Map(tracks.map((t) => [s(t.depositCode), t]))
  const plateBy = new Map(pos.map((p) => [s(p["รหัส"]), s(p["ยานพาหนะ"])]))
  const fleet = await fleetByPlates(db.atms, [...new Set([...plateBy.values()].filter(Boolean))])

  const bills: VpBill[] = []
  for (const h of usable) {
    const code = s(h.deposit_code)
    const t = trackBy.get(code) as Parameters<typeof vpStatusOf>[0]
    const status = vpStatusOf(t)
    const receivedAt = parseDmy(h.received_at)
    if (!vpCanSeeHead({ supplier: s(h.supplier), warehouse: s(h.warehouse), receivedAt }, names, status, todayISO)) continue
    const plate = plateBy.get(s(h.purchase_order)) ?? ""
    const tr = t as { pay?: { payDate?: string }; paid?: { date?: string } } | undefined
    bills.push(vpBillOf({
      depositCode: code,
      receivedAt,
      supplierRefNo: s(h.supplier_ref_no),
      vehicle: plate,
      fleetNo: fleet.get(plate) ?? "",
      amount: apNetOf(h),
      status,
      payDate: s(tr?.pay?.payDate),
      paidDate: s(tr?.paid?.date),
    }))
  }
  bills.sort((a, b) => (a.receivedAt === b.receivedAt ? b.depositCode.localeCompare(a.depositCode) : b.receivedAt.localeCompare(a.receivedAt)))
  return bills
}

export type VpItemsResult = { items: VpItem[]; subtotal: number; vat: number; net: number; pending: boolean }

/** รายการสินค้าของใบเดียว — null = ไม่ใช่ใบของเจ้านี้/นอกช่วง/ไม่มีใบ (route ตอบ 404 เหมือนกันหมด) */
export async function loadVpItems(db: VpDbs, code: string, names: string[], todayISO: string): Promise<VpItemsResult | null> {
  const dd = s(code).toUpperCase()
  if (!dd || !names.length) return null
  const h = await db.atms.collection("deposit_header").findOne(
    { deposit_code: dd, supplier: { $in: names } },
    { projection: { _id: 0, deposit_id: 1, deposit_code: 1, warehouse: 1, supplier: 1, amount: 1, amount_net: 1, grand_total: 1, vat_amount: 1, vat_rate: 1, received_at: 1 }, maxTimeMS: 15000 },
  ) as Doc | null
  if (!h) return null
  const t = await db.md.collection("ap_tracking").findOne({ depositCode: dd }, { projection: TRACK_PROJ, maxTimeMS: 10000 }) as Parameters<typeof vpStatusOf>[0]
  const receivedAt = parseDmy(h.received_at)
  if (!vpCanSeeHead({ supplier: s(h.supplier), warehouse: s(h.warehouse), receivedAt }, names, vpStatusOf(t), todayISO)) return null

  const raw = typeof h.deposit_id === "number"
    ? await db.atms.collection("deposit_items").find({ deposit_id: h.deposit_id }, { projection: { _id: 0, item: 1, qty: 1, unit_price: 1, total: 1, scraped_at: 1 }, maxTimeMS: 10000 }).limit(300).toArray() as Doc[]
    : []
  const totals = { subtotal: apGrossOf(h), vat: apVatOf(h), net: apNetOf(h) }
  // รายการใน Mongo ตามหัวใบไม่ทัน (ดึงคนละจังหวะ) → ไม่โชว์ตัวเลขที่บวกไม่ตรงยอด
  const check = apItemVerification(raw as { total?: string; scraped_at?: string }[], h.amount)
  if (!raw.length || !check.amountOk) return { items: [], ...totals, pending: true }
  return { items: vpItemsOf(raw as { item?: string; qty?: string; unit_price?: string; total?: string }[]), ...totals, pending: false }
}

/** บัญชีของ session ใน request นี้ — null = ยังไม่ล็อกอิน / token เสีย / บัญชีปิด / รีเซ็ตรหัสไปแล้ว
 *  ตรวจลายเซ็น cookie ก่อนแตะฐานข้อมูลเสมอ — request ที่ไม่มี/ปลอม cookie ไม่ต้องเปิด connection เลย */
export async function requireVpAccount(req: NextRequest): Promise<{ acc: VpAccount; db: VpDbs } | null> {
  const sess = await readVpSession(req.cookies.get(VP_COOKIE)?.value)
  if (!sess) return null
  const db = await vpDbs()
  const acc = await db.md.collection(VP_ACCOUNTS).findOne({ username: sess.sub }, { projection: { _id: 0 }, maxTimeMS: 10000 }) as VpAccount | null
  return vpSessionValid(acc, sess) && acc ? { acc, db } : null
}
