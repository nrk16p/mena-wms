// lib/price-compare.ts
// ตรรกะล้วนของใบเทียบราคา — ห้าม import อะไรทั้งสิ้น เพื่อให้ทดสอบตรงๆ ด้วย tsx และใช้ได้ทั้ง client/server/PDF

export type PcStatus = "ร่าง" | "รอลงนาม" | "เสร็จสิ้น"
export const PC_STATUSES: PcStatus[] = ["ร่าง", "รอลงนาม", "เสร็จสิ้น"]
export const MAX_SUPPLIERS = 4
export const MIN_QUOTES = 3          // แนวปฏิบัติจัดซื้อ: ใบเสนอราคาครบอย่างน้อย 3 ราย ไม่งั้นต้องระบุเหตุผล
export const VAT_RATE = 0.07
export type PcVatMode = "excl" | "incl" | "none"
export const VAT_MODE_LABEL: Record<PcVatMode, string> = { excl: "ราคาก่อน VAT", incl: "ราคารวม VAT แล้ว", none: "ไม่มี VAT" }

// ตำแหน่งกรรมการ 4 ช่องตามฟอร์ม (ซ้าย→ขวา)
export const DEFAULT_COMMITTEE_ROLES = [
  "หัวหน้าฝ่ายยานยนต์",
  "ผจก.ฝ่ายยานยนต์",
  "ผจก.ฝ่ายจัดซื้อ",
  "ผู้อำนวยการสายงานธุรกิจ",
]

export type PcFile = { mediaId: number; batchId: string; filename: string; webpUrl: string; thumbnailUrl: string }
export type PcItem = { name: string; qty: number; unit: string }
export type PcConditions = {
  payment: string; leadTime: string; warranty: string; remark: string
  bays: string; menaTrucksIn: string; statusA: string; statusB: string
}
export type PcSupplier = {
  name: string; garageId?: string; note: string
  prices: (number | null)[]; discount: number
  vatMode: PcVatMode          // ฐานราคาที่เสนอ — เทียบกันที่ "สุทธิที่ต้องจ่ายจริง"
  quoteDate: string; validUntil: string   // YYYY-MM-DD
  conditions: PcConditions; quotationFiles: PcFile[]
}
export type PcCommittee = { role: string; name: string; email?: string; pickedSupplier: number | null; reason: string; signedDate: string }
export type PcLinks = { prCode?: string; plate?: string; fleetNo?: string; repairExternalId?: string }
export type PriceCompare = {
  _id?: string
  docNo: string; title: string; requestDept: string
  preparedBy: { name: string; email: string }
  revision: number; createdAt: string; updatedAt: string
  status: PcStatus
  items: PcItem[]; suppliers: PcSupplier[]; committee: PcCommittee[]
  selectedSupplier: number | null
  // เลือก supplier แยกเป็นรายการ (1-based, ยาวเท่า items) เผื่อ mix ข้าม supplier เพื่อให้ได้ราคารวมที่ดีที่สุด
  // null ในตำแหน่งไหน = รายการนั้นยังไม่กำหนดเอง ใช้ selectedSupplier ของทั้งใบแทน (ดู effectiveLineSupplier)
  lineSupplier: (number | null)[]
  selectionReason: string      // บังคับเมื่อรายที่เลือกไม่ใช่สุทธิต่ำสุด (ทั้งโหมดเลือกทั้งใบและโหมด mix รายบรรทัด)
  fewerQuotesReason: string    // บังคับเมื่อ supplier ที่ราคาครบ < MIN_QUOTES
  links: PcLinks; evidenceFiles: PcFile[]
  createdBy: string; editedBy: string
}
export type PcTotals = { subtotal: number; discount: number; afterDiscount: number; vat: number; net: number }
// ยอดรวมโหมดผสม (เลือก supplier รายบรรทัด) — perSupplier เรียงตรงกับ doc.suppliers, เจ้าที่ไม่ได้รับแถวไหนเลย lines = 0
export type PcMixedTotals = { perSupplier: { subtotal: number; vat: number; net: number; lines: number }[]; grand: number; suppliersUsed: number }

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

export function emptyConditions(): PcConditions {
  return { payment: "", leadTime: "", warranty: "", remark: "", bays: "", menaTrucksIn: "", statusA: "", statusB: "" }
}
export function emptySupplier(itemCount: number): PcSupplier {
  return {
    name: "", note: "", prices: Array(itemCount).fill(null),
    discount: 0, vatMode: "excl", quoteDate: "", validUntil: "", conditions: emptyConditions(), quotationFiles: [],
  }
}
export function emptyCommittee(): PcCommittee[] {
  return DEFAULT_COMMITTEE_ROLES.map((role) => ({ role, name: "", email: "", pickedSupplier: null, reason: "", signedDate: "" }))
}
export function newDoc(preparedBy: { name: string; email: string }): Omit<PriceCompare, "_id" | "docNo" | "createdAt" | "updatedAt"> {
  return {
    title: "", requestDept: "", preparedBy, revision: 0, status: "ร่าง",
    items: [{ name: "", qty: 1, unit: "" }],
    suppliers: [emptySupplier(1)],
    committee: emptyCommittee(),
    selectedSupplier: null, lineSupplier: [null], selectionReason: "", fewerQuotesReason: "", links: {}, evidenceFiles: [],
    createdBy: preparedBy.name, editedBy: preparedBy.name,
  }
}

export function lineTotal(item: PcItem, price: number | null): number | null {
  if (price == null || !isFinite(price)) return null
  return round2(item.qty * price)
}

export function supplierTotals(doc: Pick<PriceCompare, "items" | "suppliers">, idx: number): PcTotals {
  const s = doc.suppliers[idx]
  if (!s) return { subtotal: 0, discount: 0, afterDiscount: 0, vat: 0, net: 0 }
  let subtotal = 0
  doc.items.forEach((it, i) => { const lt = lineTotal(it, s.prices[i] ?? null); if (lt != null) subtotal += lt })
  subtotal = round2(subtotal)
  const discount = round2(s.discount || 0)
  const afterDiscount = round2(subtotal - discount)
  // ฐาน VAT ต่างกันต้อง normalize ก่อนเทียบ: excl บวก 7%, incl ถอด VAT ออกมาแสดงแต่สุทธิเท่าเดิม, none ไม่มี VAT
  if (s.vatMode === "incl") {
    const vat = round2(afterDiscount - afterDiscount / (1 + VAT_RATE))
    return { subtotal, discount, afterDiscount, vat, net: afterDiscount }
  }
  if (s.vatMode === "none") return { subtotal, discount, afterDiscount, vat: 0, net: afterDiscount }
  const vat = round2(afterDiscount * VAT_RATE)
  const net = round2(afterDiscount + vat)
  return { subtotal, discount, afterDiscount, vat, net }
}

// index ของ supplier ที่ราคาต่อหน่วยต่ำสุดในแต่ละแถว (เฉพาะรายที่เสนอราคา) — null ถ้าไม่มีใครเสนอ
export function lowestPerLine(doc: Pick<PriceCompare, "items" | "suppliers">): (number | null)[] {
  return doc.items.map((_, i) => {
    let best: number | null = null, bestPrice = Infinity
    doc.suppliers.forEach((s, si) => {
      const p = s.prices[i]
      if (p != null && p < bestPrice) { bestPrice = p; best = si }
    })
    return best
  })
}

// index ของ supplier ที่สุทธิต่ำสุด — นับเฉพาะรายที่มีราคาอย่างน้อย 1 รายการ
export function lowestNet(doc: Pick<PriceCompare, "items" | "suppliers">): number | null {
  let best: number | null = null, bestNet = Infinity
  doc.suppliers.forEach((s, si) => {
    if (!s.prices.some((p) => p != null)) return
    const { net } = supplierTotals(doc, si)
    if (net < bestNet) { bestNet = net; best = si }
  })
  return best
}

/** ราคาสุทธิของรายการหนึ่ง ถ้าใช้ supplier รายที่ระบุ (รวม VAT ตามเงื่อนไขของ supplier รายนั้น) — ไม่รวมส่วนลดท้ายใบ เพราะส่วนลดเป็นข้อตกลงระดับทั้งใบเสนอราคา ใช้ไม่ได้เมื่อซื้อแค่บางรายการ
 *  ภายในโมดูลเท่านั้น: ใช้เทียบว่าแถวหนึ่งๆ เจ้าไหนถูกสุด "หลัง VAT" — ยอดจริงคิดรวมทั้งเจ้าใน mixedTotals() */
function lineNet(doc: Pick<PriceCompare, "items" | "suppliers">, lineIdx: number, supplierIdx: number): number | null {
  const s = doc.suppliers[supplierIdx]
  const it = doc.items[lineIdx]
  if (!s || !it) return null
  const lt = lineTotal(it, s.prices[lineIdx] ?? null)
  if (lt == null) return null
  if (s.vatMode === "incl" || s.vatMode === "none") return lt
  return round2(lt * (1 + VAT_RATE))
}

/** supplier ที่ถูกกำหนดให้ใช้จริงสำหรับรายการนี้ — ใช้ lineSupplier ถ้าระบุไว้ ไม่งั้น fallback ไปที่ selectedSupplier ของทั้งใบ */
export function effectiveLineSupplier(doc: Pick<PriceCompare, "selectedSupplier" | "lineSupplier">, lineIdx: number): number | null {
  return doc.lineSupplier[lineIdx] ?? doc.selectedSupplier
}

/** true เมื่อทุกรายการถูกกำหนด supplier ของตัวเองแล้ว (โหมด mix เต็มรูปแบบ ไม่ต้องพึ่ง selectedSupplier ของทั้งใบเลย) */
export function allLinesAwarded(doc: Pick<PriceCompare, "items" | "lineSupplier">): boolean {
  return doc.items.length > 0 && doc.lineSupplier.length === doc.items.length && doc.lineSupplier.every((v) => v != null)
}

/** ยอดรวมโหมดผสม — แยกยอดตาม supplier ที่ถูกมอบหมายในแต่ละแถว แล้วคิด VAT ทีเดียวต่อเจ้าตาม vatMode ของเจ้านั้น
 *  ส่วนลดท้ายใบ "ไม่" ถูกนำมาคิด: ส่วนลดเป็นข้อตกลงของทั้งใบเสนอราคา ใช้อ้างไม่ได้เมื่อซื้อจากเจ้านั้นแค่บางรายการ
 *  null เมื่อมีแถวใดยังไม่มี supplier ที่ใช้ได้จริง (ไม่ได้กำหนดและไม่มี selectedSupplier / ชี้ไปเจ้าที่ไม่มีตัวตน / เจ้านั้นไม่ได้เสนอราคาแถวนั้น) */
export function mixedTotals(doc: Pick<PriceCompare, "items" | "suppliers" | "selectedSupplier" | "lineSupplier">): PcMixedTotals | null {
  const subtotals = doc.suppliers.map(() => 0)
  const lineCounts = doc.suppliers.map(() => 0)
  for (let i = 0; i < doc.items.length; i++) {
    const si = effectiveLineSupplier(doc, i)
    if (si == null) return null
    const idx = si - 1
    const s = doc.suppliers[idx]
    if (!s) return null
    const lt = lineTotal(doc.items[i], s.prices[i] ?? null)
    if (lt == null) return null
    subtotals[idx] += lt
    lineCounts[idx] += 1
  }
  const perSupplier = doc.suppliers.map((s, i) => {
    const subtotal = round2(subtotals[i])
    const lines = lineCounts[i]
    if (s.vatMode === "incl") return { subtotal, vat: round2(subtotal - subtotal / (1 + VAT_RATE)), net: subtotal, lines }
    if (s.vatMode === "none") return { subtotal, vat: 0, net: subtotal, lines }
    const vat = round2(subtotal * VAT_RATE)
    return { subtotal, vat, net: round2(subtotal + vat), lines }
  })
  return {
    perSupplier,
    grand: round2(perSupplier.reduce((a, p) => a + p.net, 0)),
    suppliersUsed: perSupplier.filter((p) => p.lines > 0).length,
  }
}

/** สุทธิรวมของโหมดผสมตามที่เลือกอยู่จริง — null เมื่อยังมีแถวที่ไม่มี supplier ที่ใช้ได้ */
export function mixedNet(doc: Pick<PriceCompare, "items" | "suppliers" | "selectedSupplier" | "lineSupplier">): number | null {
  return mixedTotals(doc)?.grand ?? null
}

/** supplier ที่ให้ "สุทธิต่อแถวหลัง VAT" ต่ำสุดของแต่ละแถว (1-based, null ถ้าไม่มีใครเสนอราคาแถวนั้น)
 *  เทียบหลัง VAT เพราะฐานราคาที่แต่ละเจ้าเสนอไม่เหมือนกัน (excl/incl/none) — เทียบก่อน VAT จะเข้าข้างเจ้าที่เสนอแบบ excl */
export function pickLowestPerLine(doc: Pick<PriceCompare, "items" | "suppliers">): (number | null)[] {
  return doc.items.map((_, i) => {
    let best: number | null = null, bestNet = Infinity
    doc.suppliers.forEach((_s, si) => {
      const n = lineNet(doc, i, si)
      if (n != null && n < bestNet) { bestNet = n; best = si + 1 }
    })
    return best
  })
}

/** สุทธิรวมที่ต่ำที่สุดเท่าที่เป็นไปได้ ถ้าเลือกเจ้าที่ถูกสุดทุกแถว (ไม่สนว่าเลือกจริงเป็นใคร) — ใช้เทียบว่า mix ที่เลือกอยู่ห่างจากที่ดีที่สุดแค่ไหน */
export function bestMixNet(doc: Pick<PriceCompare, "items" | "suppliers">): number | null {
  return mixedTotals({ items: doc.items, suppliers: doc.suppliers, selectedSupplier: null, lineSupplier: pickLowestPerLine(doc) })?.grand ?? null
}

const supplierPricesComplete = (doc: Pick<PriceCompare, "items">, s: PcSupplier) =>
  doc.items.length > 0 && doc.items.every((_, i) => s.prices[i] != null)

/** supplier ที่มีชื่อและราคาครบทุกแถว — นับเป็น "ใบเสนอราคาที่ใช้เทียบได้" */
export function completeSupplierCount(doc: Pick<PriceCompare, "items" | "suppliers">): number {
  return doc.suppliers.filter((s) => s.name.trim() && supplierPricesComplete(doc, s)).length
}

/** ใบเสนอราคาหมดอายุเมื่อ validUntil < วันนี้ (ไม่ระบุ = ไม่เตือน) */
export const isQuoteExpired = (s: Pick<PcSupplier, "validUntil">, today: string): boolean =>
  !!s.validUntil && s.validUntil.slice(0, 10) < today.slice(0, 10)

export function isComplete(doc: PriceCompare, opts: { requireCommitteeNames?: boolean } = {}): { ok: boolean; missing: string[] } {
  const requireNames = opts.requireCommitteeNames ?? true
  const missing: string[] = []
  if (doc.items.length === 0) missing.push("รายการ")
  const full = completeSupplierCount(doc)
  if (full < 1) missing.push("supplier อย่างน้อย 1 รายที่มีราคาครบทุกแถว")
  else if (full < MIN_QUOTES && !doc.fewerQuotesReason.trim()) missing.push(`ใบเสนอราคาครบ ${MIN_QUOTES} ราย หรือระบุเหตุผลที่มีน้อยกว่า ${MIN_QUOTES} ราย`)
  if (requireNames && doc.committee.some((m) => !m.name.trim())) missing.push("ชื่อกรรมการ")
  const mixed = allLinesAwarded(doc)   // โหมด mix เต็มรูปแบบ: ทุกรายการกำหนด supplier ของตัวเองแล้ว ไม่ต้องพึ่ง selectedSupplier ของทั้งใบ
  if (doc.selectedSupplier == null && !mixed) missing.push("ผู้ได้รับเลือก")
  else if (doc.selectedSupplier != null) {
    const low = lowestNet(doc)
    if (low != null && doc.selectedSupplier !== low + 1 && !doc.selectionReason.trim()) missing.push("เหตุผลที่ไม่เลือกรายสุทธิต่ำสุด")
  } else {
    // โหมด mix: ถ้ามีรายการไหนไม่ได้เลือกถูกสุดของรายการนั้น ต้องมีเหตุผลรวม (ใช้ selectionReason เดียวกัน)
    const low = pickLowestPerLine(doc)   // 1-based, เทียบหลัง VAT เหมือน bestMixNet
    const anyNotLowest = doc.items.some((_, i) => low[i] != null && doc.lineSupplier[i] !== low[i])
    if (anyNotLowest && !doc.selectionReason.trim()) missing.push("เหตุผลที่ไม่เลือกรายสุทธิต่ำสุด")
  }
  return { ok: missing.length === 0, missing }
}

export function canTransition(from: PcStatus, to: PcStatus, doc: PriceCompare): { ok: boolean; reason?: string } {
  if (from === to) return { ok: true }
  if (from === "ร่าง" && to === "รอลงนาม") {
    const r = isComplete(doc, { requireCommitteeNames: false })
    return r.ok ? { ok: true } : { ok: false, reason: `ยังขาด: ${r.missing.join(", ")}` }
  }
  if (from === "รอลงนาม" && to === "เสร็จสิ้น") {
    if (doc.selectedSupplier == null && !allLinesAwarded(doc)) return { ok: false, reason: "ยังไม่เลือกผู้ได้รับเลือก" }
    if (doc.committee.some((m) => !m.name.trim() || !m.signedDate)) return { ok: false, reason: "ชื่อและวันที่ลงนามของกรรมการยังไม่ครบ 4 ช่อง" }
    return { ok: true }
  }
  if (from === "รอลงนาม" && to === "ร่าง") return { ok: true }
  if (from === "เสร็จสิ้น" && to === "รอลงนาม") return { ok: true }   // เปิดแก้ไข
  return { ok: false, reason: `เปลี่ยนสถานะจาก ${from} เป็น ${to} ไม่ได้` }
}

/* ---------- normalize / validate ---------- */
const str = (v: unknown): string => (v == null ? "" : String(v)).trim()
const num = (v: unknown, dflt = 0): number => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, "")); return isFinite(n) ? n : dflt }
const numOrNull = (v: unknown): number | null => { if (v === "" || v == null) return null; const n = num(v, NaN); return isFinite(n) ? n : null }
const files = (v: unknown): PcFile[] => Array.isArray(v)
  ? v.filter((f) => f && typeof f === "object" && f.mediaId != null).map((f) => ({
      mediaId: Number(f.mediaId), batchId: str(f.batchId), filename: str(f.filename), webpUrl: str(f.webpUrl), thumbnailUrl: str(f.thumbnailUrl),
    }))
  : []
const intInRange = (v: unknown, max: number): number | null => { const n = numOrNull(v); return n != null && Number.isInteger(n) && n >= 1 && n <= max ? n : null }

/* eslint-disable @typescript-eslint/no-explicit-any -- input เป็น unknown จาก JSON body/DB, cast เป็น any ภายในฟังก์ชัน normalize นี้เท่านั้นเพื่อ narrow เอง */
export function normalizeDoc(input: unknown): PriceCompare {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, any>
  const items: PcItem[] = (Array.isArray(b.items) ? b.items : []).map((it: any) => ({ name: str(it?.name), qty: num(it?.qty, 0), unit: str(it?.unit) }))
  const suppliers: PcSupplier[] = (Array.isArray(b.suppliers) ? b.suppliers : []).slice(0, MAX_SUPPLIERS).map((s: any) => {
    const c = s?.conditions ?? {}
    const prices = Array.isArray(s?.prices) ? s.prices.map(numOrNull) : []
    // NOTE: เอกสารเก่าอาจมี s.extraOptions (ร่าง multi-grade ที่ถูกตัดทิ้ง) — ทิ้งเงียบๆ ไม่ต้อง migrate
    return {
      name: str(s?.name), garageId: s?.garageId ? str(s.garageId) : undefined, note: str(s?.note),
      prices: items.map((_, i) => prices[i] ?? null),
      discount: num(s?.discount, 0),
      vatMode: (["excl", "incl", "none"] as PcVatMode[]).includes(s?.vatMode) ? (s.vatMode as PcVatMode) : "excl",
      quoteDate: str(s?.quoteDate).slice(0, 10), validUntil: str(s?.validUntil).slice(0, 10),
      conditions: { ...emptyConditions(), ...Object.fromEntries(Object.keys(emptyConditions()).map((k) => [k, str(c[k])])) } as PcConditions,
      quotationFiles: files(s?.quotationFiles),
    }
  })
  const lineSupplierRaw: any[] = Array.isArray(b.lineSupplier) ? b.lineSupplier : []
  const lineSupplier: (number | null)[] = items.map((_, i) => intInRange(lineSupplierRaw[i], MAX_SUPPLIERS))
  const rawCommittee: any[] = Array.isArray(b.committee) ? b.committee : []
  const committee: PcCommittee[] = DEFAULT_COMMITTEE_ROLES.map((role, i) => {
    const m = rawCommittee[i] ?? {}
    return { role: str(m.role) || role, name: str(m.name), email: str(m.email), pickedSupplier: intInRange(m.pickedSupplier, MAX_SUPPLIERS), reason: str(m.reason), signedDate: str(m.signedDate).slice(0, 10) }
  })
  const status: PcStatus = PC_STATUSES.includes(b.status) ? b.status : "ร่าง"
  const l = b.links ?? {}
  return {
    ...(b._id ? { _id: String(b._id) } : {}),
    docNo: str(b.docNo), title: str(b.title), requestDept: str(b.requestDept),
    preparedBy: { name: str(b.preparedBy?.name), email: str(b.preparedBy?.email) },
    revision: Math.max(0, Math.floor(num(b.revision, 0))),
    createdAt: str(b.createdAt), updatedAt: str(b.updatedAt), status,
    items, suppliers, committee,
    selectedSupplier: intInRange(b.selectedSupplier, MAX_SUPPLIERS), lineSupplier,
    selectionReason: str(b.selectionReason), fewerQuotesReason: str(b.fewerQuotesReason),
    links: { prCode: str(l.prCode) || undefined, plate: str(l.plate) || undefined, fleetNo: str(l.fleetNo) || undefined, repairExternalId: str(l.repairExternalId) || undefined },
    evidenceFiles: files(b.evidenceFiles),
    createdBy: str(b.createdBy), editedBy: str(b.editedBy),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function validateDoc(doc: PriceCompare): string[] {
  const errs: string[] = []
  if (doc.items.length === 0) errs.push("ต้องมีรายการอย่างน้อย 1 แถว")
  doc.items.forEach((it, i) => { if (!(it.qty > 0)) errs.push(`รายการที่ ${i + 1}: จำนวนต้องมากกว่า 0`) })
  if (doc.suppliers.length === 0) errs.push("ต้องมี supplier อย่างน้อย 1 ราย")
  if (doc.suppliers.length > MAX_SUPPLIERS) errs.push(`supplier ได้สูงสุด ${MAX_SUPPLIERS} ราย`)
  doc.suppliers.forEach((s, i) => {
    if (s.prices.length !== doc.items.length) errs.push(`Supplier ${i + 1}: จำนวนช่องราคาไม่ตรงกับรายการ`)
    if (s.prices.some((p) => p != null && p < 0)) errs.push(`Supplier ${i + 1}: ราคาติดลบไม่ได้`)
    if (s.discount < 0) errs.push(`Supplier ${i + 1}: ส่วนลดติดลบไม่ได้`)
  })
  const n = doc.suppliers.length
  if (doc.selectedSupplier != null && (doc.selectedSupplier < 1 || doc.selectedSupplier > n)) errs.push(`ผู้ได้รับเลือกต้องอยู่ระหว่าง Supplier 1–${n}`)
  if (doc.lineSupplier.length !== doc.items.length) errs.push("จำนวนช่องเลือก supplier ต่อรายการไม่ตรงกับรายการ")
  doc.lineSupplier.forEach((ls, i) => {
    if (ls == null) return
    if (ls < 1 || ls > n) { errs.push(`รายการที่ ${i + 1}: เลือก supplier ลำดับที่ ${ls} ซึ่งไม่มี`); return }
    // เลือกเจ้าที่ไม่ได้เสนอราคาแถวนั้น = ยอดรวมโหมดผสมคำนวณไม่ได้ (mixedTotals คืน null)
    if (doc.suppliers[ls - 1]?.prices[i] == null) errs.push(`แถว ${i + 1}: เจ้าที่เลือกไม่ได้เสนอราคา`)
  })
  doc.committee.forEach((m, i) => {
    if (m.pickedSupplier != null && (m.pickedSupplier < 1 || m.pickedSupplier > n)) errs.push(`กรรมการช่องที่ ${i + 1}: เลือก supplier ลำดับที่ ${m.pickedSupplier} ซึ่งไม่มี`)
  })
  return errs
}

/* ---------- เลขที่เอกสาร PC-YYMM-NNN (YY = ค.ศ. 2 หลักท้าย ตามฟอร์มต้นแบบ PC-2609-002 = ก.ย. 2026) ---------- */
function yymm(bkkDate: string): string {
  return `${bkkDate.slice(2, 4)}${bkkDate.slice(5, 7)}`
}
export const docNoFor = (bkkDate: string, seq: number): string => `PC-${yymm(bkkDate)}-${String(seq).padStart(3, "0")}`
export const counterKeyFor = (bkkDate: string): string => `price_compare:${yymm(bkkDate)}`

/** true เมื่อ string เป็นเลขที่เอกสารรูปแบบ PC-YYMM-NNN (ใช้แยกจาก ObjectId ในเส้นทาง [id]) */
export const isDocNo = (s: string): boolean => /^PC-\d{4}-\d{3}$/.test(s)

export const fmtMoney = (n: number | null | undefined): string =>
  n == null ? "" : n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
