// scripts/check-ap-search-index.ts — รัน: npx tsx scripts/check-ap-search-index.ts
// ค้นข้ามเดือน (/api/ap-tracking/search) แบบในหน่วยความจำ ต้องได้ผล "ตรงตัว" กับคิวรี Mongo เดิม
//   • ต้นแบบ (oldSearch) = โค้ดของ route ก่อนเปลี่ยน คัดลอกมาทั้งก้อน วิ่งบน Mongo ปลอมที่จับคู่แบบ Mongo
//     (regex/$in/$or/$nor · แตกอาร์เรย์ · dotted path · ลำดับ natural order + limit)
//   • ของใหม่ (searchApIndex) วิ่งบนดัชนีที่สร้างจากเอกสารชุดเดียวกัน → เทียบ JSON ทีละคำค้น
import assert from "node:assert/strict"
import { AP_NO_FIELDS, parseAmount, parseDmy } from "../lib/ap-tracking"
import {
  buildApSearchIndex, searchApIndex, findDdHead, toDdRow,
  type ApSearchIndex, type ApSearchRaw,
} from "../lib/ap-search-index"

type Doc = Record<string, unknown>

// ── Mongo ปลอม: ความหมายการจับคู่แบบ Mongo (เขียนแยกจาก lib โดยตั้งใจ — ไม่งั้นเทสต์จะพิสูจน์ตัวเอง) ──
// ค่าที่ path: แตกอาร์เรย์ระหว่างทาง · ชั้นใบได้ทั้งตัวอาร์เรย์และสมาชิกแต่ละตัว (ไม่ลงลึกกว่านั้น)
function valuesAt(v: unknown, path: string[]): unknown[] {
  if (!path.length) return Array.isArray(v) ? [v, ...v] : [v]
  if (Array.isArray(v)) return v.flatMap((el) => (el && typeof el === "object" && !Array.isArray(el) ? valuesAt(el, path) : []))
  if (v && typeof v === "object") return valuesAt((v as Doc)[path[0]], path.slice(1))
  return [undefined]
}
function matches(doc: Doc, filter: Doc): boolean {
  for (const [k, cond] of Object.entries(filter)) {
    if (k === "$or") { if (!(cond as Doc[]).some((c) => matches(doc, c))) return false; continue }
    if (k === "$nor") { if ((cond as Doc[]).some((c) => matches(doc, c))) return false; continue }
    const vals = valuesAt(doc, k.split("."))
    if (cond instanceof RegExp) {
      // regex ของ Mongo จับเฉพาะค่าที่เป็นสตริง (ตัวเลข/วันที่/null ไม่จับ)
      if (!vals.some((v) => typeof v === "string" && cond.test(v))) return false
    } else if (cond && typeof cond === "object" && "$in" in (cond as Doc)) {
      const list = (cond as { $in: unknown[] }).$in
      if (!vals.some((v) => list.includes(v))) return false
    } else if (!vals.some((v) => v === cond)) return false
  }
  return true
}
function fakeClient(data: Record<string, Record<string, Doc[]>>) {
  return {
    db: (name: string) => ({
      collection: (c: string) => ({
        find: (filter: Doc) => {
          let lim = Infinity
          const cur = {
            limit(n: number) { lim = n; return cur },
            maxTimeMS() { return cur },
            async toArray() { return (data[name]?.[c] ?? []).filter((d) => matches(d, filter)).slice(0, lim) },
          }
          return cur
        },
      }),
    }),
  }
}

// ── ต้นแบบ = route เดิม (ก่อนเปลี่ยน) ทั้งก้อน ──────────────────────────────────────────
const LIMIT = 20
const s = (v: unknown) => (v == null ? "" : String(v)).trim()
async function oldSearch(client: ReturnType<typeof fakeClient>, rawQ: string) {
  const q = rawQ.trim()
  if (q.length < 3) return { hits: [] }
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
  const md = "master_data"
  const byDocNo = await client.db(md).collection("ap_tracking")
    .find({ $or: [...AP_NO_FIELDS.map((f) => ({ [f.key]: rx })), { "paid.paymentNos": rx }] })
    .limit(40).maxTimeMS().toArray()
  const docNoCodes = byDocNo.map((d) => s(d.depositCode)).filter(Boolean)
  const atms = client.db("atms")
  const [poByVehicle, prByNote] = await Promise.all([
    atms.collection("purchase_orders").find({ "ยานพาหนะ": rx }).limit(60).maxTimeMS().toArray(),
    atms.collection("purchase_requests").find({ "หมายเหตุ": rx }).limit(60).maxTimeMS().toArray(),
  ])
  const prCodes = prByNote.map((x) => s(x["ใบขอสั่งซื้อ (PR)"])).filter(Boolean)
  const poFromPr = prCodes.length
    ? await atms.collection("purchase_orders").find({ "ใบขอสั่งซื้อ (PR)": { $in: prCodes } }).limit(60).maxTimeMS().toArray()
    : []
  const poCodes = [...new Set([...poByVehicle, ...poFromPr].map((x) => s(x["รหัส"])).filter(Boolean))]
  const or: Doc[] = [{ deposit_code: rx }, { supplier_ref_no: rx }, { supplier: rx }]
  if (docNoCodes.length) or.push({ deposit_code: { $in: docNoCodes } })
  if (poCodes.length) or.push({ purchase_order: { $in: poCodes } })
  const heads = await atms.collection("deposit_header")
    .find({ $or: or, $nor: [{ supplier: "", purchase_order: "" }] })
    .limit(LIMIT * 3).maxTimeMS().toArray()
  const hits = heads
    .map((h) => ({
      depositCode: s(h.deposit_code),
      purchaseOrder: s(h.purchase_order),
      supplier: s(h.supplier),
      warehouse: s(h.warehouse),
      amount: parseAmount(h.amount),
      receivedAt: parseDmy(h.received_at),
      month: parseDmy(h.received_at).slice(0, 7),
    }))
    .filter((h) => h.month)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, LIMIT)
  return { hits, total: hits.length }
}
// findOne({ deposit_code }) เดิมของ /api/ap-tracking/[code] (ไม่มี $nor — ใบคืนสต๊อกภายในก็เปิดได้)
function oldHead(raw: ApSearchRaw, code: string) {
  const h = raw.depositHeaders.find((d) => matches(d, { deposit_code: code }))
  if (!h) return null
  // route ใช้ deposit_id แค่ "!= null" แล้วส่งเข้าคิวรี — ไม่มีฟิลด์ (undefined) กับ null จึงเท่ากัน
  return { depositId: h.deposit_id ?? null, hasPo: Boolean(h.purchase_order), purchaseOrder: s(h.purchase_order), supplier: s(h.supplier) }
}

// ── ข้อมูลสุ่มแบบกำหนดเมล็ด — ชนกันบ่อยโดยตั้งใจ (ให้เกิน limit) + ชนิดแปลก ๆ ครบ ──
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const r = rng(20261006)
const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
const pad = (x: string) => (r() < 0.1 ? ` ${x} ` : x)
const dd = (i: number) => `${pick(["LB", "KK", "SB"])}DD${String(26080000 + i).padStart(8, "0")}`
const DDS = Array.from({ length: 80 }, (_, i) => dd(i))
const POS = Array.from({ length: 70 }, (_, i) => `LBPO${String(2608000 + i)}`)
const PRS = Array.from({ length: 50 }, (_, i) => `LBPR${String(2608000 + i)}`)
const WORDS = ["กท-1234", "70-5521", "ซ่อมแอร์", "เปลี่ยนยาง", "MR2608", "Abc", "aBC12", "a.b", "a+b", "(x)", "[y]", "ยาง 11R22.5", "INV-0001", "inv-0002", "PV69", "LAPO2608"]
const text = () => Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(WORDS)).join(" ")
const strOrOdd = (f: () => string): unknown => {
  const x = r()
  if (x < 0.06) return null
  if (x < 0.1) return undefined
  if (x < 0.14) return 12345
  if (x < 0.22) return [f(), pick([f(), 7, null, [f()]])]
  if (x < 0.25) return ""
  return pad(f())
}
const nosOf = (): unknown => {
  const x = r()
  if (x < 0.4) return undefined
  if (x < 0.45) return pick(WORDS)                   // สตริงเดี่ยว (ไม่ใช่ลิสต์) — Mongo ยังจับ regex ได้
  return Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick([pick(WORDS), `${pick(WORDS)}-${Math.floor(r() * 99)}`, 5, null, [pick(WORDS)]]))
}
const dateOf = (): unknown => {
  const x = r()
  if (x < 0.05) return null
  if (x < 0.08) return "ไม่ใช่วันที่"
  if (x < 0.1) return 20260801
  return `${1 + Math.floor(r() * 28)}/${pick(["1", "07", "8", "09"])}/${pick(["2025", "2026"])}${r() < 0.7 ? " 10:15" : ""}`
}

function makeRaw(n = 1): ApSearchRaw {
  const k = n
  const apTracking: Doc[] = Array.from({ length: 300 * k }, () => {
    const d: Doc = { depositCode: r() < 0.05 ? "" : r() < 0.05 ? 9 : pick(DDS) }
    for (const f of AP_NO_FIELDS) { const v = nosOf(); if (v !== undefined) d[f.key] = v }
    const p = r()
    if (p < 0.3) d.paid = { paymentNos: nosOf(), date: "2026-08-01" }
    else if (p < 0.35) d.paid = [{ paymentNos: [pick(WORDS)] }, { paymentNos: pick(WORDS) }, 3]
    else if (p < 0.38) d.paid = pick(WORDS)          // paid เป็นสตริง — path paid.paymentNos ไม่มีค่า
    else if (p < 0.4) d.paid = null
    d.log = [{ action: "x" }]                         // ฟิลด์อื่นต้องไม่มีผล
    return d
  })
  const purchaseOrders: Doc[] = Array.from({ length: 450 * k }, () => {
    const d: Doc = { "รหัส": r() < 0.04 ? null : r() < 0.04 ? "" : pad(pick(POS)) }
    const v = strOrOdd(text); if (v !== undefined) d["ยานพาหนะ"] = v
    const pr = r() < 0.15 ? undefined : r() < 0.08 ? [pick(PRS), pick(PRS)] : r() < 0.05 ? 77 : pad(pick(PRS))
    if (pr !== undefined) d["ใบขอสั่งซื้อ (PR)"] = pr
    return d
  })
  const purchaseRequests: Doc[] = Array.from({ length: 450 * k }, () => {
    const d: Doc = { "ใบขอสั่งซื้อ (PR)": r() < 0.04 ? null : r() < 0.04 ? 77 : pad(pick(PRS)) }
    const v = strOrOdd(text); if (v !== undefined) d["หมายเหตุ"] = v
    return d
  })
  const depositHeaders: Doc[] = Array.from({ length: 500 * k }, (_, i) => {
    const d: Doc = {
      deposit_id: r() < 0.03 ? null : r() < 0.03 ? `s${i}` : 1000 + i,
      deposit_code: r() < 0.05 ? [pick(DDS), pick(DDS)] : r() < 0.03 ? null : pad(pick(DDS)),
      purchase_order: r() < 0.25 ? "" : r() < 0.05 ? null : r() < 0.05 ? [pick(POS)] : pad(pick(POS)),
      supplier: r() < 0.25 ? "" : r() < 0.05 ? undefined : pick(["บจก. ABC ออโต้", "หจก. ยางดี", "Thai Parts Co.", "a.b supply", "ร้าน (x) อะไหล่"]),
      supplier_ref_no: strOrOdd(() => pick(WORDS)),
      warehouse: pick(["คลังลาดกระบัง", "คลังสระบุรี", "", null]),
      amount: pick(["1,234.50", "0.00", 99, "x", null, "12,000"]),
      received_at: dateOf(),
    }
    for (const [key, val] of Object.entries(d)) if (val === undefined) delete d[key]
    return d
  })
  return { apTracking, purchaseOrders, purchaseRequests, depositHeaders }
}

async function main() {
  // 1. คำค้นสั้นกว่า 3 ตัว → { hits: [] } (ไม่มี total) เหมือนเดิม
  {
    const ix = buildApSearchIndex(makeRaw())
    assert.deepEqual(searchApIndex(ix, ""), { hits: [] })
    assert.deepEqual(searchApIndex(ix, "ab"), { hits: [] })
    assert.deepEqual(searchApIndex(ix, "  ab  "), { hits: [] })
  }

  // 2. เทียบกับ route เดิมทุกคำค้น — ทั้งดัชนีสด และดัชนีที่ผ่าน JSON (แคชกลางเก็บเป็น JSON)
  for (const seedSize of [1, 2]) {
    const raw = makeRaw(seedSize)
    const client = fakeClient({
      master_data: { ap_tracking: raw.apTracking },
      atms: { purchase_orders: raw.purchaseOrders, purchase_requests: raw.purchaseRequests, deposit_header: raw.depositHeaders },
    })
    const ix = buildApSearchIndex(raw)
    const ixJson = JSON.parse(JSON.stringify(ix)) as ApSearchIndex
    const queries = new Set<string>([
      "DD2", "dd2", "LBDD", "PO26", "lbpo", "LBPR2608", "กท-", "ซ่อม", "ยาง", "abc", "ABC", "a.b", "a+b", "(x)", "[y]",
      "11R22.5", "inv-", "INV", "PV6", "LAPO", "ไม่มีทางเจอ", "ออโต้", "หจก", "  ซ่อมแอร์  ", ".*.", "a\\b", "$^|", "12345", "77",
    ])
    for (const w of [...WORDS, ...DDS, ...POS, ...PRS]) {
      const i = Math.floor(r() * Math.max(1, w.length - 3))
      queries.add(w.slice(i, i + 3 + Math.floor(r() * 4)))
      queries.add(w.toUpperCase().slice(0, 4))
    }
    let nonEmpty = 0
    // จำนวนแถวที่ตรงสูงสุดต่อ collection — ต้องเกินเพดานจริง ไม่งั้นการเทียบ limit/ลำดับไม่ได้ถูกทดสอบ
    const most = { tracks: 0, po: 0, pr: 0, dd: 0 }
    for (const q of queries) {
      const want = await oldSearch(client, q)
      const got = searchApIndex(ix, q)
      assert.equal(JSON.stringify(got), JSON.stringify(want), `คำค้น "${q}" ต้องได้ผลเหมือนเดิมทุกตัวอักษร`)
      assert.equal(JSON.stringify(searchApIndex(ixJson, q)), JSON.stringify(want), `คำค้น "${q}" (ดัชนีผ่าน JSON)`)
      if (want.hits.length) nonEmpty++
      if (q.trim().length < 3) continue
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      const n = (docs: Doc[], f: Doc) => docs.filter((d) => matches(d, f)).length
      most.tracks = Math.max(most.tracks, n(raw.apTracking, { $or: [...AP_NO_FIELDS.map((f) => ({ [f.key]: rx })), { "paid.paymentNos": rx }] }))
      most.po = Math.max(most.po, n(raw.purchaseOrders, { "ยานพาหนะ": rx }))
      most.pr = Math.max(most.pr, n(raw.purchaseRequests, { "หมายเหตุ": rx }))
      most.dd = Math.max(most.dd, n(raw.depositHeaders, { $or: [{ deposit_code: rx }, { supplier_ref_no: rx }, { supplier: rx }] }))
    }
    assert.ok(nonEmpty > 20, "ชุดคำค้นต้องมีผลจริงพอให้การเทียบมีความหมาย")
    assert.ok(most.tracks > 40 && most.po > 60 && most.pr > 60 && most.dd > 60, `ต้องมีคำค้นที่เกินเพดาน: ${JSON.stringify(most)}`)
  }

  // 3. หัวใบสำหรับ /api/ap-tracking/[code] — ตัวแรกตาม natural order · ใบคืนสต๊อกภายในก็หาเจอ · ไม่เจอ = null
  {
    const raw: ApSearchRaw = {
      apTracking: [], purchaseOrders: [], purchaseRequests: [],
      depositHeaders: [
        { deposit_id: 1, deposit_code: "LBDD1", purchase_order: "", supplier: "" },            // คืนสต๊อกภายใน
        { deposit_id: 2, deposit_code: ["X", "LBDD2"], purchase_order: " PO2 ", supplier: " ร้าน ก " },
        { deposit_id: 3, deposit_code: "LBDD2", purchase_order: "PO3", supplier: "ร้าน ข" },     // ซ้ำ — ต้องได้ตัวแรก
        { deposit_code: " LBDD4", purchase_order: " ", supplier: null },                         // PO เป็นช่องว่าง: truthy แต่ s() = ""
        { deposit_id: "abc", deposit_code: "LBDD5" },
      ],
    }
    const ix = buildApSearchIndex(raw)
    for (const code of ["LBDD1", "LBDD2", "LBDD4", " LBDD4", "LBDD5", "X", "ไม่มี", "lbdd1"]) {
      const row = findDdHead(ix.dds, code)
      const want = oldHead(raw, code)
      assert.deepEqual(row && { depositId: row.depositId, hasPo: row.hasPo, purchaseOrder: row.purchaseOrder, supplier: row.supplier }, want, `หัวใบ ${code}`)
    }
    assert.equal(findDdHead(ix.dds, "LBDD2")?.depositId, 2, "ซ้ำ ต้องได้ตัวแรกตามลำดับเดิม")
    assert.equal(findDdHead(ix.dds, "LBDD4"), null, "เทียบตรงตัวแบบ Mongo — ไม่ trim ค่าในฐาน")
    assert.equal(findDdHead(ix.dds, " LBDD4")?.hasPo, true, "PO ช่องว่างยังนับว่ามีค่า (เหมือน if (head.purchase_order))")
    // deposit_id ชนิดแปลก (ไม่ใช่ตัวเลข/สตริง) — ทำเครื่องหมายไว้ให้ route ถอยไปอ่าน DB ตรง
    assert.equal(toDdRow({ deposit_id: { $oid: "x" }, deposit_code: "Z" }).oddId, true)
    assert.equal(toDdRow({ deposit_id: 5, deposit_code: "Z" }).oddId, undefined)
    assert.equal(toDdRow({ deposit_code: "Z" }).depositId, null)
  }

  // 4. ตัวอย่างอ่านง่าย — escape อักขระพิเศษ / ไม่สนตัวพิมพ์ / ตัดใบคืนสต๊อกภายใน / เรียงวันรับของล่าสุดก่อน
  {
    const raw: ApSearchRaw = {
      apTracking: [{ depositCode: "LBDD9", taxInvoiceNos: ["IV-77"] }, { depositCode: "LBDD8", paid: { paymentNos: ["PV-77"] } }],
      purchaseOrders: [{ "รหัส": "PO1", "ยานพาหนะ": "กท-9999", "ใบขอสั่งซื้อ (PR)": "PR1" }],
      purchaseRequests: [{ "ใบขอสั่งซื้อ (PR)": "PR1", "หมายเหตุ": "MR-555 ซ่อมแอร์" }],
      depositHeaders: [
        { deposit_code: "LBDD7", purchase_order: "PO1", supplier: "ร้าน A", warehouse: "w", amount: "1,000.00", received_at: "02/09/2026 09:00" },
        { deposit_code: "LBDD8", purchase_order: "", supplier: "ร้าน B", warehouse: "w", amount: "5", received_at: "03/09/2026" },
        { deposit_code: "LBDD9", purchase_order: "", supplier: "", warehouse: "w", amount: "5", received_at: "04/09/2026" }, // คืนสต๊อกภายใน
        { deposit_code: "AxB", purchase_order: "PO9", supplier: "ร้าน C", warehouse: "w", amount: "5", received_at: "05/09/2026" },
      ],
    }
    const ix = buildApSearchIndex(raw)
    assert.deepEqual(searchApIndex(ix, "กท-9999").hits.map((h) => h.depositCode), ["LBDD7"], "ทะเบียนบน PO → ใบ DD")
    assert.deepEqual(searchApIndex(ix, "mr-555").hits.map((h) => h.depositCode), ["LBDD7"], "หมายเหตุ PR → PO → ใบ DD (ไม่สนตัวพิมพ์)")
    assert.deepEqual(searchApIndex(ix, "-77").hits.map((h) => h.depositCode), ["LBDD8"], "เลขเอกสาร/PV จาก ap_tracking · ใบคืนสต๊อกภายในถูกตัด")
    assert.deepEqual(searchApIndex(ix, "A.B").hits, [], "จุดต้องเป็นตัวอักษรจริง ไม่ใช่ wildcard")
    assert.deepEqual(searchApIndex(ix, "ร้าน").hits.map((h) => h.depositCode), ["AxB", "LBDD8", "LBDD7"], "เรียงวันรับของล่าสุดก่อน")
    assert.deepEqual(searchApIndex(ix, "LBDD7").hits[0], {
      depositCode: "LBDD7", purchaseOrder: "PO1", supplier: "ร้าน A", warehouse: "w", amount: 1000, receivedAt: "2026-09-02", month: "2026-09",
    })
  }

  // 5. เพดานแต่ละชั้นตรงขอบ — แถวที่ N ต้องพาไปถึงใบ DD · แถวที่ N+1 ต้องไม่ (40 / 60 / 60 / 60 / 60)
  {
    const dd = (code: string, po: string, day: number): Doc =>
      ({ deposit_code: code, purchase_order: po, supplier: "ร้าน", warehouse: "w", amount: "1", received_at: `${day}/09/2026` })
    const check = async (name: string, raw: ApSearchRaw, q: string, want: string[]) => {
      const client = fakeClient({
        master_data: { ap_tracking: raw.apTracking },
        atms: { purchase_orders: raw.purchaseOrders, purchase_requests: raw.purchaseRequests, deposit_header: raw.depositHeaders },
      })
      const old = await oldSearch(client, q)
      assert.deepEqual(old.hits.map((h) => h.depositCode).sort(), [...want].sort(), `${name}: ต้นแบบ`)
      assert.equal(JSON.stringify(searchApIndex(buildApSearchIndex(raw), q)), JSON.stringify(old), name)
    }
    const empty: ApSearchRaw = { apTracking: [], purchaseOrders: [], purchaseRequests: [], depositHeaders: [] }
    const n = (k: number) => Array.from({ length: k }, (_, i) => i + 1)
    // ap_tracking 40: ใบที่ 40 เจอ ใบที่ 41 ไม่
    await check("ap_tracking 40", {
      ...empty,
      apTracking: n(41).map((i) => ({ depositCode: `D${i}`, voucherNos: ["LAPO-X"] })),
      depositHeaders: [dd("D40", "", 1), dd("D41", "", 2)].map((d) => ({ ...d, supplier: "s" })),
    }, "lapo-x", ["D40"])
    // PO ทะเบียน 60
    await check("PO ทะเบียน 60", {
      ...empty,
      purchaseOrders: n(61).map((i) => ({ "รหัส": `P${i}`, "ยานพาหนะ": "กท-1" })),
      depositHeaders: [dd("A", "P60", 1), dd("B", "P61", 2)],
    }, "กท-1", ["A"])
    // PR หมายเหตุ 60
    await check("PR หมายเหตุ 60", {
      ...empty,
      purchaseRequests: n(61).map((i) => ({ "ใบขอสั่งซื้อ (PR)": `R${i}`, "หมายเหตุ": "MR-9" })),
      purchaseOrders: [{ "รหัส": "P60", "ใบขอสั่งซื้อ (PR)": "R60" }, { "รหัส": "P61", "ใบขอสั่งซื้อ (PR)": "R61" }],
      depositHeaders: [dd("A", "P60", 1), dd("B", "P61", 2)],
    }, "mr-9", ["A"])
    // PO จาก PR 60
    await check("PO จาก PR 60", {
      ...empty,
      purchaseRequests: [{ "ใบขอสั่งซื้อ (PR)": "R1", "หมายเหตุ": "MR-9" }],
      purchaseOrders: n(61).map((i) => ({ "รหัส": `P${i}`, "ใบขอสั่งซื้อ (PR)": "R1" })),
      depositHeaders: [dd("A", "P60", 1), dd("B", "P61", 2)],
    }, "mr-9", ["A"])
    // deposit_header 60 → เรียงวันรับของแล้วตัด 20 — ใบที่ 61 (วันล่าสุด) ต้องไม่โผล่
    // 60 ใบแรก: วันที่ 1–20 ซ้ำกัน 3 รอบ → 20 ใบล่าสุด = วันที่ 15–20 ครบ (18 ใบ) + วันที่ 14 สองใบแรกตามลำดับเดิม
    const heads60 = [...n(60).map((i) => dd(`ZZZ${i}`, "", 1 + ((i - 1) % 20))), dd("ZZZ61", "", 28)]
    await check("deposit_header 60", { ...empty, depositHeaders: heads60 }, "zzz",
      [...n(60).filter((i) => (i - 1) % 20 >= 14).map((i) => `ZZZ${i}`), "ZZZ14", "ZZZ34"])
    const top = searchApIndex(buildApSearchIndex({ ...empty, depositHeaders: heads60 }), "zzz")
    assert.equal(top.total, 20)
    assert.ok(!top.hits.some((h) => h.depositCode === "ZZZ61"), "ใบที่ 61 ต้องไม่ติดผลแม้วันล่าสุด")
    assert.deepEqual(top.hits.slice(0, 3).map((h) => h.depositCode), ["ZZZ20", "ZZZ40", "ZZZ60"], "วันเท่ากันคงลำดับเดิม")
  }

  console.log("check-ap-search-index: ok")
}

main().catch((e) => { console.error(e); process.exit(1) })
