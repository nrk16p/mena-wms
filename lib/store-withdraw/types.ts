// lib/store-withdraw/types.ts — ชนิดข้อมูลของงานเบิกของหน้าร้านคลัง (ใบขอเบิก SW-yymm-nnn)
export type SwKind = "stock" | "cutoff"

/** ประเภทงานที่ผู้ขอเลือก (อู่ใน / อู่นอก / Mobile-PM) · kind ที่เก็บคู่กันยังเป็นตัวกำหนดวิธีตัดสต๊อก/ส่ง ATMS */
export type SwWorkType = "garage_in" | "garage_out" | "mobile_pm"

export type SwStatus =
  | "NEW" | "PREPARING" | "READY" | "ISSUING" | "ISSUED"
  | "ISSUE_FAILED" | "RECEIVED" | "REJECTED" | "CANCELLED"
  // Mobile/PM แบบ pending: ส่งของโดยยังไม่ตัด ATMS → ช่างสรุปการใช้ → สโตร์ตัดสต๊อก (WD แยกใบต่อทะเบียน)
  | "HANDED_OUT" | "SUMMARIZED" | "SETTLING" | "SETTLE_FAILED" | "SETTLED"

export type SwLine = {
  skuId: number
  skuCode: string
  skuName: string // ATMS ต้องการชื่อ SKU ในทุกบรรทัด — ส่งไปเป็น sku_name
  requestedQty: number
  issuedQty: number | null
  short: boolean
  returnedQty: number
  mrItemId: number | null
  mrItemLabel: string | null
  serialNoId: number | null
  remark: string
}

export type AtmsProgress = {
  gmId: number | null
  done: number[]
  approved: boolean
  code: string | null
  error: string | null
  needCreds: boolean
  lastCheckAt: Date | null
  drift: string | null
  startedAt: Date | null // ครั้งแรกที่ส่ง ATMS — ใช้เป็น date ทุกครั้งที่ retry (ATMS ค้นหมายเหตุตามวันสร้าง)
}

export type SwReturnStatus = "RETURN_REQUESTED" | "RETURNING" | "RETURNED" | "RETURN_FAILED"

export type SwReturn = {
  rid: string
  status: SwReturnStatus
  lines: { lineIndex: number; qty: number }[]
  reasonCode?: string      // รหัสเหตุผล (RETURN_REASONS)
  reason?: string          // เหตุผลที่ขอคืน (บังคับตอนขอ · ใบคืนเก่าก่อนมีฟีเจอร์ไม่มี)
  requestedBy: string
  acceptedBy: string | null
  atms: AtmsProgress
  createdAt: Date
}

/** ช่างสรุปว่าใช้ของบรรทัดไหนกับรถคันไหน · MR ไหน · ประเภทการซ่อมไหน */
export type SwUsage = { lineIndex: number; plate: string; mrCode: string; mrItemId: number; mrItemLabel: string; qty: number }

/** สรุปการใช้ของใบ Mobile/PM · returns = ของเหลือต่อบรรทัด (เบิก − ใช้) คำนวณให้ ไม่ต้องกรอก */
export type SwSummary = {
  usages: SwUsage[]
  returns: { lineIndex: number; qty: number }[]
  note: string
  by: { email: string; name: string }
  at: Date
}

/** WD หนึ่งใบต่อทะเบียน · เลขและบรรทัดถูกบันทึกตอนกดตัดครั้งแรก ลองใหม่ได้ค่าเดิมเสมอ */
export type SwSettleGroup = {
  n: number               // ลำดับกลุ่ม เริ่ม 1 (เรียงตามทะเบียน)
  plate: string
  token: string           // remark_token = `${no}-${n}`
  mrCodes: string[]
  lines: { lineIndex: number; mrItemId: number; qty: number }[]
  status: "PENDING" | "DONE"
  atms: AtmsProgress
}

/** ใบ PO / DD / PR ที่ผู้ขออ้างอิง (ไม่บังคับ) */
export type SwRef = { type: "po" | "dd" | "pr"; code: string; id: number | null }

export type SwRequest = {
  _id?: unknown
  no: string
  kind: SwKind
  /** ใบเก่าก่อนมีฟีเจอร์นี้ไม่มี field — ฝั่ง API คืนค่าที่อนุมานจาก kind ให้เสมอ */
  workType?: SwWorkType
  status: SwStatus
  inventoryId: number
  inventoryName: string
  pickToId: number
  pickToName: string
  plate: string
  mrCode: string | null
  /** ใบเก่าก่อนมีฟีเจอร์นี้ไม่มี field — ฝั่ง API คืน null ให้เสมอ */
  ref?: SwRef | null
  urgent: boolean
  remark: string
  lines: SwLine[]
  requestedBy: { email: string; name: string; via: "web" | "api" }
  claimedBy: { email: string; name: string } | null
  rejectReason: string | null
  atms: AtmsProgress
  returns: SwReturn[]
  /** Mobile/PM: กำหนดสรุปยอด (ใบที่มี field นี้ = ใช้ขั้นตอน pending) · ใบเก่า/งานอื่นไม่มี */
  summaryDueAt?: Date | null
  summaryExtensions?: number
  summary?: SwSummary | null
  settleGroups?: SwSettleGroup[]
  returnConfirmedBy?: { email: string; name: string } | null
  returnConfirmedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

export type SwAction = "claim" | "ready" | "issue" | "issued" | "issueFailed" | "receive" | "reject" | "closeManual" | "cancel"
  | "handOut" | "summarize" | "settle" | "settled" | "settleFailed"
