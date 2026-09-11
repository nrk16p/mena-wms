"use client"

// แท็บ "สรุป DD" (เพิ่ม 11/09/2026) — เจ้าหนี้ถามสถานะใบรับของมาเป็นชุด ผู้ใช้วางเลข DD แล้วได้
// ตาราง 9 คอลัมน์ + ข้อความพร้อมอีโมจิไว้วางในไลน์ตอบกลับ
// ดึงผ่าน /api/ap-tracking?codes= — enrichment ชุดเดียวกับตารางหลัก (ทะเบียน/เบอร์รถ/เครดิตเทอม/กำหนดจ่าย/
// จ่ายจริง) ตัวเลขจึงตรงกับที่หน้าหลักโชว์เสมอ · ไม่ยึดเดือน/คลัง/คำค้นของหน้า เพราะเลขที่วางมาข้ามเดือนได้
import { useMemo, useState } from "react"
import { ClipboardCopy, ListChecks, X } from "lucide-react"
import { swalToast } from "@/lib/swal"
import { AP_DD_SUMMARY_MAX, apDdSummaryText, parseDdList, thaiDate, todayICT, type ApDdSummaryItem } from "@/lib/ap-tracking"
import { CARD, NUM, baht } from "@/components/ap-style"
import type { ApRow } from "@/components/ap-types"

const toItem = (r: ApRow): ApDdSummaryItem => ({
  depositCode: r.depositCode, receivedAt: r.receivedAt, supplier: r.supplier,
  vehicle: r.vehicle, fleetNo: r.fleetNo, amount: r.amount, creditTerm: r.creditTerm,
  payDate: r.pay?.payDate, paidDate: r.paid?.date,
})

// ตารางโชว์ "–" ให้เห็นว่าช่องนี้ว่างจริง ไม่ใช่โหลดไม่ขึ้น · ข้อความไลน์ตัดบรรทัดทิ้งแทน (ดู apDdSummaryText)
const dash = <span className="text-gray-300 dark:text-gray-600">–</span>
const isIso = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "")
const TH_CLS = "whitespace-nowrap px-3 py-2.5 font-medium"
const TD_CLS = "whitespace-nowrap px-3 py-2"

export function ApDdSummaryPanel() {
  const [text, setText]       = useState("")
  const [result, setResult]   = useState<{ codes: string[]; rows: ApRow[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState("")

  const codes   = useMemo(() => parseDdList(text), [text])
  const tooMany = codes.length > AP_DD_SUMMARY_MAX
  // แก้ข้อความหลังกดสรุปแล้ว — ผลข้างล่างเป็นของชุดเก่า ต้องบอกให้กดใหม่ ไม่งั้นคัดลอกของเก่าไปส่ง
  const stale   = Boolean(result) && codes.join(",") !== result!.codes.join(",")

  const run = async () => {
    if (!codes.length || tooMany || loading) return
    setLoading(true)
    setError("")
    try {
      const res  = await fetch(`/api/ap-tracking?codes=${encodeURIComponent(codes.join(","))}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "โหลดข้อมูลไม่สำเร็จ")
      setResult({ codes, rows: (data.rows ?? []) as ApRow[] })
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ")
    } finally {
      setLoading(false)
    }
  }

  // เรียงตามลำดับที่วาง (API คืนเรียงตามวันรับของ) — เจ้าหนี้ถามมาเรียงแบบไหน ตอบกลับเรียงแบบนั้น
  // เลขที่หาไม่เจอแยกออกมาให้คนกดเห็น แต่ไม่ใส่ในข้อความไลน์
  const { found, missing } = useMemo(() => {
    if (!result) return { found: [] as ApRow[], missing: [] as string[] }
    const by = new Map(result.rows.map((r) => [r.depositCode, r]))
    return {
      found: result.codes.flatMap((c) => (by.has(c) ? [by.get(c)!] : [])),
      missing: result.codes.filter((c) => !by.has(c)),
    }
  }, [result])
  const total    = found.reduce((n, r) => n + r.amount, 0)
  const lineText = useMemo(() => apDdSummaryText(found.map(toItem), todayICT()), [found])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lineText)
      swalToast("success", "คัดลอกแล้ว — วางในไลน์ได้เลย")
    } catch {
      setError("คัดลอกไม่สำเร็จ — ลองกดใหม่อีกครั้ง หรือคัดลอกจากกล่องตัวอย่างข้อความ")
    }
  }

  const clear = () => { setText(""); setResult(null); setError("") }

  return (
    <div className="space-y-3">
      <div className={`${CARD} space-y-2 p-3`}>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-semibold text-[#14271C] dark:text-white">สรุป DD สำหรับเจ้าหนี้</h2>
          <span className="text-xs text-gray-400">วางเลขใบรับของ (DD) ได้หลายใบ — บรรทัดละใบ หรือคั่นด้วยช่องว่าง/คอมมาก็ได้</span>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} aria-label="เลข DD ที่ต้องการสรุป"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run() } }}
          placeholder={"LBDD26081175\nLBDD26081169\nLBDD26081223"}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm dark:border-white/10 dark:bg-white/5" />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void run()} disabled={!codes.length || tooMany || loading}
            className="flex items-center gap-1.5 rounded-lg bg-[#14271C] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1f3a2a] disabled:opacity-50 dark:bg-white dark:text-[#14271C]">
            <ListChecks className="h-4 w-4" />{loading ? "กำลังสรุป…" : "สรุป"}
          </button>
          {text && (
            <button onClick={clear}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
              <X className="h-4 w-4" />ล้าง
            </button>
          )}
          <span className={`text-xs ${tooMany ? "text-rose-600" : "text-gray-400"} ${NUM}`}>
            {tooMany ? `${codes.length} ใบ — เกิน ${AP_DD_SUMMARY_MAX} ใบ แบ่งวางทีละไม่เกิน ${AP_DD_SUMMARY_MAX} ใบ`
              : codes.length ? `พบเลข DD ${codes.length} ใบ${stale ? " — ข้อความเปลี่ยนแล้ว กดสรุปใหม่" : ""}`
              : text ? "ไม่พบเลข DD ในข้อความ" : ""}
          </span>
        </div>
        {error && (
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</div>
        )}
      </div>

      {result && (
        <div className={`${CARD} space-y-3 p-3 ${stale ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>พบ <b className={NUM}>{found.length}</b> จาก <span className={NUM}>{result.codes.length}</span> ใบ</span>
            {found.length > 0 && <span className="text-gray-500">· รวม <b className={`text-gray-900 dark:text-white ${NUM}`}>{baht(total)}</b></span>}
            <button onClick={() => void copy()} disabled={!found.length}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-[#06C755] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#05b34c] disabled:opacity-50">
              <ClipboardCopy className="h-4 w-4" />คัดลอกไปวางไลน์
            </button>
          </div>

          {missing.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              ⚠️ ไม่พบในระบบ {missing.length} ใบ (ไม่อยู่ในข้อความไลน์): <span className="font-mono">{missing.join(", ")}</span>
            </div>
          )}

          {found.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-white/10">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50/80 text-xs text-gray-500 dark:bg-white/5 dark:text-gray-400">
                  <tr>
                    <th className={`${TH_CLS} text-left`}>เลขใบรับของ</th>
                    <th className={`${TH_CLS} text-left`}>วันที่รับของ</th>
                    <th className={`${TH_CLS} text-left`}>ซัพพลายเออร์</th>
                    <th className={`${TH_CLS} text-left`}>ทะเบียนรถ</th>
                    <th className={`${TH_CLS} text-left`}>เบอร์รถ</th>
                    <th className={`${TH_CLS} text-right`}>ยอดเงิน</th>
                    <th className={`${TH_CLS} text-left`}>เครดิตเทอม</th>
                    <th className={`${TH_CLS} text-left`}>กำหนดจ่าย</th>
                    <th className={`${TH_CLS} text-left`}>จ่ายจริง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                  {found.map((r) => (
                    <tr key={r.depositCode} className="hover:bg-gray-50/60 dark:hover:bg-white/5">
                      <td className={`${TD_CLS} font-medium ${NUM}`}>{r.depositCode}</td>
                      <td className={TD_CLS}>{isIso(r.receivedAt) ? thaiDate(r.receivedAt) : dash}</td>
                      <td className="px-3 py-2">{r.supplier || dash}</td>
                      <td className={TD_CLS}>{r.vehicle || dash}</td>
                      <td className={TD_CLS}>{r.fleetNo || dash}</td>
                      <td className={`${TD_CLS} text-right ${NUM}`}>{baht(r.amount)}</td>
                      <td className={TD_CLS}>{r.creditTerm || dash}</td>
                      <td className={TD_CLS}>{isIso(r.pay?.payDate) ? thaiDate(r.pay!.payDate) : dash}</td>
                      <td className={TD_CLS}>
                        {isIso(r.paid?.date) ? <span className="text-emerald-700 dark:text-emerald-400">✅ {thaiDate(r.paid!.date)}</span> : dash}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-gray-200 bg-gray-50/60 text-sm dark:border-white/10 dark:bg-white/5">
                  <tr>
                    <td className={`${TD_CLS} font-medium`} colSpan={5}>รวม {found.length} ใบ</td>
                    <td className={`${TD_CLS} text-right font-semibold ${NUM}`}>{baht(total)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {found.length > 0 && (
            <details open className="text-xs">
              <summary className="cursor-pointer select-none text-gray-500">ตัวอย่างข้อความที่จะคัดลอก</summary>
              <pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 font-sans text-sm leading-relaxed dark:bg-white/5">{lineText}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
