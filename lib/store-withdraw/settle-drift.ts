// lib/store-withdraw/settle-drift.ts — ตรวจ WD ต่อทะเบียนของใบ Mobile/PM ที่ตัดแล้ว (SETTLED) ว่าถูกแก้ใน ATMS ภายหลังหรือไม่
// ใช้กติกาเดียวกับ drift.ts (บัญชีค้นข้อมูล · อ่านอย่างเดียว · ไม่แตะ updatedAt) · HANDED_OUT/SUMMARIZED ยังไม่มี WD = ไม่ตรวจ
// เขียน settleGroups[].atms.drift ต่อกลุ่ม + สรุปรวมที่ atms.drift / atms.lastCheckAt ของใบ (การ์ดและตัวกันตรวจถี่ใช้ค่าเดิม)
import { swCol } from "./db"
import { DRIFT_DELETED, compareWithAtms, driftReady } from "./drift"
import { lookupCreds } from "./env"
import { ncac } from "./ncac"
import type { SwLine, SwRequest, SwSettleGroup } from "./types"

const READ_TIMEOUT_MS = 15_000
type Wire = { approved?: unknown; items?: { sku_code?: unknown; amount?: unknown }[] } | null

/** บรรทัดของกลุ่มในรูป SwLine (issuedQty = จำนวนที่ตัดในกลุ่ม) เพื่อใช้ compareWithAtms ตัวเดียวกับใบปกติ */
export function groupLines(r: Pick<SwRequest, "lines">, g: Pick<SwSettleGroup, "lines">): SwLine[] {
  return g.lines.map((x) => ({ ...r.lines[x.lineIndex], issuedQty: x.qty }))
}

export type SettleCheckState = "checked" | "skipped"

/** ตรวจทุกกลุ่มของใบ SETTLED · ATMS ล่มกลางทาง = บันทึกแค่เวลาที่ลอง (ธงเดิมคงไว้) */
export async function checkSettleDrift(no: string, sleep?: (ms: number) => Promise<void>, gapMs = 1_000): Promise<{ request: SwRequest | null; state: SettleCheckState; calls: number }> {
  const col = await swCol()
  const cur = await col.findOne({ no })
  if (!cur) return { request: null, state: "skipped", calls: 0 }
  const groups = (cur.settleGroups ?? []).filter((g) => g.status === "DONE" && g.atms.gmId != null)
  if (cur.status !== "SETTLED" || groups.length === 0 || !driftReady()) return { request: cur, state: "skipped", calls: 0 }

  const found = new Map<number, string | null>()
  let calls = 0
  let failed = false
  for (const g of groups) {
    if (calls > 0 && sleep) await sleep(gapMs)
    calls++
    let r: { status: number; data: Wire }
    try {
      r = await ncac<Wire>("GET", `/atms/withdraw/${g.atms.gmId}`, { creds: lookupCreds() ?? undefined, timeoutMs: READ_TIMEOUT_MS })
    } catch {
      failed = true
      break
    }
    if (r.status === 404) found.set(g.n, DRIFT_DELETED)
    else if (r.status >= 200 && r.status < 300 && r.data) found.set(g.n, compareWithAtms(groupLines(cur, g), r.data))
    else { failed = true; break }
  }
  const now = new Date()
  if (failed) {
    const after = await col.findOneAndUpdate({ no }, { $set: { "atms.lastCheckAt": now } }, { returnDocument: "after" })
    return { request: after ?? cur, state: "skipped", calls }
  }
  const $set: Record<string, unknown> = { "atms.lastCheckAt": now }
  const msgs: string[] = []
  for (const [i, g] of (cur.settleGroups ?? []).entries()) {
    if (!found.has(g.n)) continue
    const d = found.get(g.n)!
    $set[`settleGroups.${i}.atms.drift`] = d
    $set[`settleGroups.${i}.atms.lastCheckAt`] = now
    if (d) msgs.push(`${g.plate} (${g.atms.code ?? g.token}): ${d}`)
  }
  $set["atms.drift"] = msgs.length ? msgs.join(" · ") : null
  const after = await col.findOneAndUpdate({ no, status: "SETTLED" }, { $set }, { returnDocument: "after" })
  return { request: after ?? cur, state: "checked", calls }
}

export type SettleTickOpts = { max?: number; gapMs?: number; budgetMs?: number; now?: Date; sleep?: (ms: number) => Promise<void> }
const DAY = 86_400_000
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** ตรวจใบ SETTLED อายุ ≤ 7 วัน เรียง lastCheckAt เก่าสุดก่อน · เรียก ATMS ห่างกัน ≥ gapMs · หยุดก่อนครบ budgetMs */
export async function settleDriftTick(o: SettleTickOpts = {}): Promise<{ checked: number; drifted: number; skipped: number }> {
  if (!driftReady()) return { checked: 0, drifted: 0, skipped: 0 }
  const gap = o.gapMs ?? 1_000
  const budget = o.budgetMs ?? 50_000
  const sleep = o.sleep ?? realSleep
  const started = Date.now()
  const since = new Date((o.now ?? new Date()).getTime() - 7 * DAY)
  const rows = await (await swCol())
    .find({ status: "SETTLED", updatedAt: { $gte: since }, settleGroups: { $elemMatch: { "atms.gmId": { $ne: null } } } }, { projection: { no: 1 } })
    .sort({ "atms.lastCheckAt": 1, updatedAt: 1 })
    .limit(o.max ?? 10)
    .toArray()
  let checked = 0, drifted = 0, calls = 0
  for (const row of rows) {
    if (Date.now() - started + (calls > 0 ? gap : 0) + READ_TIMEOUT_MS > budget) break
    if (calls > 0) await sleep(gap)
    const res = await checkSettleDrift(row.no, sleep, gap)
    calls += res.calls
    if (res.state !== "checked") continue
    checked++
    if (res.request?.atms.drift) drifted++
  }
  return { checked, drifted, skipped: rows.length - checked }
}
