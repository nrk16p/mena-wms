"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"
import {
  AP_GO_LIVE, apUrgency, isDocSetComplete, monthInApScope, needsAccountingReview,
  nextThursday, overdueDays, thaiDate, todayICT,
  type ApDocs, type ApStatus,
} from "@/lib/ap-tracking"
import { CARD, NUM, baht, mitr } from "@/components/ap-style"
import { ApSummaryBar } from "@/components/ap-summary"
import { ApTable } from "@/components/ap-table"
import { ApTrackingDetail } from "@/components/ap-tracking-detail"
import type { ApQuickView, ApRow, ApSummary } from "@/components/ap-types"

export type { ApRow } from "@/components/ap-types"

// 0 = ทั้งหมด (ไว้ใช้ตอนอยากกด Ctrl+F หาทั้งเดือน หรือปรินต์) — แถวทั้งชุดโหลดมาอยู่ในหน่วยความจำแล้ว
// การแบ่งหน้าเป็นแค่การตัดชิ้นตอนแสดงผล ไม่ยิงคิวรีใหม่ ยอดสรุปด้านบนจึงยังคิดจากทั้งช่วงเหมือนเดิม
const PER_PAGE_OPTIONS = [25, 50, 100, 0] as const
// วันนี้ตามเวลาไทยเสมอ (เครื่องผู้ใช้อาจตั้ง TZ อื่น / เซิร์ฟเวอร์รัน UTC) — กันวันเลื่อนช่วง 00:00–07:00
const thisMonth = () => todayICT().slice(0, 7)

// ย้าย 1 แถวระหว่างบัคเก็ตสถานะของ summary ที่เซิร์ฟเวอร์ส่งมา — ใช้ตอนติ๊กแล้วสถานะเปลี่ยน
// ไม่ใช่การคำนวณยอดสรุปซ้ำ: ตัวเลขตั้งต้นและสถานะปลายทางมาจากเซิร์ฟเวอร์ทั้งคู่ แค่บวก/ลบ 1 แถว
const moveStatusBucket = (sm: ApSummary | null, from: ApStatus, to: ApStatus, amount: number): ApSummary | null => {
  if (!sm || from === to || !sm.byStatus?.[from] || !sm.byStatus?.[to]) return sm
  const byStatus = { ...sm.byStatus }
  byStatus[from] = { n: byStatus[from].n - 1, amount: byStatus[from].amount - amount }
  byStatus[to]   = { n: byStatus[to].n + 1,   amount: byStatus[to].amount + amount }
  return { ...sm, byStatus }
}

// ค้นหาให้ครอบคลุมเท่าฝั่ง API (รวมเลขที่บิลของซัพพลายเออร์) ไม่งั้นค้นด้วยเลขบิลแล้วเหมือนไม่เจอ
const matchQ = (r: ApRow, rx: RegExp) =>
  rx.test(r.depositCode) || rx.test(r.purchaseOrder) || rx.test(r.supplier) || rx.test(r.supplierRefNo)

// กล่องเลือกวันส่งบัญชีของใบเดียว — เปิด/ปิดคือ mount/unmount ค่าจึงเริ่มใหม่ทุกครั้ง
function SendDialog({
  row, onClose, onSent,
}: {
  row: ApRow
  onClose: () => void
  onSent: (row: ApRow, type: "" | "นอกรอบ" | "ตามรอบ", date: string) => void
}) {
  // ตามรอบ = ครบกำหนดตามเครดิตเทอมนับจากวันที่ทำ DD — ถอยไปใช้วันนี้เมื่อยังไม่ได้ตั้งเครดิต
  const [roundDate, setRoundDate] = useState(() => row.dueDate || todayICT())
  const thu = nextThursday(todayICT())
  const [y, m, d] = thu.split("-").map(Number)
  const nextThu = new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`${CARD} w-full max-w-sm space-y-3 p-4`} onClick={(e) => e.stopPropagation()}>
        <div className="font-bold" style={mitr}>ส่งบัญชี · {row.depositCode}</div>
        <div className="text-xs text-gray-500">{row.supplier} · <span className={NUM}>{baht(row.amount)}</span> บาท</div>

        <div className="space-y-2">
          <div className="text-sm font-medium">💸 นอกรอบ — โอนทุกวันพฤหัส</div>
          <div className="flex gap-2">
            <button onClick={() => onSent(row, "นอกรอบ", thu)}
              className="flex-1 rounded-lg border border-gray-200/80 px-2 py-1.5 text-xs hover:bg-emerald-50 dark:border-white/10 dark:hover:bg-emerald-900/20">
              พฤหัสนี้ {thaiDate(thu)}
            </button>
            <button onClick={() => onSent(row, "นอกรอบ", nextThu)}
              className="flex-1 rounded-lg border border-gray-200/80 px-2 py-1.5 text-xs hover:bg-emerald-50 dark:border-white/10 dark:hover:bg-emerald-900/20">
              พฤหัสหน้า {thaiDate(nextThu)}
            </button>
          </div>

          <div className="pt-2 text-sm font-medium">
            📋 ตามรอบ {row.creditTerm ? `— เครดิต ${row.creditTerm} ครบกำหนด ${thaiDate(row.dueDate)}` : "— ยังไม่ตั้งเครดิตเทอม"}
          </div>
          <div className="flex gap-2">
            <input type="date" value={roundDate} onChange={(e) => setRoundDate(e.target.value)}
              className="flex-1 rounded-lg border border-gray-200/80 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5" />
            <button onClick={() => roundDate && onSent(row, "ตามรอบ", roundDate)}
              className="rounded-lg border border-gray-200/80 px-3 py-1.5 text-sm hover:bg-emerald-50 dark:border-white/10 dark:hover:bg-emerald-900/20">
              บันทึก
            </button>
          </div>
        </div>

        <div className="flex justify-between pt-2">
          {row.sentDate && (
            <button onClick={() => onSent(row, "", "")} className="text-xs text-rose-600 hover:underline">ยกเลิกการส่งบัญชี</button>
          )}
          <button onClick={onClose} className="ml-auto rounded-lg border border-gray-200/80 px-3 py-1.5 text-sm dark:border-white/10">ปิด</button>
        </div>
      </div>
    </div>
  )
}

export function ApTrackingPage() {
  const [rows, setRows]       = useState<ApRow[]>([])
  const [summary, setSummary] = useState<ApSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [month, setMonth]     = useState(thisMonth())
  const [warehouse, setWarehouse] = useState("")
  const [fStatus, setFStatus] = useState<ApStatus | "">("")
  const [quick, setQuick]     = useState<ApQuickView>("")
  const [q, setQ]             = useState("")
  const [warehouses, setWarehouses] = useState<string[]>([])
  const [sentFor, setSentFor] = useState<ApRow | null>(null)
  const [detailFor, setDetailFor] = useState<ApRow | null>(null)
  const [page, setPage]       = useState(1)
  const [perPage, setPerPage] = useState<number>(50)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkRunning, setBulkRunning] = useState(false)

  // ทุกตัวกรองต้องพากลับหน้า 1 และล้างการเลือกค้าง (ใบที่เลือกไว้อาจหลุดจากผลลัพธ์ใหม่ไปแล้ว)
  // ทำที่ตัวจัดการเหตุการณ์ ไม่ใช่ใน useEffect — setState ใน effect ทำให้ render ซ้อนโดยไม่จำเป็น
  const applyFilter = (fn: () => void) => { fn(); setPage(1); setSelected(new Set()) }

  const openSent = (row: ApRow) => { setDetailFor(null); setSentFor(row) }
  const openDetail = (row: ApRow) => { setSentFor(null); setDetailFor(row) }

  // นับรุ่นคำขอ — ตอบกลับที่ไม่ใช่รุ่นล่าสุดถูกทิ้ง กันเดือนเก่ามาทับเดือนใหม่เมื่อสลับเดือนถี่ ๆ
  // + ยกเลิกคำขอเก่าด้วย AbortController: ไม่งั้นเซิร์ฟเวอร์สแกน deposit_header (ไม่มี index) ซ้อนกันหลายรอบ
  const loadSeq   = useRef(0)
  const abortRef  = useRef<AbortController | null>(null)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    try {
      // ส่งตัวกรองที่ใช้อยู่ไปให้เซิร์ฟเวอร์ด้วย เพื่อให้ยอดสรุปคิดจากชุดเดียวกับที่ผู้ใช้เห็น
      // (ไม่ส่ง status — ชิปสถานะเป็นตัวกรองของตารางฝั่ง client ถ้าส่งไปชิปอื่นจะกลายเป็น 0)
      const params = new URLSearchParams({ month })
      if (warehouse) params.set("warehouse", warehouse)
      if (q)         params.set("q", q)
      const res  = await fetch(`/api/ap-tracking?${params.toString()}`, { signal: ac.signal })
      const data = await res.json()
      if (seq !== loadSeq.current) return
      if (!res.ok) throw new Error(data?.error ?? "โหลดข้อมูลไม่สำเร็จ")
      setRows(data.rows); setSummary(data.summary)
      // ตัวเลือก "คลัง" เก็บไว้เฉพาะตอนผลลัพธ์ยังไม่ถูกกรองด้วยคลัง/คำค้น — ไม่งั้นพอเลือกคลังหนึ่ง
      // dropdown จะเหลือตัวเดียวจนสลับกลับไม่ได้
      if (!warehouse && !q) {
        setWarehouses([...new Set((data.rows as ApRow[]).map((r) => r.warehouse).filter(Boolean))].sort())
      }
    } catch (e) {
      // ถูกยกเลิกเพราะมีคำขอใหม่มาแทน ไม่ใช่ความผิดพลาด — ห้ามเด้ง error ใส่ผู้ใช้
      if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return
      if (seq !== loadSeq.current) return
      const msg = e instanceof Error ? e.message : ""
      swalError(msg ? `โหลดข้อมูลไม่สำเร็จ: ${msg}` : "โหลดข้อมูลไม่สำเร็จ")
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [month, warehouse, q])

  // โหลดครั้งแรกทันที · เปลี่ยนเดือน/คลัง/คำค้นหลังจากนั้นหน่วง 400ms (กดรัว ๆ = ยิงคิวรีหนักทุกครั้ง)
  const firstLoad = useRef(true)
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; load(); return }
    const t = setTimeout(load, 400)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => () => abortRef.current?.abort(), [])

  const today = todayICT()

  const shown = useMemo(() => {
    let out = rows
    if (fStatus)   out = out.filter((r) => r.status === fStatus)
    if (quick === "urgent") {
      out = out.filter((r) => ["overdue", "due7"].includes(apUrgency(r.dueDate, r.sentDate, today)))
    } else if (quick === "review") {
      out = out.filter((r) => needsAccountingReview(r.status, r.review?.status))
    }
    if (warehouse) out = out.filter((r) => r.warehouse === warehouse)
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      out = out.filter((r) => matchQ(r, rx))
    }
    return out
  }, [rows, fStatus, quick, warehouse, q, today])

  const totalPages = perPage === 0 ? 1 : Math.max(1, Math.ceil(shown.length / perPage))
  // clamp ระหว่างที่จำนวนแถวลดลงก่อน state หน้าจะถูกตั้งใหม่ — ตารางจึงไม่กะพริบเป็นหน้าว่าง
  const safePage = Math.min(page, totalPages)
  const paged = useMemo(
    () => (perPage === 0 ? shown : shown.slice((safePage - 1) * perPage, safePage * perPage)),
    [shown, safePage, perPage],
  )
  const firstIdx = shown.length === 0 ? 0 : perPage === 0 ? 1 : (safePage - 1) * perPage + 1
  const lastIdx  = perPage === 0 ? shown.length : Math.min(safePage * perPage, shown.length)
  const pageNumbers = useMemo(() => {
    const win = new Set<number>([1, totalPages, safePage])
    for (let d = 1; d <= 2; d++) {
      if (safePage - d >= 1) win.add(safePage - d)
      if (safePage + d <= totalPages) win.add(safePage + d)
    }
    return [...win].sort((a, b) => a - b)
  }, [safePage, totalPages])

  const selectedRows = useMemo(() => shown.filter((r) => selected.has(r.depositCode)), [shown, selected])
  const selectedAmount = selectedRows.reduce((s, r) => s + r.amount, 0)

  const toggle = (code: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code); else next.add(code)
      return next
    })

  const toggleAll = () => {
    const usable = paged.filter((r) => !r.sentDate && isDocSetComplete(r.docs)).map((r) => r.depositCode)
    setSelected((prev) => {
      const allOn = usable.length > 0 && usable.every((c) => prev.has(c))
      const next = new Set(prev)
      usable.forEach((c) => (allOn ? next.delete(c) : next.add(c)))
      return next
    })
  }

  // ส่งบัญชีทีละใบผ่าน API เดิม — ไม่เพิ่ม endpoint ใหม่ · ทำทีละใบเพื่อให้ใบที่ล้มเหลวไม่ลากใบอื่นล้มตาม
  const bulkSend = async () => {
    const thu = nextThursday(todayICT())
    const r = await swalConfirm(
      `ส่งบัญชีนอกรอบ ${selectedRows.length} ใบ?`,
      `กำหนดโอนวันพฤหัสที่ ${thaiDate(thu)} · รวม ${baht(selectedAmount)} บาท`,
    )
    if (!r.isConfirmed) return
    setBulkRunning(true)
    const failed: string[] = []
    for (const row of selectedRows) {
      try {
        const res = await fetch(`/api/ap-tracking/${encodeURIComponent(row.depositCode)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sentType: "นอกรอบ", sentDate: thu }),
        })
        if (!res.ok) failed.push(row.depositCode)
      } catch { failed.push(row.depositCode) }
    }
    setBulkRunning(false)
    setSelected(new Set())
    if (failed.length) swalError(`ส่งไม่สำเร็จ ${failed.length} ใบ: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? "…" : ""}`)
    else swalToast("success", `ส่งบัญชีนอกรอบ ${selectedRows.length} ใบ · โอน ${thaiDate(thu)}`)
    load()
  }

  const onDetailSaved = (
    depositCode: string,
    patch: { docs: ApDocs; status: ApStatus; sentType: string; sentDate: string; note: string; review?: { status: string; note: string } },
  ) => {
    const { docs, status, sentType, sentDate, note, review } = patch
    const before = rows.find((r) => r.depositCode === depositCode)
    const sentMoved = Boolean(before) && (before!.sentDate !== sentDate || before!.sentType !== sentType)
    const next = { docs, status, sentType, sentDate, note, review,
      overdue: sentDate ? 0 : overdueDays(before?.dueDate ?? "", todayICT()) }
    setRows((rs) => rs.map((r) => r.depositCode === depositCode ? { ...r, ...next } : r))
    setDetailFor((d) => d && d.depositCode === depositCode ? { ...d, ...next } : d)
    // ส่ง/ยกเลิกส่งบัญชี กระทบยอดเงินหลายก้อนพร้อมกัน (โอนพฤหัส · เกินกำหนด · aging) — ดึงสรุปใหม่ทั้งชุด
    if (sentMoved) { load(); return }
    if (before) setSummary((sm) => moveStatusBucket(sm, before.status, status, before.amount))
  }

  const setSent = async (row: ApRow, type: "" | "นอกรอบ" | "ตามรอบ", date: string) => {
    try {
      const res  = await fetch(`/api/ap-tracking/${encodeURIComponent(row.depositCode)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentType: type, sentDate: date }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "บันทึกไม่สำเร็จ")
      setRows((rs) => rs.map((r) => r.depositCode === row.depositCode
        ? { ...r, sentType: data.sentType, sentDate: data.sentDate, status: data.status,
            overdue: data.sentDate ? 0 : overdueDays(r.dueDate, todayICT()) } : r))
      setSentFor(null)
      swalToast("success", date ? `ส่งบัญชี ${type} ${thaiDate(date)}` : "ยกเลิกการส่งบัญชีแล้ว")
      load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : ""
      swalError(msg ? `บันทึกไม่สำเร็จ: ${msg}` : "บันทึกไม่สำเร็จ")
    }
  }

  // เดือนที่เลือกอยู่ก่อนเส้น go-live ทั้งเดือนหรือไม่ — ใช้ helper ตัวเดียวกับที่ API ใช้ตัดเดือน
  const scopeSince = summary?.since || AP_GO_LIVE
  const monthOutOfScope = !monthInApScope(month, scopeSince)

  return (
    <div className="space-y-4 p-4 md:p-6">
      <ApSummaryBar
        summary={summary} loading={loading}
        month={month} onMonth={(v) => applyFilter(() => setMonth(v))}
        q={q} onQ={(v) => applyFilter(() => setQ(v))}
        onRefresh={load}
        fStatus={fStatus} onStatus={(v) => applyFilter(() => setFStatus(v))}
        quick={quick} onQuick={(v) => applyFilter(() => setQuick(v))}
        warehouse={warehouse} onWarehouse={(v) => applyFilter(() => setWarehouse(v))}
        warehouses={warehouses}
      />

      {/* ผลลัพธ์ถูกตัดเพราะชนเพดานแถว — ยอดสรุปทุกตัวข้างบนยังไม่ครบ ต้องบอกให้ชัด ไม่ปล่อยให้เงียบ */}
      {summary?.truncated && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          ⚠️ ข้อมูลถูกตัดที่ {summary.limit.toLocaleString("th-TH")} แถว — <b>ยอดสรุปทั้งหมดยังไม่ครบทั้งช่วง</b>{" "}
          แคบช่วงลงด้วยการเลือกคลังหรือใส่คำค้น
        </div>
      )}

      {summary && summary.counted > summary.total && !fStatus && !quick && (
        <div className="text-xs text-gray-400">
          ยอดสรุปรวมใบค้างยกมาที่ส่งบัญชีในเดือนนี้อีก {summary.counted - summary.total} ใบ (ไม่แสดงในตาราง)
        </div>
      )}

      {/* แถบทำงานกับหลายใบพร้อมกัน — โผล่เฉพาะตอนมีการเลือก เพื่อไม่ให้กินที่ตอนใช้งานปกติ */}
      {selectedRows.length > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/95 px-4 py-2.5 backdrop-blur dark:border-emerald-900 dark:bg-emerald-950/60">
          <span className="text-sm text-emerald-900 dark:text-emerald-200">
            เลือก {selectedRows.length} ใบ · <span className={`font-bold ${NUM}`}>{baht(selectedAmount)}</span> บาท
          </span>
          <button onClick={bulkSend} disabled={bulkRunning}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {bulkRunning ? "กำลังส่ง…" : `💸 ส่งบัญชีนอกรอบ · พฤหัสนี้ ${thaiDate(nextThursday(today))}`}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-emerald-800 hover:underline dark:text-emerald-300">
            ล้างการเลือก
          </button>
        </div>
      )}

      <ApTable
        rows={paged} loading={loading}
        selected={selected} onToggle={toggle} onToggleAll={toggleAll}
        onOpen={openDetail} onSend={openSent}
        page={safePage} totalPages={totalPages} pageNumbers={pageNumbers}
        firstIdx={firstIdx} lastIdx={lastIdx} totalRows={shown.length}
        perPage={perPage} perPageOptions={PER_PAGE_OPTIONS}
        onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1) }}
        emptyNote={monthOutOfScope ? (
          // เดือนก่อนเส้น go-live ว่างเพราะ "ไม่อยู่ในขอบเขตระบบ" ไม่ใช่เพราะหาไม่เจอ — ต้องบอกให้ชัด
          <div className="space-y-1">
            <div className="font-medium text-gray-500 dark:text-gray-400">
              เดือนนี้อยู่ก่อนวันที่ระบบเริ่มติดตามเจ้าหนี้ ({thaiDate(scopeSince)})
            </div>
            <div className="text-xs">ใบรับของก่อนวันดังกล่าวจัดการในไฟล์ Excel ของกระบวนการเดิม จึงไม่ถูกดึงเข้ามา</div>
          </div>
        ) : (quick || fStatus || q ? "ไม่มีใบที่ตรงกับตัวกรองนี้" : "ยังไม่มีใบรับของในเดือนนี้")}
      />

      {sentFor && <SendDialog row={sentFor} onClose={() => setSentFor(null)} onSent={setSent} />}
      {/* key = เลขใบ · เปลี่ยนใบแล้ว component เกิดใหม่ ทำให้ draft เริ่มจากใบใหม่เสมอ */}
      {detailFor && (
        <ApTrackingDetail key={detailFor.depositCode} row={detailFor} onClose={() => setDetailFor(null)} onSaved={onDetailSaved} />
      )}
    </div>
  )
}
