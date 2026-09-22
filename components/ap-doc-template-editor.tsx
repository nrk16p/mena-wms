"use client"

// ตัวแก้แม่แบบเอกสารของผู้ขาย — ใช้ร่วมกันทั้งโมดัลใบ DD และหน้า /ap-tracking/suppliers
// บันทึกทันทีที่ระดับผู้ขาย (ไม่ผูกกับปุ่มบันทึกของใบ DD) เพราะแม่แบบใช้กับทุกใบของเจ้านั้น

import { useState } from "react"
import { AP_TEMPLATE_DOCS, cleanTemplateDocs, type ApDocTemplate, type ApTplDocKey } from "@/lib/ap-doc-template"

// PUT แม่แบบ — คีย์ = code (รหัส ATMS) · ไม่มีรหัสใช้ชื่อแทน (ฝั่ง API ใช้กติกาเดียวกัน)
export async function putDocTemplate(code: string, name: string, docs: ApTplDocKey[]): Promise<ApDocTemplate> {
  const res = await fetch("/api/ap-doc-templates", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name, docs }),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d?.error ?? "บันทึกแม่แบบไม่สำเร็จ")
  return d.template as ApDocTemplate
}

export function ApDocTemplateEditor({
  initial, onSave, onCancel, saving = false, note,
}: {
  initial: ApTplDocKey[]
  onSave: (docs: ApTplDocKey[]) => void
  onCancel: () => void
  saving?: boolean
  note?: string
}) {
  const [docs, setDocs] = useState<ApTplDocKey[]>(initial)
  const toggle = (k: ApTplDocKey, on: boolean) =>
    setDocs((xs) => (on ? [...xs, k] : xs.filter((x) => x !== k)))
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {AP_TEMPLATE_DOCS.map((d) => (
          <label key={d.key} className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input type="checkbox" className="h-3.5 w-3.5 accent-emerald-600" disabled={saving}
              checked={docs.includes(d.key)} onChange={(e) => toggle(d.key, e.target.checked)} />
            {d.label}
          </label>
        ))}
      </div>
      {note && <div className="text-[11px] text-gray-400">{note}</div>}
      <div className="flex gap-1.5">
        <button onClick={() => onSave(cleanTemplateDocs(docs))} disabled={saving}
          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-60">
          {saving ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <button onClick={onCancel} disabled={saving}
          className="rounded-lg border px-2.5 py-1 text-xs hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/5">
          ยกเลิก
        </button>
      </div>
    </div>
  )
}
