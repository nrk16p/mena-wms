// แปลงรหัสในเอกสาร SKU → ชื่อเต็ม โดยใช้ map จาก /api/codes/labels
export type Label = { th: string; en: string }
export type CodeLabels = Record<string, Record<string, Label>>

/** ชื่อไทยของรหัส (ถ้าไม่เจอคืนรหัสเดิม) — L2/L3 ส่ง parent มาด้วยได้ เช่น parent "SUS" หรือ "SUS:BUS" */
export function labelOf(labels: CodeLabels, dict: string, code: string, parent?: string): string {
  if (!code) return ""
  const d = labels[dict]
  if (!d) return code
  const hit = (parent ? d[`${parent}:${code}`] : undefined) ?? d[code]
  return hit?.th || code
}

/** "SUS — ระบบช่วงล่าง" (ถ้าไม่เจอชื่อ คืนแค่รหัส) */
export function codeWithLabel(labels: CodeLabels, dict: string, code: string, parent?: string): string {
  if (!code) return ""
  const th = labelOf(labels, dict, code, parent)
  return th && th !== code ? `${code} — ${th}` : code
}

/** ชื่อเต็มของ L2 โดยลองทั้งชุดอะไหล่และชุดค่าแรง */
export function l2Label(labels: CodeLabels, l1: string, l2: string): string {
  if (!l2) return ""
  const a = labelOf(labels, "SUB_ASSEMBLY_L2", l2, l1)
  if (a !== l2) return a
  return labelOf(labels, "LAB_L2", l2, l1)
}

/** ชื่อเต็มของ L3 โดยลองทั้งชุดอะไหล่และชุดค่าแรง (พ่อแม่ของ L3 คือ "L1:L2") */
export function l3Label(labels: CodeLabels, l1: string, l2: string, l3: string): string {
  if (!l3) return ""
  const a = labelOf(labels, "COMPONENT_L3", l3, `${l1}:${l2}`)
  if (a !== l3) return a
  return labelOf(labels, "LAB_L3", l3, l2)
}
