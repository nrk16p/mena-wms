"use client"

/** แท็บนำเข้าจากชีต — ใช้ช่วงทำคู่กับ Google Sheet: ดาวน์โหลด .xlsx จากชีต แล้วอัปโหลดที่นี่ */
import { useState } from "react"
import { Upload } from "lucide-react"
import { swalToast, swalConfirm } from "@/lib/swal"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Preview = Record<string, any>

export function SheetImport({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (mode: "preview" | "apply") => {
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("mode", mode)
      const res = await fetch("/api/tyre-sheet/import", { method: "POST", body: fd })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error ?? "นำเข้าไม่สำเร็จ")
      setPreview(d)
      if (mode === "apply") { swalToast("success", `นำเข้าแล้ว ${d.willInsertRows} แถว`); onDone() }
    } catch (e) {
      swalToast("error", (e as Error).message)
    } finally { setBusy(false) }
  }

  const apply = async () => {
    const ok = await swalConfirm("นำเข้าทับข้อมูลชุดเดิม?", "แถวที่นำเข้าครั้งก่อนจะถูกแทนที่ทั้งหมด แถวที่เพิ่มหรือแก้ใน WMS ไม่ถูกแตะ")
    if (ok.isConfirmed) run("apply")
  }

  const s = preview?.stats
  return (
    <div className="space-y-4 max-w-3xl">
      <div className="text-sm text-gray-600 dark:text-gray-300 space-y-2">
        <p>ช่วงที่ยังทำคู่กับ Google Sheet ให้เปิดชีต “[2026]ข้อมูลยางสระบุรี” แล้วกด ไฟล์ → ดาวน์โหลด → Microsoft Excel (.xlsx) จากนั้นเลือกไฟล์ที่นี่</p>
        <p>ระบบอ่านแท็บ ยางนอก 11R22.5 · ยางนอก 1000-20 · เตรียมข้อมูล · บันทึกการจัดเก็บยาง · ขายเหมา · options แถวที่นำเข้าครั้งก่อนจะถูกแทนที่ แต่แถวที่เพิ่มหรือแก้ใน WMS แล้วจะไม่ถูกทับ</p>
        <p>ค่าที่กรอกในชีตนำเข้าตามนั้น ยกเว้นวันที่ที่ชีตสลับวัน/เดือนเอง กับปี 2027 ที่พิมพ์ผิดในบันทึกการจัดเก็บ ระบบแก้ให้ และแถวที่ซ้ำกันทุกช่องจะเก็บไว้แถวเดียว</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null) }} className="text-sm" />
        <button onClick={() => run("preview")} disabled={!file || busy}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-white/15 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-40">
          ตรวจไฟล์ก่อน
        </button>
        <button onClick={apply} disabled={!file || busy || !preview}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
          <Upload className="w-4 h-4" /> นำเข้า
        </button>
      </div>
      {preview && s && (
        <div className="rounded-lg border border-gray-200 dark:border-white/10 p-4 text-sm space-y-1 bg-white dark:bg-white/[0.03]">
          <div className="font-semibold mb-1">{preview.mode === "apply" ? "นำเข้าแล้ว" : "ผลตรวจไฟล์ (ยังไม่ได้นำเข้า)"}</div>
          <div>แท็บที่เจอ: {s.sheetsFound.join(" · ")}</div>
          <div>แถวยาง: {Object.entries(s.bySize).map(([k, v]) => `${k} ${v}`).join(" · ")} · เตรียมข้อมูล {s.prep}</div>
          <div>จะนำเข้า {preview.willInsertRows} แถว · แทนที่ของเดิม {preview.replacesPreviousImport} แถว · แถวที่แก้ใน WMS แล้วเก็บไว้ {preview.keptEditedRows} · แถวที่สร้างใน WMS {preview.wmsRowsUntouched} ไม่แตะ</div>
          <div>บันทึกการจัดเก็บ {preview.storage} แถว · ขายเหมา {preview.sales} แถว{preview.options ? ` · dropdown: พจส. ${preview.options.drivers} · ทะเบียน ${preview.options.plates} · ตำแหน่ง ${preview.options.positions}` : ""}</div>
          <div className="text-gray-500">แก้วันที่สลับวัน/เดือน {s.installDatesSwapped} แถว · แก้วันที่ในบันทึกจัดเก็บ {s.storageDatesFixed} แถว · ตัดแถวซ้ำทุกช่อง {s.exactDuplicatesSkipped} แถว</div>
        </div>
      )}
    </div>
  )
}
