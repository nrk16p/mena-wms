"use client"
// /vendors/onboarding — ตารางใบสมัครผู้ส่งมอบรายใหม่ (แนวเดียวกับหน้าผู้สมัครของ hr-service)
// แถบการ์ดสรุปตามสถานะ (กดแล้วกรอง) + ตารางแบบสเปรดชีต หัวคอลัมน์ทุกช่องเรียง/กรองได้ + "งานของฉัน"
// โหลดทีเดียวทั้งชุด กรอง/เรียงฝั่ง client · กดแถว = เปิดรายละเอียด (modal)
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { Loader2, RefreshCw, Search, Settings2, UserCheck, UserPlus, Copy, Check } from "lucide-react"
import { ColHead, Empty, Pager, PAGE_SIZES, buildFacetOptions, dtTdCls, dtTheadCls, passFacets, type HeadCtx, type SortState } from "@/components/datatable-shared"
import { ENTITY_LABEL, STATUS_ORDER, type ActorRole, type OnboardingSummary } from "@/lib/vendor-onboarding/types"
import { errMsg, fmtTaxId, listOnboarding, thDate, type ListResponse } from "@/lib/vendor-onboarding/client"
import { LEGACY_STATUSES, STATUS_TONE, StatusPill, btn, fontHead, fontThai, inputCls, statusLabel } from "./admin-ui"
import { DetailModal } from "./detail-modal"
import { SettingsModal } from "./settings-modal"

type Row = OnboardingSummary
type SortKey = "ref" | "name" | "taxId" | "score" | "docs" | "createdAt" | "vendorCode"
const FACET_KEYS = ["entity", "productType", "contact", "status", "docs", "vendorCode"] as const
type FacetKey = (typeof FACET_KEYS)[number]

const MY_QUEUE: Record<ActorRole, Row["status"][]> = {
  officer: ["submitted", "checking"],
  reviewer: ["pending_review"],
  approver: ["pending_approval"],
}

function docsState(r: Row): string {
  if (!r.docs) return "—"
  if (r.docs.redo) return "มีขอใหม่"
  if (r.docs.requiredPassed >= r.docs.requiredTotal) return "บังคับผ่านครบ"
  if (r.docs.waiting) return "รอตรวจ"
  return "ยังไม่ครบ"
}

const valueOf: Record<FacetKey, (r: Row) => string> = {
  entity: (r) => (r.entityType ? ENTITY_LABEL[r.entityType] : "แบบเก่า"),
  productType: (r) => r.productType?.trim() || "—",
  contact: (r) => r.contactName?.trim() || "—",
  status: (r) => statusLabel(r.status),
  docs: docsState,
  vendorCode: (r) => (r.vendorCode ? "มีรหัสแล้ว" : "ยังไม่มี"),
}

const sortVal: Record<SortKey, (r: Row) => string | number> = {
  ref: (r) => r.ref ?? "",
  name: (r) => r.companyName,
  taxId: (r) => r.taxId,
  score: (r) => (r.score ? r.score.pass : -1),
  docs: (r) => (r.docs ? r.docs.requiredPassed / (r.docs.requiredTotal || 1) : -1),
  createdAt: (r) => r.createdAt,
  vendorCode: (r) => r.vendorCode ?? "",
}

const emptyFacets = (): Record<FacetKey, string[]> => ({ entity: [], productType: [], contact: [], status: [], docs: [], vendorCode: [] })

export function OnboardingAdminPage() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"
  const [data, setData] = useState<ListResponse | null>(null)
  const [loadError, setLoadError] = useState("")
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  const [facets, setFacets] = useState<Record<FacetKey, string[]>>(emptyFacets)
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "createdAt", dir: "desc" })
  const [mine, setMine] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])
  const [openId, setOpenId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await listOnboarding()); setLoadError("") }
    catch (e) { setLoadError(errMsg(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let alive = true
    listOnboarding()
      .then((d) => { if (alive) { setData(d); setLoadError("") } })
      .catch((e) => { if (alive) setLoadError(errMsg(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const rows = useMemo(() => data?.rows ?? [], [data])
  const roles = useMemo(() => data?.roles ?? [], [data])
  const queueStatuses = useMemo(() => new Set(roles.flatMap((r) => MY_QUEUE[r])), [roles])
  const myCount = useMemo(() => rows.filter((r) => queueStatuses.has(r.status)).length, [rows, queueStatuses])

  // ค้นหา + งานของฉัน ตัดก่อน แล้วค่อยนับตัวเลือกของหัวคอลัมน์จากชุดที่เหลือ
  const base = useMemo(() => {
    const t = q.trim().toLowerCase()
    const tDigits = t.replace(/\D/g, "")
    return rows.filter((r) =>
      (!mine || queueStatuses.has(r.status)) &&
      (!t || [r.ref, r.companyName, r.contactName, r.contactPhone, r.productType, r.vendorCode].some((v) => (v ?? "").toLowerCase().includes(t)) ||
        (tDigits.length >= 3 && r.taxId.includes(tDigits))))
  }, [rows, q, mine, queueStatuses])

  const options = useMemo(() => buildFacetOptions(base, FACET_KEYS, facets, valueOf), [base, facets])
  const filtered = useMemo(() => {
    const out = base.filter((r) => passFacets(r, FACET_KEYS, facets, valueOf))
    if (sort) {
      const f = sortVal[sort.key]
      const m = sort.dir === "asc" ? 1 : -1
      out.sort((a, b) => {
        const x = f(a), y = f(b)
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "th")) * m
      })
    }
    return out
  }, [base, facets, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const cur = Math.min(page, pageCount)
  const shown = filtered.slice((cur - 1) * pageSize, cur * pageSize)

  const ctx: HeadCtx<SortKey, FacetKey> = {
    sort,
    onSort: (key, dir) => setSort(dir ? { key, dir } : null),
    facets,
    options,
    onPick: (key, values) => { setFacets((f) => ({ ...f, [key]: values })); setPage(1) },
  }

  const filtering = Boolean(q.trim()) || mine || FACET_KEYS.some((k) => facets[k].length)
  const clearAll = () => { setQ(""); setMine(false); setFacets(emptyFacets()); setPage(1) }

  // การ์ดสรุป — นับจากทุกแถว (ไม่ขึ้นกับตัวกรอง) · กดแล้วกรองคอลัมน์สถานะ
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.status, (m.get(r.status) ?? 0) + 1)
    return m
  }, [rows])
  const legacyCount = LEGACY_STATUSES.reduce((n, s) => n + (counts.get(s) ?? 0), 0)
  const pickStatus = (labels: string[]) => { setFacets({ ...emptyFacets(), status: labels }); setPage(1) }
  const statusPicked = facets.status
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((v) => b.includes(v))

  const canSettings = roles.includes("approver") || isAdmin
  async function copyFormLink() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/form-vendor`); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* เบราว์เซอร์ไม่ให้คัดลอก */ }
  }

  return (
    <div className="w-full" style={fontThai}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]"><UserPlus size={20} aria-hidden /></div>
          <div>
            <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={fontHead}>ผู้ส่งมอบรายใหม่</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">ใบสมัครจากฟอร์ม /form-vendor · ตรวจเอกสาร ให้คะแนน แล้วส่งรีวิวและอนุมัติ</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btn.ghost} onClick={copyFormLink} title="ลิงก์ /form-vendor สำหรับส่งให้ผู้ส่งมอบ">
            {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์ฟอร์ม"}
          </button>
          {canSettings && (
            <button type="button" className={btn.ghost} onClick={() => setSettingsOpen(true)}><Settings2 size={15} aria-hidden /> ตั้งค่า</button>
          )}
          <button type="button" className={btn.ghost} onClick={() => void load()} disabled={loading} aria-label="โหลดใหม่">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} aria-hidden />
          </button>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200">
          <span>{loadError}</span>
          <button type="button" className={btn.ghost} onClick={() => void load()}>ลองใหม่</button>
        </div>
      )}

      {/* การ์ดสรุป */}
      <section aria-label="สรุปใบสมัครตามสถานะ" className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[#E8EEEA] bg-[#E8EEEA] sm:grid-cols-5 xl:grid-cols-10 dark:border-white/8 dark:bg-white/8">
        <KpiCard label="ทั้งหมด" value={rows.length} lead sub={filtering ? "ล้างตัวกรอง" : undefined} onClick={filtering ? clearAll : undefined} />
        {STATUS_ORDER.map((s) => {
          const n = counts.get(s) ?? 0
          return (
            <KpiCard key={s} label={statusLabel(s)} value={n} share={n / (rows.length || 1)} dot={STATUS_TONE[s].dot}
              active={same(statusPicked, [statusLabel(s)])} onClick={() => pickStatus([statusLabel(s)])} />
          )
        })}
        <KpiCard label="แบบเก่า" value={legacyCount} share={legacyCount / (rows.length || 1)} dot="bg-gray-400"
          active={statusPicked.length > 0 && statusPicked.every((l) => LEGACY_STATUSES.some((s) => statusLabel(s) === l))}
          onClick={() => pickStatus(LEGACY_STATUSES.map(statusLabel))} />
      </section>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
          <label htmlFor="vo-search" className="sr-only">ค้นหา</label>
          <input id="vo-search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="ค้นหา เลขที่ / ชื่อ / เลขผู้เสียภาษี / ผู้ติดต่อ / รหัส vendor" className={`${inputCls} pl-9`} />
        </div>
        {roles.length > 0 && (
          <button type="button" aria-pressed={mine} onClick={() => { setMine((m) => !m); setPage(1) }}
            className={mine ? btn.primary : btn.ghost} title="ใบที่บทบาทของคุณต้องทำต่อ">
            <UserCheck size={15} aria-hidden /> งานของฉัน <span className={`rounded-full px-1.5 text-[11px] ${mine ? "bg-white/20" : "bg-[#1B8C4B]/10 text-[#1B8C4B]"}`}>{myCount}</span>
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#EEF2F0] bg-white dark:border-white/8 dark:bg-[#151a10]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-[13px]">
            <thead className={dtTheadCls}>
              <tr>
                <ColHead label="เลขที่" ctx={ctx} sortKey="ref" sortLabels={["เก่า → ใหม่", "ใหม่ → เก่า"]} width="w-[120px]" />
                <ColHead label="ชื่อผู้ส่งมอบ" ctx={ctx} sortKey="name" sortLabels={["ก → ฮ", "ฮ → ก"]} facetKey="entity" />
                <ColHead label="เลขผู้เสียภาษี" ctx={ctx} sortKey="taxId" width="w-[150px]" />
                <ColHead label="ประเภทสินค้า" ctx={ctx} facetKey="productType" />
                <ColHead label="ผู้ติดต่อ" ctx={ctx} facetKey="contact" />
                <ColHead label="คะแนน" ctx={ctx} sortKey="score" align="right" width="w-[90px]" sortLabels={["น้อย → มาก", "มาก → น้อย"]} />
                <ColHead label="เอกสารบังคับ" ctx={ctx} sortKey="docs" facetKey="docs" width="w-[130px]" />
                <ColHead label="สถานะ" ctx={ctx} facetKey="status" width="w-[150px]" />
                <ColHead label="วันที่ส่ง" ctx={ctx} sortKey="createdAt" sortLabels={["เก่า → ใหม่", "ใหม่ → เก่า"]} width="w-[100px]" />
                <ColHead label="รหัส vendor" ctx={ctx} sortKey="vendorCode" facetKey="vendorCode" width="w-[110px]" />
              </tr>
            </thead>
            <tbody>
              {data === null && !loadError && (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-gray-400"><Loader2 className="inline animate-spin" size={16} aria-hidden /> กำลังโหลด…</td></tr>
              )}
              {shown.map((r) => (
                <tr key={r.id} tabIndex={0} onClick={() => setOpenId(r.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(r.id) } }}
                  aria-label={`เปิดใบสมัคร ${r.companyName}`}
                  className="cursor-pointer border-b border-[#F1F5F2] transition-colors hover:bg-[#F6FAF7] focus-visible:bg-[#F0FDF4] focus-visible:outline-none dark:border-white/5 dark:hover:bg-white/[.03] dark:focus-visible:bg-white/5">
                  <td className={`${dtTdCls} whitespace-nowrap font-mono text-[12px] text-[#14271C] dark:text-gray-200`}>{r.ref ?? <span className="text-gray-400">—</span>}</td>
                  <td className={dtTdCls}>
                    <div className="font-medium text-[#14271C] dark:text-white">{r.companyName || "—"}</div>
                    <div className="text-[11.5px] text-gray-500 dark:text-gray-400">{r.entityType ? ENTITY_LABEL[r.entityType] : "แบบเก่า"}</div>
                  </td>
                  <td className={`${dtTdCls} whitespace-nowrap font-mono text-[12px] text-gray-700 dark:text-gray-300`}>{r.taxId ? fmtTaxId(r.taxId) : "—"}</td>
                  <td className={`${dtTdCls} text-gray-700 dark:text-gray-300`}>{r.productType || "—"}</td>
                  <td className={dtTdCls}>
                    <div className="text-[#14271C] dark:text-gray-100">{r.contactName || "—"}</div>
                    {r.contactPhone && <div className="font-mono text-[11.5px] text-gray-500">{r.contactPhone}</div>}
                  </td>
                  <td className={`${dtTdCls} text-right`}><ScoreCell s={r.score} /></td>
                  <td className={dtTdCls}><DocsCell d={r.docs} /></td>
                  <td className={dtTdCls}><StatusPill status={r.status} /></td>
                  <td className={`${dtTdCls} whitespace-nowrap text-gray-700 dark:text-gray-300`}>{thDate(r.createdAt)}</td>
                  <td className={`${dtTdCls} whitespace-nowrap font-mono text-[12px] text-[#14271C] dark:text-gray-200`}>{r.vendorCode || <span className="text-gray-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data !== null && filtered.length === 0 && (
          <Empty hint={rows.length === 0 ? "ยังไม่มีใบสมัคร ส่งลิงก์ฟอร์มให้ผู้ส่งมอบก่อน" : "ไม่มีใบที่ตรงกับตัวกรอง"} onClear={rows.length && filtering ? clearAll : undefined} />
        )}
        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EEF2F0] px-4 py-2.5 text-[12px] text-gray-500 dark:border-white/8">
            <span>
              {filtered.length.toLocaleString("th-TH")} ใบ{filtered.length !== rows.length && ` จาก ${rows.length.toLocaleString("th-TH")}`}
              <label className="ml-3">แสดง{" "}
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} className="rounded-md border border-[#E2E8E4] bg-white px-1.5 py-0.5 dark:border-white/10 dark:bg-[#0f1117]">
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>{" "}แถว
              </label>
            </span>
            <Pager current={cur} count={pageCount} onGo={setPage} />
          </div>
        )}
      </div>

      {openId && (
        <DetailModal id={openId} threshold={data?.settings.passThreshold ?? null} onClose={() => setOpenId(null)} onChanged={() => void load()} />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} onSaved={() => void load()} />}
    </div>
  )
}

function KpiCard({ label, value, sub, dot, share, active, lead, onClick }: {
  label: string; value: number; sub?: string; dot?: string; share?: number; active?: boolean; lead?: boolean; onClick?: () => void
}) {
  const pct = share === undefined ? null : Math.min(100, Math.max(0, share * 100))
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[11.5px] text-gray-500 dark:text-gray-400">
        {dot && <span aria-hidden className={`size-2 flex-none rounded-full ${dot}`} />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className={`font-mono font-semibold tabular-nums text-[#14271C] dark:text-white ${lead ? "text-[22px]" : "text-[18px]"}`}>{value.toLocaleString("th-TH")}</span>
        {sub && <span className="truncate text-[11px] font-medium text-[#1B8C4B] dark:text-green-400">↺ {sub}</span>}
      </span>
      {active && <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-[#1B8C4B]" />}
      {pct !== null && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 block h-[3px] bg-gray-100 dark:bg-white/5">
          <span className={`block h-full rounded-r-full transition-[width] duration-700 ${dot ?? "bg-[#1B8C4B]"}`} style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }} />
        </span>
      )}
    </>
  )
  const cls = `relative flex min-w-0 flex-col gap-1 px-3.5 py-2.5 text-left ${active ? "bg-[#F0FDF4] dark:bg-green-500/10" : "bg-white dark:bg-[#151a10]"} ${lead ? "col-span-2 sm:col-span-5 xl:col-span-1" : ""}`
  if (!onClick) return <div className={cls}>{body}</div>
  return (
    <button type="button" onClick={onClick} aria-pressed={lead ? undefined : Boolean(active)}
      title={lead ? "ล้างตัวกรองทั้งหมด" : `ดูเฉพาะ${label}`}
      className={`${cls} cursor-pointer transition-colors hover:bg-[#F6FAF7] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1B8C4B]/50 dark:hover:bg-white/5`}>
      {body}
    </button>
  )
}

function ScoreCell({ s }: { s: Row["score"] }) {
  if (!s) return <span className="text-gray-400">—</span>
  const total = s.pass + s.fail + s.blank
  if (s.pass === 0 && s.fail === 0) return <span className="text-gray-400" title="ยังไม่ได้ให้คะแนน">—</span>
  const cls = s.pass >= s.threshold
    ? "text-emerald-700 dark:text-emerald-300"
    : s.pass + s.blank < s.threshold ? "text-red-600 dark:text-red-300" : "text-amber-700 dark:text-amber-300"
  return (
    <span className="inline-flex flex-col items-end leading-tight" title={`ผ่าน ${s.pass} · ไม่ผ่าน ${s.fail} · ยังไม่ให้ ${s.blank} · เกณฑ์ ${s.threshold}`}>
      <span className={`font-mono font-semibold tabular-nums ${cls}`}>{s.pass}/{total}</span>
      {s.blank > 0 && <span className="text-[10.5px] text-gray-400">เหลือ {s.blank} ข้อ</span>}
    </span>
  )
}

function DocsCell({ d }: { d: Row["docs"] }) {
  if (!d) return <span className="text-gray-400">—</span>
  const full = d.requiredPassed >= d.requiredTotal
  return (
    <span className="flex flex-col leading-tight">
      <span className={`font-mono font-semibold tabular-nums ${full ? "text-emerald-700 dark:text-emerald-300" : "text-[#14271C] dark:text-gray-100"}`}>{d.requiredPassed}/{d.requiredTotal}</span>
      {(d.waiting > 0 || d.redo > 0) && (
        <span className="text-[10.5px]">
          {d.waiting > 0 && <span className="text-amber-700 dark:text-amber-300">รอตรวจ {d.waiting}</span>}
          {d.waiting > 0 && d.redo > 0 && <span className="text-gray-400"> · </span>}
          {d.redo > 0 && <span className="text-red-600 dark:text-red-300">ขอใหม่ {d.redo}</span>}
        </span>
      )}
    </span>
  )
}
