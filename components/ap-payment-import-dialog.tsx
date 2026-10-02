"use client"

// ไดอะล็อก "นำเข้าการจ่าย" (ฝ่ายการเงิน · ปุ่มบนหัวหน้า /ap-tracking · เพิ่ม 02/10/2026)
// ไฟล์ "รายงานจ่ายชำระเจ้าหนี้" → พรีวิว (dryRun) → ยืนยัน = จ่ายแล้ว + เลข PV + วันจ่าย
// ไฟล์ใบปะหน้ารอบโอนแบบเดิม (ไม่มีหัวคอลัมน์รายงานจ่ายชำระ) → ส่งต่อให้ ApPaidRoundDialog ผ่าน onRoundFile
// โครงเดียวกับ ap-voucher-import-dialog: แท็บตามกลุ่ม · ชิปเดือน (จากเลข DD) · สรุปรายเดือน · Export Excel
import { useMemo, useState } from "react"
import { FileDown, FileSpreadsheet, Search, Upload, X } from "lucide-react"
import { isApPaymentReport, parseApPaymentReport, type ApPaymentSheet } from "@/lib/ap-payment-report-import"
import { AP_STAGES, thaiDate } from "@/lib/ap-tracking"
import { ddMonth, ddMonthLabel as monthLabel, sortDdMonths } from "@/lib/ap-dd-month"
import { NUM, baht, mitr } from "@/components/ap-style"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"

type Action = "pay" | "early" | "fillPv" | "addPv" | "create" | "rejected" | "saraburi" | "old"
type Result = {
  depositCode: string; action: Action; stage: string; supplier: string; warehouse: string; amount: number; receivedAt: string
  pvs: string[]; newPvs: string[]; payDate: string; payAmount: number; lapos: string[]; sharedWith: number; reason?: string
}
type Reply = {
  written?: number
  summary: Record<Action | "matched" | "dds" | "unmappedRows" | "payAmount", number> & { unmapped: Record<string, number> }
  results: Result[]
}
type View = "list" | "matrix"

const TABS: { key: Action; label: string; hint: string; cls: string }[] = [
  { key: "pay",      label: "ผ่าน → จ่ายแล้ว",          hint: "บัญชีผ่านแล้ว การเงินจ่ายแล้ว → จ่ายแล้ว + เลข PV + วันจ่าย",                cls: "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-700/60 dark:bg-teal-900/20 dark:text-teal-300" },
  { key: "early",    label: "จ่ายก่อนผ่าน",             hint: "จ่ายแล้วแต่ในเว็บยังไม่ผ่าน → บันทึกจ่ายแล้ว + ติดธง 'จ่ายก่อนผ่าน'",         cls: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-300" },
  { key: "fillPv",   label: "เติมเลข PV",               hint: "จ่ายแล้วจากไฟล์รอบโอน (ไม่มี PV) → เติมเลข PV",                            cls: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700/60 dark:bg-sky-900/20 dark:text-sky-300" },
  { key: "addPv",    label: "PV งวดใหม่",               hint: "จ่ายแล้ว มีเลข PV งวดใหม่ในไฟล์ → เติมเพิ่ม (วันจ่าย = งวดล่าสุด)",           cls: "border-sky-300 bg-white text-sky-700 dark:border-sky-700/60 dark:bg-transparent dark:text-sky-300" },
  { key: "create",   label: "สร้างใหม่ + จ่ายแล้ว",      hint: "ยังไม่มีข้อมูลติดตาม (ไม่ใช่สระบุรี) → สร้างให้แล้วบันทึกจ่ายแล้ว",            cls: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700/60 dark:bg-violet-900/20 dark:text-violet-300" },
  { key: "rejected", label: "ไม่ผ่านอยู่",              hint: "บัญชีตีกลับอยู่ — ข้าม",                                                    cls: "border-rose-300 bg-white text-rose-700 dark:border-rose-700/60 dark:bg-transparent dark:text-rose-300" },
  { key: "saraburi", label: "สระบุรี (นอกขอบเขต)",      hint: "คลังสระบุรีไม่ได้ติดตามในระบบนี้ — ข้าม",                                    cls: "border-gray-200 bg-white text-gray-500 dark:border-white/10 dark:bg-transparent dark:text-gray-400" },
  { key: "old",      label: "ก่อนปี 69 / ไม่พบใน ATMS", hint: "เลข DD ไม่มีใน ATMS (ข้อมูล ATMS เริ่มปี 69) — ข้าม",                       cls: "border-gray-200 bg-white text-gray-500 dark:border-white/10 dark:bg-transparent dark:text-gray-400" },
]
const SHOW_MAX = 300
const stageLabel = (k: string) => AP_STAGES.find((s) => s.key === k)?.label ?? (k || "—")

export function ApPaymentImportDialog({ onClose, onDone, onRoundFile }: {
  onClose: () => void
  onDone: () => void
  onRoundFile: (file: File) => void       // ไฟล์ใบปะหน้ารอบโอนแบบเดิม → ให้หน้าเปิดไดอะล็อกเดิมต่อ
}) {
  const [fileName, setFileName] = useState("")
  const [sheet, setSheet] = useState<ApPaymentSheet | null>(null)
  const [reply, setReply] = useState<Reply | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [tab, setTab] = useState<Action>("pay")
  const [q, setQ] = useState("")
  const [month, setMonth] = useState<string | null>(null)
  const [view, setView] = useState<View>("list")
  const [saving, setSaving] = useState(false)

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setSheet(null); setReply(null); setError(""); setFileName(file.name); setQ(""); setTab("pay"); setMonth(null); setView("list")
    setBusy(true)
    try {
      const XLSX = await import("xlsx")
      const wb = XLSX.read(await file.arrayBuffer())
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" })
      // ไม่ใช่รายงานจ่ายชำระ = น่าจะเป็นใบปะหน้ารอบโอนแบบเดิม — ไดอะล็อกเดิมตรวจรูปแบบและบอกเหตุผลเองถ้าไม่ใช่
      if (!isApPaymentReport(rows)) { onRoundFile(file); return }
      const parsed = parseApPaymentReport(rows)
      setSheet(parsed)
      if (parsed.errors.length) return
      const res = await fetch("/api/ap-tracking/payment-import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true, fileName: file.name, items: parsed.items }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "ตรวจสอบไม่สำเร็จ")
      setReply(data as Reply)
      const first = TABS.find((t) => (data as Reply).summary[t.key] > 0)
      if (first) setTab(first.key)
    } catch (e) {
      setError(e instanceof Error ? e.message : "อ่านไฟล์ไม่สำเร็จ")
    } finally {
      setBusy(false)
    }
  }

  const monthsByTab = useMemo(() => {
    const m = new Map<Action, string[]>()
    if (reply) for (const t of TABS) m.set(t.key, reply.results.filter((r) => r.action === t.key).map((r) => ddMonth(r.depositCode)))
    return m
  }, [reply])
  const allMonths = useMemo(() => sortDdMonths([...monthsByTab.values()].flat()), [monthsByTab])
  const countIn = (k: Action, mon: string | null) => {
    const arr = monthsByTab.get(k) ?? []
    return mon === null ? arr.length : arr.filter((x) => x === mon).length
  }
  const openCell = (k: Action, mon: string | null) => { setTab(k); setMonth(mon); setView("list") }

  const rx = useMemo(() => (q.trim() ? new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null), [q])
  const rows = useMemo(() => (reply?.results ?? []).filter((r) =>
    r.action === tab && (month === null || ddMonth(r.depositCode) === month)
    && (!rx || rx.test(r.depositCode) || rx.test(r.supplier) || rx.test(r.pvs.join(" ")) || rx.test(r.lapos.join(" ")))), [reply, tab, month, rx])
  const meta = TABS.find((t) => t.key === tab)!

  async function exportExcel() {
    if (!reply) return
    const XLSX = await import("xlsx")
    const wb = XLSX.utils.book_new()
    const add = (name: string, data: Record<string, unknown>[], widths: number[]) => {
      if (!data.length) return
      const ws = XLSX.utils.json_to_sheet(data)
      ws["!cols"] = widths.map((w) => ({ wch: w }))
      XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]]/g, "-").slice(0, 31))
    }
    const summary = allMonths.map((mon) => ({ "เดือน (จาก DD)": monthLabel(mon), "YYMM": mon, ...Object.fromEntries(TABS.map((t) => [t.label, countIn(t.key, mon)])) }))
    summary.push({ "เดือน (จาก DD)": "รวม", "YYMM": "", ...Object.fromEntries(TABS.map((t) => [t.label, countIn(t.key, null)])) })
    add("สรุปรายเดือน", summary, [16, 7, ...TABS.map(() => 14)])
    for (const t of TABS) {
      add(t.label, reply.results.filter((r) => r.action === t.key).map((r) => ({
        "เดือน (จาก DD)": monthLabel(ddMonth(r.depositCode)), "เลขใบรับของ": r.depositCode, "ซัพพลายเออร์": r.supplier, "คลัง": r.warehouse,
        "ยอดใบ DD": r.supplier ? r.amount : "", "วันที่รับของ": r.receivedAt, "เลข PV": r.pvs.join(", "), "PV ใหม่": r.newPvs.join(", "),
        "วันจ่าย": r.payDate, "ยอดจ่าย (ตามเลขตั้งหนี้)": r.payAmount, "เลขที่ Voucher/ตั้งหนี้": r.lapos.join(", "),
        "ตั้งหนี้รวมกับใบอื่น": r.sharedWith || "", "ขั้นตอนปัจจุบัน": stageLabel(r.stage),
        "หลังนำเข้า": ["pay", "early", "create"].includes(r.action) ? "จ่ายแล้ว" : ["fillPv", "addPv"].includes(r.action) ? "เติม PV" : "ไม่เปลี่ยน",
        "หมายเหตุ": r.reason ?? "",
      })), [12, 15, 32, 16, 12, 12, 26, 16, 12, 14, 26, 10, 14, 11, 40])
    }
    XLSX.writeFile(wb, `นำเข้าการจ่าย_ผลตรวจ_${new Date().toLocaleDateString("sv-SE")}.xlsx`)
  }

  const writeCount = reply ? reply.summary.pay + reply.summary.early + reply.summary.create : 0
  const pvCount = reply ? reply.summary.fillPv + reply.summary.addPv : 0

  // ยืนยัน = เขียนจริงด้วยสูตรเดียวกับพรีวิว แล้วแสดงผลหลังเขียน (ใบที่บันทึกแล้วหายจากกลุ่ม — ไปอยู่ "ตรงแล้ว")
  const confirmPaid = async () => {
    if (!sheet || !reply || saving || !(writeCount + pvCount)) return
    const ok = await swalConfirm(`บันทึกจ่ายแล้ว ${writeCount.toLocaleString()} ใบ + เติม PV ${pvCount.toLocaleString()} ใบ?`,
      reply.summary.early ? `มี ${reply.summary.early} ใบที่จ่ายก่อนบัญชีผ่าน — จะติดธง "จ่ายก่อนผ่าน"` : undefined)
    if (!ok.isConfirmed) return
    setSaving(true)
    try {
      const res = await fetch("/api/ap-tracking/payment-import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, fileName, items: sheet.items }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "บันทึกไม่สำเร็จ")
      setReply(data as Reply)
      onDone()
      swalToast("success", `บันทึกแล้ว ${(data as Reply).written ?? 0} ใบ`)
    } catch (e) {
      swalError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-6xl flex-col gap-3 overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-4 dark:border-white/10 dark:bg-[#161a23]">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-[#14271C] dark:text-white" style={mitr}>นำเข้าการจ่าย</h2>
          <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[11px] font-semibold text-teal-800 dark:bg-teal-900/40 dark:text-teal-200">การเงิน</span>
          <button onClick={onClose} aria-label="ปิด" className="ml-auto rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          ไฟล์ <b>รายงานจ่ายชำระเจ้าหนี้</b> จากระบบบัญชี · เลข PV = DocuNo · วันจ่าย = DocuDate · หาใบ DD จาก<b>เลขตั้งหนี้ (DocuNo_inv)</b>
          ที่บันทึกไว้ในระบบ + เลข DD ในช่อง InvNo · ใบที่ <b>ผ่าน</b> แล้วและอยู่ในไฟล์ → <b>จ่ายแล้ว</b>
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
            <Upload className="h-4 w-4" />เลือกไฟล์ Excel
            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={busy} onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = "" }} />
          </label>
          {fileName && <span className="flex items-center gap-1 text-xs text-gray-500"><FileSpreadsheet className="h-3.5 w-3.5" />{fileName}</span>}
          {busy && <span className="text-xs text-gray-500">กำลังอ่านและตรวจกับระบบ…</span>}
        </div>

        {sheet && !sheet.errors.length && (
          <div className={`flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-300 ${NUM}`}>
            <span>แถวในไฟล์ {sheet.stats.rows.toLocaleString()}</span>
            <span>PV {sheet.stats.pvs.toLocaleString()} ใบ</span>
            <span>เลขตั้งหนี้ {sheet.stats.lapos.toLocaleString()}</span>
            {sheet.stats.dateFrom && <span>จ่าย {thaiDate(sheet.stats.dateFrom)} – {thaiDate(sheet.stats.dateTo)}</span>}
            {reply && <span>ใบ DD ที่โยงได้ <b>{reply.summary.dds.toLocaleString()}</b></span>}
            {reply && <span className="text-gray-400">ซ่อนใบที่ PV ตรงอยู่แล้ว {reply.summary.matched.toLocaleString()} · แถวที่ไม่ใช่การจ่ายใบ DD {reply.summary.unmappedRows.toLocaleString()} (ค่าเช่า/สำนักงานใหญ่/ใบลดหนี้ ฯลฯ)</span>}
          </div>
        )}

        {(error || (sheet?.errors.length ?? 0) > 0) && (
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">
            {error && <div>• {error}</div>}
            {sheet?.errors.map((e) => <div key={e}>• {e}</div>)}
          </div>
        )}

        {reply && (
          <>
            <div className="flex items-center gap-1 self-start rounded-lg bg-gray-100 p-0.5 text-sm dark:bg-white/10">
              {([["list", "รายการ"], ["matrix", "สรุปรายเดือน"]] as [View, string][]).map(([k, label]) => (
                <button key={k} onClick={() => setView(k)}
                  className={`rounded-md px-3 py-1 ${view === k ? "bg-white font-semibold text-[#14271C] shadow-sm dark:bg-[#161a23] dark:text-white" : "text-gray-500 dark:text-gray-400"}`}>{label}</button>
              ))}
            </div>

            {view === "matrix" && (
              <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 dark:border-white/10">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-gray-50/95 text-xs text-gray-500 dark:bg-[#1b202b] dark:text-gray-400">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">เดือน (จากเลข DD)</th>
                      {TABS.map((t) => <th key={t.key} className="px-3 py-2 text-right font-medium" title={t.hint}>{t.label}</th>)}
                    </tr>
                  </thead>
                  <tbody className={`divide-y divide-gray-100 dark:divide-white/5 ${NUM}`}>
                    {allMonths.map((mon) => (
                      <tr key={mon || "none"}>
                        <td className="whitespace-nowrap px-3 py-1.5 font-medium">{monthLabel(mon)}{mon && <span className="ml-1.5 text-xs text-gray-400">{mon}</span>}</td>
                        {TABS.map((t) => {
                          const n = countIn(t.key, mon)
                          return (
                            <td key={t.key} className="px-1 py-0.5 text-right">
                              {n ? (
                                <button onClick={() => openCell(t.key, mon)}
                                  className={`rounded-md px-2 py-1 hover:bg-gray-100 dark:hover:bg-white/10 ${t.key === "pay" ? "font-bold text-teal-700 dark:text-teal-300" : t.key === "early" ? "font-bold text-amber-700 dark:text-amber-300" : ""}`}>
                                  {n.toLocaleString()}
                                </button>
                              ) : <span className="px-2 text-gray-300 dark:text-gray-600">·</span>}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className={`sticky bottom-0 bg-gray-50/95 font-semibold dark:bg-[#1b202b] ${NUM}`}>
                    <tr>
                      <td className="px-3 py-2">รวม</td>
                      {TABS.map((t) => (
                        <td key={t.key} className="px-1 py-1 text-right">
                          <button onClick={() => openCell(t.key, null)} className="rounded-md px-2 py-1 hover:bg-gray-100 dark:hover:bg-white/10">{countIn(t.key, null).toLocaleString()}</button>
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {view === "list" && <>
              <div className="flex flex-wrap gap-2">
                {TABS.map((t) => {
                  const n = countIn(t.key, month)
                  return (
                    <button key={t.key} onClick={() => setTab(t.key)} title={t.hint}
                      className={`rounded-xl border px-3 py-1.5 text-left text-sm transition ${t.cls} ${tab === t.key ? "ring-2 ring-offset-1 ring-[#14271C]/40 dark:ring-white/40 dark:ring-offset-[#161a23]" : n ? "" : "opacity-50"}`}>
                      <div className="text-[11px] leading-tight opacity-80">{t.label}</div>
                      <div className={`text-base font-bold leading-tight ${NUM}`}>{n.toLocaleString()}</div>
                    </button>
                  )
                })}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-gray-500 dark:text-gray-400">เดือน (จากเลข DD)</span>
                {[null, ...allMonths].map((mon) => {
                  const n = countIn(tab, mon)
                  return (
                    <button key={mon ?? "all"} onClick={() => setMonth(mon)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${month === mon ? "border-[#14271C] bg-[#14271C] text-white dark:border-white dark:bg-white dark:text-[#14271C]" : n ? "border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5" : "border-gray-100 text-gray-300 dark:border-white/5 dark:text-gray-600"}`}>
                      {mon === null ? "ทุกเดือน" : monthLabel(mon)} <span className={NUM}>{n.toLocaleString()}</span>
                    </button>
                  )
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">{meta.hint}{month !== null ? ` · ${monthLabel(month)}` : ""}</span>
                <label className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1 text-sm dark:border-white/10">
                  <Search className="h-3.5 w-3.5 text-gray-400" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา DD / ซัพพลายเออร์ / PV / ตั้งหนี้" className="w-60 bg-transparent outline-none" />
                </label>
              </div>

              <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 dark:border-white/10">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-gray-50/95 text-xs text-gray-500 dark:bg-[#1b202b] dark:text-gray-400">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">เลขใบ</th>
                      <th className="px-3 py-2 text-left font-medium">ซัพพลายเออร์</th>
                      <th className="px-3 py-2 text-left font-medium">คลัง</th>
                      <th className="px-3 py-2 text-right font-medium">ยอดใบ</th>
                      <th className="px-3 py-2 text-left font-medium">เลข PV</th>
                      <th className="px-3 py-2 text-left font-medium">วันจ่าย</th>
                      <th className="px-3 py-2 text-left font-medium">เลขตั้งหนี้</th>
                      <th className="px-3 py-2 text-left font-medium">ขั้นตอน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                    {rows.slice(0, SHOW_MAX).map((r) => {
                      const toPaid = ["pay", "early", "create"].includes(r.action)
                      return (
                        <tr key={r.depositCode}>
                          <td className={`whitespace-nowrap px-3 py-1.5 font-medium ${NUM}`}>{r.depositCode}</td>
                          <td className="max-w-[15rem] truncate px-3 py-1.5 text-gray-600 dark:text-gray-300" title={r.supplier}>{r.supplier || "—"}</td>
                          <td className="max-w-[8rem] truncate px-3 py-1.5 text-xs text-gray-500">{r.warehouse}</td>
                          <td className={`whitespace-nowrap px-3 py-1.5 text-right ${NUM}`}>{r.supplier ? baht(r.amount) : "—"}</td>
                          <td className={`px-3 py-1.5 text-xs ${NUM}`}>
                            {r.pvs.map((p) => {
                              const isNew = r.newPvs.includes(p) && !["rejected", "saraburi", "old"].includes(r.action)
                              return (
                                <span key={p} className={`mr-1 inline-block rounded px-1.5 py-0.5 ${isNew ? "bg-teal-100 font-semibold text-teal-800 dark:bg-teal-900/30 dark:text-teal-300" : "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300"}`}>
                                  {isNew ? "+ " : ""}{p}
                                </span>
                              )
                            })}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5">{r.payDate ? thaiDate(r.payDate) : "—"}</td>
                          <td className={`px-3 py-1.5 text-xs text-gray-500 ${NUM}`} title={r.sharedWith ? `ตั้งหนี้รวมกับใบอื่นอีก ${r.sharedWith} ใบ · ยอดจ่าย ${baht(r.payAmount)}` : `ยอดจ่าย ${baht(r.payAmount)}`}>
                            {r.lapos.join(", ") || "—"}{r.sharedWith ? <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] dark:bg-white/10">+{r.sharedWith} ใบ</span> : null}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                            {toPaid
                              ? <span><span className="text-gray-600 dark:text-gray-300">{stageLabel(r.stage)}</span> → <b className="text-teal-700 dark:text-teal-300">จ่ายแล้ว</b>{r.action === "early" && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">จ่ายก่อนผ่าน</span>}</span>
                              : <span className="text-gray-600 dark:text-gray-300">{stageLabel(r.stage)}</span>}
                            {r.reason && r.action !== "early" && <div className="text-[11px] text-gray-500">{r.reason}</div>}
                          </td>
                        </tr>
                      )
                    })}
                    {!rows.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-gray-400">{q ? "ไม่พบตามคำค้น" : "ไม่มีรายการในกลุ่มนี้"}</td></tr>}
                  </tbody>
                </table>
                {rows.length > SHOW_MAX && (
                  <div className="border-t border-gray-100 px-3 py-2 text-center text-xs text-gray-500 dark:border-white/5">แสดง {SHOW_MAX} จาก {rows.length.toLocaleString()} รายการ — พิมพ์ค้นหาเพื่อกรอง</div>
                )}
              </div>
            </>}
          </>
        )}

        <div className="flex items-center gap-2">
          {reply && (
            <span className={`text-xs text-gray-500 ${NUM}`}>
              จะบันทึกจ่ายแล้ว <b className="text-teal-700 dark:text-teal-300">{writeCount.toLocaleString()}</b> ใบ
              {" · "}เติม PV <b>{(reply.summary.fillPv + reply.summary.addPv).toLocaleString()}</b> ใบ
              {reply.summary.early > 0 && <> · <span className="text-amber-700 dark:text-amber-300">จ่ายก่อนผ่าน {reply.summary.early}</span></>}
            </span>
          )}
          {reply && (
            <button onClick={() => void exportExcel()} title="ดาวน์โหลดผลตรวจทั้งชุด — ชีตสรุปรายเดือน + 1 ชีตต่อกลุ่ม"
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
              <FileDown className="h-4 w-4" />Export Excel
            </button>
          )}
          <button onClick={onClose} className={`${reply ? "" : "ml-auto "}rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5`}>ปิด</button>
          <button onClick={() => void confirmPaid()} disabled={!(writeCount + pvCount) || saving || busy}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
            {saving ? "กำลังบันทึก…" : `ยืนยันจ่ายแล้ว ${writeCount.toLocaleString()} ใบ${pvCount ? ` + PV ${pvCount.toLocaleString()}` : ""}`}
          </button>
        </div>
      </div>
    </div>
  )
}
