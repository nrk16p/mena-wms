// lib/store-withdraw/core.ts — ตรรกะล้วนของงานเบิกของหน้าร้านคลัง (สถานะ · เรียงคิว · ตรวจจำนวน)
// ไม่แตะ DB/env เพื่อให้ทดสอบตรง ๆ ด้วย tsx ได้
import type { SwAction, SwLine, SwRequest, SwStatus } from "./types"

export function nextStatus(req: Pick<SwRequest, "status" | "kind">, action: SwAction): SwStatus | null {
  const { status, kind } = req
  switch (action) {
    case "claim": return status === "NEW" ? "PREPARING" : null
    case "ready": return status === "PREPARING" ? "READY" : null
    case "issue":
      if (status === "READY" || status === "ISSUE_FAILED") return "ISSUING"
      if (status === "NEW" && kind === "cutoff") return "ISSUING" // ตัดยอดข้ามขั้นจัดของได้
      return null
    case "issued": return status === "ISSUING" ? "ISSUED" : null
    case "issueFailed": return status === "ISSUING" ? "ISSUE_FAILED" : null
    case "receive": return status === "ISSUED" && kind === "stock" ? "RECEIVED" : null
    case "reject": return status === "NEW" || status === "PREPARING" || status === "READY" ? "REJECTED" : null
    case "cancel": return status === "NEW" ? "CANCELLED" : null
  }
  return null
}

/** เร่งด่วนก่อน แล้วเก่าก่อน — คืนอาร์เรย์ใหม่ ไม่แก้ของเดิม */
export function queueSort(a: SwRequest[]): SwRequest[] {
  return [...a].sort((x, y) =>
    Number(y.urgent) - Number(x.urgent) || x.createdAt.getTime() - y.createdAt.getTime())
}

export function issueLines(lines: SwLine[]): { index: number; line: SwLine }[] {
  const out: { index: number; line: SwLine }[] = []
  lines.forEach((line, index) => { if ((line.issuedQty ?? line.requestedQty) > 0) out.push({ index, line }) })
  return out
}

export function validateLineEdit(line: SwLine, issuedQty: number): string | null {
  if (!Number.isFinite(issuedQty)) return "จำนวนไม่ถูกต้อง"
  if (issuedQty < 0) return "จำนวนติดลบไม่ได้"
  if (issuedQty > line.requestedQty) return `จ่ายได้ไม่เกินที่ขอ (${line.requestedQty})`
  return null
}

export function returnableQty(line: SwLine, pending: number): number {
  const issued = line.issuedQty ?? line.requestedQty
  return Math.max(0, issued - line.returnedQty - pending)
}

export function formatNo(yymm: string, seq: number): string {
  return `SW-${yymm}-${String(seq).padStart(3, "0")}`
}

export function waitMinutes(createdAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 60000))
}
