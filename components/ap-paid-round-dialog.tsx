"use client"

// ไดอะล็อก "นำเข้าการจ่ายจากไฟล์รอบโอน" (ปุ่มบนหัวหน้า /ap-tracking · เพิ่ม 13/09/2026)
// การเงินอัปโหลดไฟล์รอบโอน (= ใบปะหน้า สกท. ที่ระบบ export เอง) เพื่อยืนยันว่าใบไหนโอนแล้ว
//
// ไฟล์ถูกอ่านในเบราว์เซอร์ ไม่อัปโหลดขึ้นเซิร์ฟเวอร์ — ส่งไปเฉพาะเลขใบ/ยอด/เลขตั้งหนี้
// พรีวิวมาจาก API ตัวเดียวกับตอนเขียนจริง (dryRun) จึงไม่มีทางที่พรีวิวกับผลจริงคิดคนละสูตร
import { useState } from "react"
import { FileSpreadsheet, Upload, X } from "lucide-react"
import { swalToast } from "@/lib/swal"
import { parseApRoundSheet, type ApRoundSheet } from "@/lib/ap-round-import"
import { thaiDate } from "@/lib/ap-tracking"
import { NUM, baht, mitr } from "@/components/ap-style"

type RoundResult = {
  depositCode: string
  action: "write" | "skip" | "same"
  reason?: string
  warnings?: string[]
  supplier?: string
  fileAmount: number
  headAmount?: number
  stage?: string
}
type RoundReply = {
  dryRun: boolean
  roundDate: string
  written: number
  summary: { total: number; willWrite: number; already: number; skipped: number; warnings: number; amount: number }
  results: RoundResult[]
}

const ACTION_META: Record<RoundResult["action"], { label: string; cls: string }> = {
  write: { label: "จะบันทึกจ่ายแล้ว", cls: "text-teal-700 dark:text-teal-300" },
  same:  { label: "บันทึกไปแล้ว",     cls: "text-gray-400" },
  skip:  { label: "ข้าม",             cls: "text-amber-700 dark:text-amber-300" },
}

export function ApPaidRoundDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [fileName, setFileName]   = useState("")
  const [sheet, setSheet]         = useState<ApRoundSheet | null>(null)
  const [roundDate, setRoundDate] = useState("")
  const [reply, setReply]         = useState<RoundReply | null>(null)   // ผลพรีวิว (dryRun)
  const [saved, setSaved]         = useState<RoundReply | null>(null)   // ผลหลังเขียนจริง
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState("")

  const reset = () => { setSheet(null); setFileName(""); setRoundDate(""); setReply(null); setSaved(null); setError("") }

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    reset()
    setBusy(true)
    try {
      // xlsx เป็นก้อนใหญ่ — โหลดตอนเลือกไฟล์เท่านั้น (แพตเทิร์นเดียวกับปุ่ม export อื่นในหน้านี้)
      const XLSX = await import("xlsx")
      const wb = XLSX.read(await file.arrayBuffer())
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" })
      const parsed = parseApRoundSheet(rows)
      setSheet(parsed)
      setFileName(file.name)
      setRoundDate(parsed.roundDate)
    } catch {
      setError("อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ Excel (.xlsx/.xls) ของฟอร์มรอบโอน")
    } finally {
      setBusy(false)
    }
  }

  const send = async (dryRun: boolean) => {
    if (!sheet || !roundDate || busy) return
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/ap-tracking/paid-round", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roundDate, fileName, dryRun,
          items: sheet.dds.map((d) => ({ depositCode: d.depositCode, amount: d.amount, vouchers: d.vouchers })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "นำเข้าไม่สำเร็จ")
      if (dryRun) setReply(data as RoundReply)
      else {
        setSaved(data as RoundReply)
        swalToast("success", `บันทึกจ่ายแล้ว ${(data as RoundReply).written} ใบ`)
        onDone()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "นำเข้าไม่สำเร็จ")
    } finally {
      setBusy(false)
    }
  }

  const shown = saved ?? reply
  const canPreview = Boolean(sheet && !sheet.errors.length && roundDate && !saved)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-3 overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-4 dark:border-white/10 dark:bg-[#161a23]">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-[#14271C] dark:text-white" style={mitr}>นำเข้าการจ่ายจากไฟล์รอบโอน</h2>
          <button onClick={onClose} aria-label="ปิด" className="ml-auto rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          ไฟล์รอบโอนคือใบปะหน้าส่งเข้า สกท. ที่ระบบสร้างให้ ระบบจะจับคู่ด้วยเลขใบ DD ข้ามทุกเดือน
          และยืนยันเฉพาะใบที่บัญชีตรวจผ่านแล้วเท่านั้น · ไฟล์ถูกอ่านในเครื่องคุณ ไม่ได้อัปโหลดขึ้นเซิร์ฟเวอร์
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
            <Upload className="h-4 w-4" />เลือกไฟล์ Excel
            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={busy}
              onChange={(e) => void pickFile(e.target.files?.[0])} />
          </label>
          {fileName && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <FileSpreadsheet className="h-3.5 w-3.5" />{fileName}
            </span>
          )}
          {sheet && !sheet.errors.length && (
            <span className={`text-xs text-gray-500 ${NUM}`}>
              {sheet.dds.length} ใบ · {sheet.lineCount} บรรทัด · {baht(sheet.total)} บาท
            </span>
          )}
        </div>

        {sheet && sheet.errors.length > 0 && (
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">
            {sheet.errors.slice(0, 6).map((e) => <div key={e}>• {e}</div>)}
            {sheet.errors.length > 6 && <div>• และอีก {sheet.errors.length - 6} ข้อ</div>}
          </div>
        )}

        {sheet && !sheet.errors.length && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-gray-500">วันรอบโอน</span>
              <input type="date" value={roundDate} disabled={Boolean(saved)}
                onChange={(e) => { setRoundDate(e.target.value); setReply(null) }}
                className="rounded-lg border border-gray-200 px-2 py-1 dark:border-white/10 dark:bg-white/5" />
            </label>
            {!sheet.roundDate && (
              <span className="text-xs text-amber-700 dark:text-amber-300">ไฟล์ไม่มีบรรทัด &quot;รอบโอน&quot; — กรอกวันที่โอนเอง</span>
            )}
            {canPreview && (
              <button onClick={() => void send(true)} disabled={busy}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5">
                {busy ? "กำลังตรวจ…" : "ตรวจสอบกับระบบ"}
              </button>
            )}
          </div>
        )}

        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</div>}

        {shown && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-white/5">
            <span className="text-teal-700 dark:text-teal-300">
              {saved ? "บันทึกแล้ว" : "จะบันทึก"} <b className={NUM}>{saved ? shown.written : shown.summary.willWrite}</b> ใบ
              {" · "}<b className={NUM}>{baht(shown.summary.amount)}</b> บาท
            </span>
            {shown.summary.already > 0 && <span className="text-gray-500">บันทึกไปแล้ว {shown.summary.already} ใบ</span>}
            {shown.summary.skipped > 0 && <span className="text-amber-700 dark:text-amber-300">ข้าม {shown.summary.skipped} ใบ</span>}
            {shown.summary.warnings > 0 && <span className="text-amber-700 dark:text-amber-300">มีข้อควรดู {shown.summary.warnings} ใบ</span>}
          </div>
        )}

        {shown && (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 dark:border-white/10">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-gray-50/95 text-xs text-gray-500 dark:bg-[#1b202b] dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">เลขใบ</th>
                  <th className="px-3 py-2 text-left font-medium">ซัพพลายเออร์</th>
                  <th className="px-3 py-2 text-right font-medium">ยอดในไฟล์</th>
                  <th className="px-3 py-2 text-left font-medium">ผล</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {shown.results.map((r) => (
                  <tr key={r.depositCode}>
                    <td className={`whitespace-nowrap px-3 py-1.5 font-medium ${NUM}`}>{r.depositCode}</td>
                    <td className="max-w-[16rem] truncate px-3 py-1.5 text-gray-600 dark:text-gray-300">{r.supplier || "—"}</td>
                    <td className={`whitespace-nowrap px-3 py-1.5 text-right ${NUM}`}>{baht(r.fileAmount)}</td>
                    <td className="px-3 py-1.5">
                      <span className={ACTION_META[r.action].cls}>
                        {saved && r.action === "write" ? "บันทึกแล้ว" : ACTION_META[r.action].label}
                      </span>
                      {r.reason && <span className="text-xs text-gray-500"> · {r.reason}</span>}
                      {r.warnings?.map((w) => (
                        <div key={w} className="text-xs text-amber-700 dark:text-amber-300">⚠️ {w}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-2">
          {saved ? (
            <button onClick={onClose} className="ml-auto rounded-lg bg-[#14271C] px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-[#14271C]">
              ปิด
            </button>
          ) : (
            <>
              <span className="text-xs text-gray-400">
                {reply?.roundDate ? `รอบโอน ${thaiDate(reply.roundDate)}` : ""}
              </span>
              <button onClick={onClose} className="ml-auto rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
                ยกเลิก
              </button>
              <button onClick={() => void send(false)} disabled={busy || !reply || reply.summary.willWrite === 0}
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
                {busy ? "กำลังบันทึก…" : `ยืนยันจ่ายแล้ว ${reply?.summary.willWrite ?? 0} ใบ`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
