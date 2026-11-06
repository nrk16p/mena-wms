"use client"

/**
 * ทะเบียนยางสระบุรี (แบบชีต) — แท็บเหมือน Google Sheet เดิม
 * เตรียมข้อมูล → ส่งข้อมูล → ตารางยางนอก (กรองตามประเภทยาง) → รอบอนุมัติ + PDF · บันทึกการจัดเก็บ · ขายเหมา · นำเข้าจากชีต
 */
import { useEffect, useState } from "react"
import { SheetGrid } from "./sheet-grid"
import { SheetRounds } from "./sheet-rounds"
import { SheetImport } from "./sheet-import"
import { EMPTY_OPTIONS, type SheetOptions } from "@/lib/tyre-sheet"

const TABS = [
  { key: "prep", label: "เตรียมข้อมูล" },
  { key: "tyres", label: "ยางนอก" },
  { key: "rounds", label: "รอบอนุมัติ / PDF" },
  { key: "storage", label: "บันทึกการจัดเก็บยาง" },
  { key: "sales", label: "ขายเหมา (Sheet16)" },
  { key: "import", label: "นำเข้าจากชีต" },
] as const
type TabKey = (typeof TABS)[number]["key"]

export function TyreSheetPage() {
  const [tab, setTab] = useState<TabKey>("prep")
  const [options, setOptions] = useState<SheetOptions>(EMPTY_OPTIONS)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    fetch("/api/tyre-sheet/options").then((r) => (r.ok ? r.json() : EMPTY_OPTIONS)).then(setOptions).catch(() => {})
  }, [reloadKey])

  // เปิดแท็บตาม #hash ในลิงก์ (เช่น #rounds)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const h = window.location.hash.replace("#", "")
      if (TABS.some((t) => t.key === h)) setTab(h as TabKey)
      else if (h === "11R22.5" || h === "1000-20") setTab("tyres") // ลิงก์เก่า
    })
    return () => cancelAnimationFrame(id)
  }, [])
  const go = (k: TabKey) => { setTab(k); history.replaceState(null, "", `#${k}`) }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">ทะเบียนยางสระบุรี (แบบชีต)</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">ย้ายจาก Google Sheet “[2026]ข้อมูลยางสระบุรี” · ขั้นตอนเหมือนเดิม กรอกเองเหมือนเดิม กดดึงบางช่องจาก ATMS ได้</p>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-white/10">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => go(t.key)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === t.key ? "border-blue-600 text-blue-700 dark:text-blue-300 font-semibold" : "border-transparent text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div key={`${tab}-${reloadKey}`}>
        {tab === "prep" && <SheetGrid kind="rows" stage="prep" options={options} title="เตรียมข้อมูล" />}
        {tab === "tyres" && <SheetGrid kind="rows" stage="sent" sizeFilter options={options} title="[2026]ยางนอก" />}
        {tab === "rounds" && <SheetRounds />}
        {tab === "storage" && <SheetGrid kind="storage" options={options} title="บันทึกการจัดเก็บยาง" />}
        {tab === "sales" && <SheetGrid kind="sales" options={options} title="ขายเหมา" />}
        {tab === "import" && <SheetImport onDone={() => setReloadKey((k) => k + 1)} />}
      </div>
    </div>
  )
}
