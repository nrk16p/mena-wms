"use client"

// ===========================================================================
// แท็บ "ยางถึงกำหนดเปลี่ยน"
// ===========================================================================
// แท็บอื่นของหน้ายางตอบว่า "ตอนนี้เกิดอะไรขึ้น" (รถคันไหนมียางอะไร ใครขอเปลี่ยน)
// แท็บนี้ตอบคำถามที่ต้องรู้ "ก่อน" ยางหมด: เส้นไหนใกล้ครบระยะที่กำหนดแล้วบ้าง
// เพื่อสั่งซื้อ/นัดเข้าอู่ทัน ไม่ใช่รอให้คนขับแจ้งตอนยางระเบิด
//
// ตัวเลขทั้งหน้ามาจาก snapshot `tire_distance` ที่คำนวณรอบกลางคืน (ดู lib/tire-distance.ts)
// ไม่ได้คำนวณสดตอนเปิดหน้า — ปุ่ม "คำนวณใหม่" มีไว้สำหรับตอนเพิ่งแก้ระยะกำหนดที่ /tire/master

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle, BellOff, BellRing, ChevronRight, RefreshCw, Search, Settings2, Truck,
} from "lucide-react"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"
import {
  SOURCE_LABEL, dueBarCls, dueChipCls,
  type DistanceSource, type DueLevel,
} from "@/lib/tire-due"
import {
  StatCard, branchChipCls, branchLabel, btnSmall, card,
  fmtDateOnly, fmtNum, fontThai, inp, tdCls, thCls, theadCls,
} from "@/components/tire/shared"

type DueRow = {
  _id:          string
  branch:       string
  plate:        string
  unit:         "head" | "trailer"
  serialNo:     string
  tirePosition: string
  product:      string
  changeIn:     string | null
  kmUsed:       number
  source:       DistanceSource
  partial:      boolean
  specDistance: number
  usedPct:      number | null
  level:        DueLevel
  snoozedUntil: string | null
}

type Summary = Record<string, number>

// กลุ่มที่กดดูได้ — 3 กลุ่มแรกคือของที่ต้องลงมือ ที่เหลือเป็นของที่ยังใช้ไม่ได้/ไม่เกี่ยว
const GROUPS = [
  { key: "over",       label: "เกินกำหนด",          tone: "red"    as const, hint: "ใช้ระยะครบแล้ว ควรเปลี่ยนทันที" },
  { key: "due",        label: "ถึงกำหนดเปลี่ยน",     tone: "orange" as const, hint: "ใช้ไปแล้ว 90% ขึ้นไป วางแผนเปลี่ยนได้" },
  { key: "warn",       label: "เฝ้าระวัง",           tone: "amber"  as const, hint: "ใช้ไปแล้ว 80% ขึ้นไป" },
]

const OTHER_GROUPS = [
  { key: "nospec",     label: "ยังไม่ตั้งระยะกำหนด", hint: "รู้ระยะที่วิ่งแล้ว แต่รุ่นยางยังไม่มีระยะมาตรฐาน" },
  { key: "nodistance", label: "คำนวณระยะไม่ได้",    hint: "ไม่มีวันเปลี่ยนเข้า หรือทะเบียนไม่มีทั้ง GPS และค่าเที่ยว" },
  { key: "spare",      label: "ยางอะไหล่",          hint: "ยังไม่ได้ใช้งาน ไม่นับระยะ" },
  { key: "snoozed",    label: "พักการแจ้งเตือน",     hint: "เส้นที่กด \"ไม่ต้องแจ้ง\" ไว้" },
]

export function TireDuePage({ branchFilter, onOpenVehicle }: {
  branchFilter: string
  onOpenVehicle: (v: { branch: string; plate: string }) => void
}) {
  const [rows, setRows]       = useState<DueRow[]>([])
  const [summary, setSummary] = useState<Summary>({})
  const [meta, setMeta]       = useState<{ computedAt: string | null; dataThrough: string | null }>({ computedAt: null, dataThrough: null })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [group, setGroup]     = useState("alert")
  const [unit, setUnit]       = useState<"head" | "trailer" | "all">("all")
  const [q, setQ]             = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams({ group })
    if (branchFilter) qs.set("branch", branchFilter)
    if (unit !== "all") qs.set("unit", unit)
    if (q) qs.set("q", q)
    try {
      const d = await fetch(`/api/tire-due?${qs}`).then((r) => r.json())
      setRows(Array.isArray(d.items) ? d.items : [])
      setSummary(d.summary ?? {})
      setMeta({ computedAt: d.computedAt ?? null, dataThrough: d.dataThrough ?? null })
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [branchFilter, group, unit, q])

  useEffect(() => { load() }, [load])

  async function recalc() {
    const { isConfirmed } = await swalConfirm(
      "คำนวณระยะใหม่?",
      "ดึงระยะทางล่าสุดจาก GPS และค่าเที่ยวมาคำนวณใหม่ทั้งฟลีต ใช้เวลาราว 1–2 นาที",
    )
    if (!isConfirmed) return
    setBusy(true)
    try {
      const res = await fetch("/api/tire-due", { method: "POST" })
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error ?? "คำนวณไม่สำเร็จ")
      swalToast("success", `คำนวณเสร็จ ${fmtNum(d.computed)} เส้น`)
      await load()
    } catch (e) {
      swalError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function snooze(row: DueRow, on: boolean) {
    const res = await fetch(`/api/tire-due/${row._id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ snooze: on }),
    })
    if (!res.ok) { swalError("บันทึกไม่สำเร็จ"); return }
    swalToast("success", on ? "พักการแจ้งเตือน 30 วัน" : "เปิดการแจ้งเตือนอีกครั้ง")
    load()
  }

  const alertTotal = (summary.over ?? 0) + (summary.due ?? 0)
  const showPct    = group !== "nodistance" && group !== "nospec"

  return (
    <div>
      {/* แถบบอกความสดของข้อมูล — ตัวเลขทั้งหน้ามาจาก snapshot ต้องรู้ว่าเก่าแค่ไหน */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-[#6B7C72] dark:text-gray-400" style={fontThai}>
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle size={13} className="text-[#E8A317]" />
          ระยะทางจาก GPS ก่อน ถ้าไม่มีใช้ค่าเที่ยว — เทียบกับระยะที่กำหนดของรุ่นยาง
        </span>
        {meta.dataThrough && <span>ข้อมูลระยะถึง {fmtDateOnly(meta.dataThrough)}</span>}
        {meta.computedAt  && <span>คำนวณล่าสุด {fmtDateOnly(meta.computedAt)}</span>}
        <button type="button" onClick={recalc} disabled={busy}
          className={btnSmall + " ml-auto inline-flex items-center gap-1 border border-[#EEF2F0] dark:border-white/10 text-[#14271C] dark:text-white disabled:opacity-50"}>
          <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
          {busy ? "กำลังคำนวณ..." : "คำนวณใหม่"}
        </button>
      </div>

      {/* การ์ดสรุป — คลิกเพื่อกรอง */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard
          label="ต้องจัดการ" value={fmtNum(alertTotal)} tone="red" caption="เกิน + ถึงกำหนด"
          active={group === "alert"} onClick={() => setGroup("alert")}
        />
        {GROUPS.map((g) => (
          <StatCard
            key={g.key} label={g.label} value={fmtNum(summary[g.key] ?? 0)} tone={g.tone} caption={g.hint}
            active={group === g.key} onClick={() => setGroup(g.key)}
          />
        ))}
      </div>

      {/* กลุ่มรอง — ของที่ยังคำนวณไม่ได้ / ไม่เกี่ยว */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {OTHER_GROUPS.map((g) => (
          <button
            key={g.key} type="button" title={g.hint} onClick={() => setGroup(g.key)}
            className={[
              "rounded-[9px] border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              group === g.key
                ? "border-[#14271C]/25 bg-[#F6FAF7] text-[#14271C] dark:border-white/25 dark:bg-white/5 dark:text-white"
                : "border-[#EEF2F0] text-[#6B7C72] hover:bg-gray-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5",
            ].join(" ")}
            style={fontThai}
          >
            {g.label} <span className="text-[#9AA8A0]">{fmtNum(summary[g.key] ?? 0)}</span>
          </button>
        ))}
        {group === "nospec" && (
          <Link href="/tire/master" className={btnSmall + " inline-flex items-center gap-1 bg-[#1B8C4B] text-white"} style={fontThai}>
            <Settings2 size={11} /> ไปตั้งระยะกำหนด
          </Link>
        )}
      </div>

      {/* ตัวกรอง */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-[11px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] p-0.5">
          {([
            { key: "all",     label: "ทั้งหมด" },
            { key: "head",    label: "หัว" },
            { key: "trailer", label: "หาง" },
          ] as const).map((o) => (
            <button
              key={o.key} type="button" onClick={() => setUnit(o.key)}
              className={[
                "rounded-[9px] px-3 py-1 text-[12px] font-medium transition-colors",
                unit === o.key ? "bg-[#1B8C4B] text-white" : "text-[#6B7C72] dark:text-gray-400 hover:bg-[#F0FDF4] dark:hover:bg-white/5",
              ].join(" ")}
              style={fontThai}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto min-w-[220px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาทะเบียนรถ..." className={inp + " w-full pl-8"} />
        </div>
      </div>

      {/* ตาราง */}
      <div className={card + " overflow-hidden"}>
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full">
            <thead className={theadCls}>
              <tr>
                <th className={thCls} style={fontThai}>ทะเบียน</th>
                <th className={thCls} style={fontThai}>ตำแหน่ง</th>
                <th className={thCls} style={fontThai}>รุ่นยาง</th>
                <th className={thCls} style={fontThai}>เปลี่ยนเข้า</th>
                <th className={thCls + " text-right"} style={fontThai}>วิ่งไปแล้ว</th>
                <th className={thCls + " text-right"} style={fontThai}>ระยะกำหนด</th>
                {showPct && <th className={thCls} style={fontThai}>ใช้ไป</th>}
                <th className={thCls} style={fontThai}>แหล่ง</th>
                <th className={thCls}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF2F0] dark:divide-white/8">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-16 text-center text-sm text-gray-400" style={fontThai}>กำลังโหลด...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-16 text-center text-sm text-gray-400" style={fontThai}>ไม่มีรายการในกลุ่มนี้</td></tr>
              ) : rows.map((r) => {
                const snoozedOn = !!r.snoozedUntil && new Date(r.snoozedUntil) > new Date()
                return (
                  <tr key={r._id} className={"hover:bg-[#F6FAF7] dark:hover:bg-white/5" + (snoozedOn ? " opacity-55" : "")}>
                    <td className={tdCls}>
                      <button type="button" onClick={() => onOpenVehicle({ branch: r.branch, plate: r.plate })}
                        className="inline-flex items-center gap-1.5 font-semibold text-[#14271C] dark:text-white hover:text-[#1B8C4B]">
                        <Truck size={12} className="text-[#9AA8A0]" />
                        {r.plate}
                      </button>
                      <span className={`ml-1.5 rounded px-1 py-0.5 text-[9.5px] ${branchChipCls(r.branch)}`} style={fontThai}>
                        {branchLabel(r.branch)}
                      </span>
                    </td>
                    <td className={tdCls} style={fontThai}>{r.tirePosition || "—"}</td>
                    <td className={tdCls + " max-w-[240px] truncate"} style={fontThai} title={`${r.product}${r.serialNo ? ` · ${r.serialNo}` : ""}`}>
                      {r.product || "—"}
                      {r.serialNo && <span className="ml-1.5 font-mono text-[10.5px] text-[#9AA8A0]">{r.serialNo}</span>}
                    </td>
                    <td className={tdCls}>{fmtDateOnly(r.changeIn)}</td>
                    <td className={tdCls + " text-right font-mono"}>{r.kmUsed ? fmtNum(r.kmUsed) : "—"}</td>
                    <td className={tdCls + " text-right font-mono"}>{r.specDistance ? fmtNum(r.specDistance) : "—"}</td>
                    {showPct && (
                      <td className={tdCls}>
                        {r.usedPct == null ? "—" : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#EEF2F0] dark:bg-white/10">
                              <div className={`h-full rounded-full ${dueBarCls[r.level]}`} style={{ width: `${Math.min(100, r.usedPct)}%` }} />
                            </div>
                            <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${dueChipCls[r.level]}`}>
                              {r.usedPct}%
                            </span>
                          </div>
                        )}
                      </td>
                    )}
                    <td className={tdCls} style={fontThai}>
                      {SOURCE_LABEL[r.source]}
                      {/* ยางที่ใส่ก่อนวันที่ต้นทางเริ่มเก็บข้อมูล = ระยะที่ได้ต่ำกว่าจริง ต้องบอกไว้ */}
                      {r.partial && <span className="ml-1 text-[10px] text-[#E8A317]" title="ยางใส่ก่อนช่วงที่มีข้อมูล — ระยะจริงมากกว่านี้">(ไม่ครบ)</span>}
                    </td>
                    <td className={tdCls + " text-right"}>
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => snooze(r, !snoozedOn)}
                          title={snoozedOn ? "เปิดการแจ้งเตือนอีกครั้ง" : "พักการแจ้งเตือน 30 วัน"}
                          className={btnSmall + " inline-flex items-center gap-1 border border-[#EEF2F0] dark:border-white/10"}>
                          {snoozedOn ? <BellRing size={11} /> : <BellOff size={11} />}
                        </button>
                        <button type="button" onClick={() => onOpenVehicle({ branch: r.branch, plate: r.plate })}
                          className={btnSmall + " inline-flex items-center gap-0.5 border border-[#EEF2F0] dark:border-white/10 text-[#1B8C4B]"}
                          style={fontThai}>
                          เปิดหน้ารถ <ChevronRight size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {rows.length >= 1000 && (
        <p className="mt-2 text-[11px] text-[#9AA8A0]" style={fontThai}>
          แสดง 1,000 แถวแรก — ใช้ตัวกรองสาขา/หัว-หาง หรือค้นหาทะเบียนเพื่อดูให้แคบลง
        </p>
      )}
    </div>
  )
}
