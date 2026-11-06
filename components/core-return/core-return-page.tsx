"use client"

// หน้า /store-withdraw/core-return "ติดตามซากอะไหล่" — 3 เลนตามทีม (ยานยนต์ · บัญชี/สโตร์: รับเข้า คลังซาก รอบขาย · จัดซื้อ: รับซากอู่นอก ติดตาม) + ตาราง (ค้น/กรอง/Export) + ปิดแล้ว
// มือถือ 390px: 3 เลนกลายเป็นแท็บด้านบน · ทุกปุ่มเช็กสิทธิ์ซ้ำที่ API · สี/ขนาดทั้งหมดมาจาก tokens.ts
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { ChevronDown, ChevronRight, Download, Paperclip, Recycle, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react"
import { OUTSTANDING, SORTS, SORT_LABEL, UNCERTAIN_GARAGE_SOURCES, parseSort, type CoreStatus, type SortKey } from "@/lib/core-return/core"
import { ACT_LABEL, ACT_VARIANT, BulkFollowDialog, ConfirmDialog, DetailDrawer, FollowUpDialog, PickupDialog, RebuiltDialog, ReceiveDialog, ReturnDialog, SoldDialog, rowActions, type DrawerAct } from "./dialogs"
import { RoundsPanel } from "./rounds"
import {
  CoreChip, DaysBadge, SHORT_LABEL, baht, bahtShort, daysFrom, download, followText, getJson, inputCls, qtyText, thDate, todayYmd, useFetch, useKeyed, usePerms, type Perms, type Row, type Summary,
} from "./shared"
import { CARD, CARD_SM, CHIP, FIELD, GROUND, LANE_BG, LANE_DOT, ROW, SEG, TAG, TIER_TXT, TXT, K } from "./tokens"
import { Button, EmptyState, SkeletonCards, SkeletonRows, ToastHost, toast } from "./ui"

type View = "lanes" | "table" | "closed"
type Filters = { q: string; warehouse: string; garageType: string; garage: string; range: RangeKey; from: string; to: string }
const NO_FILTER: Filters = { q: "", warehouse: "", garageType: "", garage: "", range: "", from: "", to: "" }

/** ช่วงเวลา = วันที่เบิก · ช่วงสำเร็จรูปคิดจากวันนี้ (เวลาไทย) · "กำหนดเอง" ให้เลือกวันเริ่ม/วันสุดท้ายเอง */
type RangeKey = "" | "30" | "90" | "month" | "lastmonth" | "year" | "custom"
const RANGES: [RangeKey, string][] = [["", "ทุกช่วงเวลา"], ["30", "30 วันล่าสุด"], ["90", "90 วันล่าสุด"], ["month", "เดือนนี้"], ["lastmonth", "เดือนที่แล้ว"], ["year", "ปีนี้"], ["custom", "กำหนดเอง…"]]
function rangeDates(k: RangeKey, today = todayYmd()): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number)
  const pad = (n: number) => String(n).padStart(2, "0")
  const back = (days: number) => new Date(Date.parse(today) - days * 86_400_000).toISOString().slice(0, 10)
  if (k === "30") return { from: back(29), to: today }
  if (k === "90") return { from: back(89), to: today }
  if (k === "month") return { from: `${y}-${pad(m)}-01`, to: today }
  if (k === "lastmonth") {
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1
    const last = new Date(Date.UTC(py, pm, 0)).getUTCDate()
    return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(last)}` }
  }
  if (k === "year") return { from: `${y}-01-01`, to: today }
  return { from: "", to: "" }
}
type ListRes = { items: Row[]; total: number; page: number; pages: number; summary: Summary | null; warehouses: string[] | null; garages: { garageType: string; garage: string }[] | null }
type Group = { key: Record<string, string>; count: number; pieces: number; amount: number; vehicles: number; mrs: number; oldest: string; days: number | null; plates?: string[]; uncertain?: boolean }
type Act = { kind: DrawerAct; row: Row } | null
type GroupBy = "vehicle" | "mr" | "garage" | "warehouse" | "oldest" | "mine"

const LANES = [
  { key: 0, title: "ยังไม่คืนซาก", role: "ยานยนต์", short: "ยานยนต์", tone: "vehicle" },
  { key: 1, title: "รับเข้า · คลังซาก · รอบขาย", role: "บัญชี / สโตร์", short: "บัญชี", tone: "store" },
  { key: 2, title: "รับซากอู่นอก & ติดตาม", role: "จัดซื้อ", short: "จัดซื้อ", tone: "procure" },
] as const
const LANE_ACTIVE_TXT = { vehicle: TXT.warn, store: TXT.storeDeep, procure: TXT.procure } as const
const TABLE_STATUSES: CoreStatus[] = ["pending", "await_pickup", "picked_up", "await_receive", "sell_waiting", "rebuild", "sold", "rebuilt", "no_core", "missing"]
const CLOSED: CoreStatus[] = ["sold", "rebuilt", "no_core", "missing"]
const GROUP_BY = [{ k: "vehicle", t: "รถ" }, { k: "mr", t: "MR" }, { k: "garage", t: "อู่" }, { k: "warehouse", t: "คลัง" }] as const
const DAY_MS = 86_400_000

function qs(f: Filters, extra: Record<string, string | undefined> = {}) {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set("q", f.q.trim())
  if (f.warehouse) p.set("warehouse", f.warehouse)
  if (f.garageType) p.set("garageType", f.garageType)
  if (f.garage) p.set("garage", f.garage)
  if (f.from) p.set("from", f.from)
  if (f.to) p.set("to", f.to)
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") p.set(k, v)
  return p.toString()
}
const sumOf = (s: Summary | null, keys: (CoreStatus | "followQueue")[]) => keys.reduce((a, k) => ({ count: a.count + (s?.[k]?.count ?? 0), amount: a.amount + (s?.[k]?.amount ?? 0) }), { count: 0, amount: 0 })
const kShort = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n))

/** ป้ายอู่: อู่ใน/อู่นอก + ชื่อ · ไม่รู้ชื่อ = ป้ายเทาป้ายเดียว · "ไม่แน่ใจ" เฉพาะมีชื่อแต่ที่มาไม่ชัวร์ */
function GarageLine({ row }: { row: Row & { garageType?: string | null; garage?: string | null; garageSource?: string | null } }) {
  // ข้อมูลฐานเก็บ "ไม่ทราบชื่ออู่" เป็นข้อความ (report_unreturned.py) — นับเป็นไม่รู้ชื่อเหมือนค่าว่าง
  if (!row.garage || row.garage === "ไม่ทราบชื่ออู่") return <span className={`inline-block rounded-[5px] px-1.5 py-px text-[11px] font-semibold ${TAG.neutral}`}>{row.garageType || "อู่นอก"} (ไม่ทราบชื่อ)</span>
  const unsure = !!row.garageSource && UNCERTAIN_GARAGE_SOURCES.includes(row.garageSource)
  return (
    <span className={`inline-flex max-w-full items-start gap-1.5 text-[13px] ${K["text-ink"]}`} title={row.garageSource ?? undefined}>
      <span className={`shrink-0 rounded-[5px] px-1.5 py-px text-[11px] font-semibold ${row.garageType === "อู่ใน" ? TAG.inHouse : TAG.outside}`}>{row.garageType || "อู่"}</span>
      <span className="min-w-0 break-words">{row.garage}</span>
      {unsure && <span className={`shrink-0 rounded px-1.5 text-[10.5px] ${TAG.unsure}`}>ไม่แน่ใจ</span>}
    </span>
  )
}

/** ปุ่มหลักปุ่มเดียวต่อแถว (คืนซาก > ขาย/รีบิ้ว > ติดตาม) · ที่เหลือทำในลิ้นชักรายละเอียด */
function PrimaryAction({ row, perms, onAct, block }: { row: Row; perms: Perms; onAct: (a: Act) => void; block?: boolean }) {
  const k = rowActions(row, perms)[0]
  if (!k) return null
  return <Button variant={ACT_VARIANT[k]} size="sm" data-act={k} className={block ? "w-full text-[15px] lg:w-auto lg:text-[13px]" : ""} onClick={(e) => { e.stopPropagation(); onAct({ kind: k, row }) }}>{ACT_LABEL[k]}</Button>
}

type CardVariant = "card" | "vehicle" | "store" | "follow"

function RowCard({ row, perms, onAct, onOpen, variant = "card" }: { row: Row; perms: Perms; onAct: (a: Act) => void; onOpen: (k: string) => void; variant?: CardVariant }) {
  const open = OUTSTANDING.includes(row.coreStatus)
  const ft = followText(row.followUp)
  const days = daysFrom(row.issuedDate)
  const aging = open ? <DaysBadge days={days} /> : <CoreChip status={row.coreStatus} />
  const garage = !row.garage || row.garage === "ไม่ทราบชื่ออู่" ? `${row.garageType || "อู่นอก"} (ไม่ทราบชื่อ)` : `${row.garageType || "อู่"} ${row.garage}`
  const act = <PrimaryAction row={row} perms={perms} onAct={onAct} block />
  const hasAct = rowActions(row, perms).length > 0

  if (variant === "vehicle") {
    return (
      <li data-row={row.row_key} className={`flex flex-col gap-2 border-t ${K["border-cEEF2F0"]} py-3 first:border-t-0`}>
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={() => onOpen(row.row_key)} className={`min-w-0 rounded text-left focus-visible:outline-none focus-visible:ring-2 ${K["focus-visible:ring-primary"]}`}>
            <span className={`block text-[15px] font-semibold ${K["text-ink"]} lg:text-sm`}>{row.skuName || row.skuCode}</span>
            <span className={`block text-[12.5px] lg:text-xs ${TXT.muted}`}>{row.skuCode} · {qtyText(row.qtyIssued)} ชิ้น · {baht(row.amount)} บาท · {garage}</span>
          </button>
          {aging}
        </div>
        {hasAct && <div>{act}</div>}
      </li>
    )
  }
  if (variant === "store") {
    return (
      <li data-row={row.row_key} className={`${CARD_SM} flex flex-col gap-1.5 px-3.5 py-3`}>
        <button type="button" onClick={() => onOpen(row.row_key)} className={`flex flex-col gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 ${K["focus-visible:ring-primary"]}`}>
          <span className="flex items-start justify-between gap-2">
            <span className={`text-sm font-semibold ${K["text-ink"]}`}>{row.skuName || row.skuCode}</span>
            {row.saleRoundNo ? <span className={`shrink-0 rounded-md px-[7px] py-px text-xs font-semibold ${TAG.round}`}>{row.saleRoundNo}</span>
              : row.coreStatus === "sell_waiting" ? <span className={`shrink-0 text-xs ${K["text-c7A8A80"]}`}>ยังไม่เข้ารอบ</span> : null}
          </span>
          <span className={`text-xs ${TXT.muted}`}>{row.skuCode} · {qtyText(row.qtyIssued)} ชิ้น · {baht(row.amount)} บาท · {row.plate || "-"}</span>
          {row.coreStatus === "sell_waiting" && row.sale?.scrapInDate && <span className={`text-[13px] ${TXT.storeDeep}`}>อยู่คลังซาก {daysFrom(row.sale.scrapInDate)} วัน</span>}
          {row.coreStatus === "rebuild" && <span className={`text-[13px] ${K["text-c5B21B6"]}`}>ส่งรีบิ้ว{row.rebuild?.vendor ? ` ${row.rebuild.vendor}` : ""}{row.rebuild?.sentDate ? ` · ${thDate(row.rebuild.sentDate)}` : ""}</span>}
        </button>
        {hasAct && <div>{act}</div>}
      </li>
    )
  }
  if (variant === "follow") {
    return (
      <li data-row={row.row_key} className={`flex flex-col gap-1.5 border-t ${K["border-cEEF2F0"]} py-3 first:border-t-0`}>
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={() => onOpen(row.row_key)} className={`min-w-0 rounded text-left focus-visible:outline-none focus-visible:ring-2 ${K["focus-visible:ring-primary"]}`}>
            <span className={`block text-sm font-semibold ${K["text-ink"]}`}>{row.skuName || row.skuCode}</span>
            <span className={`block text-xs ${TXT.muted}`}>{row.plate || "-"} · {baht(row.amount)} บาท · {ft ?? "ยังไม่เคยตาม"}{row.followUp?.nextDate ? ` · นัด ${thDate(row.followUp.nextDate)}` : ""}</span>
          </button>
          {aging}
        </div>
        {hasAct && <div>{act}</div>}
      </li>
    )
  }
  return (
    <li data-row={row.row_key} className={`${CARD} p-3.5`}>
      <button type="button" onClick={() => onOpen(row.row_key)} className={`block w-full rounded text-left focus-visible:outline-none focus-visible:ring-2 ${K["focus-visible:ring-primary"]}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`text-[15px] font-semibold ${K["text-ink"]}`}>{row.skuName || row.skuCode}</p>
            <p className={`text-[12.5px] ${TXT.muted}`}>{row.skuCode} · {qtyText(row.qtyIssued)} ชิ้น · {baht(row.amount)} บาท</p>
          </div>
          {aging}
        </div>
        <p className={`mt-1.5 text-[13px] font-semibold ${K["text-ink"]}`}>{row.plate || "-"}{row.vehicleNo ? ` · ${row.vehicleNo}` : ""}</p>
        <p className={`text-[12.5px] ${TXT.muted}`}>{row.wdCode || "-"} · {row.mrCode || "-"} · เบิก {thDate(row.issuedDate)} · {row.warehouse}</p>
        <div className="mt-1"><GarageLine row={row} /></div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 empty:hidden">
          {row.coreStatus === "legacy" && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TAG.legacy}`} title={row.legacyNote ?? undefined}>ไฟล์เดิม {row.legacyRound ?? ""}</span>}
          {row.saleRoundNo && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TAG.round}`}>{row.saleRoundNo}</span>}
          {ft && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TAG.follow}`}>{ft}</span>}
          {!!row.attachCount && <span data-testid="photo-chip" className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${TAG.photo}`}><Paperclip size={11} aria-hidden />รูป {row.attachCount}</span>}
        </div>
        {row.coreStatus === "sell_waiting" && row.sale?.scrapInDate && <p className={`mt-1 text-xs ${TXT.storeDeep}`}>เข้าคลังซาก {thDate(row.sale.scrapInDate)} · อยู่มา {daysFrom(row.sale.scrapInDate)} วัน</p>}
        {row.coreStatus === "rebuild" && <p className={`mt-1 text-xs ${K["text-c5B21B6"]}`}>ส่งรีบิ้ว{row.rebuild?.vendor ? ` ${row.rebuild.vendor}` : ""}{row.rebuild?.sentDate ? ` · ${thDate(row.rebuild.sentDate)}` : ""}</p>}
      </button>
      {hasAct && <div className="mt-2.5">{act}</div>}
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

function RowList({ query, tick, perms, onAct, onOpen, empty, variant = "card" }: { query: string; tick: number; perms: Perms; onAct: (a: Act) => void; onOpen: (k: string) => void; empty: string; variant?: CardVariant }) {
  const { rows, total, more, loadMore, error } = useRows(query, tick)
  if (error) return <p role="alert" className={`rounded-xl ${K["bg-cFBE4E2"]} px-3 py-2.5 text-sm font-semibold ${K["text-c9F1D12"]}`}>{error}</p>
  if (!rows) return <SkeletonCards n={3} tall />
  if (!rows.length) return <p className={`rounded-xl border border-dashed ${K["border-cC9D3CD"]} bg-white px-3 py-6 text-center text-[13px] ${K["text-muted"]}`}>{empty}</p>
  const inline = variant === "vehicle" || variant === "follow"
  return (
    <div className="flex flex-col gap-2">
      <ul className={inline ? "m-0 list-none p-0" : "m-0 flex list-none flex-col gap-2 p-0"}>{rows.map((r) => <RowCard key={r.row_key} row={r} perms={perms} onAct={onAct} onOpen={onOpen} variant={variant} />)}</ul>
      {more && <button type="button" onClick={loadMore} className={`min-h-11 self-start text-[13px] font-semibold ${K["text-primary"]} ${K["hover:text-primaryHover"]} hover:underline lg:min-h-9`}>ดูเพิ่ม (แสดง {rows.length} จาก {total.toLocaleString()})</button>}
    </div>
  )
}

function GroupKeyText({ by, g }: { by: string; g: Group }) {
  if (by === "vehicle") return <>{g.key.plate || "ไม่มีทะเบียน"}{g.key.vehicleNo ? ` · ${g.key.vehicleNo}` : ""}</>
  if (by === "mr") return <>{g.key.mrCode || "ไม่มี MR"}{g.plates?.length ? <span className={`font-normal ${TXT.muted}`}> · {g.plates.join(", ")}</span> : null}</>
  if (by === "garage") return <><span className={`font-normal ${TXT.muted}`}>{g.key.garageType || "-"} · </span>{g.key.garage || "ไม่ระบุอู่"}{g.uncertain ? <span className={`ml-1 rounded px-1.5 text-[10.5px] font-normal ${TAG.unsure}`}>ไม่แน่ใจ</span> : null}</>
  return <>{g.key.warehouse || "ไม่ระบุคลัง"}</>
}
const groupFilter = (by: string, g: Group): Record<string, string> =>
  by === "vehicle" ? { plate: g.key.plate ?? "", vehicleNo: g.key.vehicleNo ?? "" } : by === "mr" ? { mr: g.key.mrCode ?? "" } : by === "garage" ? { garage: g.key.garage ?? "", garageType: g.key.garageType ?? "" } : { warehouse: g.key.warehouse ?? "" }

/** ชิปกลุ่ม: pill 32px (จอคอม) · เลือก = ทึบเข้ม */
function PillChip({ on, onClick, children, ...rest }: { on: boolean; onClick: () => void; children: React.ReactNode } & React.HTMLAttributes<HTMLButtonElement>) {
  return <button type="button" aria-pressed={on} onClick={onClick} {...rest} className={`${CHIP.base} ${CHIP.pill} ${on ? CHIP.on : CHIP.off}`}>{children}</button>
}

function GroupedOutstanding({ f, tick, perms, onAct, onOpen, by }: { f: Filters; tick: number; perms: Perms; onAct: (a: Act) => void; onOpen: (k: string) => void; by: GroupBy }) {
  const grouped = by !== "oldest" && by !== "mine"
  const query = qs(f, { by })
  const g = usePaged<Group>(`/api/core-return/groups?${query}`, grouped ? tick : -1)
  const data = g.rows ? { items: g.rows, total: g.total } : null
  const [openKey, setOpenKey] = useKeyed<string | null | undefined>(`${tick}|${query}`, undefined) // undefined = เปิดกลุ่มแรกให้เห็นปุ่มทันที
  if (!grouped) return <RowList query={qs(f, { status: "pending,legacy", mine: by === "mine" ? "1" : "" })} tick={tick} perms={perms} onAct={onAct} onOpen={onOpen} empty="ไม่มีซากค้างคืน" />
  return (
    <div className="flex flex-col gap-2.5">
      {!data ? <SkeletonCards n={3} /> : data.items.length === 0 ? (
        <p className={`rounded-xl border border-dashed ${K["border-cC9D3CD"]} bg-white px-3 py-6 text-center text-[13px] ${K["text-muted"]}`}>ไม่มีซากค้างคืน</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0" data-testid="groups">
          {data.items.map((grp, idx) => {
            const k = JSON.stringify(grp.key)
            const isOpen = openKey === undefined ? idx === 0 : openKey === k
            return (
              <li key={k} className={CARD_SM}>
                <button type="button" onClick={() => setOpenKey(isOpen ? null : k)} aria-expanded={isOpen} className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-[14px] px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 ${K["focus-visible:ring-primary"]}`}>
                  <span className="min-w-0">
                    <span className={`block text-base font-bold ${K["text-ink"]} lg:text-[15px]`}><GroupKeyText by={by} g={grp} /></span>
                    <span className={`block text-[12.5px] lg:text-xs ${TXT.muted}`}>{grp.count} รายการ · {qtyText(grp.pieces)} ชิ้น · {baht(grp.amount)} บาท{by !== "vehicle" ? ` · ${grp.vehicles} คัน` : ""}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5"><DaysBadge days={grp.days} />{isOpen ? <ChevronDown size={16} aria-hidden className={TXT.faint} /> : <ChevronRight size={16} aria-hidden className={TXT.faint} />}</span>
                </button>
                {isOpen && <div className={`border-t ${K["border-cEEF2F0"]} px-3.5 pb-1`}><RowList query={qs(f, { status: "pending,legacy", ...groupFilter(by, grp) })} tick={tick} perms={perms} onAct={onAct} onOpen={onOpen} empty="ไม่มีรายการ" variant="vehicle" /></div>}
              </li>
            )
          })}
        </ul>
      )}
      {data && g.more && <button type="button" onClick={g.loadMore} className={`min-h-11 self-start text-[13px] font-semibold ${K["text-primary"]} ${K["hover:text-primaryHover"]} hover:underline lg:min-h-9`}>ดูกลุ่มเพิ่ม (แสดง {data.items.length} จาก {data.total})</button>}
    </div>
  )
}

function SectionCard({ title, hint, action, children, testid }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode; testid?: string }) {
  return (
    <section data-testid={testid} className={`${CARD_SM} flex flex-col gap-1 px-3.5 py-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className={`m-0 text-sm font-bold ${K["text-ink"]}`}>{title}</h3>{action ?? (hint && <span className={`text-xs ${TXT.muted}`}>{hint}</span>)}</div>
      {children}
    </section>
  )
}

function GarageTable({ f, tick, onPick }: { f: Filters; tick: number; onPick: (g: Group) => void }) {
  const [all, setAll] = useState(false)
  const data = useFetch<{ items: Group[] }>(`/api/core-return/groups?${qs(f, { by: "garage", size: all ? "300" : "8" })}`, tick).data?.items ?? null
  return (
    <SectionCard title="ยังไม่คืนซาก แยกตามอู่" testid="garage-table">
      {!data ? <div className="py-2"><SkeletonRows n={3} /></div> : (
        <table className="w-full border-collapse">
          <caption className="sr-only">ยังไม่คืนซาก แยกตามอู่ — กดชื่ออู่เพื่อดูในตาราง</caption>
          <tbody>
            {data.map((g) => (
              <tr key={JSON.stringify(g.key)} className={`border-t ${K["border-cEEF2F0"]}`}>
                <td className="max-w-[170px] py-1 text-[13px]">
                  <button type="button" onClick={() => onPick(g)} title={g.key.garage} className={`min-h-11 w-full truncate rounded text-left ${K["hover:text-primaryHover"]} hover:underline focus-visible:outline-none focus-visible:ring-2 ${K["focus-visible:ring-primary"]} lg:min-h-9`}>
                    <span className={TXT.muted}>{g.key.garageType} · </span>{g.key.garage || "ไม่ระบุ"}
                  </button>
                  {g.uncertain && <span className={`block text-[10.5px] ${K["text-c7A5B00"]}`}>ชื่อจาก PO อาจเป็นร้านอะไหล่</span>}
                </td>
                <td className="py-2 text-right text-[13px] tabular-nums">{g.count}<span className={`block text-[11px] ${TXT.muted}`}>{baht(g.amount)} บาท</span></td>
                <td className="py-2 pl-2 text-right"><DaysBadge days={g.days} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" className={`min-h-11 self-start text-[13px] font-semibold ${K["text-primary"]} ${K["hover:text-primaryHover"]} hover:underline lg:min-h-9`} onClick={() => setAll((a) => !a)}>{all ? "ย่อ" : "ดูทุกอู่"}</button>
    </SectionCard>
  )
}

function Lane({ tone, title, role, count, amount, children, hidden }: { tone: "vehicle" | "store" | "procure"; title: string; role: string; count: number; amount: number; children: React.ReactNode; hidden?: boolean }) {
  return (
    <section aria-label={`${role} ${title}`} className={`min-w-0 flex-col gap-3 lg:rounded-[18px] lg:p-4 ${LANE_BG[tone]} max-lg:bg-transparent ${hidden ? "hidden lg:flex" : "flex"}`} data-lane={`${title} · ${role}`}>
      <div className="hidden items-center justify-between gap-2 lg:flex">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${LANE_DOT[tone]}`} />
          <h2 className={`m-0 text-lg font-bold ${K["text-ink"]}`}>{title}</h2>
          <span className={`text-[13px] ${TXT.muted}`}>{role}</span>
        </div>
        <span className={`rounded-full border ${K["border-line"]} bg-white px-2.5 py-[3px] text-[13px] font-semibold tabular-nums`}>{count.toLocaleString()} · {bahtShort(amount)}</span>
      </div>
      {children}
    </section>
  )
}

function StoreLane({ f, tick, perms, onAct, onOpen, summary }: { f: Filters; tick: number; perms: Perms; onAct: (a: Act) => void; onOpen: (k: string) => void; summary: Summary | null }) {
  const [sub, setSub] = useState<"await_receive" | "sell_waiting" | "rebuild">("await_receive")
  return (
    <div className="flex flex-col gap-2.5">
      <div className={`${SEG.wrap} w-full`} role="group" aria-label="คลังซาก">
        {([["await_receive", "รอรับเข้า"], ["sell_waiting", "S1 รอขาย"], ["rebuild", "A2 ส่งรีบิ้ว"]] as const).map(([k, t]) => (
          <button key={k} type="button" aria-pressed={sub === k} onClick={() => setSub(k)} className={`${SEG.base} flex-1 text-[13px] ${sub === k ? SEG.onStore : SEG.off}`}>
            {t} {(summary?.[k]?.count ?? 0).toLocaleString()}
          </button>
        ))}
      </div>
      <RowList query={qs(f, { status: sub })} tick={tick} perms={perms} onAct={onAct} onOpen={onOpen} empty={sub === "await_receive" ? "ไม่มีซากรอรับเข้าคลัง" : sub === "sell_waiting" ? "คลังซากว่าง" : "ไม่มีของส่งรีบิ้วค้าง"} variant="store" />
    </div>
  )
}

const EMPTY_SEL: Set<string> = new Set()

function StatusChips({ chips, status, setStatus, sum }: { chips: CoreStatus[]; status: CoreStatus[]; setStatus: (f: (cur: CoreStatus[]) => CoreStatus[]) => void; sum: Summary | null }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="สถานะ" data-testid="status-chips">
      {chips.map((s) => {
        const on = status.includes(s)
        const grp: CoreStatus[] = s === "pending" ? ["pending", "legacy"] : [s]
        const count = sum ? grp.reduce((a, k) => a + (sum[k]?.count ?? 0), 0) : null
        const amount = sum ? grp.reduce((a, k) => a + (sum[k]?.amount ?? 0), 0) : 0
        return (
          <button key={s} type="button" aria-pressed={on} data-status-chip={s}
            onClick={() => setStatus((cur) => on ? cur.filter((x) => !grp.includes(x)) : [...cur.filter((x) => !grp.includes(x)), ...grp])}
            className={`${CHIP.base} ${CHIP.status} ${on ? CHIP.on : CHIP.off}`}>
            {SHORT_LABEL[s]}{count != null && <span className={`rounded-full px-2 py-px text-xs ${on ? CHIP.countOn : CHIP.countOff}`}>{count.toLocaleString()}{s === "pending" || on ? ` · ${bahtShort(amount)}` : ""}</span>}
          </button>
        )
      })}
    </div>
  )
}

const TH = `px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap ${K["text-muted"]} border-b ${K["border-line"]}`
const TD = `px-3 py-3 align-top text-sm border-b ${K["border-cEEF2F0"]}`

function TableView({ f, tick, perms, onAct, onOpen, onRefresh, closed, mine, fields, garageField, chips, garageActive, onClear, exportSlot }: {
  f: Filters; tick: number; perms: Perms; onAct: (a: Act) => void; onOpen: (k: string) => void; onRefresh: () => void; closed: boolean; mine: boolean
  fields: React.ReactNode; garageField: React.ReactNode; chips: React.ReactNode; garageActive: boolean; onClear: () => void; exportSlot: HTMLElement | null
}) {
  const [status, setStatus] = useState<CoreStatus[]>(closed ? CLOSED : ["pending", "legacy"])
  const [followed, setFollowed] = useState("")
  const [due, setDue] = useState(false)
  const [sort, setSort] = useState<SortKey>("oldest")
  const [bulk, setBulk] = useState<string[] | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const other = { followed, due: due ? "1" : "", mine: mine ? "1" : "" }
  const query = qs(f, { status: status.join(","), ...other, sort: sort === "oldest" ? "" : sort })
  const [page, setPage] = useKeyed(`${tick}|${query}`, 1)
  const [sel, setSel] = useKeyed<Set<string>>(`${tick}|${query}|${page}`, EMPTY_SEL) // เลือกได้ในหน้าเดียว · เปลี่ยนหน้า/ตัวกรอง/บันทึกแล้ว = ล้าง
  const res = useFetch<ListRes>(`/api/core-return?${query}&summary=0&page=${page}`, tick).data
  const sum = useFetch<{ summary: Summary }>(`/api/core-return?${qs(f, other)}&only=summary`, tick).data?.summary ?? null
  const statusChips = closed ? CLOSED : TABLE_STATUSES
  const toggle = (k: string) => setSel((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const allOn = !!res && res.items.length > 0 && res.items.every((r) => sel.has(r.row_key))
  const pickedRows = res ? res.items.filter((r) => sel.has(r.row_key)) : []
  const picked = pickedRows.map((r) => r.row_key)
  const pickedAmount = pickedRows.reduce((a, r) => a + (r.amount ?? 0), 0)
  const followable = pickedRows.filter((r) => !CLOSED.includes(r.coreStatus)).map((r) => r.row_key)
  const moreCount = [followed, due, garageActive].filter(Boolean).length
  return (
    <div className="flex flex-col gap-4" data-testid="table-view">
      {exportSlot && createPortal(<Button variant="secondary" size="lg" onClick={() => download(`/api/core-return/export?${query}`)} data-testid="export"><Download size={16} aria-hidden />Export Excel</Button>, exportSlot)}
      <section aria-label="ตัวกรอง" className={`${CARD} flex flex-col gap-3 p-3.5`}>
        <div className="flex flex-wrap items-center gap-2.5">
          {fields}
          <select aria-label="เรียง" className={`${inputCls} !w-auto`} value={sort} data-testid="sort" onChange={(e) => setSort(parseSort(e.target.value))}>{SORTS.map((k) => <option key={k} value={k}>เรียง: {SORT_LABEL[k]}</option>)}</select>
          <Button variant="secondary" size="lg" aria-expanded={moreOpen} aria-controls="core-more-filters" onClick={() => setMoreOpen((o) => !o)}>
            <SlidersHorizontal size={16} aria-hidden />ตัวกรองเพิ่ม{moreCount > 0 && <span className={`rounded-full ${K["bg-cE4F4EA"]} px-[7px] text-xs ${K["text-c156C3A"]}`}>{moreCount}</span>}
          </Button>
        </div>
        {moreOpen && (
          <div id="core-more-filters" role="group" aria-label="ตัวกรองเพิ่ม" className={`grid grid-cols-1 gap-3 rounded-xl ${K["bg-ground"]} p-3 sm:grid-cols-2 lg:grid-cols-3`}>
            <label className="flex flex-col gap-1.5"><span className={FIELD.label}>การตาม</span>
              <select className={inputCls} value={followed} onChange={(e) => setFollowed(e.target.value)}><option value="">ทั้งหมด</option><option value="yes">ตามแล้ว</option><option value="no">ยังไม่เคยตาม</option></select>
            </label>
            <label className="flex flex-col gap-1.5"><span className={FIELD.label}>อู่ (ชื่อ)</span>{garageField}</label>
            <label className={`flex min-h-11 items-center gap-2 text-sm font-semibold ${K["text-c33433A"]} sm:self-end`}><input type="checkbox" className={`h-[18px] w-[18px] ${K["accent-primary"]}`} checked={due} onChange={(e) => setDue(e.target.checked)} />ถึงกำหนดตาม</label>
          </div>
        )}
        <StatusChips chips={statusChips} status={status} setStatus={setStatus} sum={sum} />
        {chips}
      </section>

      <section className={`${CARD} overflow-hidden`} aria-label="รายการซาก">
        {!res ? <SkeletonRows n={8} /> : (
          <>
            <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b ${K["border-line"]} px-4 py-3 text-[13px] ${K["text-muted"]}`}>
              <span>{res.total.toLocaleString()} รายการ · หน้า {res.page.toLocaleString()} จาก {res.pages.toLocaleString()}</span>
              {!closed && <span>ค้าง: <b className={TIER_TXT.ok}>เทา</b> ≤ 14 วัน · <b className={TIER_TXT.warn}>ส้ม</b> 15–60 · <b className={TIER_TXT.late}>แดง</b> &gt; 60</span>}
            </div>
            {res.items.length === 0 ? (
              <div className="p-4"><EmptyState title={f.q.trim() ? `ไม่เจอรายการที่ตรงกับ "${f.q.trim()}"` : "ไม่พบรายการ"} hint="ลองค้นด้วยเบอร์รถหรือเลข WD หรือล้างตัวกรอง" onClear={onClear} /></div>
            ) : (
              <>
                <ul className={`m-0 flex list-none flex-col gap-2 ${K["bg-ground"]} p-3 lg:hidden`}>{res.items.map((r) => <RowCard key={r.row_key} row={r} perms={perms} onAct={onAct} onOpen={onOpen} />)}</ul>
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[1100px] border-collapse">
                    <thead>
                      <tr>
                        <th className={`${TH} w-9`}><input type="checkbox" className={`h-[18px] w-[18px] ${K["accent-primary"]}`} aria-label="เลือกทั้งหน้า" data-testid="select-all" checked={allOn} onChange={() => setSel(allOn ? EMPTY_SEL : new Set(res.items.map((r) => r.row_key)))} /></th>
                        <th className={TH}>ค้าง / เบิก</th><th className={TH}>WD / MR</th><th className={TH}>รถ</th><th className={TH}>สินค้า</th><th className={TH}>อู่</th>
                        <th className={`${TH} text-right`}>จำนวน</th><th className={`${TH} text-right`}>บาท</th><th className={`${TH} text-right`}>ทำต่อ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {res.items.map((r) => {
                        const open = OUTSTANDING.includes(r.coreStatus)
                        const ft = followText(r.followUp)
                        return (
                          <tr key={r.row_key} data-row={r.row_key} tabIndex={0} aria-label={`เปิดรายละเอียด ${r.skuName ?? r.skuCode ?? ""}`}
                            className={`group cursor-pointer transition-colors ${ROW.focus} ${sel.has(r.row_key) ? ROW.selected : ROW.hover}`}
                            onClick={() => onOpen(r.row_key)}
                            onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); onOpen(r.row_key) } }}>
                            <td className={`${TD} w-9`} onClick={(e) => e.stopPropagation()}><input type="checkbox" className={`h-[18px] w-[18px] ${K["accent-primary"]}`} aria-label={`เลือก ${r.wdCode ?? r.skuCode ?? r.row_key}`} data-testid="row-select" checked={sel.has(r.row_key)} onChange={() => toggle(r.row_key)} /></td>
                            <td className={`${TD} whitespace-nowrap`}>{open ? <DaysBadge days={daysFrom(r.issuedDate)} /> : <CoreChip status={r.coreStatus} />}<div className={`mt-1 text-xs ${TXT.muted}`}>เบิก {thDate(r.issuedDate)}</div></td>
                            <td className={`${TD} whitespace-nowrap`}><div className="tabular-nums">{r.wdCode}</div><div className={`text-xs ${TXT.muted}`}>{r.mrCode}</div></td>
                            <td className={`${TD} whitespace-nowrap`}><div className="font-semibold">{r.plate}</div><div className={`text-xs ${TXT.muted}`}>{r.vehicleNo ? `เบอร์ ${r.vehicleNo}` : ""}</div></td>
                            <td className={`${TD} min-w-[220px]`}>
                              <div className="font-semibold">{r.skuName}</div>
                              <div className={`text-xs ${TXT.muted}`}>{r.skuCode}{r.warehouse ? ` · ${r.warehouse}` : ""}</div>
                              {(r.legacyRound || ft || !!r.attachCount) && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {r.legacyRound && <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${TAG.legacy}`}>{r.legacyRound}</span>}
                                  {ft && <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${TAG.follow}`}>{ft}</span>}
                                  {!!r.attachCount && <span data-testid="photo-chip" className={`inline-flex items-center gap-1 rounded-full px-2 py-px text-[11px] font-semibold ${TAG.photo}`}><Paperclip size={10} aria-hidden />รูป {r.attachCount}</span>}
                                </div>
                              )}
                            </td>
                            <td className={`${TD} max-w-[260px]`}><GarageLine row={r} /></td>
                            <td className={`${TD} text-right tabular-nums`}>{qtyText(r.qtyIssued)}</td>
                            <td className={`${TD} text-right font-semibold tabular-nums`}>{baht(r.amount)}</td>
                            <td className={`${TD} text-right whitespace-nowrap`}>
                              <div className="flex items-center justify-end gap-1.5">
                                <PrimaryAction row={r} perms={perms} onAct={onAct} />
                                <Button variant="secondary" size="icon" aria-label={`ดูรายละเอียด ${r.wdCode ?? r.skuCode ?? ""}`} onClick={(e) => { e.stopPropagation(); onOpen(r.row_key) }}>
                                  <ChevronRight size={16} aria-hidden className={`${K["text-muted"]} transition group-hover:translate-x-0.5`} />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className={`flex items-center justify-center gap-3 border-t ${K["border-line"]} px-4 py-3`}>
                  <Button variant="secondary" size="sm" disabled={res.page <= 1} onClick={() => setPage((p) => p - 1)}>ก่อนหน้า</Button>
                  <span className={`text-[13px] tabular-nums ${TXT.muted}`}>{res.page} / {res.pages}</span>
                  <Button variant="secondary" size="sm" disabled={res.page >= res.pages} onClick={() => setPage((p) => p + 1)}>ถัดไป</Button>
                </div>
              </>
            )}
          </>
        )}
      </section>
      {picked.length > 0 && (
        <div role="region" aria-label="ทำกับรายการที่เลือก" data-testid="bulk-bar" className={`sticky bottom-4 z-20 flex max-w-full flex-wrap items-center gap-3 self-center rounded-2xl ${K["bg-ink"]} py-2.5 pl-[18px] pr-3 text-white shadow-[0_10px_30px_rgba(20,39,28,0.25)]`}>
          <span className="text-sm font-semibold">เลือก {picked.length.toLocaleString()} รายการ · {baht(pickedAmount)} บาท</span>
          <span className="flex flex-wrap items-center gap-2">
            {perms.follow && <Button variant="onDark" data-testid="bulk-follow" disabled={!followable.length} onClick={() => setBulk(followable)}>ติดตามที่เลือก{followable.length !== picked.length ? ` (${followable.length})` : ""}</Button>}
            <Button variant="onDarkOutline" data-testid="bulk-export" onClick={() => download(`/api/core-return/export?${new URLSearchParams({ keys: picked.join("\n") }).toString()}`)}>Export ที่เลือก</Button>
            <Button variant="onDarkText" onClick={() => setSel(EMPTY_SEL)}>ยกเลิก</Button>
          </span>
        </div>
      )}
      <BulkFollowDialog key={bulk ? "bf:" + bulk.length + bulk[0] : "bf"} keys={bulk} onClose={() => setBulk(null)} onDone={() => { setSel(EMPTY_SEL); toast("success", "บันทึกการตามแล้ว"); onRefresh() }} />
    </div>
  )
}

function Kpi({ label, count, amount, note, tone, strong }: { label: string; count: number | null; amount: number; note: string; tone: string; strong?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 rounded-2xl bg-white px-[18px] py-4 ${strong ? `border-2 ${K["border-ink"]}` : `border ${K["border-line"]}`}`}>
      <div className={`text-[13px] font-semibold ${TXT.muted}`}>{label}</div>
      <div className="flex items-baseline gap-2">
        {count == null ? <span className={`h-8 w-20 animate-pulse rounded-md ${K["bg-cEEF2F0"]}`} role="status" aria-label="กำลังโหลด" /> : <>
          <span className={`text-[30px] font-bold leading-tight tabular-nums ${tone}`}>{count.toLocaleString()}</span>
          <span className={`text-sm font-semibold ${TXT.body}`}>{bahtShort(amount)} บาท</span></>}
      </div>
      <div className={`text-xs ${TXT.muted}`}>{note}</div>
    </div>
  )
}

const DESKTOP_MQ = "(min-width:1024px)"
const subscribeDesktop = (cb: () => void) => { const m = window.matchMedia(DESKTOP_MQ); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb) }

/** initial มาจาก query ของหน้า (page.tsx): ?mine=1 → ตารางเฉพาะที่ฉันเบิก · ?view= / ?lane= ใช้ตอนแชร์ลิงก์ */
export function CoreReturnPage({ initial = {} }: { initial?: { mine?: boolean; view?: View; lane?: 0 | 1 | 2 } }) {
  const perms = usePerms()
  // จอกว้าง (>=1024) เปิดตาราง · จอเล็กเปิดเลน 3 แท็บ · ?view= ชนะเสมอ · SSR ยังไม่รู้ขนาดจอ → โชว์โครงรอก่อน (ไม่มี hydration mismatch)
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_MQ).matches, () => null)
  const [viewSel, setView] = useState<View | null>(initial.view ?? null)
  const view: View | null = viewSel ?? (desktop === null ? null : desktop ? "table" : "lanes")
  const [laneSel, setLane] = useState<0 | 1 | 2 | null>(initial.lane ?? null)
  const [f, setF] = useState<Filters>(NO_FILTER)
  const [qInput, setQInput] = useState("")
  const [mine, setMine] = useState(!!initial.mine)
  const [meta, setMeta] = useState<{ warehouses: string[]; garages: { garageType: string; garage: string }[] }>({ warehouses: [], garages: [] })
  const [summary, setSummary] = useState<Summary | null>(null)
  const [oldest, setOldest] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const [act, setAct] = useState<Act>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [vehBy, setVehBy] = useState<GroupBy>("vehicle")
  const [tools, setTools] = useState(false) // มือถือ: ค้นหา/ตัวกรอง/สลับมุมมอง ซ่อนไว้หลังปุ่มค้นหา
  const [exportSlot, setExportSlot] = useState<HTMLElement | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // มือถือเปิดเลนของทีมตัวเองก่อน: ยานยนต์ → เลน 1 · สโตร์ → เลน 2 · จัดซื้อ → เลน 3
  const lane: 0 | 1 | 2 = laneSel ?? (perms.vehicleTeam ? 0 : perms.store || perms.accounting ? 1 : perms.follow ? 2 : 0)

  const sumQuery = qs(f, { meta: "1", mine: mine ? "1" : "" })
  useEffect(() => {
    const ctl = new AbortController()
    getJson<ListRes>(`/api/core-return?${sumQuery}&status=pending,legacy&page=1`, ctl.signal).then((j) => {
      setSummary(j.summary)
      setOldest(j.items[0] ? daysFrom(j.items[0].issuedDate) : null) // เรียงเก่าสุดก่อนเป็นค่าเริ่มต้น → แถวแรก = ค้างนานสุด
      setMeta((m) => (m.warehouses.length ? m : { warehouses: j.warehouses ?? [], garages: j.garages ?? [] }))
    }).catch((e) => { if (!ctl.signal.aborted) toast("error", e.message) })
    return () => ctl.abort()
  }, [sumQuery, tick])

  // การ์ด "ค้างเกิน 60 วัน": ใช้การ์ดสรุปเดิม + ตัวกรองวันที่เบิก (to) ไม่มี API ใหม่
  const lateTo = new Date(Date.parse(todayYmd()) - 61 * DAY_MS).toISOString().slice(0, 10)
  const lateSum = useFetch<{ summary: Summary }>(view === "table" ? `/api/core-return?${qs(f, { to: f.to && f.to < lateTo ? f.to : lateTo, mine: mine ? "1" : "" })}&only=summary` : null, tick).data?.summary ?? null
  const mineSum = useFetch<{ summary: Summary }>(perms.read && desktop === false ? "/api/core-return?mine=1&only=summary" : null, tick).data?.summary ?? null

  const onSearch = (v: string) => {
    setQInput(v)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => setF((cur) => ({ ...cur, q: v })), 350)
  }
  const refresh = useCallback(() => setTick((t) => t + 1), [])
  const doneWith = (kind: NonNullable<Act>["kind"]) => (row: Row) => {
    const msg = kind === "return" ? `บันทึกคืนซากแล้ว${row?.coreStatus === "await_pickup" ? " · แจ้งจัดซื้อรับซากจากอู่นอกแล้ว" : row?.coreStatus === "await_receive" ? " · ส่งต่อฝ่ายบัญชีรับเข้าคลังซากแล้ว" : row?.coreStatus === "rebuild" ? " · A2 ส่งรีบิ้ว" : row?.coreStatus === "no_core" ? " · S2 ไม่มีมูลค่า" : row?.coreStatus === "missing" ? " · ไม่มีซากคืน" : ""}`
      : kind === "pickup" ? "บันทึกรับซากกลับแล้ว · รอยานยนต์ยืนยัน"
      : kind === "confirm" ? "ยืนยันแล้ว · ส่งต่อฝ่ายบัญชีรับเข้าคลังซาก"
      : kind === "receive" ? "รับเข้าคลังซากแล้ว · พร้อมเข้ารอบขาย"
      : kind === "sold" ? "บันทึกขายแล้ว" : kind === "rebuilt" ? "บันทึกรีบิ้วเสร็จแล้ว" : "บันทึกการตามแล้ว"
    toast("success", msg); refresh()
  }
  const pickGarage = (g: Group) => { setF((cur) => ({ ...cur, garage: g.key.garage ?? "", garageType: g.key.garageType ?? "" })); setView("table") }
  const clearAll = () => { setF(NO_FILTER); setQInput(""); setMine(false) }

  const l1 = sumOf(summary, ["pending", "legacy"])
  const l2 = sumOf(summary, ["await_receive", "sell_waiting", "rebuild"])
  const l3 = sumOf(summary, ["followQueue", "await_pickup"])
  const lPicked = sumOf(summary, ["picked_up"])
  const lates = sumOf(lateSum, ["pending", "legacy"])
  const closedSum = sumOf(summary, CLOSED)
  const mineOpen = sumOf(mineSum, ["pending", "legacy"])
  const garageOptions = useMemo(() => meta.garages.filter((g) => !f.garageType || g.garageType === f.garageType), [meta.garages, f.garageType])
  const anyFilter = f.q || f.warehouse || f.garageType || f.garage || f.from || f.to || mine

  if (perms.ready && !perms.read) return <p className={`p-6 text-sm ${K["text-c33433A"]}`}>ยังไม่มีสิทธิ์ดูหน้านี้ ขอสิทธิ์จากผู้ดูแลระบบ</p>

  const fields = (
    <>
      <label className={`relative flex h-11 min-w-0 flex-[1_1_320px] items-center gap-2 rounded-xl border ${K["border-line"]} bg-white px-3.5 ${K["focus-within:border-primary"]} focus-within:ring-[3px] ${K["focus-within:ring-cD3EEDC"]}`}>
        <Search size={18} aria-hidden className={`shrink-0 ${TXT.faint}`} />
        <span className="sr-only">ค้นหา</span>
        <input type="search" data-testid="search" value={qInput} onChange={(e) => onSearch(e.target.value)} placeholder="ทะเบียน · เบอร์รถ · WD · MR · รหัสหรือชื่อสินค้า · อู่"
          className={`min-w-0 flex-1 border-0 bg-transparent text-[15px] ${K["text-ink"]} outline-none ${K["placeholder:text-c7A8A80"]} [&::-webkit-search-cancel-button]:hidden`} />
        {qInput && <button type="button" aria-label="ล้างคำค้น" onClick={() => onSearch("")} className={`-mr-2 flex h-9 w-9 items-center justify-center rounded-lg ${K["text-c7A8A80"]} ${K["hover:text-ink"]} focus-visible:outline-none focus-visible:ring-2 ${K["focus-visible:ring-primary"]}`}><X size={16} aria-hidden /></button>}
      </label>
      <select aria-label="คลัง" className={`${inputCls} !w-auto`} value={f.warehouse} onChange={(e) => setF((c) => ({ ...c, warehouse: e.target.value }))}>
        <option value="">ทุกคลัง</option>{meta.warehouses.map((w) => <option key={w}>{w}</option>)}
      </select>
      <select aria-label="อู่ใน/อู่นอก" className={`${inputCls} !w-auto`} value={f.garageType} onChange={(e) => setF((c) => ({ ...c, garageType: e.target.value, garage: "" }))}>
        <option value="">อู่ใน + อู่นอก</option><option>อู่ใน</option><option>อู่นอก</option><option>Mobile/PM</option>
      </select>
      <select aria-label="ช่วงเวลาที่เบิก" data-testid="range" className={`${inputCls} !w-auto`} value={f.range}
        onChange={(e) => { const k = e.target.value as RangeKey; setF((c) => (k === "custom" ? { ...c, range: k, from: c.from, to: c.to || todayYmd() } : { ...c, range: k, ...rangeDates(k) })) }}>
        {RANGES.map(([k, t]) => <option key={k} value={k}>{k === "" ? t : `เบิก: ${t}`}</option>)}
      </select>
      {f.range === "custom" && (
        <span className="flex items-center gap-1.5" role="group" aria-label="กำหนดช่วงวันที่เบิก">
          <input type="date" aria-label="เบิกตั้งแต่" data-testid="range-from" className={`${inputCls} !w-auto`} value={f.from} max={f.to || todayYmd()}
            title={f.from ? thDate(f.from) : undefined} onChange={(e) => { const v = e.target.value; setF((c) => ({ ...c, from: v })) }} />
          <span className={TXT.muted}>ถึง</span>
          <input type="date" aria-label="ถึงวันที่" data-testid="range-to" className={`${inputCls} !w-auto`} value={f.to} min={f.from || undefined} max={todayYmd()}
            title={f.to ? thDate(f.to) : undefined} onChange={(e) => { const v = e.target.value; setF((c) => ({ ...c, to: v })) }} />
        </span>
      )}
    </>
  )
  const garageField = (
    <>
      <input list="core-garages" aria-label="อู่" className={inputCls} value={f.garage} placeholder="ทุกอู่ (พิมพ์ค้นชื่ออู่)"
        onChange={(e) => { const v = e.target.value; if (!v || meta.garages.some((g) => g.garage === v)) setF((c) => ({ ...c, garage: v })) }} />
      <datalist id="core-garages">{garageOptions.slice(0, 800).map((g) => <option key={g.garageType + g.garage} value={g.garage}>{g.garageType}</option>)}</datalist>
    </>
  )
  const chips = anyFilter ? (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {mine && <span className={`rounded-full ${K["bg-cE4F4EA"]} px-2.5 py-1 font-semibold ${K["text-c156C3A"]}`}>เฉพาะที่ฉันเบิก (ใบเบิก WMS)</span>}
      {f.garage && <span className={`rounded-full px-2.5 py-1 font-semibold ${TAG.outside}`}>อู่: {f.garage}</span>}
      {(f.from || f.to) && <span className={`rounded-full ${K["bg-cE4F4EA"]} px-2.5 py-1 font-semibold ${K["text-c156C3A"]}`} data-testid="range-chip">เบิก {f.from ? thDate(f.from) : "…"} – {f.to ? thDate(f.to) : "วันนี้"}</span>}
      <button type="button" className={`min-h-11 text-[13px] font-semibold ${K["text-primary"]} ${K["hover:text-primaryHover"]} hover:underline lg:min-h-8`} onClick={clearAll}>ล้างตัวกรอง</button>
    </div>
  ) : null
  const toolsCls = tools ? "" : "max-lg:hidden"
  const views = [["table", "ตาราง"], ["lanes", "3 เลน"], ["closed", `ปิดแล้ว (${closedSum.count.toLocaleString()})`]] as const

  return (
    <div className={`mx-auto flex min-h-full max-w-[1360px] flex-col gap-4 ${GROUND} p-4 sm:p-6 lg:gap-5`}>
      {/* หัวหน้า: จอคอม = ไอคอน+ชื่อ+สลับมุมมอง+Export · มือถือ = แถบขาว ชื่อ+ปุ่มค้นหา+แท็บเลน */}
      <header className={`-mx-4 -mt-4 flex flex-col gap-3 border-b ${K["border-line"]} bg-white px-4 pb-3 pt-4 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6 lg:mx-0 lg:mt-0 lg:gap-0 lg:border-0 lg:bg-transparent lg:p-0`}>
        <div className="flex flex-wrap items-center justify-between gap-3 lg:gap-4">
          <div className="flex items-center gap-3.5">
            <div className={`hidden h-12 w-12 place-items-center rounded-[14px] ${K["bg-cE4F4EA"]} ${K["text-primary"]} lg:grid`}><Recycle size={24} aria-hidden /></div>
            <div>
              <h1 className={`m-0 text-xl font-bold ${K["text-ink"]} lg:text-[26px]`}>ติดตามซากอะไหล่</h1>
              <p className={`m-0 text-[12.5px] lg:mt-0.5 lg:text-sm ${TXT.muted}`}>
                <span className="lg:hidden">{mineOpen.count > 0 ? `ของฉันยังไม่คืนซาก ${mineOpen.count.toLocaleString()} รายการ · ${baht(mineOpen.amount)} บาท` : "เบิกของใหม่แล้วต้องคืนซาก"}</span>
                <span className="hidden lg:inline">เบิกของใหม่แล้วต้องคืนซาก · S1 ซากมีมูลค่า · S2 ซากไม่มีมูลค่า · A2 ของรีบิ้ว · ไม่มีซากคืน</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className={`${SEG.wrap} hidden lg:flex`} role="group" aria-label="มุมมอง">
              {views.map(([k, t]) => (
                <button key={k} type="button" aria-pressed={view === k} data-view={k} onClick={() => setView(k)} className={`${SEG.base} ${view === k ? SEG.on : SEG.off}`}>{t}</button>
              ))}
            </div>
            <div ref={setExportSlot} className="hidden lg:block" />
            <Button variant="secondary" size="icon" aria-label="โหลดใหม่" onClick={refresh} className="max-lg:hidden"><RefreshCw size={16} aria-hidden /></Button>
            <Button variant="secondary" size="icon" aria-label="ค้นหาและตัวกรอง" aria-expanded={tools} aria-controls="core-tools" onClick={() => setTools((t) => !t)} className="lg:hidden"><Search size={18} aria-hidden /></Button>
          </div>
        </div>
        {view === "lanes" && (
          <div className={`grid grid-cols-3 gap-1 rounded-xl ${K["bg-cEEF2F0"]} p-1 lg:hidden`} role="group" aria-label="เลน" data-testid="lane-tabs">
            {LANES.map((l, i) => {
              const s = [l1, l2, l3][i]
              const on = lane === l.key
              return (
                <button key={l.key} type="button" aria-pressed={on} onClick={() => setLane(l.key)} className={`${SEG.base} px-1 text-[13px] ${on ? `bg-white ${K["text-ink"]} shadow-[0_1px_3px_rgba(20,39,28,0.12)]` : `bg-transparent ${K["text-muted"]}`}`}>
                  {l.short} {on && <span className={LANE_ACTIVE_TXT[l.tone]}>{kShort(s.count)}</span>}
                </button>
              )
            })}
          </div>
        )}
        {view === "lanes" && lane === 0 && (
          <div className="flex gap-1.5 overflow-x-auto lg:hidden" role="group" aria-label="มุมมองยานยนต์">
            <PillChip on={vehBy === "mine"} onClick={() => setVehBy("mine")}>ของฉัน</PillChip>
            <PillChip on={vehBy === "vehicle"} onClick={() => setVehBy("vehicle")}>ตามรถ</PillChip>
            <PillChip on={vehBy === "garage"} onClick={() => setVehBy("garage")}>ตามอู่</PillChip>
            <PillChip on={vehBy === "oldest"} onClick={() => setVehBy("oldest")}>ค้างนานสุด</PillChip>
          </div>
        )}
      </header>

      <div id="core-tools" className={`${toolsCls} flex flex-col gap-3`}>
        <div className={`${SEG.wrap} lg:hidden`} role="group" aria-label="มุมมอง">
          {views.map(([k, t]) => (
            <button key={k} type="button" aria-pressed={view === k} data-view={k} onClick={() => { setView(k); setTools(false) }} className={`${SEG.base} flex-1 px-2 text-[13px] ${view === k ? SEG.on : SEG.off}`}>{t}</button>
          ))}
        </div>
        {view === "lanes" && (
          <section aria-label="ตัวกรอง" className={`${CARD} flex flex-col gap-3 p-3.5`}>
            <div className="flex flex-wrap items-center gap-2.5">{fields}<div className="min-w-[220px] flex-[1_1_220px]">{garageField}</div></div>
            {chips}
          </section>
        )}
      </div>

      {view === "table" && (
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-5" data-testid="kpi-strip">
          <Kpi strong label="ยังไม่คืนซาก" count={summary ? l1.count : null} amount={l1.amount} note={oldest != null ? `ค้างนานสุด ${oldest.toLocaleString()} วัน` : "ยังไม่คืนซาก"} tone={`${K["text-ink"]}`} />
          <Kpi label="ค้างเกิน 60 วัน" count={lateSum ? lates.count : null} amount={lates.amount} note="ต้องตามด่วน" tone={TXT.late} />
          <Kpi label="S1 ระหว่างส่งต่อ" count={summary ? sumOf(summary, ["await_pickup", "picked_up", "await_receive"]).count : null} amount={sumOf(summary, ["await_pickup", "picked_up", "await_receive"]).amount}
            note={summary ? `รอบัญชีรับเข้า ${(summary.await_receive?.count ?? 0).toLocaleString()} · รอรับจากอู่นอก ${(summary.await_pickup?.count ?? 0).toLocaleString()}` : "รอรับเข้าคลังซาก"} tone={TXT.procure} />
          <Kpi label="อยู่คลังซากรอขาย (S1)" count={summary ? (summary.sell_waiting?.count ?? 0) : null} amount={summary?.sell_waiting?.amount ?? 0} note="พร้อมเข้ารอบขาย" tone={TXT.store} />
          <Kpi label="A2 ส่งรีบิ้ว" count={summary ? (summary.rebuild?.count ?? 0) : null} amount={summary?.rebuild?.amount ?? 0} note="รอรีบิ้วเสร็จ" tone={TXT.procure} />
        </div>
      )}

      {view === null ? (
        <div data-testid="view-pending"><SkeletonCards n={3} /></div>
      ) : view === "lanes" ? (
        <div className="grid items-start gap-4 lg:grid-cols-3" data-testid="lanes">
          <Lane tone="vehicle" title={LANES[0].title} role={LANES[0].role} count={l1.count} amount={l1.amount} hidden={lane !== 0}>
            <div className="hidden flex-wrap items-center gap-1.5 lg:flex" role="group" aria-label="จัดกลุ่มตาม">
              <span className={`text-xs ${TXT.muted}`}>จัดกลุ่มตาม</span>
              {GROUP_BY.map((g) => <PillChip key={g.k} on={vehBy === g.k} data-groupby={g.k} onClick={() => setVehBy(g.k)}>{g.t}</PillChip>)}
            </div>
            {lPicked.count > 0 && (
              <SectionCard title={`ซากที่จัดซื้อรับกลับแล้ว รอยืนยัน (${lPicked.count.toLocaleString()})`} hint="ตรวจของแล้วกดยืนยันส่งต่อฝ่ายบัญชี" testid="lane-confirm">
                <RowList query={qs(f, { status: "picked_up" })} tick={tick} perms={perms} onAct={setAct} onOpen={setDetail} empty="ไม่มีรายการรอยืนยัน" variant="vehicle" />
              </SectionCard>
            )}
            <GroupedOutstanding f={f} tick={tick} perms={perms} onAct={setAct} onOpen={setDetail} by={vehBy} />
          </Lane>
          <Lane tone="store" title={LANES[1].title} role={LANES[1].role} count={l2.count} amount={l2.amount} hidden={lane !== 1}>
            <StoreLane f={f} tick={tick} perms={perms} onAct={setAct} onOpen={setDetail} summary={summary} />
            <RoundsPanel warehouses={meta.warehouses} canRound={perms.round} onChanged={refresh} compact />
          </Lane>
          <Lane tone="procure" title={LANES[2].title} role={LANES[2].role} count={l3.count} amount={l3.amount} hidden={lane !== 2}>
            <SectionCard title={`รอรับซากจากอู่นอก (${(summary?.await_pickup?.count ?? 0).toLocaleString()})`} hint="ยานยนต์แจ้งคืนซากแล้ว นัดไปรับและนำกลับคลัง" testid="lane-pickup">
              <RowList query={qs(f, { status: "await_pickup" })} tick={tick} perms={perms} onAct={setAct} onOpen={setDetail} empty="ไม่มีซากรอรับจากอู่นอก" variant="follow" />
            </SectionCard>
            <SectionCard title="ต้องตามวันนี้" hint="ค้าง > 14 วัน ยังไม่เคยตาม / ถึงวันนัด">
              <RowList query={qs(f, { queue: "followup" })} tick={tick} perms={perms} onAct={setAct} onOpen={setDetail} empty="ไม่มีรายการที่ต้องตาม" variant="follow" />
            </SectionCard>
            <GarageTable f={f} tick={tick} onPick={pickGarage} />
          </Lane>
        </div>
      ) : (
        <TableView key={view} f={f} tick={tick} perms={perms} onAct={setAct} onOpen={setDetail} onRefresh={refresh} closed={view === "closed"} mine={mine}
          fields={fields} garageField={garageField} chips={chips} garageActive={!!f.garage} onClear={clearAll} exportSlot={exportSlot} />
      )}

      <ReturnDialog key={"ret:" + (act ? act.kind + act.row.row_key : "")} row={act?.kind === "return" ? act.row : null} onClose={() => setAct(null)} onDone={doneWith("return")} />
      <SoldDialog key={"sold:" + (act ? act.kind + act.row.row_key : "")} row={act?.kind === "sold" ? act.row : null} onClose={() => setAct(null)} onDone={doneWith("sold")} />
      <RebuiltDialog key={"rebuilt:" + (act ? act.kind + act.row.row_key : "")} row={act?.kind === "rebuilt" ? act.row : null} onClose={() => setAct(null)} onDone={doneWith("rebuilt")} />
      <PickupDialog key={"pickup:" + (act ? act.kind + act.row.row_key : "")} row={act?.kind === "pickup" ? act.row : null} onClose={() => setAct(null)} onDone={doneWith("pickup")} />
      <ConfirmDialog key={"confirm:" + (act ? act.kind + act.row.row_key : "")} row={act?.kind === "confirm" ? act.row : null} onClose={() => setAct(null)} onDone={doneWith("confirm")} />
      <ReceiveDialog key={"receive:" + (act ? act.kind + act.row.row_key : "")} row={act?.kind === "receive" ? act.row : null} onClose={() => setAct(null)} onDone={doneWith("receive")} />
      <FollowUpDialog key={"follow:" + (act ? act.kind + act.row.row_key : "")} row={act?.kind === "follow" ? act.row : null} onClose={() => setAct(null)} onDone={doneWith("follow")} />
      <DetailDrawer rowKey={detail} onClose={() => setDetail(null)} onAct={(kind, row) => { setDetail(null); setAct({ kind, row }) }} />
      <ToastHost />
    </div>
  )
}
