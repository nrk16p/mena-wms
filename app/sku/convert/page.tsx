"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import {
  AlertTriangle, ChevronLeft, ChevronRight, CircleCheck, Layers, ListChecks, Loader2, PackageOpen, PencilLine, Scissors, Search, X,
} from "lucide-react"
import { Mascot } from "@/components/sku-convert/mascot-v2"
import { Chip, Skeleton, StatusChip, fmtMoney, fmtQty } from "@/components/sku-convert/ui"
import { isLockLive } from "@/lib/sku-convert-core"
import type { ConvertListResponse, ConvertListRow, Kind, RowStatus, Wh } from "@/lib/sku-convert-types"
import { cn } from "@/lib/utils"

const LIST_KEY = "skuConvert:list"
const WHS: { v: Wh; label: string }[] = [{ v: "LK", label: "ลาดกระบัง" }, { v: "SR", label: "สระบุรี + DIST" }]
const KINDS: { v: Kind; label: string }[] = [{ v: "parts", label: "อะไหล่" }, { v: "svc", label: "ค่าแรง / บริการ" }]
const STATUSES: { v: "" | RowStatus; label: string }[] = [
  { v: "", label: "ทั้งหมด" }, { v: "todo", label: "ยังไม่ทำ" }, { v: "draft", label: "ร่าง" }, { v: "done", label: "ครบ" },
]

export default function ConvertListPage() {
  return (
    <Suspense fallback={<div className="p-8"><Skeleton className="h-40 w-full" /></div>}>
      <ListInner />
    </Suspense>
  )
}

function ListInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const { data: session } = useSession()
  const meEmail = session?.user?.email ?? ""

  const wh: Wh = sp.get("wh") === "SR" ? "SR" : "LK"
  const kind: Kind = sp.get("kind") === "svc" ? "svc" : "parts"
  const q = sp.get("q") ?? ""
  const group = sp.get("group") ?? ""
  const statusRaw = sp.get("status")
  const status: "" | RowStatus = statusRaw === "todo" || statusRaw === "draft" || statusRaw === "done" ? statusRaw : ""
  const hint = sp.get("hint") === "1"
  const stock = sp.get("stock") === "1"
  const page = Math.max(1, Number(sp.get("page")) || 1)

  // The URL query is the single source of truth; remember it so "กลับรายการ" on the work page restores it.
  const qs = sp.toString()
  useEffect(() => {
    try { sessionStorage.setItem(LIST_KEY, qs) } catch { /* private mode */ }
  }, [qs])

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k)
      else next.set(k, v)
    }
    if (!("page" in patch)) next.delete("page")
    // switching tab: filters that belong to the old tab no longer apply
    if ("wh" in patch || "kind" in patch) { next.delete("group"); next.delete("hint"); next.delete("stock") }
    const s = next.toString()
    router.replace(s ? `/sku/convert?${s}` : "/sku/convert", { scroll: false })
  }, [router, sp])

  // search box: local text, pushed to the URL after 300 ms
  const [qInput, setQInput] = useState(q)
  useEffect(() => {
    if (qInput === q) return
    const t = setTimeout(() => setParams({ q: qInput.trim() || null }), 300)
    return () => clearTimeout(t)
  }, [qInput, q, setParams])

  const [data, setData] = useState<ConvertListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [now, setNow] = useState(() => Date.now())
  const [reload, setReload] = useState(0)

  const apiQuery = useMemo(() => {
    const p = new URLSearchParams({ wh, kind, page: String(page) })
    if (q) p.set("q", q)
    if (group) p.set("group", group)
    if (status) p.set("status", status)
    if (hint) p.set("hint", "1")
    if (stock) p.set("stock", "1")
    return p.toString()
  }, [wh, kind, q, group, status, hint, stock, page])

  useEffect(() => {
    const ac = new AbortController()
    queueMicrotask(() => { setLoading(true); setError("") })
    fetch(`/api/sku-convert?${apiQuery}`, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `โหลดไม่สำเร็จ (${r.status})`)
        return r.json() as Promise<ConvertListResponse>
      })
      .then((d) => { setData(d); setNow(Date.now()); setLoading(false) })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return
        setError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ")
        setLoading(false)
      })
    return () => ac.abort()
  }, [apiQuery, reload])

  const counts = data?.counts
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1
  const filtered = !!(q || group || status || hint || stock)

  const cards = [
    { key: "all", label: "ทั้งหมด", value: counts?.all, icon: Layers, tile: "v2-tile-ink", active: !status && !hint, on: () => setParams({ status: null, hint: null }) },
    { key: "done", label: "✓ ครบ", value: counts?.done, icon: CircleCheck, tile: "v2-tile-mint", active: status === "done", on: () => setParams({ status: "done", hint: null }) },
    { key: "draft", label: "กำลังทำ (ร่าง)", value: counts?.draft, icon: PencilLine, tile: "v2-tile-blue", active: status === "draft", on: () => setParams({ status: "draft", hint: null }) },
    { key: "todo", label: "ยังไม่ทำ", value: counts?.todo, icon: ListChecks, tile: "v2-tile-ink", active: status === "todo", on: () => setParams({ status: "todo", hint: null }) },
    { key: "hint", label: "ควรแยก", value: counts?.hint, icon: Scissors, tile: "v2-tile-sun", active: hint, on: () => setParams({ hint: hint ? null : "1", status: null }) },
  ]
  const pct = counts && counts.all ? Math.round((counts.done / counts.all) * 1000) / 10 : 0

  return (
    <>
      <header className="v2-shell relative overflow-hidden rounded-b-[40px] px-4 pb-20 pt-6 text-white sm:px-8 sm:pt-8">
        <div aria-hidden className="v2-orb -right-32 -top-40 h-80 w-80" />
        <div className="relative mx-auto flex max-w-[1400px] items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-white/85">จัดการ SKU</p>
            <h1 className="text-2xl font-bold sm:text-4xl">แปลงรหัส ATMS → <span className="text-[#86f3c6]">SKU ใหม่</span></h1>
            <p className="mt-2 max-w-[48ch] text-sm text-white/90">ตัดยอด ATMS 30 ก.ย. 2569 · เคลื่อนไหว เม.ย.–ก.ย. 69</p>
            {counts && (
              <div className="mt-4 max-w-md" role="group" aria-label={`ทำเสร็จแล้ว ${pct}%`}>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/25">
                  <div className="h-full rounded-full bg-[#5be3a8] transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-white/90">ครบแล้ว {fmtQty(counts.done)} / {fmtQty(counts.all)} รหัส ({pct}%)</p>
              </div>
            )}
          </div>
          <Mascot size={96} className="hidden sm:inline-flex" bubble="เลือกรหัสแล้วเริ่มได้เลย!" />
          <Mascot size={64} className="sm:hidden" />
        </div>
      </header>

      <main className="relative z-10 mx-auto -mt-12 max-w-[1400px] space-y-5 px-4 pb-24 sm:px-8">
        {/* progress cards */}
        <section aria-label="ความคืบหน้า" className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {cards.map((c) => (
            <button
              key={c.key} type="button" onClick={c.on} aria-pressed={c.active}
              className={cn(
                "v2-card flex items-center gap-3 rounded-[22px] p-3 text-left transition hover:-translate-y-0.5 hover:shadow-[var(--v2-shadow-lift)] sm:p-4",
                c.active && "ring-2 ring-[#3da5ff]",
              )}
            >
              <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", c.tile)}><c.icon className="h-5 w-5" /></span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-[#33476b]">{c.label}</span>
                {c.value == null ? <Skeleton className="mt-1 h-6 w-14" /> : <span className="block text-xl font-bold tabular-nums text-[#0f2748]">{fmtQty(c.value)}</span>}
              </span>
            </button>
          ))}
        </section>

        <section className="v2-glass rounded-[28px] p-4 sm:p-6">
          {/* tabs */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div role="tablist" aria-label="คลัง" className="flex flex-wrap gap-2">
              {WHS.map((t) => (
                <button key={t.v} role="tab" aria-selected={wh === t.v} type="button" className="v2-btn-soft" onClick={() => setParams({ wh: t.v === "LK" ? null : t.v })}>{t.label}</button>
              ))}
            </div>
            <div role="tablist" aria-label="ประเภทรายการ" className="flex flex-wrap gap-2">
              {KINDS.map((t) => (
                <button key={t.v} role="tab" aria-selected={kind === t.v} type="button" className="v2-btn-soft" onClick={() => setParams({ kind: t.v === "parts" ? null : t.v })}>{t.label}</button>
              ))}
            </div>
          </div>

          {/* filters */}
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
            <div className="relative">
              <label htmlFor="cv-q" className="sr-only">ค้นหารหัสหรือชื่อ</label>
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5b6f8f]" />
              <input id="cv-q" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="ค้นหารหัส / ชื่อสินค้า" className="v2-input !pl-9 !pr-9" />
              {qInput && (
                <button type="button" aria-label="ล้างคำค้น" onClick={() => { setQInput(""); setParams({ q: null }) }} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full hover:bg-[#e8f3ff]">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div>
              <label htmlFor="cv-group" className="sr-only">กลุ่มสินค้า</label>
              <select id="cv-group" value={group} onChange={(e) => setParams({ group: e.target.value || null })} className="v2-input">
                <option value="">ทุกกลุ่มสินค้า</option>
                {group && !data?.groups.includes(group) && <option value={group}>{group}</option>}
                {data?.groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:col-span-2 xl:col-span-1">
              {STATUSES.map((s) => (
                <button key={s.v || "all"} type="button" aria-pressed={status === s.v} className="v2-btn-soft" onClick={() => setParams({ status: s.v || null })}>{s.label}</button>
              ))}
              <button type="button" aria-pressed={hint} className="v2-btn-soft" onClick={() => setParams({ hint: hint ? null : "1" })}><Scissors className="h-3.5 w-3.5" />ควรแยก</button>
              {kind === "parts" && (
                <button type="button" aria-pressed={stock} className="v2-btn-soft" onClick={() => setParams({ stock: stock ? null : "1" })}><PackageOpen className="h-3.5 w-3.5" />มีของคงเหลือ</button>
              )}
            </div>
          </div>

          {/* table */}
          <div className="relative mt-4 overflow-hidden rounded-2xl border border-[#e3effd] bg-white">
            {loading && data && <Loader2 aria-label="กำลังโหลด" className="absolute right-3 top-3 z-10 h-4 w-4 animate-spin text-[#1c6ef2]" />}
            <div className="overflow-x-auto" aria-busy={loading}>
              <table className="v2-table min-w-[56rem]">
                <caption className="sr-only">รายการรหัส ATMS ที่ต้องแปลงเป็น SKU ใหม่</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-14 !text-right">ลำดับ</th>
                    <th scope="col">รหัส</th>
                    <th scope="col">ชื่อ</th>
                    <th scope="col">กลุ่ม</th>
                    <th scope="col" className="!text-right">ครั้งเคลื่อนไหว</th>
                    <th scope="col" className="!text-right">{kind === "parts" ? "คงเหลือ" : "จำนวนใช้"}</th>
                    <th scope="col" className="!text-right">{kind === "parts" ? "มูลค่า" : "มูลค่าใช้"}</th>
                    <th scope="col">ควรแยก</th>
                    <th scope="col">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {!data && loading && Array.from({ length: 8 }, (_, i) => (
                    <tr key={i}>{Array.from({ length: 9 }, (_, j) => <td key={j}><Skeleton className="h-5 w-full" /></td>)}</tr>
                  ))}
                  {data?.rows.map((r, i) => (
                    <Row key={r._id} row={r} index={(data.page - 1) * data.limit + i + 1} kind={kind} meEmail={meEmail} now={now} />
                  ))}
                </tbody>
              </table>
            </div>

            {error && (
              <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                <AlertTriangle className="h-8 w-8 text-[#ff8a3d]" />
                <p className="text-sm text-[#33476b]">{error}</p>
                <button type="button" className="v2-btn" onClick={() => setReload((n) => n + 1)}>ลองใหม่</button>
              </div>
            )}
            {!error && data && !data.rows.length && !loading && (
              <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                <Mascot size={72} motion="none" />
                <p className="text-sm text-[#33476b]">{filtered ? "ไม่พบรายการตามตัวกรองนี้" : "ยังไม่มีรายการในแท็บนี้"}</p>
                {filtered && (
                  <button type="button" className="v2-btn-soft" onClick={() => { setQInput(""); router.replace(`/sku/convert?wh=${wh}&kind=${kind}`, { scroll: false }) }}>ล้างตัวกรอง</button>
                )}
              </div>
            )}
          </div>

          {/* pagination */}
          {data && data.total > 0 && (
            <nav aria-label="เปลี่ยนหน้า" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-[#33476b]">
              <span>
                แสดง {fmtQty((data.page - 1) * data.limit + 1)}–{fmtQty(Math.min(data.page * data.limit, data.total))} จาก {fmtQty(data.total)} รายการ
              </span>
              <span className="flex items-center gap-2">
                <button type="button" className="v2-btn-soft" disabled={page <= 1 || loading} onClick={() => setParams({ page: String(page - 1) })}><ChevronLeft className="h-4 w-4" />ก่อนหน้า</button>
                <span className="tabular-nums">หน้า {fmtQty(page)} / {fmtQty(pages)}</span>
                <button type="button" className="v2-btn-soft" disabled={page >= pages || loading} onClick={() => setParams({ page: String(page + 1) })}>ถัดไป<ChevronRight className="h-4 w-4" /></button>
              </span>
            </nav>
          )}
        </section>
      </main>
    </>
  )
}

function Row({ row, index, kind, meEmail, now }: { row: ConvertListRow; index: number; kind: Kind; meEmail: string; now: number }) {
  const router = useRouter()
  const href = `/sku/convert/edit?id=${encodeURIComponent(row._id)}`
  const lockedBy = isLockLive(row.lock, now) && row.lock && row.lock.email !== meEmail ? row.lock.name || row.lock.email : null
  const qty = kind === "parts" ? row.atmsQty : row.use?.qty
  const val = kind === "parts" ? row.atmsValue : row.use?.amt
  return (
    <tr
      className="v2-row"
      onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) router.push(href) }}
    >
      <td className="num text-[#5b6f8f]">{fmtQty(index)}</td>
      <td className="whitespace-nowrap font-mono text-xs font-semibold">
        <Link href={href} className="text-[#1556c9] hover:underline">{row.code}</Link>
      </td>
      <td className="max-w-[22rem] min-w-[12rem]"><span className="line-clamp-2">{row.name}</span></td>
      <td className="max-w-[12rem]"><span className="line-clamp-1 text-[#33476b]">{row.group || "-"}</span></td>
      <td className="num">{fmtQty(row.moves)}</td>
      <td className="num">{kind === "parts" || qty != null ? `${fmtQty(qty)}${row.unit ? ` ${row.unit}` : ""}` : "-"}</td>
      <td className="num">{fmtMoney(val)}</td>
      <td>
        {row.splitHint ? (
          <Chip tone="sun" title={row.splitHint}><Scissors className="h-3 w-3" />ควรแยก{row.priceRatio ? ` ${fmtQty(Math.round(row.priceRatio * 10) / 10)} เท่า` : ""}</Chip>
        ) : null}
      </td>
      <td><StatusChip status={row.status} entryCount={row.entryCount} lockedBy={lockedBy} /></td>
    </tr>
  )
}
