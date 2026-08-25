// lib/vendor-core.ts
// ตรรกะล้วนของ Vendor List (Approved Vendor List) — ห้าม import อะไรทั้งสิ้น
// เพื่อให้ทดสอบตรง ๆ ได้ด้วย tsx (แพตเทิร์นเดียวกับ deadstock-core / safety-stock-core)
//
// คำถามที่หน้านี้ต้องตอบ: "งานซ่อมประเภทนี้ ควรเลือกอู่ไหน"
//
// ที่มาของข้อมูล: แถว "รับ" ใน stockmovement_v5 ที่ กลุ่มสินค้า ขึ้นต้นด้วย "ค่าแรง"
// = การซื้อบริการซ่อมจากอู่ ซึ่งเป็นที่เดียวที่มีชื่ออู่จริงคู่กับงานที่ทำ
//   • ฝั่งเบิกออก (WD) มีเลข MR แต่ไม่มีชื่ออู่
//   • ฝั่งรับเข้า (DD) มีชื่ออู่ แต่ไม่มีเลข MR
//   • สองฝั่งไม่เคยอยู่แถวเดียวกัน (วัดจริง 0 จาก 231,759 แถว 25/08/2026)
// จึงยังผูกกับใบแจ้งซ่อมรายใบไม่ได้ — ดูหมายเหตุท้ายไฟล์

export const DB_NAME = "atms"
export const COLL_NAME = "stockmovement_v5"

/** คลังที่นับเข้า AVL — เอาครบทุกคลังต่างจาก /safety-stock ที่ตัดเหลือ 2 คลัง
 *  เพราะอู่รายเดียวกันรับงานข้ามคลัง ตัดคลังทิ้งจะทำให้ประวัติอู่ขาดไปดื้อ ๆ */
export const INVENTORY_IDS = ["4", "3", "11", "24"]

/** ย้อนหลังกี่เดือน — ผู้ใช้กำหนด 2 ปี */
export const MONTHS_BACK = 24

/** "YYYY-MM" ของ n เดือนก่อนหน้า */
export function ymBack(asOf: Date, n: number): string {
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

export function ymOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/** ประเภทงานซ่อมกลาง — รวมร่างชื่อที่เขียนต่างกันในต้นทางให้เหลือชุดเดียว */
export const SERVICE_TYPES = [
  "ระบบโม่",
  "ระบบเครื่องยนต์",
  "ระบบเบรค-คลัทช์-เกียร์",
  "ระบบช่วงล่าง",
  "ระบบแอร์-ไฟฟ้า",
  "ระบบยาง",
  "ระบบบำรุงรักษา",
  "หัวเก๋ง-ตัวถัง-สี",
  "ระบบหาง",
  "อุปกรณ์เสริม",
  "ทำความสะอาด",
  "เชื่อม-กลึง-งานโลหะ",
  "อื่นๆ / ยังไม่จัดประเภท",
] as const
export type ServiceType = (typeof SERVICE_TYPES)[number]

export const UNCLASSIFIED: ServiceType = "อื่นๆ / ยังไม่จัดประเภท"

/** ผู้ขายที่ไม่ใช่อู่ — เป็นวิธีจ่ายเงิน ไม่ใช่คู่ค้า จึงต้องไม่โผล่ใน AVL */
const NOT_A_VENDOR_RE = /^เงินสด/

export function isRealVendor(name: string | null | undefined): boolean {
  const v = (name ?? "").trim()
  return v.length > 0 && !NOT_A_VENDOR_RE.test(v)
}

// ── จัดประเภทจาก `กลุ่มสินค้า` ──────────────────────────────────────────────
// ต้นทางมี 11 กลุ่ม แต่ตัวใหญ่สุดคือ "ค่าแรง" เฉย ๆ (55% ของยอด) ที่ไม่บอกประเภท
// กลุ่มที่บอกประเภทมาแล้วเชื่อได้เลย ที่เหลือค่อยไปพึ่ง labour_code_master
const GROUP_MAP: [RegExp, ServiceType][] = [
  [/โม่/,                        "ระบบโม่"],
  [/เครื่องยนต์/,                "ระบบเครื่องยนต์"],
  [/เบรค|ครัช|ครัทช์|คลัทช์|เกียร์/, "ระบบเบรค-คลัทช์-เกียร์"],
  [/ช่วงล่าง/,                   "ระบบช่วงล่าง"],
  [/แอร์|ไฟฟ้า|ไฟ\b|ระบบไฟ/,    "ระบบแอร์-ไฟฟ้า"],
  [/ยาง/,                        "ระบบยาง"],
  [/บำรุงรักษา|เช็คระยะ/,        "ระบบบำรุงรักษา"],
  [/หัวเก๋ง|ตัวถัง|ทำสี|ปะผุ|เคาะ/, "หัวเก๋ง-ตัวถัง-สี"],
  [/หาง/,                        "ระบบหาง"],
  [/อุปกรณ์เสริม/,               "อุปกรณ์เสริม"],
  [/ทำความสะอาด|ล้างรถ/,         "ทำความสะอาด"],
  [/เชื่อม|กลึง/,                "เชื่อม-กลึง-งานโลหะ"],
]

function matchType(text: string): ServiceType | null {
  for (const [re, t] of GROUP_MAP) if (re.test(text)) return t
  return null
}

/** ประเภทจาก `กลุ่มสินค้า` — คืน null เมื่อเป็น "ค่าแรง" เปล่า ๆ ที่ไม่บอกอะไร */
export function serviceTypeFromGroup(group: string | null | undefined): ServiceType | null {
  const g = (group ?? "").trim()
  if (!g.startsWith("ค่าแรง")) return null
  const rest = g.slice("ค่าแรง".length).replace(/^[-–\s]+/, "")
  return rest ? matchType(rest) : null
}

/** เดาประเภทจากชื่อรหัสค่าแรง — ใช้ seed labour_code_master ครั้งแรกเท่านั้น
 *  ชื่อที่กำกวมจริง ๆ ("ค่าแรงซ่อม", "ค่าแรง", "บิลร้านเครดิต") คืน null ให้คนตัดสิน
 *  ไม่เดาแทน เพราะรหัสพวกนี้กินยอดหลักล้าน เดาผิดทำให้ทั้งหน้าเชื่อถือไม่ได้ */
export function seedServiceTypeFromName(itemName: string | null | undefined): ServiceType | null {
  const n = (itemName ?? "").trim()
  if (!n) return null
  // ตัดคำนำหน้าที่ไม่ได้บอกประเภทออกก่อน ไม่งั้น "ค่าแรงซ่อม" จะไปเข้าเงื่อนไขผิด
  const body = n.replace(/^(ค่าแรง|ค่าซ่อม|ค่าบริการ|ค่า)\s*/, "").trim()
  if (!body || /^ซ่อม$/.test(body)) return null
  return matchType(body)
}

// ── ชนิดข้อมูล ──────────────────────────────────────────────────────────────

/** 1 แถวที่ Mongo ยุบมาแล้ว: อู่ × กลุ่มสินค้า × รหัสค่าแรง */
export type VendorRawRow = {
  vendor: string
  group: string
  code: string
  itemName: string
  /** จำนวนบรรทัดรายการ */
  rows: number
  /** จำนวนใบรับไม่ซ้ำ = จำนวนครั้งที่ใช้บริการ */
  jobs: number
  baht: number
  /** เดือนล่าสุดที่ใช้บริการ "YYYY-MM" */
  lastYm: string
  warehouses: string[]
}

/** รหัสค่าแรง 1 ตัวในหน้าตั้งค่า */
export type LabourCode = {
  code: string
  itemName: string
  /** ประเภทที่คนตั้งไว้ — ว่าง = ยังไม่ตั้ง ให้ใช้ค่าที่ seed มา */
  serviceType: ServiceType | ""
  /** ค่าที่เดาให้ตอน seed (ไว้โชว์เทียบ) */
  seeded: ServiceType | null
  jobs: number
  baht: number
  by?: string
  at?: string
}

export type VendorApproval = {
  vendor: string
  /** ประเภทงานที่อนุมัติให้อู่รายนี้ทำ */
  approvedTypes: ServiceType[]
  status: "approved" | "rejected" | "pending"
  note?: string
  by?: string
  at?: string
}

export type Tier = "primary" | "backup" | "unapproved"

export const TIER_LABEL: Record<Tier, { th: string; hint: string }> = {
  primary:    { th: "ตัวหลัก",            hint: "อนุมัติแล้ว + มีงานพอ + ยังใช้อยู่" },
  backup:     { th: "สำรอง",              hint: "อนุมัติแล้ว แต่งานน้อยหรือหายไปนาน" },
  unapproved: { th: "เคยใช้ ยังไม่อนุมัติ", hint: "มีประวัติซ่อม แต่ยังไม่ผ่านการอนุมัติ" },
}

/** เกณฑ์ "ตัวหลัก" — ตั้งเป็นค่ากลางไว้ที่เดียว จะได้ปรับทีเดียวแล้วขยับทั้งหน้า */
export const TIER_RULE = { minJobs: 5, activeMonths: 6 }

/** 1 แถวในตาราง "อู่ไหนทำงานประเภทนี้ได้บ้าง" */
export type VendorServiceRow = {
  vendor: string
  serviceType: ServiceType
  jobs: number
  rows: number
  baht: number
  /** ราคาเฉลี่ยต่อครั้ง */
  avg: number
  /** ต่างจากค่ากลางของประเภทนี้กี่ % (บวก = แพงกว่า) · null เมื่อยังไม่มีค่ากลาง */
  vsMedian: number | null
  lastYm: string
  monthsSince: number
  warehouses: string[]
  tier: Tier
  approved: boolean
}

export type ServiceSummary = {
  serviceType: ServiceType
  vendors: number
  jobs: number
  baht: number
  /** ค่ากลางของราคาเฉลี่ยต่อครั้ง (มัธยฐานข้ามอู่) */
  medianAvg: number
}

export type VendorSummary = {
  vendor: string
  jobs: number
  baht: number
  lastYm: string
  monthsSince: number
  status: VendorApproval["status"]
  approvedTypes: ServiceType[]
  /** ประเภทที่เคยทำจริง เรียงตามยอดเงินมากไปน้อย */
  didTypes: { serviceType: ServiceType; jobs: number; baht: number }[]
  warehouses: string[]
  note?: string
  by?: string
  at?: string
}

export type VendorPayload = {
  asOfYm: string
  fromYm: string
  services: ServiceSummary[]
  byService: VendorServiceRow[]
  vendors: VendorSummary[]
  /** รหัสค่าแรงที่ยังไม่มีใครจัดประเภท — งานค้างของหน้าตั้งค่า */
  unclassified: { codes: number; jobs: number; baht: number }
}

// ── ตัวช่วย ─────────────────────────────────────────────────────────────────

export function monthsBetweenYm(from: string, to: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(from)
  const n = /^(\d{4})-(\d{2})$/.exec(to)
  if (!m || !n) return 999
  return (+n[1] - +m[1]) * 12 + (+n[2] - +m[2])
}

export function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function tierOf(approved: boolean, jobs: number, monthsSince: number): Tier {
  if (!approved) return "unapproved"
  return jobs >= TIER_RULE.minJobs && monthsSince <= TIER_RULE.activeMonths ? "primary" : "backup"
}

/** ประเภทของแถวหนึ่ง: กลุ่มสินค้าบอกได้ก่อน → ที่คนตั้งไว้ → ที่ seed ไว้ → ยังไม่จัดประเภท */
export function resolveServiceType(
  row: Pick<VendorRawRow, "group" | "code">,
  codeMap: Map<string, LabourCode>
): ServiceType {
  const fromGroup = serviceTypeFromGroup(row.group)
  if (fromGroup) return fromGroup
  const c = codeMap.get(row.code)
  if (c?.serviceType) return c.serviceType
  if (c?.seeded) return c.seeded
  return UNCLASSIFIED
}

// ── ประกอบข้อมูลทั้งหน้า ────────────────────────────────────────────────────

export function buildVendorPayload(
  raw: VendorRawRow[],
  codes: LabourCode[],
  approvals: VendorApproval[],
  asOfYm: string,
  fromYm: string
): VendorPayload {
  const codeMap = new Map(codes.map((c) => [c.code, c]))
  const apMap   = new Map(approvals.map((a) => [a.vendor, a]))

  // อู่ × ประเภท
  type Acc = { jobs: number; rows: number; baht: number; lastYm: string; wh: Set<string> }
  const cell = new Map<string, Acc>()
  const vAcc = new Map<string, Acc>()
  const sAcc = new Map<ServiceType, Acc>()
  // ชื่ออู่มีช่องว่างในตัว ("บริษัท ทีที แอนด์ บี ...") คั่นคีย์ด้วยช่องว่างไม่ได้
  const SEP = "\u0000"
  const key = (v: string, t: string) => `${v}${SEP}${t}`

  const bump = (m: Map<string, Acc>, k: string, r: VendorRawRow) => {
    let a = m.get(k)
    if (!a) m.set(k, (a = { jobs: 0, rows: 0, baht: 0, lastYm: "", wh: new Set() }))
    a.jobs += r.jobs
    a.rows += r.rows
    a.baht += r.baht
    if (r.lastYm > a.lastYm) a.lastYm = r.lastYm
    for (const w of r.warehouses) if (w) a.wh.add(w)
  }

  for (const r of raw) {
    if (!isRealVendor(r.vendor)) continue
    const t = resolveServiceType(r, codeMap)
    bump(cell, key(r.vendor, t), r)
    bump(vAcc, r.vendor, r)
    bump(sAcc as unknown as Map<string, Acc>, t, r)
  }

  // ค่ากลางราคาต่อครั้งของแต่ละประเภท — คิดจากราคาเฉลี่ยของแต่ละอู่ ไม่ใช่รายบรรทัด
  // เพื่อไม่ให้อู่ที่ออกบิลถี่ ๆ ลากค่ากลางไปทางตัวเอง
  const avgByType = new Map<ServiceType, number[]>()
  for (const [k, a] of cell) {
    const t = k.split(SEP)[1] as ServiceType
    if (!a.jobs) continue
    const arr = avgByType.get(t) ?? []
    arr.push(a.baht / a.jobs)
    avgByType.set(t, arr)
  }
  const medianOf = new Map<ServiceType, number>()
  for (const [t, arr] of avgByType) medianOf.set(t, median(arr))

  const byService: VendorServiceRow[] = []
  for (const [k, a] of cell) {
    const [vendor, t] = k.split(SEP) as [string, ServiceType]
    const ap = apMap.get(vendor)
    const approved = ap?.status === "approved" && (ap.approvedTypes ?? []).includes(t)
    const avg = a.jobs ? a.baht / a.jobs : 0
    const med = medianOf.get(t) ?? 0
    const monthsSince = monthsBetweenYm(a.lastYm, asOfYm)
    byService.push({
      vendor, serviceType: t,
      jobs: a.jobs, rows: a.rows, baht: r2(a.baht), avg: r2(avg),
      vsMedian: med > 0 ? Math.round(((avg - med) / med) * 100) : null,
      lastYm: a.lastYm, monthsSince,
      warehouses: [...a.wh].sort(),
      approved,
      tier: tierOf(approved, a.jobs, monthsSince),
    })
  }
  // ตัวหลักก่อน แล้วค่อยเรียงตามจำนวนงาน — คนเปิดหน้ามาเพื่อหา "ใครทำได้" ไม่ใช่ "ใครแพง"
  const tierRank: Record<Tier, number> = { primary: 0, backup: 1, unapproved: 2 }
  byService.sort((a, b) =>
    a.serviceType !== b.serviceType ? a.serviceType.localeCompare(b.serviceType, "th")
    : tierRank[a.tier] !== tierRank[b.tier] ? tierRank[a.tier] - tierRank[b.tier]
    : b.jobs - a.jobs)

  const services: ServiceSummary[] = [...sAcc.entries()]
    .map(([t, a]) => ({
      serviceType: t as ServiceType,
      vendors: [...cell.keys()].filter((k) => k.endsWith(`${SEP}${t}`)).length,
      jobs: a.jobs, baht: r2(a.baht), medianAvg: r2(medianOf.get(t as ServiceType) ?? 0),
    }))
    .sort((a, b) => b.baht - a.baht)

  const didByVendor = new Map<string, { serviceType: ServiceType; jobs: number; baht: number }[]>()
  for (const r of byService) {
    const arr = didByVendor.get(r.vendor) ?? []
    arr.push({ serviceType: r.serviceType, jobs: r.jobs, baht: r.baht })
    didByVendor.set(r.vendor, arr)
  }

  const vendors: VendorSummary[] = [...vAcc.entries()].map(([vendor, a]) => {
    const ap = apMap.get(vendor)
    return {
      vendor, jobs: a.jobs, baht: r2(a.baht), lastYm: a.lastYm,
      monthsSince: monthsBetweenYm(a.lastYm, asOfYm),
      status: ap?.status ?? "pending",
      approvedTypes: ap?.approvedTypes ?? [],
      didTypes: (didByVendor.get(vendor) ?? []).sort((x, y) => y.baht - x.baht),
      warehouses: [...a.wh].sort(),
      note: ap?.note, by: ap?.by, at: ap?.at,
    }
  }).sort((a, b) => b.baht - a.baht)

  const un = { codes: 0, jobs: 0, baht: 0 }
  const seenCode = new Set<string>()
  for (const r of raw) {
    if (!isRealVendor(r.vendor)) continue
    if (resolveServiceType(r, codeMap) !== UNCLASSIFIED) continue
    if (!seenCode.has(r.code)) { seenCode.add(r.code); un.codes += 1 }
    un.jobs += r.jobs
    un.baht = r2(un.baht + r.baht)
  }

  return { asOfYm, fromYm, services, byService, vendors, unclassified: un }
}

// หมายเหตุเรื่องที่ยังทำไม่ได้ (ตรวจแล้ว 25/08/2026 ไม่ใช่การเดา):
//   • ผูก vendor กับใบแจ้งซ่อม (MR) รายใบยังทำไม่ได้ — ฝั่งรับของไม่มีเลข MR
//     สะพานที่พอมีคือ `หมายเหตุย่อย` ของแถวเบิก แต่เป็นเลข DD แค่ 6 จาก 384 แถว
//   • purchase_orders มีแต่ปี 2569 (13,529 ใบ) เส้นทาง PR → PO → ซัพพลายเออร์
//     จึงตายสำหรับงานปี 2568 (ลอง 135 PR ได้ 0) ถ้าจะเปิดเส้นนี้ต้อง backfill PO ก่อน
