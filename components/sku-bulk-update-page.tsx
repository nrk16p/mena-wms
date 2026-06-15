"use client"

import React, { useState, useRef, useCallback, useEffect } from "react"
import { TableProperties, Plus, Trash2, Download, Save, ChevronDown } from "lucide-react"
import { swalToast, swalError } from "@/lib/swal"

type Row = {
  id: string
  sku: string
  nameTh: string
  nameEn: string
  partNo: string
  l1: string
  l2: string
  price: string
  unit: string
  brand: string
  vehicle: string
  isNew: boolean
  isModified?: boolean
}

const COLS: { key: keyof Row; label: string; width: number; type?: "number" }[] = [
  { key: "sku",      label: "SKU",            width: 160 },
  { key: "nameTh",  label: "ชื่ออะไหล่ TH",  width: 200 },
  { key: "nameEn",  label: "Part Name EN",    width: 180 },
  { key: "partNo",  label: "เบอร์อะไหล่",     width: 150 },
  { key: "l1",      label: "L1",              width: 70  },
  { key: "l2",      label: "L2",              width: 70  },
  { key: "price",   label: "ราคา (฿)",        width: 90,  type: "number" },
  { key: "unit",    label: "หน่วย",           width: 70  },
  { key: "brand",   label: "ยี่ห้อ",          width: 110 },
  { key: "vehicle", label: "รุ่นรถ",          width: 120 },
]

const EDITABLE_KEYS = COLS.map((c) => c.key)

const MIXER_ROWS: Omit<Row, "id" | "isNew" | "isModified">[] = [
  { sku: "LK-PRT-MXS-001", nameTh: "ซีลโม่ผสมคอนกรีต", nameEn: "Mixer Drum Seal Kit", partNo: "SK-MX-3812-A", l1: "MXS", l2: "SLD", price: "3200", unit: "SET", brand: "NOK", vehicle: "Mixer Truck" },
  { sku: "LK-PRT-MXS-002", nameTh: "ลูกกลิ้งรับโม่ผสม", nameEn: "Drum Support Roller", partNo: "RLR-450-MX", l1: "MXS", l2: "RLR", price: "4800", unit: "PC", brand: "Generic", vehicle: "Mixer Truck" },
  { sku: "LK-PRT-MXS-003", nameTh: "ปั๊มไฮดรอลิกขับโม่", nameEn: "Hydraulic Drive Pump", partNo: "HP-705-KYB", l1: "MXS", l2: "HYD", price: "28500", unit: "PC", brand: "KYB", vehicle: "Mixer Truck" },
  { sku: "LK-PRT-MXS-004", nameTh: "สายไฮดรอลิกความดันสูง", nameEn: "High Pressure Hydraulic Hose", partNo: "HH-3/4-600", l1: "MXS", l2: "HYD", price: "1850", unit: "PC", brand: "Parker", vehicle: "Mixer Truck" },
  { sku: "LK-PRT-MXS-005", nameTh: "ชุดเกียร์ทดขับโม่", nameEn: "Mixer Reduction Gearbox", partNo: "GBX-MX-2200", l1: "MXS", l2: "GBX", price: "62000", unit: "PC", brand: "Sauer-Danfoss", vehicle: "Mixer Truck" },
  { sku: "LK-PRT-MXS-006", nameTh: "รางเทคอนกรีต (ชุด)", nameEn: "Concrete Discharge Chute Set", partNo: "CHT-SET-MX", l1: "MXS", l2: "CHT", price: "7500", unit: "SET", brand: "Generic", vehicle: "Mixer Truck" },
  { sku: "LK-PRT-MXS-007", nameTh: "ไส้กรองน้ำมันไฮดรอลิก", nameEn: "Hydraulic Oil Filter", partNo: "HF-35011", l1: "MXS", l2: "HYD", price: "650", unit: "PC", brand: "Fleetguard", vehicle: "Mixer Truck" },
  { sku: "LK-PRT-MXS-008", nameTh: "ถังน้ำล้างโม่", nameEn: "Drum Wash Water Tank", partNo: "WT-200L-MX", l1: "MXS", l2: "WTR", price: "5200", unit: "PC", brand: "Generic", vehicle: "Mixer Truck" },
  { sku: "LK-PRT-ENG-001", nameTh: "ไส้กรองน้ำมันเครื่อง", nameEn: "Engine Oil Filter", partNo: "EF-26320-35503", l1: "ENG", l2: "OIL", price: "350", unit: "PC", brand: "Genuine", vehicle: "Mixer Truck" },
  { sku: "LK-PRT-ENG-002", nameTh: "ไส้กรองอากาศ", nameEn: "Air Filter Element", partNo: "AF-17801-2880", l1: "ENG", l2: "OIL", price: "720", unit: "PC", brand: "Genuine", vehicle: "Mixer Truck" },
  { sku: "LK-PRT-COL-001", nameTh: "ปั๊มน้ำหล่อเย็น", nameEn: "Water Pump Assembly", partNo: "WP-16100-78220", l1: "COL", l2: "WPP", price: "3500", unit: "PC", brand: "Aisin", vehicle: "Mixer Truck" },
  { sku: "LK-PRT-PTO-001", nameTh: "แผ่นคลัทช์ PTO", nameEn: "PTO Clutch Disc", partNo: "PTO-CD-220", l1: "PTO", l2: "CLT", price: "8900", unit: "PC", brand: "Generic", vehicle: "Mixer Truck" },
]

const BATTERY_ROWS: Omit<Row, "id" | "isNew" | "isModified">[] = [
  { sku: "LK-PRT-ELC-B01", nameTh: "แบตเตอรี่รถ 12V 200Ah DIN200", nameEn: "Truck Battery 12V 200Ah", partNo: "BAT-DIN200-MF", l1: "ELC", l2: "BAT", price: "4800", unit: "PC", brand: "Yuasa", vehicle: "Mixer Truck" },
  { sku: "LK-PRT-ELC-B02", nameTh: "แบตเตอรี่รถ 12V 150Ah DIN150", nameEn: "Truck Battery 12V 150Ah", partNo: "BAT-DIN150-MF", l1: "ELC", l2: "BAT", price: "3600", unit: "PC", brand: "Yuasa", vehicle: "Light Truck" },
  { sku: "LK-PRT-ELC-B03", nameTh: "แบตเตอรี่รถ 12V 100Ah DIN100", nameEn: "Truck Battery 12V 100Ah", partNo: "BAT-DIN100-MF", l1: "ELC", l2: "BAT", price: "2800", unit: "PC", brand: "GS Yuasa", vehicle: "Pickup" },
  { sku: "LK-PRT-ELC-B04", nameTh: "แบตเตอรี่รถ 24V 200Ah (คู่)", nameEn: "24V Battery Set (2×12V)", partNo: "BAT-24V-200-SET", l1: "ELC", l2: "BAT", price: "9600", unit: "SET", brand: "Yuasa", vehicle: "Heavy Truck" },
  { sku: "LK-PRT-ELC-B05", nameTh: "ขั้วแบตเตอรี่ขั้วบวก", nameEn: "Battery Terminal Positive (+)", partNo: "BT-POS-M8", l1: "ELC", l2: "BAT", price: "85", unit: "PC", brand: "Generic", vehicle: "All" },
  { sku: "LK-PRT-ELC-B06", nameTh: "ขั้วแบตเตอรี่ขั้วลบ", nameEn: "Battery Terminal Negative (−)", partNo: "BT-NEG-M8", l1: "ELC", l2: "BAT", price: "85", unit: "PC", brand: "Generic", vehicle: "All" },
  { sku: "LK-PRT-ELC-B07", nameTh: "สายแบตเตอรี่ขั้วบวก 70 sq", nameEn: "Battery Cable Positive 70mm²", partNo: "BC-POS-70-120", l1: "ELC", l2: "CAB", price: "320", unit: "PC", brand: "Generic", vehicle: "Heavy Truck" },
  { sku: "LK-PRT-ELC-B08", nameTh: "สายแบตเตอรี่ขั้วลบ 70 sq", nameEn: "Battery Cable Negative 70mm²", partNo: "BC-NEG-70-120", l1: "ELC", l2: "CAB", price: "320", unit: "PC", brand: "Generic", vehicle: "Heavy Truck" },
  { sku: "LK-PRT-ELC-B09", nameTh: "ถาดยึดแบตเตอรี่สแตนเลส", nameEn: "Stainless Battery Tray & Bracket", partNo: "BH-SS-MX-01", l1: "ELC", l2: "BAT", price: "1200", unit: "SET", brand: "Generic", vehicle: "Mixer Truck" },
  { sku: "LK-PRT-ELC-B10", nameTh: "ที่ตัดกระแสไฟฟ้า (Battery Cut-off)", nameEn: "Battery Isolator Switch", partNo: "BIS-400A", l1: "ELC", l2: "SAF", price: "950", unit: "PC", brand: "Hella", vehicle: "All" },
]

function makeId() {
  return Math.random().toString(36).slice(2, 9)
}

function seedRows(data: Omit<Row, "id" | "isNew" | "isModified">[]): Row[] {
  return data.map((r) => ({ ...r, id: makeId(), isNew: false }))
}

type CellAddr = { rowIdx: number; colIdx: number }

const TABS = [
  { key: "mixer", label: "🚛 Mixer Truck", color: "border-[#1B8C4B] text-[#1B8C4B]" },
  { key: "battery", label: "🔋 Battery",    color: "border-blue-500 text-blue-600" },
] as const
type TabKey = typeof TABS[number]["key"]

export function SkuBulkUpdatePage() {
  const [tab, setTab] = useState<TabKey>("mixer")
  const [mixerRows, setMixerRows]   = useState<Row[]>(() => seedRows(MIXER_ROWS))
  const [batteryRows, setBatteryRows] = useState<Row[]>(() => seedRows(BATTERY_ROWS))
  const [selected, setSelected]     = useState<CellAddr | null>(null)
  const [editVal, setEditVal]       = useState("")
  const [saving, setSaving]         = useState(false)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  const rows    = tab === "mixer" ? mixerRows : batteryRows
  const setRows = tab === "mixer" ? setMixerRows : setBatteryRows

  const startEdit = useCallback((rowIdx: number, colIdx: number, rows: Row[]) => {
    const key = COLS[colIdx].key
    setSelected({ rowIdx, colIdx })
    setEditVal(String(rows[rowIdx]?.[key] ?? ""))
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 0)
  }, [])

  useEffect(() => {
    if (selected) startEdit(selected.rowIdx, selected.colIdx, rows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  function commitEdit(rowIdx: number, colIdx: number, val: string) {
    const key = COLS[colIdx].key as keyof Row
    setRows((prev) =>
      prev.map((r, i) =>
        i === rowIdx ? { ...r, [key]: val, isModified: !r.isNew } : r
      )
    )
  }

  function handleKeyDown(e: React.KeyboardEvent, rowIdx: number, colIdx: number) {
    if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault()
      commitEdit(rowIdx, colIdx, editVal)
      const nextCol = e.key === "Tab"
        ? (e.shiftKey ? colIdx - 1 : colIdx + 1)
        : colIdx
      const nextRow = e.key === "Enter" ? rowIdx + 1 : rowIdx

      const clampedCol = Math.max(0, Math.min(COLS.length - 1, nextCol))
      const clampedRow = Math.max(0, Math.min(rows.length - 1, nextRow))
      startEdit(clampedRow, clampedCol, rows)
    } else if (e.key === "Escape") {
      setSelected(null)
    }
  }

  function addRow() {
    const newRow: Row = {
      id: makeId(), sku: "", nameTh: "", nameEn: "", partNo: "",
      l1: "", l2: "", price: "", unit: "PC", brand: "", vehicle: "",
      isNew: true,
    }
    setRows((prev) => [...prev, newRow])
    setTimeout(() => startEdit(rows.length, 0, [...rows, newRow]), 0)
  }

  function deleteSelected() {
    if (selectedRowIds.size === 0) return
    setRows((prev) => prev.filter((r) => !selectedRowIds.has(r.id)))
    setSelectedRowIds(new Set())
    setSelected(null)
  }

  function toggleRowSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelectedRowIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function exportCSV() {
    const header = COLS.map((c) => c.label).join(",")
    const body = rows.map((r) =>
      COLS.map((c) => `"${String(r[c.key] ?? "").replace(/"/g, '""')}"`).join(",")
    ).join("\n")
    const blob = new Blob([header + "\n" + body], { type: "text/csv;charset=utf-8;" })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement("a"), { href: url, download: `sku-${tab}.csv` })
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleSave() {
    const toSave = rows.filter((r) => r.isNew || r.isModified)
    if (toSave.length === 0) { swalToast("info", "ไม่มีแถวที่เปลี่ยนแปลง"); return }
    setSaving(true)
    try {
      const results = await Promise.allSettled(
        toSave.map((r) => {
          const body = {
            SKU: r.sku, ชื่ออะไหล่_TH: r.nameTh, Part_Name_EN: r.nameEn,
            เบอร์อะไหล่: r.partNo, ระบบ_L1: r.l1, ชุดประกอบ_L2: r.l2,
            ราคาต่อหน่วย: Number(r.price) || 0, หน่วย: r.unit,
            ยี่ห้อ: r.brand, ทะเบียนหรือรุ่นรถ: r.vehicle,
            คลังสินค้า: "LK", ประเภทค่าใช้จ่าย: "PRT", Grade: "OEM",
          }
          return r.isNew
            ? fetch("/api/sku", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
            : fetch(`/api/sku/${r.sku}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        })
      )
      const failed = results.filter((r) => r.status === "rejected").length
      if (failed > 0) swalError(`บันทึกไม่สำเร็จ ${failed} รายการ`)
      else {
        swalToast("success", `บันทึก ${toSave.length} รายการสำเร็จ`)
        setRows((prev) => prev.map((r) => ({ ...r, isNew: false, isModified: false })))
      }
    } finally {
      setSaving(false)
    }
  }

  const modifiedCount = rows.filter((r) => r.isNew || r.isModified).length

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] select-none">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <TableProperties size={20} className="text-gray-400" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white leading-none">SKU Bulk Update</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">ตัวอย่างข้อมูล — Mixer Truck &amp; Battery</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {modifiedCount > 0 && (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              {modifiedCount} แถวรอบันทึก
            </span>
          )}
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
          >
            <Download size={13} /> Export CSV
          </button>
          <button
            onClick={handleSave}
            disabled={saving || modifiedCount === 0}
            className="flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] text-white px-3 py-1.5 text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            <Save size={13} />
            {saving ? "กำลังบันทึก..." : `บันทึก${modifiedCount > 0 ? ` (${modifiedCount})` : ""}`}
          </button>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <button
          onClick={addRow}
          className="flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 dark:border-white/15 px-2.5 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:border-[#1B8C4B] hover:text-[#1B8C4B] transition-colors"
        >
          <Plus size={12} /> เพิ่มแถว
        </button>
        {selectedRowIds.size > 0 && (
          <button
            onClick={deleteSelected}
            className="flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-900/50 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            <Trash2 size={12} /> ลบ ({selectedRowIds.size})
          </button>
        )}
        <span className="text-xs text-gray-400 ml-1">{rows.length} แถว</span>
        <div className="ml-auto flex items-center gap-1 text-[10px] text-gray-400">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-100 dark:bg-amber-900/40 border border-amber-300/60" /> แก้ไขแล้ว
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-100 dark:bg-blue-900/40 border border-blue-300/60 ml-2" /> ใหม่
        </div>
      </div>

      {/* ── Spreadsheet ── */}
      <div className="flex-1 rounded-t-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-auto min-h-0">
        <table className="text-xs border-collapse" style={{ minWidth: COLS.reduce((s, c) => s + c.width + 42, 0) }}>
          {/* Column headers — sticky */}
          <thead className="sticky top-0 z-10">
            <tr>
              {/* row-select column */}
              <th className="sticky left-0 z-20 w-8 border-b border-r border-gray-200 dark:border-white/10 bg-[#f8f9fa] dark:bg-[#16181f] px-1 py-2 text-center text-[10px] font-bold text-gray-400"></th>
              {/* row number */}
              <th className="w-9 border-b border-r border-gray-200 dark:border-white/10 bg-[#f8f9fa] dark:bg-[#16181f] px-1 py-2 text-center text-[10px] font-bold text-gray-400">#</th>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  style={{ width: col.width, minWidth: col.width }}
                  className="border-b border-r border-gray-200 dark:border-white/10 bg-[#f8f9fa] dark:bg-[#16181f] px-2 py-2 text-left text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, rowIdx) => {
              const isChecked  = selectedRowIds.has(row.id)
              const rowBg = isChecked
                ? "bg-blue-50/70 dark:bg-blue-950/20"
                : row.isNew
                  ? "bg-blue-50/40 dark:bg-blue-950/10"
                  : row.isModified
                    ? "bg-amber-50/60 dark:bg-amber-950/10"
                    : rowIdx % 2 === 1 ? "bg-gray-50/40 dark:bg-white/[0.02]" : ""

              return (
                <tr key={row.id} className={`group ${rowBg}`}>
                  {/* Checkbox */}
                  <td
                    className="sticky left-0 z-[5] w-8 border-b border-r border-gray-100 dark:border-white/5 px-1 text-center cursor-pointer"
                    style={{ background: "inherit" }}
                    onClick={(e) => toggleRowSelect(row.id, e)}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      className="h-3 w-3 rounded accent-[#1B8C4B] cursor-pointer"
                    />
                  </td>

                  {/* Row number */}
                  <td className="w-9 border-b border-r border-gray-100 dark:border-white/5 px-1 py-1 text-center text-[10px] text-gray-400 font-mono">
                    {rowIdx + 1}
                    {row.isNew && <span className="ml-0.5 text-blue-400 text-[8px]">●</span>}
                    {row.isModified && <span className="ml-0.5 text-amber-400 text-[8px]">✎</span>}
                  </td>

                  {COLS.map((col, colIdx) => {
                    const isActive = selected?.rowIdx === rowIdx && selected?.colIdx === colIdx
                    const val = String(row[col.key] ?? "")

                    return (
                      <td
                        key={col.key}
                        style={{ width: col.width, minWidth: col.width }}
                        onClick={() => startEdit(rowIdx, colIdx, rows)}
                        className={[
                          "border-b border-r border-gray-100 dark:border-white/5 p-0 cursor-cell relative",
                          isActive ? "ring-2 ring-inset ring-[#1B8C4B] z-[1]" : "",
                        ].join(" ")}
                      >
                        {isActive ? (
                          <input
                            ref={inputRef}
                            type={col.type === "number" ? "number" : "text"}
                            value={editVal}
                            onChange={(e) => setEditVal(e.target.value)}
                            onBlur={() => { commitEdit(rowIdx, colIdx, editVal); setSelected(null) }}
                            onKeyDown={(e) => handleKeyDown(e, rowIdx, colIdx)}
                            className="w-full h-full px-2 py-1.5 text-xs bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white outline-none"
                          />
                        ) : (
                          <span className={[
                            "block px-2 py-1.5 truncate",
                            col.key === "sku" ? "font-mono text-[11px] text-gray-700 dark:text-gray-300" : "text-gray-700 dark:text-gray-300",
                            col.key === "l1" || col.key === "l2" ? "text-center font-semibold text-[#1B8C4B] dark:text-[#4ade80]" : "",
                            col.key === "price" ? "text-right tabular-nums" : "",
                            !val ? "text-gray-300 dark:text-white/15 italic" : "",
                          ].join(" ")}>
                            {val || "—"}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Sheet tabs ── */}
      <div className="flex items-end gap-0 border-x border-b border-gray-200 dark:border-white/8 bg-[#f8f9fa] dark:bg-[#0a0e14] rounded-b-xl px-2 pt-1 shrink-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setSelected(null); setTab(t.key) }}
            className={[
              "px-4 py-1.5 text-xs font-semibold rounded-t-lg border-l border-r border-t transition-colors mr-0.5",
              tab === t.key
                ? `bg-white dark:bg-[#0f1117] border-gray-200 dark:border-white/10 ${t.color}`
                : "border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300",
            ].join(" ")}
          >
            {t.label}
            <span className="ml-1.5 text-[10px] font-normal opacity-60">
              {t.key === "mixer" ? mixerRows.length : batteryRows.length}
            </span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 pb-1.5 pr-1 text-[10px] text-gray-400">
          <ChevronDown size={10} /> Tab / Enter ย้ายเซลล์
        </div>
      </div>
    </div>
  )
}
