"use client"

import { useState, useEffect, useCallback } from "react"
import { X, ChevronLeft, ChevronRight, Download, ExternalLink } from "lucide-react"

export type GalleryImage = { url: string; thumb?: string; filename?: string }

/*
 * Gallery ดูรูปเต็มจอ — ลูกศรซ้าย/ขวา (ปุ่ม + คีย์บอร์ด), ตัวนับ, ดาวน์โหลด,
 * เปิดแท็บใหม่, thumbnail strip ด้านล่าง · ปิดด้วย Esc / ปุ่ม X / คลิกพื้นหลัง
 * ไม่ใช้ <a> เลย (href ว่างทำหน้า reload เด้งขึ้นบนสุด) และล็อกสกรอลพื้นหลังตอนเปิด
 */
export function ImageGallery({ images, start = 0, onClose }: { images: GalleryImage[]; start?: number; onClose: () => void }) {
  const n = images.length
  const [i, setI] = useState(Math.min(Math.max(start, 0), Math.max(n - 1, 0)))
  const cur = images[i]
  const prev = useCallback(() => setI((x) => (x - 1 + n) % n), [n])
  const next = useCallback(() => setI((x) => (x + 1) % n), [n])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowLeft") prev()
      else if (e.key === "ArrowRight") next()
    }
    window.addEventListener("keydown", onKey)
    const old = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = old }
  }, [onClose, prev, next])

  // CDN คนละ origin — ดาวน์โหลดต้อง fetch เป็น blob ก่อน (แบบเดียวกับ image-upload)
  async function download() {
    if (!cur?.url) return
    try {
      const res  = await fetch(cur.url)
      const blob = await res.blob()
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = cur.filename || `image-${i + 1}`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch { window.open(cur.url, "_blank", "noopener") }
  }

  if (!cur) return null
  const iconBtn = "flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25"
  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-black/90 backdrop-blur-sm" onClick={onClose}>
      {/* แถบบน: ตัวนับ + ปุ่มเครื่องมือ */}
      <div className="flex items-center justify-between p-3" onClick={(e) => e.stopPropagation()}>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white">{i + 1} / {n}</span>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={download} title="ดาวน์โหลดรูปนี้" className={iconBtn}><Download size={16} /></button>
          <button type="button" onClick={() => window.open(cur.url, "_blank", "noopener")} title="เปิดในแท็บใหม่" className={iconBtn}><ExternalLink size={16} /></button>
          <button type="button" onClick={onClose} title="ปิด (Esc)" className={iconBtn}><X size={18} /></button>
        </div>
      </div>

      {/* รูป + ลูกศร */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
        {n > 1 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); prev() }} title="รูปก่อนหน้า (←)"
            className="absolute left-2 sm:left-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25">
            <ChevronLeft size={24} />
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cur.url || cur.thumb} alt={cur.filename ?? ""} onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl" />
        {n > 1 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); next() }} title="รูปถัดไป (→)"
            className="absolute right-2 sm:right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25">
            <ChevronRight size={24} />
          </button>
        )}
      </div>

      {/* ชื่อไฟล์ + thumbnail strip */}
      <div className="p-3" onClick={(e) => e.stopPropagation()}>
        {cur.filename && <p className="mb-2 truncate text-center text-[11px] text-white/60">{cur.filename}</p>}
        {n > 1 && (
          <div className="flex justify-center gap-1.5 overflow-x-auto pb-1">
            {images.map((im, ii) => (
              <button key={ii} type="button" onClick={() => setI(ii)}
                className={`shrink-0 overflow-hidden rounded-lg border-2 transition ${ii === i ? "border-white" : "border-transparent opacity-50 hover:opacity-90"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.thumb || im.url} alt="" className="h-12 w-12 object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
