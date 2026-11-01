// รูปแบบข้อมูลที่หน้าฟอร์มใช้กับใบอ้างอิง PO / DD (ตรงกับ /api/store-withdraw/lookup/{po|dd} และ /lookup/doc/{kind}/{id})
export type DocKind = "po" | "dd"

export type DocHit = {
  id: number; code: string; kind: DocKind
  date: string | null; supplier: string | null; status: string | null; total: number | null; ref: string | null
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

export const DOC_LABEL: Record<DocKind, string> = { po: "PO", dd: "DD" }
