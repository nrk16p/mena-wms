"use client"

import { useEffect, useState, useCallback } from "react"
import { BookOpen, X } from "lucide-react"

type Rect = { top: number; left: number; width: number; height: number }

const PAD = 8

export function TourHighlight() {
  const [rect, setRect] = useState<Rect | null>(null)

  const measure = useCallback(() => {
    const el = document.getElementById("sidebar-manual-btn")
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [])

  useEffect(() => {
    function onShow() {
      if (localStorage.getItem("mena_tour_done")) return
      measure()
    }
    window.addEventListener("mena:show-tour", onShow)
    window.addEventListener("resize", () => { if (rect) measure() })
    return () => window.removeEventListener("mena:show-tour", onShow)
  }, [measure, rect])

  function dismiss() {
    localStorage.setItem("mena_tour_done", "1")
    setRect(null)
  }

  if (!rect) return null

  const holeTop  = rect.top  - PAD
  const holeLeft = rect.left - PAD
  const holeW    = rect.width  + PAD * 2
  const holeH    = rect.height + PAD * 2

  // tooltip อยู่ขวาของ spotlight
  const ttLeft = holeLeft + holeW + 16
  const ttTop  = holeTop + holeH / 2 - 48

  return (
    <>
      {/* dim overlay — ใช้ box-shadow สร้าง "ช่อง" ใส */}
      <div
        onClick={dismiss}
        style={{
          position: "fixed", inset: 0,
          zIndex: 9997,
          cursor: "default",
        }}
      />
      <div
        style={{
          position: "fixed",
          top: holeTop,
          left: holeLeft,
          width: holeW,
          height: holeH,
          borderRadius: 10,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.62)",
          zIndex: 9998,
          pointerEvents: "none",
          outline: "2.5px solid #16a34a",
          outlineOffset: 1,
        }}
      />

      {/* tooltip */}
      <div
        style={{
          position: "fixed",
          top: Math.max(8, ttTop),
          left: ttLeft,
          zIndex: 9999,
          maxWidth: 220,
        }}
        className="rounded-xl bg-white dark:bg-[#0f1117] border border-gray-200 dark:border-white/10 shadow-2xl p-4"
      >
        {/* arrow ชี้ซ้าย */}
        <div
          style={{
            position: "absolute",
            left: -8,
            top: "50%",
            transform: "translateY(-50%)",
            width: 0, height: 0,
            borderTop: "8px solid transparent",
            borderBottom: "8px solid transparent",
            borderRight: "8px solid",
          }}
          className="border-r-white dark:border-r-[#0f1117]"
        />

        <div className="flex items-start gap-2 mb-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/40">
            <BookOpen size={14} className="text-green-700 dark:text-green-400" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-gray-900 dark:text-white leading-snug">
              เริ่มต้นจากคู่มือก่อนนะ!
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
              กดปุ่มนี้เพื่ออ่านวิธีใช้งาน<br />Mena WMS ทีละขั้นตอน
            </p>
          </div>
        </div>

        <button
          onClick={dismiss}
          className="w-full mt-1 rounded-lg border border-gray-200 dark:border-white/10 text-[11px] text-gray-500 dark:text-gray-400 py-1.5 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors"
        >
          ข้ามไปก่อน
        </button>

        <button
          onClick={dismiss}
          className="absolute top-2.5 right-2.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          <X size={12} />
        </button>
      </div>
    </>
  )
}
