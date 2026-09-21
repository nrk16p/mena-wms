"use client"
// กรอกผ่าน Excel (ผู้ใช้ขอ 2026-09-21): โหลดเทมเพลต → กรอกออฟไลน์ → อัปโหลด → ดูสรุป → ยืนยันบันทึก
// ใช้ทั้งฝั่งอู่ (/q) และฝั่งจัดซื้อที่อัปโหลดแทนอู่ (/rfq/[id]) — ต่างกันแค่ปลายทาง importHref
import { useRef, useState } from "react"
import { Download, FileSpreadsheet, Upload } from "lucide-react"
import { BRAND } from "@/lib/vendor-brand"

type Counts = { rates: number; items: number; parts: number; skipped: number }
type Preview = { counts: Counts; problems: string[] }

const btn = { fontFamily: BRAND.font, fontSize: 14.5, fontWeight: 500, padding: "10px 16px", borderRadius: 6, border: `1px solid ${BRAND.field}`, background: BRAND.white, color: BRAND.ink, cursor: "pointer", minHeight: 44, display: "inline-flex", alignItems: "center", gap: 8 } as const

export function RfqExcelBox({ templateHref, importHref, disabled, onSaved, title = "กรอกผ่าน Excel", hint }: {
  templateHref: string
  importHref: string
  disabled?: boolean
  onSaved: () => void
  title?: string
  hint?: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const chosen = useRef<File | null>(null)
  const [busy, setBusy] = useState<"" | "check" | "save">("")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [done, setDone] = useState("")
  const [err, setErr] = useState("")

  async function send(file: File, confirm: boolean) {
    const fd = new FormData()
    fd.append("file", file)
    if (confirm) fd.append("confirm", "1")
    const r = await fetch(importHref, { method: "POST", body: fd })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d?.error ?? "อัปโหลดไม่สำเร็จ")
    return d as { preview?: true; counts?: Counts; problems?: string[]; ok?: true; saved?: Counts }
  }
  async function pick(file: File) {
    chosen.current = file; setErr(""); setDone(""); setPreview(null); setBusy("check")
    try {
      const d = await send(file, false)
      setPreview({ counts: d.counts as Counts, problems: d.problems ?? [] })
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy("") }
  }
  async function confirm() {
    if (!chosen.current) return
    setBusy("save"); setErr("")
    try {
      const d = await send(chosen.current, true)
      const s = d.saved as Counts
      setPreview(null); chosen.current = null
      if (fileRef.current) fileRef.current.value = ""
      setDone(`บันทึกแล้ว — อัตรา ${s.rates} ระบบ · ค่าแรง ${s.items} งาน · อะไหล่ ${s.parts} รายการ`)
      onSaved()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy("") }
  }

  return (
    <div style={{ fontFamily: BRAND.font, color: BRAND.ink }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <FileSpreadsheet size={20} style={{ color: BRAND.green, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 500 }}>{title}</div>
          <div style={{ fontSize: 13, color: BRAND.muted }}>{hint ?? "โหลดเทมเพลตไปกรอกในคอมพิวเตอร์ แล้วอัปโหลดกลับ · ช่องที่เว้นว่างในไฟล์จะไม่ถูกแก้"}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <a href={templateHref} style={{ ...btn, textDecoration: "none" }}><Download size={16} /> ดาวน์โหลดเทมเพลต</a>
        {!disabled && (
          <button type="button" style={{ ...btn, borderColor: BRAND.green, color: BRAND.green, opacity: busy ? .6 : 1 }} disabled={!!busy} onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> {busy === "check" ? "กำลังตรวจไฟล์…" : "อัปโหลดไฟล์ที่กรอกแล้ว"}
          </button>
        )}
        <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f) }} />
      </div>
      {preview && (
        <div style={{ marginTop: 12, border: `1px solid ${BRAND.line}`, borderRadius: 8, padding: 14, background: BRAND.bg }}>
          <div style={{ fontWeight: 500 }}>ตรวจก่อนบันทึก</div>
          <div style={{ fontSize: 14, marginTop: 6, lineHeight: 1.8 }}>
            อัตราค่าแรง <b>{preview.counts.rates}</b> ระบบ · ค่าแรง <b>{preview.counts.items}</b> งาน · อะไหล่ <b>{preview.counts.parts}</b> รายการ
            {preview.counts.skipped > 0 && <div style={{ color: BRAND.muted, fontSize: 13 }}>เว้นว่างในไฟล์ {preview.counts.skipped} แถว — ของเดิมในเว็บจะไม่ถูกแก้</div>}
          </div>
          {preview.problems.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 13, color: "#92400E", background: "#FFFBEB", border: "1px solid #F3D48A", borderRadius: 6, padding: "8px 10px" }}>
              <b>ข้าม {preview.problems.length} รายการ:</b>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {preview.problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}
                {preview.problems.length > 8 && <li>และอีก {preview.problems.length - 8} รายการ</li>}
              </ul>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" onClick={() => void confirm()} disabled={busy === "save"}
              style={{ ...btn, background: BRAND.green, color: BRAND.white, border: "none", borderRadius: 999, padding: "10px 22px", opacity: busy === "save" ? .6 : 1 }}>
              {busy === "save" ? "กำลังบันทึก…" : "ยืนยันบันทึกลงใบขอราคา"}
            </button>
            <button type="button" style={btn} onClick={() => { setPreview(null); chosen.current = null; if (fileRef.current) fileRef.current.value = "" }}>ยกเลิก</button>
          </div>
        </div>
      )}
      {done && <div style={{ marginTop: 10, fontSize: 13.5, color: "#047857" }}>{done}</div>}
      {err && <div style={{ marginTop: 10, fontSize: 13.5, color: "#B91C1C" }}>{err}</div>}
    </div>
  )
}
