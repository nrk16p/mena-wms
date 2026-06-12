"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, ClipboardPaste, Plus, Trash2, Save, Disc3 } from "lucide-react"
import { swalToast, swalError } from "@/lib/swal"

type Row = {
  prCode:      string
  ddCode:      string
  depositDate: string
  productCode: string
  productName: string
  serialNo:    string
  unitPrice:   string
  brand:       string
  tireSize:    string
  tireModel:   string
  distance:    string
  status:      string
  tireType:      string
  warrantyUntil: string
}

const COLS: { key: keyof Row; label: string; width: string }[] = [
  { key: "prCode",      label: "PR Code",      width: "min-w-[110px]" },
  { key: "ddCode",      label: "DD Code",      width: "min-w-[110px]" },
  { key: "depositDate", label: "Deposit Date", width: "min-w-[110px]" },
  { key: "productCode", label: "รหัสสินค้า",    width: "min-w-[100px]" },
  { key: "productName", label: "ชื่อสินค้า",    width: "min-w-[180px]" },
  { key: "serialNo",    label: "Serial No *",  width: "min-w-[120px]" },
  { key: "unitPrice",   label: "Unit Price",   width: "min-w-[90px]" },
  { key: "brand",       label: "ยี่ห้อ",        width: "min-w-[110px]" },
  { key: "tireSize",    label: "ขนาดยาง",      width: "min-w-[100px]" },
  { key: "tireModel",   label: "รุ่นยาง",       width: "min-w-[100px]" },
  { key: "distance",    label: "ระยะทาง",      width: "min-w-[90px]" },
  { key: "status",      label: "Status",       width: "min-w-[110px]" },
  { key: "tireType",      label: "ประเภทยาง",    width: "min-w-[100px]" },
  { key: "warrantyUntil", label: "วันหมดประกัน", width: "min-w-[110px]" },
]

const STATUS_OPTIONS = ["In Stock", "เบิกใช้แล้ว", "เคลม", "ขายแล้ว"]

const EMPTY_ROW: Row = {
  prCode: "", ddCode: "", depositDate: "", productCode: "", productName: "",
  serialNo: "", unitPrice: "", brand: "", tireSize: "", tireModel: "",
  distance: "", status: "In Stock", tireType: "", warrantyUntil: "",
}

// "in-stock" / "in stock" / "instock" → "In Stock"
const normStatus = (s: string) => {
  const t = s.trim()
  if (t.toLowerCase().replace(/[-_\s]+/g, "") === "instock") return "In Stock"
  return t || "In Stock"
}

const cleanNum = (s: string) => s.replace(/,/g, "").trim()

function parsePaste(text: string): Row[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/ /g, " ")).filter((l) => l.trim() !== "")
  const rows: Row[] = []
  for (const line of lines) {
    const cells = line.split("\t").map((c) => c.trim())
    // skip header row if pasted along with the data
    const joined = cells.join(" ").toLowerCase()
    if (joined.includes("pr code") || joined.includes("serial no") || joined.includes("deposit date")) continue

    rows.push({
      prCode:      cells[0]  ?? "",
      ddCode:      cells[1]  ?? "",
      depositDate: cells[2]  ?? "",
      productCode: cells[3]  ?? "",
      productName: cells[4]  ?? "",
      serialNo:    cells[5]  ?? "",
      unitPrice:   cleanNum(cells[6] ?? ""),
      brand:       cells[7]  ?? "",
      tireSize:    cells[8]  ?? "",
      tireModel:   cells[9]  ?? "",
      distance:    cleanNum(cells[10] ?? ""),
      status:      normStatus(cells[11] ?? ""),
      tireType:      cells[12] ?? "",
      warrantyUntil: cells[13] ?? "",
    })
  }
  return rows
}

export function TireStockAddPage({ branch, branchLabel }: { branch: string; branchLabel: string }) {
  const router = useRouter()
  const [rows, setRows]     = useState<Row[]>([])
  const [saving, setSaving] = useState(false)

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    e.preventDefault()
    const parsed = parsePaste(e.clipboardData.getData("text/plain"))
    if (parsed.length === 0) {
      swalError("ไม่พบข้อมูลที่วางได้ — กรุณา copy จาก Excel เป็นแถว")
      return
    }
    setRows((prev) => [...prev, ...parsed])
  }

  function setCell(ri: number, key: keyof Row, value: string) {
    setRows((prev) => prev.map((r, i) => (i === ri ? { ...r, [key]: value } : r)))
  }

  function removeRow(ri: number) {
    setRows((prev) => prev.filter((_, i) => i !== ri))
  }

  async function handleSave() {
    if (rows.length === 0) return
    if (rows.some((r) => !r.serialNo.trim())) {
      swalError("มีบางแถวไม่มี Serial No — กรุณากรอกหรือลบแถวนั้น")
      return
    }
    setSaving(true)
    const res = await fetch("/api/tire-stock/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branch,
        items: rows.map((r) => ({ ...r, unitPrice: cleanNum(r.unitPrice), distance: cleanNum(r.distance) })),
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      swalError(d.error ?? "บันทึกไม่สำเร็จ")
      return
    }
    const d: { inserted: number; skipped: { serialNo: string; reason: string }[] } = await res.json()

    if (d.skipped.length === 0) {
      swalToast("success", `บันทึกสำเร็จ ${d.inserted} รายการ`)
      router.push(`/tire/${branch}/stock-tire`)
      return
    }

    // keep only the rows that were skipped so the user can fix them
    const skippedSerials = new Set(d.skipped.map((s) => s.serialNo))
    setRows((prev) => prev.filter((r) => skippedSerials.has(r.serialNo.trim())))
    swalError(
      `บันทึกแล้ว ${d.inserted} รายการ — ข้าม ${d.skipped.length} รายการ:\n` +
      d.skipped.map((s) => `• ${s.serialNo}: ${s.reason}`).join("\n")
    )
  }

  const inp = "w-full rounded border border-transparent hover:border-gray-200 dark:hover:border-white/10 focus:border-gray-300 dark:focus:border-white/20 bg-transparent text-gray-900 dark:text-white px-1.5 py-1 text-xs focus:outline-none"
  const th  = "px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap"

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <Disc3 size={20} className="text-gray-400" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">เพิ่มรายการสต๊อกยาง — {branchLabel}</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Copy ตารางจาก Excel / Google Sheets แล้ววาง (Ctrl+V) ในช่องด้านล่าง — ลำดับคอลัมน์:
        PR Code, DD Code, Deposit Date, รหัสสินค้า, ชื่อสินค้า, Serial No, Unit Price, ยี่ห้อ, ขนาดยาง, รุ่นยาง, ระยะทาง, Status, ประเภทยาง, วันหมดประกัน
      </p>

      {/* Paste area */}
      <div className="mb-4 rounded-xl border-2 border-dashed border-gray-300 dark:border-white/15 bg-white dark:bg-[#0f1117] p-4">
        <div className="flex items-center gap-2 mb-2 text-gray-500 dark:text-gray-400">
          <ClipboardPaste size={15} />
          <span className="text-sm font-medium">วางข้อมูลจาก Excel ที่นี่</span>
        </div>
        <textarea
          value=""
          onChange={() => {}}
          onPaste={handlePaste}
          placeholder="คลิกที่นี่แล้วกด Ctrl+V เพื่อวางข้อมูล (วางได้หลายครั้ง — แถวใหม่จะถูกเพิ่มต่อท้าย)"
          className="w-full h-20 resize-none rounded-md border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0a0a10] px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30"
        />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Link
          href={`/tire/${branch}/stock-tire`}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3.5 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/8 transition-colors"
        >
          <ArrowLeft size={14} />
          กลับ
        </Link>
        <button
          onClick={() => setRows((prev) => [...prev, { ...EMPTY_ROW }])}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3.5 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/8 transition-colors"
        >
          <Plus size={14} />
          เพิ่มแถวว่าง
        </button>
        <span className="text-sm text-gray-400">{rows.length} แถว</span>
        <button
          onClick={handleSave}
          disabled={saving || rows.length === 0}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          <Save size={14} />
          {saving ? "กำลังบันทึก..." : `บันทึกทั้งหมด (${rows.length})`}
        </button>
      </div>

      {/* Editable preview table */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                <th className={th + " w-8 text-center"}>#</th>
                {COLS.map((c) => <th key={c.key} className={th}>{c.label}</th>)}
                <th className="px-2 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length + 2} className="px-4 py-10 text-center text-sm text-gray-400">
                    ยังไม่มีข้อมูล — วางข้อมูลจาก Excel หรือกด &quot;เพิ่มแถวว่าง&quot;
                  </td>
                </tr>
              ) : rows.map((row, ri) => (
                <tr
                  key={ri}
                  className={`border-b border-gray-100 dark:border-white/5 ${ri % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : ""} ${!row.serialNo.trim() ? "bg-red-50/60 dark:bg-red-950/20" : ""}`}
                >
                  <td className="px-2 py-1 text-center text-[11px] text-gray-400">{ri + 1}</td>
                  {COLS.map((c) => (
                    <td key={c.key} className={`px-1 py-0.5 ${c.width}`}>
                      {c.key === "status" ? (
                        <select value={row.status} onChange={(e) => setCell(ri, "status", e.target.value)} className={inp}>
                          {!STATUS_OPTIONS.includes(row.status) && <option value={row.status}>{row.status}</option>}
                          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <input
                          value={row[c.key]}
                          onChange={(e) => setCell(ri, c.key, e.target.value)}
                          className={inp + (c.key === "unitPrice" || c.key === "distance" ? " text-right" : "")}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-center">
                    <button onClick={() => removeRow(ri)} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
