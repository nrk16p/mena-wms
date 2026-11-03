"use client"

// หน้า /store-withdraw/core-return "ติดตามซากอะไหล่" — 3 เลนตามทีม (ยานยนต์ · สโตร์ · จัดซื้อ) + ตาราง (ค้น/กรอง/Export) + ปิดแล้ว
// มือถือ 390px: 3 เลนกลายเป็นแท็บด้านบน · ทุกปุ่มเช็กสิทธิ์ซ้ำที่ API
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronRight, Download, Recycle, RefreshCw, Search, X } from "lucide-react"
import { swalToast } from "@/lib/swal"
import { OUTSTANDING, UNCERTAIN_GARAGE_SOURCES, type CoreStatus } from "@/lib/core-return/core"
import { DetailDrawer, FollowUpDialog, RebuiltDialog, ReturnDialog, SoldDialog } from "./dialogs"
import { RoundsPanel } from "./rounds"
import {
  CoreChip, DaysBadge, baht, btnGhost, daysFrom, download, followText, getJson, inputCls, qtyText, thDate, useFetch, useKeyed, usePerms, type Perms, type Row, type Summary,
} from "./shared"

type View = "lanes" | "table" | "closed"
type Filters = { q: string; warehouse: string; garageType: string; garage: string }
type ListRes = { items: Row[]; total: number; page: number; pages: number; summary: Summary | null; warehouses: string[] | null; garages: { garageType: string; garage: string }[] | null }
type Group = { key: Record<string, string>; count: number; pieces: number; amount: number; vehicles: number; mrs: number; oldest: string; days: number | null; plates?: string[]; uncertain?: boolean }
type Act = { kind: "return" | "sold" | "rebuilt" | "follow"; row: Row } | null

const LANES = [
  { key: 0, title: "ยานยนต์ · ยังไม่คืนซาก", short: "ยานยนต์", dot: "bg-amber-500" },
  { key: 1, title: "สโตร์ · คลังซาก", short: "สโตร์", dot: "bg-sky-500" },
  { key: 2, title: "จัดซื้อ · ติดตาม & รอบขาย", short: "จัดซื้อ", dot: "bg-violet-500" },
] as const
const TABLE_STATUSES: CoreStatus[] = ["pending", "sell_waiting", "rebuild", "sold", "rebuilt", "no_core"]
const CLOSED: CoreStatus[] = ["sold", "rebuilt", "no_core"]
const GROUP_BY = [{ k: "vehicle", t: "รถ" }, { k: "mr", t: "MR" }, { k: "garage", t: "อู่" }, { k: "warehouse", t: "คลัง" }] as const

function qs(f: Filters, extra: Record<string, string | undefined> = {}) {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set("q", f.q.trim())
  if (f.warehouse) p.set("warehouse", f.warehouse)
  if (f.garageType) p.set("garageType", f.garageType)
  if (f.garage) p.set("garage", f.garage)
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") p.set(k, v)
  return p.toString()
}
const sumOf = (s: Summary | null, keys: (CoreStatus | "followQueue")[]) => keys.reduce((a, k) => ({ count: a.count + (s?.[k]?.count ?? 0), amount: a.amount + (s?.[k]?.amount ?? 0) }), { count: 0, amount: 0 })

function GarageLine({ row }: { row: Row & { garageType?: string | null; garage?: string | null; garageSource?: string | null } }) {
  if (!row.garage && !row.garageType) return null
  const unsure = !!row.garageSource && UNCERTAIN_GARAGE_SOURCES.includes(row.garageSource)
  return (
    <span className="inline-flex max-w-full items-center gap-1 text-xs text-gray-600 dark:text-gray-300" title={row.garageSource ?? undefined}>
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${row.garageType === "อู่ใน" ? "bg-emerald-50 text-emerald-800" : "bg-indigo-50 text-indigo-800"}`}>{row.garageType || "อู่"}</span>
      <span className="truncate">{row.garage || "-"}</span>
      {unsure && <span className="shrink-0 rounded bg-yellow-100 px-1 text-[10px] text-yellow-800" title={row.garageSource ?? ""}>ไม่แน่ใจ</span>}
    </span>
  )
}

function RowCard({ row, perms, onAct, onOpen }: { row: Row; perms: Perms; onAct: (a: Act) => void; onOpen: (k: string) => void }) {
  const open = OUTSTANDING.includes(row.coreStatus)
  const ft = followText(row.followUp)
  return (
    <li data-row={row.row_key} className="rounded-xl border border-[#E2E8E4] bg-white p-3 dark:border-white/10 dark:bg-[#0f1117]">
      <button type="button" onClick={() => onOpen(row.row_key)} className="block w-full text-left">
        <div className="flex flex-wrap items-center gap-1.5">
          {open ? <DaysBadge days={daysFrom(row.issuedDate)} /> : <CoreChip status={row.coreStatus} />}
          {row.coreStatus === "legacy" && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800" title={row.legacyNote ?? undefined}>ไฟล์เดิม {row.legacyRound ?? ""}</span>}
          {row.saleRoundNo && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">{row.saleRoundNo}</span>}
          {ft && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-800">{ft}</span>}
        </div>
        <p className="mt-1.5 line-clamp-2 text-sm font-medium text-gray-900 dark:text-white">{row.skuName || row.skuCode}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{row.skuCode} · {qtyText(row.qtyIssued)} ชิ้น · {baht(row.amount)} บาท</p>
        <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">{row.plate || "-"}{row.vehicleNo ? ` (${row.vehicleNo})` : ""} · {thDate(row.issuedDate)} · {row.warehouse}</p>
        <p className="text-xs text-gray-500">{row.wdCode || "-"} · {row.mrCode || "-"}</p>
        <GarageLine row={row} />
        {row.coreStatus === "sell_waiting" && row.sale?.scrapInDate && <p className="mt-0.5 text-xs text-sky-700">เข้าคลังซาก {thDate(row.sale.scrapInDate)} · อยู่มา {daysFrom(row.sale.scrapInDate)} วัน</p>}
        {row.coreStatus === "rebuild" && <p className="mt-0.5 text-xs text-violet-700">ส่งซ่อม{row.rebuild?.vendor ? ` ${row.rebuild.vendor}` : ""}{row.rebuild?.sentDate ? ` · ${thDate(row.rebuild.sentDate)}` : ""}</p>}
      </button>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {open && perms.ret && <button type="button" data-act="return" onClick={() => onAct({ kind: "return", row })} className="rounded-lg bg-[#1B8C4B] px-3 py-1.5 text-xs font-medium text-white">คืนซาก</button>}
        {row.coreStatus === "sell_waiting" && perms.store && !row.saleRoundNo && <button type="button" onClick={() => onAct({ kind: "sold", row })} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white">บันทึกขายแล้ว</button>}
        {row.coreStatus === "rebuild" && perms.store && <button type="button" onClick={() => onAct({ kind: "rebuilt", row })} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white">Rebuild เสร็จ</button>}
        {["pending", "legacy", "sell_waiting", "rebuild"].includes(row.coreStatus) && perms.follow && <button type="button" data-act="follow" onClick={() => onAct({ kind: "follow", row })} className="rounded-lg border border-violet-300 px-3 py-1.5 text-xs font-medium text-violet-700">ติดตาม</button>}
      </div>
    </li>
  )
}

/** โหลดรายการทีละหน้า (โหลดเพิ่มต่อท้าย) · เปลี่ยนตัวกรอง = เริ่มหน้า 1 ใหม่ */
function usePaged<T>(url: string, tick: number, pick: (j: { items: T[]; total: number; pages: number }) => { items: T[]; total: number; pages: number } = (j) => j) {
  const key = `${tick}|${url}`
  const [page, setPage] = useKeyed(key, 1)
  const [st, setSt] = useState<{ key: string; pages: T[][]; total: number; pageCount: number; error: string }>({ key: "", pages: [], total: 0, pageCount: 1, error: "" })
  useEffect(() => {
    const ctl = new AbortController()
    getJson<{ items: T[]; total: number; pages: number }>(`${url}${url.includes("?") ? "&" : "?"}page=${page}`, ctl.signal).then((raw) => {
      const j = pick(raw)
      setSt((cur) => ({ key, pages: cur.key === key ? [...cur.pages.slice(0, page - 1), j.items] : [j.items], total: j.total, pageCount: j.pages, error: "" }))
    }).catch((e) => { if (!ctl.signal.aborted) setSt({ key, pages: [], total: 0, pageCount: 1, error: e instanceof Error ? e.message : "โหลดไม่สำเร็จ" }) })
    return () => ctl.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- pick เป็นฟังก์ชันคงที่ของผู้เรียก
  }, [key, url, page])
  const mine = st.key === key
  return { rows: mine && !st.error ? st.pages.flat() : null, total: st.total, more: mine && page < st.pageCount, loadMore: () => setPage((p) => p + 1), error: mine ? st.error : "" }
}

function useRows(query: string, tick: number) {
  return usePaged<Row>(`/api/core-return?${query}&summary=0`, tick)
}

function RowList({ query, tick, perms, onAct, onOpen, empty }: { query: string; tick: number; perms: Perms; onAct: (a: Act) => void; onOpen: (k: string) => void; empty: string }) {
  const { rows, total, more, loadMore, error } = useRows(query, tick)
  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>
  if (!rows) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-white/70 dark:bg-white/5" />)}</div>
  if (!rows.length) return <p className="rounded-xl border border-dashed border-[#E2E8E4] px-3 py-6 text-center text-xs text-gray-400 dark:border-white/10">{empty}</p>
  return (
    <div className="space-y-2">
      <ul className="space-y-2">{rows.map((r) => <RowCard key={r.row_key} row={r} perms={perms} onAct={onAct} onOpen={onOpen} />)}</ul>
      {more && <button type="button" onClick={loadMore} className={`${btnGhost} w-full`}>โหลดเพิ่ม (แสดง {rows.length} จาก {total.toLocaleString()})</button>}
    </div>
  )
}

function GroupKeyText({ by, g }: { by: string; g: Group }) {
  if (by === "vehicle") return <>{g.key.plate || "ไม่มีทะเบียน"}{g.key.vehicleNo ? <span className="text-gray-500"> · {g.key.vehicleNo}</span> : null}</>
  if (by === "mr") return <>{g.key.mrCode || "ไม่มี MR"}{g.plates?.length ? <span className="text-gray-500"> · {g.plates.join(", ")}</span> : null}</>
  if (by === "garage") return <><span className="text-gray-500">{g.key.garageType || "-"} · </span>{g.key.garage || "ไม่ระบุอู่"}{g.uncertain ? <span className="ml-1 rounded bg-yellow-100 px-1 text-[10px] text-yellow-800">ไม่แน่ใจ</span> : null}</>
  return <>{g.key.warehouse || "ไม่ระบุคลัง"}</>
}
const groupFilter = (by: string, g: Group): Record<string, string> =>
  by === "vehicle" ? { plate: g.key.plate ?? "", vehicleNo: g.key.vehicleNo ?? "" } : by === "mr" ? { mr: g.key.mrCode ?? "" } : by === "garage" ? { garage: g.key.garage ?? "", garageType: g.key.garageType ?? "" } : { warehouse: g.key.warehouse ?? "" }

function GroupedOutstanding({ f, tick, perms, onAct, onOpen, defaultBy }: { f: Filters; tick: number; perms: Perms; onAct: (a: Act) => void; onOpen: (k: string) => void; defaultBy: string }) {
  const [by, setBy] = useState(defaultBy)
  const query = qs(f, { by })
  const g = usePaged<Group>(`/api/core-return/groups?${query}`, tick)
  const data = g.rows ? { items: g.rows, total: g.total } : null
  const [openKey, setOpenKey] = useKeyed<string | null>(`${tick}|${query}`, null)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs" role="group" aria-label="จัดกลุ่มตาม">
        <span className="text-gray-500">จัดกลุ่มตาม</span>
        {GROUP_BY.map((g) => (
          <button key={g.k} type="button" aria-pressed={by === g.k} data-groupby={g.k} onClick={() => setBy(g.k)}
            className={`rounded-full px-2.5 py-1 ${by === g.k ? "bg-[#1B8C4B] text-white" : "bg-white text-gray-600 ring-1 ring-[#E2E8E4] dark:bg-white/5 dark:ring-white/10"}`}>{g.t}</button>
        ))}
      </div>
      {!data ? <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-white/70 dark:bg-white/5" />)}</div> : data.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#E2E8E4] px-3 py-6 text-center text-xs text-gray-400 dark:border-white/10">ไม่มีซากค้างคืน</p>
      ) : (
        <ul className="space-y-2" data-testid="groups">
          {data.items.map((grp) => {
            const g = grp
            const k = JSON.stringify(g.key)
            const isOpen = openKey === k
            return (
              <li key={k} className="rounded-xl border border-[#E2E8E4] bg-white dark:border-white/10 dark:bg-[#0f1117]">
                <button type="button" onClick={() => setOpenKey(isOpen ? null : k)} aria-expanded={isOpen} className="flex w-full items-start gap-2 p-3 text-left">
                  {isOpen ? <ChevronDown size={16} className="mt-0.5 shrink-0 text-gray-400" /> : <ChevronRight size={16} className="mt-0.5 shrink-0 text-gray-400" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white"><GroupKeyText by={by} g={g} /></span>
                    <span className="block text-xs text-gray-500">{g.count} รายการ · {qtyText(g.pieces)} ชิ้น · {baht(g.amount)} บาท{by !== "vehicle" ? ` · ${g.vehicles} คัน` : ""}</span>
                  </span>
                  <DaysBadge days={g.days} />
                </button>
                {isOpen && <div className="border-t border-[#EEF2F0] p-2 dark:border-white/5"><RowList query={qs(f, { status: "pending,legacy", ...groupFilter(by, g) })} tick={tick} perms={perms} onAct={onAct} onOpen={onOpen} empty="ไม่มีรายการ" /></div>}
              </li>
            )
          })}
        </ul>
      )}
      {data && g.more && <button type="button" onClick={g.loadMore} className={`${btnGhost} w-full`}>ดูกลุ่มเพิ่ม (แสดง {data.items.length} จาก {data.total})</button>}
    </div>
  )
}

function GarageTable({ f, tick, onPick }: { f: Filters; tick: number; onPick: (g: Group) => void }) {
  const [all, setAll] = useState(false)
  const data = useFetch<{ items: Group[] }>(`/api/core-return/groups?${qs(f, { by: "garage", size: all ? "300" : "8" })}`, tick).data?.items ?? null
  return (
    <section data-testid="garage-table" className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">ยังไม่คืนซาก แยกตามอู่</h3>
      {!data ? <div className="h-24 animate-pulse rounded-xl bg-white/70 dark:bg-white/5" /> : (
        <div className="overflow-x-auto rounded-xl border border-[#E2E8E4] bg-white dark:border-white/10 dark:bg-[#0f1117]">
          <table className="w-full text-xs">
            <thead className="bg-[#F6F8F7] text-left text-gray-500 dark:bg-white/5"><tr><th className="p-2">อู่</th><th className="p-2 text-right">รายการ</th><th className="p-2 text-right">ชิ้น</th><th className="p-2 text-right">บาท</th><th className="p-2 text-right">รถ</th><th className="p-2 text-right">MR</th><th className="p-2 text-right">ค้างสุด</th></tr></thead>
            <tbody>
              {data.map((g) => (
                <tr key={JSON.stringify(g.key)} className="cursor-pointer border-t border-[#EEF2F0] hover:bg-[#1B8C4B]/5 dark:border-white/5" onClick={() => onPick(g)}>
                  <td className="max-w-[160px] p-2"><span className="block truncate text-gray-900 dark:text-white" title={g.key.garage}><span className="text-gray-500">{g.key.garageType} · </span>{g.key.garage || "ไม่ระบุ"}</span>{g.uncertain && <span className="text-[10px] text-yellow-700">ชื่อจาก PO อาจเป็นร้านอะไหล่</span>}</td>
                  <td className="p-2 text-right">{g.count}</td><td className="p-2 text-right">{qtyText(g.pieces)}</td><td className="p-2 text-right">{baht(g.amount)}</td>
                  <td className="p-2 text-right">{g.vehicles}</td><td className="p-2 text-right">{g.mrs}</td><td className={`p-2 text-right ${(g.days ?? 0) > 14 ? "font-semibold text-red-600" : ""}`}>{g.days ?? "-"} วัน</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className="text-xs font-medium text-[#1B8C4B] hover:underline" onClick={() => setAll((a) => !a)}>{all ? "ย่อ" : "ดูทุกอู่"}</button>
    </section>
  )
}

function Lane({ title, dot, count, amount, children, hidden }: { title: string; dot: string; count: number; amount: number; children: React.ReactNode; hidden?: boolean }) {
  return (
    <section className={`min-w-0 rounded-2xl bg-[#F6F8F7] p-3 dark:bg-white/[0.03] ${hidden ? "hidden lg:block" : ""}`} data-lane={title}>
      <h2 className="mb-2 flex flex-wrap items-center gap-2 px-1 text-sm font-semibold text-gray-700 dark:text-gray-200">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />{title}
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10">{count.toLocaleString()} · {baht(amount)} บาท</span>
      </h2>
      {children}
    </section>
  )
}

function StoreLane({ f, tick, perms, onAct, onOpen, summary }: { f: Filters; tick: number; perms: Perms; onAct: (a: Act) => void; onOpen: (k: string) => void; summary: Summary | null }) {
  const [sub, setSub] = useState<"sell_waiting" | "rebuild">("sell_waiting")
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-white p-1 ring-1 ring-[#E2E8E4] dark:bg-white/5 dark:ring-white/10" role="tablist">
        {([["sell_waiting", "S1 รอขาย"], ["rebuild", "Rebuild ส่งซ่อม"]] as const).map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={sub === k} onClick={() => setSub(k)} className={`rounded-lg px-2 py-1.5 text-xs font-medium ${sub === k ? "bg-[#1B8C4B] text-white" : "text-gray-600 dark:text-gray-300"}`}>
            {t} ({(summary?.[k]?.count ?? 0).toLocaleString()})
          </button>
        ))}
      </div>
      <RowList query={qs(f, { status: sub })} tick={tick} perms={perms} onAct={onAct} onOpen={onOpen} empty={sub === "sell_waiting" ? "คลังซากว่าง" : "ไม่มีของส่งซ่อมค้าง"} />
    </div>
  )
}

function TableView({ f, tick, perms, onAct, onOpen, closed, mine }: { f: Filters; tick: number; perms: Perms; onAct: (a: Act) => void; onOpen: (k: string) => void; closed: boolean; mine: boolean }) {
  const [status, setStatus] = useState<CoreStatus[]>(closed ? CLOSED : ["pending", "legacy"])
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [followed, setFollowed] = useState("")
  const [due, setDue] = useState(false)
  const query = qs(f, { status: status.join(","), from, to, followed, due: due ? "1" : "", mine: mine ? "1" : "" })
  const [page, setPage] = useKeyed(`${tick}|${query}`, 1)
  const res = useFetch<ListRes>(`/api/core-return?${query}&summary=0&page=${page}`, tick).data
  const chips = closed ? CLOSED : TABLE_STATUSES
  return (
    <div className="space-y-3" data-testid="table-view">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="สถานะ">
        {chips.map((s) => (
          <button key={s} type="button" aria-pressed={status.includes(s)} onClick={() => setStatus((cur) => cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s])}
            className={`rounded-full px-1 py-0.5 ${status.includes(s) ? "ring-2 ring-[#1B8C4B]" : "opacity-60"}`}><CoreChip status={s} /></button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        <label className="text-xs text-gray-500">เบิกตั้งแต่<input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs text-gray-500">ถึง<input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="text-xs text-gray-500">การตาม
          <select className={inputCls} value={followed} onChange={(e) => setFollowed(e.target.value)}><option value="">ทั้งหมด</option><option value="yes">ตามแล้ว</option><option value="no">ยังไม่เคยตาม</option></select>
        </label>
        <label className="flex items-center gap-2 self-end rounded-xl border border-[#E2E8E4] px-3 py-2.5 text-sm dark:border-white/10"><input type="checkbox" checked={due} onChange={(e) => setDue(e.target.checked)} />ถึงกำหนดตาม</label>
        <button type="button" onClick={() => download(`/api/core-return/export?${query}`)} className={`${btnGhost} col-span-2 self-end py-2.5`} data-testid="export"><Download size={14} />Export Excel</button>
      </div>
      {!res ? <div className="h-40 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5" /> : (
        <>
          <p className="text-xs text-gray-500">{res.total.toLocaleString()} รายการ · หน้า {res.page}/{res.pages} · เรียงจากเบิกเก่าสุด</p>
          <ul className="space-y-2 lg:hidden">{res.items.map((r) => <RowCard key={r.row_key} row={r} perms={perms} onAct={onAct} onOpen={onOpen} />)}</ul>
          <div className="hidden overflow-x-auto rounded-xl border border-[#E2E8E4] bg-white lg:block dark:border-white/10 dark:bg-[#0f1117]">
            <table className="w-full text-sm">
              <thead className="bg-[#F6F8F7] text-left text-xs text-gray-500 dark:bg-white/5">
                <tr><th className="p-2">เบิก</th><th className="p-2">สถานะ</th><th className="p-2">WD / MR</th><th className="p-2">ทะเบียน</th><th className="p-2">สินค้า</th><th className="p-2">อู่</th><th className="p-2 text-right">จำนวน</th><th className="p-2 text-right">บาท</th><th className="p-2">คลัง</th><th className="p-2" /></tr>
              </thead>
              <tbody>
                {res.items.map((r) => {
                  const open = OUTSTANDING.includes(r.coreStatus)
                  return (
                    <tr key={r.row_key} data-row={r.row_key} className="cursor-pointer border-t border-[#EEF2F0] align-top hover:bg-[#1B8C4B]/5 dark:border-white/5" onClick={() => onOpen(r.row_key)}>
                      <td className="p-2 text-xs">{thDate(r.issuedDate)}{open && <div className="mt-1"><DaysBadge days={daysFrom(r.issuedDate)} /></div>}</td>
                      <td className="p-2"><CoreChip status={r.coreStatus} />{r.legacyRound && <div className="mt-1 text-[11px] text-orange-700">{r.legacyRound}</div>}{followText(r.followUp) && <div className="mt-1 text-[11px] text-violet-700">{followText(r.followUp)}</div>}</td>
                      <td className="p-2 text-xs">{r.wdCode}<br /><span className="text-gray-500">{r.mrCode}</span></td>
                      <td className="p-2 text-xs">{r.plate}<br /><span className="text-gray-500">{r.vehicleNo}</span></td>
                      <td className="max-w-[260px] p-2"><span className="line-clamp-2">{r.skuName}</span><span className="text-xs text-gray-500">{r.skuCode}</span></td>
                      <td className="max-w-[180px] p-2"><GarageLine row={r} /></td>
                      <td className="p-2 text-right">{qtyText(r.qtyIssued)}</td>
                      <td className="p-2 text-right">{baht(r.amount)}</td>
                      <td className="p-2 text-xs">{r.warehouse}</td>
                      <td className="p-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-col gap-1">
                          {open && perms.ret && <button type="button" onClick={() => onAct({ kind: "return", row: r })} className="rounded-lg bg-[#1B8C4B] px-2.5 py-1 text-xs text-white">คืนซาก</button>}
                          {r.coreStatus === "sell_waiting" && perms.store && !r.saleRoundNo && <button type="button" onClick={() => onAct({ kind: "sold", row: r })} className="rounded-lg bg-sky-600 px-2.5 py-1 text-xs text-white">ขายแล้ว</button>}
                          {r.coreStatus === "rebuild" && perms.store && <button type="button" onClick={() => onAct({ kind: "rebuilt", row: r })} className="rounded-lg bg-violet-600 px-2.5 py-1 text-xs text-white">Rebuild เสร็จ</button>}
                          {!CLOSED.includes(r.coreStatus) && perms.follow && <button type="button" onClick={() => onAct({ kind: "follow", row: r })} className="rounded-lg border border-violet-300 px-2.5 py-1 text-xs text-violet-700">ติดตาม</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {res.items.length === 0 && <p className="rounded-xl border border-dashed border-[#E2E8E4] px-3 py-8 text-center text-sm text-gray-400">ไม่พบรายการ</p>}
          <div className="flex items-center justify-center gap-2">
            <button type="button" className={btnGhost} disabled={res.page <= 1} onClick={() => setPage((p) => p - 1)}>ก่อนหน้า</button>
            <span className="text-xs text-gray-500">{res.page} / {res.pages}</span>
            <button type="button" className={btnGhost} disabled={res.page >= res.pages} onClick={() => setPage((p) => p + 1)}>ถัดไป</button>
          </div>
        </>
      )}
    </div>
  )
}

/** initial มาจาก query ของหน้า (page.tsx): ?mine=1 → ตารางเฉพาะที่ฉันเบิก · ?view= / ?lane= ใช้ตอนแชร์ลิงก์ */
export function CoreReturnPage({ initial = {} }: { initial?: { mine?: boolean; view?: View; lane?: 0 | 1 | 2 } }) {
  const perms = usePerms()
  const [view, setView] = useState<View>(initial.view ?? (initial.mine ? "table" : "lanes"))
  const [laneSel, setLane] = useState<0 | 1 | 2 | null>(initial.lane ?? null)
  const [f, setF] = useState<Filters>({ q: "", warehouse: "", garageType: "", garage: "" })
  const [qInput, setQInput] = useState("")
  const [mine, setMine] = useState(!!initial.mine)
  const [meta, setMeta] = useState<{ warehouses: string[]; garages: { garageType: string; garage: string }[] }>({ warehouses: [], garages: [] })
  const [summary, setSummary] = useState<Summary | null>(null)
  const [tick, setTick] = useState(0)
  const [act, setAct] = useState<Act>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // มือถือเปิดเลนของทีมตัวเองก่อน: ยานยนต์ → เลน 1 · สโตร์ → เลน 2 · จัดซื้อ → เลน 3
  const lane: 0 | 1 | 2 = laneSel ?? (perms.vehicleTeam ? 0 : perms.store ? 1 : perms.follow ? 2 : 0)

  const sumQuery = qs(f, { meta: "1", mine: mine ? "1" : "" })
  useEffect(() => {
    const ctl = new AbortController()
    getJson<ListRes>(`/api/core-return?${sumQuery}&status=pending&page=1`, ctl.signal).then((j) => {
      setSummary(j.summary)
      setMeta((m) => (m.warehouses.length ? m : { warehouses: j.warehouses ?? [], garages: j.garages ?? [] }))
    }).catch((e) => { if (!ctl.signal.aborted) void swalToast("error", e.message) })
    return () => ctl.abort()
  }, [sumQuery, tick])

  const onSearch = (v: string) => {
    setQInput(v)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => setF((cur) => ({ ...cur, q: v })), 350)
  }
  const refresh = useCallback(() => setTick((t) => t + 1), [])
  const done = useCallback(() => { void swalToast("success", "บันทึกแล้ว"); refresh() }, [refresh])
  const pickGarage = (g: Group) => { setF((cur) => ({ ...cur, garage: g.key.garage ?? "", garageType: g.key.garageType ?? "" })); setView("table") }

  const l1 = sumOf(summary, ["pending", "legacy"])
  const l2 = sumOf(summary, ["sell_waiting", "rebuild"])
  const l3 = sumOf(summary, ["followQueue"])
  const closedSum = sumOf(summary, CLOSED)
  const garageOptions = useMemo(() => meta.garages.filter((g) => !f.garageType || g.garageType === f.garageType), [meta.garages, f.garageType])
  const anyFilter = f.q || f.warehouse || f.garageType || f.garage || mine

  if (perms.ready && !perms.read) return <p className="p-6 text-sm text-gray-600">ยังไม่มีสิทธิ์ดูหน้านี้ ขอสิทธิ์จากผู้ดูแลระบบ</p>

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]"><Recycle size={20} /></div>
          <div>
            <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>ติดตามซากอะไหล่</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">เบิกของใหม่แล้วต้องคืนซาก · S1 ขายซาก หรือ Rebuild ซ่อม</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-white p-1 ring-1 ring-[#E2E8E4] dark:bg-white/5 dark:ring-white/10" role="tablist" aria-label="มุมมอง">
            {([["lanes", "3 เลน"], ["table", "ตาราง"], ["closed", `ปิดแล้ว (${closedSum.count.toLocaleString()})`]] as const).map(([k, t]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} data-view={k} onClick={() => setView(k)} className={`rounded-lg px-3 py-1.5 text-sm ${view === k ? "bg-[#1B8C4B] text-white" : "text-gray-600 dark:text-gray-300"}`}>{t}</button>
            ))}
          </div>
          <button type="button" onClick={refresh} aria-label="โหลดใหม่" className="rounded-xl border border-[#E2E8E4] p-2.5 text-gray-600 hover:text-[#1B8C4B] dark:border-white/10"><RefreshCw size={16} /></button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="search" aria-label="ค้นหา" data-testid="search" value={qInput} onChange={(e) => onSearch(e.target.value)} placeholder="ทะเบียน / เบอร์รถ / WD / MR / รหัสหรือชื่อสินค้า / อู่"
            className={`${inputCls} pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden`} />
          {qInput && <button type="button" aria-label="ล้างคำค้น" onClick={() => onSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gray-400"><X size={16} /></button>}
        </div>
        <select aria-label="คลัง" className={inputCls} value={f.warehouse} onChange={(e) => setF((c) => ({ ...c, warehouse: e.target.value }))}>
          <option value="">ทุกคลัง</option>{meta.warehouses.map((w) => <option key={w}>{w}</option>)}
        </select>
        <select aria-label="อู่ใน/อู่นอก" className={inputCls} value={f.garageType} onChange={(e) => setF((c) => ({ ...c, garageType: e.target.value, garage: "" }))}>
          <option value="">อู่ใน + อู่นอก</option><option>อู่ใน</option><option>อู่นอก</option><option>Mobile/PM</option>
        </select>
        <div className="relative">
          <input list="core-garages" aria-label="อู่" className={inputCls} value={f.garage} placeholder="ทุกอู่ (พิมพ์ค้นชื่ออู่)"
            onChange={(e) => { const v = e.target.value; if (!v || meta.garages.some((g) => g.garage === v)) setF((c) => ({ ...c, garage: v })) }} />
          <datalist id="core-garages">{garageOptions.slice(0, 800).map((g) => <option key={g.garageType + g.garage} value={g.garage}>{g.garageType}</option>)}</datalist>
        </div>
      </div>
      {anyFilter && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {mine && <span className="rounded-full bg-[#1B8C4B]/10 px-2.5 py-1 text-[#1B8C4B]">เฉพาะที่ฉันเบิก (ใบเบิก WMS)</span>}
          {f.garage && <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-800">อู่: {f.garage}</span>}
          <button type="button" className="font-medium text-[#1B8C4B] hover:underline" onClick={() => { setF({ q: "", warehouse: "", garageType: "", garage: "" }); setQInput(""); setMine(false) }}>ล้างตัวกรอง</button>
        </div>
      )}

      {view === "lanes" ? (
        <>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-white p-1 ring-1 ring-[#E2E8E4] lg:hidden dark:bg-white/5 dark:ring-white/10" role="tablist" aria-label="เลน" data-testid="lane-tabs">
            {LANES.map((l, i) => {
              const s = [l1, l2, l3][i]
              return (
                <button key={l.key} type="button" role="tab" aria-selected={lane === l.key} onClick={() => setLane(l.key)} className={`rounded-lg px-1 py-1.5 text-xs leading-tight ${lane === l.key ? "bg-[#1B8C4B] text-white" : "text-gray-600 dark:text-gray-300"}`}>
                  <span className="block font-semibold">{l.short}</span><span className="block opacity-90">{s.count.toLocaleString()} · {baht(s.amount)}</span>
                </button>
              )
            })}
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-3" data-testid="lanes">
            <Lane title={LANES[0].title} dot={LANES[0].dot} count={l1.count} amount={l1.amount} hidden={lane !== 0}>
              <GroupedOutstanding f={f} tick={tick} perms={perms} onAct={setAct} onOpen={setDetail} defaultBy="vehicle" />
            </Lane>
            <Lane title={LANES[1].title} dot={LANES[1].dot} count={l2.count} amount={l2.amount} hidden={lane !== 1}>
              <StoreLane f={f} tick={tick} perms={perms} onAct={setAct} onOpen={setDetail} summary={summary} />
            </Lane>
            <Lane title={LANES[2].title} dot={LANES[2].dot} count={l3.count} amount={l3.amount} hidden={lane !== 2}>
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">ต้องตาม <span className="font-normal text-gray-500">(ค้างเกิน 14 วันยังไม่เคยตาม หรือถึงวันนัดตาม)</span></h3>
                  <RowList query={qs(f, { queue: "followup" })} tick={tick} perms={perms} onAct={setAct} onOpen={setDetail} empty="ไม่มีรายการที่ต้องตาม" />
                </div>
                <GarageTable f={f} tick={tick} onPick={pickGarage} />
                <RoundsPanel warehouses={meta.warehouses} canRound={perms.round} onChanged={refresh} compact />
              </div>
            </Lane>
          </div>
        </>
      ) : (
        <TableView key={view} f={f} tick={tick} perms={perms} onAct={setAct} onOpen={setDetail} closed={view === "closed"} mine={mine} />
      )}

      <ReturnDialog key={"ret:" + (act ? act.kind + act.row.row_key : "")} row={act?.kind === "return" ? act.row : null} onClose={() => setAct(null)} onDone={done} />
      <SoldDialog key={"sold:" + (act ? act.kind + act.row.row_key : "")} row={act?.kind === "sold" ? act.row : null} onClose={() => setAct(null)} onDone={done} />
      <RebuiltDialog key={"rebuilt:" + (act ? act.kind + act.row.row_key : "")} row={act?.kind === "rebuilt" ? act.row : null} onClose={() => setAct(null)} onDone={done} />
      <FollowUpDialog key={"follow:" + (act ? act.kind + act.row.row_key : "")} row={act?.kind === "follow" ? act.row : null} onClose={() => setAct(null)} onDone={done} />
      <DetailDrawer rowKey={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
