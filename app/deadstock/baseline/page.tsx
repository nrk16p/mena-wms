"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Database, CalendarRange, Link2, Calculator, BookOpen, ShieldCheck, Lightbulb, Download, SearchCheck } from "lucide-react"
import { KPI_AGE_DAYS, KPI_MAX_VALUE, STALE_DAYS, type DeadstockPayload } from "@/lib/deadstock-core"

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

// ขนาดสไลด์คงที่ — PNG ออกมา 2× ของนี้ (2560×1440)
const SLIDE_W = 1280
const SLIDE_H = 720
// เพดานความกว้างพรีวิว — จอ ultrawide ไม่ให้สไลด์บานจนล้นจอ
const PREVIEW_MAX_W = 1920

function monthLabel(month: string): string {
  const [y, m] = month.split("-")
  return `${TH_MONTHS[+m - 1]} ${(+y + 543) % 100}`
}

const baht = (n: number) => "฿" + Math.round(n).toLocaleString("th-TH")

function Card({ icon: Icon, no, title, children }: {
  icon: React.ElementType; no?: string; title: string; children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600">
          <Icon size={16} />
        </span>
        <p className="text-sm font-bold text-gray-900 dark:text-white">
          {no && <span className="text-red-600 mr-1.5">{no}</span>}{title}
        </p>
      </div>
      <div className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed space-y-2">{children}</div>
    </div>
  )
}

function QA({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-white/[0.03] p-3.5">
      <p className="text-[13px] font-semibold text-gray-800 dark:text-gray-200 mb-1">Q: {q}</p>
      <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">A: {a}</p>
    </div>
  )
}

/** กราฟ Pareto — แท่งเรียงมูลค่ามากไปน้อย + เส้นเปอร์เซ็นต์สะสม (เครื่องมือมาตรฐานของขั้น Analyze)
 *  วาดด้วย div + SVG overlay เพราะ repo ไม่มี chart library และไม่ควรเพิ่ม dependency เพื่อกราฟเดียว */
function ParetoChart({ groups, total }: { groups: { name: string; value: number; count: number; cumPct: number }[]; total: number }) {
  const H = 150
  const max = Math.max(...groups.map((g) => g.value), 1)
  const n = groups.length
  // จุดกึ่งกลางแท่งที่ i ในระบบพิกัด 0–100 ของความกว้าง
  const cx = (i: number) => ((i + 0.5) / n) * 100
  const points = groups.map((g, i) => `${cx(i)},${H - (g.cumPct / 100) * H}`).join(" ")

  return (
    <div>
      <div className="relative" style={{ height: H }}>
        {/* แท่งมูลค่า */}
        <div className="absolute inset-0 flex items-end gap-1.5">
          {groups.map((g) => (
            <div
              key={g.name}
              className="flex-1 rounded-t bg-red-500/80"
              style={{ height: `${Math.max((g.value / max) * 100, 1.5)}%` }}
              title={`${g.name} — ${g.count} รายการ · ${"฿" + Math.round(g.value).toLocaleString("th-TH")} · สะสม ${g.cumPct.toFixed(0)}%`}
            />
          ))}
        </div>
        {/* เส้นสะสม + เส้น 80% */}
        <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none">
          <line x1="0" y1={H - 0.8 * H} x2="100" y2={H - 0.8 * H} stroke="#9CA3AF" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <polyline points={points} fill="none" stroke="#111827" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {groups.map((g, i) => (
            <circle key={g.name} cx={cx(i)} cy={H - (g.cumPct / 100) * H} r="3" fill="#111827" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <span className="absolute right-0 text-[10px] font-bold text-gray-400" style={{ top: H - 0.8 * H - 14 }}>
          80%
        </span>
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {groups.map((g) => (
          <div key={g.name} className="flex-1 min-w-0 text-center">
            <p className="text-[10px] text-gray-500 truncate" title={g.name}>{g.name}</p>
            <p className="text-[10px] font-bold text-gray-700 dark:text-gray-300">{Math.round((g.value / total) * 100)}%</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DeadstockBaselinePage() {
  const [data, setData] = useState<DeadstockPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingPng, setSavingPng] = useState(false)
  const slideRef = useRef<HTMLDivElement>(null)
  // พรีวิวสเกลตามความกว้างจอ แต่ตัวที่ export ยังเป็น 1280×720 เป๊ะเสมอ
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setScale(Math.min(e.contentRect.width, PREVIEW_MAX_W) / SLIDE_W))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/deadstock")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  /** สถิติจาก "เดือนที่จบแล้ว และวัดผลได้จริง" เท่านั้น
   *  ตัด 2 อย่างออก:
   *    1. เดือนปัจจุบัน — ยังเดินอยู่ เอามาเฉลี่ยจะกดค่าให้ต่ำกว่าจริง
   *    2. เดือนแรก ๆ ที่ของยังอายุไม่ถึง KPI_AGE_DAYS วัน — ค่าเป็น ฿0 เชิงโครงสร้าง
   *       (ข้อมูลเริ่มที่ startYm ของชิ้นแรกจึงเพิ่งครบ 60 วันหลังจากนั้น) ไม่ใช่เพราะทำได้ตามเป้า
   *       ถ้าเอามาเฉลี่ยด้วยจะทำให้ X̄ ต่ำกว่าความจริงและ "ต่ำสุด ฿0" ทำให้เข้าใจผิด */
  const stat = useMemo(() => {
    if (!data || data.monthly.length < 2) return null
    const [sy, sm] = data.startYm.split("-").map(Number)
    const firstMeasurable = new Date(Date.UTC(sy, sm - 1, 1))
    firstMeasurable.setUTCDate(firstMeasurable.getUTCDate() + KPI_AGE_DAYS)
    const fromYm = `${firstMeasurable.getUTCFullYear()}-${String(firstMeasurable.getUTCMonth() + 1).padStart(2, "0")}`

    const closed = data.monthly.slice(0, -1)
    const done = closed.filter((m) => m.ym >= fromYm)
    if (done.length === 0) return null
    const skipped = closed.length - done.length
    const kpi = done.map((m) => m.kpiValue)
    const avg = kpi.reduce((a, b) => a + b, 0) / kpi.length
    const sd = Math.sqrt(kpi.reduce((a, b) => a + (b - avg) ** 2, 0) / kpi.length)
    const current = data.summary.kpiValue
    return {
      done,
      skipped,
      fromYm,
      monthCount: done.length,
      closedCount: closed.length,
      avg,
      sd,
      min: Math.min(...kpi),
      max: Math.max(...kpi),
      first: done[0],
      last: done[done.length - 1],
      current,
      currentCount: data.summary.kpiCount,
      gap: current - KPI_MAX_VALUE,
      ratio: current / KPI_MAX_VALUE,
      achievement: Math.round((KPI_MAX_VALUE / Math.max(current, 1)) * 100),
    }
  }, [data])

  /** ขั้นวิเคราะห์ (Analyze) — หาว่าเงินที่จมกระจุกอยู่ตรงไหน และสมมติฐานสาเหตุไหนที่ข้อมูลรับ/ไม่รับ */
  const analysis = useMemo(() => {
    if (!data) return null
    const aged = data.pending.filter((r) => r.ageDays > KPI_AGE_DAYS)
    if (aged.length === 0) return null
    const total = aged.reduce((s, r) => s + r.value, 0)

    // Pareto ระดับรายการ — กี่รายการรวมกันเป็น 80% ของมูลค่า
    const sorted = [...aged].sort((a, b) => b.value - a.value)
    let cum = 0
    let n80 = 0
    for (const r of sorted) {
      cum += r.value
      n80 += 1
      if (cum >= total * 0.8) break
    }

    // Pareto ระดับกลุ่มสินค้า (ใช้วาดกราฟ)
    const gmap = new Map<string, { name: string; value: number; count: number }>()
    for (const r of aged) {
      let g = gmap.get(r.itemGroup)
      if (!g) gmap.set(r.itemGroup, (g = { name: r.itemGroup, value: 0, count: 0 }))
      g.value += r.value
      g.count += 1
    }
    let run = 0
    const groups = [...gmap.values()]
      .sort((a, b) => b.value - a.value)
      .map((g) => {
        run += g.value
        return { ...g, cumPct: (run / total) * 100 }
      })

    const plates = new Set(aged.map((r) => r.plate))
    const perPlate = new Map<string, number>()
    for (const r of aged) perPlate.set(r.plate, (perPlate.get(r.plate) ?? 0) + 1)
    const heavyPlates = [...perPlate.values()].filter((n) => n >= 3).length

    const repurchased = aged.filter((r) => r.newerCount > 0)
    const cheap = aged.filter((r) => r.value < 500)
    const ages = aged.map((r) => r.ageDays).sort((a, b) => a - b)

    return {
      aged,
      total,
      n80,
      n80Pct: (n80 / aged.length) * 100,
      groups,
      top: sorted.slice(0, 6),
      plateCount: plates.size,
      heavyPlates,
      repurchasedCount: repurchased.length,
      repurchasedPct: (repurchased.length / aged.length) * 100,
      repurchasedValue: repurchased.reduce((s, r) => s + r.value, 0),
      cheapCount: cheap.length,
      cheapValue: cheap.reduce((s, r) => s + r.value, 0),
      cheapPct: (cheap.reduce((s, r) => s + r.value, 0) / total) * 100,
      medianAge: ages[Math.floor(ages.length / 2)],
      maxAge: ages[ages.length - 1],
    }
  }, [data])

  const savePng = async () => {
    const el = slideRef.current
    if (!el || savingPng) return
    setSavingPng(true)
    try {
      const { toBlob } = await import("html-to-image")
      const opts = { pixelRatio: 2, backgroundColor: "#ffffff", skipFonts: true }
      // Safari/WebKit: การจับภาพครั้งแรกมักได้ภาพเปล่า — วอร์มก่อนแล้วค่อยจับจริง
      await toBlob(el, opts)
      const blob = await toBlob(el, opts)
      if (!blob) throw new Error("capture returned empty image")
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.download = `deadstock-baseline-${new Date().toISOString().slice(0, 10)}.png`
      a.href = url
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      console.error("save png failed", e)
      alert(`บันทึก PNG ไม่สำเร็จ: ${e instanceof Error ? e.message : e}`)
    } finally {
      setSavingPng(false)
    }
  }

  const maxKpi = Math.max(KPI_MAX_VALUE, ...(data?.monthly.map((m) => m.kpiValue) ?? [1]))

  return (
    <div className="p-5 md:p-6 max-w-[1400px] mx-auto">
      <Link
        href="/deadstock"
        className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-600 transition-colors mb-3"
      >
        <ArrowLeft size={12} /> กลับไปหน้ารายงาน
      </Link>
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
        นิยามตัวชี้วัด &amp; Baseline — ของค้างคลัง (Deadstock)
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        เอกสารกำกับตัวชี้วัดของค้างคลังลาดกระบัง — ใบรับสินค้า (DD) ที่ยังไม่ถูกเบิก (WD) สำหรับการจัดทำ Baseline และการควบคุมทุนจม
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 mb-5">
        {/* 1. แหล่งที่มา */}
        <Card icon={Database} no="1." title="แหล่งที่มาของข้อมูล (Data Source)">
          <p>
            <span className="font-semibold text-gray-800 dark:text-gray-200">ระบบ ATMS</span> — รายการเคลื่อนไหวสินค้า (stock movement)
            ของคลังลาดกระบัง ดึงเข้าฐานข้อมูล <span className="font-mono text-xs">atms.stockmovement_v5</span> อัตโนมัติทุกวัน
            โดยแยกเป็นแถว &quot;รับเข้า&quot; (มีเลขใบ DD) และ &quot;เบิกออก&quot; (มีเลขใบ WD)
          </p>
          <p>
            <span className="font-semibold text-gray-800 dark:text-gray-200">ระบบ Mena-WMS</span> — จับคู่ใบรับกับใบเบิกด้วยหลัก FIFO
            รายรหัสสินค้า แล้วแสดงผลที่หน้า <span className="font-mono text-xs">/deadstock</span>
          </p>
        </Card>

        {/* 2. As-Is */}
        <Card icon={CalendarRange} no="2." title="การเก็บข้อมูลก่อนการปรับปรุง (As-Is Data Collection)">
          <p>
            เก็บข้อมูลย้อนหลัง<span className="font-semibold text-gray-800 dark:text-gray-200">ตั้งแต่ {data ? monthLabel(data.startYm) : "ม.ค. 69"} จนถึงปัจจุบัน</span>
            {data && stat && <> รวม {data.monthly.length} เดือน (จบเดือนแล้ว {stat.monthCount} เดือน)</>}
            {data && <> ปัจจุบันมีใบ DD ค้าง {data.summary.pendingCount.toLocaleString()} รายการ มูลค่า {baht(data.summary.pendingValue)}</>}
          </p>
          <p>
            วัดผลเป็น<span className="font-semibold text-gray-800 dark:text-gray-200">มูลค่าของที่ค้างเกิน {KPI_AGE_DAYS} วัน ณ สิ้นเดือน</span> —
            คำนวณสดจากข้อมูลที่ซิงค์รายวัน ไม่มีการกรอกมือ
          </p>
        </Card>

        {/* 3. ความเกี่ยวข้อง */}
        <Card icon={Link2} no="3." title="ความเกี่ยวข้องของข้อมูล (Data Relevance)">
          <p>
            อะไหล่ที่สั่งซื้อโดยระบุทะเบียนรถไว้ตั้งแต่ตอนขอซื้อ <span className="font-semibold text-gray-800 dark:text-gray-200">ต้องถูกเบิกไปติดตั้งกับรถคันนั้น</span> —
            ถ้ารับเข้ามาแล้วไม่ถูกเบิก แปลว่าเงินจมอยู่ในคลังโดยไม่เกิดประโยชน์ และมีความเสี่ยงสูญหาย/เสื่อมสภาพ
          </p>
          <p>
            ตัวเลขนี้ยังสะท้อนคุณภาพการวางแผนจัดซื้อ — ของที่ค้างพร้อมกับมี<span className="font-semibold text-gray-800 dark:text-gray-200">การซื้อซ้ำ</span>ของรหัสเดียวกัน
            คือสัญญาณว่าการสั่งซื้อไม่ได้ดูของที่มีอยู่ก่อน
          </p>
        </Card>

        {/* 4. สูตร Baseline */}
        <Card icon={Calculator} no="4." title="สูตรการคำนวณ Baseline">
          {loading || !stat ? (
            <p className="text-gray-400">กำลังคำนวณจากข้อมูลจริง...</p>
          ) : (
            <>
              <div className="rounded-lg bg-gray-50 dark:bg-white/[0.03] p-3 font-mono text-[12.5px] space-y-1">
                <p>เป้าหมาย (Target) = <span className="font-bold text-red-600">ไม่เกิน {baht(KPI_MAX_VALUE)}</span></p>
                <p>ค่าปัจจุบัน = <span className="font-bold text-gray-900 dark:text-white">{baht(stat.current)}</span> ({stat.currentCount} รายการ)</p>
                <p>ค่าเฉลี่ยย้อนหลัง (X̄) = {baht(stat.avg)}/เดือน</p>
                <p>ส่วนเบี่ยงเบนมาตรฐาน (SD) = {baht(stat.sd)}</p>
              </div>
              <p>
                ตัวชี้วัดคือ<span className="font-semibold text-gray-800 dark:text-gray-200">มูลค่าของที่ค้างเกิน {KPI_AGE_DAYS} วัน</span> ต้องไม่เกิน{" "}
                {baht(KPI_MAX_VALUE)} — เป็นเป้าหมายที่กำหนดจากนโยบาย ไม่ได้คำนวณจากข้อมูลย้อนหลัง
              </p>
              <p>
                คำนวณจากข้อมูลจริง {stat.monthCount} เดือน ({monthLabel(stat.first.ym)} – {monthLabel(stat.last.ym)},
                ต่ำสุด {baht(stat.min)} / สูงสุด {baht(stat.max)})
              </p>
              {stat.skipped > 0 && (
                <p className="rounded-lg bg-amber-50 dark:bg-amber-500/10 p-3 text-[12.5px] text-amber-800 dark:text-amber-300">
                  <span className="font-bold">ตัด {stat.skipped} เดือนแรกออกจากการเฉลี่ย</span> — ข้อมูลเริ่มเก็บที่{" "}
                  {monthLabel(data!.startYm)} ของที่รับเข้ามาจึงยังอายุไม่ถึง {KPI_AGE_DAYS} วัน ค่าเป็น ฿0
                  <span className="font-semibold">เชิงโครงสร้าง ไม่ใช่เพราะทำได้ตามเป้า</span> — ถ้านับรวมจะทำให้ค่าเฉลี่ยต่ำกว่าความจริง
                </p>
              )}
              <p className="rounded-lg bg-red-50 dark:bg-red-500/10 p-3 text-[12.5px]">
                <span className="font-bold text-red-700 dark:text-red-400">สถานะปัจจุบัน</span> — ค่าจริงอยู่ที่{" "}
                <span className="font-bold">{baht(stat.current)}</span> สูงกว่าเป้าหมาย{" "}
                <span className="font-bold">{stat.ratio.toFixed(1)} เท่า</span> (ส่วนเกิน {baht(stat.gap)})
                ต้องลดลงให้ได้ก่อนจึงจะผ่านเกณฑ์
              </p>
            </>
          )}
        </Card>
      </div>

      {/* กราฟ KPI รายเดือนเทียบเป้า */}
      {stat && data && (
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5 mb-5">
          <p className="text-sm font-bold text-gray-900 dark:text-white mb-1">
            มูลค่าของที่ค้างเกิน {KPI_AGE_DAYS} วัน เทียบเป้าหมาย {baht(KPI_MAX_VALUE)}
          </p>
          <p className="text-xs text-gray-500 mb-4">
            เส้นประแดง = เพดานเป้าหมาย · เดือนสุดท้ายยังไม่จบเดือน · แท่งเทา = ของยังอายุไม่ถึง {KPI_AGE_DAYS} วัน จึงยังวัดผลไม่ได้
          </p>
          <div className="relative flex items-end gap-3 h-48">
            <div
              className="absolute left-0 right-0 border-t-2 border-dashed border-red-500"
              style={{ bottom: `${(KPI_MAX_VALUE / maxKpi) * 100}%` }}
            >
              <span className="absolute -top-5 right-0 text-[11px] font-bold text-red-600">เป้า {baht(KPI_MAX_VALUE)}</span>
            </div>
            {data.monthly.map((m, idx) => {
              // เดือนที่ของยังอายุไม่ถึงเกณฑ์ = วัดไม่ได้ ห้ามแสดงเป็นสีเขียว "ผ่าน"
              const notMeasurable = m.ym < stat.fromYm
              const over = m.kpiValue > KPI_MAX_VALUE
              const isCurrent = idx === data.monthly.length - 1
              const color = notMeasurable ? "bg-gray-300" : over ? "bg-red-600" : "bg-emerald-500"
              return (
                <div key={m.ym} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                  <span className={`text-[11px] font-bold ${notMeasurable ? "text-gray-400" : over ? "text-red-600" : "text-emerald-600"}`}>
                    {notMeasurable ? "ยังวัดไม่ได้" : baht(m.kpiValue)}
                  </span>
                  <div
                    className={`w-full max-w-[54px] rounded-t ${color} ${isCurrent ? "opacity-60" : ""}`}
                    style={{ height: `${Math.max((m.kpiValue / maxKpi) * 100, notMeasurable ? 2 : 1)}%` }}
                    title={
                      notMeasurable
                        ? `${m.ym} — ของยังอายุไม่ถึง ${KPI_AGE_DAYS} วัน จึงยังวัดผลไม่ได้`
                        : `${m.ym} — ${m.kpiCount} รายการ ${baht(m.kpiValue)}`
                    }
                  />
                </div>
              )
            })}
          </div>
          <div className="flex gap-3 mt-2">
            {data.monthly.map((m, idx) => (
              <div key={m.ym} className="flex-1 text-center text-[11px] text-gray-500">
                {monthLabel(m.ym)}{idx === data.monthly.length - 1 ? "*" : ""}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ขั้นวิเคราะห์ (Analyze) ── */}
      {analysis && (
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5 mb-5">
          <div className="flex items-center gap-2.5 mb-1">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600">
              <SearchCheck size={16} />
            </span>
            <p className="text-sm font-bold text-gray-900 dark:text-white">
              ขั้นวิเคราะห์ (Analyze) — เงินจมอยู่ตรงไหน และเพราะอะไร
            </p>
          </div>
          <p className="text-xs text-gray-500 mb-4 pl-[42px]">
            วิเคราะห์ของที่ค้างเกิน {KPI_AGE_DAYS} วัน จำนวน {analysis.aged.length} รายการ มูลค่า {baht(analysis.total)}
          </p>

          {/* ตัวเลขสรุปจากการวิเคราะห์ */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: "หลักการ Pareto", value: `${analysis.n80} / ${analysis.aged.length} รายการ`, sub: `${analysis.n80Pct.toFixed(0)}% ของจำนวน = 80% ของมูลค่า` },
              { label: "การกระจายตัว", value: `${analysis.plateCount} คัน`, sub: `มีเพียง ${analysis.heavyPlates} คันที่ค้าง ≥3 รายการ` },
              { label: "อายุค้าง (ค่ากลาง)", value: `${analysis.medianAge} วัน`, sub: `นานสุด ${analysis.maxAge} วัน` },
              { label: "ของถูก (<฿500)", value: `${analysis.cheapCount} รายการ`, sub: `แต่เป็นเงินแค่ ${analysis.cheapPct.toFixed(0)}% (${baht(analysis.cheapValue)})` },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-gray-50 dark:bg-white/[0.03] p-3">
                <p className="text-[11.5px] font-semibold text-gray-500">{s.label}</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white leading-tight">{s.value}</p>
                <p className="text-[11.5px] text-gray-500">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* Pareto ตามกลุ่มสินค้า */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div>
              <p className="text-[13px] font-bold text-gray-800 dark:text-gray-200 mb-1">
                Pareto — มูลค่าที่ค้างตามกลุ่มสินค้า
              </p>
              <p className="text-[11.5px] text-gray-500 mb-3">แท่ง = มูลค่า · เส้น = เปอร์เซ็นต์สะสม</p>
              <ParetoChart groups={analysis.groups} total={analysis.total} />
            </div>

            <div>
              <p className="text-[13px] font-bold text-gray-800 dark:text-gray-200 mb-1">รายการที่จมเงินมากที่สุด</p>
              <p className="text-[11.5px] text-gray-500 mb-3">ล้วนเป็นอะไหล่ชิ้นใหญ่เฉพาะรุ่นที่ค้างนานหลายเดือน</p>
              <div className="space-y-1.5">
                {analysis.top.map((r) => (
                  <div key={`${r.dd}|${r.itemCode}`} className="flex items-center gap-2.5 rounded-lg bg-gray-50 dark:bg-white/[0.03] px-3 py-2">
                    <span className="text-[13px] font-bold text-gray-900 dark:text-white tabular-nums w-[68px] shrink-0 text-right">{baht(r.value)}</span>
                    <span className="text-[11px] font-semibold text-red-600 tabular-nums w-[52px] shrink-0">{r.ageDays} วัน</span>
                    <span className="text-[12.5px] text-gray-600 dark:text-gray-400 truncate flex-1">{r.itemName}</span>
                    <span className="text-[11.5px] text-gray-400 shrink-0">{r.plate}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* สมมติฐานสาเหตุ */}
          <p className="text-[13px] font-bold text-gray-800 dark:text-gray-200 mt-6 mb-1">สมมติฐานสาเหตุ และสิ่งที่ข้อมูลบอก</p>
          <p className="text-[11.5px] text-gray-500 mb-3">
            ข้อมูลยืนยันได้เฉพาะ &quot;รูปแบบ&quot; — สาเหตุที่แท้จริงต้องยืนยันกับผู้ปฏิบัติงานอีกชั้น จึงระบุสถานะกำกับไว้ทุกข้อ
          </p>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-white/8">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-white/[0.03] text-left">
                  <th className="px-3 py-2 font-bold text-gray-700 dark:text-gray-300 whitespace-nowrap">สมมติฐาน</th>
                  <th className="px-3 py-2 font-bold text-gray-700 dark:text-gray-300">หลักฐานจากข้อมูล</th>
                  <th className="px-3 py-2 font-bold text-gray-700 dark:text-gray-300 whitespace-nowrap">สถานะ</th>
                </tr>
              </thead>
              <tbody className="text-gray-600 dark:text-gray-400">
                {[
                  {
                    h: "สั่งซื้อซ้ำทั้งที่ของเก่ายังอยู่",
                    e: `มีของค้างเก่าเพียง ${analysis.repurchasedCount} จาก ${analysis.aged.length} รายการ (${analysis.repurchasedPct.toFixed(0)}%) ที่ถูกสั่งซ้ำ คิดเป็นเงิน ${baht(analysis.repurchasedValue)}`,
                    v: "ตกไป",
                    tone: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300",
                  },
                  {
                    h: "กระจุกอยู่ที่รถไม่กี่คันที่ถูกทิ้งค้าง",
                    e: `ของค้างกระจายอยู่ ${analysis.plateCount} คัน จาก ${analysis.aged.length} รายการ มีเพียง ${analysis.heavyPlates} คันที่ค้าง ≥3 รายการ`,
                    v: "ตกไป",
                    tone: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300",
                  },
                  {
                    h: "สั่งของมาแล้วงานซ่อมไม่ได้ทำ หรือเปลี่ยนวิธีซ่อม",
                    e: "รายการที่จมเงินสูงสุดล้วนเป็นอะไหล่ชิ้นใหญ่เฉพาะรุ่น (ไดสตาร์ท / แผงคอยร้อน / ขาไก่คันส่งพวงมาลัย) ค้าง 170–210 วัน — ของแบบนี้สั่งเพื่องานซ่อมงานเดียว ไม่ใช่ของหมุนเวียน",
                    v: "สอดคล้อง",
                    tone: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
                  },
                  {
                    h: "ไม่มีกลไกปิดงาน ของจึงค้างถาวร",
                    e: `อายุค่ากลาง ${analysis.medianAge} วัน สูงสุด ${analysis.maxAge} วัน และของที่รับเข้ามาค้างต่อเนื่องทุกเดือน ไม่ใช่เหตุการณ์ครั้งเดียว — ระบบไม่มีสถานะ "คืนผู้ขาย" หรือ "โอนเข้าสต็อกกลาง" ให้ปิดรายการ`,
                    v: "สอดคล้อง",
                    tone: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
                  },
                  {
                    h: "อะไหล่รุ่นหายาก / รถปลดระวาง จึงไม่มีโอกาสได้ใช้",
                    e: "ของที่ค้างนานสุดเป็นอะไหล่ยี่ห้อ FAW, SANY, NISSAN CWM4 ซึ่งเป็นรุ่นส่วนน้อยของฟลีท — แต่ยังไม่ได้ตรวจสอบกับทะเบียนรถว่ายังใช้งานอยู่หรือไม่",
                    v: "ต้องตรวจต่อ",
                    tone: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
                  },
                  {
                    h: "ของราคาถูกไม่มีใครตาม",
                    e: `${analysis.cheapCount} รายการราคาต่ำกว่า ฿500 รวมเป็นเงินเพียง ${baht(analysis.cheapValue)} (${analysis.cheapPct.toFixed(0)}% ของทั้งหมด) — รกรายการแต่ไม่ใช่ตัวปัญหาด้านเงิน`,
                    v: "สอดคล้อง",
                    tone: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
                  },
                ].map((row) => (
                  <tr key={row.h} className="border-t border-gray-100 dark:border-white/5 align-top">
                    <td className="px-3 py-2.5 font-semibold text-gray-800 dark:text-gray-200 min-w-[180px]">{row.h}</td>
                    <td className="px-3 py-2.5 leading-relaxed">{row.e}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11.5px] font-bold whitespace-nowrap ${row.tone}`}>
                        {row.v}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ข้อสรุปของขั้นวิเคราะห์ */}
          <div className="mt-4 rounded-lg bg-red-50 dark:bg-red-500/10 p-4 text-[12.5px] text-gray-700 dark:text-gray-300 leading-relaxed">
            <p className="font-bold text-red-700 dark:text-red-400 mb-1.5">ข้อสรุปของขั้นวิเคราะห์</p>
            ของค้างชุดนี้<span className="font-semibold">ไม่ได้เกิดจากการสั่งซ้ำหรือรถไม่กี่คัน</span> แต่เป็นการรั่วทีละน้อยกระจายทั่วทั้งฟลีท
            ทุกเดือนอย่างต่อเนื่อง และแบ่งได้เป็น <span className="font-semibold">สองประชากรที่ต้องใช้คนละวิธีจัดการ</span> —
            {" "}{analysis.n80} รายการแรกที่กินเงิน 80% ต้องไล่ตัดสินใจรายตัว ส่วนอีก {analysis.cheapCount} รายการราคาต่ำกว่า ฿500
            (รวมกันแค่ {analysis.cheapPct.toFixed(0)}% ของเงิน) ควรจัดการเป็นชุดเดียวเพื่อล้างรายการให้หมด
            ปัญหาที่แท้จริงคือ<span className="font-semibold">ระบบไม่มีทางออกให้ของที่ไม่ได้ใช้</span> —
            เมื่อไม่มีสถานะปิดงาน ของจึงค้างสะสมไปเรื่อย ๆ โดยไม่มีใครต้องรับผิดชอบ
          </div>
        </div>
      )}

      {/* นิยามการวัด */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5 mb-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600">
            <BookOpen size={16} />
          </span>
          <p className="text-sm font-bold text-gray-900 dark:text-white">นิยามการวัด (Measurement Definition)</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <QA
            q="ทุกคนในองค์กรเข้าใจสิ่งที่กำลังจะวัดหรือไม่ ? นิยามคืออะไร ?"
            a={<>เข้าใจตรงกันด้วยนิยามชัดเจน — <span className="font-semibold">&quot;ของค้าง&quot; คือใบรับสินค้า (DD) ที่ยังไม่ถูกใบเบิก (WD) ตัดออกตามลำดับ FIFO</span> นับเฉพาะของที่ระบุทะเบียนรถไว้ตอนขอซื้อ ไม่รวมค่าแรงและของที่รับเข้าสต็อกกลาง</>}
          />
          <QA
            q="ทำไมถึงต้องเก็บข้อมูลนี้ ?"
            a="เพราะของที่ซื้อมาเพื่อรถคันหนึ่งแล้วไม่ถูกเบิกไปติดตั้ง คือเงินที่จมอยู่ในคลังโดยไม่เกิดประโยชน์ เสี่ยงสูญหายและเสื่อมสภาพ — และมักตามมาด้วยการซื้อซ้ำของเดิม"
          />
          <QA
            q="ข้อมูลที่รวบรวมวัดได้อย่างไร ?"
            a={<>จับคู่ใบรับกับใบเบิกด้วยหลัก FIFO รายรหัสสินค้า (ตัดจากใบเก่าสุดก่อน) ใบที่ตัดไม่หมดคือของค้าง แล้ววัด<span className="font-semibold">มูลค่าของที่ค้างเกิน {KPI_AGE_DAYS} วัน</span> ณ สิ้นเดือน</>}
          />
          <QA
            q="เมื่อได้ข้อมูลการวัดนี้มาแล้ว จะทำอะไรต่อ ?"
            a={<>ใช้ตรวจสอบและควบคุม (Monitoring &amp; Control) — ของที่ค้างเกิน {STALE_DAYS} วันต้องตามหาสาเหตุ ส่วนที่เกิน {KPI_AGE_DAYS} วันต้องตัดสินใจว่าจะคืนผู้ขาย โอนเข้าสต็อกกลาง หรือใช้กับรถคันอื่น</>}
          />
        </div>
      </div>

      {/* ความน่าเชื่อถือ */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5 mb-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600">
            <ShieldCheck size={16} />
          </span>
          <p className="text-sm font-bold text-gray-900 dark:text-white">ความน่าเชื่อถือและเจ้าของข้อมูล (Data Trust &amp; Ownership)</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <QA
            q="ข้อมูลนี้ได้มาจากที่ไหน ?"
            a="ระบบ ATMS (รายการเคลื่อนไหวสินค้า) ดึงเข้า MongoDB อัตโนมัติรายวัน แล้ว Mena-WMS คำนวณ FIFO สดทุกครั้งที่เปิดหน้า (พักผลไว้ 1 ชั่วโมง)"
          />
          <QA
            q="ข้อมูลเชื่อถือได้มากน้อยแค่ไหน ? มาจากหลักฐานอะไร ?"
            a={<>เชื่อถือได้สูง — ทุกแถวมาจากเอกสารจริงในระบบ (เลขใบ DD / WD / PR / PO) ไม่มีการกรอกมือ ตรวจสอบย้อนกลับได้ถึงใบต้นทาง <span className="font-semibold">ข้อจำกัดที่รู้ตัว:</span> เริ่มนับที่ {data?.startYm ?? "2026-01"} ของที่รับก่อนหน้านั้นไม่ปรากฏ ทำให้มียอดเบิกบางส่วนหาใบ DD ต้นทางไม่พบ{data && <> ({data.dataQuality.unmatchedIssueQty.toLocaleString()} หน่วย)</>}</>}
          />
          <QA
            q="ใครเป็นเจ้าของข้อมูล ?"
            a="ทีมจัดซื้อและยานยนต์ (Procurement & Automotive) — เป็นผู้ขอซื้อ รับของ และเบิกของไปติดตั้ง จึงเป็นผู้ควบคุมตัวเลขนี้โดยตรง"
          />
        </div>
      </div>

      {/* ข้อเสนอแนะ */}
      <div className="rounded-xl border border-dashed border-red-400/40 bg-red-50/50 dark:bg-red-500/5 p-5">
        <div className="flex items-center gap-2.5 mb-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white">
            <Lightbulb size={16} />
          </span>
          <p className="text-sm font-bold text-gray-900 dark:text-white">ข้อเสนอแนะ (Improve) — จากผลการวิเคราะห์</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-[13px] font-bold text-gray-800 dark:text-gray-200 mb-2">ทำได้ทันที (Quick Win)</p>
            <ul className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed space-y-1.5 list-disc pl-5">
              <li>
                <span className="font-semibold">ไล่ {analysis?.n80 ?? 23} รายการแรกที่กินเงิน 80%</span> — ตัดสินใจรายตัวว่า
                คืนผู้ขาย / โอนเข้าสต็อกกลาง / ใช้กับรถคันอื่น (ดาวน์โหลดรายการได้จากหน้าสถานะล่าสุด กรองช่วงอายุเกิน 30 วัน)
              </li>
              <li>
                <span className="font-semibold">ล้างของถูกเป็นชุดเดียว</span> — {analysis?.cheapCount ?? 31} รายการต่ำกว่า ฿500
                รวมกันแค่ {analysis ? analysis.cheapPct.toFixed(0) : 9}% ของเงิน ไม่คุ้มไล่ทีละตัว ควรโอนเข้าสต็อกกลางทั้งก้อน
              </li>
              <li>
                <span className="font-semibold">ตรวจ {analysis?.plateCount ?? 46} คันที่มีของค้าง</span> ว่ายังใช้งานอยู่หรือปลดระวางแล้ว
                — เพื่อยืนยันสมมติฐาน &quot;อะไหล่รุ่นหายาก/รถปลดระวาง&quot; ที่ยังตรวจไม่ได้จากข้อมูลชุดนี้
              </li>
            </ul>
          </div>
          <div>
            <p className="text-[13px] font-bold text-gray-800 dark:text-gray-200 mb-2">แก้ที่ระบบ (Structural)</p>
            <ul className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed space-y-1.5 list-disc pl-5">
              <li>
                <span className="font-semibold">เพิ่มสถานะปิดงานให้ของที่ไม่ได้ใช้</span> — สาเหตุหลักที่พบคือระบบไม่มีทางออกให้ของ
                เมื่อไม่มีสถานะ &quot;คืนผู้ขาย / โอนสต็อกกลาง&quot; ของจึงค้างสะสมโดยไม่มีใครรับผิดชอบ
              </li>
              <li>
                <span className="font-semibold">ผูกใบ DD กับใบแจ้งซ่อม (MR)</span> — ถ้างานซ่อมปิดหรือยกเลิกแล้วแต่ของยังไม่ถูกเบิก
                ให้ระบบทักทันที ไม่ต้องรอครบ {KPI_AGE_DAYS} วัน
              </li>
              <li>
                แจ้งเตือนอัตโนมัติ (อีเมล/LINE) เมื่อมีใบ DD ค้างเกิน {STALE_DAYS} วัน หรือเมื่อมูลค่าเกิน {KPI_AGE_DAYS} วันทะลุเป้า
              </li>
              <li>ขยายการวัดไปคลังอื่น (สระบุรี / ขอนแก่น / DIST) — โครงสร้างรองรับแล้ว เปลี่ยนแค่รหัสคลัง</li>
              <li>ทบทวนเป้าหมายและ Baseline ทุก 6 เดือน หรือเมื่อครบ 12 เดือนเต็มจึงคำนวณ X̄ ± SD ตามมาตรฐาน</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ── สไลด์นำเสนอ (16:9 PNG export) ── */}
      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">สไลด์สำหรับรายงาน (16:9)</p>
          <button
            onClick={savePng}
            disabled={savingPng || loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            <Download size={14} />
            {savingPng ? "กำลังบันทึก..." : "Export PNG"}
          </button>
        </div>

        {/* ruler: กว้างเท่าคอนเทนเนอร์เสมอ ไม่ขึ้นกับสไลด์ข้างใน → ResizeObserver ไม่วนลูป */}
        <div ref={wrapRef} className="w-full">
          <div
            className="mx-auto overflow-hidden rounded-xl border border-gray-200 dark:border-white/8"
            style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}
          >
            <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
              <div ref={slideRef} style={{ width: SLIDE_W, height: SLIDE_H }} className="bg-white p-10 flex flex-col">
                {/* Header */}
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h2 className="text-3xl font-bold text-gray-900 leading-tight">
                      นิยามตัวชี้วัด &amp; Baseline — ของค้างคลัง (Deadstock)
                    </h2>
                    <p className="text-lg text-gray-500 mt-1.5">
                      {data?.warehouse ?? "คลังลาดกระบัง"} • ใบรับสินค้า (DD) ที่ยังไม่ถูกเบิก (WD) • ตัดของแบบ FIFO
                    </p>
                  </div>
                  {stat && (
                    <div className="flex gap-3 shrink-0">
                      <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-3 text-center">
                        <p className="text-sm font-semibold text-red-600">เป้าหมาย</p>
                        <p className="text-3xl font-bold text-red-600 tabular-nums">{baht(KPI_MAX_VALUE)}</p>
                        <p className="text-sm text-gray-400">เกิน {KPI_AGE_DAYS} วัน</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-6 py-3 text-center">
                        <p className="text-sm font-semibold text-gray-400">ค่าปัจจุบัน</p>
                        <p className="text-3xl font-bold text-gray-900 tabular-nums">{baht(stat.current)}</p>
                        <p className="text-sm text-gray-400">{stat.currentCount} รายการ</p>
                      </div>
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-3 text-center">
                        <p className="text-sm font-semibold text-amber-600">ห่างจากเป้า</p>
                        <p className="text-3xl font-bold text-amber-600 tabular-nums">{stat.ratio.toFixed(1)}×</p>
                        <p className="text-sm text-gray-400">ส่วนเกิน {baht(stat.gap)}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* 4 numbered cards */}
                <div className="grid grid-cols-4 gap-4 mb-5">
                  <div className="rounded-xl border border-gray-200 p-4">
                    <p className="text-base font-bold text-gray-900 mb-1.5"><span className="text-red-600">1.</span> แหล่งที่มาของข้อมูล</p>
                    <p className="text-[15px] text-gray-600 leading-relaxed">
                      <span className="font-semibold text-gray-800">ATMS</span> — รายการเคลื่อนไหวสินค้า แถวรับเข้ามีเลข DD แถวเบิกออกมีเลข WD<br />
                      <span className="font-semibold text-gray-800">Mena-WMS</span> — จับคู่ FIFO รายรหัสสินค้าและแสดงผล
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 p-4">
                    <p className="text-base font-bold text-gray-900 mb-1.5"><span className="text-red-600">2.</span> การเก็บข้อมูล (As-Is)</p>
                    <p className="text-[15px] text-gray-600 leading-relaxed">
                      ตั้งแต่ <span className="font-semibold text-gray-800">{data ? monthLabel(data.startYm) : "ม.ค. 69"} – ปัจจุบัน</span>
                      {stat && <> รวม {data!.monthly.length} เดือน</>}
                      {data && <> · ค้าง {data.summary.pendingCount} รายการ {baht(data.summary.pendingValue)}</>}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 p-4">
                    <p className="text-base font-bold text-gray-900 mb-1.5"><span className="text-red-600">3.</span> ความเกี่ยวข้องของข้อมูล</p>
                    <p className="text-[15px] text-gray-600 leading-relaxed">
                      ของที่ซื้อโดยระบุทะเบียนรถ <span className="font-semibold text-gray-800">ต้องถูกเบิกไปติดตั้งกับรถคันนั้น</span> — ค้างไว้ = ทุนจม เสี่ยงสูญหาย และมักตามด้วยการซื้อซ้ำ
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 p-4">
                    <p className="text-base font-bold text-gray-900 mb-1.5"><span className="text-red-600">4.</span> สูตร Baseline</p>
                    {stat && (
                      <p className="text-[15px] text-gray-600 leading-relaxed">
                        เป้าหมาย = มูลค่าค้างเกิน {KPI_AGE_DAYS} วัน <span className="font-bold text-red-600">≤ {baht(KPI_MAX_VALUE)}</span><br />
                        ค่าจริง = <span className="font-bold text-gray-900">{baht(stat.current)}</span> · X̄ ย้อนหลัง {baht(stat.avg)}<br />
                        SD = {baht(stat.sd)} · ต่ำสุด {baht(stat.min)} / สูงสุด {baht(stat.max)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Definition + trust */}
                <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
                  <div className="rounded-xl bg-gray-50 p-4">
                    <p className="text-base font-bold text-gray-900 mb-2">นิยามการวัด (Measurement Definition)</p>
                    <ul className="text-[15px] text-gray-600 leading-relaxed space-y-1.5">
                      <li><span className="font-semibold text-gray-800">วัดอะไร:</span> ใบรับ (DD) ที่ยังไม่ถูกใบเบิก (WD) ตัดออกตาม FIFO — เฉพาะของที่ระบุทะเบียนรถ ไม่รวมค่าแรงและสต็อกกลาง</li>
                      <li><span className="font-semibold text-gray-800">ทำไมต้องเก็บ:</span> ของที่ซื้อเพื่อรถคันหนึ่งแล้วไม่ถูกเบิก = เงินจม เสี่ยงสูญหาย</li>
                      <li><span className="font-semibold text-gray-800">วัดอย่างไร:</span> มูลค่าของที่ค้างเกิน {KPI_AGE_DAYS} วัน ณ สิ้นเดือน</li>
                      <li><span className="font-semibold text-gray-800">ใช้ทำอะไรต่อ:</span> เกิน {STALE_DAYS} วันตามหาสาเหตุ · เกิน {KPI_AGE_DAYS} วันตัดสินใจคืนผู้ขาย/โอนสต็อกกลาง/ใช้กับรถคันอื่น</li>
                    </ul>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-4">
                    <p className="text-base font-bold text-gray-900 mb-2">ความน่าเชื่อถือและเจ้าของข้อมูล</p>
                    <ul className="text-[15px] text-gray-600 leading-relaxed space-y-1.5">
                      <li><span className="font-semibold text-gray-800">ที่มา:</span> ATMS → MongoDB ซิงค์อัตโนมัติรายวัน · Mena-WMS คำนวณ FIFO สด</li>
                      <li><span className="font-semibold text-gray-800">ความน่าเชื่อถือ:</span> สูง — ทุกแถวมาจากเอกสารจริง (DD / WD / PR / PO) ไม่มีการกรอกมือ ตรวจย้อนกลับได้ถึงใบต้นทาง</li>
                      <li><span className="font-semibold text-gray-800">ข้อจำกัด:</span> เริ่มนับที่ {data?.startYm ?? "2026-01"} ของที่รับก่อนหน้านั้นไม่ปรากฏ{data && <> — ยอดเบิก {data.dataQuality.unmatchedIssueQty.toLocaleString()} หน่วยหาใบต้นทางไม่พบ</>}</li>
                      <li><span className="font-semibold text-gray-800">เจ้าของข้อมูล:</span> ทีมจัดซื้อและยานยนต์ (Procurement &amp; Automotive)</li>
                    </ul>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-gray-100 pt-3 mt-4">
                  <p className="text-sm text-gray-400">ที่มา: ATMS stock movement × Mena-WMS • เอกสารกำกับตัวชี้วัด</p>
                  <p className="text-sm text-gray-400">
                    สร้างเมื่อ {new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
