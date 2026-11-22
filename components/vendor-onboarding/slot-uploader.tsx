"use client"
// อัปโหลดหลายไฟล์ต่อหนึ่งรายการเอกสาร — presign แล้ว PUT ตรงไปที่เก็บ (ไม่ผ่าน server ของเรา)
// ไฟล์ที่อัปเสร็จส่งขึ้นไปให้แม่เก็บ (ลงร่าง localStorage ได้) · ไฟล์ที่กำลังอัปอยู่ถือไว้ในนี้
import { useEffect, useId, useRef, useState } from "react"
import { AlertCircle, FileText, ImageIcon, Loader2, Paperclip, X } from "lucide-react"
import { downscaleImage, errMsg, fmtBytes, uploadFile, type UploadedFile } from "@/lib/vendor-onboarding/client"

type Pending = { id: string; name: string; size: number; pct: number; error?: string }

export type UploadLimits = { maxFiles: number; maxBytes: number; types: string[] }

const TYPE_LABEL = "PDF, JPG, PNG, WEBP"

export function SlotUploader({
  slot, label, files, onChange, onBusy, presignUrl, presignExtra, limits,
}: {
  slot: string
  label: string
  files: UploadedFile[]
  onChange: (files: UploadedFile[]) => void
  /** true ระหว่างมีไฟล์กำลังอัป — ให้แม่ล็อกปุ่มถัดไป */
  onBusy?: (slot: string, busy: boolean) => void
  presignUrl: string
  presignExtra: Record<string, unknown>
  limits: UploadLimits
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [note, setNote] = useState("")
  // ref ของไฟล์ล่าสุด — อัปหลายไฟล์พร้อมกัน แต่ละตัวต้องต่อท้ายของล่าสุด ไม่ใช่ของตอนเริ่ม
  const filesRef = useRef(files)
  useEffect(() => { filesRef.current = files }, [files])
  const busy = pending.some((p) => !p.error)
  useEffect(() => { onBusy?.(slot, busy) }, [busy, slot, onBusy])

  const room = limits.maxFiles - files.length - pending.filter((p) => !p.error).length

  async function pick(list: FileList | null) {
    setNote("")
    if (!list?.length) return
    const chosen = Array.from(list)
    const skipped: string[] = []
    const ok = chosen.filter((f) => {
      if (!limits.types.includes(f.type)) { skipped.push(`${f.name} (รับเฉพาะ ${TYPE_LABEL})`); return false }
      return true
    }).slice(0, Math.max(0, room))
    if (chosen.length - skipped.length > ok.length) skipped.push(`เกิน ${limits.maxFiles} ไฟล์ต่อรายการ`)
    if (skipped.length) setNote(`ข้ามไป: ${skipped.join(" · ")}`)

    await Promise.all(ok.map(async (raw) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      setPending((p) => [...p, { id, name: raw.name, size: raw.size, pct: 0 }])
      try {
        const f = await downscaleImage(raw)
        if (f.size > limits.maxBytes) throw new Error(`ไฟล์ใหญ่เกิน ${fmtBytes(limits.maxBytes)} ย่อหรือสแกนใหม่แล้วแนบอีกครั้ง`)
        const up = await uploadFile(presignUrl, presignExtra, slot, f, (pct) =>
          setPending((p) => p.map((x) => (x.id === id ? { ...x, pct } : x))))
        const next = [...filesRef.current, up]
        filesRef.current = next
        onChange(next)
        setPending((p) => p.filter((x) => x.id !== id))
      } catch (e) {
        setPending((p) => p.map((x) => (x.id === id ? { ...x, error: errMsg(e) } : x)))
      }
    }))
  }

  // ลบจาก filesRef (ที่เดียวกับที่อัปต่อท้าย) — กันไฟล์ที่ลบไปแล้วกลับมาตอนอีกไฟล์อัปเสร็จ
  const remove = (key: string) => {
    const next = filesRef.current.filter((f) => f.key !== key)
    filesRef.current = next
    onChange(next)
  }

  return (
    <div>
      {(files.length > 0 || pending.length > 0) && (
        <ul className="vo-files" aria-label={`ไฟล์ของ ${label}`}>
          {files.map((f) => (
            <li key={f.key} className="vo-file">
              {f.contentType === "application/pdf" ? <FileText size={16} aria-hidden /> : <ImageIcon size={16} aria-hidden />}
              <span className="vo-file-name" title={f.name}>{f.name}</span>
              <span className="vo-file-size">{fmtBytes(f.size)}</span>
              <button type="button" className="vo-icon-btn" onClick={() => remove(f.key)} aria-label={`เอาไฟล์ ${f.name} ออก`}><X size={16} /></button>
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.id} className={`vo-file${p.error ? " err" : ""}`}>
              {p.error ? <AlertCircle size={16} aria-hidden /> : <Loader2 size={16} className="animate-spin" aria-hidden />}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="vo-file-name" style={{ display: "block" }} title={p.name}>{p.name}</span>
                {p.error
                  ? <span style={{ fontSize: 12 }}>{p.error}</span>
                  : <span className="vo-prog" aria-label={`กำลังอัป ${p.pct}%`}><span style={{ width: `${p.pct}%` }} /></span>}
              </span>
              {p.error && (
                <button type="button" className="vo-icon-btn" onClick={() => setPending((x) => x.filter((y) => y.id !== p.id))} aria-label="ปิดข้อความ"><X size={16} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {note && <div className="vo-err" role="status">{note}</div>}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={limits.types.join(",")}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        tabIndex={-1}
        aria-hidden
        onChange={(e) => { void pick(e.target.files); e.target.value = "" }}
      />
      <button type="button" className="vo-add" disabled={room <= 0} onClick={() => inputRef.current?.click()} aria-label={`แนบไฟล์ ${label}`}>
        <Paperclip size={16} aria-hidden />
        {room <= 0 ? `ครบ ${limits.maxFiles} ไฟล์แล้ว` : files.length ? "แนบเพิ่ม" : "แนบไฟล์"}
      </button>
    </div>
  )
}
