"use client"

// ไดอะล็อก "นำเข้าการตั้งเบิก" (ฝ่ายบัญชี · ปุ่มบนหัวหน้า /ap-tracking · เพิ่ม 02/10/2026)
// ไฟล์ = "รายงานตั้งเจ้าหนี้อื่นๆ" จากระบบบัญชี · อ่านในเบราว์เซอร์ ไม่อัปโหลดขึ้นเซิร์ฟเวอร์
// พรีวิว (dryRun) ก่อนเสมอ → ยืนยัน = ส่งบัญชีแล้ว → ผ่าน + เลข Voucher · ใบที่ไม่พบในไฟล์ให้บัญชีตอบทีละใบ
// (ไม่ผ่าน = PATCH review · รอรอบเครดิตถัดไป = PATCH nextRound) — API เดียวกับโมดัลรายใบ
import { useMemo, useState } from "react"
import { FileDown, FileSpreadsheet, Search, Upload, X } from "lucide-react"
import { parseApVoucherSheet, type ApVoucherSheet } from "@/lib/ap-voucher-import"
import { AP_STAGES, thaiDate } from "@/lib/ap-tracking"
import { NUM, baht, mitr } from "@/components/ap-style"
import { swalConfirm, swalError, swalTextInput, swalToast } from "@/lib/swal"
import { ddMonth, ddMonthLabel, sortDdMonths } from "@/lib/ap-dd-month"

type Action = "pass" | "notSent" | "rejected" | "notFound"
type Result = {
  depositCode: string; action: Action; stage: string; supplier: string; warehouse: string; amount: number
  receivedAt: string; vouchers: string[]; newVouchers: string[]; docDate: string; reason?: string
}
type Unmatched = {
  depositCode: string; supplier: string; warehouse: string; amount: number; receivedAt: string
  sentMarkedDate: string; sentType: string; afterFile: boolean
  nextRound?: { note: string; by: string; at: string }
}
type Reply = {
  written?: number
  summary: { total: number; pass: number; notSent: number; rejected: number; notFound: number; passed: number; paid: number; unmatched: number; unmatchedAfterFile: number; passAmount: number }
  results: Result[]
  unmatched: Unmatched[]
}
type Tab = Action | "unmatched" | "unreadable"

const TABS: { key: Tab; label: string; hint: string; cls: string }[] = [
  { key: "pass",       label: "จะผ่าน",               hint: "ส่งบัญชีแล้ว → ผ่าน + เติมเลข Voucher",                       cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-900/20 dark:text-emerald-300" },
  { key: "unmatched",  label: "ไม่พบในไฟล์",           hint: "ค้าง ส่งบัญชีแล้ว แต่ไม่มีในไฟล์ตั้งเบิก — รอบัญชีตอบ",         cls: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700/60 dark:bg-rose-900/20 dark:text-rose-300" },
  { key: "notSent",    label: "ยังไม่ส่งบัญชี",        hint: "บัญชีตั้งหนี้แล้ว แต่จัดซื้อยังไม่กดส่ง — ข้าม",               cls: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-300" },
  { key: "rejected",   label: "ไม่ผ่านอยู่",           hint: "บัญชีตีกลับอยู่ — ข้าม",                                       cls: "border-rose-300 bg-white text-rose-700 dark:border-rose-700/60 dark:bg-transparent dark:text-rose-300" },
  { key: "unreadable", label: "อ่านเลข DD ไม่ได้",     hint: "หน้าตาเหมือนเลข DD แต่ผิดรูปแบบ (7/9 หลัก, DDD, KDD) — ไม่เดาแก้ให้", cls: "border-amber-300 bg-white text-amber-700 dark:border-amber-700/60 dark:bg-transparent dark:text-amber-300" },
  { key: "notFound",   label: "ก่อนปี 69 / ไม่พบใน ATMS", hint: "เลข DD ในไฟล์ไม่มีใน ATMS (ข้อมูล ATMS เริ่มปี 69) — ข้าม",                                    cls: "border-gray-200 bg-white text-gray-500 dark:border-white/10 dark:bg-transparent dark:text-gray-400" },
]
const SHOW_MAX = 300
const stageLabel = (k: string) => AP_STAGES.find((s) => s.key === k)?.label ?? (k || "—")

const monthLabel = ddMonthLabel
type View = "list" | "matrix"

// คำตอบของบัญชีที่กดในไดอะล็อกนี้ (ทับค่าจากเซิร์ฟเวอร์จนกว่าจะโหลดใหม่)
type Answer = { kind: "reject"; note: string } | { kind: "nextRound"; note: string } | { kind: "cleared" }

export function ApVoucherImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [fileName, setFileName] = useState("")
  const [sheet, setSheet] = useState<ApVoucherSheet | null>(null)
  const [reply, setReply] = useState<Reply | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [tab, setTab] = useState<Tab>("pass")
  const [q, setQ] = useState("")
  const [month, setMonth] = useState<string | null>(null)   // null = ทุกเดือน · "" = ไม่ทราบเดือน
  const [view, setView] = useState<View>("list")
  const [saving, setSaving] = useState(false)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [changed, setChanged] = useState(false)          // มีการเขียนจริงแล้ว → ปิดไดอะล็อกแล้วรีเฟรชตาราง
  const close = () => { if (changed) onDone(); onClose() }

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setSheet(null); setReply(null); setError(""); setFileName(file.name); setQ(""); setTab("pass"); setMonth(null); setView("list"); setAnswers({})
    setBusy(true)
    try {
      const XLSX = await import("xlsx")
      const wb = XLSX.read(await file.arrayBuffer())
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" })
      const parsed = parseApVoucherSheet(rows)
      setSheet(parsed)
      if (parsed.errors.length) return
      const res = await fetch("/api/ap-tracking/voucher-import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true, fileName: file.name, fileTo: parsed.stats.dateTo, items: itemsOf(parsed) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "ตรวจสอบไม่สำเร็จ")
      setReply(data as Reply)
      // เปิดแท็บแรกที่มีของ — ไม่ให้คนเจอตารางว่างตั้งแต่แรก
      const d = data as Reply
      const first = (["pass", "unmatched"] as Tab[]).find((k) => (k === "unmatched" ? d.unmatched.length : d.summary[k as Action]) > 0)
      if (first) setTab(first)
    } catch (e) {
      setError(e instanceof Error ? e.message : "อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ Excel รายงานตั้งเจ้าหนี้")
    } finally {
      setBusy(false)
    }
  }

  const itemsOf = (sh: ApVoucherSheet) => sh.dds.map((d) => ({ depositCode: d.depositCode, vouchers: d.vouchers, docDate: d.docDate }))

  // ยืนยัน = เขียนจริง ด้วยสูตรเดียวกับพรีวิว (API ตัวเดียวกัน dryRun:false) แล้วแสดงผลหลังเขียนแทนพรีวิว
  const confirmPass = async () => {
    if (!sheet || !reply || saving || !reply.summary.pass) return
    const ok = await swalConfirm(`ยืนยันผ่าน ${reply.summary.pass.toLocaleString()} ใบ?`,
      "ใบที่ส่งบัญชีแล้วและพบในไฟล์ จะเปลี่ยนเป็น \"ผ่าน\" + เติมเลข Voucher (ยังไม่กำหนดวันจ่าย — กำหนดทีหลังในหน้าใบ)")
    if (!ok.isConfirmed) return
    setSaving(true)
    try {
      const res = await fetch("/api/ap-tracking/voucher-import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, fileName, fileTo: sheet.stats.dateTo, items: itemsOf(sheet) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "บันทึกไม่สำเร็จ")
      setReply(data as Reply)
      setChanged(true)
      onDone()
      swalToast("success", `ผ่านแล้ว ${(data as Reply).written ?? 0} ใบ`)
      if ((data as Reply).unmatched.length) setTab("unmatched")
    } catch (e) {
      swalError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ")
    } finally {
      setSaving(false)
    }
  }

  // คำตอบของบัญชีสำหรับใบที่ไม่พบในไฟล์ — ใช้ PATCH รายใบตัวเดียวกับโมดัล (ตรวจสิทธิ์ + ลงประวัติที่นั่น)
  const answer = async (u: Unmatched, kind: "reject" | "nextRound" | "clear") => {
    let body: Record<string, unknown>
    let next: Answer
    if (kind === "clear") {
      body = { nextRound: null }; next = { kind: "cleared" }
    } else {
      const r = await swalTextInput(kind === "reject"
        ? { title: "ไม่ผ่าน (ตีกลับ)", html: `<code>${u.depositCode}</code> · ${u.supplier}`, label: "เหตุผลที่ไม่ผ่าน (บังคับ)", placeholder: "เช่น ใบกำกับภาษีไม่ถูกต้อง", required: true, confirmText: "ยืนยันไม่ผ่าน", danger: true }
        : { title: "รอรอบเครดิตถัดไป", html: `<code>${u.depositCode}</code> · ${u.supplier}`, label: "หมายเหตุ (ไม่บังคับ)", placeholder: "เช่น เข้ารอบตั้งเบิกเดือนหน้า", confirmText: "บันทึก" })
      if (!r.isConfirmed) return
      const note = String(r.value ?? "").trim()
      body = kind === "reject" ? { review: { status: "ไม่ผ่าน", note } } : { nextRound: { note } }
      next = { kind, note }
    }
    try {
      const res = await fetch(`/api/ap-tracking/${encodeURIComponent(u.depositCode)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error || "บันทึกไม่สำเร็จ")
      setAnswers((a) => ({ ...a, [u.depositCode]: next }))
      setChanged(true)
    } catch (e) {
      swalError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ")
    }
  }
  const answerOf = (u: Unmatched): Answer | null =>
    answers[u.depositCode] ?? (u.nextRound ? { kind: "nextRound", note: u.nextRound.note } : null)

  // เดือนของทุกรายการในแต่ละแท็บ — ใช้ทั้งตัวนับแท็บ ชิปเดือน และตารางสรุปรายเดือน
  // "notFound" ฝั่ง API ส่งกลับเฉพาะใบที่ไม่พบใน ATMS (ใบนอกช่วงไม่ส่ง) จึงนับจากรายการที่มีจริง
  const monthsByTab = useMemo(() => {
    const m = new Map<Tab, string[]>()
    if (!reply) return m
    for (const t of TABS) {
      if (t.key === "unmatched") m.set(t.key, reply.unmatched.map((u) => ddMonth(u.depositCode)))
      else if (t.key === "unreadable") m.set(t.key, (sheet?.unreadable ?? []).map(() => ""))
      else m.set(t.key, reply.results.filter((r) => r.action === t.key).map((r) => ddMonth(r.depositCode)))
    }
    return m
  }, [reply, sheet])
  const allMonths = useMemo(() => {
    return sortDdMonths([...monthsByTab.values()].flat())
  }, [monthsByTab])
  const countIn = (k: Tab, mon: string | null): number => {
    const arr = monthsByTab.get(k) ?? []
    return mon === null ? arr.length : arr.filter((x) => x === mon).length
  }
  const countOf = (k: Tab): number => countIn(k, month)
  const openCell = (k: Tab, mon: string | null) => { setTab(k); setMonth(mon); setView("list") }

  const rx = useMemo(() => (q.trim() ? new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null), [q])
  const inMonth = (code: string) => month === null || ddMonth(code) === month
  const rows = useMemo(() => {
    if (!reply) return []
    if (tab === "unmatched") return reply.unmatched.filter((u) => inMonth(u.depositCode) && (!rx || rx.test(u.depositCode) || rx.test(u.supplier)))
    if (tab === "unreadable") return month !== null && month !== "" ? [] : (sheet?.unreadable ?? []).filter((u) => !rx || rx.test(u.token) || rx.test(u.docNo) || rx.test(u.remark))
    return reply.results.filter((r) => r.action === tab && inMonth(r.depositCode) && (!rx || rx.test(r.depositCode) || rx.test(r.supplier) || rx.test(r.vouchers.join(" "))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reply, sheet, tab, rx, month])
  const meta = TABS.find((t) => t.key === tab)!

  /** Excel ทั้งชุด (ทุกเดือน ไม่ขึ้นกับตัวกรองบนจอ) — ชีตสรุปรายเดือน + 1 ชีตต่อกลุ่ม
   *  คอลัมน์ "เดือน (จาก DD)" ทุกชีต เอาไปกรองต่อใน Excel ได้ · ชีต "ไม่พบในไฟล์" มีช่องว่างให้บัญชีกรอกคำตอบ
   *  วันที่เป็น YYYY-MM-DD ตามธรรมเนียม export อื่นของหน้านี้ (components/ap-export.ts) */
  async function exportExcel() {
    if (!reply) return
    const XLSX = await import("xlsx")
    const wb = XLSX.utils.book_new()
    const add = (name: string, data: Record<string, unknown>[], widths: number[]) => {
      if (!data.length) return
      const ws = XLSX.utils.json_to_sheet(data)
      ws["!cols"] = widths.map((w) => ({ wch: w }))
      // ชื่อชีตห้ามมี / \ ? * [ ] และยาวได้ไม่เกิน 31 ตัว
      XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]]/g, "-").slice(0, 31))
    }

    // สรุปรายเดือน — แถวละเดือน คอลัมน์ละกลุ่ม + แถวรวม
    const summary = allMonths.map((mon) => ({
      "เดือน (จาก DD)": monthLabel(mon), "YYMM": mon,
      ...Object.fromEntries(TABS.map((t) => [t.label, countIn(t.key, mon)])),
    }))
    summary.push({ "เดือน (จาก DD)": "รวม", "YYMM": "", ...Object.fromEntries(TABS.map((t) => [t.label, countIn(t.key, null)])) })
    add("สรุปรายเดือน", summary, [16, 7, ...TABS.map(() => 14)])

    for (const t of TABS) {
      if (t.key === "unmatched") {
        add(t.label, reply.unmatched.map((u) => ({
          "เดือน (จาก DD)": monthLabel(ddMonth(u.depositCode)), "เลขใบรับของ": u.depositCode, "ซัพพลายเออร์": u.supplier,
          "คลัง": u.warehouse, "ยอดเงิน": u.amount, "วันที่รับของ": u.receivedAt, "กดส่งบัญชีเมื่อ": u.sentMarkedDate,
          "ประเภทการส่ง": u.sentType, "หมายเหตุ": u.afterFile ? "กดส่งหลังวันตั้งหนี้ล่าสุดในไฟล์" : "",
          "คำตอบจากบัญชี (ไม่ผ่าน / รอรอบเครดิตถัดไป)": "", "เหตุผล": "",
        })), [12, 15, 32, 16, 12, 12, 14, 12, 26, 34, 30])
      } else if (t.key === "unreadable") {
        add(t.label, (sheet?.unreadable ?? []).map((u) => ({
          "ข้อความที่เจอ": u.token, "เลขที่ Voucher/ตั้งหนี้": u.docNo, "วันตั้งหนี้": u.docDate, "ผู้ตั้งหนี้": u.employee, "GoodRemark": u.remark,
        })), [18, 18, 12, 20, 70])
      } else {
        add(t.label, reply.results.filter((r) => r.action === t.key).map((r) => ({
          "เดือน (จาก DD)": monthLabel(ddMonth(r.depositCode)), "เลขใบรับของ": r.depositCode, "ซัพพลายเออร์": r.supplier,
          "คลัง": r.warehouse, "ยอดเงิน": r.supplier ? r.amount : "", "วันที่รับของ": r.receivedAt,
          "เลขที่ Voucher/ตั้งหนี้": r.vouchers.join(", "), "วันตั้งหนี้": r.docDate,
          "ขั้นตอนปัจจุบัน": stageLabel(r.stage), "หลังนำเข้า": r.action === "pass" ? "ผ่าน" : "ไม่เปลี่ยน", "หมายเหตุ": r.reason ?? "",
        })), [12, 15, 32, 16, 12, 12, 26, 12, 14, 11, 36])
      }
    }
    const today = new Date().toLocaleDateString("sv-SE")
    XLSX.writeFile(wb, `นำเข้าการตั้งเบิก_ผลตรวจ_${today}.xlsx`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-6xl flex-col gap-3 overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-4 dark:border-white/10 dark:bg-[#161a23]">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-[#14271C] dark:text-white" style={mitr}>นำเข้าการตั้งเบิก</h2>
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">บัญชี</span>
          <button onClick={close} aria-label="ปิด" className="ml-auto rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          ไฟล์ <b>รายงานตั้งเจ้าหนี้อื่นๆ</b> จากระบบบัญชี · ใช้เฉพาะแถวของ <b>อาทิติยา</b> และ <b>วราพร</b> ·
          ดึงเลข DD (KKDD/LBDD/SBDD + 8 หลัก) จากคอลัมน์ GoodRemark แล้วจับคู่ข้ามทุกเดือน ·
          ใบที่ค้าง <b>ส่งบัญชีแล้ว</b> และพบในไฟล์ → <b>ผ่าน</b> + เติมเลขที่ Voucher/ตั้งหนี้ (ยังไม่กำหนดวันจ่าย)
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
            <Upload className="h-4 w-4" />เลือกไฟล์ Excel
            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={busy}
              onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = "" }} />
          </label>
          {fileName && <span className="flex items-center gap-1 text-xs text-gray-500"><FileSpreadsheet className="h-3.5 w-3.5" />{fileName}</span>}
          {busy && <span className="text-xs text-gray-500">กำลังอ่านและตรวจกับระบบ…</span>}
        </div>

        {sheet && !sheet.errors.length && (
          <div className={`flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-300 ${NUM}`}>
            <span>แถวในไฟล์ {sheet.stats.rows.toLocaleString()}</span>
            {Object.entries(sheet.stats.byEmployee).map(([n, c]) => <span key={n}>{n} {c.toLocaleString()}</span>)}
            <span>เลข DD <b>{sheet.dds.length.toLocaleString()}</b> ใบ</span>
            <span>Voucher {sheet.stats.vouchers.toLocaleString()} ใบ</span>
            <span>ไม่มีเลข DD {sheet.stats.noDd.toLocaleString()} แถว (ข้าม)</span>
            {sheet.stats.dateFrom && <span>ตั้งหนี้ {thaiDate(sheet.stats.dateFrom)} – {thaiDate(sheet.stats.dateTo)}</span>}
            {reply && reply.summary.passed + reply.summary.paid > 0 && (
              <span className="text-gray-400">ซ่อนใบที่ผ่านแล้ว {reply.summary.passed.toLocaleString()} · จ่ายแล้ว {reply.summary.paid.toLocaleString()} ใบ</span>
            )}
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
                  className={`rounded-md px-3 py-1 ${view === k ? "bg-white font-semibold text-[#14271C] shadow-sm dark:bg-[#161a23] dark:text-white" : "text-gray-500 dark:text-gray-400"}`}>
                  {label}
                </button>
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
                        <td className="whitespace-nowrap px-3 py-1.5 font-medium">
                          {monthLabel(mon)}{mon && <span className="ml-1.5 text-xs text-gray-400">{mon}</span>}
                        </td>
                        {TABS.map((t) => {
                          const n = countIn(t.key, mon)
                          return (
                            <td key={t.key} className="px-1 py-0.5 text-right">
                              {n ? (
                                <button onClick={() => openCell(t.key, mon)} title={`เปิดรายการ ${t.label} · ${monthLabel(mon)}`}
                                  className={`rounded-md px-2 py-1 hover:bg-gray-100 dark:hover:bg-white/10 ${t.key === "pass" ? "font-bold text-emerald-700 dark:text-emerald-300" : t.key === "unmatched" ? "font-bold text-rose-700 dark:text-rose-300" : ""}`}>
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
                          <button onClick={() => openCell(t.key, null)} className="rounded-md px-2 py-1 hover:bg-gray-100 dark:hover:bg-white/10">
                            {countIn(t.key, null).toLocaleString()}
                          </button>
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
                const n = countOf(t.key)
                const on = tab === t.key
                return (
                  <button key={t.key} onClick={() => setTab(t.key)} title={t.hint}
                    className={`rounded-xl border px-3 py-1.5 text-left text-sm transition ${t.cls} ${on ? "ring-2 ring-offset-1 ring-[#14271C]/40 dark:ring-white/40 dark:ring-offset-[#161a23]" : n ? "" : "opacity-50"}`}>
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
                const on = month === mon
                return (
                  <button key={mon ?? "all"} onClick={() => setMonth(mon)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-[#14271C] bg-[#14271C] text-white dark:border-white dark:bg-white dark:text-[#14271C]" : n ? "border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5" : "border-gray-100 text-gray-300 dark:border-white/5 dark:text-gray-600"}`}>
                    {mon === null ? "ทุกเดือน" : monthLabel(mon)} <span className={NUM}>{n.toLocaleString()}</span>
                  </button>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">{meta.hint}{month !== null ? ` · ${monthLabel(month)}` : ""}</span>
              {tab === "unmatched" && reply.summary.unmatchedAfterFile > 0 && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-white/10 dark:text-gray-300">
                  {reply.summary.unmatchedAfterFile} ใบกดส่งหลังวันตั้งหนี้ล่าสุดในไฟล์ ({thaiDate(sheet?.stats.dateTo ?? "")}) — ปกติยังไม่ถึงรอบ
                </span>
              )}
              <label className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1 text-sm dark:border-white/10">
                <Search className="h-3.5 w-3.5 text-gray-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา DD / ซัพพลายเออร์ / Voucher"
                  className="w-56 bg-transparent outline-none" />
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 dark:border-white/10">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-gray-50/95 text-xs text-gray-500 dark:bg-[#1b202b] dark:text-gray-400">
                  {tab === "unreadable" ? (
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">ข้อความที่เจอ</th>
                      <th className="px-3 py-2 text-left font-medium">Voucher</th>
                      <th className="px-3 py-2 text-left font-medium">วันตั้งหนี้</th>
                      <th className="px-3 py-2 text-left font-medium">ผู้ตั้งหนี้</th>
                      <th className="px-3 py-2 text-left font-medium">GoodRemark</th>
                    </tr>
                  ) : tab === "unmatched" ? (
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">เลขใบ</th>
                      <th className="px-3 py-2 text-left font-medium">ซัพพลายเออร์</th>
                      <th className="px-3 py-2 text-left font-medium">คลัง</th>
                      <th className="px-3 py-2 text-right font-medium">ยอด</th>
                      <th className="px-3 py-2 text-left font-medium">กดส่งบัญชี</th>
                      <th className="px-3 py-2 text-left font-medium">ประเภท</th>
                      <th className="px-3 py-2 text-left font-medium">คำตอบจากบัญชี</th>
                    </tr>
                  ) : (
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">เลขใบ</th>
                      <th className="px-3 py-2 text-left font-medium">ซัพพลายเออร์</th>
                      <th className="px-3 py-2 text-left font-medium">คลัง</th>
                      <th className="px-3 py-2 text-right font-medium">ยอด</th>
                      <th className="px-3 py-2 text-left font-medium">เลขที่ Voucher/ตั้งหนี้</th>
                      <th className="px-3 py-2 text-left font-medium">วันตั้งหนี้</th>
                      <th className="px-3 py-2 text-left font-medium">ขั้นตอน</th>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                  {tab === "unreadable" && (rows as ApVoucherSheet["unreadable"]).slice(0, SHOW_MAX).map((u) => (
                    <tr key={`${u.token}|${u.docNo}`}>
                      <td className={`whitespace-nowrap px-3 py-1.5 font-medium text-amber-700 dark:text-amber-300 ${NUM}`}>{u.token}</td>
                      <td className={`whitespace-nowrap px-3 py-1.5 ${NUM}`}>{u.docNo}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{u.docDate ? thaiDate(u.docDate) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-gray-600 dark:text-gray-300">{u.employee}</td>
                      <td className="max-w-[28rem] truncate px-3 py-1.5 text-xs text-gray-500" title={u.remark}>{u.remark}</td>
                    </tr>
                  ))}
                  {tab === "unmatched" && (rows as Unmatched[]).slice(0, SHOW_MAX).map((u) => (
                    <tr key={u.depositCode} className={u.afterFile ? "opacity-60" : ""}>
                      <td className={`whitespace-nowrap px-3 py-1.5 font-medium ${NUM}`}>{u.depositCode}</td>
                      <td className="max-w-[16rem] truncate px-3 py-1.5 text-gray-600 dark:text-gray-300" title={u.supplier}>{u.supplier || "—"}</td>
                      <td className="max-w-[8rem] truncate px-3 py-1.5 text-xs text-gray-500">{u.warehouse}</td>
                      <td className={`whitespace-nowrap px-3 py-1.5 text-right ${NUM}`}>{baht(u.amount)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        {u.sentMarkedDate ? thaiDate(u.sentMarkedDate) : "—"}
                        {u.afterFile && <div className="text-[11px] text-gray-500">หลังไฟล์ — ยังไม่ถึงรอบ</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-xs">{u.sentType || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        {(() => {
                          const a = answerOf(u)
                          if (a?.kind === "reject") {
                            return <span className="text-xs font-medium text-rose-700 dark:text-rose-300" title={a.note}>✕ ไม่ผ่านแล้ว · {a.note}</span>
                          }
                          if (a?.kind === "nextRound") {
                            return (
                              <span className="flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300">
                                <span title={a.note}>⏳ รอรอบเครดิตถัดไป{a.note ? ` · ${a.note}` : ""}</span>
                                <button onClick={() => void answer(u, "clear")} className="text-gray-400 underline hover:text-gray-600">ยกเลิก</button>
                              </span>
                            )
                          }
                          return (
                            <div className="flex gap-1.5">
                              <button onClick={() => void answer(u, "reject")}
                                className="rounded-lg border border-rose-300 px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-700/60 dark:text-rose-300 dark:hover:bg-rose-900/20">ไม่ผ่าน</button>
                              <button onClick={() => void answer(u, "nextRound")}
                                className="rounded-lg border border-sky-300 px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-50 dark:border-sky-700/60 dark:text-sky-300 dark:hover:bg-sky-900/20">รอรอบเครดิตถัดไป</button>
                            </div>
                          )
                        })()}
                      </td>
                    </tr>
                  ))}
                  {tab !== "unreadable" && tab !== "unmatched" && (rows as Result[]).slice(0, SHOW_MAX).map((r) => (
                    <tr key={r.depositCode}>
                      <td className={`whitespace-nowrap px-3 py-1.5 font-medium ${NUM}`}>{r.depositCode}</td>
                      <td className="max-w-[16rem] truncate px-3 py-1.5 text-gray-600 dark:text-gray-300" title={r.supplier}>{r.supplier || "—"}</td>
                      <td className="max-w-[8rem] truncate px-3 py-1.5 text-xs text-gray-500">{r.warehouse}</td>
                      <td className={`whitespace-nowrap px-3 py-1.5 text-right ${NUM}`}>{r.supplier ? baht(r.amount) : "—"}</td>
                      <td className={`px-3 py-1.5 text-xs ${NUM}`}>
                        {r.vouchers.map((v) => (
                          <span key={v} className={`mr-1 inline-block rounded px-1.5 py-0.5 ${r.newVouchers.includes(v) ? "bg-emerald-100 font-semibold text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300"}`}>
                            {r.newVouchers.includes(v) ? "+ " : ""}{v}
                          </span>
                        ))}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5">{r.docDate ? thaiDate(r.docDate) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                        {r.action === "pass"
                          ? <span><span className="text-sky-700 dark:text-sky-300">ส่งบัญชีแล้ว</span> → <b className="text-emerald-700 dark:text-emerald-300">ผ่าน</b></span>
                          : <span className="text-gray-600 dark:text-gray-300">{stageLabel(r.stage)}</span>}
                        {r.reason && <div className="text-[11px] text-gray-500">{r.reason}</div>}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">{q ? "ไม่พบตามคำค้น" : "ไม่มีรายการในกลุ่มนี้"}</td></tr>
                  )}
                </tbody>
              </table>
              {rows.length > SHOW_MAX && (
                <div className="border-t border-gray-100 px-3 py-2 text-center text-xs text-gray-500 dark:border-white/5">
                  แสดง {SHOW_MAX} จาก {rows.length.toLocaleString()} รายการ — พิมพ์ค้นหาเพื่อกรอง
                </div>
              )}
            </div>
            </>}
          </>
        )}

        <div className="flex items-center gap-2">
          {reply && (
            <span className={`text-xs text-gray-500 ${NUM}`}>
              จะผ่าน <b className="text-emerald-700 dark:text-emerald-300">{reply.summary.pass}</b> ใบ · {baht(reply.summary.passAmount)} บาท
              {" · "}ไม่พบในไฟล์ <b className="text-rose-700 dark:text-rose-300">{reply.summary.unmatched}</b> ใบ
            </span>
          )}
          {reply && (
            <button onClick={() => void exportExcel()} title="ดาวน์โหลดผลตรวจทั้งชุด — ชีตสรุปรายเดือน + 1 ชีตต่อกลุ่ม"
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
              <FileDown className="h-4 w-4" />Export Excel
            </button>
          )}
          <button onClick={close} className={`${reply ? "" : "ml-auto "}rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5`}>ปิด</button>
          <button onClick={() => void confirmPass()} disabled={!reply?.summary.pass || saving || busy}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "กำลังบันทึก…" : `ยืนยันผ่าน ${(reply?.summary.pass ?? 0).toLocaleString()} ใบ`}
          </button>
        </div>
      </div>
    </div>
  )
}
