// รูปแบบข้อมูลที่หน้าฟอร์มใช้กับใบอ้างอิง PO / DD / PR (ตรงกับ /api/store-withdraw/lookup/{po|dd|pr} และ /lookup/doc/{kind}/{id})
export type DocKind = "po" | "dd" | "pr"

export type DocHit = {
  id: number; code: string; kind: DocKind
  date: string | null; supplier: string | null; status: string | null; total: number | null; ref: string | null
  /** PR: ข้อความหมายเหตุของใบ (ใช้ให้ผู้ใช้ตรวจว่าตรงรถคันที่ต้องการ) */
  remark?: string | null
}

export type DocLineRow = {
  skuCode: string; skuName: string; group: string; isLabour: boolean
  docQty: number; receivedQty: number; qty: number; unitPrice: number | null
  skuId: number | null; stockQty: number | null; alreadyCut: number; cutBy: string[]
}

export type DocDetailResp = {
  doc: { id: number; code: string; kind: DocKind; date: string | null; supplier: string | null; pr: string | null; po: string | null }
  lines: DocLineRow[]
  warnings: string[]
}

/** บรรทัดที่ผู้ใช้เลือกนำเข้า */
export type ImportLine = { skuId: number; skuCode: string; skuName: string; qty: number; stockQty: number | null }

export const DOC_LABEL: Record<DocKind, string> = { po: "PO", dd: "DD", pr: "PR" }
export const DOC_KIND_NAME: Record<DocKind, string> = { po: "ใบสั่งซื้อ", dd: "ใบรับของ", pr: "ใบขอซื้อ" }
