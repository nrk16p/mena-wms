// lib/store-withdraw/types.ts — ชนิดข้อมูลของงานเบิกของหน้าร้านคลัง (ใบขอเบิก SW-yymm-nnn)
export type SwKind = "stock" | "cutoff"

export type SwStatus =
  | "NEW" | "PREPARING" | "READY" | "ISSUING" | "ISSUED"
  | "ISSUE_FAILED" | "RECEIVED" | "REJECTED" | "CANCELLED"

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
}

export type SwReturnStatus = "RETURN_REQUESTED" | "RETURNING" | "RETURNED" | "RETURN_FAILED"

export type SwReturn = {
  rid: string
  status: SwReturnStatus
  lines: { lineIndex: number; qty: number }[]
  requestedBy: string
  acceptedBy: string | null
  atms: AtmsProgress
  createdAt: Date
}

export type SwRequest = {
  _id?: unknown
  no: string
  kind: SwKind
  status: SwStatus
  inventoryId: number
  inventoryName: string
  pickToId: number
  pickToName: string
  plate: string
  mrCode: string | null
  urgent: boolean
  remark: string
  lines: SwLine[]
  requestedBy: { email: string; name: string; via: "web" | "api" }
  claimedBy: { email: string; name: string } | null
  rejectReason: string | null
  atms: AtmsProgress
  returns: SwReturn[]
  createdAt: Date
  updatedAt: Date
}

export type SwAction = "claim" | "ready" | "issue" | "issued" | "issueFailed" | "receive" | "reject" | "cancel"
