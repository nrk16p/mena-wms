"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useSession } from "next-auth/react"
import { motion, AnimatePresence } from "motion/react"
import { Search, Plus, Pencil, Trash2, X, Check, ClipboardList, UserCheck, RefreshCw, PackageCheck, History, MessageSquare, Send, CornerDownRight, ChevronDown } from "lucide-react"
import { swalDeleteConfirm, swalConfirm, swalToast, swalError } from "@/lib/swal"
import { ImageUpload } from "@/components/image-upload"
import { ImageGallery, type GalleryImage } from "@/components/image-gallery"
import type { SkuImage } from "@/lib/media"
import {
  OT_STATUSES,
  OT_DONE_STATUS,
  otStatusMeta,
  type OrderTracking,
  type PrSnapshot,
} from "@/lib/order-tracking"
import { deptScope } from "@/lib/dept-access"

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

const EMPTY = { prCode: "", title: "", detail: "", note: "", dept: "", estimatedDone: "", linksText: "" }

// ย่อ URL ให้อ่านง่ายบน chip — ตัด protocol แล้ว truncate
const shortUrl = (u: string) => {
  const t = u.replace(/^https?:\/\//i, "").replace(/\/$/, "")
  return t.length > 32 ? t.slice(0, 32) + "…" : t
}

export function OrderTrackingPage() {
  const { data: session } = useSession()
  const [rows, setRows]       = useState<OrderTracking[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ]             = useState("")
  const [fStatus, setFStatus] = useState("")
  const [allDepts, setAllDepts] = useState<string[]>([])

  // ขอบเขตแผนกของผู้ใช้ — ฝั่ง API บังคับซ้ำอีกชั้น (lib/dept-access.ts)
  const scope = useMemo(
    () => deptScope(session?.user?.employee, session?.user?.role),
    [session?.user?.employee, session?.user?.role],
  )
  // รายชื่อแผนกที่เลือกได้ใน dropdown ทั้งหมดของหน้านี้
  const depts = useMemo(
    () => (scope.all ? allDepts : allDepts.filter((d) => scope.depts.includes(d))),
    [allDepts, scope],
  )

  // modal
  const [open, setOpen]     = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm]     = useState<typeof EMPTY>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [current, setCurrent] = useState<OrderTracking | null>(null)  // เรื่องที่กำลังแก้ (สถานะ/ผู้รับ)
  const [formImages, setFormImages] = useState<SkuImage[]>([])        // ไฟล์แนบ

  // PR autocomplete + preview
  const [prHits, setPrHits]   = useState<PrHit[]>([])
  const [prOpen, setPrOpen]   = useState(false)
  const [prPreview, setPrPreview] = useState<{ snapshot: PrSnapshot; autoStatus: string } | null | "notfound">(null)
  const prBoxRef = useRef<HTMLDivElement>(null)

  // dept autocomplete
  const [deptOpen, setDeptOpen] = useState(false)
  const deptBoxRef = useRef<HTMLDivElement>(null)

  // filter แผนกผู้ขอ (หน้า list)
  const [fDept, setFDept] = useState("")
  const [fDeptOpen, setFDeptOpen] = useState(false)
  const fDeptBoxRef = useRef<HTMLDivElement>(null)

  // comments (ในฟอร์มแก้ไข)
  const [comments, setComments]     = useState<OtComment[]>([])
  const [cmtLoading, setCmtLoading] = useState(false)
  const [cmtText, setCmtText]       = useState("")
  const [replyTo, setReplyTo]       = useState<string | null>(null)
  const [replyText, setReplyText]   = useState("")
  const [posting, setPosting]       = useState(false)
  const [showLog, setShowLog]       = useState(false)  // timeline ย่อไว้ก่อน

  // แถวที่กางอ่านรายละเอียดเต็ม (accordion — เปิดพร้อมกันได้หลายแถว)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  // Gallery ดูรูปเต็มจอ (ลูกศรเลื่อน + ดาวน์โหลด) — เปิดจากรูปในรายการ
  const [gallery, setGallery] = useState<{ imgs: GalleryImage[]; start: number } | null>(null)
  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (q)       p.set("q", q)
      if (fStatus) p.set("status", fStatus)
      if (fDept)   p.set("dept", fDept)
      const res  = await fetch(`/api/order-tracking?${p.toString()}`)
      const data = await res.json()
      setRows(Array.isArray(data) ? data : [])
    } catch {
      swalError("โหลดข้อมูลไม่สำเร็จ")
    } finally {
      setLoading(false)
    }
  }, [q, fStatus, fDept])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => {
    fetch("/api/order-tracking/pr-lookup?depts=1")
      .then((r) => r.json())
      .then((d) => setAllDepts(Array.isArray(d?.depts) ? d.depts : []))
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
  // fillTitle: เติม "เรื่องที่ขอ" จากเหตุผลในการขอของ PR (ใช้ตอนเลือกจาก dropdown)
  async function previewPr(code: string, fillTitle = false) {
    if (!code.trim()) { setPrPreview(null); return }
    try {
      const res = await fetch(`/api/order-tracking/pr-lookup?code=${encodeURIComponent(code.trim())}`)
      const d   = await res.json()
      setPrPreview(d?.found ? { snapshot: d.snapshot, autoStatus: d.autoStatus } : "notfound")
      if (fillTitle && d?.found && d.snapshot?.note) {
        setForm((f) => ({ ...f, title: d.snapshot.note }))
      }
    } catch { setPrPreview(null) }
  }

  // ปิด dropdown เมื่อคลิกนอกกล่อง
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (prBoxRef.current && !prBoxRef.current.contains(e.target as Node)) setPrOpen(false)
      if (deptBoxRef.current && !deptBoxRef.current.contains(e.target as Node)) setDeptOpen(false)
      if (fDeptBoxRef.current && !fDeptBoxRef.current.contains(e.target as Node)) setFDeptOpen(false)
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
    // เติมแผนกให้อัตโนมัติเมื่อผู้ใช้มีแผนกเดียว (คนที่เห็นได้ทุกแผนกยังเลือกเองเหมือนเดิม)
    setForm({ ...EMPTY, dept: !scope.all && depts.length === 1 ? depts[0] : "" })
    setFormImages([])
    setPrHits([]); setPrPreview(null)
    setComments([]); setCmtText(""); setReplyTo(null); setReplyText("")
    setOpen(true)
  }
  function openEdit(r: OrderTracking) {
    setEditId(r._id); setCurrent(r)
    setForm({ prCode: r.prCode || "", title: r.title || "", detail: r.detail || "", note: r.note || "", dept: r.dept || "", estimatedDone: r.estimatedDone || "", linksText: (r.links ?? []).join("\n") })
    setFormImages(r.images ?? [])
    setPrHits([]); setPrPreview(null); setShowLog(false)
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
      // ลิงก์แนบ — 1 บรรทัดต่อ 1 ลิงก์ เติม https:// ให้อัตโนมัติถ้าไม่ได้ใส่มา
      const links = form.linksText.split("\n").map((x) => x.trim()).filter(Boolean)
        .map((x) => (/^https?:\/\//i.test(x) ? x : `https://${x}`))
      const res    = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, images: formImages, links }) })
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
    // ยืนยันตัวตนก่อนรับเรื่อง — ปุ่มนี้สำหรับทีมจัดซื้อเท่านั้น
    const ok = await swalConfirm(
      "คุณเป็นแผนกจัดซื้อใช่หรือไม่?",
      `การรับเรื่อง "${r.title}" สำหรับทีมจัดซื้อเท่านั้น — กดยืนยันแล้วระบบจะบันทึกชื่อคุณ (${session?.user?.name || session?.user?.email || ""}) เป็นผู้รับผิดชอบ`
    )
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

  // ปิดงานแล้ว → ฟอร์ม read-only (เหลือแค่ความคิดเห็น)
  const isClosed = !!current && current.status === OT_DONE_STATUS
  const roCls = isClosed ? " pointer-events-none opacity-60" : ""

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
              ติดตามคำขอเปิด PO
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              แจ้งความต้องการซื้อ (มี PR หรือยังไม่มีก็ได้) · จัดซื้อรับเรื่อง · sync สถานะจากระบบ PR อัตโนมัติ · {rows.length} เรื่อง
            </p>
            {!scope.all && (
              <p className="mt-0.5 text-[11px] text-[#1B8C4B]" title={scope.depts.join("\n") || "ไม่มีแผนกในขอบเขต"}>
                🔒 เห็นเฉพาะแผนก{scope.hr ? ` ${scope.hr.name}` : "ของตนเอง"}
                {scope.depts.length > 1 ? ` (${scope.depts.length} สาขา)` : ""} และเรื่องที่คุณเปิดเอง
              </p>
            )}
          </div>
        </div>
        <button onClick={openAdd} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C] transition-colors">
          <Plus size={16} /> เปิดเรื่องใหม่
        </button>
      </div>

      {/* Search + filter แผนก */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา เรื่อง / PR / ผู้ขอ / ผู้รับผิดชอบ" className={inputCls + " pl-9"} />
        </div>
        <div ref={fDeptBoxRef} className="relative sm:w-[240px]">
          <input
            value={fDept}
            onChange={(e) => { setFDept(e.target.value); setFDeptOpen(true) }}
            onFocus={() => setFDeptOpen(true)}
            placeholder={scope.all ? "🏢 ทุกแผนก — พิมพ์เพื่อค้นหา" : "🏢 แผนกของคุณ — พิมพ์เพื่อค้นหา"}
            className={inputCls + (fDept ? " border-[#1B8C4B]" : "")}
          />
          {fDept && (
            <button onClick={() => { setFDept(""); setFDeptOpen(false) }} title="ล้างตัวกรองแผนก" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
          {fDeptOpen && (() => {
            const qd = fDept.trim().toLowerCase()
            const hits = depts.filter((d) => !qd || d.toLowerCase().includes(qd)).slice(0, 12)
            if (!hits.length) return null
            return (
              <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-lg">
                {hits.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { setFDept(d); setFDeptOpen(false) }}
                    className={`block w-full truncate border-b border-[#F1F5F2] dark:border-white/5 px-3 py-2 text-left text-[12.5px] hover:bg-[#F6FAF7] dark:hover:bg-white/5 ${fDept === d ? "font-semibold text-[#1B8C4B]" : "text-[#14271C] dark:text-white"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            )
          })()}
        </div>
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
      <div className="hidden overflow-x-auto rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] md:block">
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
            const isExpanded = expandedIds.has(r._id)
            const reason = snap?.note && snap.note.trim() !== (r.title || "").trim() ? snap.note : ""
            return (
              <div key={r._id} className="border-b border-[#F1F5F2] dark:border-white/5">
              <div
                onClick={() => openEdit(r)}
                className="grid cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-[#F6FAF7] dark:hover:bg-white/[0.03]"
                style={{ gridTemplateColumns: TABLE_GRID }}
              >
                <div className="text-[18px] font-semibold leading-none text-[#5B7568] dark:text-gray-300" style={{ fontFamily: "'Mitr', sans-serif" }}>
                  {days ?? "—"}<span className="ml-1 text-[10px] font-normal text-[#9AA8A0]">วัน</span>
                </div>
                <div className="min-w-0">
                  <div className="line-clamp-2 text-[13.5px] font-semibold text-[#14271C] dark:text-white" title={r.title}>{r.title}</div>
                  {r.detail && <div className="mt-0.5 line-clamp-2 text-[11.5px] text-[#5B7568] dark:text-gray-400" title={r.detail}>{r.detail}</div>}
                  {r.note && <div className="mt-0.5 truncate text-[10.5px] text-[#9AA8A0]" title={r.note}>📝 {r.note}</div>}
                  {(r.images?.length ?? 0) > 0 && <div className="mt-0.5 text-[10.5px] text-[#9AA8A0]">📎 {r.images!.length} ไฟล์แนบ</div>}
                  {/* กางอ่านรายละเอียดเต็มแบบ accordion (animate-ui style) */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleExpand(r._id) }}
                    className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-[#1B8C4B] hover:underline"
                  >
                    <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.25 }} className="inline-flex"><ChevronDown size={12} /></motion.span>
                    {isExpanded ? "ย่อ" : "อ่านทั้งหมด"}
                  </button>
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
                      {snap?.hasDD
                        ? <div className="mt-0.5 inline-flex rounded bg-[#ECFDF3] px-1.5 py-0.5 text-[10px] font-semibold text-[#1B8C4B]">📦 รับของแล้ว</div>
                        : snap?.expectedDelivery && <div className="mt-0.5 text-[10.5px] text-[#9AA8A0]">📅 คาดรับ {fmtDateShort(snap.expectedDelivery)}</div>}
                      {snap?.note && snap.note.trim() !== (r.title || "").trim() && (
                        <div className="mt-0.5 line-clamp-1 text-[10.5px] text-[#B07D12]" title={`เหตุผลในการขอ (จาก PR): ${snap.note}`}>💬 {snap.note}</div>
                      )}
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
                  ) : r.status !== OT_DONE_STATUS && scope.all ? (
                    // กดรับเรื่องได้จากตารางเลยทุกสถานะที่ยังไม่ปิด — ระบบจดชื่อผู้กดจาก session
                    // เฉพาะจัดซื้อ/ผู้บริหาร/admin เท่านั้น (แผนกอื่นเห็นเป็นข้อความ)
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
                  {/* mini progress 5 ขั้น — เห็น flow โดยไม่ต้องเปิด */}
                  {(() => {
                    const idx = OT_STATUSES.findIndex((s) => s.value === r.status)
                    return (
                      <div className="mt-1.5 flex gap-0.5" title={`ขั้นที่ ${idx + 1} จาก ${OT_STATUSES.length}`}>
                        {OT_STATUSES.map((_, i) => (
                          <span key={i} className="h-1 flex-1 rounded-full" style={{ background: i <= idx ? sm.color : "#E5E7EB" }} />
                        ))}
                      </div>
                    )
                  })()}
                  {r.status === OT_DONE_STATUS && r.closedAt && <div className="mt-1 text-[10.5px] text-[#1B8C4B]">🏁 {fmtDateShort(r.closedAt)}</div>}
                </div>
                <div className="grid grid-cols-2 justify-items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => openEdit(r)} title="แก้ไข" className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-[#F6FAF7] dark:bg-white/5 text-gray-500 transition hover:bg-[#1B8C4B]/10 hover:text-[#1B8C4B]"><Pencil size={14} /></button>
                  <button onClick={() => remove(r)} title="ลบ" className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-[#F6FAF7] dark:bg-white/5 text-gray-500 transition hover:bg-[#DC2626]/10 hover:text-[#DC2626]"><Trash2 size={14} /></button>
                </div>
              </div>

              {/* Accordion panel — animation ตาม animate-ui AccordionContent (height auto, 0.35s easeInOut) */}
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    key="detail"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.35, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="mx-4 mb-3 space-y-2 rounded-xl border-l-4 bg-[#F6FAF7] dark:bg-white/[0.03] px-4 py-3 text-[12.5px] leading-relaxed text-[#4B5F54] dark:text-gray-300" style={{ borderLeftColor: sm.color }}>
                      <p className="whitespace-pre-wrap font-semibold text-[#14271C] dark:text-white">{r.title}</p>
                      {reason && <p className="whitespace-pre-wrap text-[#B07D12] dark:text-amber-300">💬 <b>เหตุผลในการขอ (จาก PR):</b> {reason}</p>}
                      {r.detail && <p className="whitespace-pre-wrap">{r.detail}</p>}
                      {r.note && <p className="whitespace-pre-wrap text-[#9AA8A0]">📝 {r.note}</p>}
                      {/* ไฟล์แนบ — คลิกเปิดรูปเต็ม */}
                      {(r.images?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          {r.images!.map((img, ii) => /\.pdf$/i.test(img.filename || "") ? (
                            <a key={ii} href={img.webpUrl || undefined} target="_blank" rel="noreferrer" title={img.filename} className="inline-flex items-center gap-1 rounded-lg border border-[#F3C1C1] dark:border-red-900/40 bg-[#FEF3F2] dark:bg-red-950/20 px-2 py-1.5 text-[11px] font-medium text-[#DC2626] hover:underline">
                              📄 {img.filename.length > 24 ? img.filename.slice(0, 24) + "…" : img.filename}
                            </a>
                          ) : (
                            // เปิด Gallery ดูรูปทั้งหมดของเรื่องนี้ — ไม่ใช้ <a> (ลิงก์ว่างทำหน้าเด้งขึ้นบนสุด)
                            <button
                              key={ii}
                              type="button"
                              title={img.filename}
                              onClick={() => {
                                const pics = r.images!.filter((x) => !/\.pdf$/i.test(x.filename || ""))
                                setGallery({
                                  imgs: pics.map((x) => ({ url: x.webpUrl || x.thumbnailUrl || "", thumb: x.thumbnailUrl || x.webpUrl || "", filename: x.filename })),
                                  start: Math.max(0, pics.indexOf(img)),
                                })
                              }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={img.thumbnailUrl || img.webpUrl} alt={img.filename} className="h-14 w-14 cursor-zoom-in rounded-lg border border-[#EEF2F0] dark:border-white/10 object-cover transition hover:opacity-80" />
                            </button>
                          ))}
                        </div>
                      )}
                      {/* ลิงก์แนบ */}
                      {(r.links?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          {r.links!.map((u, ii) => (
                            <a key={ii} href={u} target="_blank" rel="noreferrer" title={u} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-[#D6E4F0] dark:border-blue-900/40 bg-[#F0F7FE] dark:bg-blue-950/20 px-2 py-1.5 text-[11px] font-medium text-[#1D6FB8] dark:text-blue-300 hover:underline">
                              🔗 <span className="truncate">{shortUrl(u)}</span>
                            </a>
                          ))}
                        </div>
                      )}
                      {snap && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#EEF2F0] dark:border-white/8 pt-2 text-[11.5px]">
                          {r.prCode && <span className="font-mono font-medium text-[#14271C] dark:text-white">{r.prCode}</span>}
                          {snap.poCodes.map((po) => (
                            <span key={po} className="rounded bg-[#EEF2FF] px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-[#3b5bdb] dark:bg-blue-900/25 dark:text-blue-300">PO {po}</span>
                          ))}
                          {snap.total > 0 && <span className="font-semibold text-[#1B8C4B]">฿ {fmtNum(snap.total)}</span>}
                          {snap.hasDD
                            ? <span className="rounded bg-[#ECFDF3] px-1.5 py-0.5 text-[10px] font-semibold text-[#1B8C4B]">📦 รับของแล้ว</span>
                            : snap.expectedDelivery && <span>📅 คาดรับ {fmtDateShort(snap.expectedDelivery)}</span>}
                          {r.acceptedBy && <span>🛒 {r.acceptedBy}{r.estimatedDone ? ` · 🎯 คาดเสร็จ ${fmtDateShort(r.estimatedDone)}` : ""}</span>}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Mobile: การ์ดแนวตั้ง (จอ < md) — ไม่ต้อง scroll แนวนอน ── */}
      <div className="space-y-2.5 md:hidden">
        {loading ? (
          <div className="rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] px-4 py-12 text-center text-sm text-gray-400">กำลังโหลด...</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] px-4 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F0FDF4] dark:bg-[#1B8C4B]/10 text-[#1B8C4B]"><ClipboardList size={22} /></div>
            <p className="text-sm font-semibold text-[#14271C] dark:text-white">{q || fStatus || fDept ? "ไม่พบเรื่องตามตัวกรอง" : "ยังไม่มีเรื่องติดตาม"}</p>
            <button onClick={openAdd} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-4 py-2 text-sm font-semibold text-white"><Plus size={15} /> เปิดเรื่องใหม่</button>
          </div>
        ) : rows.map((r) => {
          const sm   = otStatusMeta(r.status)
          const days = ageDays(r.createdAt)
          const snap = r.prSnapshot
          const idx  = OT_STATUSES.findIndex((s) => s.value === r.status)
          return (
            <div
              key={r._id}
              onClick={() => openEdit(r)}
              className="cursor-pointer rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] p-3.5"
              style={{ borderLeft: `4px solid ${sm.color}` }}
            >
              {/* สถานะ + อายุ */}
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${sm.cls}`}><span>{sm.emoji}</span>{sm.value}</span>
                <span className="shrink-0 text-[11px] text-[#9AA8A0]">⏱ {days ?? "—"} วัน</span>
              </div>
              {/* เรื่องที่ขอ */}
              <p className="line-clamp-2 text-[13.5px] font-semibold leading-relaxed text-[#14271C] dark:text-white">{r.title}</p>
              {/* mini progress */}
              <div className="mt-2 flex gap-0.5">
                {OT_STATUSES.map((_, i) => (
                  <span key={i} className="h-1 flex-1 rounded-full" style={{ background: i <= idx ? sm.color : "#E5E7EB" }} />
                ))}
              </div>
              {/* meta */}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#5B7568] dark:text-gray-400">
                <span className="max-w-[180px] truncate">👤 {r.requester || "—"}</span>
                {r.prCode
                  ? <span className="font-mono font-medium text-[#14271C] dark:text-white">{r.prCode}</span>
                  : <span className="rounded bg-[#FDF3DD] px-1.5 py-0.5 text-[10px] font-semibold text-[#B07D12] dark:bg-amber-900/25 dark:text-amber-300">ยังไม่มี PR</span>}
                {snap && snap.poCodes.length > 0 && <span className="font-mono text-[10.5px]">PO {snap.poCodes.length} ใบ</span>}
                {snap && snap.total > 0 && <span className="font-medium text-[#1B8C4B]">฿ {fmtNum(snap.total)}</span>}
                {(r.images?.length ?? 0) > 0 && <span>📎 {r.images!.length}</span>}
              </div>
              {/* ผู้รับ / ปุ่มรับเรื่อง */}
              <div className="mt-2 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                {r.acceptedBy ? (
                  <span className="min-w-0 truncate text-[11px] text-[#5B7568] dark:text-gray-400">🛒 {r.acceptedBy}{r.estimatedDone ? ` · 🎯 ${fmtDateShort(r.estimatedDone)}` : ""}</span>
                ) : r.status !== OT_DONE_STATUS && scope.all ? (
                  <button onClick={() => accept(r)} className="inline-flex items-center gap-1 rounded-lg bg-[#eab308] px-3 py-2 text-[12px] font-semibold text-white">
                    <UserCheck size={13} /> รับเรื่อง
                  </button>
                ) : r.status !== OT_DONE_STATUS ? (
                  <span className="min-w-0 truncate text-[11px] text-[#9AA8A0]">ยังไม่มีผู้รับเรื่อง</span>
                ) : <span />}
                <button onClick={() => openEdit(r)} className="shrink-0 rounded-lg border border-[#E2E8E4] dark:border-white/10 px-3 py-2 text-[12px] font-medium text-[#1B8C4B]">ดู / แก้ไข</button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal — เปิด/ปิดแบบ animate (backdrop fade + dialog scale-slide) */}
      <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-2 backdrop-blur-sm sm:p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="my-2 w-full max-w-2xl rounded-2xl border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] shadow-xl sm:my-8"
          >
            <div className="flex items-center justify-between border-b border-[#EEF2F0] dark:border-white/8 px-5 py-4">
              <h2 className="text-[17px] font-semibold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
                {editId ? "แก้ไขเรื่องติดตาม" : "เปิดเรื่องใหม่"}
              </h2>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5"><X size={18} /></button>
            </div>

            {/* Stepper — เห็น flow ทั้งเส้น: อยู่ขั้นไหน ใครรับ ขั้นไหนระบบเดินให้เอง */}
            {current && <OtStepper status={current.status} acceptedBy={current.acceptedBy} />}

            <div className="space-y-4 px-4 py-4 sm:px-5 sm:py-5">
              {/* ── โซนกรอกข้อมูล ── */}
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#9AA8A0]">✏️ ข้อมูลเรื่อง {isClosed && <span className="ml-1 normal-case">🔒 ปิดงานแล้ว — แก้ไขไม่ได้</span>}</p>
              {/* PR autocomplete */}
              <div ref={prBoxRef} className={"relative" + roCls}>
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
                          setForm((f) => ({ ...f, prCode: h.code, dept: f.dept || h.dept }))
                          setPrOpen(false); setPrHits([])
                          // เรื่องที่ขอ = เหตุผลในการขอจาก PR (เติมอัตโนมัติ)
                          previewPr(h.code, true)
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
                {/* ไม่พบ PR */}
                {prPreview === "notfound" && form.prCode.trim() && (
                  <p className="mt-1.5 rounded-md bg-[#FDF3DD] px-2.5 py-1.5 text-[11px] text-[#B07D12]">⚠ ไม่พบ PR นี้ในระบบ — บันทึกได้ แต่จะยังไม่ sync สถานะจนกว่า PR จะเข้าระบบ</p>
                )}
                {/* การ์ด PR ตอนสร้างใหม่ (edit จะแสดงในโซนติดตามด้านล่าง) */}
                {!editId && prPreview && prPreview !== "notfound" && (
                  <PrCard snap={prPreview.snapshot} autoStatus={prPreview.autoStatus} />
                )}
              </div>

              <div className={roCls}>
                <label className={labelCls}>เรื่องที่ขอ <span className="text-red-500">*</span> <span className="text-[10px] font-normal text-gray-400">(เลือก PR แล้วเติมจากเหตุผลในการขอให้อัตโนมัติ)</span></label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} placeholder="เช่น ขอซื้อยางอะไหล่ 10 เส้น" />
              </div>

              <div className={roCls}>
                <label className={labelCls}>รายละเอียด</label>
                <textarea value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} rows={3} className={inputCls} placeholder="สเปก / จำนวน / เหตุผลที่ขอ" />
              </div>

              <div className={"grid grid-cols-1 gap-4 sm:grid-cols-2" + roCls}>
                {/* ผู้เปิดเรื่อง — ล็อกตามผู้ใช้ที่ล็อกอิน (อีเมลจาก session) แก้ไม่ได้ */}
                <div>
                  <label className={labelCls}>ผู้เปิดเรื่อง <span className="text-[10px] font-normal text-gray-400">🔒 อิงจากอีเมลที่ล็อกอิน</span></label>
                  <div className={inputCls + " cursor-not-allowed bg-[#F6FAF7] dark:bg-white/5 text-gray-600 dark:text-gray-300"}>
                    {editId
                      ? <>{current?.requester || "—"}{current?.requesterEmail && <span className="ml-1 text-[11px] text-[#9AA8A0]">({current.requesterEmail})</span>}</>
                      : <>{session?.user?.name || "—"}{session?.user?.email && <span className="ml-1 text-[11px] text-[#9AA8A0]">({session.user.email})</span>}</>}
                  </div>
                </div>
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

              {/* ไฟล์แนบ — รูป/เอกสาร (ใบเสนอราคา, รูปของที่ขอ ฯลฯ) */}
              <div className={roCls}>
                <label className={labelCls}>ไฟล์แนบ <span className="text-[10px] font-normal text-gray-400">(รูป / เอกสาร เช่น ใบเสนอราคา)</span></label>
                <ImageUpload key={editId ?? "new"} initial={formImages} onChange={setFormImages} />
              </div>

              {/* ลิงก์แนบ — 1 บรรทัดต่อ 1 ลิงก์ */}
              <div>
                <label className={labelCls}>🔗 ลิงก์แนบ <span className="text-[10px] font-normal text-gray-400">(1 บรรทัดต่อ 1 ลิงก์ — เช่น ลิงก์สินค้า, ใบเสนอราคาออนไลน์, เอกสาร)</span></label>
                <textarea value={form.linksText} onChange={(e) => setForm({ ...form, linksText: e.target.value })} rows={2} className={inputCls} placeholder={"https://example.com/quotation\nhttps://shopee.co.th/..."} />
              </div>

              {/* Note — เฉพาะตอนเปิดเรื่องใหม่ (หลังจากนั้นให้ใช้ความคิดเห็นแทน — มีชื่อ+เวลา) */}
              {!editId && (
                <div>
                  <label className={labelCls}>Note</label>
                  <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} className={inputCls} placeholder="หมายเหตุเพิ่มเติม" />
                </div>
              )}

              {/* ── โซนการติดตาม (อ่านอย่างเดียว — sync จากระบบ) ── */}
              {current && (
                <div className="space-y-3 rounded-2xl bg-[#F6FAF7] dark:bg-white/[0.03] p-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[#9AA8A0]">🔄 การติดตาม (ข้อมูลจากระบบ — อ่านอย่างเดียว)</p>

                  {/* การ์ด PR เดียวจบ */}
                  {(() => {
                    const snap = prPreview && prPreview !== "notfound" ? prPreview.snapshot : current.prSnapshot
                    return snap ? <PrCard snap={snap} syncedAt={current.prSyncedAt} /> : (
                      <p className="text-[11.5px] text-[#9AA8A0]">ยังไม่ได้ผูกเลข PR — สถานะเดินด้วยมือ (แจ้งเรื่อง → รับเรื่อง → ปิดงาน)</p>
                    )
                  })()}

                  <div className="text-[11.5px] text-[#5B7568] dark:text-gray-400">
                    <p>✍️ เปิดเรื่องโดย <b className="text-[#14271C] dark:text-white">{current.requester || "—"}</b>{current.requesterEmail && <span className="ml-1 text-[#9AA8A0]">({current.requesterEmail})</span>} · {fmtDateShort(current.createdAt || "")}</p>
                    {current.acceptedBy && <p className="mt-0.5">👤 รับเรื่องโดย <b className="text-[#14271C] dark:text-white">{current.acceptedBy}</b> · {fmtDateShort(current.acceptedAt)}</p>}
                  </div>

                  {/* ประวัติ — ย่อไว้ กดดูเมื่ออยากรู้ */}
                  {(current.log?.length ?? 0) > 0 && (
                    <div>
                      <button type="button" onClick={() => setShowLog((v) => !v)} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#1B8C4B] hover:underline">
                        <History size={12} /> {showLog ? "ซ่อนประวัติ" : `ดูประวัติ (${current.log!.length})`}
                      </button>
                      {showLog && (
                        <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1 text-[11.5px] text-[#5B7568] dark:text-gray-400">
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
                      )}
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

            {/* footer — ปุ่มหลักเปลี่ยนตามสถานะเรื่อง */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EEF2F0] dark:border-white/8 px-4 py-3.5 sm:px-5 sm:py-4">
              <div className="flex items-center gap-2">
                {current && !isClosed && (
                  <button onClick={() => closeJob(current)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#1B8C4B]/40 px-3.5 py-2 text-sm font-medium text-[#1B8C4B] hover:bg-[#F0FDF4] dark:hover:bg-white/5">
                    <PackageCheck size={15} /> ปิดงาน
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setOpen(false)} className="rounded-lg border border-gray-200 dark:border-white/10 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5">
                  {isClosed ? "ปิดหน้าต่าง" : "ยกเลิก"}
                </button>
                {/* ยังไม่มีผู้รับ → ปุ่มหลักคือรับเรื่อง · มีผู้รับแล้ว → ปุ่มหลักคือบันทึก
                    ปุ่ม "รับเรื่อง" เป็นงานของจัดซื้อ — เห็นเฉพาะผู้ที่เข้าถึงได้ทุกแผนก (จัดซื้อ/ผู้บริหาร/admin) */}
                {current && !current.acceptedBy && !isClosed && scope.all ? (
                  <>
                    <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-[#1B8C4B]/40 px-4 py-2 text-sm font-medium text-[#1B8C4B] hover:bg-[#F0FDF4] dark:hover:bg-white/5 disabled:opacity-60">
                      <Check size={15} /> {saving ? "กำลังบันทึก..." : "บันทึก"}
                    </button>
                    <button
                      onClick={() => accept(current)}
                      title={`กดแล้วระบบบันทึกชื่อคุณ (${session?.user?.name || session?.user?.email || ""}) เป็นผู้รับผิดชอบ`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#eab308] px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#ca9a04]"
                    >
                      <UserCheck size={16} /> รับเรื่อง (จัดซื้อ)
                    </button>
                  </>
                ) : !isClosed ? (
                  <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-60">
                    <Check size={16} /> {saving ? "กำลังบันทึก..." : editId ? "บันทึกการแก้ไข" : "เปิดเรื่อง"}
                  </button>
                ) : null}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Gallery ดูรูปเต็มจอ — ลูกศรเลื่อนดูทุกรูปของเรื่อง + ดาวน์โหลด/เปิดแท็บใหม่ */}
      {gallery && <ImageGallery images={gallery.imgs} start={gallery.start} onClose={() => setGallery(null)} />}
    </div>
  )
}

// Stepper 5 ขั้น — เห็นทั้ง flow: ผ่านอะไรมา อยู่ไหน เหลืออะไร ขั้นไหน sync อัตโนมัติ
function OtStepper({ status, acceptedBy }: { status: string; acceptedBy?: string }) {
  const idx = OT_STATUSES.findIndex((s) => s.value === status)
  return (
    <div className="border-b border-[#EEF2F0] dark:border-white/8 bg-[#F9FCFA] dark:bg-white/[0.02] px-4 pb-3 pt-4">
      <div className="flex">
        {OT_STATUSES.map((s, i) => {
          const passed = i < idx
          const curr   = i === idx
          // ป้ายช่วยใต้ขั้น: ขั้นรับเรื่อง = ชื่อผู้รับ · ขั้น PR/PO/ปิดงาน = sync อัตโนมัติ
          const sub =
            i === 1 ? (acceptedBy ? `👤 ${acceptedBy}` : (passed ? "ข้ามขั้น" : "")) :
            i >= 2  ? "🔄 อัตโนมัติ" : ""
          return (
            <div key={s.value} className="relative flex flex-1 flex-col items-center">
              {/* เส้นเชื่อมจากขั้นก่อนหน้า */}
              {i > 0 && (
                <span className="absolute right-1/2 top-[11px] -z-0 h-0.5 w-full" style={{ background: i <= idx ? "#1B8C4B" : "#E5E7EB" }} />
              )}
              <span
                className={`z-10 flex h-[22px] w-[22px] items-center justify-center rounded-full text-[10px] font-bold ${passed ? "bg-[#1B8C4B] text-white" : curr ? "text-white ring-4" : "bg-[#E5E7EB] dark:bg-white/10 text-[#9AA8A0]"}`}
                style={curr ? { background: s.color, boxShadow: `0 0 0 4px ${s.color}33` } : undefined}
              >
                {passed ? <Check size={12} /> : s.emoji}
              </span>
              <span className={`mt-1.5 max-w-full truncate px-0.5 text-center text-[10px] leading-tight ${curr ? "font-bold text-[#14271C] dark:text-white" : passed ? "font-medium text-[#1B8C4B]" : "text-[#9AA8A0]"}`}>
                {s.value}
              </span>
              {sub && <span className="mt-0.5 max-w-full truncate px-0.5 text-center text-[9px] text-[#9AA8A0]" title={sub}>{sub}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// การ์ดข้อมูล PR ใบเดียวจบ — code/PO/ยอด/คาดรับ/เหตุผลในการขอ (ย่อ-ขยายได้)
function PrCard({ snap, autoStatus, syncedAt }: { snap: PrSnapshot; autoStatus?: string; syncedAt?: string }) {
  const [full, setFull] = useState(false)
  const noteLong = (snap.note || "").length > 90
  return (
    <div className="mt-1.5 rounded-xl border border-[#D6EFDF] dark:border-[#1B8C4B]/30 bg-white dark:bg-[#0f1117] px-3.5 py-3 text-[11.5px]">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold text-[#0F6A3C] dark:text-[#4ade80]"><RefreshCw size={12} /> ข้อมูลจากระบบ PR</p>
        {syncedAt && <span className="text-[10px] text-[#9AA8A0]">sync {new Date(syncedAt).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[#4B5F54] dark:text-gray-300">
        <span>🏭 {snap.warehouse || "—"}</span>
        <span>🏢 {snap.dept || "—"}</span>
        <span>👤 {snap.requester || "—"}</span>
        <span className="font-semibold text-[#1B8C4B]">฿ {fmtNum(snap.total)}</span>
        {snap.expectedDelivery && !snap.hasDD && <span>📅 คาดรับ {fmtDateShort(snap.expectedDelivery)}</span>}
      </div>
      {snap.poCodes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {snap.poCodes.map((po) => (
            <span key={po} className="rounded bg-[#EEF2FF] px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-[#3b5bdb] dark:bg-blue-900/25 dark:text-blue-300">PO {po}</span>
          ))}
          {snap.hasDD && <span className="rounded bg-[#ECFDF3] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#1B8C4B]">📦 รับของแล้ว</span>}
        </div>
      )}
      {snap.note && (
        <p className={`mt-1.5 text-[#B07D12] dark:text-amber-300 ${full ? "" : "line-clamp-2"}`}>
          💬 <b>เหตุผลในการขอ:</b> {snap.note}
          {noteLong && (
            <button type="button" onClick={() => setFull((v) => !v)} className="ml-1 font-medium text-[#1B8C4B] hover:underline">{full ? "ย่อ" : "ดูเพิ่ม"}</button>
          )}
        </p>
      )}
      {autoStatus && (
        <p className="mt-1.5 border-t border-[#EEF2F0] dark:border-white/8 pt-1.5 text-[#0F6A3C] dark:text-[#4ade80]">
          สถานะที่จะตั้งให้: <b>{otStatusMeta(autoStatus).emoji} {autoStatus}</b>{snap.hasDD && " (รับของครบแล้ว — ปิดจบอัตโนมัติ)"}
        </p>
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
