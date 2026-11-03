"use client"

// แนบรูป/ไฟล์หลักฐาน: อัปโหลดตรงเข้าที่เก็บผ่านลิงก์ที่ระบบออกให้ (presign → PUT → confirm) · ใช้ในหน้าต่างขอคืน/ปฏิเสธ/สรุป และปุ่มแนบหลักฐานบนการ์ด
import { useEffect, useRef, useState } from "react"
import { FileText, Loader2, Paperclip, X } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export type AttachContext = "return" | "reject" | "summary" | "receipt" | "other"
export const MAX_FILES = 8
const MAX_BYTES = 10 * 1024 * 1024
const OK_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]
const BY_EXT: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heic", pdf: "application/pdf" }

export type Picked = { key: string; id: string | null; name: string; type: string; preview: string | null; state: "uploading" | "done" | "error"; error?: string }

const typeOf = (f: File) => (OK_TYPES.includes(f.type) ? f.type : BY_EXT[f.name.split(".").pop()?.toLowerCase() ?? ""] ?? "")

async function sha256Hex(f: File): Promise<string | undefined> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", await f.arrayBuffer())
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
  } catch { return undefined }
}

async function postJson(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || "อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง")
  return j
}

/** ไฟล์ที่อัปโหลดเสร็จแล้ว (id ที่ใช้ส่งเป็น attachmentIds) */
export const doneIds = (items: Picked[]) => items.filter((x) => x.state === "done" && x.id).map((x) => x.id as string)

export function AttachPicker({ no, context, items, onChange, required = false, hint, max = MAX_FILES, label = "แนบรูป/ไฟล์" }: {
  no: string; context: AttachContext; items: Picked[]; onChange: (f: (cur: Picked[]) => Picked[]) => void; required?: boolean; hint?: string
  /** จำนวนไฟล์สูงสุดในช่องนี้ (ค่าเริ่มต้น 8) */ max?: number
  label?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const urls = useRef<string[]>([])
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)) }, [])

  const patch = (key: string, p: Partial<Picked>) => onChange((cur) => cur.map((x) => (x.key === key ? { ...x, ...p } : x)))

  const upload = async (f: File, key: string, type: string) => {
    try {
      const sha256 = await sha256Hex(f)
      const base = `/api/store-withdraw/${encodeURIComponent(no)}/attachments`
      const p = await postJson(`${base}/presign`, { context, filename: f.name, contentType: type, size: f.size, sha256 })
      const put = await fetch(p.uploadUrl, { method: "PUT", headers: { "Content-Type": type }, body: f })
      if (!put.ok) throw new Error("ส่งไฟล์ขึ้นที่เก็บไม่สำเร็จ ลองใหม่อีกครั้ง")
      await postJson(`${base}/confirm`, { id: p.id })
      patch(key, { id: p.id, state: "done" })
    } catch (e) {
      patch(key, { state: "error", error: e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ" })
    }
  }

  const pick = (files: FileList | null) => {
    if (!files) return
    const room = max - items.length
    const add: Picked[] = []
    const jobs: [File, string, string][] = []
    ;[...files].slice(0, Math.max(0, room)).forEach((f, n) => {
      const key = `${Date.now()}-${n}-${f.name}`
      const type = typeOf(f)
      let error: string | undefined
      if (!type) error = "แนบได้เฉพาะรูป (jpg png webp heic) หรือ PDF"
      else if (f.size > MAX_BYTES) error = "ไฟล์ใหญ่เกิน 10 MB"
      else if (f.size === 0) error = "ไฟล์ว่าง"
      let preview: string | null = null
      if (!error && type.startsWith("image/") && type !== "image/heic") { preview = URL.createObjectURL(f); urls.current.push(preview) }
      add.push({ key, id: null, name: f.name, type, preview, state: error ? "error" : "uploading", error })
      if (!error) jobs.push([f, key, type])
    })
    if (add.length === 0) return
    onChange((cur) => [...cur, ...add])
    jobs.forEach(([f, key, type]) => { void upload(f, key, type) })
    if (input.current) input.current.value = ""
  }

  const doneCount = items.filter((x) => x.state === "done").length
  return (
    <div data-testid="attach-picker" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => input.current?.click()} disabled={items.length >= max}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#E2E8E4] px-3.5 py-2 text-sm text-gray-700 hover:text-[#1B8C4B] disabled:opacity-50 dark:border-white/10 dark:text-gray-200">
          <Paperclip size={14} />{label}{required && <span className="text-red-600"> *ต้องแนบ</span>}
        </button>
        <span className="text-xs text-gray-500">{hint ?? `รูปหรือ PDF ไม่เกิน 10 MB ไฟล์ละ แนบได้สูงสุด ${max} ไฟล์`}</span>
        <input ref={input} type="file" multiple hidden data-testid="attach-input" accept="image/jpeg,image/png,image/webp,image/heic,.heic,.heif,application/pdf" onChange={(e) => pick(e.target.files)} />
      </div>
      {required && doneCount === 0 && <p className="text-xs text-amber-700">ส่งเคลมต้องมีรูปหรือไฟล์หลักฐาน เช่น รูปของที่ชำรุดหรือป้ายรุ่น</p>}
      {items.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map((x) => (
            <li key={x.key} data-state={x.state} className={`relative flex items-center gap-2 rounded-xl border p-1.5 text-xs ${x.state === "error" ? "border-red-300 bg-red-50 dark:bg-red-500/10" : "border-[#E2E8E4] dark:border-white/10"}`}>
              {x.preview
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={x.preview} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-white/10"><FileText size={20} /></span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-gray-800 dark:text-gray-100">{x.name}</span>
                <span className={`block ${x.state === "error" ? "text-red-700" : "text-gray-500"}`}>
                  {x.state === "uploading" ? <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" />กำลังอัปโหลด</span> : x.state === "done" ? "แนบแล้ว" : x.error}
                </span>
              </span>
              {x.state !== "uploading" && (
                <button type="button" aria-label={`เอา ${x.name} ออกจากรายการ`} onClick={() => onChange((cur) => cur.filter((y) => y.key !== x.key))} className="absolute right-1 top-1 rounded-full bg-white/90 p-0.5 text-gray-500 hover:text-red-600 dark:bg-black/40"><X size={12} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const isUploading = (items: Picked[]) => items.some((x) => x.state === "uploading")

// ---------- รายการไฟล์แนบบนการ์ด (โหลดตอนกดดู) ----------

type Att = { id: string; context: string; filename: string; contentType: string; size: number; by: { name: string; email: string }; confirmedAt: string; url: string }
const CTX_LABEL: Record<string, string> = { return: "ขอคืน", reject: "ปฏิเสธ", summary: "สรุปการใช้", receipt: "รับของ", other: "หลักฐานอื่น" }

export function AttachChip({ no, count }: { no: string; count: number }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Att[] | null>(null)
  const [err, setErr] = useState("")
  if (count <= 0) return null
  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || items) return
    try {
      const r = await fetch(`/api/store-withdraw/${encodeURIComponent(no)}/attachments`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "โหลดไฟล์แนบไม่สำเร็จ")
      setItems(j.items as Att[])
    } catch (e) { setErr(e instanceof Error ? e.message : "โหลดไฟล์แนบไม่สำเร็จ") }
  }
  return (
    <div className="mt-2">
      <button type="button" data-testid="attach-chip" onClick={toggle} aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">
        <Paperclip size={12} />แนบ {count} ไฟล์
      </button>
      {open && (
        <ul data-testid="attach-list" className="mt-1.5 space-y-1 rounded-xl bg-[#F6F8F7] p-2 text-xs dark:bg-white/[0.04]">
          {err && <li className="text-red-600">{err}</li>}
          {!items && !err && <li className="text-gray-500">กำลังโหลด</li>}
          {items?.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline gap-x-2">
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-[#1B8C4B] underline">{a.filename}</a>
              <span className="text-gray-500">{CTX_LABEL[a.context] ?? a.context} · {a.by.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- ปุ่มแนบหลักฐานทั่วไป (ผู้ขอ/สโตร์ · context other หรือ receipt) ----------

export function AttachButton({ no, context = "other", onDone }: { no: string; context?: "other" | "receipt"; onDone?: () => void }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Picked[]>([])
  return (
    <>
      <button type="button" data-testid="attach-btn" onClick={() => setOpen(true)}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#E2E8E4] px-3.5 py-2 text-sm text-gray-700 hover:text-[#1B8C4B] dark:border-white/10 dark:text-gray-200">
        <Paperclip size={14} />แนบหลักฐาน
      </button>
      {open && (
        <Dialog open onOpenChange={(o) => { if (!o && !isUploading(items)) { setOpen(false); if (doneIds(items).length) onDone?.(); setItems([]) } }}>
          <DialogContent className="max-h-[90vh] overflow-auto">
            <DialogHeader><DialogTitle>แนบหลักฐาน {no}</DialogTitle></DialogHeader>
            <p className="text-xs text-gray-500">ไฟล์ที่แนบแล้วเก็บเป็นหลักฐานของใบนี้ ลบหรือแก้ภายหลังไม่ได้ เลือกให้ตรงก่อนส่ง</p>
            <AttachPicker no={no} context={context} items={items} onChange={(f) => setItems(f)} />
            <div className="flex justify-end">
              <button type="button" disabled={isUploading(items)} onClick={() => { setOpen(false); if (doneIds(items).length) onDone?.(); setItems([]) }} className="rounded-xl bg-[#1B8C4B] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">เสร็จแล้ว</button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

// ---------- รูปหลักฐานของแถวสรุปการใช้ (โหลดลิงก์ตอนกดดู · แชร์ผลโหลดต่อใบ 4 นาที เพราะลิงก์หมดอายุใน 5 นาที) ----------

const filesCache = new Map<string, { at: number; p: Promise<Att[]> }>()
function loadFiles(no: string): Promise<Att[]> {
  const hit = filesCache.get(no)
  if (hit && Date.now() - hit.at < 4 * 60_000) return hit.p
  const p = fetch(`/api/store-withdraw/${encodeURIComponent(no)}/attachments`).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || "โหลดไฟล์แนบไม่สำเร็จ")
    return j.items as Att[]
  })
  filesCache.set(no, { at: Date.now(), p })
  p.catch(() => filesCache.delete(no))
  return p
}

export function UsageFiles({ no, ids }: { no: string; ids?: string[] }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Att[] | null>(null)
  const [err, setErr] = useState("")
  if (!ids || ids.length === 0) return null
  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next) return
    setErr("")
    try { setItems(await loadFiles(no)) } catch (e) { setErr(e instanceof Error ? e.message : "โหลดไฟล์แนบไม่สำเร็จ") }
  }
  const mine = items?.filter((a) => ids.includes(a.id)) ?? []
  return (
    <span className="block">
      <button type="button" data-testid="usage-files" data-count={ids.length} onClick={toggle} aria-expanded={open}
        className="mt-0.5 inline-flex min-h-11 items-center gap-1 rounded-full bg-sky-50 px-3 py-0.5 sm:min-h-8 sm:px-2 text-[11px] font-medium text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">
        <Paperclip size={11} />รูป {ids.length}
      </button>
      {open && (
        <span className="mt-1 block space-y-0.5">
          {err && <span className="block text-red-600">{err}</span>}
          {!items && !err && <span className="block text-gray-500">กำลังโหลด</span>}
          {items && mine.length === 0 && <span className="block text-gray-500">ไม่เจอไฟล์</span>}
          {mine.map((a) => (
            <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="block break-all font-medium text-[#1B8C4B] underline">{a.filename}</a>
          ))}
        </span>
      )}
    </span>
  )
}
