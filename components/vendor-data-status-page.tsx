"use client"

// ===========================================================================
// สถานะข้อมูล (Vendor List → สถานะข้อมูล) — บิล/ใบเสนอราคาที่อัปโหลด + Dialog รายการ
//
// UI อย่างเดียวตามที่ Bew เลือก 2026-10-27: ข้อมูลมาจาก lib/vendor-data-status-mock.ts
// ยังไม่มี API/DB — ของที่เพิ่มผ่านปุ่ม AI อยู่ใน state ของหน้า (รีเฟรชแล้วหาย)
// ปุ่ม AI = อ่านรูปบิลแล้วแยกเป็นรายการ — ตอนนี้ "จำลองผล" ยังไม่เรียก Claude จริง
// ===========================================================================

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Dialog as DialogPrimitive } from "radix-ui"
import {
  ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, ClipboardList, Download, ImageIcon, Link2, Loader2,
  Maximize2, Plus, RotateCw, Search, Send, Sparkles, Trash2, Undo2, Upload, X, ZoomIn, ZoomOut,
} from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  buildFacetOptions, passFacets, ColHead, Empty, Pager,
  dtTdCls, dtTheadCls, PAGE_SIZES,
  type FacetOption, type HeadCtx, type SortState,
} from "@/components/datatable-shared"
import { card, fontHead, fontThai, inp } from "@/components/tire/shared"
import {
  DOC_STATUSES, ITEM_CATALOG, MOCK_VENDOR_DOCS, docTotal,
  type DocItem, type DocStatus, type VendorDoc,
} from "@/lib/vendor-data-status-mock"

// ── รูปแบบตัวเลข / เวลา ────────────────────────────────────────────────────

const fmtDateTime = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" })
const fmtDate = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" })
const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (n: number) => n.toLocaleString("th-TH")

const STATUS_CHIP: Record<DocStatus, string> = {
  "รอตรวจสอบ":  "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25",
  "ตรวจสอบแล้ว": "bg-[#F0FDF4] text-[#1B8C4B] ring-[#1B8C4B]/25 dark:bg-green-500/10 dark:text-green-300 dark:ring-green-500/25",
  "ยกเลิก":     "bg-slate-100 text-slate-600 ring-slate-300 dark:bg-white/5 dark:text-gray-400 dark:ring-white/15",
  "รอแก้ไข":    "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/25",
}

function StatusChip({ status }: { status: DocStatus }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold ring-1 ring-inset ${STATUS_CHIP[status]}`} style={fontThai}>
      {status}
    </span>
  )
}

// ── เรียง / กรองรายคอลัมน์ ─────────────────────────────────────────────────

type SortKey = "id" | "at" | "supplier" | "plate" | "truckNo" | "ddNo" | "inspectedBy" | "poNo" | "pvNo" | "status" | "total" | "images"
type FacetKey = "date" | "supplier" | "plate" | "truckNo" | "inspectedBy" | "status"
type FacetState = Record<FacetKey, string[]>

const FACET_KEYS: readonly FacetKey[] = ["date", "supplier", "plate", "truckNo", "inspectedBy", "status"]
const NO_FACETS: FacetState = { date: [], supplier: [], plate: [], truckNo: [], inspectedBy: [], status: [] }

const FACET_VALUE: Record<FacetKey, (d: VendorDoc) => string> = {
  date:        (d) => fmtDate.format(new Date(d.at)),
  supplier:    (d) => d.supplier,
  plate:       (d) => d.plate || "—",
  truckNo:     (d) => d.truckNo || "—",
  inspectedBy: (d) => d.inspectedBy || "—",
  status:      (d) => d.status,
}

const SORT_VALUE: Record<SortKey, (d: VendorDoc) => string | number> = {
  id:          (d) => d.id,
  at:          (d) => d.at,
  supplier:    (d) => d.supplier,
  plate:       (d) => d.plate,
  truckNo:     (d) => d.truckNo,
  ddNo:        (d) => d.ddNo,
  inspectedBy: (d) => d.inspectedBy,
  poNo:        (d) => d.poNo,
  pvNo:        (d) => d.pvNo,
  status:      (d) => DOC_STATUSES.indexOf(d.status),
  total:       (d) => docTotal(d),
  images:      (d) => d.images.length,
}

// หัว/ช่องตารางของหน้านี้ใหญ่กว่า datatable กลาง (คอลัมน์น้อย อ่านง่ายขึ้น) — ทับด้วย ! ไม่แตะไฟล์กลาง
const TH = "text-[12.5px]! py-3! px-4!"
const TD = dtTdCls + " px-4! py-3! align-middle!"

/** ช่องข้อความสั้นของตาราง — ค่าว่างแสดง "—" จาง ๆ */
function TextCell({ value, mono, thai }: { value: string; mono?: boolean; thai?: boolean }) {
  return (
    <td className={TD}>
      {value ? (
        <div className={`truncate text-[13.5px] text-[#14271C] dark:text-gray-100 ${mono ? "font-mono" : ""}`} style={thai ? fontThai : undefined} title={value}>{value}</div>
      ) : (
        <span className="text-[#C9D3CD]">—</span>
      )}
    </td>
  )
}

// ── หน้า ────────────────────────────────────────────────────────────────────

export function VendorDataStatusPage() {
  const [docs, setDocs] = useState<VendorDoc[]>(MOCK_VENDOR_DOCS)
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "at", dir: "desc" })
  const [facets, setFacets] = useState<FacetState>(NO_FACETS)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[0])
  const [openId, setOpenId] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return docs
    return docs.filter((d) =>
      d.id.toLowerCase().includes(needle) ||
      d.supplier.toLowerCase().includes(needle) ||
      [d.plate, d.truckNo, d.ddNo, d.poNo, d.pvNo, d.inspectedBy].some((v) => v.toLowerCase().includes(needle)) ||
      d.items.some((i) => i.name.toLowerCase().includes(needle))
    )
  }, [docs, q])

  const facetOptions: Record<FacetKey, FacetOption[]> = useMemo(
    () => buildFacetOptions(searched, FACET_KEYS, facets, FACET_VALUE),
    [searched, facets]
  )

  const rows = useMemo(() => {
    const kept = searched.filter((d) => passFacets(d, FACET_KEYS, facets, FACET_VALUE))
    if (!sort) return kept
    const valueOf = SORT_VALUE[sort.key]
    const sign = sort.dir === "asc" ? 1 : -1
    return [...kept].sort((a, b) => {
      const x = valueOf(a), y = valueOf(b)
      const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "th")
      // ค่าเท่ากัน → ตัดสินด้วยเวลาล่าสุดก่อน (ไม่คูณ sign กันกลุ่มเท่ากันพลิกตามทิศคอลัมน์หลัก)
      return cmp ? cmp * sign : b.at.localeCompare(a.at)
    })
  }, [searched, facets, sort])

  const headCtx: HeadCtx<SortKey, FacetKey> = {
    sort,
    facets,
    options: facetOptions,
    onSort: (key, dir) => setSort(dir ? { key, dir } : null),
    onPick: (key, values) => setFacets((f) => ({ ...f, [key]: values })),
  }

  const pageCount = Math.max(1, Math.ceil(rows.length / perPage))
  const current = Math.min(page, pageCount)
  const sliceFrom = (current - 1) * perPage
  const pageRows = rows.slice(sliceFrom, sliceFrom + perPage)

  // เปลี่ยนตัวกรองแล้วกลับหน้า 1 — ปรับ state ตอน render แบบเดียวกับหน้า stock-safety
  const filterKey = `${q}|${perPage}|` + FACET_KEYS.map((k) => k + ":" + facets[k].join(",")).join(";")
  const [lastKey, setLastKey] = useState(filterKey)
  if (lastKey !== filterKey) {
    setLastKey(filterKey)
    setPage(1)
  }

  const filtered = q.trim() !== "" || FACET_KEYS.some((k) => facets[k].length > 0)
  const clearFilters = () => { setQ(""); setFacets(NO_FACETS) }
  const openDoc = docs.find((d) => d.id === openId) ?? null

  async function copyFormLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/form-vendor`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* เบราว์เซอร์ไม่ให้เข้าคลิปบอร์ด — เงียบไว้ */ }
  }

  function addFromAi(doc: VendorDoc) {
    setDocs((d) => [doc, ...d])
    setAiOpen(false)
    setOpenId(doc.id)
  }

  const COLS = 12

  return (
    <div>
      {/* ── หัวเรื่อง ── */}
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <ClipboardList size={20} className="text-[#1B8C4B]" />
        <h1 className="text-[22px] text-[#14271C] dark:text-white" style={fontHead}>สถานะข้อมูล</h1>
        <span className="text-[13px] text-[#9AA8A0]" style={fontThai}>({num(docs.length)} รายการ)</span>
        <button
          type="button"
          onClick={copyFormLink}
          className="ml-auto inline-flex items-center gap-1 rounded-[10px] border border-[#EEF2F0] px-2.5 py-1.5 text-[12px] text-[#6B7C72] transition-colors hover:bg-[#F0FDF4] dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
          style={fontThai}
          title="ลิงก์ภายนอก — ผู้ที่มีลิงก์ลงทะเบียนได้โดยไม่ต้องเข้าสู่ระบบ"
        >
          {copied ? <Check size={12} className="text-[#1B8C4B]" /> : <Link2 size={12} />}
          {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์ฟอร์มลงทะเบียน Vendor"}
        </button>
      </div>
      <p className="mb-4 text-[13px] text-[#9AA8A0]" style={fontThai}>
        บิล / ใบเสนอราคาที่อัปโหลด · กดแถวเพื่อดูรูปและรายการ · <span className="text-amber-600 dark:text-amber-400">ข้อมูลตัวอย่าง (ยังไม่เชื่อมฐานข้อมูล)</span>
      </p>

      {/* ── ส่วนบน: ค้นหา + AI ── */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9AA8A0]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหา ไอดี / ซัพพลายเออร์ / ทะเบียน / เลข DD · PO · PV..."
            aria-label="ค้นหา"
            className={inp + " w-full py-2 pl-9"}
            style={fontThai}
          />
        </div>
        <button
          type="button"
          onClick={() => setAiOpen(true)}
          title="AI อ่านรูปบิล → รายการ"
          aria-label="AI อ่านรูปบิล"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[11px] bg-linear-to-b from-[#22A25B] to-[#1B8C4B] px-3 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          style={fontThai}
        >
          <Sparkles size={14} />
          <span className="hidden sm:inline">AI อ่านบิล</span>
        </button>
      </div>

      {/* ── ตาราง ── */}
      <div className={card + " overflow-x-auto"}>
        <table className="w-full min-w-[1610px] table-fixed text-sm">
          <thead>
            <tr className={dtTheadCls}>
              <ColHead ctx={headCtx} label="ไอดี" width={"w-[130px] " + TH}
                sortKey="id" sortLabels={["ไอดี น้อย → มาก", "ไอดี มาก → น้อย"]} />
              <ColHead ctx={headCtx} label="ประทับเวลา" width={"w-[165px] " + TH}
                sortKey="at" sortLabels={["เก่าสุดก่อน", "ล่าสุดก่อน"]} facetKey="date" />
              <ColHead ctx={headCtx} label="ซัพพลายเออร์" width={"w-[230px] " + TH}
                sortKey="supplier" sortLabels={["ชื่อ ก → ฮ", "ชื่อ ฮ → ก"]} facetKey="supplier" />
              <ColHead ctx={headCtx} label="ทะเบียนรถ" width={"w-[160px] " + TH}
                sortKey="plate" sortLabels={["ทะเบียน ก → ฮ", "ทะเบียน ฮ → ก"]} facetKey="plate" />
              <ColHead ctx={headCtx} label="เบอร์รถ" width={"w-[105px] " + TH}
                sortKey="truckNo" sortLabels={["เบอร์ น้อย → มาก", "เบอร์ มาก → น้อย"]} facetKey="truckNo" />
              <ColHead ctx={headCtx} label="เลข DD" width={"w-[130px] " + TH}
                sortKey="ddNo" sortLabels={["เลข น้อย → มาก", "เลข มาก → น้อย"]} />
              <ColHead ctx={headCtx} label="เลข PO" width={"w-[130px] " + TH}
                sortKey="poNo" sortLabels={["เลข น้อย → มาก", "เลข มาก → น้อย"]} />
              <ColHead ctx={headCtx} label="เลข PV" width={"w-[130px] " + TH}
                sortKey="pvNo" sortLabels={["เลข น้อย → มาก", "เลข มาก → น้อย"]} />
              <ColHead ctx={headCtx} label="ตรวจโดย" width={"w-[135px] " + TH}
                sortKey="inspectedBy" sortLabels={["ชื่อ ก → ฮ", "ชื่อ ฮ → ก"]} facetKey="inspectedBy" />
              <ColHead ctx={headCtx} label="สถานะ" width={"w-[130px] " + TH}
                sortKey="status" sortLabels={["รอตรวจสอบ → รอแก้ไข", "รอแก้ไข → รอตรวจสอบ"]} facetKey="status" />
              <ColHead ctx={headCtx} label="ราคารวม" width={"w-[125px] " + TH} align="right"
                sortKey="total" sortLabels={["ราคาน้อย → มาก", "ราคามาก → น้อย"]} />
              <ColHead ctx={headCtx} label="รูปภาพ" width={"w-[90px] " + TH}
                sortKey="images" sortLabels={["รูปน้อย → มาก", "รูปมาก → น้อย"]} />
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={COLS}>
                  <Empty hint={filtered ? "ไม่พบรายการที่ตรงกับเงื่อนไข" : "ยังไม่มีข้อมูล"} onClear={filtered ? clearFilters : undefined} />
                </td>
              </tr>
            ) : pageRows.map((d, i) => (
              <tr
                key={d.id}
                onClick={() => setOpenId(d.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(d.id) } }}
                tabIndex={0}
                className={[
                  "cursor-pointer border-b border-[#F1F5F2] transition-colors focus:outline-none focus-visible:bg-[#F0FDF4] dark:border-white/5",
                  i % 2 === 1 ? "bg-[#FAFCFB] dark:bg-white/1" : "",
                  "hover:bg-[#F0FDF4]/70 dark:hover:bg-white/4",
                ].join(" ")}
              >
                <td className={TD}>
                  <span className="font-mono text-[14px] font-semibold text-[#14271C] dark:text-white">{d.id}</span>
                </td>
                <td className={TD + " whitespace-nowrap text-[13.5px] text-[#6B7C72] tabular-nums dark:text-gray-300"} style={fontThai}>
                  {fmtDateTime.format(new Date(d.at))}
                </td>
                <td className={TD}>
                  <div className="truncate text-[14.5px] text-[#14271C] dark:text-gray-100" style={fontThai} title={d.supplier}>{d.supplier}</div>
                  <div className="mt-0.5 text-[12px] text-[#9AA8A0]" style={fontThai}>{d.items.length} รายการ</div>
                </td>
                <TextCell value={d.plate} thai />
                <TextCell value={d.truckNo} mono />
                <TextCell value={d.ddNo} mono />
                <TextCell value={d.poNo} mono />
                <TextCell value={d.pvNo} mono />
                <TextCell value={d.inspectedBy} thai />
                <td className={TD}><StatusChip status={d.status} /></td>
                <td className={TD + " text-right"}>
                  <span className="text-[15.5px] font-semibold text-[#14271C] tabular-nums dark:text-white" style={fontHead}>{baht(docTotal(d))}</span>
                </td>
                <td className={TD}>
                  {d.images.length ? (
                    <HoverZoomImg src={d.images[0]} alt={"รูปของ " + d.id} />
                  ) : (
                    <span className="text-[12.5px] text-[#C9D3CD]" style={fontThai}>ไม่มีรูป</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── ท้ายตาราง ── */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <p className="text-[13px] text-[#9AA8A0]" style={fontThai}>
          {rows.length ? (
            <>
              แสดง <span className="font-medium text-[#14271C] dark:text-white">{sliceFrom + 1}–{sliceFrom + pageRows.length}</span> จาก {num(rows.length)} รายการ
              {rows.length !== docs.length ? ` (ทั้งหมด ${num(docs.length)})` : ""}
            </>
          ) : "ไม่มีรายการที่ตรงกับเงื่อนไข"}
        </p>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 sm:flex">
            <span className="text-[12px] text-[#9AA8A0]" style={fontThai}>ต่อหน้า</span>
            <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} aria-label="จำนวนรายการต่อหน้า" className={inp}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <Pager current={current} count={pageCount} onGo={setPage} />
        </div>
      </div>

      <DocDialog doc={openDoc} onClose={() => setOpenId(null)}
        onStatus={(id, status) => setDocs((ds) => ds.map((x) => (x.id === id ? { ...x, status } : x)))}
        onItems={(id, items) => setDocs((ds) => ds.map((x) => (x.id === id ? { ...x, items } : x)))} />
      <AiReadDialog open={aiOpen} onClose={() => setAiOpen(false)} nextSeq={docs.length + 1} onSave={addFromAi} />
    </div>
  )
}

// ── รูปย่อในตาราง: ชี้เมาส์แล้วขยายใหญ่ ───────────────────────────────────────
// พรีวิวเป็น position: fixed ผ่าน portal — ไม่โดนกรอบ overflow ของตารางตัด
// วางทางซ้ายของรูปย่อ (คอลัมน์รูปอยู่ขวาสุด) ถ้าไม่พอค่อยย้ายไปขวา และบีบให้อยู่ในจอเสมอ

const ZOOM_W = 380

function HoverZoomImg({ src, alt }: { src: string; alt: string }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  function show(e: React.MouseEvent<HTMLElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    let left = r.left - ZOOM_W - 12
    if (left < 8) left = Math.min(r.right + 12, window.innerWidth - ZOOM_W - 8)
    const top = Math.max(8, Math.min(r.top + r.height / 2 - 200, window.innerHeight - 420))
    setPos({ left, top })
  }

  return (
    <span onMouseEnter={show} onMouseLeave={() => setPos(null)} onWheel={() => setPos(null)} className="block w-fit">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt}
        className="block h-14 w-20 rounded-[8px] border border-[#EEF2F0] bg-white object-cover transition-shadow hover:shadow-md hover:ring-2 hover:ring-[#1B8C4B]/40 dark:border-white/10" />
      {pos && createPortal(
        <div className="pointer-events-none fixed z-[60] overflow-hidden rounded-[14px] border border-[#EEF2F0] bg-white p-1.5 shadow-2xl dark:border-white/10 dark:bg-[#151a10]"
          style={{ left: pos.left, top: pos.top, width: ZOOM_W }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="max-h-[400px] w-full rounded-[10px] object-contain" />
        </div>,
        document.body
      )}
    </span>
  )
}

// ── Dialog รายละเอียด: รูป + ข้อมูล + ปรับสถานะ + ตารางรายการ + สรุป ─────────────

function DocDialog({ doc, onClose, onStatus, onItems }: {
  doc: VendorDoc | null
  onClose: () => void
  onStatus: (id: string, status: DocStatus) => void
  onItems: (id: string, items: DocItem[]) => void
}) {
  return (
    <Dialog open={doc !== null} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        {/* key = เปิดใบใหม่แล้วรูปที่เลือกกลับไปรูปแรก */}
        {doc && <DocBody key={doc.id} doc={doc} onStatus={(st) => onStatus(doc.id, st)} onItems={(items) => onItems(doc.id, items)} />}
      </DialogContent>
    </Dialog>
  )
}

function DocBody({ doc, onStatus, onItems }: {
  doc: VendorDoc
  onStatus: (status: DocStatus) => void
  onItems: (items: DocItem[]) => void
}) {
  const [shown, setShown] = useState(0)
  const [zoomAt, setZoomAt] = useState<number | null>(null)
  const [rows, setRows] = useState(() => toDrafts(doc.items))
  const [sent, setSent] = useState(false)
  const total = docTotal(doc)

  // เทียบกับค่าที่บันทึกไว้ผ่านการแปลงรอบเดียวกัน — กันปัดทศนิยมแล้วขึ้นว่า "แก้ไข" ทั้งที่ไม่ได้แตะ
  const base = useMemo(() => JSON.stringify(fromDrafts(toDrafts(doc.items))), [doc.items])
  const edited = fromDrafts(rows)
  const dirty = JSON.stringify(edited) !== base

  function send() {
    if (!edited || !dirty) return
    onItems(edited)
    setSent(true)
    setTimeout(() => setSent(false), 2000)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2" style={fontHead}>
          <span className="font-mono">{doc.id}</span>
          <StatusChip status={doc.status} />
        </DialogTitle>
        <DialogDescription style={fontThai}>{doc.supplier}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* รูปภาพที่อัปโหลด */}
        <section>
          <h3 className="mb-1.5 text-[12px] font-semibold text-[#6B7C72] dark:text-gray-400" style={fontThai}>รูปภาพที่อัปโหลด ({doc.images.length})</h3>
          {doc.images.length ? (
            <>
              <button type="button" onClick={() => setZoomAt(shown)} title="กดเพื่อดูรูปขนาดเต็ม"
                className="group relative block w-full cursor-zoom-in overflow-hidden rounded-[12px] border border-[#EEF2F0] bg-[#F6FAF7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B8C4B]/50 dark:border-white/10 dark:bg-white/3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={doc.images[shown]} alt={`รูปที่ ${shown + 1}`} className="max-h-[340px] w-full object-contain" />
                <ZoomBadge />
              </button>
              {doc.images.length > 1 && (
                <div className="mt-2 flex gap-2">
                  {doc.images.map((src, k) => (
                    <button key={k} type="button" onClick={() => setShown(k)} aria-label={`ดูรูปที่ ${k + 1}`}
                      className={`overflow-hidden rounded-[8px] border-2 ${k === shown ? "border-[#1B8C4B]" : "border-transparent opacity-70 hover:opacity-100"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="size-14 object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex h-40 flex-col items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-[#DDE5E0] text-[12px] text-[#9AA8A0] dark:border-white/10" style={fontThai}>
              <ImageIcon size={20} /> ไม่มีรูปที่อัปโหลด
            </div>
          )}
          <ImageLightbox images={doc.images} index={zoomAt}
            onIndex={(k) => { setZoomAt(k); setShown(k) }} onClose={() => setZoomAt(null)} />
        </section>

        {/* ข้อมูล */}
        <section>
          <h3 className="mb-1.5 text-[12px] font-semibold text-[#6B7C72] dark:text-gray-400" style={fontThai}>ข้อมูล</h3>
          <dl className="divide-y divide-[#EEF2F0] rounded-[12px] border border-[#EEF2F0] text-[14px] dark:divide-white/8 dark:border-white/10" style={fontThai}>
            {([
              ["ไอดี", <span key="id" className="font-mono">{doc.id}</span>],
              ["ประทับเวลา", fmtDateTime.format(new Date(doc.at))],
              ["ซัพพลายเออร์", doc.supplier],
              ["ทะเบียนรถ", doc.plate || "—"],
              ["เบอร์รถ", doc.truckNo || "—"],
              ["เลข DD", doc.ddNo || "—"],
              ["เลข PO", doc.poNo || "—"],
              ["เลข PV", doc.pvNo || "—"],
              ["ตรวจโดย", doc.inspectedBy || "—"],
              ["จำนวนรายการ", `${doc.items.length} รายการ`],
              ["ราคารวม", <span key="t" className="font-semibold tabular-nums">{baht(total)} บาท</span>],
            ] as const).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="shrink-0 text-[#9AA8A0]">{k}</dt>
                <dd className="text-right text-[#14271C] dark:text-gray-100">{v}</dd>
              </div>
            ))}
          </dl>

          {/* ปรับสถานะ — UI อย่างเดียว: อัปเดตใน state ของหน้า (ยังไม่บันทึก DB) */}
          <h3 className="mb-1.5 mt-4 text-[12px] font-semibold text-[#6B7C72] dark:text-gray-400" style={fontThai}>สถานะ</h3>
          <div role="radiogroup" aria-label="ปรับสถานะ" className="grid grid-cols-2 gap-1.5">
            {DOC_STATUSES.map((st) => {
              const on = st === doc.status
              return (
                <button key={st} type="button" role="radio" aria-checked={on} onClick={() => { if (!on) onStatus(st) }}
                  className={[
                    "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-[10px] px-2 py-2 text-[12px] font-semibold ring-1 ring-inset transition-colors",
                    on ? STATUS_CHIP[st] : "text-[#6B7C72] ring-[#EEF2F0] hover:bg-[#F6FAF7] dark:text-gray-400 dark:ring-white/10 dark:hover:bg-white/5",
                  ].join(" ")}
                  style={fontThai}>
                  {on && <Check size={12} />}{st}
                </button>
              )
            })}
          </div>
        </section>
      </div>

      {/* ตารางรายการ + สรุป */}
      <section>
        <h3 className="mb-1.5 text-[12px] font-semibold text-[#6B7C72] dark:text-gray-400" style={fontThai}>
          รายการ <span className="font-normal text-[#9AA8A0]">· กดที่ช่องเพื่อแก้ไข</span>
        </h3>
        <ItemsEditor rows={rows} onChange={setRows} />
        {/* UI อย่างเดียว: ส่งอัปเดตเข้า state ของหน้า (ยังไม่บันทึก DB) */}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2" style={fontThai}>
          {dirty && !sent && (
            <span className="mr-auto text-[12px] text-amber-600 dark:text-amber-400">
              {edited ? "มีการแก้ไขที่ยังไม่ได้ส่งอัปเดต" : "กรอกชื่อรายการ / จำนวน / หน่วยละให้ครบก่อนส่ง"}
            </span>
          )}
          {sent && (
            <span className="mr-auto inline-flex items-center gap-1 text-[12px] text-[#1B8C4B] dark:text-green-300">
              <Check size={13} /> ส่งอัปเดตแล้ว
            </span>
          )}
          <button type="button" disabled={!dirty} onClick={() => setRows(toDrafts(doc.items))}
            className="inline-flex items-center gap-1 rounded-[11px] border border-[#EEF2F0] px-3 py-2 text-[13px] text-[#6B7C72] hover:bg-[#F6FAF7] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5">
            <Undo2 size={13} /> คืนค่าเดิม
          </button>
          <button type="button" disabled={!dirty || !edited} onClick={send}
            className="inline-flex items-center gap-1.5 rounded-[11px] bg-[#1B8C4B] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#177A41] disabled:cursor-not-allowed disabled:opacity-40">
            <Send size={13} /> ส่งอัปเดต
          </button>
        </div>
      </section>
    </>
  )
}

// ── ตารางรายการแบบแก้ไขได้ ────────────────────────────────────────────────
// เก็บเป็น string ระหว่างพิมพ์ (พิมพ์ "12." ได้ไม่โดนตัด) แล้วค่อยแปลงเป็นตัวเลขตอนบันทึก
// จำนวนเงิน = จำนวน × หน่วยละ · แก้จำนวนเงินเอง → คำนวณหน่วยละย้อนกลับ (บิลที่มีส่วนลดในบรรทัด)

type ItemDraft = { key: number; name: string; qty: string; price: string; amount: string }
type NumField = "qty" | "price" | "amount"

let draftSeq = 0
const parseNum = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(/,/g, "")))
const numStr = (n: number, dp: number) => String(Number(n.toFixed(dp)))

function toDrafts(items: DocItem[]): ItemDraft[] {
  return items.map((it) => ({
    key: ++draftSeq, name: it.name,
    qty: numStr(it.qty, 4), price: numStr(it.price, 4), amount: numStr(it.qty * it.price, 2),
  }))
}

function rowIssues(r: ItemDraft) {
  const qty = parseNum(r.qty), price = parseNum(r.price)
  return {
    name: r.name.trim() === "",
    qty: !Number.isFinite(qty) || qty <= 0,
    price: !Number.isFinite(price) || price < 0,
  }
}

/** แปลงกลับเป็นรายการ — คืน null ถ้ายังไม่มีรายการหรือมีช่องที่ไม่ถูกต้อง */
function fromDrafts(rows: ItemDraft[]): DocItem[] | null {
  if (!rows.length) return null
  const bad = rows.some((r) => Object.values(rowIssues(r)).some(Boolean))
  if (bad) return null
  return rows.map((r) => ({ name: r.name.trim(), qty: parseNum(r.qty), price: parseNum(r.price) }))
}

function patchNum(r: ItemDraft, field: NumField, value: string): ItemDraft {
  const next = { ...r, [field]: value }
  const qty = parseNum(next.qty)
  if (field === "amount") {
    const amount = parseNum(value)
    if (qty > 0 && Number.isFinite(amount)) next.price = numStr(amount / qty, 4)
  } else {
    const price = parseNum(next.price)
    if (Number.isFinite(qty) && Number.isFinite(price)) next.amount = numStr(qty * price, 2)
  }
  return next
}

const cellInp = "h-8 w-full rounded-[8px] border bg-transparent px-2 text-[14px] text-[#14271C] transition-colors hover:border-[#DDE5E0] focus:border-[#1B8C4B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1B8C4B]/20 dark:text-gray-100 dark:hover:border-white/15 dark:focus:bg-white/5"
const cellOk = " border-transparent"
const cellBad = " border-red-300 bg-red-50/70 dark:border-red-500/40 dark:bg-red-500/10"
const iconBtn = "inline-flex size-6 items-center justify-center rounded-[6px] text-[#9AA8A0] transition-colors hover:bg-[#F0FDF4] hover:text-[#1B8C4B] disabled:pointer-events-none disabled:opacity-25 dark:hover:bg-white/5"

function ItemsEditor({ rows, onChange }: { rows: ItemDraft[]; onChange: (rows: ItemDraft[]) => void }) {
  const total = rows.reduce((sum, r) => {
    const v = parseNum(r.qty) * parseNum(r.price)
    return Number.isFinite(v) ? sum + v : sum
  }, 0)

  const update = (key: number, fn: (r: ItemDraft) => ItemDraft) => onChange(rows.map((r) => (r.key === key ? fn(r) : r)))
  const move = (i: number, d: number) => {
    const next = [...rows]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    onChange(next)
  }
  const add = () => onChange([...rows, { key: ++draftSeq, name: "", qty: "1", price: "", amount: "" }])

  return (
    <div className="overflow-x-auto rounded-[12px] border border-[#EEF2F0] dark:border-white/10">
      <table className="w-full min-w-[700px] text-[14px]" style={fontThai}>
        <thead>
          <tr className="border-b-2 border-[#1B8C4B]/30 bg-[#E4EFE8] text-[12.5px] font-bold text-[#14271C] dark:border-[#1B8C4B]/45 dark:bg-[#1B2419] dark:text-gray-100">
            <th className="w-[84px] px-3 py-2 text-center">ลำดับ</th>
            <th className="px-2 py-2 text-left">รายการ</th>
            <th className="w-[100px] px-2 py-2 text-right">จำนวน</th>
            <th className="w-[120px] px-2 py-2 text-right">หน่วยละ</th>
            <th className="w-[130px] px-2 py-2 text-right">จำนวนเงิน</th>
            <th className="w-10 px-1 py-2"><span className="sr-only">ลบ</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={6} className="px-3 py-6 text-center text-[13px] text-[#9AA8A0]">ยังไม่มีรายการ — กด &ldquo;เพิ่มรายการ&rdquo;</td></tr>
          )}
          {rows.map((r, i) => {
            const bad = rowIssues(r)
            return (
              <tr key={r.key} className="border-b border-[#F1F5F2] dark:border-white/5">
                <td className="px-2 py-1.5">
                  <div className="flex items-center justify-center gap-0.5">
                    <span className="w-5 text-center tabular-nums text-[#9AA8A0]">{i + 1}</span>
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`เลื่อนรายการที่ ${i + 1} ขึ้น`} className={iconBtn}><ArrowUp size={13} /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`เลื่อนรายการที่ ${i + 1} ลง`} className={iconBtn}><ArrowDown size={13} /></button>
                  </div>
                </td>
                <td className="px-1 py-1.5">
                  <input value={r.name} onChange={(e) => update(r.key, (x) => ({ ...x, name: e.target.value }))}
                    placeholder="ชื่อรายการ" aria-label={`ชื่อรายการที่ ${i + 1}`} aria-invalid={bad.name}
                    className={cellInp + (bad.name ? cellBad : cellOk)} />
                </td>
                <td className="px-1 py-1.5">
                  <input value={r.qty} onChange={(e) => update(r.key, (x) => patchNum(x, "qty", e.target.value))}
                    inputMode="decimal" aria-label={`จำนวนรายการที่ ${i + 1}`} aria-invalid={bad.qty}
                    className={cellInp + " text-right tabular-nums" + (bad.qty ? cellBad : cellOk)} />
                </td>
                <td className="px-1 py-1.5">
                  <input value={r.price} onChange={(e) => update(r.key, (x) => patchNum(x, "price", e.target.value))}
                    inputMode="decimal" placeholder="0.00" aria-label={`หน่วยละรายการที่ ${i + 1}`} aria-invalid={bad.price}
                    className={cellInp + " text-right tabular-nums" + (bad.price ? cellBad : cellOk)} />
                </td>
                <td className="px-1 py-1.5">
                  <input value={r.amount} onChange={(e) => update(r.key, (x) => patchNum(x, "amount", e.target.value))}
                    inputMode="decimal" placeholder="0.00" aria-label={`จำนวนเงินรายการที่ ${i + 1}`}
                    title="แก้จำนวนเงิน → คำนวณหน่วยละให้ใหม่"
                    className={cellInp + " text-right font-medium tabular-nums" + cellOk} />
                </td>
                <td className="px-1 py-1.5 text-center">
                  <button type="button" onClick={() => onChange(rows.filter((x) => x.key !== r.key))} aria-label={`ลบรายการที่ ${i + 1}`}
                    className={iconBtn + " hover:bg-red-50! hover:text-red-600! dark:hover:bg-red-500/10!"}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="bg-[#F6FAF7] dark:bg-white/3">
            <td colSpan={2} className="px-2 py-2">
              <button type="button" onClick={add}
                className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[13px] font-medium text-[#1B8C4B] hover:bg-[#E4EFE8] dark:text-green-300 dark:hover:bg-white/5">
                <Plus size={14} /> เพิ่มรายการ
              </button>
            </td>
            <td colSpan={2} className="px-3 py-2.5 text-right font-semibold text-[#14271C] dark:text-white">
              ราคารวมทั้งสิ้น <span className="font-normal text-[#9AA8A0]">({rows.length} รายการ)</span>
            </td>
            <td className="px-3 py-2.5 text-right text-[16px] tabular-nums text-[#1B8C4B] dark:text-green-300" style={fontHead}>{baht(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── ดูรูปเต็มจอ: ซูม / ลาก / หมุน / เลื่อนรูป ──────────────────────────────────
// เป็น Radix Dialog ซ้อนอีกชั้น — Esc / โฟกัส ปิดแค่ชั้นบน ไม่ปิด Dialog ข้างล่างไปด้วย

function ZoomBadge() {
  return (
    <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white opacity-80 transition-opacity group-hover:opacity-100" style={fontThai}>
      <Maximize2 size={11} /> ดูรูปเต็ม
    </span>
  )
}

function ImageLightbox({ images, index, onIndex, onClose }: {
  images: string[]
  index: number | null
  onIndex: (i: number) => void
  onClose: () => void
}) {
  return (
    <DialogPrimitive.Root open={index !== null && images.length > 0} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-[70] bg-black/85" />
        <DialogPrimitive.Content aria-describedby={undefined}
          className="data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-[70] outline-none">
          <DialogPrimitive.Title className="sr-only">ดูรูปขนาดเต็ม</DialogPrimitive.Title>
          {/* key = เปลี่ยนรูปแล้วซูม/หมุนกลับค่าเริ่มต้น */}
          {index !== null && <LightboxBody key={index} images={images} index={index} onIndex={onIndex} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

const LB_BTN = "inline-flex size-9 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-30"
const MAX_ZOOM = 5

function LightboxBody({ images, index, onIndex }: { images: string[]; index: number; onIndex: (i: number) => void }) {
  const [zoom, setZoom] = useState(1)
  const [rot, setRot] = useState(0)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const stageRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean; onBg: boolean } | null>(null)
  const many = images.length > 1
  const src = images[index]
  const side = rot % 180 !== 0

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const zoomTo = (z: number) => {
    const v = Math.min(MAX_ZOOM, Math.max(1, Math.round(z * 100) / 100))
    setZoom(v)
    if (v === 1) setOff({ x: 0, y: 0 })
  }
  const go = (d: number) => onIndex((index + d + images.length) % images.length)

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight" && many) go(1)
    else if (e.key === "ArrowLeft" && many) go(-1)
    else if (e.key === "+" || e.key === "=") zoomTo(zoom + 0.5)
    else if (e.key === "-") zoomTo(zoom - 0.5)
    else if (e.key === "0") zoomTo(1)
    else if (e.key === "r" || e.key === "R") setRot((r) => r + 90)
    else return
    e.preventDefault()
  }

  return (
    <div className="flex h-full flex-col" onKeyDown={onKey} style={fontThai}>
      {/* แถบเครื่องมือ */}
      <div className="flex items-center gap-1 px-3 py-2">
        <span className="mr-auto pl-1 text-[13px] tabular-nums text-white/70">
          {many ? `รูปที่ ${index + 1} / ${images.length}` : "ดูรูปขนาดเต็ม"}
        </span>
        <button type="button" onClick={() => zoomTo(zoom - 0.5)} disabled={zoom <= 1} aria-label="ย่อ" title="ย่อ (-)" className={LB_BTN}><ZoomOut size={18} /></button>
        <button type="button" onClick={() => zoomTo(1)} title="พอดีจอ (0)"
          className="h-9 min-w-14 rounded-full px-2 text-[12.5px] tabular-nums text-white/85 hover:bg-white/15">{Math.round(zoom * 100)}%</button>
        <button type="button" onClick={() => zoomTo(zoom + 0.5)} disabled={zoom >= MAX_ZOOM} aria-label="ขยาย" title="ขยาย (+)" className={LB_BTN}><ZoomIn size={18} /></button>
        <button type="button" onClick={() => setRot((r) => r + 90)} aria-label="หมุน" title="หมุน 90° (R)" className={LB_BTN}><RotateCw size={18} /></button>
        <a href={src} download aria-label="ดาวน์โหลดรูป" title="ดาวน์โหลดรูป" className={LB_BTN}><Download size={18} /></a>
        <DialogPrimitive.Close ref={closeRef} aria-label="ปิด" title="ปิด (Esc)" className={LB_BTN + " ml-1"}><X size={20} /></DialogPrimitive.Close>
      </div>

      {/* พื้นที่รูป — คลิกพื้นหลังเพื่อปิด · ดับเบิลคลิก/ล้อเมาส์ = ซูม · ซูมแล้วลากเลื่อนได้ */}
      <div ref={stageRef}
        className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden px-4 pb-4 sm:px-16"
        onWheel={(e) => zoomTo(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y, moved: false, onBg: e.target === e.currentTarget }
          if (zoom > 1) { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true) }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d || zoom === 1) return
          const dx = e.clientX - d.x, dy = e.clientY - d.y
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
          setOff({ x: d.ox + dx, y: d.oy + dy })
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = null
          setDragging(false)
          if (d && d.onBg && !d.moved) closeRef.current?.click()
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`รูปที่ ${index + 1}`} draggable={false}
          onDoubleClick={() => zoomTo(zoom > 1 ? 1 : 2.5)}
          className="rounded-[6px] bg-white shadow-2xl"
          style={{
            maxWidth: stage.w ? (side ? stage.h : stage.w) : "100%",
            maxHeight: stage.h ? (side ? stage.w : stage.h) : "100%",
            transform: `translate(${off.x}px, ${off.y}px) scale(${zoom}) rotate(${rot}deg)`,
            transition: dragging ? "none" : "transform 160ms ease-out",
            cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in",
          }} />

        {many && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="รูปก่อนหน้า" title="รูปก่อนหน้า (←)"
              className={LB_BTN + " absolute left-3 top-1/2 size-11! -translate-y-1/2 bg-black/40"}><ChevronLeft size={24} /></button>
            <button type="button" onClick={() => go(1)} aria-label="รูปถัดไป" title="รูปถัดไป (→)"
              className={LB_BTN + " absolute right-3 top-1/2 size-11! -translate-y-1/2 bg-black/40"}><ChevronRight size={24} /></button>
          </>
        )}
      </div>

      {many && (
        <div className="flex justify-center gap-2 px-3 pb-3">
          {images.map((s, k) => (
            <button key={k} type="button" onClick={() => onIndex(k)} aria-label={`ดูรูปที่ ${k + 1}`}
              className={`overflow-hidden rounded-[8px] border-2 ${k === index ? "border-white" : "border-transparent opacity-50 hover:opacity-90"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s} alt="" className="size-12 object-cover" />
            </button>
          ))}
        </div>
      )}
      <p className="hidden pb-2 text-center text-[11.5px] text-white/45 sm:block">
        ดับเบิลคลิกหรือเลื่อนล้อเมาส์เพื่อซูม · ลากเพื่อเลื่อนรูป · คลิกพื้นหลังหรือกด Esc เพื่อปิด
      </p>
    </div>
  )
}

// ── Dialog AI อ่านรูปบิล (จำลองผล) ─────────────────────────────────────────

function AiReadDialog({ open, onClose, nextSeq, onSave }: {
  open: boolean
  onClose: () => void
  nextSeq: number
  onSave: (doc: VendorDoc) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {/* mount ตอนเปิดเท่านั้น — เปิดใหม่ทุกครั้ง state เริ่มว่าง */}
        {open && <AiReadBody nextSeq={nextSeq} onSave={onSave} onCancel={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function AiReadBody({ nextSeq, onSave, onCancel }: { nextSeq: number; onSave: (doc: VendorDoc) => void; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [supplier, setSupplier] = useState("")
  const [reading, setReading] = useState(false)
  const [rows, setRows] = useState<ItemDraft[] | null>(null)
  const [zoomAt, setZoomAt] = useState<number | null>(null)
  const keep = useRef<string | null>(null)
  const items = rows ? fromDrafts(rows) : null

  // คืนหน่วยความจำ object URL เมื่อเปลี่ยนรูป/ปิด — ยกเว้นรูปที่บันทึกเข้าตารางแล้ว (ตารางยังใช้อยู่)
  useEffect(() => {
    if (!preview) return
    return () => { if (keep.current !== preview) URL.revokeObjectURL(preview) }
  }, [preview])

  function pick(f: File | null) {
    setFile(f)
    setPreview(f ? URL.createObjectURL(f) : null)
    setRows(null)
  }

  function read() {
    setReading(true); setRows(null)
    // จำลองเวลาที่ AI อ่านรูป — เลือกรายการตามขนาดไฟล์ให้แต่ละรูปได้ผลไม่ซ้ำกัน
    setTimeout(() => {
      const seed = file?.size ?? 7
      const n = 2 + (seed % 3)
      setRows(toDrafts(Array.from({ length: n }, (_, i) => ({
        ...ITEM_CATALOG[(seed + i * 5) % ITEM_CATALOG.length],
        qty: 1 + ((seed >> i) % 4),
      }))))
      setReading(false)
    }, 1200)
  }

  function save() {
    if (!items || !preview) return
    keep.current = preview
    onSave({
      id: `VD-NEW-${String(nextSeq).padStart(3, "0")}`,
      supplier: supplier.trim() || "ไม่ระบุซัพพลายเออร์",
      at: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19) + "+07:00",
      status: "รอตรวจสอบ",
      plate: "", truckNo: "", ddNo: "", inspectedBy: "", poNo: "", pvNo: "",
      items,
      images: [preview],
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2" style={fontHead}>
          <Sparkles size={18} className="text-[#1B8C4B]" /> AI อ่านรูปบิล
        </DialogTitle>
        <DialogDescription style={fontThai}>
          อัปโหลดรูปใบเสร็จ / ใบเสนอราคา แล้วให้ AI แยกเป็นรายการ จำนวน หน่วยละ และจำนวนเงิน
          <span className="mt-1 block text-amber-600 dark:text-amber-400">ตอนนี้เป็นผลจำลอง — ยังไม่เชื่อม AI จริง</span>
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
        {preview ? (
          <div className="flex flex-col gap-1.5">
            <button type="button" onClick={() => setZoomAt(0)} title="กดเพื่อดูรูปขนาดเต็ม"
              className="group relative h-48 cursor-zoom-in overflow-hidden rounded-[12px] border border-[#EEF2F0] bg-[#F6FAF7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B8C4B]/50 dark:border-white/10 dark:bg-white/3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="รูปบิลที่เลือก" className="h-full w-full object-contain" />
              <ZoomBadge />
            </button>
            <label className="inline-flex cursor-pointer items-center justify-center gap-1 rounded-[8px] py-1 text-[12px] font-medium text-[#1B8C4B] hover:bg-[#F0FDF4] dark:text-green-300 dark:hover:bg-white/5" style={fontThai}>
              <Upload size={12} /> เปลี่ยนรูป
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            </label>
            <ImageLightbox images={[preview]} index={zoomAt} onIndex={setZoomAt} onClose={() => setZoomAt(null)} />
          </div>
        ) : (
          <label className="flex h-48 cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[12px] border border-dashed border-[#B9CFC1] bg-[#F6FAF7] text-[12px] text-[#6B7C72] transition-colors hover:border-[#1B8C4B] dark:border-white/15 dark:bg-white/3" style={fontThai}>
            <Upload size={20} /> เลือกรูปบิล<span className="text-[10.5px] text-[#9AA8A0]">JPG / PNG</span>
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          </label>
        )}

        <div className="flex flex-col gap-2">
          <label className="text-[12px] font-medium text-[#6B7C72] dark:text-gray-400" style={fontThai}>
            ซัพพลายเออร์
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="ชื่อซัพพลายเออร์ / ร้าน"
              className={inp + " mt-1 w-full"} style={fontThai} />
          </label>
          <button type="button" disabled={!file || reading} onClick={read}
            className="inline-flex items-center justify-center gap-1.5 rounded-[11px] bg-linear-to-b from-[#22A25B] to-[#1B8C4B] px-3 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={fontThai}>
            {reading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {reading ? "กำลังอ่านรูป..." : rows ? "อ่านใหม่" : "อ่านด้วย AI"}
          </button>
          {!file && <p className="text-[11.5px] text-[#9AA8A0]" style={fontThai}>เลือกรูปก่อน แล้วกดอ่านด้วย AI</p>}
        </div>
      </div>

      {rows && (
        <>
          <div>
            <h3 className="mb-1.5 text-[12px] font-semibold text-[#6B7C72] dark:text-gray-400" style={fontThai}>
              ผลที่ AI อ่านได้ <span className="font-normal text-[#9AA8A0]">· ตรวจและแก้ไขก่อนบันทึก</span>
            </h3>
            <ItemsEditor rows={rows} onChange={setRows} />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!items && (
              <span className="mr-auto text-[12px] text-amber-600 dark:text-amber-400" style={fontThai}>กรอกชื่อรายการ / จำนวน / หน่วยละให้ครบก่อนบันทึก</span>
            )}
            <button type="button" onClick={onCancel}
              className="rounded-[11px] border border-[#EEF2F0] px-3 py-2 text-[13px] text-[#6B7C72] hover:bg-[#F6FAF7] dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5" style={fontThai}>
              ยกเลิก
            </button>
            <button type="button" onClick={save} disabled={!items}
              className="rounded-[11px] bg-[#1B8C4B] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#177A41] disabled:cursor-not-allowed disabled:opacity-40" style={fontThai}>
              บันทึกเข้าตาราง
            </button>
          </div>
        </>
      )}
    </>
  )
}
