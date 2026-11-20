// lib/store-withdraw/hub-core.ts — ตรรกะล้วนของอะไหล่ Hub (ไม่แตะ DB/env)
import type { SwLine, SwRequest, SwHubStatus, SwWorkType } from "./types"
import { issuedOf } from "./pending"
import { isPendingFlow } from "./core"

/** PR เติมของ Hub ต้องเปิดภายใน 24 ชม. หลังจ่าย */
export const HUB_PR_DUE_MS = 24 * 3600_000
export const HUB_WORK_TYPES: SwWorkType[] = ["garage_in", "mobile_pm"]

export const isHubLine = (l: SwLine): boolean => !!l.hub?.vendorCode

/** บรรทัดปกติที่จ่ายได้ (ไม่เอา Hub) */
export function normalIssueLines(lines: SwLine[]): { index: number; line: SwLine }[] {
  const out: { index: number; line: SwLine }[] = []
  lines.forEach((line, index) => { if (!isHubLine(line) && issuedOf(line) > 0) out.push({ index, line }) })
  return out
}

/** บรรทัด Hub ที่จ่ายได้ */
export function hubIssueLines(lines: SwLine[]): { index: number; line: SwLine }[] {
  const out: { index: number; line: SwLine }[] = []
  lines.forEach((line, index) => { if (isHubLine(line) && issuedOf(line) > 0) out.push({ index, line }) })
  return out
}

/** WD ของ Hub เสร็จหรือยัง (ไม่มีอะไรต้องตัด = เสร็จ) */
export function hubWdDone(r: Pick<SwRequest, "hubWd" | "settleGroups" | "lines"> & Partial<Pick<SwRequest, "summary" | "summaryDueAt" | "workType">>): boolean {
  if (hubIssueLines(r.lines).length === 0) return true
  if (!isPendingFlow(r)) return !!(r.hubWd?.code && r.hubWd.approved)
  // pending: ยังไม่สรุป = ยังไม่มีอะไรให้ตัด Hub → ไม่เสร็จ · สรุปแล้วไม่ใช้ Hub เลย = เสร็จ
  if (!r.summary) return false
  const used = r.summary.usages.reduce((n, u) => n + (isHubLine(r.lines[u.lineIndex] ?? ({} as SwLine)) ? u.qty : 0), 0)
  if (used <= 0) return true
  const groups = (r.settleGroups ?? []).filter(g => g.hub)
  return groups.length > 0 && groups.every(g => g.status === "DONE")
}

/** จ่ายของ Hub ไปแล้วแต่ทุกบรรทัด Hub จ่าย 0 = ไม่มีอะไรต้องตาม (ไม่ต้อง PR/WD) */
const hubNothingOut = (r: { hubIssuedAt?: Date | null; lines?: SwLine[] }): boolean =>
  !!r.hubIssuedAt && !!r.lines?.some(isHubLine) && hubIssueLines(r.lines).length === 0

export function hubStatusOf(r: SwRequest): SwHubStatus {
  if (r.status === "REJECTED" || r.status === "CANCELLED") return "NONE"
  if (!r.lines.some(isHubLine)) return "NONE"
  if (!r.hubIssuedAt) return "WAIT_ISSUE"
  if (hubNothingOut(r)) return "NONE"
  const pr = !!r.hubPr
  const wd = hubWdDone(r)
  if (!pr && !wd) return "WAIT_PR_WD"
  if (pr && !wd) return "WAIT_WD"
  if (!pr && wd) return "WAIT_PR"
  return "DONE"
}

export function hubPrOverdue(r: Pick<SwRequest, "hubIssuedAt" | "hubPr"> & Partial<Pick<SwRequest, "lines">>, now: Date): boolean {
  if (!r.hubIssuedAt || r.hubPr || hubNothingOut(r)) return false
  return now.getTime() - new Date(r.hubIssuedAt).getTime() > HUB_PR_DUE_MS
}

/** แผนตัดยอด hub_stock ต่อบรรทัด Hub */
export function hubCutPlan(lines: SwLine[], _inventoryId: number): { lineIndex: number; vendorCode: string; skuId: number; qty: number }[] {
  return hubIssueLines(lines).map(({ index, line }) => ({ lineIndex: index, vendorCode: line.hub!.vendorCode, skuId: line.skuId, qty: issuedOf(line) }))
}

/** field Hub ที่ส่งไปกับใบในคิว/ใบของฉัน — คิดที่เซิร์ฟเวอร์ ใช้เวลาของเซิร์ฟเวอร์ (ใบไม่มี Hub → count 0, status NONE) */
export type HubWire = { hubStatus: SwHubStatus; hubOverdue: boolean; hubCount: number; hubWdDone: boolean; hubRetry: boolean }

export function hubWire(r: SwRequest, now: Date): HubWire {
  const hubCount = r.lines.filter(isHubLine).length
  if (hubCount === 0) return { hubStatus: "NONE", hubOverdue: false, hubCount: 0, hubWdDone: true, hubRetry: false }
  const wdDone = hubWdDone(r)
  const open = r.status !== "REJECTED" && r.status !== "CANCELLED"
  // ตรงกับเงื่อนไขของ retryHubWd: ส่งแล้ว + WD Hub ยังไม่เสร็จ · Mobile/PM ต้องสรุปตัดสต๊อกเสร็จ (SETTLED) แล้ว
  const hubRetry = open && !!r.hubIssuedAt && !wdDone && (!isPendingFlow(r) || r.status === "SETTLED")
  return { hubStatus: hubStatusOf(r), hubOverdue: hubPrOverdue(r, now), hubCount, hubWdDone: wdDone, hubRetry }
}

export const withHub = <T extends SwRequest>(r: T, now: Date): T & HubWire => ({ ...r, ...hubWire(r, now) })

/** "ส่งแล้ววันนี้" หรือ "ส่งแล้ว 19/11" — เทียบวันตามเวลาไทยของ hubIssuedAt (ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์) */
export function hubSentText(issuedAt: Date | string, now: Date): string {
  const f = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric" }).format(d)
  const at = new Date(issuedAt)
  if (f(at) === f(now)) return "ส่งแล้ววันนี้"
  return `ส่งแล้ว ${f(at).slice(0, 5)}`
}

/** ชื่อไทยของ action Hub ในประวัติทุกขั้น (action อื่นแสดงชื่อเดิม) */
export const HUB_ACTION_LABEL: Record<string, string> = {
  hubShort: "ยอด Hub ไม่พอ",
  hubBusy: "ยอด Hub กำลังถูกใช้ ลองใหม่",
  "hubCut-orphan": "ตัดยอด Hub แล้วแต่ส่งของไม่สำเร็จ (ต้องเช็กเอง)",
  hubWd: "ตัด WD Hub",
  hubWdFailed: "ตัด WD Hub ไม่สำเร็จ",
  "hubWd-unknown": "ตัด WD Hub ไม่รู้ผล รอลองใหม่",
  "hubWd-after-close": "ได้ WD Hub หลังปิดใบ (ต้องเช็กเอง)",
  hubRestore: "คืนยอด Hub",
  "hubRestore-skipped": "ข้ามการคืนยอด Hub (ต้องเช็กเอง)",
  hubPr: "ผูก PR อะไหล่ Hub",
}
