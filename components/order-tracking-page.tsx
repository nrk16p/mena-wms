"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useSession } from "next-auth/react"
import { Search, Plus, Pencil, Trash2, X, Check, ClipboardList, UserCheck, RefreshCw, PackageCheck, History, MessageSquare, Send, CornerDownRight } from "lucide-react"
import { swalDeleteConfirm, swalConfirm, swalToast, swalError } from "@/lib/swal"
import {
  OT_STATUSES,
  OT_DONE_STATUS,
  otStatusMeta,
  type OrderTracking,
  type PrSnapshot,
} from "@/lib/order-tracking"

// ป้าย action ใน log
const LOG_META: Record<string, { label: string; color: string }> = {
  create: { label: "เปิดเรื่อง",  color: "#3b82f6" },
  accept: { label: "รับเรื่อง",   color: "#eab308" },
  update: { label: "แก้ไข",      color: "#9ca3af" },
  close:  { label: "ปิดงาน",     color: "#22c55e" },
}

const fmtDateTime = (iso: string) => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
}

const inputCls =
  "w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"
const labelCls = "mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"

const TABLE_GRID = "88px 2.2fr 1.2fr 1.4fr 1.4fr 1.3fr 72px"

type PrHit = { code: string; date: string; warehouse: string; dept: string; requester: string; total: number }
type OtComment = { _id: string; parentId: string | null; text: string; by: string; byEmail: string; at: string }

const fmtNum = (n: number) => (n ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDateShort = (s: string) => {
  if (!s) return "—"
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit" })
}
const ageDays = (iso?: string): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  if (isNaN(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

const EMPTY = { prCode: "", title: "", detail: "", note: "", dept: "", estimatedDone: "" }

export function OrderTrackingPage() {
  const { data: session } = useSession()
  const [rows, setRows]       = useState<OrderTracking[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ]             = useState("")
  const [fStatus, setFStatus] = useState("")
  const [depts, setDepts]     = useState<string[]>([])

  // modal
  const [open, setOpen]     = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm]     = useState<typeof EMPTY>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [current, setCurrent] = useState<OrderTracking | null>(null)  // เรื่องที่กำลังแก้ (สถานะ/ผู้รับ)

  // PR autocomplete + preview
  const [prHits, setPrHits]   = useState<PrHit[]>([])
  const [prOpen, setPrOpen]   = useState(false)
  const [prPreview, setPrPreview] = useState<{ snapshot: PrSnapshot; autoStatus: string } | null | "notfound">(null)
  const prBoxRef = useRef<HTMLDivElement>(null)

  // dept autocomplete
  const [deptOpen, setDeptOpen] = useState(false)
  const deptBoxRef = useRef<HTMLDivElement>(null)

  // comments (ในฟอร์มแก้ไข)
  const [comments, setComments]     = useState<OtComment[]>([])
  const [cmtLoading, setCmtLoading] = useState(false)
  const [cmtText, setCmtText]       = useState("")
  const [replyTo, setReplyTo]       = useState<string | null>(null)
  const [replyText, setReplyText]   = useState("")
  const [posting, setPosting]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (q)       p.set("q", q)
      if (fStatus) p.set("status", fStatus)
      const res  = await fetch(`/api/order-tracking?${p.toString()}`)
      const data = await res.json()
      setRows(Array.isArray(data) ? data : [])
    } catch {
      swalError("โหลดข้อมูลไม่สำเร็จ")
    } finally {
      setLoading(false)
    }
  }, [q, fStatus])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => {
    fetch("/api/order-tracking/pr-lookup?depts=1")
      .then((r) => r.json())
      .then((d) => setDepts(Array.isArray(d?.depts) ? d.depts : []))
      .catch(() => {})
  }, [])

  // ค้นเลข PR (debounce) — เฉพาะตอนพิมพ์ในฟอร์ม
  useEffect(() => {
    if (!open || !form.prCode.trim() || form.prCode.trim().length < 2) { setPrHits([]); return }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/order-tracking/pr-lookup?q=${encodeURIComponent(form.prCode.trim())}`)
        const d   = await res.json()
        setPrHits(Array.isArray(d) ? d : [])
      } catch { setPrHits([]) }
    }, 350)
    return () => clearTimeout(t)
  }, [open, form.prCode])

  // ดึง snapshot preview เมื่อเลือก/พิมพ์เลขเต็ม
  async function previewPr(code: string) {
    if (!code.trim()) { setPrPreview(null); return }
    try {
      const res = await fetch(`/api/order-tracking/pr-lookup?code=${encodeURIComponent(code.trim())}`)
      const d   = await res.json()
      setPrPreview(d?.found ? { snapshot: d.snapshot, autoStatus: d.autoStatus } : "notfound")
    } catch { setPrPreview(null) }
  }

  // ปิด dropdown เมื่อคลิกนอกกล่อง
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (prBoxRef.current && !prBoxRef.current.contains(e.target as Node)) setPrOpen(false)
      if (deptBoxRef.current && !deptBoxRef.current.contains(e.target as Node)) setDeptOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  async function loadComments(id: string) {
    setCmtLoading(true)
    try {
      const res  = await fetch(`/api/order-tracking/${id}/comment`)
      const data = await res.json()
      setComments(Array.isArray(data) ? data : [])
    } catch { setComments([]) } finally { setCmtLoading(false) }
  }
  async function postComment(text: string, parentId: string | null) {
    if (!editId || !text.trim()) return
    setPosting(true)
    try {
      const res = await fetch(`/api/order-tracking/${editId}/comment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), parentId }),
      })
      if (!res.ok) throw new Error()
      await loadComments(editId)
      setCmtText(""); setReplyText(""); setReplyTo(null)
    } catch {
      swalError("ส่งความคิดเห็นไม่สำเร็จ")
    } finally {
      setPosting(false)
    }
  }

  function openAdd() {
    setEditId(null); setCurrent(null)
    setForm(EMPTY); setPrHits([]); setPrPreview(null)
    setComments([]); setCmtText(""); setReplyTo(null); setReplyText("")
    setOpen(true)
  }
  function openEdit(r: OrderTracking) {
    setEditId(r._id); setCurrent(r)
    setForm({ prCode: r.prCode || "", title: r.title || "", detail: r.detail || "", note: r.note || "", dept: r.dept || "", estimatedDone: r.estimatedDone || "" })
    setPrHits([]); setPrPreview(null)
    setComments([]); setCmtText(""); setReplyTo(null); setReplyText("")
    loadComments(r._id)
    if (r.prCode) previewPr(r.prCode)
    setOpen(true)
  }

  async function save() {
    if (!form.title.trim()) { swalError("กรุณาระบุเรื่องที่ขอ"); return }
    setSaving(true)
    try {
      const url    = editId ? `/api/order-tracking/${editId}` : "/api/order-tracking"
      const method = editId ? "PUT" : "POST"
      const res    = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "บันทึกไม่สำเร็จ") }
      setOpen(false)
      swalToast("success", editId ? "แก้ไขแล้ว" : "เปิดเรื่องแล้ว")
      load()
    } catch (e) {
      swalError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ")
    } finally {
      setSaving(false)
    }
  }

  // จัดซื้อกดรับเรื่อง — ระบบจดชื่อผู้กดจาก session
  async function accept(r: OrderTracking) {
    const ok = await swalConfirm("รับเรื่องนี้?", `"${r.title}" — ระบบจะบันทึกชื่อคุณเป็นผู้รับผิดชอบ`)
    if (!ok.isConfirmed) return
    try {
      const res = await fetch(`/api/order-tracking/${r._id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "รับเรื่องไม่สำเร็จ") }
      swalToast("success", "รับเรื่องแล้ว")
      setOpen(false)
      load()
    } catch (e) {
      swalError(e instanceof Error ? e.message : "รับเรื่องไม่สำเร็จ")
    }
  }

  // ปิดงาน manual (เรื่องที่ไม่มี PR / จบเอง)
  async function closeJob(r: OrderTracking) {
    const ok = await swalConfirm("ปิดงานเรื่องนี้?", r.prCode ? `PR ${r.prCode}` : "เรื่องนี้ไม่มีเลข PR — ปิดแบบ manual")
    if (!ok.isConfirmed) return
    try {
      const res = await fetch(`/api/order-tracking/${r._id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: OT_DONE_STATUS }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "ปิดงานไม่สำเร็จ") }
      swalToast("success", "ปิดงานแล้ว")
      setOpen(false)
      load()
    } catch (e) {
      swalError(e instanceof Error ? e.message : "ปิดงานไม่สำเร็จ")
    }
  }

  async function remove(r: OrderTracking) {
    const ok = await swalDeleteConfirm(`ลบเรื่อง "${r.title}"?`)
    if (!ok.isConfirmed) return
    try {
      const res = await fetch(`/api/order-tracking/${r._id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      swalToast("success", "ลบแล้ว")
      setOpen(false)
      load()
    } catch {
      swalError("ลบไม่สำเร็จ")
    }
  }

  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1

  return (
    <div className="w-full px-4 py-6" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]">
            <ClipboardList size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
              ติดตามคำสั่งซื้อ
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              แจ้งความต้องการซื้อ (มี PR หรือยังไม่มีก็ได้) · จัดซื้อรับเรื่อง · sync สถานะจากระบบ PR อัตโนมัติ · {rows.length} เรื่อง
            </p>
          </div>
        </div>
        <button onClick={openAdd} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C] transition-colors">
          <Plus size={16} /> เปิดเรื่องใหม่
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา เรื่อง / PR / ผู้ขอ / ผู้รับผิดชอบ" className={inputCls + " pl-9"} />
      </div>

      {/* Status chips */}
      <div className="mb-4 flex w-full flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-xs font-medium text-[#9AA8A0]">สถานะ:</span>
        <button
          onClick={() => setFStatus("")}
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition ${!fStatus ? "bg-[#14271C] text-white" : "border border-[#E2E8E4] dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"}`}
        >
          ทั้งหมด <span className="opacity-70">{rows.length}</span>
        </button>
        {OT_STATUSES.map((st) => {
          const active = fStatus === st.value
          return (
            <button
              key={st.value}
              onClick={() => setFStatus(active ? "" : st.value)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition ${active ? "text-white" : "border border-[#E2E8E4] dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"}`}
              style={active ? { background: st.color } : undefined}
            >
              {!active && <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />}
              <span>{st.emoji}</span>{st.value}
              <span className="opacity-70">{counts[st.value] || 0}</span>
            </button>
          )
        })}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10]">
        <div className="min-w-[960px]">
          <div className="sticky top-0 z-10 grid gap-3 border-b border-[#EEF2F0] dark:border-white/8 bg-[#F6FAF7] dark:bg-[#1a1f16] px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-wide text-[#9AA8A0]" style={{ gridTemplateColumns: TABLE_GRID }}>
            <div>อายุเรื่อง</div><div>เรื่องที่ขอ</div><div>ผู้ขอ</div><div>PR / PO</div><div>จัดซื้อ</div><div>สถานะ</div><div className="text-center">จัดการ</div>
          </div>
          {loading ? (
            <div className="px-4 py-12 text-center text-sm text-gray-400">กำลังโหลด...</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F0FDF4] dark:bg-[#1B8C4B]/10 text-[#1B8C4B]"><ClipboardList size={22} /></div>
              <div>
                <p className="text-sm font-semibold text-[#14271C] dark:text-white">{q || fStatus ? "ไม่พบเรื่องตามตัวกรอง" : "ยังไม่มีเรื่องติดตาม"}</p>
                <p className="mt-0.5 text-xs text-[#9AA8A0]">{q || fStatus ? "ลองปรับคำค้นหรือล้างตัวกรอง" : "เปิดเรื่องแรกได้เลย — มีหรือไม่มีเลข PR ก็ได้"}</p>
              </div>
              <button onClick={openAdd} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C]"><Plus size={15} /> เปิดเรื่องใหม่</button>
            </div>
          ) : rows.map((r) => {
            const sm   = otStatusMeta(r.status)
            const days = ageDays(r.createdAt)
            const snap = r.prSnapshot
            return (
              <div
                key={r._id}
                onClick={() => openEdit(r)}
                className="grid cursor-pointer items-start gap-3 border-b border-[#F1F5F2] dark:border-white/5 px-4 py-3 transition-colors hover:bg-[#F6FAF7] dark:hover:bg-white/[0.03]"
                style={{ gridTemplateColumns: TABLE_GRID }}
              >
                <div className="text-[18px] font-semibold leading-none text-[#5B7568] dark:text-gray-300" style={{ fontFamily: "'Mitr', sans-serif" }}>
                  {days ?? "—"}<span className="ml-1 text-[10px] font-normal text-[#9AA8A0]">วัน</span>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold text-[#14271C] dark:text-white" title={r.title}>{r.title}</div>
                  {r.detail && <div className="mt-0.5 line-clamp-2 text-[11.5px] text-[#5B7568] dark:text-gray-400" title={r.detail}>{r.detail}</div>}
                  {r.note && <div className="mt-0.5 truncate text-[10.5px] text-[#9AA8A0]" title={r.note}>📝 {r.note}</div>}
                </div>
                <div className="min-w-0 text-[12px] text-[#4B5F54] dark:text-gray-300">
                  <div className="truncate font-medium">{r.requester || "—"}</div>
                  {r.dept && <div className="truncate text-[10.5px] text-[#9AA8A0]">🏢 {r.dept}</div>}
                </div>
                <div className="min-w-0 text-[11.5px]">
                  {r.prCode ? (
                    <>
                      <div className="font-mono font-medium text-[#14271C] dark:text-white">{r.prCode}</div>
                      {snap && snap.poCodes.length > 0 && (
                        <div className="mt-0.5 truncate font-mono text-[10.5px] text-[#5B7568] dark:text-gray-400" title={snap.poCodes.join(", ")}>PO {snap.poCodes.join(", ")}</div>
                      )}
                      {snap && snap.total > 0 && <div className="mt-0.5 text-[10.5px] font-medium text-[#1B8C4B]">฿ {fmtNum(snap.total)}</div>}
                      {snap?.expectedDelivery && !snap.hasDD && <div className="mt-0.5 text-[10.5px] text-[#9AA8A0]">📅 คาดรับ {fmtDateShort(snap.expectedDelivery)}</div>}
                      {snap?.note && <div className="mt-0.5 line-clamp-2 text-[10.5px] text-[#B07D12]" title={snap.note}>💬 {snap.note}</div>}
                    </>
                  ) : (
                    <span className="rounded bg-[#FDF3DD] px-1.5 py-0.5 text-[10px] font-semibold text-[#B07D12] dark:bg-amber-900/25 dark:text-amber-300">ยังไม่มี PR</span>
                  )}
                </div>
                <div className="min-w-0 text-[11.5px] text-[#4B5F54] dark:text-gray-300" onClick={(e) => e.stopPropagation()}>
                  {r.acceptedBy ? (
                    <>
                      <div className="truncate font-medium" title={r.acceptedBy}>👤 {r.acceptedBy}</div>
                      {r.estimatedDone && <div className="mt-0.5 text-[10.5px] text-[#9AA8A0]">🎯 คาดเสร็จ {fmtDateShort(r.estimatedDone)}</div>}
                    </>
                  ) : r.status === "แจ้งเรื่อง" ? (
                    // กดรับเรื่องได้จากตารางเลย — ระบบจดชื่อผู้กดจาก session
                    <button
                      onClick={() => accept(r)}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#eab308] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#ca9a04]"
                    >
                      <UserCheck size={12} /> รับเรื่อง
                    </button>
                  ) : (
                    <span className="text-[10.5px] text-[#9AA8A0]">ยังไม่มีผู้รับเรื่อง</span>
                  )}
                </div>
                <div className="min-w-0">
                  <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${sm.cls}`}><span>{sm.emoji}</span>{sm.value}</span>
                  {r.status === OT_DONE_STATUS && r.closedAt && <div className="mt-1 text-[10.5px] text-[#1B8C4B]">🏁 {fmtDateShort(r.closedAt)}</div>}
                </div>
                <div className="grid grid-cols-2 justify-items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => openEdit(r)} title="แก้ไข" className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-[#F6FAF7] dark:bg-white/5 text-gray-500 transition hover:bg-[#1B8C4B]/10 hover:text-[#1B8C4B]"><Pencil size={14} /></button>
                  <button onClick={() => remove(r)} title="ลบ" className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-[#F6FAF7] dark:bg-white/5 text-gray-500 transition hover:bg-[#DC2626]/10 hover:text-[#DC2626]"><Trash2 size={14} /></button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm">
          <div className="my-8 w-full max-w-xl rounded-2xl border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#EEF2F0] dark:border-white/8 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <h2 className="text-[17px] font-semibold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
                  {editId ? "แก้ไขเรื่องติดตาม" : "เปิดเรื่องใหม่"}
                </h2>
                {current && (
                  <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${otStatusMeta(current.status).cls}`}>
                    {otStatusMeta(current.status).emoji} {current.status}
                  </span>
                )}
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5"><X size={18} /></button>
            </div>

            <div className="space-y-4 px-5 py-5">
              {/* PR autocomplete */}
              <div ref={prBoxRef} className="relative">
                <label className={labelCls}>เลข PR <span className="text-[10px] font-normal text-gray-400">(ไม่มีก็เปิดเรื่องได้ — พิมพ์เพื่อค้นหาจากระบบ)</span></label>
                <input
                  value={form.prCode}
                  onChange={(e) => { setForm({ ...form, prCode: e.target.value }); setPrOpen(true); setPrPreview(null) }}
                  onFocus={() => setPrOpen(true)}
                  onBlur={() => { if (form.prCode.trim()) previewPr(form.prCode) }}
                  placeholder="เช่น PR2026..."
                  className={inputCls + " font-mono"}
                />
                {prOpen && prHits.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-lg">
                    {prHits.map((h) => (
                      <button
                        key={h.code}
                        type="button"
                        onClick={() => {
                          setForm((f) => ({ ...f, prCode: h.code, dept: f.dept || h.dept, title: f.title || `สั่งซื้อ ${h.warehouse || ""} · ${h.requester || ""}`.trim() }))
                          setPrOpen(false); setPrHits([])
                          previewPr(h.code)
                        }}
                        className="flex w-full items-center justify-between gap-2 border-b border-[#F1F5F2] dark:border-white/5 px-3 py-2 text-left hover:bg-[#F6FAF7] dark:hover:bg-white/5"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-[12.5px] font-semibold text-[#14271C] dark:text-white">{h.code}</span>
                          <span className="block truncate text-[10.5px] text-[#9AA8A0]">{h.date} · {h.warehouse} · {h.dept} · {h.requester}</span>
                        </span>
                        <span className="shrink-0 text-[11px] font-medium text-[#1B8C4B]">฿ {fmtNum(h.total)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {/* PR preview / sync result */}
                {prPreview === "notfound" && form.prCode.trim() && (
                  <p className="mt-1.5 rounded-md bg-[#FDF3DD] px-2.5 py-1.5 text-[11px] text-[#B07D12]">⚠ ไม่พบ PR นี้ในระบบ — บันทึกได้ แต่จะยังไม่ sync สถานะจนกว่า PR จะเข้าระบบ</p>
                )}
                {prPreview && prPreview !== "notfound" && (
                  <div className="mt-1.5 rounded-xl border border-[#D6EFDF] dark:border-[#1B8C4B]/30 bg-[#F0FDF4] dark:bg-[#1B8C4B]/10 px-3 py-2.5 text-[11.5px] text-[#0F6A3C] dark:text-[#4ade80]">
                    <p className="flex items-center gap-1.5 font-semibold"><RefreshCw size={12} /> พบข้อมูล PR — จะ sync สถานะอัตโนมัติ</p>
                    <p className="mt-1">
                      {prPreview.snapshot.warehouse} · {prPreview.snapshot.dept} · ผู้ขอซื้อ {prPreview.snapshot.requester} · ฿ {fmtNum(prPreview.snapshot.total)}
                      {prPreview.snapshot.poCodes.length > 0 && <> · PO {prPreview.snapshot.poCodes.join(", ")}</>}
                    </p>
                    {prPreview.snapshot.note && <p className="mt-1">💬 หมายเหตุจาก PR: <b>{prPreview.snapshot.note}</b></p>}
                    <p className="mt-1">สถานะที่จะตั้งให้: <b>{otStatusMeta(prPreview.autoStatus).emoji} {prPreview.autoStatus}</b>{prPreview.snapshot.hasDD && " (รับของครบแล้ว — ปิดจบอัตโนมัติ)"}</p>
                  </div>
                )}
              </div>

              <div>
                <label className={labelCls}>เรื่องที่ขอ <span className="text-red-500">*</span></label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} placeholder="เช่น ขอซื้อยางอะไหล่ 10 เส้น" />
              </div>

              <div>
                <label className={labelCls}>รายละเอียด</label>
                <textarea value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} rows={3} className={inputCls} placeholder="สเปก / จำนวน / เหตุผลที่ขอ" />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div ref={deptBoxRef} className="relative">
                  <label className={labelCls}>แผนกผู้ขอ <span className="text-[10px] font-normal text-gray-400">(พิมพ์เพื่อค้นหา)</span></label>
                  <input
                    value={form.dept}
                    onChange={(e) => { setForm({ ...form, dept: e.target.value }); setDeptOpen(true) }}
                    onFocus={() => setDeptOpen(true)}
                    placeholder="เช่น ซ่อมบำรุง..."
                    className={inputCls}
                  />
                  {deptOpen && (() => {
                    const qd = form.dept.trim().toLowerCase()
                    const hits = depts.filter((d) => !qd || d.toLowerCase().includes(qd)).slice(0, 12)
                    if (!hits.length) return null
                    return (
                      <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-lg">
                        {hits.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => { setForm((f) => ({ ...f, dept: d })); setDeptOpen(false) }}
                            className={`block w-full truncate border-b border-[#F1F5F2] dark:border-white/5 px-3 py-2 text-left text-[12.5px] hover:bg-[#F6FAF7] dark:hover:bg-white/5 ${form.dept === d ? "font-semibold text-[#1B8C4B]" : "text-[#14271C] dark:text-white"}`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    )
                  })()}
                </div>
                <div>
                  <label className={labelCls}>ประมาณการเสร็จ <span className="text-[10px] font-normal text-gray-400">(จัดซื้อกรอก)</span></label>
                  <input type="date" value={form.estimatedDone} onChange={(e) => setForm({ ...form, estimatedDone: e.target.value })} className={inputCls} />
                </div>
              </div>

              <div>
                <label className={labelCls}>Note</label>
                <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} className={inputCls} placeholder="หมายเหตุเพิ่มเติม" />
              </div>

              {/* ผู้เปิดเรื่อง (ตอนสร้างใหม่ — อิงจาก session: ชื่อ + email) */}
              {!editId && session?.user && (
                <div className="rounded-xl border border-[#EEF2F0] dark:border-white/8 bg-[#F9FCFA] dark:bg-white/[0.02] px-3.5 py-2.5 text-[11.5px] text-[#5B7568] dark:text-gray-400">
                  ✍️ เปิดเรื่องโดย <b className="text-[#14271C] dark:text-white">{session.user.name || "—"}</b>
                  {session.user.email && <span className="ml-1 text-[#9AA8A0]">({session.user.email})</span>} — ระบบบันทึกอัตโนมัติ
                </div>
              )}

              {/* ข้อมูลเรื่อง + ประวัติ (ตอนแก้ไข) */}
              {current && (
                <div className="rounded-xl border border-[#EEF2F0] dark:border-white/8 bg-[#F9FCFA] dark:bg-white/[0.02] px-3.5 py-3 text-[11.5px] text-[#5B7568] dark:text-gray-400">
                  <p>เปิดเรื่องโดย <b className="text-[#14271C] dark:text-white">{current.requester || "—"}</b>{current.requesterEmail && <span className="ml-1 text-[#9AA8A0]">({current.requesterEmail})</span>} · {fmtDateShort(current.createdAt || "")}</p>
                  {current.acceptedBy && <p className="mt-0.5">รับเรื่องโดย <b className="text-[#14271C] dark:text-white">{current.acceptedBy}</b> · {fmtDateShort(current.acceptedAt)}</p>}
                  {current.prSyncedAt && <p className="mt-0.5">sync ล่าสุด {new Date(current.prSyncedAt).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>}

                  {/* Timeline log — ใครทำอะไรเมื่อไร (ชื่อ + email) */}
                  {(current.log?.length ?? 0) > 0 && (
                    <div className="mt-2.5 border-t border-[#EEF2F0] dark:border-white/8 pt-2.5">
                      <p className="mb-1.5 flex items-center gap-1 font-semibold text-[#14271C] dark:text-white"><History size={12} /> ประวัติเรื่องนี้</p>
                      <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                        {[...(current.log ?? [])].reverse().map((e, i) => {
                          const m = LOG_META[e.action] ?? { label: e.action, color: "#9ca3af" }
                          return (
                            <div key={i} className="flex items-start gap-2">
                              <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: m.color }} />
                              <span className="min-w-0">
                                <b className="text-[#14271C] dark:text-white">{m.label}</b> โดย {e.by || "—"}
                                {e.byEmail && <span className="ml-1 text-[#9AA8A0]">({e.byEmail})</span>}
                                <span className="ml-1 text-[#9AA8A0]">· {fmtDateTime(e.at)}</span>
                                {e.note && <span className="block text-[10.5px] text-[#9AA8A0]">{e.note}</span>}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── ความคิดเห็น / โน้ต (ฝังในหน้าแก้ไข) ── */}
              {editId && (
                <div className="rounded-xl border border-[#EEF2F0] dark:border-white/8 bg-[#F9FCFA] dark:bg-white/[0.02] p-3">
                  <div className="mb-2 flex items-center gap-1.5">
                    <MessageSquare size={15} className="text-[#1B8C4B]" />
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">ความคิดเห็น / โน้ต</span>
                    <span className="rounded-full bg-[#F1F5F2] dark:bg-white/10 px-1.5 text-xs font-medium text-[#5B7568] dark:text-gray-300">{comments.length}</span>
                  </div>

                  <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
                    {cmtLoading ? (
                      <p className="py-3 text-center text-xs text-gray-400">กำลังโหลด...</p>
                    ) : comments.filter((c) => !c.parentId).length === 0 ? (
                      <p className="py-3 text-center text-xs text-gray-400">ยังไม่มีความคิดเห็น — เริ่มเขียนได้เลย</p>
                    ) : (
                      comments.filter((c) => !c.parentId).map((c) => (
                        <div key={c._id}>
                          <OtCommentRow c={c} />
                          {comments.filter((rc) => rc.parentId === c._id).length > 0 && (
                            <div className="ml-4 mt-2 space-y-2 border-l-2 border-[#EEF2F0] dark:border-white/10 pl-3">
                              {comments.filter((rc) => rc.parentId === c._id).map((rc) => <OtCommentRow key={rc._id} c={rc} reply />)}
                            </div>
                          )}
                          {replyTo === c._id ? (
                            <div className="ml-4 mt-2 flex items-center gap-2 pl-3">
                              <input autoFocus value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); postComment(replyText, c._id) } }} placeholder="ตอบกลับ..." className="flex-1 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] px-2.5 py-1.5 text-sm focus:border-[#1B8C4B] focus:outline-none" />
                              <button type="button" onClick={() => postComment(replyText, c._id)} disabled={posting || !replyText.trim()} className="rounded-lg bg-[#1B8C4B] p-1.5 text-white hover:bg-[#0F6A3C] disabled:opacity-50"><Send size={14} /></button>
                              <button type="button" onClick={() => { setReplyTo(null); setReplyText("") }} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5"><X size={14} /></button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => { setReplyTo(c._id); setReplyText("") }} className="ml-4 mt-1 inline-flex items-center gap-1 pl-3 text-[11px] font-medium text-[#1B8C4B] hover:underline">
                              <CornerDownRight size={11} /> ตอบกลับ
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <input value={cmtText} onChange={(e) => setCmtText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); postComment(cmtText, null) } }} placeholder="เขียนความคิดเห็น / โน้ตล่าสุด..." className={inputCls} />
                    <button type="button" onClick={() => postComment(cmtText, null)} disabled={posting || !cmtText.trim()} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#1B8C4B] px-3 py-2 text-sm font-medium text-white hover:bg-[#0F6A3C] disabled:opacity-50"><Send size={15} /> ส่ง</button>
                  </div>
                </div>
              )}
            </div>

            {/* footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EEF2F0] dark:border-white/8 px-5 py-4">
              <div className="flex items-center gap-2">
                {current && current.status === "แจ้งเรื่อง" && (
                  <button
                    onClick={() => accept(current)}
                    title={`กดแล้วสถานะเปลี่ยนเป็น "รับเรื่องแล้ว" และบันทึกชื่อคุณ (${session?.user?.name || session?.user?.email || ""}) เป็นผู้รับผิดชอบ`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#eab308] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#ca9a04]"
                  >
                    <UserCheck size={15} /> รับเรื่อง (จัดซื้อ)
                  </button>
                )}
                {current && current.status !== OT_DONE_STATUS && (
                  <button onClick={() => closeJob(current)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#1B8C4B]/40 px-3.5 py-2 text-sm font-medium text-[#1B8C4B] hover:bg-[#F0FDF4] dark:hover:bg-white/5">
                    <PackageCheck size={15} /> ปิดงาน
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setOpen(false)} className="rounded-lg border border-gray-200 dark:border-white/10 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5">ยกเลิก</button>
                <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-60">
                  <Check size={16} /> {saving ? "กำลังบันทึก..." : editId ? "บันทึกการแก้ไข" : "เปิดเรื่อง"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// แถวความคิดเห็น — ชื่อ (email) + เวลา + ข้อความ
function OtCommentRow({ c, reply }: { c: OtComment; reply?: boolean }) {
  return (
    <div className={`rounded-lg ${reply ? "bg-white dark:bg-white/[0.03]" : "bg-white dark:bg-white/[0.04]"} border border-[#EEF2F0] dark:border-white/8 px-2.5 py-2`}>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-[12px] font-semibold text-[#14271C] dark:text-white">{c.by || "—"}</span>
        {c.byEmail && <span className="text-[10px] text-[#9AA8A0]">({c.byEmail})</span>}
        <span className="text-[10px] text-[#9AA8A0]">{fmtDateTime(c.at)}</span>
      </div>
      <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#4B5F54] dark:text-gray-300">{c.text}</p>
    </div>
  )
}
