"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Search, RefreshCw, ChevronRight, AlertTriangle, Factory } from "lucide-react"
import { isAtmsSettled } from "@/lib/atms-board"
import { daysSince } from "@/lib/bkk-time"

/* ── แท็บ "ภาระอู่" ──────────────────────────────────────────────────────────
 * มองจากฝั่ง Mena-Next ล้วน ๆ: งานซ่อม "อู่นอก" ที่ยังเปิดอยู่ ถูกจัดกลุ่มตามอู่
 * เพื่อตอบคำถามเดียว — ตอนนี้อู่ไหนถือรถของเราค้างอยู่กี่คัน และค้างที่ขั้นตอนอะไร
 * ต่างจากตาราง/บอร์ดที่นับใบงานฝั่ง WMS (รวมงานอะไหล่ลงคัน + งานที่คีย์ย้อนหลัง)
 * ตัวเลขสองฝั่งจึงไม่เท่ากันโดยธรรมชาติ                                        */

type Job = {
  plate: string
  trucknum: string
  mrCode: string
  mrId: number
  step: string
  stepAt: string
  vendor: string
  openedAt: string
  expectedDone: string
  severity: string
  prAmount: number
  prCodes: string[]
  poCodes: string[]
  parkedDays: number | null
  plant: string
  wms: { id: string; status: string; garage: string } | null
}

type Res = { ok: boolean; fetchedAt?: string; jobs?: Job[]; error?: string }

const NO_VENDOR = "(ไม่ระบุอู่)"

// สีต่อขั้นตอน ATMS — ล้อชุดสีของ BAR_COLORS ในหน้าอู่นอก ให้คนอ่านสีเดียวกันทั้งระบบ
const STEP_COLORS: Record<string, string> = {
  "รอประเมินการซ่อม": "#9ca3af",
  "รอราคา":          "#06b6d4",
  "รออนุมัติ":        "#eab308",
  "รออะไหล่":        "#f97316",
  "รถซ่อม":          "#3b82f6",
  "แย็กโม่":          "#a855f7",
  "รถซ่อมเสร็จสิ้น":   "#22c55e",
  "รถรอขาย":         "#64748b",
}
const stepColor = (s: string) => STEP_COLORS[s] ?? "#9ca3af"

// ช่วงอายุงาน — เขียว/เหลือง/ส้ม/แดง ไล่ตามความน่ากังวล
const AGE_BUCKETS = [
  { key: "0-7",   label: "0–7 วัน",   color: "#1B8C4B", hit: (d: number) => d < 8 },
  { key: "8-14",  label: "8–14 วัน",  color: "#E8A317", hit: (d: number) => d >= 8 && d < 15 },
  { key: "15-29", label: "15–29 วัน", color: "#F97316", hit: (d: number) => d >= 15 && d < 30 },
  { key: "30+",   label: "30+ วัน",   color: "#DC2626", hit: (d: number) => d >= 30 },
]
const ageColor = (d: number) => AGE_BUCKETS.find((b) => b.hit(d))!.color

const SEVERITY_LABEL: Record<string, string> = { light: "เบา", medium: "กลาง", heavy: "หนัก" }

const fmtShort = (s: string) => {
  if (!s) return "—"
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit" })
}
const fmtTime = (s: string) => {
  if (!s) return ""
  const d = new Date(s)
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
}

const cardCls  = "rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10]"
const inputCls =
  "w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-3 py-2 text-[13px] text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"

export function GarageLoadTab() {
  const [jobs, setJobs]       = useState<Job[]>([])
  const [fetchedAt, setFetch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState("")
  const [q, setQ]             = useState("")
  const [fStep, setFStep]     = useState("")   // กรองด้วยขั้นตอนที่ค้าง
  const [fAge, setFAge]       = useState("")   // กรองด้วยช่วงอายุงาน
  const [open, setOpen]       = useState<Record<string, boolean>>({})
  const [showAll, setShowAll] = useState(false)

  const fetchJobs = useCallback(
    () =>
      fetch("/api/repair-external/garage-load")
        .then((r) => r.json())
        .then((d: Res) => {
          if (!d.ok) { setError(d.error ?? "โหลดข้อมูลไม่สำเร็จ"); return }
          setJobs(d.jobs ?? []); setFetch(d.fetchedAt ?? ""); setError("")
        })
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false)),
    [])

  // โหลดครั้งแรก — loading ตั้งต้นเป็น true อยู่แล้ว จึงไม่ต้อง setState ในตัว effect
  useEffect(() => { void fetchJobs() }, [fetchJobs])
  const reload = () => { setLoading(true); setError(""); void fetchJobs() }

  // อายุงาน = วันตั้งแต่เปิดงานใน Mena-Next (opened_at) — ตัวเดียวกับที่ใช้บอก "ค้างนานสุด"
  const ageOf = (j: Job) => daysSince(j.openedAt) ?? 0

  const { pending, settled, steps, ages, rows, filtered } = useMemo(() => {
    const pending = jobs.filter((j) => !isAtmsSettled(j.step))
    const settled = jobs.length - pending.length

    // นับสถานะ/ช่วงอายุจาก "งานที่ค้าง" ทั้งหมด (ไม่ผูกกับตัวกรอง) — chips จึงเป็นภาพรวมคงที่
    const steps: Record<string, number> = {}
    for (const j of pending) steps[j.step || "(ไม่มีขั้นตอน)"] = (steps[j.step || "(ไม่มีขั้นตอน)"] || 0) + 1
    const ages: Record<string, number> = {}
    for (const j of pending) ages[AGE_BUCKETS.find((b) => b.hit(ageOf(j)))!.key] = (ages[AGE_BUCKETS.find((b) => b.hit(ageOf(j)))!.key] || 0) + 1

    const kw = q.trim().toLowerCase()
    const bucket = AGE_BUCKETS.find((b) => b.key === fAge)
    const filtered = pending.filter((j) =>
      (!fStep || j.step === fStep) &&
      (!bucket || bucket.hit(ageOf(j))) &&
      (!kw || `${j.vendor} ${j.plate} ${j.trucknum} ${j.mrCode} ${j.step}`.toLowerCase().includes(kw)))

    // จัดกลุ่มตามอู่ — "ทั้งหมด" นับทุกใบของอู่นั้น (รวมที่เสร็จแล้ว) เพื่อให้เห็นสัดส่วนงานค้าง
    const totalByVendor: Record<string, number> = {}
    for (const j of jobs) totalByVendor[j.vendor?.trim() || NO_VENDOR] = (totalByVendor[j.vendor?.trim() || NO_VENDOR] || 0) + 1

    const map = new Map<string, { vendor: string; jobs: Job[]; maxDays: number; steps: Record<string, number>; noWms: number }>()
    for (const j of filtered) {
      const v = j.vendor?.trim() || NO_VENDOR
      const cur = map.get(v) ?? { vendor: v, jobs: [], maxDays: 0, steps: {}, noWms: 0 }
      cur.jobs.push(j)
      cur.maxDays = Math.max(cur.maxDays, ageOf(j))
      cur.steps[j.step] = (cur.steps[j.step] || 0) + 1
      if (!j.wms) cur.noWms++
      map.set(v, cur)
    }
    const rows = [...map.values()]
      .map((g) => ({ ...g, total: totalByVendor[g.vendor] ?? g.jobs.length }))
      .sort((a, b) => b.jobs.length - a.jobs.length || b.maxDays - a.maxDays)

    return { pending, settled, steps, ages, rows, filtered }
  }, [jobs, q, fStep, fAge])

  const maxPend = rows[0]?.jobs.length ?? 1
  const shown   = showAll ? rows : rows.slice(0, 12)
  const hasFilter = !!(q || fStep || fAge)

  if (loading) return <div className={`${cardCls} px-4 py-12 text-center text-[13px] text-[#9AA8A0]`}>กำลังโหลดภาระอู่จาก Mena-Next…</div>
  if (error)   return (
    <div className="rounded-[12px] border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-700 dark:border-red-500/40 dark:bg-red-900/20 dark:text-red-300">
      <b>ดึงข้อมูลจาก Mena-Next ไม่สำเร็จ</b> — {error}
      <button onClick={reload} className="ml-2 font-semibold underline">ลองใหม่</button>
    </div>
  )

  const tile = (label: string, value: number | string, color: string, note?: string) => (
    <div className={`${cardCls} px-4 py-3`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9AA8A0]">{label}</p>
      <p className="mt-0.5 text-[26px] font-semibold leading-none" style={{ fontFamily: "'Mitr', sans-serif", color }}>{value}</p>
      {note && <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{note}</p>}
    </div>
  )

  return (
    <div>
      {/* หัวแท็บ + เวลาที่ดึงข้อมูล */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Factory size={16} className="text-[#1B8C4B]" />
          <h2 className="text-[15px] font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>ภาระอู่ (Mena-Next)</h2>
          <span className="text-[11.5px] text-[#9AA8A0]">งานซ่อม &quot;อู่นอก&quot; ที่ยังเปิดอยู่ในระบบ Mena-Next จัดกลุ่มตามอู่</span>
        </div>
        <button onClick={reload} className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8E4] dark:border-white/10 px-3 py-1.5 text-[11.5px] font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5">
          <RefreshCw size={12} /> ดึงใหม่{fetchedAt && <span className="opacity-70">· {fmtTime(fetchedAt)}</span>}
        </button>
      </div>

      {/* สรุปหัว */}
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tile("งานอู่นอกเปิดอยู่", jobs.length, "#14271C", "ทุกใบที่ยังไม่ถูกปิดใน Mena-Next")}
        {tile("ซ่อมเสร็จสิ้นแล้ว", settled, "#1B8C4B", "รถซ่อมเสร็จสิ้น / รถรอขาย")}
        {tile("ยังค้างที่อู่", pending.length, "#DC2626", `กระจายใน ${new Set(pending.map((j) => j.vendor?.trim() || NO_VENDOR)).size} อู่`)}
        {tile("ค้างเกิน 30 วัน", ages["30+"] ?? 0, "#DC2626", "นับจากวันเปิดงาน")}
      </div>

      {/* chips: ขั้นตอนที่ค้าง */}
      <div className="mb-2 flex w-full flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-xs font-medium text-[#9AA8A0]">ขั้นตอนที่ค้าง:</span>
        {Object.entries(steps).sort((a, b) => b[1] - a[1]).map(([s, n]) => {
          const active = fStep === s
          return (
            <button
              key={s}
              onClick={() => setFStep(active ? "" : s)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition ${active ? "text-white" : "border border-[#E2E8E4] dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"}`}
              style={active ? { background: stepColor(s) } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: active ? "#fff" : stepColor(s) }} />
              {s} <b>{n}</b>
            </button>
          )
        })}
      </div>

      {/* chips: ช่วงอายุงาน */}
      <div className="mb-3 flex w-full flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-xs font-medium text-[#9AA8A0]">อายุงาน:</span>
        {AGE_BUCKETS.map((b) => {
          const active = fAge === b.key
          return (
            <button
              key={b.key}
              onClick={() => setFAge(active ? "" : b.key)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition ${active ? "text-white" : "border border-[#E2E8E4] dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"}`}
              style={active ? { background: b.color } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: active ? "#fff" : b.color }} />
              {b.label} <b>{ages[b.key] ?? 0}</b>
            </button>
          )
        })}
      </div>

      {/* ค้นหา */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา อู่ / ทะเบียน / เบอร์รถ / MR" className={inputCls + " pl-9"} />
        </div>
        {hasFilter && (
          <>
            <span className="text-[11.5px] text-[#9AA8A0]">แสดง {filtered.length} จาก {pending.length} คันที่ค้าง</span>
            <button onClick={() => { setQ(""); setFStep(""); setFAge("") }} className="rounded-[11px] border border-[#E2E8E4] dark:border-white/10 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5">ล้างตัวกรอง</button>
          </>
        )}
      </div>

      {/* ตารางราย อู่ */}
      <div className={`${cardCls} overflow-hidden`}>
        <div className="grid gap-3 border-b border-[#EEF2F0] dark:border-white/8 bg-[#F6FAF7] dark:bg-[#1a1f16] px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-wide text-[#9AA8A0]" style={{ gridTemplateColumns: "1fr 56px 64px minmax(0,210px) 92px" }}>
          <span>อู่</span><span className="text-right">ค้าง</span><span className="text-right">ทั้งหมด</span><span>ขั้นตอนที่ค้าง</span><span className="text-right">นานสุด</span>
        </div>

        {rows.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-[#9AA8A0]">ไม่มีงานอู่นอกค้างตามเงื่อนไขที่เลือก</div>}

        {shown.map((g) => {
          const isOpen = !!open[g.vendor]
          return (
            <div key={g.vendor} className="border-b border-[#F1F5F2] dark:border-white/5 last:border-0">
              <button
                onClick={() => setOpen((o) => ({ ...o, [g.vendor]: !o[g.vendor] }))}
                className="grid w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-gray-50 dark:hover:bg-white/5"
                style={{ gridTemplateColumns: "1fr 56px 64px minmax(0,210px) 92px" }}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <ChevronRight size={13} className={`shrink-0 text-[#9AA8A0] transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  <span className="truncate text-[13px] text-gray-700 dark:text-gray-300" title={g.vendor}>{g.vendor}</span>
                  {g.noWms > 0 && (
                    <span title={`${g.noWms} คันยังไม่มีใบงานในระบบ WMS`} className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      <AlertTriangle size={9} />{g.noWms}
                    </span>
                  )}
                </span>
                <span className="text-right text-[19px] font-semibold leading-none" style={{ fontFamily: "'Mitr', sans-serif", color: ageColor(g.maxDays) }}>{g.jobs.length}</span>
                <span className="text-right text-[12px] text-[#9AA8A0]">{g.total}</span>
                <span className="flex h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10" style={{ width: `${Math.max(14, (g.jobs.length / maxPend) * 100)}%`, maxWidth: 200, minWidth: 24 }}>
                  {Object.entries(g.steps).map(([s, n]) => <span key={s} title={`${s} ${n} คัน`} style={{ flex: n, background: stepColor(s) }} />)}
                </span>
                <span className="text-right text-[11.5px] font-semibold" style={{ color: ageColor(g.maxDays) }}>{g.maxDays} วัน</span>
              </button>

              {/* รายคันของอู่นี้ */}
              {isOpen && (
                <div className="bg-[#FAFCFB] px-4 pb-3 dark:bg-white/[0.02]">
                  {[...g.jobs].sort((a, b) => ageOf(b) - ageOf(a)).map((j) => (
                    <div key={`${j.mrId}-${j.plate}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#EEF2F0] py-1.5 text-[12px] dark:border-white/5">
                      <span className="w-[96px] shrink-0 font-semibold text-[#14271C] dark:text-white">{j.plate || "—"}</span>
                      <span className="w-[58px] shrink-0 text-[#9AA8A0]">{j.trucknum || "—"}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: stepColor(j.step) }}>{j.step || "—"}</span>
                      <span className="shrink-0 font-semibold" style={{ color: ageColor(ageOf(j)) }}>{ageOf(j)} วัน</span>
                      <span className="shrink-0 text-gray-500 dark:text-gray-400">เปิดงาน {fmtShort(j.openedAt)}</span>
                      {j.expectedDone && <span className="shrink-0 text-gray-500 dark:text-gray-400">คาดเสร็จ {fmtShort(j.expectedDone)}</span>}
                      {j.mrCode && <span className="shrink-0 text-[#9AA8A0]">{j.mrCode}</span>}
                      {j.severity && <span className="shrink-0 text-[#9AA8A0]">ความรุนแรง {SEVERITY_LABEL[j.severity] ?? j.severity}</span>}
                      {j.prCodes.length > 0 && <span className="shrink-0 text-[#9AA8A0]">PR {j.prCodes.join(", ")}</span>}
                      {j.parkedDays !== null
                        ? <span className="shrink-0 text-[#9AA8A0]">จอดจริง {j.parkedDays} วัน{j.plant ? ` · ${j.plant}` : ""}</span>
                        : <span className="shrink-0 text-[11px] text-[#9AA8A0] opacity-80">ไม่อยู่ในรายการรถจอด</span>}
                      {j.wms
                        ? <span className="shrink-0 rounded-full bg-[#F0FDF4] px-2 py-0.5 text-[10.5px] font-semibold text-[#1B8C4B] dark:bg-emerald-900/20 dark:text-emerald-300">WMS: {j.wms.status}</span>
                        : <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">ยังไม่มีใบงาน WMS</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* legend + ดูอู่ที่เหลือ */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#F1F5F2] px-4 py-2 text-[11px] text-gray-500 dark:border-white/5 dark:text-gray-400">
          {AGE_BUCKETS.map((b) => (
            <span key={b.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />{b.label}</span>
          ))}
          <span className="opacity-70">คลิกแถว = ดูรายคัน</span>
          {rows.length > 12 && (
            <button onClick={() => setShowAll((v) => !v)} className="ml-auto font-medium text-[#1B8C4B] hover:underline">
              {showAll ? "ย่อเหลือ 12 อันดับแรก" : `ดูอีก ${rows.length - 12} อู่`}
            </button>
          )}
        </div>
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-[#9AA8A0]">
        <span className="shrink-0">ⓘ</span>
        <span>
          ตัวเลขในแท็บนี้มาจาก <b className="font-semibold text-[#5B7568] dark:text-gray-400">Mena-Next</b> (งานซ่อมที่ยังเปิดอยู่ · cache 5 นาที)
          จึงไม่เท่ากับจำนวนใบงานในแท็บตาราง ซึ่งนับจากระบบ WMS และรวมงาน &quot;อะไหล่ลงคัน&quot; กับงานที่คีย์ย้อนหลังด้วย ·
          ชื่ออู่ที่นี่เป็นชื่อนิติบุคคลเต็มตามที่ Mena-Next บันทึกไว้
        </span>
      </p>
    </div>
  )
}
