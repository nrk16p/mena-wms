"use client"

import { useEffect, useMemo, useState, Fragment } from "react"
import { FileText, Search, RefreshCw, X, ChevronRight } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"

type Cmp = "ok" | "anomaly" | "no_po"
type VatRule = "incl" | "excl"
type Relation = "eq" | "po7" | "other" | "none"
type Row = {
  pr_code: string
  date: string
  warehouse: string
  dept: string
  plate: string
  requester: string
  total: number
  po_total: number
  po_diff: number
  vat_rule: VatRule
  relation: Relation
  cmp: Cmp
  note: string
  po_codes: string[]
  po_count: number
  received_status: string[]
  suppliers: string[]
  pos: PoDetail[]
  pr_detail_id: string
  po_due: string
  expected_delivery: string
  expected_source: "manual" | "po" | "none"
  track: "pr" | "po" | "waiting"
  stage: Stage
  complete: boolean
  days_to_due: number | null
  overdue: boolean
}
type Stage = "pr" | "po_ok" | "po_bad" | "due" | "overdue"
type PoDetail = { code: string; date: string; supplier: string; total: number; received: string; approver: string; due: string; detail_id: string }
type LastRefresh = { at: string | null; from_date: string; ok: boolean } | null
type ApiResp = { count: number; total_value: number; no_po: number; by_cmp: Record<Cmp, number>; by_stage: Record<Stage, number>; last_refresh?: LastRefresh; rows: Row[] }

// เวลาแบบ "x นาที/ชม./วันที่แล้ว" (ไทย)
function timeAgo(iso: string | null): string {
  if (!iso) return "—"
  const t = Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z")
  if (isNaN(t)) return "—"
  const min = Math.floor((Date.now() - t) / 60000)
  if (min < 1) return "เมื่อสักครู่"
  if (min < 60) return `${min} นาทีที่แล้ว`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ชม.ที่แล้ว`
  return `${Math.floor(hr / 24)} วันที่แล้ว`
}

// สถานะหลัก (ติดตาม): เปิด PR → เปิด PO (ครบ/ไม่ครบ) → กำหนดส่งสินค้า → เกินกำหนด
const STAGE_META: Record<Stage, { label: string; full: string; cls: string; dot: string }> = {
  pr:      { label: "เปิด PR",        full: "เปิด PR (ยังไม่มี PO)",                  cls: "bg-[#F1F5F9] text-[#475569] dark:bg-white/10 dark:text-gray-300",    dot: "#64748B" },
  po_ok:   { label: "เปิด PO · ยอดครบ", full: "เปิด PO · ยอดตรงและรายการครบ",         cls: "bg-[#DBEAFE] text-[#1D4ED8] dark:bg-blue-500/15 dark:text-blue-300",  dot: "#1D4ED8" },
  po_bad:  { label: "เปิด PO · ไม่ครบ", full: "เปิด PO · ยอด/รายการไม่ครบ",           cls: "bg-[#FEF3C7] text-[#B07D12] dark:bg-amber-900/25 dark:text-amber-300", dot: "#E8A317" },
  due:     { label: "กำหนดส่งสินค้า",  full: "กำหนดส่งสินค้า · ยังไม่เกิน",           cls: "bg-[#DCFCE7] text-[#15803D] dark:bg-green-500/15 dark:text-green-300", dot: "#15803D" },
  overdue: { label: "เกินกำหนด",       full: "เกินกำหนดส่งสินค้าแล้ว",                cls: "bg-[#FEE2E2] text-[#DC2626] dark:bg-red-500/15 dark:text-red-300",    dot: "#DC2626" },
}
// Pipeline funnel (ยุบ po_ok+po_bad เป็นขั้น "เปิด PO" · po_ok≈0)
const FUNNEL: { key: string; label: string; stages: Stage[]; color: string; tint: string }[] = [
  { key: "pr",   label: "เปิด PR",        stages: ["pr"],              color: "#64748B", tint: "#F1F5F9" },
  { key: "po",   label: "เปิด PO",        stages: ["po_ok", "po_bad"], color: "#E8A317", tint: "#FEF7E6" },
  { key: "due",  label: "กำหนดส่งสินค้า", stages: ["due"],             color: "#15803D", tint: "#EAF6EE" },
  { key: "over", label: "เกินกำหนด",      stages: ["overdue"],         color: "#DC2626", tint: "#FEECEC" },
]

const CMP_META: Record<Cmp, { label: string; cls: string; dot: string }> = {
  ok:      { label: "ถูกต้อง",   cls: "bg-[#DCFCE7] text-[#15803D] dark:bg-green-500/15 dark:text-green-300",  dot: "#15803D" },
  anomaly: { label: "ผิดปกติ",   cls: "bg-[#FEE2E2] text-[#DC2626] dark:bg-red-500/15 dark:text-red-300",     dot: "#DC2626" },
  no_po:   { label: "ยังไม่มี PO", cls: "bg-[#FEF3C7] text-[#B07D12] dark:bg-amber-900/25 dark:text-amber-300", dot: "#B07D12" },
}

// ── เทียบราย SKU ──
type ItemStatus = "ok" | "qty" | "price" | "missing_po" | "extra_po"
type ItemRow = {
  sku: string; name: string; group: string
  pr_qty: number | null; pr_total: number | null
  po_qty: number | null; po_total: number | null
  received: number | null; outstanding: number | null
  status: ItemStatus
}
type ItemsResp = { pr: string; has_pr_items: boolean; has_po_items: boolean; pr_item_count: number; po_item_count: number; rows: ItemRow[]; summary: Record<ItemStatus, number> }
const ITEM_META: Record<ItemStatus, { label: string; cls: string }> = {
  ok:         { label: "ตรง",       cls: "bg-[#DCFCE7] text-[#15803D] dark:bg-green-500/15 dark:text-green-300" },
  qty:        { label: "จำนวนต่าง", cls: "bg-[#FEE2E2] text-[#DC2626] dark:bg-red-500/15 dark:text-red-300" },
  price:      { label: "ราคาต่าง",  cls: "bg-[#FEF3C7] text-[#B07D12] dark:bg-amber-900/25 dark:text-amber-300" },
  missing_po: { label: "ขาดใน PO",  cls: "bg-[#FEE2E2] text-[#DC2626] dark:bg-red-500/15 dark:text-red-300" },
  extra_po:   { label: "เกินใน PO", cls: "bg-[#DBEAFE] text-[#1D4ED8] dark:bg-blue-500/15 dark:text-blue-300" },
}
const ITEM_ORDER: ItemStatus[] = ["ok", "qty", "price", "missing_po", "extra_po"]
const qty = (v: number | null) => (v == null ? "—" : (Math.round(v * 100) / 100).toLocaleString("th-TH"))

// "YYYY-MM-DD" → วันไทยสั้น
function fmtISO(d: string) {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? fmtDate(`${m[3]}/${m[2]}/${m[1]}`) : (d || "—")
}

// อายุงาน: จำนวนวันตั้งแต่เปิด PR (DD/MM/YYYY) ถึงวันนี้ (Asia/Bangkok)
function ageDays(d: string): number | null {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
  return Math.max(0, Math.round((Date.parse(today) - Date.parse(`${m[3]}-${m[2]}-${m[1]}`)) / 86400000))
}
// สีตามช่วงอายุ (เหมือน repair-external): <8 เขียว · 8–14 เหลือง · 15+ แดง
const ageColor = (d: number | null) => d == null ? "#9ca3af" : d >= 15 ? "#DC2626" : d >= 8 ? "#B07D12" : "#1B8C4B"

// เทียบวันกำหนดส่ง (YYYY-MM-DD) กับวันนี้ (Asia/Bangkok)
function dueInfo(expected: string): { days: number; overdue: boolean } | null {
  if (!expected) return null
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
  const days = Math.round((Date.parse(expected) - Date.parse(today)) / 86400000)
  return { days, overdue: days < 0 }
}

const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const bahtShort = (n: number) => Math.round(n).toLocaleString("th-TH")   // ตารางกระชับ (ไม่มีทศนิยม)
// ลิงก์ไปหน้า ATMS — ใช้ view/id ตรงถ้ามี detail_id (กัน ?code หลุดหลัง login), ไม่งั้น fallback ?code=
const atmsPr = (code: string, id?: string) => id
  ? `https://www.mena-atms.com/inv/purchase.request/view/id/${id}`
  : `https://www.mena-atms.com/inv/purchase.request/index?code=${encodeURIComponent(code)}`
const atmsPo = (code: string, id?: string) => id
  ? `https://www.mena-atms.com/inv/purchase.order/view/id/${id}`
  : `https://www.mena-atms.com/inv/purchase.order/index?code=${encodeURIComponent(code)}`
const sansThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }
const mitr = { fontFamily: "'Mitr', sans-serif" }

// "24/07/2026" → วันที่ไทยสั้น
function fmtDate(d: string) {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return d || "—"
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
  return `${+m[1]} ${months[+m[2] - 1]} ${(+m[3] + 543) % 100}`
}

export function PrPage() {
  const [data, setData]       = useState<ApiResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ]             = useState("")
  const [warehouse, setWarehouse] = useState("")
  const [dept, setDept]       = useState("")
  const [funnelFilter, setFunnelFilter] = useState<string>("")
  const [poOverOnly, setPoOverOnly] = useState(false)   // เฉพาะ PO ยอดเกิน PR (เกิน VAT)
  const [page, setPage]       = useState(1)
  const [detail, setDetail]   = useState<Row | null>(null)
  const [deliveryDraft, setDeliveryDraft] = useState("")
  const [savingTrack, setSavingTrack] = useState(false)
  const [items, setItems]     = useState<ItemsResp | null>(null)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [progress, setProgress] = useState(0)
  const PAGE_SIZE = 25

  useEffect(() => { setDeliveryDraft(detail?.expected_source === "manual" ? detail.expected_delivery : "") }, [detail])

  // โหลดรายการสินค้าเมื่อเปิด detail
  useEffect(() => {
    if (!detail) { setItems(null); return }
    setItemsLoading(true)
    fetch(`/api/pr/items?pr=${encodeURIComponent(detail.pr_code)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setItems(d?.rows ? d : null))
      .catch(() => setItems(null))
      .finally(() => setItemsLoading(false))
  }, [detail])

  async function saveTrack() {
    if (!detail) return
    setSavingTrack(true)
    try {
      const res = await fetch("/api/pr/track", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prCode: detail.pr_code, expectedDelivery: deliveryDraft }),
      })
      if (!res.ok) throw new Error()
      const patch = (r: Row): Row => {
        const eff = deliveryDraft || r.po_due
        const di = dueInfo(eff)
        const track: Row["track"] = r.po_count === 0 ? "pr" : (eff ? "waiting" : "po")
        const stage: Stage =
          r.po_count === 0 ? "pr"
          : !r.complete    ? "po_bad"
          : eff            ? (di?.overdue ? "overdue" : "due")
          : "po_ok"
        return {
          ...r,
          expected_delivery: eff,
          expected_source: deliveryDraft ? "manual" : (r.po_due ? "po" : "none"),
          track,
          stage,
          days_to_due: di?.days ?? null,
          overdue: di?.overdue ?? false,
        }
      }
      setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.pr_code === detail.pr_code ? patch(r) : r)) } : d))
      setDetail((prev) => (prev ? patch(prev) : prev))
    } catch {
      /* เงียบ */
    } finally {
      setSavingTrack(false)
    }
  }

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/pr", { cache: "no-store" })
      const d   = await res.json()
      setData(d?.rows ? d : { count: 0, total_value: 0, no_po: 0, by_cmp: { ok: 0, anomaly: 0, no_po: 0 }, by_stage: { pr: 0, po_ok: 0, po_bad: 0, due: 0, overdue: 0 }, rows: [] })
    } catch {
      setData({ count: 0, total_value: 0, no_po: 0, by_cmp: { ok: 0, anomaly: 0, no_po: 0 }, by_stage: { pr: 0, po_ok: 0, po_bad: 0, due: 0, overdue: 0 }, rows: [] })
    } finally {
      setLoading(false)
    }
  }

  // นาทีที่ต้องรอก่อนรีเฟรชได้อีก (rate-limit 60 นาที จาก run ล่าสุด)
  const cooldownMin = useMemo(() => {
    const at = data?.last_refresh?.at
    if (!at) return 0
    const t = Date.parse(at.endsWith("Z") || at.includes("+") ? at : at + "Z")
    if (isNaN(t)) return 0
    const ageMin = (Date.now() - t) / 60000
    return ageMin < 60 ? Math.ceil(60 - ageMin) : 0
  }, [data])

  // สั่งดึงข้อมูลใหม่ (light 7 วัน) + progress อิงเวลา จนจบแล้ว reload
  async function doRefresh() {
    if (refreshing || cooldownMin > 0) return
    setRefreshing(true); setProgress(2)
    try {
      // baseline: finished_at ของ light run ล่าสุด (ไว้ตรวจว่ามี run ใหม่จบ)
      const base = await fetch("/api/pr/refresh/status", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}))
      const baseFinished = base?.last_run?.finished_at ?? null

      const res = await fetch("/api/pr/refresh", { method: "POST" })
      const d = await res.json().catch(() => ({}))
      if (res.status === 429) { swalError(`เพิ่งอัปเดตไป · รีเฟรชได้อีกใน ${d.retry_after_min} นาที`); return }
      if (!res.ok && d.status !== "already_running") { swalError("สั่งรีเฟรชไม่สำเร็จ"); return }

      const eta = (d.eta_sec || 720) * 1000
      const start = Date.now()
      const timer = setInterval(() => setProgress(Math.min(95, 3 + ((Date.now() - start) / eta) * 92)), 500)
      let done = false
      for (let i = 0; i < 200 && !done; i++) {
        await new Promise((r) => setTimeout(r, 6000))
        const s = await fetch("/api/pr/refresh/status", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}))
        const fin = s?.last_run?.finished_at ?? null
        if (fin && fin !== baseFinished) done = true   // มี run ใหม่จบแล้ว
      }
      clearInterval(timer)
      setProgress(100)
      await load()
      swalToast("success", done ? "อัปเดตข้อมูลแล้ว" : "ดึงข้อมูลอยู่ (ลองรีโหลดอีกครั้งภายหลัง)")
    } finally {
      setTimeout(() => { setRefreshing(false); setProgress(0) }, 800)
    }
  }
  useEffect(() => { load() }, [])

  // URL state — อ่านจาก ?q/wh/dept/stage ตอนเข้า แล้ว sync กลับเมื่อกรองเปลี่ยน (แชร์ลิงก์ได้)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get("q")) setQ(p.get("q")!)
    if (p.get("wh")) setWarehouse(p.get("wh")!)
    if (p.get("dept")) setDept(p.get("dept")!)
    if (p.get("stage")) setFunnelFilter(p.get("stage")!)
    if (p.get("over") === "1") setPoOverOnly(true)
  }, [])
  useEffect(() => {
    const p = new URLSearchParams()
    if (q) p.set("q", q)
    if (warehouse) p.set("wh", warehouse)
    if (dept) p.set("dept", dept)
    if (funnelFilter) p.set("stage", funnelFilter)
    if (poOverOnly) p.set("over", "1")
    const qs = p.toString()
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname)
  }, [q, warehouse, dept, funnelFilter, poOverOnly])

  const rows = data?.rows ?? []
  const warehouses = useMemo(() => [...new Set(rows.map((r) => r.warehouse).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th")), [rows])
  const depts      = useMemo(() => [...new Set(rows.map((r) => r.dept).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th")), [rows])

  // กรองด้วย ค้นหา/คลัง/แผนก ก่อน (ใช้คำนวณตัวเลขสรุปสถานะ)
  const baseFiltered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (warehouse && r.warehouse !== warehouse) return false
      if (dept && r.dept !== dept) return false
      if (!kw) return true
      return [r.pr_code, r.plate, r.requester, r.note, r.warehouse, r.dept, ...r.po_codes]
        .join(" ").toLowerCase().includes(kw)
    })
  }, [rows, q, warehouse, dept])

  // PO ยอดเกิน PR (เกิน VAT 7%) — ต้องตรวจราคาที่แพงขึ้น
  const isPoOver = (r: Row) => r.po_count > 0 && r.po_total > r.total * 1.07 + 0.05
  const poOverCount = useMemo(() => baseFiltered.filter(isPoOver).length, [baseFiltered])

  const stageCounts = useMemo(() => {
    const c: Record<Stage, number> = { pr: 0, po_ok: 0, po_bad: 0, due: 0, overdue: 0 }
    for (const r of baseFiltered) c[r.stage]++
    return c
  }, [baseFiltered])
  // จำนวนต่อขั้น funnel + ตัวย่อยที่ต้องเตือน
  const funnelCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const f of FUNNEL) m[f.key] = f.stages.reduce((a, s) => a + stageCounts[s], 0)
    return m
  }, [stageCounts])

  // กรองตามขั้น funnel ที่เลือก
  const stagesOf = (key: string) => FUNNEL.find((f) => f.key === key)?.stages ?? []
  const filtered = useMemo(() => {
    const set = funnelFilter ? new Set(stagesOf(funnelFilter)) : null
    return baseFiltered.filter((r) => (!set || set.has(r.stage)) && (!poOverOnly || isPoOver(r)))
  }, [baseFiltered, funnelFilter, poOverOnly])

  const sumValue = useMemo(() => filtered.reduce((a, r) => a + (r.total || 0), 0), [filtered])
  // เกินกำหนดเฉลี่ย (สำหรับสรุปตอนกรอง overdue)
  const avgOverdue = useMemo(() => {
    const od = filtered.filter((r) => r.overdue && r.days_to_due !== null)
    return od.length ? Math.round(od.reduce((a, r) => a + Math.abs(r.days_to_due!), 0) / od.length) : 0
  }, [filtered])

  // เรียง: เกินกำหนด(มากสุด)→ไม่ครบ→ใกล้ครบ→เปิด PR · ให้งานเร่งด่วนขึ้นก่อน
  const sorted = useMemo(() => {
    const rank: Record<Stage, number> = { overdue: 0, po_bad: 1, due: 2, pr: 3, po_ok: 4 }
    return [...filtered].sort((a, b) => {
      if (rank[a.stage] !== rank[b.stage]) return rank[a.stage] - rank[b.stage]
      if (a.stage === "overdue" || a.stage === "due") return (a.days_to_due ?? 0) - (b.days_to_due ?? 0)
      return (ageDays(b.date) ?? 0) - (ageDays(a.date) ?? 0)
    })
  }, [filtered])

  // pagination — รีเซ็ตหน้าเมื่อค้นหา/กรองเปลี่ยน
  useEffect(() => { setPage(1) }, [q, warehouse, dept, funnelFilter, poOverOnly])
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const curPage    = Math.min(page, totalPages)
  const pageRows   = useMemo(() => sorted.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE), [sorted, curPage])

  return (
    <div className="w-full px-3 py-5 sm:px-4 sm:py-6" style={sansThai}>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]">
            <FileText size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={mitr}>จัดการติดตามสินค้า (PR)</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              PR อนุมัติแล้วที่ยังไม่รับของ · {loading ? "…" : `${filtered.length} รายการ`}
              {!loading && data?.last_refresh && (
                <span className="ml-1 text-[#1B8C4B]" title={data.last_refresh.at ?? ""}>· ข้อมูลอัปเดต {timeAgo(data.last_refresh.at)}</span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={doRefresh}
          disabled={refreshing || cooldownMin > 0}
          title={cooldownMin > 0 ? `รีเฟรชได้อีกใน ${cooldownMin} นาที (จำกัด 1 ครั้ง/ชม.)` : "ดึงข้อมูลใหม่จาก ATMS (30 วันล่าสุด ~12 นาที)"}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition ${
            refreshing || cooldownMin > 0
              ? "cursor-not-allowed border border-gray-200 dark:border-white/10 text-gray-400"
              : "border border-[#1B8C4B] text-[#1B8C4B] hover:bg-[#EAF6EE] dark:hover:bg-[#1B8C4B]/10"
          }`}
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? `กำลังดึงข้อมูล ${Math.round(progress)}%` : cooldownMin > 0 ? `รีเฟรชได้อีกใน ${cooldownMin} นาที` : "รีเฟรชข้อมูล"}
        </button>
      </div>

      {/* Progress bar ตอนรีเฟรช */}
      {refreshing && (
        <div className="mb-3 rounded-lg border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] p-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-[#6B7C72] dark:text-gray-400">
            <span>กำลังดึงข้อมูลจาก ATMS (30 วันล่าสุด)…</span>
            <span className="font-medium text-[#1B8C4B]">{Math.round(progress)}%{progress < 95 ? " · ประมาณ ~12 นาที" : " · ใกล้เสร็จ"}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
            <div className="h-2 rounded-full bg-[#1B8C4B] transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* Pipeline funnel — สถานะการติดตาม (คลิกที่ขั้นเพื่อกรอง) */}
      <div className="mb-3 rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9AA8A0]">สถานะการติดตาม · งานไหลซ้าย → ขวา</p>
          <span className="text-xs text-gray-400">
            {loading ? "…" : `${filtered.length} รายการ · มูลค่า ${baht(sumValue)} บาท`}
            {!loading && funnelFilter === "over" && avgOverdue > 0 && <span className="text-[#DC2626]"> · เกินเฉลี่ย {avgOverdue} วัน</span>}
            {funnelFilter && <button onClick={() => setFunnelFilter("")} className="ml-2 font-medium text-[#1B8C4B] hover:underline">แสดงทั้งหมด</button>}
          </span>
        </div>
        <div className="grid grid-cols-2 items-stretch gap-2 sm:flex sm:flex-wrap">
          {FUNNEL.map((f, i) => {
            const active = funnelFilter === f.key
            const warn = f.key === "po" ? stageCounts.po_bad : 0
            return (
              <Fragment key={f.key}>
                {i > 0 && <div className="hidden items-center text-[#CBD5E1] dark:text-white/20 sm:flex"><ChevronRight size={18} /></div>}
                <button
                  onClick={() => setFunnelFilter(active ? "" : f.key)}
                  className="relative min-w-[120px] flex-1 rounded-xl border p-3 text-left transition"
                  style={{ borderColor: active ? f.color : "#EEF2F0", boxShadow: active ? `0 0 0 1.5px ${f.color}` : undefined }}
                >
                  <div className="text-[11px] font-semibold" style={{ color: f.color }}>{f.label}</div>
                  <div className="mt-1 text-[26px] font-semibold leading-none text-[#14271C] dark:text-white" style={mitr}>{loading ? "—" : funnelCounts[f.key]}</div>
                  {warn > 0 && <div className="mt-0.5 text-[10px] font-semibold text-[#B07D12]">⚠ {warn} ไม่ครบ</div>}
                </button>
              </Fragment>
            )
          })}
        </div>
        {!loading && baseFiltered.length > 0 && (
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
            {FUNNEL.map((f) => {
              const n = funnelCounts[f.key]
              return n ? <div key={f.key} title={`${f.label} ${n}`} style={{ width: `${(n / baseFiltered.length) * 100}%`, background: f.color }} /> : null
            })}
          </div>
        )}
      </div>

      {/* Toolbar (sticky) */}
      <div className="sticky top-0 z-20 mb-3 -mx-3 flex flex-wrap items-center gap-2 border-b border-transparent bg-[#F7FBF8]/90 px-3 py-2 backdrop-blur-sm dark:bg-[#0f1411]/90 sm:-mx-4 sm:px-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9AA8A0]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหา PR / ทะเบียน / ผู้ขอซื้อ / PO / หมายเหตุ"
            className="w-full rounded-[10px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] pl-9 pr-3 py-2 text-[13px] text-[#14271C] dark:text-white outline-none focus:border-[#CFE3D6]"
          />
        </div>
        <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="flex-1 min-w-[45%] rounded-[10px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] px-3 py-2 text-[13px] text-[#4B5F54] dark:text-gray-300 sm:min-w-0 sm:max-w-[200px] sm:flex-none">
          <option value="">ทุกคลัง</option>
          {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <select value={dept} onChange={(e) => setDept(e.target.value)} className="flex-1 min-w-[45%] rounded-[10px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] px-3 py-2 text-[13px] text-[#4B5F54] dark:text-gray-300 sm:min-w-0 sm:max-w-[200px] sm:flex-none">
          <option value="">ทุกแผนก</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {/* PO เกิน PR (เกิน VAT) */}
        <button
          onClick={() => setPoOverOnly((v) => !v)}
          title="เฉพาะ PR ที่ยอด PO แพงกว่า PR (เกิน VAT 7%)"
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[10px] border px-3 py-2 text-[13px] font-medium transition ${poOverOnly ? "border-[#DC2626] bg-[#DC2626] text-white" : "border-[#F7CFCF] text-[#DC2626] hover:bg-[#FEECEC] dark:border-red-900/40 dark:hover:bg-red-950/20"}`}
        >
          🔺 PO เกิน PR <span className="opacity-80">{poOverCount}</span>
        </button>
      </div>

      {/* Table (desktop) */}
      <div className="mb-3 hidden overflow-x-auto rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] sm:block">
        <table className="w-full min-w-[760px] table-fixed border-collapse text-[11.5px]">
          <colgroup>
            <col style={{ width: "11%" }} /><col style={{ width: "9%" }} /><col style={{ width: "15%" }} />
            <col style={{ width: "8%" }} /><col style={{ width: "9%" }} /><col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} /><col style={{ width: "10%" }} /><col style={{ width: "10%" }} /><col style={{ width: "12%" }} />
          </colgroup>
          <thead>
            <tr className="border-b border-[#EEF2F0] dark:border-white/8 bg-[#F6FAF7] dark:bg-[#1a1f16] text-left text-[10px] font-bold uppercase tracking-wide text-[#9AA8A0]">
              <th className="px-2.5 py-2.5">PR</th>
              <th className="px-2 py-2.5">อายุงาน</th>
              <th className="px-2 py-2.5">คลัง · แผนก</th>
              <th className="px-2 py-2.5">ทะเบียน</th>
              <th className="px-2 py-2.5">ผู้ขอซื้อ</th>
              <th className="px-2 py-2.5 text-right">ยอด PR</th>
              <th className="px-2 py-2.5 text-right">ยอด PO</th>
              <th className="px-2 py-2.5">สถานะ</th>
              <th className="px-2 py-2.5">PO / รับ</th>
              <th className="px-2.5 py-2.5">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-[#F1F5F2] dark:border-white/5">
                  <td colSpan={10} className="px-4 py-3"><div className="h-4 w-full animate-pulse rounded bg-[#F0F4F1] dark:bg-white/5" /></td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-14 text-center text-[13px] text-[#9AA8A0]">ไม่พบ PR ที่อนุมัติแล้วและยังไม่มีการรับของ</td></tr>
            ) : pageRows.map((r) => (
              <tr key={r.pr_code} onClick={() => setDetail(r)} className="cursor-pointer border-b border-[#F4F7F5] dark:border-white/5 hover:bg-[#F7FBF8] dark:hover:bg-white/[0.03] align-top">
                <td className="px-2.5 py-2.5">
                  <span className="block truncate font-semibold text-[#1B8C4B]" title={r.pr_code}>{r.pr_code}</span>
                </td>
                <td className="px-2 py-2.5">
                  {(() => {
                    const age = ageDays(r.date)
                    const col = ageColor(age)
                    return (
                      <div className="flex gap-1.5">
                        <div className="w-1 shrink-0 self-stretch rounded-full" style={{ background: col }} />
                        <div>
                          <div className="text-[18px] font-semibold leading-none" style={{ ...mitr, color: col }}>{age ?? "—"}</div>
                          <div className="mt-0.5 whitespace-nowrap text-[9px] text-[#9AA8A0]">วัน · {fmtDate(r.date)}</div>
                        </div>
                      </div>
                    )
                  })()}
                </td>
                <td className="px-2 py-2.5">
                  <div className="truncate text-[#14271C] dark:text-gray-200" title={r.warehouse}>{r.warehouse || "—"}</div>
                  <div className="truncate text-[10px] text-[#9AA8A0]" title={r.dept}>{r.dept || "—"}</div>
                </td>
                <td className="px-2 py-2.5"><span className="block truncate font-medium text-[#14271C] dark:text-white" title={r.plate}>{r.plate || "—"}</span></td>
                <td className="px-2 py-2.5"><span className="block truncate text-[#4B5F54] dark:text-gray-400" title={r.requester}>{r.requester || "—"}</span></td>
                <td className="px-2 py-2.5 whitespace-nowrap text-right font-semibold text-[#14271C] dark:text-white" title={baht(r.total || 0)}>{bahtShort(r.total || 0)}</td>
                <td className="px-2 py-2.5 whitespace-nowrap text-right text-[#4B5F54] dark:text-gray-300" title={r.po_count ? baht(r.po_total || 0) : ""}>{r.po_count === 0 ? "—" : bahtShort(r.po_total || 0)}</td>
                <td className="px-2 py-2.5">
                  <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STAGE_META[r.stage].cls}`}>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STAGE_META[r.stage].dot }} />
                    {STAGE_META[r.stage].label}
                  </span>
                  {r.days_to_due !== null && (r.stage === "due" || r.stage === "overdue") && (
                    <div className={`mt-0.5 text-[10px] font-semibold ${r.overdue ? "text-[#DC2626]" : "text-[#15803D]"}`}>
                      {r.overdue ? `เกิน ${Math.abs(r.days_to_due)} วัน` : r.days_to_due === 0 ? "ครบวันนี้" : `เหลือ ${r.days_to_due} วัน`}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  {r.po_count === 0 ? (
                    <span className="text-[10px] text-[#9AA8A0]">—</span>
                  ) : (
                    <div className="truncate text-[#14271C] dark:text-gray-200" title={r.po_codes.join(", ")}>
                      {r.po_codes[0]}{r.po_count > 1 && <span className="text-[#9AA8A0]"> +{r.po_count - 1}</span>}
                      {r.received_status[0] && <div className="truncate text-[10px] text-[#9AA8A0]" title={r.received_status.join(", ")}>{r.received_status[0]}</div>}
                    </div>
                  )}
                </td>
                <td className="px-2.5 py-2.5">
                  <div className="truncate text-[#6B7C72] dark:text-gray-400" title={r.note}>{r.note || "—"}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Card list (mobile) */}
      <div className="mb-3 space-y-2 sm:hidden">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-[#F0F4F1] dark:bg-white/5" />
          ))
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] px-4 py-12 text-center text-[13px] text-[#9AA8A0]">ไม่พบ PR ที่อนุมัติแล้วและยังไม่มีการรับของ</div>
        ) : pageRows.map((r) => {
          const age = ageDays(r.date)
          const col = ageColor(age)
          return (
            <button
              key={r.pr_code}
              onClick={() => setDetail(r)}
              className="block w-full rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] p-3 text-left"
            >
              {/* header: PR + สถานะ */}
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-[#1B8C4B]" style={mitr}>{r.pr_code}</span>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STAGE_META[r.stage].cls}`}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: STAGE_META[r.stage].dot }} />{STAGE_META[r.stage].label}
                </span>
              </div>
              {/* อายุ + วันเกิน/เหลือ */}
              <div className="mt-1.5 flex items-center gap-2 text-[12px]">
                <span className="inline-flex items-baseline gap-1"><b className="text-[16px]" style={{ ...mitr, color: col }}>{age ?? "—"}</b><span className="text-[10px] text-[#9AA8A0]">วัน</span></span>
                <span className="text-[#9AA8A0]">· {fmtDate(r.date)}</span>
                {r.days_to_due !== null && (r.stage === "due" || r.stage === "overdue") && (
                  <span className={`ml-auto font-semibold ${r.overdue ? "text-[#DC2626]" : "text-[#15803D]"}`}>
                    {r.overdue ? `เกิน ${Math.abs(r.days_to_due)} วัน` : r.days_to_due === 0 ? "ครบวันนี้" : `เหลือ ${r.days_to_due} วัน`}
                  </span>
                )}
              </div>
              {/* คลัง·แผนก / ทะเบียน / ผู้ขอซื้อ */}
              <div className="mt-1.5 text-[12px] text-[#4B5F54] dark:text-gray-400">
                <div className="truncate">{r.warehouse || "—"}{r.dept ? ` · ${r.dept}` : ""}</div>
                <div className="truncate text-[11px] text-[#9AA8A0]">
                  {r.plate ? `🚗 ${r.plate} · ` : ""}{r.requester || "—"}
                </div>
              </div>
              {/* ยอด PR/PO + PO */}
              <div className="mt-2 flex items-center justify-between border-t border-[#F4F7F5] dark:border-white/5 pt-2 text-[12px]">
                <span className="text-[#9AA8A0]">PR <b className="text-[#14271C] dark:text-white">{bahtShort(r.total || 0)}</b>{r.po_count > 0 && <> · PO <b className="text-[#14271C] dark:text-white">{bahtShort(r.po_total || 0)}</b></>}</span>
                <span className="truncate text-[11px] text-[#9AA8A0]">{r.po_count === 0 ? "ยังไม่มี PO" : `${r.po_codes[0]}${r.po_count > 1 ? ` +${r.po_count - 1}` : ""}`}</span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Pagination */}
      {!loading && filtered.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-[#6B7C72] dark:text-gray-400">
          <span>
            แสดง {(curPage - 1) * PAGE_SIZE + 1}–{Math.min(curPage * PAGE_SIZE, filtered.length)} จาก {filtered.length.toLocaleString()} รายการ
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage(1)}
              disabled={curPage <= 1}
              className="rounded-[8px] border border-[#EEF2F0] dark:border-white/10 px-2.5 py-1.5 disabled:opacity-40 enabled:hover:bg-[#F6FAF7] dark:enabled:hover:bg-white/5"
            >«</button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={curPage <= 1}
              className="rounded-[8px] border border-[#EEF2F0] dark:border-white/10 px-3 py-1.5 disabled:opacity-40 enabled:hover:bg-[#F6FAF7] dark:enabled:hover:bg-white/5"
            >ก่อนหน้า</button>
            <span className="px-2 font-medium text-[#14271C] dark:text-white">{curPage} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={curPage >= totalPages}
              className="rounded-[8px] border border-[#EEF2F0] dark:border-white/10 px-3 py-1.5 disabled:opacity-40 enabled:hover:bg-[#F6FAF7] dark:enabled:hover:bg-white/5"
            >ถัดไป</button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={curPage >= totalPages}
              className="rounded-[8px] border border-[#EEF2F0] dark:border-white/10 px-2.5 py-1.5 disabled:opacity-40 enabled:hover:bg-[#F6FAF7] dark:enabled:hover:bg-white/5"
            >»</button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-[#9AA8A0]">
        * &quot;อนุมัติแล้ว&quot; = คอลัมน์ is approved บน ATMS (✓) · &quot;ไม่มี DD&quot; = ไม่มีใบฝากของ (deposit) อ้างถึง PO ของ PR นี้ ·
        ข้อมูลจาก atms.purchase_requests / purchase_orders / deposit_header (scrape ล่าสุด)
      </p>

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-start sm:p-8" onClick={() => setDetail(null)}>
          <div
            className="max-h-[92vh] w-full max-w-[720px] overflow-hidden rounded-t-[20px] bg-white shadow-2xl dark:bg-[#151a10] sm:max-h-none sm:rounded-[18px]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-start justify-between gap-3 border-b border-[#EEF2F0] dark:border-white/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EAF6EE] dark:bg-[#1B8C4B]/10 text-[#1B8C4B]"><FileText size={18} /></div>
                <div>
                  <div className="flex items-center gap-2">
                    <a href={atmsPr(detail.pr_code, detail.pr_detail_id)} target="_blank" rel="noopener noreferrer" className="text-[16px] font-bold text-[#1B8C4B] hover:underline" style={mitr} title="เปิดใน ATMS">{detail.pr_code} ↗</a>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STAGE_META[detail.stage].cls}`}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STAGE_META[detail.stage].dot }} />{STAGE_META[detail.stage].full}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-[#9AA8A0]">{fmtDate(detail.date)} · {detail.warehouse || "—"}</p>
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="rounded-lg p-1.5 text-[#9AA8A0] hover:bg-[#F0F4F1] dark:hover:bg-white/5"><X size={18} /></button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-4 space-y-4">
              {/* PR info */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px] sm:grid-cols-3">
                {[
                  ["แผนก", detail.dept], ["ทะเบียน", detail.plate], ["ผู้ขอซื้อ", detail.requester],
                ].map(([k, v]) => (
                  <div key={k}><div className="text-[10.5px] uppercase text-[#9AA8A0]">{k}</div><div className="text-[#14271C] dark:text-gray-200">{v || "—"}</div></div>
                ))}
              </div>

              {/* comparison */}
              <div className="rounded-[12px] border border-[#EEF2F0] dark:border-white/10 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-[#14271C] dark:text-white">เทียบยอด PR ↔ PO</span>
                  <span className="text-[11px] text-[#9AA8A0]">{detail.vat_rule === "incl" ? "สาขา VAT รวมใน PR (คาด PR = PO)" : "สาขา PR ไม่รวม VAT (คาด PO = PR + 7%)"}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-[#F6FAF7] dark:bg-white/5 py-2"><div className="text-[10px] text-[#9AA8A0]">ยอด PR</div><div className="text-[15px] font-semibold text-[#14271C] dark:text-white" style={mitr}>{baht(detail.total)}</div></div>
                  <div className="rounded-lg bg-[#F6FAF7] dark:bg-white/5 py-2"><div className="text-[10px] text-[#9AA8A0]">ยอด PO รวม</div><div className="text-[15px] font-semibold text-[#14271C] dark:text-white" style={mitr}>{detail.po_count ? baht(detail.po_total) : "—"}</div></div>
                  <div className="rounded-lg bg-[#F6FAF7] dark:bg-white/5 py-2"><div className="text-[10px] text-[#9AA8A0]">ส่วนต่าง</div><div className={`text-[15px] font-semibold ${detail.cmp === "anomaly" ? "text-[#DC2626]" : "text-[#14271C] dark:text-white"}`} style={mitr}>{detail.po_count ? `${detail.po_diff > 0 ? "+" : ""}${baht(detail.po_diff)}` : "—"}</div></div>
                </div>
              </div>

              {/* เทียบรายการสินค้า (line item) */}
              <div className="rounded-[12px] border border-[#EEF2F0] dark:border-white/10 p-3.5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[#14271C] dark:text-white">เทียบรายการสินค้า (ราย SKU)</span>
                  {items && (items.has_pr_items || items.has_po_items) && (
                    <div className="flex flex-wrap gap-1">
                      {ITEM_ORDER.filter((k) => items.summary[k] > 0).map((k) => (
                        <span key={k} className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${ITEM_META[k].cls}`}>{ITEM_META[k].label} {items.summary[k]}</span>
                      ))}
                    </div>
                  )}
                </div>
                {itemsLoading ? (
                  <div className="py-3 text-center text-[12px] text-[#9AA8A0]">กำลังโหลดรายการ…</div>
                ) : !items || (!items.has_pr_items && !items.has_po_items) ? (
                  <div className="rounded-[10px] bg-[#F6FAF7] dark:bg-white/5 px-3 py-2 text-[11.5px] text-[#9AA8A0]">ยังไม่มีข้อมูลรายการสินค้าของ PR/PO นี้ (ยังไม่ได้ดึงหน้า detail)</div>
                ) : (
                  <div className="overflow-x-auto rounded-[10px] border border-[#EEF2F0] dark:border-white/10">
                    <table className="w-full min-w-[540px] text-[11.5px]">
                      <thead><tr className="border-b border-[#EEF2F0] dark:border-white/8 text-left text-[10px] uppercase text-[#9AA8A0]">
                        <th className="px-2.5 py-2">สินค้า</th>
                        <th className="px-2 py-2 text-right">PR จ.</th>
                        <th className="px-2 py-2 text-right">PO จ.</th>
                        <th className="px-2 py-2 text-right">PR ยอด</th>
                        <th className="px-2 py-2 text-right">PO ยอด</th>
                        <th className="px-2 py-2">สถานะ</th>
                      </tr></thead>
                      <tbody>
                        {items.rows.map((it) => (
                          <tr key={it.sku} className="border-b border-[#F4F7F5] dark:border-white/5 align-top">
                            <td className="px-2.5 py-2">
                              <div className="font-medium text-[#14271C] dark:text-gray-200">{it.sku}</div>
                              <div className="text-[10.5px] text-[#9AA8A0] line-clamp-1" title={it.name}>{it.name}</div>
                            </td>
                            <td className="px-2 py-2 text-right whitespace-nowrap text-[#4B5F54] dark:text-gray-300">{qty(it.pr_qty)}</td>
                            <td className="px-2 py-2 text-right whitespace-nowrap text-[#4B5F54] dark:text-gray-300">{qty(it.po_qty)}</td>
                            <td className="px-2 py-2 text-right whitespace-nowrap text-[#4B5F54] dark:text-gray-300">{it.pr_total == null ? "—" : bahtShort(it.pr_total)}</td>
                            <td className="px-2 py-2 text-right whitespace-nowrap text-[#4B5F54] dark:text-gray-300">{it.po_total == null ? "—" : bahtShort(it.po_total)}</td>
                            <td className="px-2 py-2"><span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${ITEM_META[it.status].cls}`}>{ITEM_META[it.status].label}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ติดตามสินค้า */}
              <div className="rounded-[12px] border border-[#EEF2F0] dark:border-white/10 p-3.5">
                <div className="mb-2.5 text-[12px] font-semibold text-[#14271C] dark:text-white">ติดตามสินค้า</div>
                <ol className="space-y-2.5">
                  {/* 1) เปิด PR */}
                  <li className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#1B8C4B] text-white text-[9px]">✓</span>
                    <div className="text-[12.5px]"><span className="font-medium text-[#14271C] dark:text-white">เปิด PR</span><span className="ml-2 text-[11px] text-[#9AA8A0]">{fmtDate(detail.date)}</span></div>
                  </li>
                  {/* 2) เปิด PO */}
                  <li className="flex items-start gap-2.5">
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] ${detail.po_count ? "bg-[#1B8C4B] text-white" : "border border-[#D5DDD8] text-transparent dark:border-white/20"}`}>✓</span>
                    <div className="text-[12.5px]">
                      <span className="font-medium text-[#14271C] dark:text-white">เปิด PO</span>
                      {detail.po_count ? (
                        <>
                          <span className="ml-2 text-[11px] text-[#9AA8A0]">{detail.po_count} ใบ · ตรวจรายการ/ยอด:</span>
                          <span className={`ml-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${CMP_META[detail.cmp].cls}`}><span className="h-1 w-1 rounded-full" style={{ background: CMP_META[detail.cmp].dot }} />{CMP_META[detail.cmp].label}</span>
                        </>
                      ) : <span className="ml-2 text-[11px] text-[#B07D12]">ยังไม่มี PO</span>}
                    </div>
                  </li>
                  {/* 3) กำหนดส่งสินค้า */}
                  <li className="flex items-start gap-2.5">
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] ${detail.expected_delivery ? "bg-[#1B8C4B] text-white" : "border border-[#D5DDD8] text-transparent dark:border-white/20"}`}>✓</span>
                    <div className="flex-1 text-[12.5px]">
                      <span className="font-medium text-[#14271C] dark:text-white">กำหนดส่งสินค้า</span>
                      <span className="ml-2 text-[11px] text-[#9AA8A0]">วันที่คาดว่าจะได้รับสินค้า</span>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <input
                          type="date"
                          value={deliveryDraft || (detail.expected_source === "po" ? detail.po_due : "")}
                          onChange={(e) => setDeliveryDraft(e.target.value)}
                          className="rounded-[8px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#0f1117] px-2.5 py-1.5 text-[12.5px] text-[#14271C] dark:text-white"
                        />
                        <button
                          onClick={saveTrack}
                          disabled={savingTrack}
                          className="rounded-[8px] bg-[#1B8C4B] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
                        >{savingTrack ? "กำลังบันทึก…" : "บันทึก"}</button>
                        {deliveryDraft && (
                          <button onClick={() => { setDeliveryDraft(""); }} className="text-[11px] text-[#9AA8A0] hover:underline">ล้างเป็นค่า PO</button>
                        )}
                        <span className="text-[10.5px] text-[#9AA8A0]">
                          {detail.expected_source === "manual" ? "· กรอกเอง" : detail.expected_source === "po" ? "· ค่าตั้งต้นจาก PO" : "· PO ไม่มีวันกำหนดส่ง กรอกเองได้"}
                        </span>
                      </div>
                      {/* เทียบกับวันนี้ */}
                      {(() => {
                        const di = dueInfo(detail.expected_delivery)
                        if (!di) return null
                        return (
                          <div className="mt-1.5 text-[11.5px] font-semibold">
                            {di.overdue
                              ? <span className="text-[#DC2626]">⚠ เกินกำหนดมาแล้ว {Math.abs(di.days)} วัน (คาดรับ {fmtISO(detail.expected_delivery)})</span>
                              : di.days === 0
                                ? <span className="text-[#B07D12]">⏰ ครบกำหนดวันนี้</span>
                                : <span className="text-[#15803D]">🟢 ยังไม่เกิน · เหลืออีก {di.days} วัน</span>}
                          </div>
                        )
                      })()}
                    </div>
                  </li>
                </ol>
              </div>

              {/* PO list */}
              <div>
                <div className="mb-1.5 text-[12px] font-semibold text-[#14271C] dark:text-white">ใบสั่งซื้อ (PO) · {detail.po_count} รายการ</div>
                {detail.po_count === 0 ? (
                  <div className="rounded-[10px] bg-[#FEF3C7] px-3 py-2 text-[12px] text-[#B07D12] dark:bg-amber-900/25 dark:text-amber-300">ยังไม่มี PO สำหรับ PR นี้</div>
                ) : (
                  <div className="overflow-x-auto rounded-[10px] border border-[#EEF2F0] dark:border-white/10">
                    <table className="w-full min-w-[520px] text-[12px]">
                      <thead><tr className="border-b border-[#EEF2F0] dark:border-white/8 text-left text-[10px] uppercase text-[#9AA8A0]">
                        <th className="px-3 py-2">PO</th><th className="px-3 py-2">วันที่</th><th className="px-3 py-2">ซัพพลายเออร์</th><th className="px-3 py-2 text-right">ยอด</th><th className="px-3 py-2">สถานะรับ</th>
                      </tr></thead>
                      <tbody>
                        {detail.pos.map((po) => (
                          <tr key={po.code} className="border-b border-[#F4F7F5] dark:border-white/5">
                            <td className="px-3 py-2 font-medium"><a href={atmsPo(po.code, po.detail_id)} target="_blank" rel="noopener noreferrer" className="text-[#1B8C4B] hover:underline" title="เปิดใน ATMS">{po.code} ↗</a></td>
                            <td className="px-3 py-2 whitespace-nowrap text-[#4B5F54] dark:text-gray-400">{fmtDate(po.date)}</td>
                            <td className="px-3 py-2 text-[#4B5F54] dark:text-gray-400">{po.supplier || "—"}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-right font-semibold text-[#14271C] dark:text-white">{baht(po.total)}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-[11px] text-[#9AA8A0]">{po.received || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* note */}
              {detail.note && (
                <div>
                  <div className="mb-1 text-[12px] font-semibold text-[#14271C] dark:text-white">หมายเหตุ</div>
                  <p className="whitespace-pre-wrap rounded-[10px] bg-[#F6FAF7] dark:bg-white/5 px-3 py-2 text-[12px] text-[#4B5F54] dark:text-gray-300">{detail.note}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
