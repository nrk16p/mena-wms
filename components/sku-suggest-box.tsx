"use client"

// SkuSuggestBox — ปุ่ม "ให้ AI ช่วยแนะนำ" ในหน้า /sku/new
// ส่งชื่อสินค้า + กลุ่มของ ATMS ไปที่ /api/sku/suggest แล้วโชว์ตัวเลือก L1/L2/L3 กับชื่อมาตรฐาน
// **ไม่เติมลงฟอร์มเอง** — คนต้องกดเลือก (ผังสินค้าเป็นเรื่องที่คนจัดซื้อ/ช่างตัดสิน AI แค่ช่วยคัด)
import { useState } from "react"

type Option = { l1: string; l2: string; l3: string; label: string; why: string; confidence: number }
export type SuggestFields = { positions: string[]; vehicles: string[]; unit: string; grade: string }
type Result = {
  engine: "groq" | "lexical"
  options: Option[]
  nameTh: string
  nameEn: string
  fields?: SuggestFields
  gradeWhy?: string
  note: string
  cached?: boolean
  error?: string
}

export function SkuSuggestBox({
  name, group, type, brand, atmsUnit, l1Hint, labels, onPick, onUseName, onUseFields,
}: {
  name: string
  group: string
  type: string
  brand: string
  /** หน่วยที่อ่านได้จาก ATMS — ให้ AI ยืนยัน/แก้ ไม่ใช่เดาใหม่ */
  atmsUnit: string
  l1Hint: string[]
  /** รหัส → ชื่อไทย ของ ตำแหน่ง/รุ่นรถ/หน่วย/Grade เอาไว้แสดงให้คนอ่านรู้เรื่อง */
  labels: Record<string, string>
  onPick: (o: Option) => void
  onUseName: (th: string, en: string) => void
  onUseFields: (f: SuggestFields) => void
}) {
  const [res, setRes] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)

  async function run() {
    setLoading(true)
    setRes(null)
    try {
      const r = await fetch("/api/sku/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, group, type, brand, atmsUnit, l1Hint }),
      })
      setRes(await r.json().catch(() => ({ error: "อ่านคำตอบไม่ได้" })) as Result)
    } catch (e) {
      setRes({ engine: "lexical", options: [], nameTh: "", nameEn: "", note: "",
               error: `เรียกไม่สำเร็จ: ${e instanceof Error ? e.message : e}` })
    } finally {
      setLoading(false)
    }
  }

  const ready = name.trim().length >= 2 && !!type

  return (
    <div className="rounded-[14px] border border-violet-200 dark:border-violet-800/50 bg-violet-50/50 dark:bg-violet-950/20 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-violet-700 dark:text-violet-300">ตัวช่วยจัดหมวด + ตั้งชื่อ</p>
          <p className="text-[11px] text-violet-500/80 dark:text-violet-400/70">
            {ready ? "ดูจากชื่อสินค้าและกลุ่มใน ATMS แล้วเสนอ L1/L2/L3 กับชื่อมาตรฐาน" : "กรอกชื่ออะไหล่ (หรือเลือกรหัส ATMS) ก่อน"}
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={!ready || loading}
          className="shrink-0 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
        >
          {loading ? "กำลังคิด…" : "ให้ AI ช่วยแนะนำ"}
        </button>
      </div>

      {res?.error && <p className="mt-2 text-[12px] text-red-600 dark:text-red-400">{res.error}</p>}

      {res && !res.error && (
        <div className="mt-3 space-y-2">
          {res.note && <p className="text-[11px] text-amber-600 dark:text-amber-400">{res.note}</p>}

          {res.nameTh && (
            <div className="rounded-lg bg-white dark:bg-white/5 border border-violet-100 dark:border-white/10 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">ชื่อมาตรฐานที่เสนอ</p>
              <p className="text-[13px] text-gray-900 dark:text-white">{res.nameTh}</p>
              {res.nameEn && <p className="text-[11px] text-gray-500">{res.nameEn}</p>}
              {name.trim() && name.trim() !== res.nameTh && (
                <p className="text-[10px] text-gray-400 mt-0.5">ชื่อเดิม: {name.trim()}</p>
              )}
              <button
                type="button"
                onClick={() => onUseName(res.nameTh, res.nameEn)}
                className="mt-1.5 rounded-md bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 px-2 py-0.5 text-[11px] font-medium hover:bg-violet-200 dark:hover:bg-violet-900/70"
              >
                ใช้ชื่อนี้
              </button>
            </div>
          )}

          {res.fields && (res.fields.positions.length > 0 || res.fields.vehicles.length > 0 || res.fields.unit || res.fields.grade) && (
            <div className="rounded-lg bg-white dark:bg-white/5 border border-violet-100 dark:border-white/10 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">ช่องอื่นที่เสนอ</p>
              <div className="flex flex-wrap gap-1.5">
                {res.fields.positions.map((c) => (
                  <span key={`p${c}`} className="rounded bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 text-[11px] text-gray-700 dark:text-gray-300">ตำแหน่ง {labels[c] ?? c}</span>
                ))}
                {res.fields.vehicles.map((c) => (
                  <span key={`v${c}`} className="rounded bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 text-[11px] text-gray-700 dark:text-gray-300">รถ {labels[c] ?? c}</span>
                ))}
                {res.fields.unit && (
                  <span className="rounded bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 text-[11px] text-gray-700 dark:text-gray-300">หน่วย {labels[res.fields.unit] ?? res.fields.unit}</span>
                )}
                {res.fields.grade && (
                  <span className="rounded bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 text-[11px] text-gray-700 dark:text-gray-300">Grade {labels[res.fields.grade] ?? res.fields.grade}</span>
                )}
              </div>
              {res.gradeWhy && <p className="text-[11px] text-gray-500 mt-1">{res.gradeWhy}</p>}
              <button
                type="button"
                onClick={() => { const f = res.fields; if (f) onUseFields(f) }}
                className="mt-1.5 rounded-md bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 px-2 py-0.5 text-[11px] font-medium hover:bg-violet-200 dark:hover:bg-violet-900/70"
              >
                ใช้ช่องเหล่านี้
              </button>
              <p className="text-[10px] text-gray-400 mt-1">
                เบอร์อะไหล่ · เบอร์แท้ · เบอร์เทียบ · ราคา — ระบบไม่เดาให้ ดึงจากของจริงใน ATMS เท่านั้น
              </p>
            </div>
          )}

          {res.options.length === 0 && !res.note && (
            <p className="text-[12px] text-gray-500">ยังไม่มีหมวดที่เข้าเค้า — เลือกเองจากรายการด้านล่างได้เลย</p>
          )}

          {res.options.length > 0 && res.engine === "groq" && (
            <button
              type="button"
              onClick={() => {
                onPick(res.options[0])
                if (res.nameTh) onUseName(res.nameTh, res.nameEn)
                if (res.fields) onUseFields(res.fields)
              }}
              className="w-full rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
            >
              ใช้คำแนะนำทั้งหมด (หมวด + ชื่อ + ช่องอื่น)
            </button>
          )}

          {res.options.map((o, i) => (
            <button
              key={`${o.l1}:${o.l2}:${o.l3}`}
              type="button"
              onClick={() => onPick(o)}
              className="block w-full text-left rounded-lg bg-white dark:bg-white/5 border border-violet-100 dark:border-white/10 px-3 py-2 hover:border-violet-300 dark:hover:border-violet-700 transition-colors"
            >
              <div className="flex items-center gap-2">
                {i === 0 && <span className="rounded bg-violet-600 text-white px-1.5 py-0.5 text-[9px] font-semibold">แนะนำ</span>}
                <span className="font-mono text-[11px] text-violet-600 dark:text-violet-400">
                  {o.l1}:{o.l2}{o.l3 ? `:${o.l3}` : ""}
                </span>
                <span className="text-[10px] text-gray-400">มั่นใจ {Math.round(o.confidence * 100)}%</span>
              </div>
              <p className="text-[13px] text-gray-900 dark:text-white mt-0.5">{o.label}</p>
              {o.why && <p className="text-[11px] text-gray-500 mt-0.5">{o.why}</p>}
            </button>
          ))}

          <p className="text-[10px] text-gray-400">
            {res.engine === "groq" ? "แนะนำโดย AI" : "แนะนำจากการเทียบชื่อในเครื่อง"}
            {res.cached ? " · ใช้ผลที่เคยถามไว้" : ""} — ตรวจก่อนใช้ทุกครั้ง
          </p>
        </div>
      )}
    </div>
  )
}
