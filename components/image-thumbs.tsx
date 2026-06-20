"use client"

import { useState } from "react"
import type { SkuImage } from "@/lib/media"

type Thumb = Pick<SkuImage, "webpUrl" | "thumbnailUrl" | "filename">

const PREVIEW = 240 // px — floating zoom size (not fullscreen)

// Small thumbnails (e.g. under a table cell). Hover or click enlarges the image
// in a fixed, viewport-positioned popover so it isn't clipped by table overflow.
export function ImageThumbs({ images, max = 4 }: { images?: Thumb[]; max?: number }) {
  const [preview, setPreview] = useState<{ src: string; x: number; y: number } | null>(null)
  const [pinned, setPinned]   = useState(false)

  if (!images || images.length === 0) return null
  const shown = images.filter((i) => i.thumbnailUrl || i.webpUrl).slice(0, max)
  if (shown.length === 0) return null
  const extra = images.length - shown.length

  function showAt(el: HTMLElement, src: string) {
    const r = el.getBoundingClientRect()
    const gap = 10
    let x = r.right + gap
    if (x + PREVIEW > window.innerWidth) x = r.left - gap - PREVIEW   // flip left if no room
    x = Math.max(4, x)
    let y = r.top + r.height / 2 - PREVIEW / 2
    y = Math.max(8, Math.min(y, window.innerHeight - PREVIEW - 8))    // clamp to viewport
    setPreview({ src, x, y })
  }

  function close() { setPinned(false); setPreview(null) }

  return (
    <div className="mt-1 flex items-center gap-1">
      {shown.map((img, i) => {
        const thumb = img.thumbnailUrl || img.webpUrl
        const full  = img.webpUrl || img.thumbnailUrl
        return (
          <button
            key={i}
            type="button"
            onMouseEnter={(e) => { if (!pinned) showAt(e.currentTarget, full!) }}
            onMouseLeave={() => { if (!pinned) setPreview(null) }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (pinned) close()
              else { setPinned(true); showAt(e.currentTarget, full!) }
            }}
            title={img.filename}
            className="h-6 w-6 shrink-0 overflow-hidden rounded border border-gray-200 bg-gray-50 transition-transform hover:scale-110 hover:border-[#1B8C4B] dark:border-white/15 dark:bg-white/5"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
          </button>
        )
      })}

      {extra > 0 && <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">+{extra}</span>}

      {preview && (
        <div
          className="fixed z-50 rounded-lg border border-gray-200 bg-white p-1 shadow-2xl dark:border-white/15 dark:bg-[#0f1117]"
          style={{ left: preview.x, top: preview.y, width: PREVIEW }}
          onClick={close}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview.src}
            alt=""
            className="w-full rounded object-contain"
            style={{ maxHeight: PREVIEW }}
          />
          {pinned && (
            <span className="absolute right-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[9px] font-medium text-white">
              คลิกเพื่อปิด
            </span>
          )}
        </div>
      )}
    </div>
  )
}
