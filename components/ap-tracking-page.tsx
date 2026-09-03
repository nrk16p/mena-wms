"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"
import {
  AP_GO_LIVE, apStage, docNosText, groupByDate, ictDate, inDateRange, isDocSetComplete, monthInApScope,
  overdueDays, payThursday, thaiDate, thaiMonthLabel, todayICT,
  type ApDocs, type ApStage, type ApStatus,
} from "@/lib/ap-tracking"
import { CARD, NUM, baht, mitr } from "@/components/ap-style"
import { ApHeader } from "@/components/ap-summary"
import { ApTable } from "@/components/ap-table"
import { ApSupplierTable } from "@/components/ap-supplier-table"
import { ApTrackingDetail } from "@/components/ap-tracking-detail"
import { ApFinanceRequestDialog } from "@/components/ap-finance-request"
import type { ApCoverRow, ApFinanceItem } from "@/lib/ap-tracking"
import type { ApCrossHit, ApPay, ApRow, ApSummary, ApTab } from "@/components/ap-types"

export type { ApRow } from "@/components/ap-types"

// 0 = ทั้งหมด (ไว้ใช้ตอนอยากกด Ctrl+F หาทั้งเดือน หรือปรินต์) — แถวทั้งชุดโหลดมาอยู่ในหน่วยความจำแล้ว
// การแบ่งหน้าเป็นแค่การตัดชิ้นตอนแสดงผล ไม่ยิงคิวรีใหม่ ยอดสรุปด้านบนจึงยังคิดจากทั้งช่วงเหมือนเดิม
const PER_PAGE_OPTIONS = [25, 50, 100, 0] as const
// ตัวกรอง/จัดกลุ่ม "วันที่กดส่งบัญชี" มีความหมายเฉพาะใบที่ผ่านการกดส่งมาแล้วเท่านั้น
// แท็บรอประกบ/ครบชุดยังไม่มีวันกดส่ง — โชว์แถบนี้ไปก็มีแต่ทำให้ตารางว่างโดยไม่มีเหตุผล
const SENT_STAGES: ApStage[] = ["sent", "passed", "paid", "rejected"]
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

// ค้นหาให้ครอบคลุมเท่าฝั่ง API (เลขบิลซัพพลายเออร์ + เลขที่เอกสารทั้ง 4 ช่อง)
// ไม่งั้นค้นด้วยเลขใบวางบิลแล้วยอดสรุปกับตารางจะกรองคนละชุด
const matchQ = (r: ApRow, rx: RegExp) =>
  rx.test(r.depositCode) || rx.test(r.purchaseOrder) || rx.test(r.supplier)
  || rx.test(r.supplierRefNo) || rx.test(docNosText(r.docNos))
  || rx.test(r.vehicle ?? "") || rx.test(r.prNote ?? "")
  || rx.test((r.paid?.paymentNos ?? []).join(" "))

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
  const thu = payThursday(todayICT())
  const [y, m, d] = thu.split("-").map(Number)
  const nextThu = new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`${CARD} w-full max-w-sm space-y-3 p-4`} onClick={(e) => e.stopPropagation()}>
        <div className="font-bold" style={mitr}>ส่งบัญชี · {row.depositCode}</div>
        <div className="text-xs text-gray-500">{row.supplier} · <span className={NUM}>{baht(row.amount)}</span> บาท</div>

        <div className="space-y-2">
          <div className="text-sm font-medium">💸 นอกรอบ — โอนทุกวันพฤหัส (ปิดรอบอังคาร → จ่ายพฤหัสสัปดาห์ถัดไป)</div>
          <div className="flex gap-2">
            <button onClick={() => onSent(row, "นอกรอบ", thu)}
              className="flex-1 rounded-lg border border-gray-200/80 px-2 py-1.5 text-xs hover:bg-emerald-50 dark:border-white/10 dark:hover:bg-emerald-900/20">
              รอบนี้ {thaiDate(thu)}
            </button>
            <button onClick={() => onSent(row, "นอกรอบ", nextThu)}
              className="flex-1 rounded-lg border border-gray-200/80 px-2 py-1.5 text-xs hover:bg-emerald-50 dark:border-white/10 dark:hover:bg-emerald-900/20">
              รอบหน้า {thaiDate(nextThu)}
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
  const [tab, setTab]         = useState<ApTab>("")
  const [q, setQ]             = useState("")
  // ช่วง "วันที่จัดซื้อกดส่งบัญชี" (YYYY-MM-DD, ว่าง = ไม่จำกัดด้านนั้น) + มุมมองจัดกลุ่มรายวัน
  const [sentFrom, setSentFrom] = useState("")
  const [sentTo, setSentTo]     = useState("")
  const [groupSent, setGroupSent] = useState(true)
  // filter ย่อยของแท็บ "ผ่าน" — ตามรอบ/นอกรอบ · ใบที่กดผ่านในเว็บใช้ค่าที่บัญชียืนยัน (pay.type)
  // ใบนำเข้าจาก Excel ไม่มี pay ถอยไปใช้คำขอจากจัดซื้อ (sentType)
  const [payTypeFilter, setPayTypeFilter] = useState<"" | "ตามรอบ" | "นอกรอบ">("")
  // filter เฉพาะแท็บ "ผ่าน": ช่วงวันที่บัญชีกดผ่าน (review.at เวลาไทย) + เครดิตเทอม
  const [passedFrom, setPassedFrom] = useState("")
  const [passedTo, setPassedTo] = useState("")
  // เลือกได้หลายเทอมพร้อมกัน — ผู้ใช้ดูเป็นกลุ่ม "สั้น 7+15" / "ยาว 30+60" ไม่ใช่ทีละเทอม
  const [terms, setTerms] = useState<string[]>([])   // ว่าง = ทุกเทอม · "none" = ยังไม่ตั้งเทอม
  // มุมมองหลักของตาราง: รายใบ (ปกติ) หรือยุบเป็นรายเจ้าหนี้ — สรุป DD/PO/ขั้นของแต่ละเจ้า
  const [viewBy, setViewBy] = useState<"invoice" | "supplier">("invoice")
  const [warehouses, setWarehouses] = useState<string[]>([])
  const [sentFor, setSentFor] = useState<ApRow | null>(null)
  const [detailFor, setDetailFor] = useState<ApRow | null>(null)
  const [page, setPage]       = useState(1)
  const [perPage, setPerPage] = useState<number>(50)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkRunning, setBulkRunning] = useState(false)
  // กล่องแจ้งการเงินขอนอกรอบ — เปิดจากแถบเลือกหลายใบ หรือรายใบจากโมดัล
  const [financeItems, setFinanceItems] = useState<ApFinanceItem[] | null>(null)
  // ระหว่าง "กดเปลี่ยนเดือน" กับ "คิวรีเริ่มจริง" มี debounce 400ms คั่น — ถ้าดูแต่ loading
  // ช่วงนั้นตารางจะว่างพร้อมข้อความ "ยังไม่มีใบรับของในเดือนนี้" ทั้งที่แค่ยังไม่เริ่มโหลด
  const [pending, setPending] = useState(false)
  // ดึงข้อมูลสดจาก ATMS (pipeline light 30 วัน ~11-12 นาที) — สถานะแยกจาก loading ของตาราง
  const [pulling, setPulling] = useState(false)
  const [pullProgress, setPullProgress] = useState(0)
  // ผลค้นข้ามเดือน — null = ยังไม่ได้ค้น/ไม่เข้าเงื่อนไข · [] = ค้นแล้วไม่เจอที่ไหนเลย
  const [crossHits, setCrossHits] = useState<ApCrossHit[] | null>(null)

  // ช่วงวันที่กดส่งที่ "มีผลจริง" — ว่างเมื่อแถบนั้นไม่ได้โชว์ (แท็บอื่น) เพื่อไม่ให้ค่าค้างจากแท็บก่อน
  // แอบเปลี่ยนผลของแท็บที่ไม่มีแถบนี้ · ใช้เป็น dep ของ load ตรง ๆ ด้วย จะได้ไม่ต้องใส่ tab เข้าไป
  // (ใส่ tab เป็น dep = สลับแท็บทีไรยิงคิวรีใหม่ทุกครั้ง ทั้งที่การกรองตามแท็บทำฝั่ง client อยู่แล้ว)
  const apiSentFrom = SENT_STAGES.includes(tab as ApStage) ? sentFrom : ""
  const apiSentTo   = SENT_STAGES.includes(tab as ApStage) ? sentTo   : ""
  // โหมดข้ามเดือน: เซิร์ฟเวอร์ค้นจากวันที่กดส่งทั้งฐาน ไม่สนเดือนที่เลือก
  const crossMonth  = Boolean(apiSentFrom || apiSentTo)

  // ทุกตัวกรองต้องพากลับหน้า 1 และล้างการเลือกค้าง (ใบที่เลือกไว้อาจหลุดจากผลลัพธ์ใหม่ไปแล้ว)
  // ทำที่ตัวจัดการเหตุการณ์ ไม่ใช่ใน useEffect — setState ใน effect ทำให้ render ซ้อนโดยไม่จำเป็น
  const applyFilter = (fn: () => void) => { fn(); setPage(1); setSelected(new Set()) }

  // เปลี่ยนเดือน = ข้อมูลทั้งหน้าใช้ไม่ได้แล้ว — ล้างทิ้งทันทีให้เห็นเป็นโครงกำลังโหลด
  // ไม่ปล่อยให้ตัวเลขเดือนเก่าค้างอยู่จนคนอ่านผิดว่าเป็นของเดือนใหม่
  // (ตัวกรองอื่นอย่างคำค้นไม่ล้าง เพราะพิมพ์ทีละตัวอักษรแล้วตารางกะพริบทุกครั้งจะแย่กว่า)
  const changeMonth = (v: string) => applyFilter(() => {
    setMonth(v); setRows([]); setSummary(null); setPending(true)
  })

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
      // ตั้งช่วงวันที่กดส่งเมื่อไหร่ = ให้เซิร์ฟเวอร์ค้นข้ามทุกเดือนให้ (เดือนที่เลือกถูกมองข้าม)
      // เดิมกรองในหน่วยความจำจากแถวของเดือนที่โหลดมาเท่านั้น ใบที่รับของคนละเดือนกับวันกดส่งจึงหาไม่เจอ
      if (apiSentFrom) params.set("sentFrom", apiSentFrom)
      if (apiSentTo)   params.set("sentTo", apiSentTo)
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
      if (seq === loadSeq.current) { setLoading(false); setPending(false) }
    }
  }, [month, warehouse, q, apiSentFrom, apiSentTo])

  // โหลดครั้งแรกทันที · เปลี่ยนเดือน/คลัง/คำค้นหลังจากนั้นหน่วง 400ms (กดรัว ๆ = ยิงคิวรีหนักทุกครั้ง)
  const firstLoad = useRef(true)
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; load(); return }
    const t = setTimeout(load, 400)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => () => abortRef.current?.abort(), [])

  // "ยังไม่ได้ข้อมูลของเดือนที่เลือก" — ครอบทั้งช่วง debounce และช่วงที่คิวรีวิ่งอยู่
  const busy = loading || pending
  const today = todayICT()

  // มุมมองรายเจ้าหนี้เคารพคลัง+คำค้น แต่ไม่สนแท็บขั้น — คอลัมน์ของมันแจกแจงทุกขั้นอยู่แล้ว
  // ถ้ากรองด้วยแท็บอีกชั้น ตัวเลขขั้นอื่นจะเป็นศูนย์หมดแล้วอ่านผิดว่าเจ้านั้นไม่มีงานขั้นอื่น
  const supplierRows = useMemo(() => {
    if (viewBy !== "supplier") return []
    let out = rows
    if (warehouse) out = out.filter((r) => r.warehouse === warehouse)
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      out = out.filter((r) => matchQ(r, rx))
    }
    return out
  }, [viewBy, rows, warehouse, q])

  // เลือกเจ้าจากตารางสรุป → กลับมุมมองรายใบพร้อมกรองชื่อเจ้านั้นให้เลย
  const pickSupplier = (name: string) => applyFilter(() => { setViewBy("invoice"); setQ(name) })

  // แถบ "วันที่กดส่งบัญชี" โผล่เฉพาะแท็บที่ใบผ่านการกดส่งมาแล้ว
  const sentView = SENT_STAGES.includes(tab as ApStage)
  const grouped  = sentView && groupSent

  // แยกสองชั้น: ตัวกรองประจำหน้า แล้วค่อยช่วงวันที่กดส่ง — เพื่อบอกได้ว่าตารางว่าง
  // "เพราะช่วงวันที่" หรือ "เพราะไม่มีใบในแท็บนี้ตั้งแต่แรก" (ข้อความบอกคนละเรื่องกัน)
  const beforeSentRange = useMemo(() => {
    let out = rows
    // แท็บ = ขั้นของงาน (1 ใบอยู่ได้ขั้นเดียว ดู apStage) — ตัวกรองหลักของหน้า
    if (tab) out = out.filter((r) => apStage(r) === tab)
    if (warehouse) out = out.filter((r) => r.warehouse === warehouse)
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      out = out.filter((r) => matchQ(r, rx))
    }
    return out
  }, [rows, tab, warehouse, q])

  // กรองด้วยวันที่กดส่งเฉพาะตอนที่แถบนั้นโชว์อยู่ — สลับไปแท็บอื่นแล้วค่าเดิมต้องไม่แอบกรองต่อ
  const rangeOn = sentView && Boolean(sentFrom || sentTo)
  const shown = useMemo(() => {
    let out = rangeOn ? beforeSentRange.filter((r) => inDateRange(r.sentMarkedDate, sentFrom, sentTo)) : beforeSentRange
    // filter ย่อย ตามรอบ/นอกรอบ ใช้กับแท็บ "ส่งบัญชีแล้ว" และ "ผ่าน" — แท็บอื่นค่าค้างต้องไม่แอบกรอง
    // (ใบที่ผ่านแล้วใช้ค่าที่บัญชียืนยัน · ใบที่แค่ส่งแล้วยังไม่มี pay ใช้คำขอจากจัดซื้อ)
    if ((tab === "sent" || tab === "passed" || tab === "paid") && payTypeFilter) {
      out = out.filter((r) => (r.pay?.type || r.sentType) === payTypeFilter)
    }
    if (tab === "passed") {
      // วันที่ผ่าน = เวลาที่บัญชีกดผ่าน (review.at) แปลงเป็นวันไทย — ใบนำเข้าจากไฟล์ใช้วันส่งเข้าสกท
      if (passedFrom || passedTo) out = out.filter((r) => inDateRange(ictDate(r.review?.at ?? ""), passedFrom, passedTo))
    }
    // เครดิตเทอมใช้ได้ทั้งแท็บ "ส่งบัญชีแล้ว" และ "ผ่าน" (ผู้ใช้สั่ง 26/08/2026)
    // แท็บอื่นค่าค้างต้องไม่แอบกรอง จึงเช็คแท็บก่อนเสมอ
    if ((tab === "passed" || tab === "sent") && terms.length) {
      out = out.filter((r) => (r.creditTerm ? terms.includes(r.creditTerm) : terms.includes("none")))
    }
    return out
  }, [beforeSentRange, rangeOn, sentFrom, sentTo, tab, payTypeFilter, passedFrom, passedTo, terms])

  // ส่งออกแถวที่กรองอยู่เป็น Excel — โหลด xlsx ตอนกดเท่านั้น (ก้อนใหญ่ ~400KB ไม่ควรถ่วงตอนเปิดหน้า)
  // แท็บ "ผ่าน" ออกเป็น "ใบปะหน้าส่งเข้า สกท." ตามฟอร์มจริงของบัญชี (รายชิ้นสินค้า + หัวฟอร์ม
  // + ท้ายลายเซ็น) — ผู้ใช้สั่ง 20/08/2026 · แท็บอื่นยังเป็นตารางแบนเหมือนเดิม
  const exportExcel = async () => {
    const XLSX = await import("xlsx")
    if (tab === "passed") {
      // ติ๊กเลือกไว้ = ออกเฉพาะที่เลือก · ไม่ติ๊กเลย = ออกทั้งหมดที่กรองอยู่
      // (คำนวณเองตรงนี้ — selectedRows ประกาศทีหลังในไฟล์ อ้างข้ามจะพัง memoization ของ React Compiler)
      const sel = shown.filter((r) => selected.has(r.depositCode))
      const exportRows = sel.length ? sel : shown
      const res = await fetch("/api/ap-tracking/cover", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: exportRows.map((r) => r.depositCode) }),
      })
      const d = await res.json()
      if (!res.ok) { swalError("ดึงรายการสินค้าไม่สำเร็จ"); return }
      const { apCoverSheetAoa } = await import("@/lib/ap-tracking")
      const aoa = apCoverSheetAoa((d.rows ?? []) as ApCoverRow[], today)
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws["!cols"] = [3, 11, 15, 28, 34, 12, 20, 16, 22].map((w) => ({ wch: w }))
      const wb = XLSX.utils.book_new()
      // ชื่อชีตตามธรรมเนียมไฟล์จริงของบัญชี: "20.8.69"
      const [y, m, dd] = today.split("-").map(Number)
      XLSX.utils.book_append_sheet(wb, ws, `${dd}.${m}.${(y + 543) % 100}`)
      XLSX.writeFile(wb, `ใบปะหน้าสกท_${today}${payTypeFilter ? `_${payTypeFilter}` : ""}.xlsx`)
      return
    }
    const data = shown.map((r) => ({
      "เลขใบรับของ": r.depositCode,
      "วันที่รับของ": r.receivedAt,
      "คลัง": r.warehouse,
      "ซัพพลายเออร์": r.supplier,
      "PO": r.purchaseOrder,
      "ทะเบียนรถ": r.vehicle ?? "",
      "เบอร์รถ": r.fleetNo ?? "",
      "ยอดเงิน": r.amount,
      "เครดิตเทอม": r.creditTerm,
      "ประเภทการส่ง": r.pay?.type || r.sentType,
      "กดส่งเมื่อ": r.sentMarkedDate ?? "",
      "ผ่านเมื่อ": (r.review?.at ?? "").slice(0, 10),
      "ตรวจโดย": r.review?.by ?? "",
      "กำหนดจ่าย": r.pay?.payDate ?? "",
      "จ่ายจริง": r.paid?.date ?? "",
      "เลข PV": (r.paid?.paymentNos ?? []).join(", "),
      "เลขที่ Voucher": (r.docNos.voucherNos ?? []).join(", "),
      "เลขที่ใบวางบิล": (r.docNos.billingNoteNos ?? []).join(", "),
      "หมายเหตุ": r.note,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    ws["!cols"] = [14, 11, 16, 30, 13, 12, 10, 12, 10, 11, 11, 11, 22, 11, 11, 18, 18, 18, 24].map((w) => ({ wch: w }))
    const wb = XLSX.utils.book_new()
    const label = tab === "sent" ? "ส่งบัญชีแล้ว" : tab === "paid" ? "จ่ายแล้ว" : "ผ่าน"
    XLSX.utils.book_append_sheet(wb, ws, label)
    XLSX.writeFile(wb, `เจ้าหนี้${label}_${month}${payTypeFilter ? `_${payTypeFilter}` : ""}.xlsx`)
  }

  /** วันที่ใช้ตัดเดือนของแต่ละแท็บ — แท็บ "ผ่าน" ใช้วันที่บัญชีกดผ่าน
   *  ส่วน "ส่งบัญชีแล้ว" ใบยังไม่ผ่านย่อมไม่มีวันที่กดผ่าน จึงต้องใช้วันที่กดส่งแทน */
  const monthKeyOf = (r: ApRow) =>
    (tab === "passed" ? ictDate(r.review?.at ?? "") : (r.sentMarkedDate ?? "")).slice(0, 7)

  /** Excel แตกชีตตามเดือน — เดิมต้องกรองทีละเดือนแล้วกด export ทีละไฟล์
   *  ที่นี่ออกทีเดียวครบทุกเดือนที่มีในชุดที่กรองอยู่ + ชีต "รวม" ไว้ข้างหน้า
   *  ใช้ตารางแบนเสมอ ไม่ใช่ฟอร์มใบปะหน้า เพราะไฟล์นี้มีไว้เอาไปวิเคราะห์ต่อ */
  async function exportMonthly() {
    const XLSX = await import("xlsx")
    const flat = (r: ApRow) => ({
      "เลขใบรับของ": r.depositCode,
      "วันที่รับของ": r.receivedAt,
      "คลัง": r.warehouse,
      "ซัพพลายเออร์": r.supplier,
      "PO": r.purchaseOrder,
      "ทะเบียนรถ": r.vehicle ?? "",
      "เบอร์รถ": r.fleetNo ?? "",
      "ยอดเงิน": r.amount,
      "เครดิตเทอม": r.creditTerm,
      "ประเภทการส่ง": r.pay?.type || r.sentType,
      "กดส่งเมื่อ": r.sentMarkedDate ?? "",
      "ผ่านเมื่อ": ictDate(r.review?.at ?? ""),
      "ตรวจโดย": r.review?.by ?? "",
      "กำหนดจ่าย": r.pay?.payDate ?? "",
      "จ่ายจริง": r.paid?.date ?? "",
      "เลข PV": (r.paid?.paymentNos ?? []).join(", "),
      "เลขที่ Voucher": (r.docNos.voucherNos ?? []).join(", "),
      "เลขที่ใบวางบิล": (r.docNos.billingNoteNos ?? []).join(", "),
      "หมายเหตุ": r.note,
    })
    const WIDTHS = [14, 11, 16, 30, 13, 12, 10, 12, 10, 11, 11, 11, 22, 11, 11, 18, 18, 18, 24].map((w) => ({ wch: w }))
    const addSheet = (wb: ReturnType<typeof XLSX.utils.book_new>, rowsIn: ApRow[], name: string) => {
      const ws = XLSX.utils.json_to_sheet(rowsIn.map(flat))
      ws["!cols"] = WIDTHS
      XLSX.utils.book_append_sheet(wb, ws, name)
    }

    const byMonth = new Map<string, ApRow[]>()
    for (const r of shown) {
      const k = monthKeyOf(r) || "ไม่ระบุเดือน"
      const arr = byMonth.get(k) ?? []
      arr.push(r)
      byMonth.set(k, arr)
    }
    // เดือนใหม่อยู่หน้า — คนเปิดไฟล์มักดูเดือนล่าสุดก่อน · "ไม่ระบุเดือน" ไว้ท้ายสุด
    const months = [...byMonth.keys()].sort((a, b) =>
      a === "ไม่ระบุเดือน" ? 1 : b === "ไม่ระบุเดือน" ? -1 : b.localeCompare(a))

    const wb = XLSX.utils.book_new()
    addSheet(wb, shown, "รวม")
    for (const k of months) {
      // ชื่อชีตตามธรรมเนียมไฟล์บัญชี "ส.ค. 69"
      addSheet(wb, byMonth.get(k)!, thaiMonthLabel(k))
    }
    const label = tab === "passed" ? "ผ่าน" : tab === "sent" ? "ส่งบัญชีแล้ว" : "ทั้งหมด"
    const basis = tab === "passed" ? "ตามวันที่ผ่าน" : "ตามวันที่กดส่ง"
    XLSX.writeFile(wb, `เจ้าหนี้${label}_รายเดือน_${basis}_${today}.xlsx`)
  }

  // มุมมองจัดกลุ่มแบ่งหน้าเป็น "รายวัน" ไม่ใช่รายแถว — ไม่งั้นวันเดียวจะถูกหั่นคาหน้า
  // แล้วยอดรวมบนหัวกลุ่ม (คิดจากแถวที่โชว์) จะไม่ตรงกับยอดจริงของวันนั้น
  const dayGroups = useMemo(
    () => (grouped ? groupByDate(shown, (r) => r.sentMarkedDate) : []),
    [grouped, shown],
  )
  const units = grouped ? dayGroups.length : shown.length

  const totalPages = perPage === 0 ? 1 : Math.max(1, Math.ceil(units / perPage))
  // clamp ระหว่างที่จำนวนแถวลดลงก่อน state หน้าจะถูกตั้งใหม่ — ตารางจึงไม่กะพริบเป็นหน้าว่าง
  const safePage = Math.min(page, totalPages)
  const slice = <T,>(xs: T[]) => (perPage === 0 ? xs : xs.slice((safePage - 1) * perPage, safePage * perPage))
  const pagedGroups = useMemo(
    () => (grouped ? slice(dayGroups) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grouped, dayGroups, safePage, perPage],
  )
  const paged = useMemo(
    () => (pagedGroups ? pagedGroups.flatMap((g) => g.rows) : slice(shown)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pagedGroups, shown, safePage, perPage],
  )
  const firstIdx = units === 0 ? 0 : perPage === 0 ? 1 : (safePage - 1) * perPage + 1
  const lastIdx  = perPage === 0 ? units : Math.min(safePage * perPage, units)
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
    const thu = payThursday(todayICT())
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
    patch: { docs: ApDocs; status: ApStatus; sentType: string; sentDate: string; note: string
      review?: { status: string; note: string }; pay?: ApPay | null },
  ) => {
    const { docs, status, sentType, sentDate, note, review, pay } = patch
    const before = rows.find((r) => r.depositCode === depositCode)
    const sentMoved = Boolean(before) && (before!.sentDate !== sentDate || before!.sentType !== sentType)
    const next = { docs, status, sentType, sentDate, note, review, pay: pay ?? undefined,
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

  // ดึงข้อมูลสดจาก ATMS — ใช้ endpoint เดียวกับปุ่มรีเฟรชหน้า /pr (pipeline light ตัวเดียวกัน
  // rate-limit ร่วมกัน 1 ครั้ง/ชม.) · จบแล้วโหลดตารางใหม่ให้เอง
  const pullAtms = async () => {
    if (pulling) return
    setPulling(true); setPullProgress(2)
    try {
      const base = await fetch("/api/pr/refresh/status", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}))
      const baseFinished = base?.last_run?.finished_at ?? null
      const res = await fetch("/api/pr/refresh", { method: "POST" })
      const d = await res.json().catch(() => ({}))
      if (res.status === 429) { swalError(`เพิ่งดึงข้อมูลไป · ดึงใหม่ได้อีกใน ${d.retry_after_min} นาที`); return }
      if (!res.ok && d.status !== "already_running") { swalError("สั่งดึงข้อมูลไม่สำเร็จ"); return }

      const eta = (d.eta_sec || 720) * 1000
      const start = Date.now()
      const timer = setInterval(() => setPullProgress(Math.min(95, 3 + ((Date.now() - start) / eta) * 92)), 500)
      let done = false
      for (let i = 0; i < 200 && !done; i++) {
        await new Promise((r) => setTimeout(r, 6000))
        const st = await fetch("/api/pr/refresh/status", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}))
        const fin = st?.last_run?.finished_at ?? null
        if (fin && fin !== baseFinished) done = true
      }
      clearInterval(timer)
      setPullProgress(100)
      await load()
      swalToast("success", done ? "ดึงข้อมูล ATMS แล้ว" : "กำลังดึงอยู่ — รีเฟรชอีกครั้งภายหลัง")
    } finally {
      setTimeout(() => { setPulling(false); setPullProgress(0) }, 800)
    }
  }

  // ค้นข้ามเดือน — ยิงเฉพาะตอน "พิมพ์คำค้นแล้วเดือนนี้ไม่เจอสักใบ" (ไม่เจอ = สัญญาณว่า
  // ของอาจอยู่เดือนอื่น) · debounce 350ms กันยิงระหว่างพิมพ์ · ยกเลิกคำขอเก่าเมื่อพิมพ์ต่อ
  const qTrim = q.trim()
  const qHasLocalHit = useMemo(() => {
    if (!qTrim) return true
    const rx = new RegExp(qTrim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    return rows.some((r) => matchQ(r, rx))
  }, [rows, qTrim])
  useEffect(() => {
    if (qTrim.length < 3 || busy || qHasLocalHit) {
      // ตั้งค่าใน timeout เพื่อไม่ setState แบบ synchronous ใน effect (กติกา lint ของรีโป)
      const t = setTimeout(() => setCrossHits(null), 0)
      return () => clearTimeout(t)
    }
    const ac = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ap-tracking/search?q=${encodeURIComponent(qTrim)}`, { signal: ac.signal })
        const d = await res.json()
        if (!ac.signal.aborted && res.ok) setCrossHits((d.hits ?? []) as ApCrossHit[])
      } catch { /* ถูกยกเลิกหรือเน็ตพัง — เงียบไว้ ช่องค้นหลักยังทำงานปกติ */ }
    }, 350)
    return () => { clearTimeout(t); ac.abort() }
  }, [qTrim, busy, qHasLocalHit])

  // กระโดดไปเดือนของใบที่เจอ — คงคำค้นไว้ให้กรองต่อในเดือนปลายทางเลย
  const gotoHit = (hit: ApCrossHit) => {
    changeMonth(hit.month)
    setCrossHits(null)
  }

  // เดือนที่เลือกอยู่ก่อนเส้น go-live ทั้งเดือนหรือไม่ — ใช้ helper ตัวเดียวกับที่ API ใช้ตัดเดือน
  const scopeSince = summary?.since || AP_GO_LIVE
  // โหมดข้ามเดือนไม่ได้ยึดเดือนใดเป็นหลัก — เช็คนี้จึงไม่มีความหมาย และถ้าปล่อยไว้จะขึ้นข้อความ
  // "เดือนนี้อยู่ก่อนวันที่ระบบเริ่มติดตาม" ทั้งที่กำลังค้นทั้งฐานอยู่
  const monthOutOfScope = !crossMonth && !monthInApScope(month, scopeSince)

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* แถบคืบหน้าบนสุด — สัญญาณเดียวที่เห็นได้แน่นอนไม่ว่าจะเลื่อนอยู่ตรงไหนของหน้า
          กันที่ไว้เสมอ (h-0.5) ไม่ให้เนื้อหาขยับขึ้นลงตอนโหลดเสร็จ */}
      <div className="relative h-0.5 overflow-hidden rounded-full" aria-hidden="true">
        {busy && <div className="bar-indeterminate absolute inset-0 rounded-full bg-emerald-500/15 text-emerald-500" />}
      </div>

      <ApHeader
        summary={summary} loading={busy}
        month={month} onMonth={changeMonth}
        q={q} onQ={(v) => applyFilter(() => setQ(v))}
        onRefresh={load}
        tab={tab} onTab={(v) => applyFilter(() => {
          setTab(v); setViewBy("invoice")
          // เปลี่ยนแท็บ = เริ่มต้นไม่กรองเสมอ (ผู้ใช้สั่ง 21/08/2026: default no filter date)
          // ไม่งั้นช่วงวันที่/ประเภทที่ตั้งไว้ครั้งก่อนค้างอยู่ กลับมาแท็บเดิมแล้วข้อมูลหายไปเฉย ๆ
          setSentFrom(""); setSentTo(""); setPayTypeFilter("")
          setPassedFrom(""); setPassedTo(""); setTerms([])
        })}
        viewBy={viewBy} onViewBy={(v) => applyFilter(() => setViewBy(v))}
        warehouse={warehouse} onWarehouse={(v) => applyFilter(() => setWarehouse(v))}
        warehouses={warehouses}
        totalShown={shown.length}
        sentView={sentView}
        sentFrom={sentFrom} sentTo={sentTo} crossMonth={crossMonth}
        onSentRange={(from, to) => applyFilter(() => {
          // ช่วงวันที่ยิงคิวรีใหม่แล้ว (ข้ามเดือน) — ตั้ง pending เหมือนเปลี่ยนเดือน ไม่งั้นระหว่าง
          // debounce 400ms ตารางจะโชว์แถวของช่วงเก่าค้างอยู่ราวกับเป็นผลของช่วงใหม่
          setSentFrom(from); setSentTo(to); setPending(true)
        })}
        groupSent={groupSent} onGroupSent={(v) => applyFilter(() => setGroupSent(v))}
        sentDays={dayGroups.length}
        today={today}
        canPull={month === thisMonth()}
        pulling={pulling} pullProgress={pullProgress} onPull={pullAtms}
        crossHits={crossHits} onGotoHit={gotoHit}
        payTypeFilter={payTypeFilter} onPayTypeFilter={(v) => applyFilter(() => setPayTypeFilter(v))}
        passedFrom={passedFrom} passedTo={passedTo}
        onPassedRange={(f, t) => applyFilter(() => { setPassedFrom(f); setPassedTo(t) })}
        terms={terms} onTerms={(v) => applyFilter(() => setTerms(v))}
        onExport={exportExcel} exportSelected={tab === "passed" ? selectedRows.length : 0}
        onExportMonthly={() => void exportMonthly()}
        monthlyBasis={tab === "passed" ? "วันที่ผ่าน" : "วันที่กดส่ง"}
      />

      {/* ผลลัพธ์ถูกตัดเพราะชนเพดานแถว — ยอดสรุปทุกตัวข้างบนยังไม่ครบ ต้องบอกให้ชัด ไม่ปล่อยให้เงียบ */}
      {summary?.truncated && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          ⚠️ ข้อมูลถูกตัดที่ {summary.limit.toLocaleString("th-TH")} แถว — <b>ยอดสรุปทั้งหมดยังไม่ครบทั้งช่วง</b>{" "}
          แคบช่วงลงด้วยการเลือกคลังหรือใส่คำค้น
        </div>
      )}

      {summary && summary.counted > summary.total && !tab && (
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
          {/* แท็บผ่าน: การเลือกคือ "เลือกใบไป export ใบปะหน้า" ไม่ใช่ส่งนอกรอบ (ส่งไปแล้วทุกใบ) */}
          {tab === "passed" ? (
            <button onClick={exportExcel}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
              📄 Export ใบปะหน้า ({selectedRows.length} ใบ)
            </button>
          ) : (
          <button onClick={bulkSend} disabled={bulkRunning}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {bulkRunning ? "กำลังส่ง…" : `💸 ส่งบัญชีนอกรอบ · รอบ ${thaiDate(payThursday(today))}`}
          </button>
          )}
          {/* แจ้งการเงินจากใบที่เลือก — ราย DD เลือกหลายใบได้ (ผู้ใช้สั่ง 19/08/2026) */}
          <button onClick={() => setFinanceItems(selectedRows.map((r) => ({
              depositCode: r.depositCode, supplier: r.supplier, amount: r.amount,
              purchaseOrder: r.purchaseOrder, docNos: r.docNos,
            })))}
            className="rounded-lg border border-emerald-300 px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-900/30">
            ✉️ แจ้งการเงิน (นอกรอบ)
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-emerald-800 hover:underline dark:text-emerald-300">
            ล้างการเลือก
          </button>
        </div>
      )}

      {viewBy === "supplier" ? (
        <ApSupplierTable rows={supplierRows} loading={busy} onPick={pickSupplier} />
      ) : (
      <ApTable
        rows={paged} groups={pagedGroups} showSentMarked={sentView} unit={grouped ? "วัน" : "ใบ"}
        selectMode={tab === "passed" ? "export" : "send"}
        loading={busy}
        selected={selected} onToggle={toggle} onToggleAll={toggleAll}
        onOpen={openDetail} onSend={openSent}
        page={safePage} totalPages={totalPages} pageNumbers={pageNumbers}
        firstIdx={firstIdx} lastIdx={lastIdx} totalRows={units}
        perPage={perPage} perPageOptions={PER_PAGE_OPTIONS}
        onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1) }}
        emptyNote={rangeOn && beforeSentRange.length > 0 ? (
          // ตารางว่างเพราะช่วงวันที่ที่เลือก ไม่ใช่เพราะไม่มีใบในแท็บนี้ — ต้องบอกให้ชัด ไม่งั้นคนจะคิดว่าข้อมูลหาย
          <div className="space-y-1">
            <div className="font-medium text-gray-500 dark:text-gray-400">ไม่มีใบที่กดส่งบัญชีในช่วงวันที่ที่เลือก</div>
            <div className="text-xs">แท็บนี้มีใบอยู่ แต่ถูกกรองออกด้วยช่วงวันที่ — กด “ล้างช่วงวันที่” เพื่อดูทั้งหมด</div>
          </div>
        ) : monthOutOfScope ? (
          // เดือนก่อนเส้น go-live ว่างเพราะ "ไม่อยู่ในขอบเขตระบบ" ไม่ใช่เพราะหาไม่เจอ — ต้องบอกให้ชัด
          <div className="space-y-1">
            <div className="font-medium text-gray-500 dark:text-gray-400">
              เดือนนี้อยู่ก่อนวันที่ระบบเริ่มติดตามเจ้าหนี้ ({thaiDate(scopeSince)})
            </div>
            <div className="text-xs">ใบรับของก่อนวันดังกล่าวจัดการในไฟล์ Excel ของกระบวนการเดิม จึงไม่ถูกดึงเข้ามา</div>
          </div>
        ) : crossMonth ? "ไม่มีใบที่กดส่งบัญชีในช่วงวันที่นี้ (ค้นจากทุกเดือนแล้ว)"
          : (tab || q ? "ไม่มีใบในขั้นนี้" : "ยังไม่มีใบรับของในเดือนนี้")}
      />
      )}

      {sentFor && <SendDialog row={sentFor} onClose={() => setSentFor(null)} onSent={setSent} />}
      {financeItems && <ApFinanceRequestDialog items={financeItems} onClose={() => setFinanceItems(null)} />}
      {/* key = เลขใบ · เปลี่ยนใบแล้ว component เกิดใหม่ ทำให้ draft เริ่มจากใบใหม่เสมอ */}
      {detailFor && (
        <ApTrackingDetail key={detailFor.depositCode} row={detailFor} onClose={() => setDetailFor(null)} onSaved={onDetailSaved} />
      )}
    </div>
  )
}
