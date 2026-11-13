"use client"

// กราฟแนวโน้มรายวันย้อน 30 วัน — ยางเกิน/ถึงกำหนด (แท่งซ้อน) + เส้นเฉลี่ยเคลื่อนที่ 7 วัน + เส้นประเฉลี่ยทั้งช่วง
// ที่อยากเห็นคือ "ยางที่ต้องเปลี่ยนลดลงไหม" จึงสรุปเทียบ 7 วันแรกกับ 7 วันล่าสุดไว้บนหัวกราฟ
// ข้อมูล = ยอดถ่ายรายวันจาก tire_due_daily — เริ่มเก็บ 13 พ.ย. 2569 ก่อนหน้านั้นไม่มีข้อมูล
// (API ยังส่ง requests = งานค้างจากคำขอ มาด้วย — ผู้ใช้ให้เอาแท็บนั้นออกไปก่อน 2026-11-13 ยังไม่ใช้บนหน้า)

import { useEffect, useMemo, useState } from "react"
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { RefreshCw, TrendingDown, TrendingUp } from "lucide-react"
import { zoneOf } from "@/components/tire/due-dashboard"
import { NONE, passes, type Selection } from "@/components/tire/dashboard-shared"
import { card, fmtNum, fontHead, fontThai } from "@/components/tire/shared"

type TrendPayload = {
  days: string[]
  requests: { dict: string[]; items: [number, number, number, number, number, number, "h" | "t", string, string, string][] }
  snapshots: { date: string; groups: [string, string, string, string, string, string, string, number][] }[]
}

// ชุดสีเดียวกับกราฟใน "ยางถึงกำหนดเปลี่ยน" (ผ่าน validator แล้ว)
const SERIES = [
  { key: "a", label: "เกินกำหนด", color: "#b91c1c" },
  { key: "b", label: "ถึงกำหนด",  color: "#f97316" },
]
const AVG_COLOR = "#14271C"

const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`
const thDate = (d: string) =>
  new Date(`${d}T12:00:00+07:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" })

type Point = { day: string; label: string; a: number | null; b: number | null; total: number | null; ma: number | null }

export function TireTrend({ branchFilter, sel, reloadKey }: { branchFilter: string; sel: Selection; reloadKey: number }) {
  const reqKey = `${branchFilter}|${reloadKey}`
  const [res, setRes] = useState<{ key: string; data: TrendPayload | null }>({ key: "", data: null })
  const loading = res.key !== reqKey

  useEffect(() => {
    let cancelled = false
    const qs = branchFilter ? `?branch=${encodeURIComponent(branchFilter)}` : ""
    const done = (d: TrendPayload | null) => { if (!cancelled) setRes({ key: reqKey, data: d }) }
    fetch(`/api/tire-dashboard/trend${qs}`)
      .then((r) => r.json())
      .then((d) => done(d && Array.isArray(d.days) ? d : null))
      .catch(() => done(null))
    return () => { cancelled = true }
  }, [branchFilter, reqKey])

  const data = res.data

  // กราฟใช้ Slicer เฉพาะมิติที่ยอดรายวันเก็บไว้ — ไม่มี งานติดตาม/แหล่งระยะ
  const points = useMemo<Point[]>(() => {
    if (!data) return []
    const keep = (branch: string, unit: string, plant0: string, fleet0: string, vtype0: string, product0: string) => {
      const plant = plant0 || NONE.plant
      return passes(sel, "branch", branch) && passes(sel, "unit", unit === "t" || unit === "trailer" ? "trailer" : "head")
        && passes(sel, "zone", zoneOf(plant)) && passes(sel, "plant", plant)
        && passes(sel, "fleet", fleet0 || NONE.fleet) && passes(sel, "vtype", vtype0 || NONE.vtype)
        && passes(sel, "product", product0 || NONE.product)
    }

    const byDay = new Map(data.snapshots.map((s) => [s.date, s.groups]))
    const raw = data.days.map((day) => {
      const groups = byDay.get(day)
      if (!groups) return { day, a: null, b: null }
      let a = 0, b = 0
      for (const g of groups) {
        if (!keep(g[0], g[1], g[2], g[3], g[4], g[5]) || !passes(sel, "level", g[6])) continue
        if (g[6] === "over") a += g[7]
        else if (g[6] === "due") b += g[7]
      }
      return { day, a, b }
    })

    return raw.map((p, i) => {
      const total = p.a == null ? null : p.a + (p.b ?? 0)
      // เฉลี่ยเคลื่อนที่ 7 วัน — นับเฉพาะวันที่มีข้อมูล (โหมดยอดรายวันเพิ่งเริ่มเก็บ)
      const win = raw.slice(Math.max(0, i - 6), i + 1).filter((x) => x.a != null)
      const ma = total == null || win.length === 0 ? null
        : win.reduce((s, x) => s + (x.a ?? 0) + (x.b ?? 0), 0) / win.length
      return { day: p.day, label: dm(p.day), a: p.a, b: p.b, total, ma: ma == null ? null : Math.round(ma * 10) / 10 }
    })
  }, [data, sel])

  const stat = useMemo(() => {
    const has = points.filter((p) => p.total != null)
    if (has.length === 0) return null
    const avg = has.reduce((s, p) => s + p.total!, 0) / has.length
    const first = has.slice(0, 7), last = has.slice(-7)
    const mean = (xs: Point[]) => xs.reduce((s, p) => s + p.total!, 0) / xs.length
    const change = has.length >= 8 && mean(first) > 0 ? ((mean(last) - mean(first)) / mean(first)) * 100 : null
    return { avg, today: has[has.length - 1].total!, change, since: has[0].day, days: has.length }
  }, [points])

  const series = SERIES
  const noSnapshotYet = (stat?.days ?? 0) < 2

  return (
    <section className={card + " mb-4 overflow-hidden"}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#E4EEE8] px-3 py-2 dark:border-white/8">
        <h2 className="text-[14px] text-[#14271C] dark:text-white" style={fontHead}>แนวโน้มยางเกิน/ถึงกำหนด รายวัน</h2>
        <span className="text-[11px] text-[#9AA8A0]" style={fontThai}>ย้อนหลัง 30 วัน · ตามตัวกรองด้านบน</span>

        {stat && (
          <dl className="ml-auto flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12px]" style={fontThai}>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-[#6B7C72] dark:text-gray-400">วันนี้</dt>
              <dd className="text-[16px] text-[#14271C] tabular-nums dark:text-white" style={fontHead}>{fmtNum(stat.today)}</dd>
              <dd className="text-[11px] text-[#9AA8A0]">เส้น</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-[#6B7C72] dark:text-gray-400">เฉลี่ยช่วงนี้</dt>
              <dd className="font-semibold tabular-nums text-[#14271C] dark:text-white">{fmtNum(Math.round(stat.avg))}</dd>
            </div>
            {stat.change != null && (
              <div className="flex items-baseline gap-1.5" title="เฉลี่ย 7 วันล่าสุด เทียบ 7 วันแรกของช่วง">
                <dt className="text-[#6B7C72] dark:text-gray-400">7 วันล่าสุด vs 7 วันแรก</dt>
                <dd className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${stat.change <= 0 ? "text-[#17793F] dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {stat.change <= 0 ? <TrendingDown size={13} /> : <TrendingUp size={13} />}
                  {stat.change <= 0 ? "ลดลง" : "เพิ่มขึ้น"} {Math.abs(stat.change).toFixed(1)}%
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <div className="px-2 pb-2 pt-3">
        {loading && !data ? (
          <div className="flex h-[240px] items-center justify-center text-[12px] text-[#9AA8A0]" style={fontThai}>
            <RefreshCw size={14} className="mr-1.5 animate-spin" /> กำลังโหลดกราฟ...
          </div>
        ) : !data ? (
          <div className="flex h-[240px] items-center justify-center text-[12px] text-[#9AA8A0]" style={fontThai}>โหลดข้อมูลกราฟไม่สำเร็จ</div>
        ) : (
          <div className="relative h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke="#E4EEE8" />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#D9E3DD" }} interval="preserveStartEnd" minTickGap={14}
                  tick={{ fontSize: 11, fill: "#6B7C72" }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40}
                  tick={{ fontSize: 11, fill: "#6B7C72" }} />
                <Tooltip
                  cursor={{ fill: "rgba(27,140,75,.06)" }}
                  content={({ active, payload }) => {
                    const p = active && payload?.[0]?.payload as Point | undefined
                    if (!p) return null
                    return (
                      <div className="rounded-[8px] border border-[#D9E3DD] bg-white px-3 py-2 text-[12px] shadow-sm dark:border-white/10 dark:bg-[#151a10]" style={fontThai}>
                        <p className="mb-1 font-semibold text-[#14271C] dark:text-white">{thDate(p.day)}</p>
                        {p.total == null ? <p className="text-[#9AA8A0]">ยังไม่มีข้อมูลวันนี้</p> : (
                          <>
                            {series.map((s) => (
                              <p key={s.key} className="flex items-center gap-1.5 text-[#3C4B42] dark:text-gray-300">
                                <span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
                                {s.label} <b className="ml-auto pl-3 tabular-nums">{fmtNum(p[s.key as "a" | "b"])}</b>
                              </p>
                            ))}
                            <p className="mt-1 flex border-t border-[#E4EEE8] pt-1 text-[#14271C] dark:border-white/10 dark:text-white">
                              รวม <b className="ml-auto pl-3 tabular-nums">{fmtNum(p.total)}</b>
                            </p>
                            {p.ma != null && (
                              <p className="flex text-[#6B7C72] dark:text-gray-400">เฉลี่ย 7 วัน <span className="ml-auto pl-3 tabular-nums">{p.ma.toLocaleString("th-TH")}</span></p>
                            )}
                          </>
                        )}
                      </div>
                    )
                  }}
                />
                {series.map((s, i) => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} stackId="x" fill={s.color} maxBarSize={22}
                    radius={i === series.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />
                ))}
                <Line dataKey="ma" name="เฉลี่ย 7 วัน" type="monotone" stroke={AVG_COLOR} strokeWidth={2} dot={false}
                  connectNulls isAnimationActive={false} />
                {stat && (
                  <ReferenceLine y={stat.avg} stroke="#9AA8A0" strokeDasharray="4 4"
                    label={{ value: `เฉลี่ย ${fmtNum(Math.round(stat.avg))}`, position: "insideTopRight", fontSize: 10.5, fill: "#6B7C72" }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            {noSnapshotYet && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="rounded-[8px] border border-[#D9E3DD] bg-white/95 px-3 py-2 text-center text-[12px] text-[#6B7C72] dark:border-white/10 dark:bg-[#151a10]/95 dark:text-gray-300" style={fontThai}>
                  เริ่มเก็บยอดรายวันเมื่อ {stat ? thDate(stat.since) : "วันนี้"} — กราฟจะเต็ม 30 วันภายในหนึ่งเดือน
                </p>
              </div>
            )}
          </div>
        )}

        {/* คำอธิบายสี — วางใต้กราฟ อ่านคู่กับแท่งได้ทันที */}
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-[11px] text-[#6B7C72] dark:text-gray-400" style={fontThai}>
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: s.color }} /> {s.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: AVG_COLOR }} /> เฉลี่ยเคลื่อนที่ 7 วัน</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-[#9AA8A0]" /> เฉลี่ยทั้งช่วง</span>
          <span className="ml-auto text-[#9AA8A0]">
            ยอดถ่ายจากรอบคำนวณระยะของแต่ละวัน · ไม่ใช้ตัวกรองงานติดตาม/แหล่งระยะ
          </span>
        </div>
      </div>
    </section>
  )
}
