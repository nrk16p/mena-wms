"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Banknote, RefreshCw, Search } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import {
  AP_DOC_FIELDS, AP_GO_LIVE, AP_STATUSES, apStatusMeta, isDocSetComplete, missingDocLabels,
  monthInApScope, nextThursday, overdueDays, thaiDate, todayICT,
  type ApDocs, type ApStatus,
} from "@/lib/ap-tracking"
import { ApTrackingDetail } from "@/components/ap-tracking-detail"

const mitr = { fontFamily: "var(--font-mitr), sans-serif" }

export type ApRow = {
  depositCode: string; depositId: number | null; warehouse: string
  purchaseOrder: string; supplier: string; supplierRefNo: string
  amount: number; receivedAt: string; createdAt: string
  creditTerm: string; dueDate: string; overdue: number
  docs: ApDocs; sentType: string; sentDate: string; note: string
  status: ApStatus; carryover: boolean
  poTotal: number; poDue: string; poStatus: string
}
type Bucket = { n: number; amount: number }
type Summary = {
  total: number
  counted: number
  truncated: boolean
  limit: number
  since: string          // เส้น go-live ที่เซิร์ฟเวอร์ใช้จริง (อาจถูก override ด้วย ?since=)
  byStatus: Record<ApStatus, Bucket>
  overdue: Bucket
  thisThursday: { date: string; n: number; amount: number }
  unsentAging: { notDue: Bucket; due7: Bucket; overdue: Bucket; noTerm: Bucket }
  dataAsOf: string
}

const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// วันนี้ตามเวลาไทยเสมอ (เครื่องผู้ใช้อาจตั้ง TZ อื่น / เซิร์ฟเวอร์รัน UTC) — กันวันเลื่อนช่วง 00:00–07:00
const thisMonth = () => todayICT().slice(0, 7)

// ย้าย 1 แถวระหว่างบัคเก็ตสถานะของ summary ที่เซิร์ฟเวอร์ส่งมา — ใช้ตอนติ๊กแล้วสถานะเปลี่ยน
// ไม่ใช่การคำนวณยอดสรุปซ้ำ: ตัวเลขตั้งต้นและสถานะปลายทางมาจากเซิร์ฟเวอร์ทั้งคู่ แค่บวก/ลบ 1 แถว
const moveStatusBucket = (sm: Summary | null, from: ApStatus, to: ApStatus, amount: number): Summary | null => {
  if (!sm || from === to || !sm.byStatus?.[from] || !sm.byStatus?.[to]) return sm
  const byStatus: Record<ApStatus, Bucket> = { ...sm.byStatus }
  byStatus[from] = { n: byStatus[from].n - 1, amount: byStatus[from].amount - amount }
  byStatus[to]   = { n: byStatus[to].n + 1,   amount: byStatus[to].amount + amount }
  return { ...sm, byStatus }
}

// ค้นหาให้ครอบคลุมเท่าฝั่ง API (รวมเลขที่บิลของซัพพลายเออร์) ไม่งั้นค้นด้วยเลขบิลแล้วเหมือนไม่เจอ
const matchQ = (r: ApRow, rx: RegExp) =>
  rx.test(r.depositCode) || rx.test(r.purchaseOrder) || rx.test(r.supplier) || rx.test(r.supplierRefNo)

// ช่องหมายเหตุแบบ controlled — พิมพ์แล้วออกจากช่องค่อยบันทึก บันทึกไม่สำเร็จคืนค่ากลับให้เห็นทันที
// (key={depositCode:note} ที่จุดเรียกใช้ทำให้ remount รับค่าใหม่เมื่อรีเฟรชหรือถูกอัปเดตจากที่อื่น)
function NoteCell({ row, onSave }: { row: ApRow; onSave: (row: ApRow, note: string) => Promise<boolean> }) {
  const [value, setValue] = useState(row.note)
  const handleBlur = async () => {
    const trimmed = value.trim()
    if (trimmed === row.note) { setValue(row.note); return }
    const ok = await onSave(row, trimmed)
    setValue(ok ? trimmed : row.note)
  }
  return (
    <input value={value} placeholder="—"
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="w-40 rounded border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-gray-300 focus:border-gray-400 focus:bg-white dark:focus:bg-white/10" />
  )
}

// popover ส่งบัญชี — เป็น component แยกเพื่อให้ state วันที่ตามรอบรีเซ็ตกลับเป็นวันนี้ทุกครั้งที่เปิดใหม่
// (เปิด/ปิดคือ mount/unmount เพราะฉากหลังบัง overlay ทำให้เปลี่ยนแถวโดยไม่ปิดก่อนไม่ได้)
function SendDialog({
  row, onClose, onSent,
}: {
  row: ApRow
  onClose: () => void
  onSent: (row: ApRow, type: "" | "นอกรอบ" | "ตามรอบ", date: string) => void
}) {
  const [roundDate, setRoundDate] = useState(() => todayICT())
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#161a23] p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="font-bold" style={mitr}>ส่งบัญชี · {row.depositCode}</div>
        <div className="text-xs text-gray-500">{row.supplier} · {baht(row.amount)} บาท</div>

        <div className="space-y-2">
          <div className="text-sm font-medium">💸 นอกรอบ (โอนทุกวันพฤหัส)</div>
          <div className="flex gap-2">
            <button onClick={() => onSent(row, "นอกรอบ", nextThursday(todayICT()))}
              className="flex-1 rounded-lg border px-2 py-1.5 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
              พฤหัสนี้ {thaiDate(nextThursday(todayICT()))}
            </button>
            <button onClick={() => {
              const thu = nextThursday(todayICT())
              const [y, m, d] = thu.split("-").map(Number)
              onSent(row, "นอกรอบ", new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10))
            }}
              className="flex-1 rounded-lg border px-2 py-1.5 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
              พฤหัสหน้า
            </button>
          </div>

          <div className="text-sm font-medium pt-2">📋 ตามรอบ (วันที่ส่งเอกสาร)</div>
          <div className="flex gap-2">
            <input type="date" value={roundDate}
              onChange={(e) => setRoundDate(e.target.value)}
              className="flex-1 rounded-lg border px-2 py-1.5 text-sm bg-white dark:bg-white/5" />
            <button onClick={() => roundDate && onSent(row, "ตามรอบ", roundDate)}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
              บันทึก
            </button>
          </div>
        </div>

        <div className="flex justify-between pt-2">
          {row.sentDate && (
            <button onClick={() => onSent(row, "", "")} className="text-xs text-rose-600 hover:underline">ยกเลิกการส่งบัญชี</button>
          )}
          <button onClick={onClose} className="ml-auto rounded-lg border px-3 py-1.5 text-sm">ปิด</button>
        </div>
      </div>
    </div>
  )
}

export function ApTrackingPage() {
  const [rows, setRows]       = useState<ApRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [month, setMonth]     = useState(thisMonth())
  const [warehouse, setWarehouse] = useState("")
  const [fStatus, setFStatus] = useState<ApStatus | "">("")
  const [q, setQ]             = useState("")
  const [warehouses, setWarehouses] = useState<string[]>([])
  const [sentFor, setSentFor] = useState<ApRow | null>(null)
  const [detailFor, setDetailFor] = useState<ApRow | null>(null)

  // เปิดกล่องโต้ตอบใดกล่องหนึ่งแล้วปิดอีกกล่องเสมอ กันสองโอเวอร์เลย์ซ้อนกันพร้อมกัน
  const openSent = (row: ApRow) => { setDetailFor(null); setSentFor(row) }
  const openDetail = (row: ApRow) => { setSentFor(null); setDetailFor(row) }

  // นับรุ่นคำขอ — ตอบกลับที่ไม่ใช่รุ่นล่าสุดถูกทิ้ง กันเดือนเก่ามาทับเดือนใหม่เมื่อสลับเดือนถี่ๆ
  // + ยกเลิกคำขอเก่าด้วย AbortController: กดลูกศรของ <input type="month"> ค้างไว้จะยิงทีละครั้งต่อคลิก
  //   ถ้าแค่ทิ้งผลลัพธ์แต่ไม่ยกเลิก ฝั่งเซิร์ฟเวอร์จะสแกน deposit_header (ไม่มี index) ซ้อนกันหลายรอบ
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
      // (ไม่ส่ง status — ชิปสถานะเป็นตัวกรองของตารางฝั่ง client เท่านั้น ถ้าส่งไปชิปอื่นจะกลายเป็น 0)
      const params = new URLSearchParams({ month })
      if (warehouse) params.set("warehouse", warehouse)
      if (q)         params.set("q", q)
      const res  = await fetch(`/api/ap-tracking?${params.toString()}`, { signal: ac.signal })
      const data = await res.json()
      if (seq !== loadSeq.current) return
      if (!res.ok) throw new Error(data?.error ?? "โหลดข้อมูลไม่สำเร็จ")
      setRows(data.rows); setSummary(data.summary)
      // ตัวเลือก "คลัง" เก็บไว้เฉพาะตอนผลลัพธ์ยังไม่ถูกกรองด้วยคลัง/คำค้น — ตอนนี้เซิร์ฟเวอร์กรองให้
      // ตั้งแต่ query แล้ว ถ้าไล่รายชื่อจาก rows ทุกครั้ง พอเลือกคลังหนึ่ง dropdown จะเหลือตัวเดียวจนสลับกลับไม่ได้
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
      // คำขอรุ่นล่าสุดเท่านั้นที่ปิดสถานะโหลด — รุ่นเก่าที่ถูกแทนที่ปล่อยให้รุ่นใหม่ปิดให้ ไม่ค้างสปิน
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [month, warehouse, q])

  // โหลดครั้งแรกทันที · เปลี่ยนเดือน/คลัง/คำค้นหลังจากนั้นหน่วง 400ms
  // (กดลูกศรเดือนรัว ๆ หรือพิมพ์คำค้น = ยิงคิวรีหนักทุกครั้ง ถ้าไม่หน่วง)
  const firstLoad = useRef(true)
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; load(); return }
    const t = setTimeout(load, 400)
    return () => clearTimeout(t)
  }, [load])

  // ออกจากหน้าแล้วไม่ปล่อยคำขอค้าง
  useEffect(() => () => abortRef.current?.abort(), [])

  // โมดัลรายละเอียดบันทึกการติ๊กสำเร็จ — เอาผลที่เซิร์ฟเวอร์ยืนยันกลับมาเสียบเข้าตาราง
  // (ตารางเป็นแบบดูอย่างเดียว การติ๊กทั้งหมดเกิดในโมดัลที่เห็นรายการสินค้า/PO ประกอบก่อนตัดสินใจ)
  const onDocsSaved = (depositCode: string, docs: ApDocs, status: ApStatus) => {
    const before = rows.find((r) => r.depositCode === depositCode)
    setRows((rs) => rs.map((r) => r.depositCode === depositCode ? { ...r, docs, status } : r))
    // โมดัลถือ row เดิมไว้ตั้งแต่ตอนเปิด — อัปเดตด้วย ไม่งั้นปิดแล้วเปิดใบเดิมซ้ำจะเห็นค่าเก่า
    setDetailFor((d) => d && d.depositCode === depositCode ? { ...d, docs, status } : d)
    // ติ๊กทำให้ 1 แถวย้ายบัคเก็ตสถานะเท่านั้น (รอประกบ ↔ ครบชุด) และไม่กระทบยอดเงินกลุ่มอื่นเลย
    // — ขยับชิปตาม status ที่เซิร์ฟเวอร์ยืนยันกลับมา ไม่ได้คิดยอดสรุปใหม่เองฝั่ง client
    //   (ถ้าไม่ขยับ ชิปจะเพี้ยนจากตารางทุกครั้งที่บันทึก · ถ้ายิง load() ใหม่ = สแกนหนักทุกครั้ง)
    if (before) setSummary((sm) => moveStatusBucket(sm, before.status, status, before.amount))
  }

  // บันทึกวันส่งบัญชี — นอกรอบ = โอนทุกวันพฤหัส · ตามรอบ = วันที่ส่งเอกสาร
  const setSent = async (row: ApRow, type: "" | "นอกรอบ" | "ตามรอบ", date: string) => {
    try {
      const res  = await fetch(`/api/ap-tracking/${encodeURIComponent(row.depositCode)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentType: type, sentDate: date }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "บันทึกไม่สำเร็จ")
      // ยกเลิกส่งบัญชี = กลับมานับวันเกินกำหนดใหม่จาก dueDate (ค่า overdue เดิมเป็น 0 ที่ถูกกดไว้ตอนส่ง)
      // ถ้าใช้ r.overdue ต่อ badge ⏰ จะหายไปจนกว่าจะรีเฟรชหน้า
      setRows((rs) => rs.map((r) => r.depositCode === row.depositCode
        ? { ...r, sentType: data.sentType, sentDate: data.sentDate, status: data.status,
            overdue: data.sentDate ? 0 : overdueDays(r.dueDate, todayICT()) } : r))
      setSentFor(null)
      swalToast("success", date ? `ส่งบัญชี ${type} ${thaiDate(date)}` : "ยกเลิกการส่งบัญชีแล้ว")
      // ส่ง/ยกเลิกส่งบัญชี กระทบยอดเงินหลายก้อนพร้อมกัน (โอนพฤหัส · เกินกำหนด · aging · ชิปสถานะ)
      // และเป็นการกระทำที่นาน ๆ ครั้ง — ดึงยอดสรุปจากเซิร์ฟเวอร์ใหม่ทั้งชุด ไม่คิดเดาเองฝั่ง client
      load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : ""
      swalError(msg ? `บันทึกไม่สำเร็จ: ${msg}` : "บันทึกไม่สำเร็จ")
    }
  }

  // คืน true/false บอกผลบันทึก — ให้ NoteCell รู้ว่าจะโชว์ค่าที่พิมพ์ไว้ หรือคืนกลับค่าเดิม
  const saveNote = async (row: ApRow, note: string): Promise<boolean> => {
    if (note === row.note) return true
    try {
      const res  = await fetch(`/api/ap-tracking/${encodeURIComponent(row.depositCode)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "บันทึกไม่สำเร็จ")
      setRows((rs) => rs.map((r) => r.depositCode === row.depositCode ? { ...r, note: data.note } : r))
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : ""
      swalError(msg ? `บันทึกหมายเหตุไม่สำเร็จ: ${msg}` : "บันทึกหมายเหตุไม่สำเร็จ")
      return false
    }
  }

  const shown = useMemo(() => {
    let out = rows
    if (fStatus)   out = out.filter((r) => r.status === fStatus)
    if (warehouse) out = out.filter((r) => r.warehouse === warehouse)
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      out = out.filter((r) => matchQ(r, rx))
    }
    return out
  }, [rows, fStatus, warehouse, q])

  // เดือนที่เลือกอยู่ก่อนเส้น go-live ทั้งเดือนหรือไม่ — ใช้ helper ตัวเดียวกับที่ API ใช้ตัดเดือน
  // ไม่เทียบวันที่เองซ้ำตรงนี้ · เส้นที่ใช้เอาจากคำตอบของเซิร์ฟเวอร์ก่อน (รองรับ ?since= override)
  // ถ้ายังไม่มีคำตอบค่อยถอยไปใช้ AP_GO_LIVE
  const scopeSince = summary?.since || AP_GO_LIVE
  const monthOutOfScope = !monthInApScope(month, scopeSince)

  // ยอดสรุปทุกตัวมาจาก `summary` ของเซิร์ฟเวอร์แหล่งเดียว — ห้ามคำนวณซ้ำฝั่ง client
  // เพราะ rows ที่ตารางใช้ "ตั้งใจ" ไม่มีใบค้างยกมาที่ส่งบัญชีไปแล้ว ถ้าเอา rows มาบวกเอง
  // ยอด "เข้าโอนพฤหัสนี้" จะขาดใบพวกนั้นไปทั้งใบ (เงินโอนขาดจริง) · เซิร์ฟเวอร์คิดจากชุดที่
  // กรองด้วยคลัง+คำค้นเดียวกับที่ผู้ใช้เห็น แต่ไม่กรองด้วยสถานะ (ชิปสถานะคือตัวกรองเอง)
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Banknote className="w-6 h-6 text-emerald-600" />
        <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={mitr}>ติดตามเจ้าหนี้</h1>
        {summary?.dataAsOf && (
          <span className="text-xs text-gray-500 dark:text-gray-400">ข้อมูล ATMS ล่าสุด {thaiDate(summary.dataAsOf)}</span>
        )}
        <button onClick={load} className="ml-auto inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-white/5">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> รีเฟรช
        </button>
      </div>

      {/* ผลลัพธ์ถูกตัดเพราะชน limit — ยอดสรุปทุกตัวข้างล่างยังไม่ครบ ต้องบอกให้ชัด
          ห้ามปล่อยให้หน้าจอเจ้าหนี้แสดงยอดที่ขาดไปเงียบ ๆ */}
      {summary?.truncated && (
        <div className="rounded-xl border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-700">
          ⚠️ ข้อมูลถูกตัดที่ {summary.limit.toLocaleString("th-TH")} แถว — <b>ยอดสรุปทั้งหมดยังไม่ครบทั้งช่วง</b>{" "}
          กรุณาแคบช่วงข้อมูลลง (เลือกคลัง หรือใส่คำค้น) แล้วดูใหม่ ถ้ายังไม่พอให้ลดจำนวนเดือนย้อนหลังด้วยพารามิเตอร์ carryoverMonths
        </div>
      )}

      {/* แถบสรุป — คลิก chip เพื่อกรอง · ทุกตัวเลขมาจาก summary ของเซิร์ฟเวอร์แหล่งเดียว */}
      {summary && (
        <div className="flex flex-wrap gap-2">
          {AP_STATUSES.map((st) => {
            const m = apStatusMeta(st), v = summary.byStatus[st]
            const on = fStatus === st
            return (
              <button key={st} onClick={() => setFStatus(on ? "" : st)}
                className={`rounded-xl border px-3 py-2 text-left transition ${on ? "ring-2 ring-offset-1" : ""} ${m.cls}`}>
                <div className="text-xs">{m.emoji} {st}</div>
                <div className="text-sm font-bold">{v.n} ใบ · {baht(v.amount)}</div>
              </button>
            )
          })}
          <div className="rounded-xl border px-3 py-2 bg-rose-50 dark:bg-rose-950/20">
            <div className="text-xs text-rose-700 dark:text-rose-300">⏰ เกินกำหนดเครดิต</div>
            <div className="text-sm font-bold text-rose-700 dark:text-rose-300">{summary.overdue.n} ใบ · {baht(summary.overdue.amount)}</div>
          </div>
          <div className="rounded-xl border px-3 py-2 bg-emerald-50 dark:bg-emerald-950/20">
            <div className="text-xs text-emerald-700 dark:text-emerald-300">💸 เข้าโอนพฤหัสนี้ ({thaiDate(summary.thisThursday.date)})</div>
            <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{summary.thisThursday.n} ใบ · {baht(summary.thisThursday.amount)}</div>
          </div>
          <div className="rounded-xl border px-3 py-2 bg-amber-50 dark:bg-amber-950/20"
            title="ซัพพลายเออร์ยังไม่ได้ตั้งเครดิตเทอม จึงคำนวณวันครบกำหนดไม่ได้ — ไม่ใช่ว่ายังไม่ถึงกำหนด">
            <div className="text-xs text-amber-700 dark:text-amber-300">❓ ยังไม่ตั้งเครดิตเทอม (ไม่รู้กำหนดชำระ)</div>
            <div className="text-sm font-bold text-amber-700 dark:text-amber-300">{summary.unsentAging.noTerm.n} ใบ · {baht(summary.unsentAging.noTerm.amount)}</div>
          </div>
          <div className="rounded-xl border px-3 py-2">
            <div className="text-xs text-gray-500">ยอดค้างส่งบัญชี (ยังไม่ครบกำหนด / ≤7 วัน / เกิน)</div>
            <div className="text-sm font-bold">
              {baht(summary.unsentAging.notDue.amount)} · {baht(summary.unsentAging.due7.amount)} ·{" "}
              <span className="text-rose-600">{baht(summary.unsentAging.overdue.amount)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ใบค้างยกมาที่ส่งบัญชีในเดือนนี้ถูกนับในยอดสรุป (โดยเฉพาะยอดโอนพฤหัส) แต่ไม่แสดงในตาราง
          — บอกส่วนต่างให้ผู้ใช้เห็น ดีกว่าปล่อยให้สงสัยว่าทำไมนับไม่ตรงกับจำนวนแถว */}
      {summary && summary.counted > summary.total && !fStatus && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          ยอดสรุปรวมใบค้างยกมาที่ส่งบัญชีในเดือนนี้อีก {summary.counted - summary.total} ใบ (ไม่แสดงในตาราง)
        </div>
      )}

      {/* ตัวกรอง */}
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm bg-white dark:bg-white/5" />
        <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm bg-white dark:bg-white/5">
          <option value="">ทุกคลัง</option>
          {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา DD / PO / ซัพพลายเออร์"
            className="rounded-lg border pl-8 pr-3 py-1.5 text-sm w-64 bg-white dark:bg-white/5" />
        </div>
        {fStatus && (
          <button onClick={() => setFStatus("")} className="text-xs text-blue-600 hover:underline">ล้างตัวกรองสถานะ</button>
        )}
        <span className="ml-auto text-sm text-gray-500">{shown.length} ใบ · {baht(shown.reduce((s, r) => s + r.amount, 0))} บาท</span>
      </div>

      {/* ตาราง */}
      <div className="overflow-x-auto rounded-xl border dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-white/5 text-xs text-gray-600 dark:text-gray-300">
            <tr>
              <th className="px-3 py-2 text-left">DD · วันรับ</th>
              <th className="px-3 py-2 text-left">PO</th>
              <th className="px-3 py-2 text-left">ซัพพลายเออร์</th>
              <th className="px-3 py-2 text-right">ยอดเงิน</th>
              <th className="px-3 py-2 text-left">ครบกำหนด</th>
              {AP_DOC_FIELDS.map((f) => (
                <th key={f.key} className="px-2 py-2 text-center whitespace-nowrap"
                  title={`${f.label} — ติ๊กได้ที่หน้ารายละเอียด (คลิกเลข DD)`}>{f.short}</th>
              ))}
              <th className="px-3 py-2 text-left">สถานะ</th>
              <th className="px-3 py-2 text-left">ส่งบัญชี</th>
              <th className="px-3 py-2 text-left">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const meta = apStatusMeta(r.status)
              return (
                <tr key={r.depositCode}
                  className={`border-t dark:border-white/10 ${r.overdue > 0 ? "bg-rose-50/60 dark:bg-rose-950/20" : ""}`}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button type="button" onClick={() => openDetail(r)} className="font-medium text-blue-600 hover:underline">{r.depositCode}</button>
                    <div className="text-xs text-gray-500">
                      {thaiDate(r.receivedAt)}{r.carryover && <span className="ml-1 text-amber-600">ค้างยกมา</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{r.purchaseOrder || "—"}</td>
                  <td className="px-3 py-2 max-w-[260px]">
                    <div className="truncate" title={r.supplier}>{r.supplier}</div>
                    <div className="text-xs text-gray-500">{r.creditTerm || "ยังไม่ตั้งเครดิต"}</div>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{baht(r.amount)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {r.dueDate ? thaiDate(r.dueDate) : "—"}
                    {r.overdue > 0 && <div className="text-rose-600 font-medium">⏰ เกิน {r.overdue} วัน</div>}
                  </td>
                  {/* ดูอย่างเดียว — ติ๊กได้ที่หน้ารายละเอียด (คลิกเลข DD) ซึ่งเห็นรายการสินค้า/PO ประกอบ
                      แล้วกดบันทึกทีเดียว · disabled ทำให้ onChange ไม่ยิง จึงไม่มีทางบันทึกพลาดจากตาราง */}
                  {AP_DOC_FIELDS.map((f) => (
                    <td key={f.key} className="px-2 py-2 text-center">
                      <input type="checkbox" disabled checked={Boolean(r.docs[f.key]?.checked)} readOnly
                        title={r.docs[f.key]?.checked && r.docs[f.key]?.by
                          ? `${f.label} · ติ๊กโดย ${r.docs[f.key]!.by} ${thaiDate((r.docs[f.key]!.at || "").slice(0, 10))}`
                          : `${f.label} — แก้ไขที่หน้ารายละเอียด (คลิกเลข DD)`}
                        className="w-4 h-4 accent-emerald-600 opacity-90" />
                    </td>
                  ))}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${meta.cls}`}>
                      {meta.emoji} {meta.value}
                    </span>
                    {r.sentDate && <div className="text-xs text-gray-500 mt-0.5">{r.sentType} {thaiDate(r.sentDate)}</div>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {(() => {
                      // สะท้อนกฎเดียวกับฝั่งเซิร์ฟเวอร์ (409 ถ้าเอกสารไม่ครบชุด) — ไม่ชวนผู้ใช้กดสิ่งที่ยังไงก็ไม่ผ่าน
                      // ใบที่ "ส่งบัญชีแล้ว" ต้องกดได้เสมอ ถึงเอกสารจะไม่ครบ เพื่อยกเลิก/แก้ที่ลงผิดไว้
                      const missing  = missingDocLabels(r.docs)
                      const blocked  = !r.sentDate && !isDocSetComplete(r.docs)
                      return (
                        <button onClick={() => openSent(r)} disabled={blocked}
                          title={blocked ? `ยังส่งบัญชีไม่ได้ — เอกสารไม่ครบชุด ขาด: ${missing.join(", ")}` : undefined}
                          className={`rounded-lg border px-2 py-1 text-xs ${r.sentDate
                            ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300"
                            : blocked
                              ? "text-gray-400 border-dashed cursor-not-allowed"
                              : "hover:bg-gray-50 dark:hover:bg-white/5"}`}>
                          {r.sentDate ? `✅ ${r.sentType} ${thaiDate(r.sentDate)}` : "ส่งบัญชี"}
                        </button>
                      )
                    })()}
                  </td>
                  <td className="px-3 py-2">
                    <NoteCell key={`${r.depositCode}:${r.note}`} row={r} onSave={saveNote} />
                  </td>
                </tr>
              )
            })}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={15} className="px-3 py-10 text-center text-gray-400">
                {monthOutOfScope ? (
                  // เดือนก่อนเส้น go-live ว่างเพราะ "ไม่อยู่ในขอบเขตระบบ" ไม่ใช่เพราะหาไม่เจอ —
                  // ต้องบอกให้ชัด ไม่งั้นผู้ใช้เข้าใจว่าระบบพัง/ข้อมูลหาย แล้วเลิกเชื่อตัวเลขทั้งหน้า
                  <div className="space-y-1">
                    <div className="font-medium text-gray-500 dark:text-gray-400">
                      เดือนนี้อยู่ก่อนวันที่ระบบเริ่มติดตามเจ้าหนี้ ({thaiDate(scopeSince)})
                    </div>
                    <div className="text-xs">
                      ใบรับของก่อนวันดังกล่าวจัดการในไฟล์ Excel ของกระบวนการเดิม จึงไม่ถูกดึงเข้ามาในระบบนี้ — เป็นเรื่องปกติ ไม่ใช่ข้อผิดพลาด
                    </div>
                  </div>
                ) : "ไม่พบรายการ"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {sentFor && (
        <SendDialog row={sentFor} onClose={() => setSentFor(null)} onSent={setSent} />
      )}
      {/* key = เลขใบ · เปลี่ยนใบแล้ว component เกิดใหม่ ทำให้ draft การติ๊กเริ่มจากใบใหม่เสมอ */}
      {detailFor && (
        <ApTrackingDetail key={detailFor.depositCode} row={detailFor} onClose={() => setDetailFor(null)} onSaved={onDocsSaved} />
      )}
    </div>
  )
}
