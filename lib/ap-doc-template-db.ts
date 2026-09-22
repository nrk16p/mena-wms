// lib/ap-doc-template-db.ts
// อ่านแม่แบบเอกสารของผู้ขายจาก master_data.ap_doc_template (ฝั่งเซิร์ฟเวอร์เท่านั้น)
// ใบ DD รู้แค่ "ชื่อ" ผู้ขาย (deposit_header.supplier) → หา atmsCode จาก ap_supplier ก่อน แล้วค่อยหาแม่แบบด้วยรหัส
// ถอยไปหาด้วยชื่อเมื่อไม่มีรหัส (เจ้าที่เพิ่มเองในหน้า suppliers ไม่มีใน ATMS / sync จับชื่อไม่ติด)
import type { Db } from "mongodb"
import { cleanTemplateDocs, type ApDocTemplate } from "@/lib/ap-doc-template"

export const AP_DOC_TEMPLATE_COLL = "ap_doc_template"

const s = (v: unknown) => (v == null ? "" : String(v)).trim()

export function toTemplate(d: Record<string, unknown> | null | undefined): ApDocTemplate | null {
  if (!d) return null
  return {
    code: s(d.code), name: s(d.name), docs: cleanTemplateDocs(d.docs),
    source: d.source === "manual" ? "manual" : "excel",
    updatedBy: s(d.updatedBy), updatedAt: s(d.updatedAt),
  }
}

export async function findTemplateForSupplier(md: Db, supplierName: string): Promise<{
  template: ApDocTemplate | null
  code: string
  creditTerm: string
}> {
  const name = s(supplierName)
  if (!name) return { template: null, code: "", creditTerm: "" }
  const sup = await md.collection("ap_supplier").findOne(
    { name }, { projection: { _id: 0, atmsCode: 1, creditTerm: 1 } },
  )
  const code = s(sup?.atmsCode)
  const col = md.collection(AP_DOC_TEMPLATE_COLL)
  const proj = { projection: { _id: 0, log: 0 } }
  const doc = (code ? await col.findOne({ code }, proj) : null) ?? await col.findOne({ name }, proj)
  return { template: toTemplate(doc), code, creditTerm: s(sup?.creditTerm) }
}
