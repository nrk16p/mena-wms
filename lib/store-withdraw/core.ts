// lib/store-withdraw/core.ts — ตรรกะล้วนของงานเบิกของหน้าร้านคลัง (สถานะ · เรียงคิว · ตรวจจำนวน)
// ไม่แตะ DB/env เพื่อให้ทดสอบตรง ๆ ด้วย tsx ได้
import type { SwAction, SwKind, SwLine, SwRef, SwRequest, SwStatus, SwWorkType } from "./types"

/** Mobile/PM แบบ pending (ส่งของก่อน สรุปแล้วค่อยตัด) = ใบ mobile_pm ที่มีกำหนดสรุปยอด · ใบ mobile_pm เก่าก่อนมีฟีเจอร์ใช้ขั้นตอนเดิม */
export const isPendingFlow = (r: { workType?: SwWorkType; summaryDueAt?: Date | string | null }): boolean =>
  r.workType === "mobile_pm" && r.summaryDueAt != null

export function nextStatus(
  req: Pick<SwRequest, "status" | "kind"> & { atms?: { gmId: number | null }; workType?: SwWorkType; summaryDueAt?: Date | string | null },
  action: SwAction,
): SwStatus | null {
  const { status, kind } = req
  const pending = isPendingFlow(req)
  switch (action) {
    case "claim": return status === "NEW" ? "PREPARING" : null
    case "ready": return status === "PREPARING" ? "READY" : null
    // pending: ส่งของ = ไม่แตะ ATMS · ใบ pending จะไม่มีทางเข้า ISSUING (กันยิง ATMS ผิดขั้น)
    case "handOut": return pending && status === "READY" ? "HANDED_OUT" : null
    case "summarize": return pending && status === "HANDED_OUT" ? "SUMMARIZED" : null
    case "settle": return pending && (status === "SUMMARIZED" || status === "SETTLE_FAILED") ? "SETTLING" : null
    case "settled": return status === "SETTLING" ? "SETTLED" : null
    case "settleFailed": return status === "SETTLING" ? "SETTLE_FAILED" : null
    case "issue":
      if (pending) return null
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

// ---------- ประเภทงาน (อู่ใน / อู่นอก / Mobile-PM) ----------

/** เหตุผลที่ขอคืน — เลือกจากรายการ (ผู้ขอเห็น label + hint · สโตร์เห็น label) */
export const RETURN_REASONS = [
  { code: "unused", label: "ไม่ได้ใช้", hint: "เบิกไปแล้วไม่ได้ใช้งาน คืนเข้าสต๊อก" },
  { code: "claim", label: "ส่งเคลม", hint: "ของไม่ตรงรุ่นหรือชำรุด ส่งเคลมกับผู้ขาย" },
  { code: "sell", label: "ขายออก", hint: "ของที่บริษัทไม่ใช้ ขายออก" },
  { code: "keep_other_truck", label: "เก็บไว้ใช้คันอื่น", hint: "ไม่ตรงกับรถคันนี้ แต่ใช้กับรถคันอื่นได้" },
  { code: "over_order", label: "เบิกเกินที่ใช้จริง", hint: "เบิกมาเกินจำนวนที่ใช้" },
  { code: "job_cancelled", label: "งานยกเลิก / ซ่อมเสร็จก่อน", hint: "ไม่ต้องใช้อะไหล่แล้ว" },
  { code: "other", label: "อื่นๆ", hint: "ระบุเหตุผลเอง" },
] as const
export type ReturnReasonCode = (typeof RETURN_REASONS)[number]["code"]

export const WORK_TYPES: SwWorkType[] = ["garage_in", "garage_out", "mobile_pm"]
export const WORK_TYPE_LABEL: Record<SwWorkType, string> = { garage_in: "อู่ใน", garage_out: "อู่นอก", mobile_pm: "Mobile/PM" }
/** ประเภทงาน → kind ที่เก็บ (อู่นอกซื้อมาใช้เลย = ตัดยอด · นอกนั้นเบิกจากสต๊อก) */
export const WORK_TYPE_KIND: Record<SwWorkType, SwKind> = { garage_in: "stock", garage_out: "cutoff", mobile_pm: "stock" }
/** ใบเก่า/ไคลเอนต์เก่าที่ไม่มี workType: stock → อู่ใน, cutoff → อู่นอก */
export const workTypeFromKind = (kind: SwKind): SwWorkType => (kind === "cutoff" ? "garage_out" : "garage_in")

/** ตรวจ workType + kind ที่ส่งมาพร้อมกัน · ไม่ส่ง workType = อนุมานจาก kind · ขัดกัน/ผิดรูปแบบ = { error } */
export function resolveWorkType(rawWorkType: unknown, rawKind: unknown): { workType: SwWorkType; kind: SwKind } | { error: string } {
  const kind = rawKind === "stock" || rawKind === "cutoff" ? rawKind : null
  if (rawKind != null && rawKind !== "" && !kind) return { error: "ประเภทคำขอไม่ถูกต้อง (stock หรือ cutoff)" }
  if (rawWorkType == null || rawWorkType === "") {
    if (!kind) return { error: "เลือกประเภทงาน (อู่ใน / อู่นอก / Mobile/PM)" }
    return { workType: workTypeFromKind(kind), kind }
  }
  if (typeof rawWorkType !== "string" || !(WORK_TYPES as string[]).includes(rawWorkType)) return { error: "ประเภทงานต้องเป็น garage_in, garage_out หรือ mobile_pm" }
  const workType = rawWorkType as SwWorkType
  if (kind && kind !== WORK_TYPE_KIND[workType]) return { error: `ประเภทงาน ${WORK_TYPE_LABEL[workType]} ต้องใช้ kind เป็น ${WORK_TYPE_KIND[workType]} ไม่ใช่ ${kind} ตรวจค่าที่ส่งมาอีกที` }
  return { workType, kind: WORK_TYPE_KIND[workType] }
}

// ---------- อ้างอิงใบ PO / DD / PR ----------

export const REF_CODE_MIN = 3
export const REF_CODE_MAX = 40

/** ตรวจ ref ที่ส่งมากับคำขอ · ไม่ใส่/null = ไม่อ้างอิง · ผิดรูปแบบ = { error } เป็นข้อความไทยพร้อมโชว์ */
export function parseRef(raw: unknown): { ref: SwRef | null } | { error: string } {
  if (raw == null) return { ref: null }
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "ใบอ้างอิงไม่ถูกต้อง เลือกใบ PO, DD หรือ PR ใหม่" }
  const r = raw as Record<string, unknown>
  if (r.type !== "po" && r.type !== "dd" && r.type !== "pr") return { error: "ประเภทใบอ้างอิงต้องเป็น po, dd หรือ pr" }
  const code = typeof r.code === "string" ? r.code.trim() : ""
  if (code.length < REF_CODE_MIN || code.length > REF_CODE_MAX) return { error: `เลขใบอ้างอิงต้องยาว ${REF_CODE_MIN}-${REF_CODE_MAX} ตัวอักษร` }
  let id: number | null = null
  if (r.id != null) {
    if (typeof r.id !== "number" || !Number.isInteger(r.id) || r.id <= 0) return { error: "id ของใบอ้างอิงไม่ถูกต้อง" }
    id = r.id
  }
  return { ref: { type: r.type, code, id } }
}

/** คำขอที่ยังนับว่า "ตัดไปแล้ว" — ที่ยกเลิก/ถูกปฏิเสธไม่นับ */
export const COUNTS_AS_CUT = (status: SwStatus): boolean => status !== "CANCELLED" && status !== "REJECTED"

/** รวมยอดที่คำขออื่นอ้างใบเดียวกันตัดไปแล้ว ต่อรหัสสินค้า (issuedQty ?? requestedQty) */
export function tallyCut(reqs: Pick<SwRequest, "no" | "status" | "lines">[]): Map<string, { qty: number; by: string[] }> {
  const out = new Map<string, { qty: number; by: string[] }>()
  for (const r of reqs) {
    if (!COUNTS_AS_CUT(r.status)) continue
    for (const l of r.lines) {
      const cur = out.get(l.skuCode) ?? { qty: 0, by: [] }
      cur.qty += l.issuedQty ?? l.requestedQty
      if (!cur.by.includes(r.no)) cur.by.push(r.no)
      out.set(l.skuCode, cur)
    }
  }
  return out
}

export type DocLineLite = { isLabour: boolean; receivedQty: number; alreadyCut: number }

/** ข้อความเตือนสั้น ๆ ของแผงรายการ (เตือนอย่างเดียว ไม่บล็อก) */
export function docWarnings(kind: "po" | "dd" | "pr", lines: DocLineLite[]): string[] {
  const w: string[] = []
  if (kind === "po" && lines.length > 0 && lines.every((l) => !(l.receivedQty > 0))) w.push("ใบนี้ยังไม่ได้รับของ")
  if (lines.some((l) => l.isLabour)) w.push("ใบนี้มีบรรทัดค่าแรง/บริการ")
  if (lines.some((l) => l.alreadyCut > 0)) w.push("บางบรรทัดมีคำขออื่นอ้างและตัดไปแล้ว")
  return w
}
