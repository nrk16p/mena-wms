// lib/store-withdraw/hub-core.ts — ตรรกะล้วนของอะไหล่ Hub (ไม่แตะ DB/env)
import type { SwLine, SwRequest, SwHubStatus, SwWorkType } from "./types"
import { issuedOf } from "./pending"

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
export function hubWdDone(r: Pick<SwRequest, "hubWd" | "settleGroups" | "lines"> & Partial<Pick<SwRequest, "summary" | "summaryDueAt">>): boolean {
  if (hubIssueLines(r.lines).length === 0) return true
  const pending = r.summaryDueAt != null || r.summary != null || r.settleGroups !== undefined
  if (!pending) return !!(r.hubWd?.code && r.hubWd.approved)
  // pending: ยังไม่สรุป = ยังไม่มีอะไรให้ตัด Hub → ไม่เสร็จ · สรุปแล้วไม่ใช้ Hub เลย = เสร็จ
  if (!r.summary) return false
  const used = r.summary.usages.reduce((n, u) => n + (isHubLine(r.lines[u.lineIndex] ?? ({} as SwLine)) ? u.qty : 0), 0)
  if (used <= 0) return true
  const groups = (r.settleGroups ?? []).filter(g => g.hub)
  return groups.length > 0 && groups.every(g => g.status === "DONE")
}

export function hubStatusOf(r: SwRequest): SwHubStatus {
  if (r.status === "REJECTED" || r.status === "CANCELLED") return "NONE"
  if (!r.lines.some(isHubLine)) return "NONE"
  if (!r.hubIssuedAt) return "WAIT_ISSUE"
  const pr = !!r.hubPr
  const wd = hubWdDone(r)
  if (!pr && !wd) return "WAIT_PR_WD"
  if (pr && !wd) return "WAIT_WD"
  if (!pr && wd) return "WAIT_PR"
  return "DONE"
}

export function hubPrOverdue(r: Pick<SwRequest, "hubIssuedAt" | "hubPr">, now: Date): boolean {
  if (!r.hubIssuedAt || r.hubPr) return false
  return now.getTime() - new Date(r.hubIssuedAt).getTime() > HUB_PR_DUE_MS
}

/** แผนตัดยอด hub_stock ต่อบรรทัด Hub */
export function hubCutPlan(lines: SwLine[], _inventoryId: number): { lineIndex: number; vendorCode: string; skuId: number; qty: number }[] {
  return hubIssueLines(lines).map(({ index, line }) => ({ lineIndex: index, vendorCode: line.hub!.vendorCode, skuId: line.skuId, qty: issuedOf(line) }))
}
