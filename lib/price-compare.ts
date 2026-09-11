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
export type PcItem = {
  name: string; qty: number; unit: string; sku?: string
  // เกรด = แถวย่อยของรายการ: แถวที่ group เดียวกัน (ต้องอยู่ติดกัน) คือรายการเดียวที่มีหลายเกรด ใช้ชื่อ/จำนวน/หน่วย/sku ร่วมกัน
  // grade = ชื่อเกรดของแถวนั้น (มือ 1 / มือ 2 / ซ่อมของเดิม); ไม่มี group = รายการธรรมดา (กลุ่มขนาด 1)
  group?: string; grade?: string
}
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

/* ---------- เกรด: แถวแบน + group key (prices / lineSupplier ยังเป็นรายแถวเหมือนเดิม) ---------- */
export type PcGroup = { key: string; rows: number[] }
type LineSupplierOpt = { lineSupplier?: (number | null)[] }

/** กลุ่มของรายการตามลำดับที่ปรากฏครั้งแรก; แถวที่ไม่มี group = กลุ่มขนาด 1 ใช้ key สังเคราะห์ `#<index>`
 *  รวมตาม key แม้แถวไม่ติดกัน (เอกสารผิดรูป — validateDoc แจ้ง) เพื่อให้กติกา "เลือกได้ 1 เกรดต่อรายการ" ยังคุมทั้งกลุ่ม */
export function groupsOf(doc: Pick<PriceCompare, "items">): PcGroup[] {
  const out: PcGroup[] = []
  const byKey = new Map<string, PcGroup>()
  doc.items.forEach((it, i) => {
    if (!it.group) { out.push({ key: `#${i}`, rows: [i] }); return }
    const hit = byKey.get(it.group)
    if (hit) { hit.rows.push(i); return }
    const g = { key: it.group, rows: [i] }
    byKey.set(it.group, g)
    out.push(g)
  })
  return out
}

const pickedRows = (doc: LineSupplierOpt, g: PcGroup): number[] => g.rows.filter((i) => doc.lineSupplier?.[i] != null)

/** แถวที่นับเข้ายอดรวม: กลุ่มขนาด 1 นับเสมอ; กลุ่มหลายเกรดนับเฉพาะแถวที่เลือก (มี lineSupplier) — ยังไม่เลือก = ไม่นับทั้งกลุ่ม */
export function countedRows(doc: Pick<PriceCompare, "items"> & LineSupplierOpt): boolean[] {
  const out = doc.items.map(() => false)
  for (const g of groupsOf(doc)) {
    if (g.rows.length === 1) out[g.rows[0]] = true
    else for (const i of pickedRows(doc, g)) out[i] = true
  }
  return out
}

/** มีรายการที่มีหลายเกรดอย่างน้อย 1 รายการ → ทั้งใบเป็นโหมดเลือกรายบรรทัด (ไม่มีการเลือกทั้งใบ) */
export function hasGrades(doc: Pick<PriceCompare, "items">): boolean {
  return groupsOf(doc).some((g) => g.rows.length > 1)
}

/** รูปแบบ group id ที่ยอมรับ (normalizeDoc ทิ้ง group ที่ไม่ตรงรูปแบบ → กลายเป็นรายการธรรมดา กันชนกับ key สังเคราะห์ `#<i>`) */
const GROUP_ID_RE = /^g-[a-z0-9]{1,16}$/

/** id กลุ่มสุ่มสั้น เช่น g-k3x9ab (ห้าม import — ใช้ Math.random; 36^6 ≈ 2 พันล้าน)
 *  ส่ง existing (group ที่มีในใบอยู่แล้ว) มาเพื่อสุ่มใหม่เมื่อชน — สูงสุด 10 ครั้ง */
export function newGroupId(existing?: Iterable<string>): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789"
  const taken = new Set(existing ?? [])
  let id = ""
  for (let tries = 0; tries < 10; tries++) {
    id = "g-"
    for (let k = 0; k < 6; k++) id += abc[Math.floor(Math.random() * abc.length)]
    if (!taken.has(id)) break
  }
  return id
}

/** ยอดของ supplier รายหนึ่ง — คิดเฉพาะแถวที่นับ (countedRows): เกรดที่ไม่ได้เลือกไม่เข้ายอด; ไม่ส่ง lineSupplier = ยังไม่เลือกเกรดไหน */
export function supplierTotals(doc: Pick<PriceCompare, "items" | "suppliers"> & LineSupplierOpt, idx: number): PcTotals {
  const s = doc.suppliers[idx]
  if (!s) return { subtotal: 0, discount: 0, afterDiscount: 0, vat: 0, net: 0 }
  const counted = countedRows(doc)
  let subtotal = 0
  doc.items.forEach((it, i) => { if (!counted[i]) return; const lt = lineTotal(it, s.prices[i] ?? null); if (lt != null) subtotal += lt })
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

// index ของ supplier ที่สุทธิต่ำสุด — นับเฉพาะรายที่มีราคาอย่างน้อย 1 รายการในแถวที่นับ (ยอดก็คิดจากแถวที่นับ)
// มีรายการหลายเกรด → null: ยอดต่อเจ้านับแค่เกรดที่เลือก (เจ้าที่ไม่ได้เสนอเกรดนั้นยอดต่ำเพราะขาดรายการ) จึงชี้ "ถูกสุดทั้งใบ" ไม่ได้
// ใบมีเกรดเทียบกันที่ pickLowestPerLine / bestMixNet แทน (กติกาข้อ 4: เลือกรายบรรทัดทั้งใบ)
export function lowestNet(doc: Pick<PriceCompare, "items" | "suppliers"> & LineSupplierOpt): number | null {
  if (hasGrades(doc)) return null
  const counted = countedRows(doc)
  let best: number | null = null, bestNet = Infinity
  doc.suppliers.forEach((s, si) => {
    if (!s.prices.some((p, i) => p != null && counted[i])) return
    const { net } = supplierTotals(doc, si)
    if (net < bestNet) { bestNet = net; best = si }
  })
  return best
}

/** ยอดต่อเจ้าของใบที่มีเกรด "คิดครบ" หรือไม่: ทุกรายการต้องชี้ได้แถวเดียว (กลุ่มขนาด 1 = แถวนั้น, กลุ่มหลายเกรด = แถวที่เลือกแถวเดียว)
 *  และเจ้านี้ต้องเสนอราคาแถวนั้น — false เมื่อไม่มี supplier ลำดับนี้ / มีกลุ่มที่ยังไม่เลือกเกรดหรือเลือกเกิน 1 เกรด
 *  UI/PDF ใช้ตัดสินว่าจะแสดงยอดต่อเจ้า หรือ "ไม่ครบ" แทนยอดบางส่วนที่ชวนเข้าใจผิด (ใช้เฉพาะเมื่อ hasGrades) */
export function supplierCoversSelection(doc: Pick<PriceCompare, "items" | "suppliers"> & LineSupplierOpt, idx: number): boolean {
  const s = doc.suppliers[idx]
  if (!s) return false
  return groupsOf(doc).every((g) => {
    const rows = g.rows.length === 1 ? g.rows : pickedRows(doc, g)
    return rows.length === 1 && s.prices[rows[0]] != null
  })
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

/** เลื่อนเลขลำดับ supplier (1-based) หลังลบคอลัมน์ที่ตำแหน่ง removedIdx0 (0-based)
 *  เจ้าที่ถูกลบ → null (การมอบหมายนั้นหายไปพร้อมคอลัมน์), เจ้าที่อยู่หลังจากนั้นเลื่อนขึ้น 1, เจ้าก่อนหน้าคงเดิม
 *  ใช้ร่วมกันทั้ง lineSupplier ในตาราง และ selectedSupplier / committee[].pickedSupplier ในฟอร์ม */
export function renumberAfterRemoval(v: number | null, removedIdx0: number): number | null {
  if (v == null) return v
  if (v === removedIdx0 + 1) return null
  return v > removedIdx0 + 1 ? v - 1 : v
}

/** true เมื่อทุกรายการถูกกำหนด supplier ของตัวเองแล้ว (โหมด mix เต็มรูปแบบ ไม่ต้องพึ่ง selectedSupplier ของทั้งใบเลย)
 *  รายการหลายเกรด = ต้องเลือกครบ 1 แถวพอดี (แถวเกรดอื่นในกลุ่มเป็น null) */
export function allLinesAwarded(doc: Pick<PriceCompare, "items" | "lineSupplier">): boolean {
  return doc.items.length > 0 && doc.lineSupplier.length === doc.items.length &&
    groupsOf(doc).every((g) => pickedRows(doc, g).length === 1)
}

/** ยอดรวมโหมดผสม — แยกยอดตาม supplier ที่ถูกมอบหมายในแต่ละแถว แล้วคิด VAT ทีเดียวต่อเจ้าตาม vatMode ของเจ้านั้น
 *  ส่วนลดท้ายใบ "ไม่" ถูกนำมาคิด: ส่วนลดเป็นข้อตกลงของทั้งใบเสนอราคา ใช้อ้างไม่ได้เมื่อซื้อจากเจ้านั้นแค่บางรายการ
 *  null เมื่อมีแถวใดยังไม่มี supplier ที่ใช้ได้จริง (ไม่ได้กำหนดและไม่มี selectedSupplier / ชี้ไปเจ้าที่ไม่มีตัวตน / เจ้านั้นไม่ได้เสนอราคาแถวนั้น)
 *  รายการหลายเกรด: นับเฉพาะเกรดที่เลือก (ไม่ fallback ไป selectedSupplier) — ยังไม่เลือก / เลือกเกิน 1 เกรด → null */
export function mixedTotals(doc: Pick<PriceCompare, "items" | "suppliers" | "selectedSupplier" | "lineSupplier">): PcMixedTotals | null {
  const subtotals = doc.suppliers.map(() => 0)
  const lineCounts = doc.suppliers.map(() => 0)
  for (const g of groupsOf(doc)) {
    let i: number
    if (g.rows.length === 1) i = g.rows[0]
    else {
      const picked = pickedRows(doc, g)
      if (picked.length !== 1) return null
      i = picked[0]
    }
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
 *  เทียบหลัง VAT เพราะฐานราคาที่แต่ละเจ้าเสนอไม่เหมือนกัน (excl/incl/none) — เทียบก่อน VAT จะเข้าข้างเจ้าที่เสนอแบบ excl
 *  รายการหลายเกรด: เลือกคู่ (เกรด, เจ้า) ที่ถูกสุดของทั้งกลุ่ม แถวเกรดอื่นในกลุ่ม = null (ราคาเท่ากัน → แถวบนสุด/เจ้าลำดับแรกชนะ) */
export function pickLowestPerLine(doc: Pick<PriceCompare, "items" | "suppliers">): (number | null)[] {
  const out: (number | null)[] = doc.items.map(() => null)
  for (const g of groupsOf(doc)) {
    let bestRow = -1, bestSup = 0, bestNet = Infinity
    for (const i of g.rows) {
      doc.suppliers.forEach((_s, si) => {
        const n = lineNet(doc, i, si)
        if (n != null && n < bestNet) { bestNet = n; bestRow = i; bestSup = si + 1 }
      })
    }
    if (bestRow >= 0) out[bestRow] = bestSup
  }
  return out
}

/** สุทธิรวมที่ต่ำที่สุดเท่าที่เป็นไปได้ ถ้าเลือกเจ้าที่ถูกสุดทุกแถว (ไม่สนว่าเลือกจริงเป็นใคร) — ใช้เทียบว่า mix ที่เลือกอยู่ห่างจากที่ดีที่สุดแค่ไหน */
export function bestMixNet(doc: Pick<PriceCompare, "items" | "suppliers">): number | null {
  return mixedTotals({ items: doc.items, suppliers: doc.suppliers, selectedSupplier: null, lineSupplier: pickLowestPerLine(doc) })?.grand ?? null
}

/** ส่วนต่างระหว่างสุทธิรวมที่เลือกอยู่จริงกับสุทธิรวมที่ต่ำที่สุดเท่าที่เป็นไปได้ (บาท, ≥ 0 ตามนิยาม)
 *  null เมื่อคำนวณฝั่งใดฝั่งหนึ่งไม่ได้ — UI ใช้แสดง "(+Z บาท)" ในการ์ดโหมดผสม */
export function mixedGap(doc: Pick<PriceCompare, "items" | "suppliers" | "selectedSupplier" | "lineSupplier">): number | null {
  const cur = mixedNet(doc)
  const best = bestMixNet(doc)
  if (cur == null || best == null) return null
  return round2(cur - best)
}

const supplierPricesComplete = (doc: Pick<PriceCompare, "items">, s: PcSupplier) =>
  doc.items.length > 0 && groupsOf(doc).every((g) => g.rows.some((i) => s.prices[i] != null))

/** supplier ที่มีชื่อและราคาครบทุกรายการ — นับเป็น "ใบเสนอราคาที่ใช้เทียบได้" (รายการหลายเกรด: เสนออย่างน้อย 1 เกรดก็ถือว่าครบ) */
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
  if (hasGrades(doc)) {
    // กติกาข้อ 4: มีรายการหลายเกรด = เลือกรายบรรทัดทั้งใบ (ไม่มีช่องเลือกทั้งใบให้กด) → บอกเป็นรายรายการว่าขาดอะไร ไม่ใช่ "ผู้ได้รับเลือก"
    if (!mixed) missing.push(...lineSelectionGaps(doc))
    else if (mixNeedsReason(doc)) missing.push("เหตุผลที่ไม่เลือกรายสุทธิต่ำสุด")
  } else if (doc.selectedSupplier == null && !mixed) missing.push("ผู้ได้รับเลือก")
  else if (doc.selectedSupplier != null) {
    const low = lowestNet(doc)
    if (low != null && doc.selectedSupplier !== low + 1 && !doc.selectionReason.trim()) missing.push("เหตุผลที่ไม่เลือกรายสุทธิต่ำสุด")
  } else if (mixNeedsReason(doc)) missing.push("เหตุผลที่ไม่เลือกรายสุทธิต่ำสุด")
  return { ok: missing.length === 0, missing }
}

/** โหมด mix: ถ้ามีรายการไหนไม่ได้เลือกถูกสุดของรายการนั้น ต้องมีเหตุผลรวม (ใช้ selectionReason เดียวกัน)
 *  เทียบรายแถวกับ pickLowestPerLine (1-based, หลัง VAT, group-aware — เลือกเกรดอื่นในกลุ่ม = แถวถูกสุดของกลุ่มไม่ตรง) */
function mixNeedsReason(doc: PriceCompare): boolean {
  const low = pickLowestPerLine(doc)
  const anyNotLowest = doc.items.some((_, i) => low[i] != null && doc.lineSupplier[i] !== low[i])
  return anyNotLowest && !doc.selectionReason.trim()
}

/** สิ่งที่ยังขาดในการเลือกรายบรรทัด (ใช้กับเอกสารที่มีรายการหลายเกรด) — อ้างชื่อรายการ ไม่มีชื่อ → "รายการที่ N" (นับต่อรายการ)
 *  ไม่ว่างเสมอเมื่อ !allLinesAwarded(doc) */
function lineSelectionGaps(doc: Pick<PriceCompare, "items" | "lineSupplier">): string[] {
  const out: string[] = []
  groupsOf(doc).forEach((g, gi) => {
    const label = doc.items[g.rows[0]].name || `รายการที่ ${gi + 1}`
    const picks = pickedRows(doc, g).length
    if (picks > 1) out.push(`เลือกได้ไม่เกิน 1 เกรด: ${label}`)
    else if (picks === 0) out.push(g.rows.length > 1 ? `ยังไม่เลือกเกรด: ${label}` : `ยังไม่เลือกเจ้า: ${label}`)
  })
  if (out.length === 0 && !allLinesAwarded(doc)) out.push("จำนวนช่องเลือก supplier ต่อรายการไม่ตรงกับรายการ")
  return out
}

export function canTransition(from: PcStatus, to: PcStatus, doc: PriceCompare): { ok: boolean; reason?: string } {
  if (from === to) return { ok: true }
  if (from === "ร่าง" && to === "รอลงนาม") {
    const r = isComplete(doc, { requireCommitteeNames: false })
    return r.ok ? { ok: true } : { ok: false, reason: `ยังขาด: ${r.missing.join(", ")}` }
  }
  if (from === "รอลงนาม" && to === "เสร็จสิ้น") {
    if (hasGrades(doc)) {
      if (!allLinesAwarded(doc)) return { ok: false, reason: lineSelectionGaps(doc).join(", ") }
    } else if (doc.selectedSupplier == null && !allLinesAwarded(doc)) return { ok: false, reason: "ยังไม่เลือกผู้ได้รับเลือก" }
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
  const rawItems: PcItem[] = (Array.isArray(b.items) ? b.items : []).map((it: any) => {
    const rawGroup = str(it?.group), grade = str(it?.grade)
    const group = GROUP_ID_RE.test(rawGroup) ? rawGroup : ""   // ไม่ตรงรูปแบบ newGroupId → ถือเป็นรายการธรรมดา
    // รายการธรรมดาไม่มี key group/grade งอกออกมา (รูปทรงเอกสารเดิมคงเดิม); grade ไม่มีความหมายถ้าไม่มี group
    return { name: str(it?.name), qty: num(it?.qty, 0), unit: str(it?.unit), sku: str(it?.sku) || undefined, ...(group ? { group, ...(grade ? { grade } : {}) } : {}) }
  })
  // ชื่อ/จำนวน/หน่วย/sku เป็นของทั้งรายการ: คัดลอกจากแถวแรกของกลุ่มไปทุกแถวเกรด กันข้อมูลแตก
  // group ที่เหลือแถวเดียว = รายการธรรมดา → ถอด group/grade ออก ให้รูปทรงเหมือนรายการธรรมดาทุกประการ
  const items: PcItem[] = rawItems.slice()
  for (const g of groupsOf({ items: rawItems })) {
    if (g.rows.length < 2) {
      const it = rawItems[g.rows[0]]
      if (it.group) items[g.rows[0]] = { name: it.name, qty: it.qty, unit: it.unit, sku: it.sku }
      continue
    }
    const head = rawItems[g.rows[0]]
    for (const r of g.rows.slice(1)) {
      const { group, grade } = rawItems[r]
      items[r] = { name: head.name, qty: head.qty, unit: head.unit, sku: head.sku, group, ...(grade ? { grade } : {}) }
    }
  }
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
  // เลือกครบทุกแถวแล้ว = โหมดผสมเต็มใบ → selectedSupplier ของทั้งใบไม่มีความหมายอีก ล้างทิ้งตั้งแต่ normalize
  // (ไม่งั้นจะเหลือสถานะ "ตั้งไว้ทั้งคู่" ที่ UI/PDF/list ตีความคนละแบบ — ฟอร์มล้างให้อยู่แล้ว นี่คือด่านสุดท้ายฝั่ง server/DB)
  // มีรายการหลายเกรด = ทั้งใบเป็นโหมดเลือกรายบรรทัด (spec กติกาข้อ 4) → ล้าง selectedSupplier เช่นกัน
  const wholeDocOff = allLinesAwarded({ items, lineSupplier }) || hasGrades({ items })
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
    selectedSupplier: wholeDocOff ? null : intInRange(b.selectedSupplier, MAX_SUPPLIERS), lineSupplier,
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
  // normalizeDoc ล้างให้อยู่แล้ว — ด่านนี้กันเอกสารที่ประกอบมือ/มาจาก DB เก่าที่ยังตั้งค้างทั้งคู่ (ตีความยอดสุทธิได้สองแบบ)
  if (doc.selectedSupplier != null && allLinesAwarded(doc)) errs.push("เลือกทั้งใบและเลือกรายบรรทัดครบทุกแถวพร้อมกันไม่ได้")
  if (doc.lineSupplier.length !== doc.items.length) errs.push("จำนวนช่องเลือก supplier ต่อรายการไม่ตรงกับรายการ")
  doc.lineSupplier.forEach((ls, i) => {
    if (ls == null) return
    if (ls < 1 || ls > n) { errs.push(`รายการที่ ${i + 1}: เลือก supplier ลำดับที่ ${ls} ซึ่งไม่มี`); return }
    // เลือกเจ้าที่ไม่ได้เสนอราคาแถวนั้น = ยอดรวมโหมดผสมคำนวณไม่ได้ (mixedTotals คืน null)
    if (doc.suppliers[ls - 1]?.prices[i] == null) errs.push(`แถว ${i + 1}: เจ้าที่เลือกไม่ได้เสนอราคา`)
  })
  // รายการหลายเกรด: แถวต้องติดกัน, เลือกได้ไม่เกิน 1 เกรด, ทุกแถวต้องมีชื่อเกรด; และห้ามใช้การเลือกทั้งใบ (กติกาข้อ 4)
  const groups = groupsOf(doc)
  groups.forEach((g, gi) => {
    if (g.rows.length < 2) return
    const name = doc.items[g.rows[0]]?.name
    // อ้างด้วยชื่อรายการ — "รายการที่ N" ในข้อความอื่นของ validateDoc นับต่อแถว จะสับสนกับลำดับต่อรายการ
    const label = name ? `รายการ "${name}"` : `รายการไม่มีชื่อ (ลำดับที่ ${gi + 1})`
    if (g.rows.some((r, k) => k > 0 && r !== g.rows[k - 1] + 1)) errs.push(`${label}: แถวเกรดของรายการเดียวกันต้องอยู่ติดกัน`)
    if (pickedRows(doc, g).length > 1) errs.push(`${label}: เลือกได้ไม่เกิน 1 เกรด`)
    if (g.rows.some((r) => !(doc.items[r].grade ?? "").trim())) errs.push(`${label}: ต้องระบุชื่อเกรดทุกแถว`)
  })
  if (doc.selectedSupplier != null && groups.some((g) => g.rows.length > 1)) errs.push("มีรายการหลายเกรด ต้องเลือกรายบรรทัด — ใช้การเลือกทั้งใบไม่ได้")
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
