"use client"

import { useEffect, useRef, useState } from "react"
import { ImagePlus, Eye, Trash2, Loader2, AlertCircle, X } from "lucide-react"
import { webpUrl, thumbnailUrl, MEDIA_MAX_BYTES, type SkuImage } from "@/lib/media"

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

export function ImageUpload({
  onChange,
  disabled,
  max = 12,
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

  async function uploadOne(file: File, localId: string) {
    const fail = (msg: string) =>
      setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "error", error: msg } : it)))

    try {
      // 1. presign (reuse one batch for the whole set)
      const presignRes = await fetch("/api/media/presign", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename:     file.name,
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
                webpUrl:      webpUrl(batch_id, media_id, file.name),
                thumbnailUrl: thumbnailUrl(batch_id, media_id, file.name),
              }
            : it
        )
      )
    } catch {
      fail("เกิดข้อผิดพลาดระหว่างอัปโหลด")
    }
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList || disabled) return
    const remaining = max - items.length
    const picked = Array.from(fileList)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, Math.max(0, remaining))

    const fresh: UploadItem[] = picked.map((f) => ({
      localId:    uid(),
      filename:   f.name,
      previewUrl: URL.createObjectURL(f),
      status:     f.size > MEDIA_MAX_BYTES ? "error" : "uploading",
      error:      f.size > MEDIA_MAX_BYTES ? "ไฟล์ใหญ่เกิน 25MB" : undefined,
    }))

    setItems((prev) => [...prev, ...fresh])
    picked.forEach((f, i) => {
      if (fresh[i].status === "uploading") uploadOne(f, fresh[i].localId)
    })
  }

  function removeItem(item: UploadItem) {
    setItems((prev) => prev.filter((i) => i.localId !== item.localId))
    URL.revokeObjectURL(item.previewUrl)
    if (item.mediaId != null) {
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
          แนบได้หลายรูป · JPG / PNG / WebP · ไม่เกิน 25MB ต่อรูป
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.previewUrl}
                alt={item.filename}
                className={`h-full w-full object-cover transition-opacity ${item.status === "uploading" ? "opacity-40" : ""}`}
              />

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
                    onClick={() => setLightbox(item.webpUrl || item.previewUrl)}
                    title="ดูรูป"
                    className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow hover:bg-white"
                  >
                    <Eye size={15} />
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
