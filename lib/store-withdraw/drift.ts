// lib/store-withdraw/drift.ts — ตรวจว่าใบ WD ที่ WMS ตัดไปแล้วถูกแก้ใน ATMS ภายหลังหรือไม่ ("drift")
// อ่าน ATMS ด้วยบัญชีค้นข้อมูลของ WMS (ATMS_LOOKUP_USERNAME/PASSWORD) ไม่ล็อกอินแทนสโตร์ทีละคน
// เขียนเฉพาะ atms.drift + atms.lastCheckAt — ไม่แตะข้อมูลอื่น ไม่แตะ updatedAt
import { swCol } from "./db"
import { ncac } from "./ncac"
import type { SwLine, SwRequest } from "./types"

export const DRIFT_DELETED = "ใบถูกลบใน ATMS"
export const DRIFT_UNAPPROVED = "ใบถูกถอนอนุมัติใน ATMS"
const READ_TIMEOUT_MS = 15_000
const MAX_MESSAGES = 3

type WireItem = { sku_code?: unknown; amount?: unknown }
type Wire = { approved?: unknown; items?: WireItem[] } | null

/** จำนวนที่ WMS จ่ายจริงต่อ SKU (เฉพาะบรรทัดที่ถูกส่งไป ATMS = จำนวน > 0) */
export function expectedQty(lines: SwLine[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of lines) {
    const q = l.issuedQty ?? l.requestedQty
    if (!(q > 0)) continue
    m.set(l.skuCode, (m.get(l.skuCode) ?? 0) + q)
  }
  return m
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000)

/** เทียบใบจาก ATMS กับที่ WMS จ่าย — คืนข้อความไทยสั้น ๆ หรือ null ถ้าตรงกัน */
export function compareWithAtms(lines: SwLine[], wd: NonNullable<Wire>): string | null {
  if (wd.approved !== true) return DRIFT_UNAPPROVED
  const want = expectedQty(lines)
  const got = new Map<string, number>()
  for (const it of wd.items ?? []) {
    const code = String(it.sku_code ?? "").trim()
    if (!code) continue
    got.set(code, (got.get(code) ?? 0) + (Number(it.amount) || 0))
  }
  const msgs: string[] = []
  for (const [code, q] of want) {
    if (!got.has(code)) msgs.push(`ไม่พบ ${code} ในใบ ATMS แต่ WMS จ่าย ${fmt(q)}`)
    else if (Math.abs(got.get(code)! - q) > 1e-6) msgs.push(`จำนวน ${code} ใน ATMS เป็น ${fmt(got.get(code)!)} แต่ WMS จ่าย ${fmt(q)}`)
  }
  for (const [code, a] of got) if (!want.has(code)) msgs.push(`ATMS มี ${code} เพิ่ม ${fmt(a)} ที่ WMS ไม่ได้จ่าย`)
  if (!msgs.length) return null
  const extra = msgs.length - MAX_MESSAGES
  return msgs.slice(0, MAX_MESSAGES).join(" · ") + (extra > 0 ? ` · และอีก ${extra} รายการ` : "")
}

export type CheckState = "checked" | "skipped"

/** ตรวจใบเดียว · skipped = ไม่ได้ตรวจ (ยังไม่มี WD / ไม่ตั้งบัญชีอ่าน / ATMS ล่ม) และไม่แก้อะไรในใบ */
export async function checkDriftDetailed(no: string): Promise<{ request: SwRequest | null; state: CheckState }> {
  const col = await swCol()
  const cur = await col.findOne({ no })
  if (!cur) return { request: null, state: "skipped" }
  const gmId = cur.atms.gmId
  if (gmId == null) return { request: cur, state: "skipped" }
  const username = process.env.ATMS_LOOKUP_USERNAME
  const password = process.env.ATMS_LOOKUP_PASSWORD
  if (!username || !password) {
    console.warn(`[store-withdraw] drift ${no}: ยังไม่ได้ตั้ง ATMS_LOOKUP_USERNAME/PASSWORD — ข้ามการตรวจ`)
    return { request: cur, state: "skipped" }
  }
  let r: { status: number; data: Wire }
  try {
    r = await ncac<Wire>("GET", `/atms/withdraw/${gmId}`, { creds: { username, password }, timeoutMs: READ_TIMEOUT_MS })
  } catch (e) {
    console.warn(`[store-withdraw] drift ${no}: ติดต่อ api-ncac ไม่ได้ — ข้าม`, e instanceof Error ? e.message : e)
    return { request: cur, state: "skipped" }
  }
  let drift: string | null
  if (r.status === 404) drift = DRIFT_DELETED
  else if (r.status >= 200 && r.status < 300 && r.data) drift = compareWithAtms(cur.lines, r.data)
  else {
    console.warn(`[store-withdraw] drift ${no}: ATMS ตอบ ${r.status} — ข้าม`)
    return { request: cur, state: "skipped" }
  }
  const after = await col.findOneAndUpdate(
    { no },
    { $set: { "atms.drift": drift, "atms.lastCheckAt": new Date() } },
    { returnDocument: "after" },
  )
  return { request: after ?? cur, state: "checked" }
}

export async function checkDrift(no: string): Promise<SwRequest> {
  const { request } = await checkDriftDetailed(no)
  if (!request) throw new Error(`ไม่พบใบ ${no}`)
  return request
}

export type TickOpts = { max?: number; gapMs?: number; budgetMs?: number; now?: Date; sleep?: (ms: number) => Promise<void> }
export type TickResult = { checked: number; drifted: number; skipped: number }

const DAY = 86_400_000
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** ตรวจใบ ISSUED/RECEIVED อายุ ≤ 7 วัน เรียง lastCheckAt เก่าสุดก่อน · ห่าง ≥ gapMs · หยุดก่อนครบ budgetMs */
export async function driftTick(o: TickOpts = {}): Promise<TickResult> {
  const max = o.max ?? 40
  const gap = o.gapMs ?? 1_000
  const budget = o.budgetMs ?? 50_000
  const sleep = o.sleep ?? realSleep
  const started = Date.now()
  const since = new Date((o.now ?? new Date()).getTime() - 7 * DAY)
  const rows = await (await swCol())
    .find(
      { status: { $in: ["ISSUED", "RECEIVED"] }, updatedAt: { $gte: since }, "atms.gmId": { $ne: null } },
      { projection: { no: 1 } },
    )
    .sort({ "atms.lastCheckAt": 1, updatedAt: 1 })
    .limit(max)
    .toArray()
  let checked = 0, drifted = 0
  let calls = 0
  for (const row of rows) {
    // เผื่อเวลาของการเรียกครั้งถัดไป (ATMS timeout 15 วิ) — เกินงบก็หยุด
    if (Date.now() - started + (calls > 0 ? gap : 0) + READ_TIMEOUT_MS > budget) break
    if (calls > 0) await sleep(gap)
    calls++
    const { request, state } = await checkDriftDetailed(row.no)
    if (state !== "checked") continue
    checked++
    if (request?.atms.drift) drifted++
  }
  return { checked, drifted, skipped: rows.length - checked }
}
