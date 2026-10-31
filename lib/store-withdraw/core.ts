// lib/store-withdraw/core.ts — ตรรกะล้วนของงานเบิกของหน้าร้านคลัง (สถานะ · เรียงคิว · ตรวจจำนวน)
// ไม่แตะ DB/env เพื่อให้ทดสอบตรง ๆ ด้วย tsx ได้
import type { SwAction, SwLine, SwRequest, SwStatus } from "./types"

export function nextStatus(req: Pick<SwRequest, "status" | "kind"> & { atms?: { gmId: number | null } }, action: SwAction): SwStatus | null {
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
    case "reject":
      if (status === "NEW" || status === "PREPARING" || status === "READY") return "REJECTED"
      // ส่ง ATMS พลาดและยังไม่มี WD เกิดขึ้น (รู้แน่ว่า gmId ว่าง) = ปฏิเสธได้ ไม่งั้นใบค้างตลอด
      if (status === "ISSUE_FAILED" && req.atms && req.atms.gmId == null) return "REJECTED"
      return null
    // WD เกิดใน ATMS แล้วแต่ไปต่อไม่ได้ — สโตร์แก้ใน ATMS เองแล้วปิดใบ (ต้องมีหมายเหตุ)
    case "closeManual": return status === "ISSUE_FAILED" && req.atms && req.atms.gmId != null ? "REJECTED" : null
    case "cancel": return status === "NEW" ? "CANCELLED" : null
  }
  return null
}

/** เร่งด่วนก่อน แล้วเก่าก่อน — คืนอาร์เรย์ใหม่ ไม่แก้ของเดิม */
export function queueSort<T extends SwRequest>(a: T[]): T[] {
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

/** ไม่มีบรรทัดไหนจ่ายได้เลย (จ่าย 0 ทุกบรรทัด) */
export const allZeroIssue = (lines: SwLine[]): boolean => issueLines(lines).length === 0

/** limit จาก query: ค่าเสีย/0 = ค่าเริ่มต้น · ติดลบ = 1 · เกิน max = max */
export function clampLimit(raw: string | null, def: number, max: number): number {
  const n = parseInt(raw ?? "", 10)
  if (!Number.isFinite(n) || n === 0) return def
  return Math.min(Math.max(n, 1), max)
}

/** x-user ของ API key ต้องเป็นอีเมลบริษัทเท่านั้น */
export const validApiUser = (s: string): boolean => /^[^@\s]+@menatransport\.co\.th$/i.test(s)
