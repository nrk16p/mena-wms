"use client"

import { useEffect, useRef, useState } from "react"
import { ImagePlus, Eye, Trash2, Loader2, AlertCircle, X, Download, FileText } from "lucide-react"
import { webpUrl, thumbnailUrl, sanitizeMediaFilename, MEDIA_MAX_BYTES, MEDIA_UI_MAX_BYTES, type SkuImage } from "@/lib/media"
import { swalDeleteConfirm, swalToast } from "@/lib/swal"

type UploadItem = {
  localId:       string
  filename:      string
  previewUrl:    string                 // local blob URL for instant preview
  status:        "uploading" | "done" | "error"
  mediaId?:      number
  batchId?:      string
  webpUrl?:      string
  thumbnailUrl?: string
  error?:        string
}

function uid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

// PDF ใช้เส้นทางอัปโหลดของเราเอง (Spaces ตรง) — batchId sentinel "doc"
const isPdfFile = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)
const isPdfName = (name: string) => /\.pdf$/i.test(name)

export function ImageUpload({
  onChange,
  disabled,
  max = 30,
  initial,
}: {
  onChange: (images: SkuImage[]) => void
  disabled?: boolean
  max?: number
  initial?: SkuImage[]   // already-saved images (edit mode)
}) {
  const [items, setItems]       = useState<UploadItem[]>(() =>
    (initial ?? []).map((img) => ({
      localId:      uid(),
      filename:     img.filename,
      previewUrl:   img.thumbnailUrl || img.webpUrl,  // remote preview for existing media
      status:       "done" as const,
      mediaId:      img.mediaId,
      batchId:      img.batchId,
      webpUrl:      img.webpUrl,
      thumbnailUrl: img.thumbnailUrl,
    }))
  )
  const [dragOver, setDragOver] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const batchRef = useRef<string | undefined>(undefined)

  // notify parent of the committed (done) images whenever the set changes
  useEffect(() => {
    onChange(
      items
        .filter((i) => i.status === "done" && i.mediaId != null && i.batchId)
        .map((i) => ({
          mediaId:      i.mediaId!,
          batchId:      i.batchId!,
          filename:     i.filename,
          webpUrl:      i.webpUrl!,
          thumbnailUrl: i.thumbnailUrl!,
        }))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  // revoke blob URLs on unmount
  useEffect(() => () => { items.forEach((i) => URL.revokeObjectURL(i.previewUrl)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function uploadOne(file: File, localId: string, safeName: string) {
    const fail = (msg: string) =>
      setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "error", error: msg } : it)))

    try {
      // ── PDF: อัปโหลดตรงเข้า Spaces (presign-api ภายนอกรับเฉพาะรูป) ──
      if (isPdfFile(file)) {
        const pres = await fetch("/api/media/doc-presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: safeName, file_size: file.size }),
        })
        if (!pres.ok) { const e = await pres.json().catch(() => ({})); return fail(e.error || "ขอ upload url ไม่สำเร็จ") }
        const { upload_url, public_url } = await pres.json()
        const put = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": "application/pdf", "x-amz-acl": "public-read" }, body: file })
        if (put.status !== 200 && put.status !== 204) return fail("อัปโหลดไฟล์ไม่สำเร็จ")
        setItems((prev) => prev.map((it) => it.localId === localId
          ? { ...it, status: "done", mediaId: 0, batchId: "doc", webpUrl: public_url, thumbnailUrl: "" }
          : it))
        return
      }
      // 1. presign (reuse one batch for the whole set) — ใช้ชื่อไฟล์ที่ sanitize แล้วเป็น key
      const presignRes = await fetch("/api/media/presign", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename:     safeName,
          content_type: file.type,
          file_size:    file.size,
          source_type:  "sku",
          ...(batchRef.current ? { batch_id: batchRef.current } : {}),
        }),
      })
      if (!presignRes.ok) return fail("ขอ upload url ไม่สำเร็จ")
      const { media_id, batch_id, upload_url } = await presignRes.json()
      if (!media_id || !upload_url) return fail("presign ตอบไม่ครบ")
      if (!batchRef.current) batchRef.current = batch_id

      // 2. PUT directly to S3
      const putRes = await fetch(upload_url, {
        method:  "PUT",
        headers: { "Content-Type": file.type },
        body:    file,
      })
      if (putRes.status !== 200 && putRes.status !== 204) return fail("อัปโหลดไป S3 ไม่สำเร็จ")

      // 3. complete → worker builds webp + thumbnail
      const compRes = await fetch(`/api/media/${media_id}/complete`, { method: "POST" })
      if (!compRes.ok) return fail("ยืนยันอัปโหลดไม่สำเร็จ")

      setItems((prev) =>
        prev.map((it) =>
          it.localId === localId
            ? {
                ...it,
                status:       "done",
                mediaId:      media_id,
                batchId:      batch_id,
                webpUrl:      webpUrl(batch_id, media_id, safeName),
                thumbnailUrl: thumbnailUrl(batch_id, media_id, safeName),
              }
            : it
        )
      )
    } catch {
      fail("เกิดข้อผิดพลาดระหว่างอัปโหลด")
    }
  }

  // ย่อรูปในเบราว์เซอร์ให้ต่ำกว่าเพดานของ presign-api (25MB) — ลดขนาด/คุณภาพเป็นขั้น ๆ
  async function shrinkImage(file: File): Promise<File | null> {
    try {
      const bmp = await createImageBitmap(file)
      let scale = Math.min(1, 4096 / Math.max(bmp.width, bmp.height))  // จำกัดด้านยาวสุด 4096px ก่อน
      for (let i = 0; i < 6; i++) {
        const w = Math.max(1, Math.round(bmp.width * scale))
        const h = Math.max(1, Math.round(bmp.height * scale))
        const canvas = document.createElement("canvas")
        canvas.width = w; canvas.height = h
        canvas.getContext("2d")?.drawImage(bmp, 0, 0, w, h)
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85))
        if (blob && blob.size <= MEDIA_MAX_BYTES) {
          return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" })
        }
        scale *= 0.75
      }
    } catch { /* decode ไม่ได้ (เช่นไฟล์เสีย) */ }
    return null
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList || disabled) return
    const all = Array.from(fileList)
    // รับรูปภาพ + PDF — อื่น ๆ บล็อกพร้อมแจ้ง
    const accepted = all.filter((f) => f.type.startsWith("image/") || isPdfFile(f))
    const blocked  = all.filter((f) => !f.type.startsWith("image/") && !isPdfFile(f))
    if (blocked.length) {
      swalToast("error", `อัปโหลดได้เฉพาะรูปภาพและ PDF — บล็อก ${blocked.length} ไฟล์: ${blocked.map((f) => f.name).slice(0, 3).join(", ")}${blocked.length > 3 ? " ..." : ""}`)
    }
    // PDF เกิน 25MB ย่อไม่ได้ — บล็อกพร้อมแจ้ง · รูปเกิน 50MB ไม่รับ
    const pdfTooBig = accepted.filter((f) => isPdfFile(f) && f.size > MEDIA_MAX_BYTES)
    if (pdfTooBig.length) {
      swalToast("error", `PDF ใหญ่เกิน 25MB — อัปโหลดไม่ได้: ${pdfTooBig.map((f) => f.name).slice(0, 3).join(", ")}`)
    }
    const tooBig = accepted.filter((f) => !isPdfFile(f) && f.size > MEDIA_UI_MAX_BYTES)
    if (tooBig.length) {
      swalToast("error", `ไฟล์ใหญ่เกิน 50MB — อัปโหลดไม่ได้ ${tooBig.length} ไฟล์: ${tooBig.map((f) => f.name).slice(0, 3).join(", ")}`)
    }
    // รูป 25–50MB → รับไว้แล้วย่ออัตโนมัติ (แจ้งให้รู้)
    const needShrink = accepted.filter((f) => !isPdfFile(f) && f.size <= MEDIA_UI_MAX_BYTES && f.size > MEDIA_MAX_BYTES)
    if (needShrink.length) {
      swalToast("info", `รูปใหญ่เกิน 25MB จำนวน ${needShrink.length} ไฟล์ — ระบบกำลังย่อให้อัตโนมัติ`)
    }

    const remaining = max - items.length
    const picked = accepted
      .filter((f) => (isPdfFile(f) ? f.size <= MEDIA_MAX_BYTES : f.size <= MEDIA_UI_MAX_BYTES))
      .slice(0, Math.max(0, remaining))

    // sanitize ชื่อไฟล์ก่อนอัปโหลด — อักขระอย่าง # ทำ URL รูปพัง (กลายเป็น fragment)
    const safeNames = picked.map((f) =>
      !isPdfFile(f) && f.size > MEDIA_MAX_BYTES
        ? sanitizeMediaFilename(f.name.replace(/\.[^.]+$/, "") + ".jpg")  // ย่อแล้วกลายเป็น jpeg
        : sanitizeMediaFilename(f.name)
    )
    const fresh: UploadItem[] = picked.map((f, i) => ({
      localId:    uid(),
      filename:   safeNames[i],
      previewUrl: URL.createObjectURL(f),
      status:     "uploading",
    }))

    setItems((prev) => [...prev, ...fresh])
    picked.forEach(async (f, i) => {
      let toSend: File | null = f
      if (!isPdfFile(f) && f.size > MEDIA_MAX_BYTES) {
        toSend = await shrinkImage(f)
        if (!toSend) {
          setItems((prev) => prev.map((it) => (it.localId === fresh[i].localId ? { ...it, status: "error", error: "ย่อรูปไม่สำเร็จ — ไฟล์ใหญ่เกิน 25MB" } : it)))
          return
        }
      }
      uploadOne(toSend, fresh[i].localId, safeNames[i])
    })
  }

  // ดาวน์โหลดไฟล์ — CDN คนละ origin ใช้ <a download> ตรง ๆ ไม่ได้ ต้อง fetch เป็น blob ก่อน
  async function downloadItem(item: UploadItem) {
    const url = item.webpUrl || item.previewUrl
    if (!url) return
    try {
      const res  = await fetch(url)
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const a    = document.createElement("a")
      a.href     = URL.createObjectURL(blob)
      // PDF เก็บไฟล์ต้นฉบับ — ชื่อเดิม · รูปถูกแปลงเป็น webp
      a.download = item.batchId === "doc" ? item.filename : item.filename.replace(/\.[^.]+$/, "") + ".webp"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(a.href)
    } catch {
      // CORS/network มีปัญหา → เปิดแท็บใหม่ให้ผู้ใช้เซฟเอง
      window.open(url, "_blank")
    }
  }

  async function removeItem(item: UploadItem) {
    // ไฟล์ที่อัปโหลดสำเร็จแล้ว → ถามยืนยันก่อนลบ (tile ที่ error/กำลังอัปโหลด ลบได้เลย)
    if (item.status === "done") {
      const ok = await swalDeleteConfirm(`ลบไฟล์ ${item.filename}?`)
      if (!ok.isConfirmed) return
    }
    setItems((prev) => prev.filter((i) => i.localId !== item.localId))
    URL.revokeObjectURL(item.previewUrl)
    if (item.batchId === "doc" && item.webpUrl) {
      // เอกสาร PDF — ลบผ่านเส้นทางของเรา (key = path หลังโดเมน)
      const key = decodeURIComponent(new URL(item.webpUrl).pathname.replace(/^\//, ""))
      fetch(`/api/media/doc?key=${encodeURIComponent(key)}`, { method: "DELETE" }).catch(() => {})
    } else if (item.mediaId != null && item.mediaId !== 0) {
      fetch(`/api/media/${item.mediaId}`, { method: "DELETE" }).catch(() => {})
    }
  }

  const atLimit = items.length >= max

  return (
    <div>
      {/* Dropzone */}
      <button
        type="button"
        disabled={disabled || atLimit}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
        className={[
          "flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
          dragOver
            ? "border-[#1B8C4B] bg-[#f0fdf4] dark:bg-[#1B8C4B]/10"
            : "border-gray-300 dark:border-white/15 hover:border-[#1B8C4B] hover:bg-[#f0fdf4] dark:hover:bg-white/5",
          (disabled || atLimit) ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        ].join(" ")}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f0fdf4] text-[#1B8C4B] dark:bg-[#1B8C4B]/15">
          <ImagePlus size={18} />
        </span>
        <span className="text-[13px] font-semibold text-gray-700 dark:text-gray-200">
          {atLimit ? `ครบ ${max} รูปแล้ว` : "ลากรูปมาวาง หรือคลิกเพื่อเลือก"}
        </span>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          แนบได้หลายไฟล์ · JPG / PNG / WebP / PDF · รูปไม่เกิน 50MB (เกิน 25MB ย่อให้อัตโนมัติ) · PDF ไม่เกิน 25MB
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => { addFiles(e.target.files); e.target.value = "" }}
      />

      {/* Preview grid */}
      {items.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-4">
          {items.map((item) => (
            <div
              key={item.localId}
              className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5"
            >
              {isPdfName(item.filename) ? (
                <div className={`flex h-full w-full flex-col items-center justify-center gap-1 bg-[#FEF3F2] dark:bg-red-950/20 px-1.5 text-center ${item.status === "uploading" ? "opacity-40" : ""}`}>
                  <FileText size={24} className="text-[#DC2626]" />
                  <span className="line-clamp-2 break-all text-[9px] font-medium leading-tight text-[#7A2E2E] dark:text-red-300">{item.filename}</span>
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.previewUrl}
                  alt={item.filename}
                  className={`h-full w-full object-cover transition-opacity ${item.status === "uploading" ? "opacity-40" : ""}`}
                />
              )}

              {/* uploading overlay */}
              {item.status === "uploading" && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 size={20} className="animate-spin text-[#1B8C4B]" />
                </div>
              )}

              {/* error overlay */}
              {item.status === "error" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-50/90 px-1 text-center dark:bg-red-950/70">
                  <AlertCircle size={18} className="text-red-500" />
                  <span className="text-[9px] font-medium leading-tight text-red-600 dark:text-red-400">{item.error}</span>
                </div>
              )}

              {/* hover actions */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
                {item.status !== "error" && (
                  <button
                    type="button"
                    onClick={() => isPdfName(item.filename)
                      ? window.open(item.webpUrl || item.previewUrl, "_blank")
                      : setLightbox(item.webpUrl || item.previewUrl)}
                    title={isPdfName(item.filename) ? "เปิดไฟล์" : "ดูรูป"}
                    className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow hover:bg-white"
                  >
                    <Eye size={15} />
                  </button>
                )}
                {item.status === "done" && (
                  <button
                    type="button"
                    onClick={() => downloadItem(item)}
                    title="ดาวน์โหลด"
                    className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow hover:bg-[#1B8C4B] hover:text-white"
                  >
                    <Download size={15} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeItem(item)}
                  title="ลบรูป"
                  className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-red-500 shadow hover:bg-red-500 hover:text-white"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              {/* done badge */}
              {item.status === "done" && (
                <span className="absolute left-1.5 top-1.5 rounded-full bg-[#1B8C4B] px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
                  ✓
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X size={18} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt=""
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  )
}
