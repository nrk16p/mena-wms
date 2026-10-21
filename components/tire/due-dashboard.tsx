"use client"

// ===========================================================================
// แดชบอร์ด "ยางถึงกำหนดเปลี่ยน"
// ===========================================================================
// เดิมฝ่ายจัดซื้อส่งออก Excel จากแท็บนี้ แล้วทำ Pivot เองทุกเดือน 2 แบบ:
//   "สรุปยาง" = โซน › แพล้นท์ › เบอร์รถ × รุ่นยาง  → ใบสรุปยางที่ต้องสั่งซื้อประจำเดือน
//   "Pivot1"  = แพล้นท์ › เบอร์รถ × รุ่นยาง (กรองเฉพาะแพล้นท์ที่จะส่งเข้าศูนย์เดียวกัน)
// หน้านี้ทำ pivot ทั้งสองแบบให้จากรายการที่โหลดอยู่ + กราฟให้เห็นภาพรวมก่อนลงรายละเอียด
//
// โซน: tire_distance ไม่มีช่องโซน — คำนวณจากที่ตั้งแพล้นท์ (data/plant-locations.json)
// เป็นจังหวัด และแยก กทม. ฝั่งธนบุรีออกตามเขต ให้ใกล้กับที่ฝ่ายจัดซื้อแบ่งเองใน Excel

import { useMemo, useState } from "react"
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { ChevronRight, FileSpreadsheet, X } from "lucide-react"
import plantLoc from "@/data/plant-locations.json"
import { bkkToday } from "@/lib/bkk-time"
import { downloadExcelTable, type ExcelCol, type ExcelRow } from "@/lib/excel-table"
import { swalError, swalToast } from "@/lib/swal"
import { DUE_LABEL, type DueLevel } from "@/lib/tire-due"
import {
  StatCard, card, fmtNum, fontHead, fontThai, inp, tdCls, thCls, theadCls,
} from "@/components/tire/shared"

export type DashRow = {
  branch:   string
  plate:    string
  fleetNo:  string
  fleet:    string
  plant:    string
  product:  string
  level:    DueLevel
}

// ── โซนจากที่ตั้งแพล้นท์ ────────────────────────────────────────────────────
const PLANTS = (plantLoc as unknown as { plants: Record<string, { province?: string; district?: string }> }).plants
const THONBURI = new Set([
  "ตลิ่งชัน", "ภาษีเจริญ", "บางขุนเทียน", "ราษฎร์บูรณะ", "บางแค", "ธนบุรี", "คลองสาน", "บางกอกน้อย",
  "บางกอกใหญ่", "จอมทอง", "ทวีวัฒนา", "ทุ่งครุ", "บางพลัด", "หนองแขม", "บางบอน",
])
// แพล้นท์ที่ plant-locations ยังจับพิกัดไม่ได้ (ราว 18% ของยางในไฟล์ ต.ค. 2569)
// ใช้จังหวัดตามที่ฝ่ายจัดซื้อแบ่งไว้ใน Excel — ถ้าเติมพิกัดใน json แล้ว ค่าใน json ชนะ
const ZONE_FALLBACK: Record<string, string> = {
  "TDM บางบัว": "สมุทรปราการ", "เอเชีย IE": "สมุทรปราการ",
  "พระราม 4/3": "กทม.", "Ladkrabang": "กทม.", "นวมินทร์ 2": "กทม.", "รัชดา2": "กทม.", "ศูนย์วิจัย": "กทม.",
  "MKM": "ฉะเชิงเทรา", "KN7.5-DR": "ฉะเชิงเทรา",
  "KP ขอนแก่น 2": "ขอนแก่น", "จอดอู่พะเยา": "พะเยา", "อ้อมน้อย": "สมุทรสาคร",
  "Amata Nakorn3": "ชลบุรี", "บางละมุง": "ชลบุรี", "นิคมพัฒนา 3": "ระยอง",
}
const NO_ZONE  = "ไม่ระบุโซน"
const NO_PLANT = "ไม่ระบุแพล้นท์"

function zoneOf(plant: string): string {
  const p = PLANTS[plant]
  if (!p?.province && ZONE_FALLBACK[plant]) return ZONE_FALLBACK[plant]
  if (!p?.province) return NO_ZONE
  if (p.province === "กรุงเทพมหานคร") return THONBURI.has(p.district ?? "") ? "กทม.ฝั่งธนบุรี" : "กทม."
  return p.province
}

// ── สีสถานะ — ผ่าน validator แล้ว (แดง/ส้ม/เหลืองชิดกันเกินจนแยกไม่ออก จึงถ่างความสว่าง) ──
const LEVELS: { key: DueLevel; color: string }[] = [
  { key: "over", color: "#b91c1c" },
  { key: "due",  color: "#f97316" },
  { key: "warn", color: "#fcd34d" },
]

type Facets = { zone: string; plant: string; fleet: string; product: string }
const EMPTY: Facets = { zone: "", plant: "", fleet: "", product: "" }

type Enriched = DashRow & { zone: string; plantName: string; productName: string }

const vehicleKey = (r: DashRow) => `${r.branch}|${r.plate}`
const byCountThenName = <T extends { name: string; total: number }>(a: T, b: T) =>
  b.total - a.total || a.name.localeCompare(b.name, "th")

export function TireDueDashboard({ rows, loading, scopeLabel, groupLabel, onOpenVehicle }: {
  rows:          DashRow[]
  loading:       boolean
  scopeLabel:    string
  groupLabel:    string
  onOpenVehicle: (v: { branch: string; plate: string }) => void
}) {
  const [f, setF]       = useState<Facets>(EMPTY)
  const [mode, setMode] = useState<"zone" | "plant">("zone")
  const [depth, setDepth] = useState<0 | 1 | 2>(1)

  const set = (patch: Partial<Facets>) => setF((prev) => ({ ...prev, ...patch }))

  // ชื่อรุ่นจากต้นทางบางเส้นมีช่องว่างท้าย ("ยางเรเดียล 11R22.5 ") — ต้องตัดก่อน ไม่งั้นแตกเป็นสองคอลัมน์
  const all = useMemo<Enriched[]>(() => rows.map((r) => {
    const plantName = (r.plant ?? "").trim() || NO_PLANT
    return { ...r, plantName, zone: zoneOf(plantName), productName: (r.product ?? "").trim() || "ไม่ระบุรุ่น" }
  }), [rows])

  // กราฟแต่ละอันไม่กรองด้วยมิติของตัวเอง — จะได้เห็นตัวเลือกอื่นเทียบ แล้วไฮไลต์อันที่เลือก
  const match = (r: Enriched, skip: (keyof Facets)[] = []) =>
    (skip.includes("zone")    || !f.zone    || r.zone        === f.zone) &&
    (skip.includes("plant")   || !f.plant   || r.plantName   === f.plant) &&
    (skip.includes("fleet")   || !f.fleet   || (r.fleet || "ไม่ระบุฟลีท") === f.fleet) &&
    (skip.includes("product") || !f.product || r.productName === f.product)

  const filtered = useMemo(() => all.filter((r) => match(r)), [all, f]) // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo(() => {
    const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, "th"))
    return {
      zone:    uniq(all.map((r) => r.zone)),
      plant:   uniq(all.filter((r) => !f.zone || r.zone === f.zone).map((r) => r.plantName)),
      fleet:   uniq(all.map((r) => r.fleet || "ไม่ระบุฟลีท")),
      product: uniq(all.map((r) => r.productName)),
    }
  }, [all, f.zone])

  // ── ตัวเลขสรุป ──
  const kpi = useMemo(() => {
    const vehicles = new Set(filtered.map(vehicleKey))
    const plants   = new Set(filtered.map((r) => r.plantName))
    const over     = filtered.filter((r) => r.level === "over").length
    return { tires: filtered.length, vehicles: vehicles.size, plants: plants.size, over,
             models: new Set(filtered.map((r) => r.productName)).size }
  }, [filtered])

  // ── ข้อมูลกราฟ: จำนวนเส้นแยกตามระดับ ──
  const stack = (src: Enriched[], keyOf: (r: Enriched) => string) => {
    const m = new Map<string, { name: string; total: number } & Partial<Record<DueLevel, number>>>()
    for (const r of src) {
      const k = keyOf(r)
      const e = m.get(k) ?? { name: k, total: 0, over: 0, due: 0, warn: 0 }
      e[r.level] = (e[r.level] ?? 0) + 1
      e.total++
      m.set(k, e)
    }
    return [...m.values()].sort(byCountThenName)
  }
  const byProduct = useMemo(() => stack(all.filter((r) => match(r, ["product"])), (r) => r.productName), [all, f]) // eslint-disable-line react-hooks/exhaustive-deps
  // เลือกโซนแล้ว กราฟนี้เจาะลงเป็นรายแพล้นท์ในโซนนั้น
  const byArea = useMemo(() => f.zone
    ? stack(all.filter((r) => match(r, ["plant"])), (r) => r.plantName)
    : stack(all.filter((r) => match(r, ["zone", "plant"])), (r) => r.zone),
  [all, f]) // eslint-disable-line react-hooks/exhaustive-deps
  const levelsUsed = LEVELS.filter((l) => all.some((r) => r.level === l.key))

  // ── pivot ──
  const pivot = useMemo(() => buildPivot(filtered, mode), [filtered, mode])
  const maxDepth = mode === "zone" ? 2 : 1
  const shownDepth = Math.min(depth, maxDepth)
  const leafMax = useMemo(() => {
    let mx = 0
    for (const n of pivot.flat) if (n.depth === shownDepth) for (const v of n.counts.values()) mx = Math.max(mx, v)
    return mx
  }, [pivot, shownDepth])

  const activeFilters = (Object.keys(f) as (keyof Facets)[]).filter((k) => f[k])
  const FACET_LABEL: Record<keyof Facets, string> = { zone: "โซน", plant: "แพล้นท์", fleet: "ฟลีท", product: "รุ่นยาง" }

  async function exportPivot() {
    if (filtered.length === 0) { swalError("ไม่มีรายการให้ส่งออก"); return }
    const month = new Date().toLocaleDateString("th-TH", { month: "long", year: "numeric", timeZone: "Asia/Bangkok" })
    const cols: ExcelCol[] = [
      ...(mode === "zone" ? [{ key: "zone", header: "โซน", width: 16 }] : []),
      { key: "plant",   header: "แพล้นท์", width: 22 },
      { key: "fleetNo", header: "เบอร์รถ", width: 10, align: "center" as const },
      { key: "plate",   header: "ทะเบียน", width: 13 },
      ...pivot.products.map((p, i) => ({ key: `p${i}`, header: p.name, width: 14, align: "right" as const, numFmt: "#,##0", wrap: true, group: "รุ่นยาง (เส้น)" })),
      { key: "total",   header: "รวม", width: 9, align: "right" as const, numFmt: "#,##0" },
    ]
    const BOLD = "FF14271C"
    const cellsOf = (n: PivotNode) => Object.fromEntries([
      ...pivot.products.map((p, i) => [`p${i}`, n.counts.get(p.name) || null]),
      ["total", n.total],
    ])
    const boldAll = Object.fromEntries(cols.map((c) => [c.key, BOLD]))
    // ไฟล์ลงถึงรายคันเสมอ (ใช้สั่งของจริง) + บรรทัดรวมท้ายกลุ่มแบบ pivot ของ Excel — ไล่ตามลำดับต้นไม้
    const rowsOut: ExcelRow[] = []
    const walk = (n: PivotNode) => {
      if (!n.children) {
        const [zone, plant] = mode === "zone" ? n.path : ["", n.path[0]]
        rowsOut.push({ cells: { zone, plant, fleetNo: n.fleetNo, plate: n.plate, ...cellsOf(n) } })
        return
      }
      n.children.forEach(walk)
      const first = mode === "zone" && n.depth === 0 ? "zone" : "plant"
      rowsOut.push({
        cells: { ...(mode === "zone" && n.depth === 1 ? { zone: n.path[0] } : {}), [first]: `รวม ${n.name}`, ...cellsOf(n) },
        ink: boldAll,
      })
    }
    pivot.roots.forEach(walk)
    rowsOut.push({
      cells: { [mode === "zone" ? "zone" : "plant"]: "รวมทั้งหมด", ...cellsOf(pivot.grand) },
      tone: "warn", ink: boldAll,
    })

    const filterText = [
      groupLabel, scopeLabel,
      ...activeFilters.map((k) => `${FACET_LABEL[k]}: ${f[k]}`),
    ].join(" · ")
    const n = await downloadExcelTable({
      fileName:  `สรุปยางที่ต้องสั่งซื้อ_${scopeLabel}_${bkkToday()}.xlsx`,
      sheetName: mode === "zone" ? "สรุปยาง" : "แยกแพล้นท์",
      title:     `สรุปรายการยางที่ต้องสั่งซื้อ ประจำเดือน${month}`,
      subtitle:  `${filterText} · ${fmtNum(kpi.tires)} เส้น จากรถ ${fmtNum(kpi.vehicles)} คัน · ส่งออกโดยระบบ MENA WMS`,
      freezeCols: mode === "zone" ? 3 : 2,
      columns: cols,
      rows: rowsOut,
    })
    swalToast("success", `ส่งออก ${fmtNum(n)} แถว`)
  }

  if (loading) {
    return <div className={card + " px-4 py-16 text-center text-sm text-gray-400"} style={fontThai}>กำลังโหลด...</div>
  }
  if (rows.length === 0) {
    return <div className={card + " px-4 py-16 text-center text-sm text-gray-400"} style={fontThai}>ไม่มีรายการในกลุ่มนี้</div>
  }

  return (
    <div className="space-y-4">
      {/* ตัวกรองของแดชบอร์ด — แถวเดียวเหนือกราฟ */}
      <div className="flex flex-wrap items-center gap-2" style={fontThai}>
        <FacetSelect label="โซน" value={f.zone} options={options.zone}
          onChange={(v) => set({ zone: v, plant: "" })} />
        <FacetSelect label="แพล้นท์" value={f.plant} options={options.plant} onChange={(v) => set({ plant: v })} />
        <FacetSelect label="ฟลีท" value={f.fleet} options={options.fleet} onChange={(v) => set({ fleet: v })} />
        <FacetSelect label="รุ่นยาง" value={f.product} options={options.product} onChange={(v) => set({ product: v })} />
        {activeFilters.length > 0 && (
          <button type="button" onClick={() => setF(EMPTY)}
            className="text-[12px] text-[#9AA8A0] underline-offset-4 hover:text-[#14271C] hover:underline dark:hover:text-white">
            ล้างตัวกรอง
          </button>
        )}
        <span className="ml-auto text-[11px] text-[#9AA8A0]">
          จาก &ldquo;{groupLabel}&rdquo; · {scopeLabel} · กดแท่งกราฟหรือแถวในตารางเพื่อเจาะดู
        </span>
      </div>

      {/* ตัวเลขสรุป */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard label="ยางที่ต้องจัดการ" value={fmtNum(kpi.tires)} tone="red" caption="เส้น"
          sub={`เกินกำหนด ${fmtNum(kpi.over)} เส้น`} />
        <StatCard label="รถที่ต้องเข้าเปลี่ยน" value={fmtNum(kpi.vehicles)} caption="คัน"
          sub={kpi.vehicles ? `เฉลี่ย ${(kpi.tires / kpi.vehicles).toFixed(1)} เส้น/คัน` : undefined} />
        <StatCard label="แพล้นท์" value={fmtNum(kpi.plants)} caption="แห่ง" sub="ที่มีรถต้องเปลี่ยนยาง" />
        <StatCard label="รุ่นยาง" value={fmtNum(kpi.models)} caption="รุ่น" sub="ที่ต้องเตรียมของ" />
      </div>

      {/* กราฟ */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="ยางที่ต้องจัดการตามรุ่น"
          sub="จำนวนเส้น · แยกตามระดับ"
          data={byProduct} levels={levelsUsed}
          selected={f.product}
          onPick={(name) => set({ product: f.product === name ? "" : name })}
        />
        <ChartCard
          title={f.zone ? `แยกตามแพล้นท์ · ${f.zone}` : "แยกตามโซน"}
          sub={f.zone ? "กดแท่งเพื่อเลือกแพล้นท์" : "กดแท่งเพื่อเจาะดูแพล้นท์ในโซน"}
          data={byArea} levels={levelsUsed}
          selected={f.zone ? f.plant : f.zone}
          onPick={(name) => f.zone
            ? set({ plant: f.plant === name ? "" : name })
            : set({ zone: name, plant: "" })}
          back={f.zone ? () => set({ zone: "", plant: "" }) : undefined}
        />
      </div>

      {/* ตาราง pivot */}
      <div className={card + " overflow-hidden"}>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#EEF2F0] px-4 py-3 dark:border-white/8">
          <div className="mr-auto">
            <h3 className="text-[14px] text-[#14271C] dark:text-white" style={fontHead}>สรุปรายการยางที่ต้องสั่งซื้อ</h3>
            <p className="text-[11px] text-[#9AA8A0]" style={fontThai}>จำนวนเส้นต่อรุ่นยาง · สีเข้ม = เยอะ</p>
          </div>
          <Segmented
            value={mode} onChange={setMode}
            options={[{ key: "zone", label: "โซน › แพล้นท์" }, { key: "plant", label: "แพล้นท์อย่างเดียว" }]}
          />
          <Segmented
            value={String(shownDepth) as "0" | "1" | "2"}
            onChange={(v) => setDepth(Number(v) as 0 | 1 | 2)}
            options={mode === "zone"
              ? [{ key: "0", label: "โซน" }, { key: "1", label: "แพล้นท์" }, { key: "2", label: "เบอร์รถ" }]
              : [{ key: "0", label: "แพล้นท์" }, { key: "1", label: "เบอร์รถ" }]}
          />
          <button type="button" onClick={exportPivot}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#EEF2F0] px-3 py-1.5 text-[12px] font-medium text-[#14271C] hover:bg-[#F6FAF7] dark:border-white/10 dark:text-white dark:hover:bg-white/5"
            style={fontThai}>
            <FileSpreadsheet size={12} className="text-[#1B8C4B]" /> Excel
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead className={theadCls}>
              <tr>
                <th className={thCls + " sticky left-0 z-20 min-w-[200px] align-bottom bg-[#F6FAF7] dark:bg-[#151a10]"} style={fontThai}>
                  {mode === "zone" ? "โซน › แพล้นท์ › เบอร์รถ" : "แพล้นท์ › เบอร์รถ"}
                </th>
                {pivot.products.map((p) => (
                  <th key={p.name} className="min-w-[84px] max-w-[120px] px-3 py-2.5 text-right align-bottom text-[11px] font-semibold leading-tight text-[#6B7C72] dark:text-gray-400" style={fontThai} title={p.name}>
                    {p.name}
                  </th>
                ))}
                <th className={thCls + " text-right align-bottom"} style={fontThai}>รวม</th>
              </tr>
            </thead>
            <tbody>
              {pivot.flat.filter((n) => n.depth <= shownDepth).map((n) => {
                const isLeafShown = n.depth === shownDepth
                const vehicleRow  = !n.children
                const rowCls = isLeafShown
                  ? "hover:bg-[#F6FAF7] dark:hover:bg-white/5"
                  : "bg-[#F6FAF7] dark:bg-white/[0.04]"
                return (
                  <tr key={n.id} className={rowCls}>
                    <td className={tdCls + " sticky left-0 z-[5] border-b border-[#EEF2F0] dark:border-white/8 " + (isLeafShown ? "bg-white dark:bg-[#151a10]" : "bg-[#F6FAF7] dark:bg-[#1a2014]")}
                      style={{ ...fontThai, paddingLeft: 12 + n.depth * 18 }}>
                      {vehicleRow ? (
                        <button type="button" onClick={() => onOpenVehicle({ branch: n.branch, plate: n.plate })}
                          className="inline-flex items-center gap-1.5 hover:text-[#1B8C4B]">
                          <span className="font-mono font-semibold text-[#14271C] dark:text-white">{n.fleetNo || "—"}</span>
                          <span className="text-[10.5px] text-[#9AA8A0]">{n.plate}</span>
                        </button>
                      ) : (
                        <button type="button"
                          onClick={() => n.depth === 0 && mode === "zone" ? set({ zone: n.name, plant: "" }) : set({ plant: n.name })}
                          className={"inline-flex items-center gap-1 hover:text-[#1B8C4B] " + (isLeafShown ? "font-medium text-[#14271C] dark:text-white" : "font-semibold text-[#14271C] dark:text-white")}
                          title="กรองเฉพาะกลุ่มนี้">
                          {n.name}
                          {!isLeafShown && <span className="ml-1 text-[10.5px] font-normal text-[#9AA8A0]">{fmtNum(n.vehicles)} คัน</span>}
                          <ChevronRight size={11} className="text-[#9AA8A0]" />
                        </button>
                      )}
                    </td>
                    {pivot.products.map((p) => {
                      const v = n.counts.get(p.name) ?? 0
                      const heat = isLeafShown && v > 0 && leafMax > 0 ? 0.06 + 0.34 * (v / leafMax) : 0
                      return (
                        <td key={p.name}
                          className={tdCls + " border-b border-[#EEF2F0] text-right font-mono dark:border-white/8 " + (isLeafShown ? "" : "font-semibold text-[#14271C] dark:text-white")}
                          style={heat ? { backgroundColor: `rgba(27,140,75,${heat.toFixed(3)})` } : undefined}>
                          {v ? fmtNum(v) : <span className="text-[#D5DDD8] dark:text-white/15">·</span>}
                        </td>
                      )
                    })}
                    <td className={tdCls + " border-b border-[#EEF2F0] text-right font-mono font-semibold text-[#14271C] dark:border-white/8 dark:text-white"}>
                      {fmtNum(n.total)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-10">
              <tr className="bg-[#14271C] text-white dark:bg-white dark:text-gray-900">
                <td className="sticky left-0 bg-[#14271C] px-3 py-2 text-[12px] font-semibold dark:bg-white" style={fontThai}>รวมทั้งหมด</td>
                {pivot.products.map((p) => (
                  <td key={p.name} className="px-3 py-2 text-right font-mono text-[12px] font-semibold">{fmtNum(p.total)}</td>
                ))}
                <td className="px-3 py-2 text-right font-mono text-[12px] font-bold">{fmtNum(pivot.grand.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── pivot: ต้นไม้ โซน › แพล้นท์ › รถ (หรือ แพล้นท์ › รถ) ───────────────────────
type PivotNode = {
  id:       string
  name:     string
  depth:    number
  path:     string[]
  counts:   Map<string, number>
  total:    number
  vehicles: number
  children?: PivotNode[]
  branch:   string
  plate:    string
  fleetNo:  string
}

function buildPivot(rows: Enriched[], mode: "zone" | "plant") {
  const node = (id: string, name: string, depth: number, path: string[]): PivotNode =>
    ({ id, name, depth, path, counts: new Map(), total: 0, vehicles: 0, branch: "", plate: "", fleetNo: "" })
  const add = (n: PivotNode, product: string) => {
    n.counts.set(product, (n.counts.get(product) ?? 0) + 1)
    n.total++
  }

  const grand = node("all", "รวม", -1, [])
  const kids  = new Map<PivotNode, Map<string, PivotNode>>()
  const child = (parent: PivotNode, key: string, make: () => PivotNode) => {
    let m = kids.get(parent)
    if (!m) { m = new Map(); kids.set(parent, m) }
    let c = m.get(key)
    if (!c) { c = make(); m.set(key, c) }
    return c
  }
  const productTotals = new Map<string, number>()

  for (const r of rows) {
    productTotals.set(r.productName, (productTotals.get(r.productName) ?? 0) + 1)
    add(grand, r.productName)
    const groupPath = mode === "zone" ? [r.zone, r.plantName] : [r.plantName]
    let parent = grand
    groupPath.forEach((name, i) => {
      const path = groupPath.slice(0, i + 1)
      parent = child(parent, name, () => node(path.join("›"), name, i, path))
      add(parent, r.productName)
    })
    const vk = vehicleKey(r)
    const v = child(parent, vk, () => {
      const n = node(`${parent.id}›${vk}`, r.fleetNo || r.plate, groupPath.length, groupPath)
      n.branch = r.branch; n.plate = r.plate; n.fleetNo = r.fleetNo
      return n
    })
    if (!v.fleetNo && r.fleetNo) v.fleetNo = r.fleetNo
    add(v, r.productName)
  }

  // กลุ่มเรียงตามจำนวนเส้นมากก่อน (ของที่ต้องสั่งเยอะขึ้นก่อน) · รถเรียงตามเบอร์รถ
  const finish = (n: PivotNode): number => {
    const m = kids.get(n)
    if (!m) return 1
    const list = [...m.values()]
    let vehicles = 0
    for (const c of list) vehicles += finish(c)
    n.vehicles = vehicles
    n.children = list[0]?.plate
      ? list.sort((a, b) => (a.fleetNo || a.plate).localeCompare(b.fleetNo || b.plate, "th", { numeric: true }))
      : list.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "th"))
    return vehicles
  }
  finish(grand)

  const flat: PivotNode[] = []
  const walk = (n: PivotNode) => { flat.push(n); n.children?.forEach(walk) }
  grand.children?.forEach(walk)

  const products = [...productTotals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort(byCountThenName)

  return { roots: grand.children ?? [], flat, products, grand }
}

// ── ชิ้นส่วนย่อย ───────────────────────────────────────────────────────────

type StackDatum = { name: string; total: number } & Partial<Record<DueLevel, number>>

function ChartCard({ title, sub, data, levels, selected, onPick, back }: {
  title:    string
  sub:      string
  data:     StackDatum[]
  levels:   { key: DueLevel; color: string }[]
  selected: string
  onPick:   (name: string) => void
  back?:    () => void
}) {
  const height = Math.max(160, data.length * 30 + 40)
  // ปลายแท่งมนและป้ายยอดรวมอยู่ที่ "ท่อนสุดท้ายที่มีค่า" ของแต่ละแถว — ไม่ใช่ซีรีส์สุดท้ายเสมอไป
  const capOf = (d: StackDatum) => [...levels].reverse().find((l) => (d[l.key] ?? 0) > 0)?.key
  return (
    <div className={card + " p-4"}>
      <div className="mb-2 flex items-start gap-2">
        <div className="mr-auto">
          <h3 className="text-[14px] text-[#14271C] dark:text-white" style={fontHead}>{title}</h3>
          <p className="text-[11px] text-[#9AA8A0]" style={fontThai}>{sub}</p>
        </div>
        {back && (
          <button type="button" onClick={back}
            className="inline-flex items-center gap-1 rounded-[9px] border border-[#EEF2F0] px-2 py-0.5 text-[11px] text-[#6B7C72] hover:bg-[#F6FAF7] dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
            style={fontThai}>
            <X size={11} /> ทุกโซน
          </button>
        )}
        {/* legend — สีอย่างเดียวไม่พอ ต้องมีชื่อระดับกำกับเสมอ */}
        {levels.length > 1 && (
          <div className="flex items-center gap-2.5 text-[11px] text-[#6B7C72] dark:text-gray-400" style={fontThai}>
            {levels.map((l) => (
              <span key={l.key} className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: l.color }} />
                {DUE_LABEL[l.key]}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="max-h-[420px] overflow-y-auto text-[#14271C] dark:text-white [&_.recharts-bar-rectangle_path]:stroke-white dark:[&_.recharts-bar-rectangle_path]:stroke-[#151a10]">
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 4 }} barCategoryGap={6}>
            <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.08} />
            <XAxis type="number" allowDecimals={false} tick={{ fill: "#9AA8A0", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={170} interval={0} axisLine={false} tickLine={false}
              tick={{ fill: "currentColor", fontSize: 11.5, fontFamily: "'IBM Plex Sans Thai', sans-serif" }}
              tickFormatter={(v: string) => v.length > 26 ? v.slice(0, 25) + "…" : v} />
            <Tooltip cursor={{ fill: "currentColor", fillOpacity: 0.05 }} content={<ChartTip levels={levels} />} />
            {levels.map((l) => (
              <Bar key={l.key} dataKey={l.key} stackId="lv" fill={l.color} strokeWidth={1.5}
                cursor="pointer" isAnimationActive={false}
                onClick={(d: { payload?: StackDatum }) => d.payload && onPick(d.payload.name)}>
                {data.map((d) => (
                  <Cell key={d.name} fillOpacity={!selected || selected === d.name ? 1 : 0.3}
                    radius={(capOf(d) === l.key ? [0, 4, 4, 0] : 0) as unknown as number} />
                ))}
                {/* หาแถวจากชื่อ ไม่ใช่ index — recharts ไม่ส่งท่อนที่กว้าง 0 เข้า LabelList ทำให้ index เลื่อน */}
                <LabelList dataKey="name" content={(p) => {
                  const d = data.find((x) => x.name === p.value)
                  if (!d || capOf(d) !== l.key) return null
                  const x = Number(p.x) + Number(p.width) + 6, y = Number(p.y) + Number(p.height) / 2
                  return <text x={x} y={y} dy={4} fontSize={11} fill="#6B7C72">{fmtNum(d.total)}</text>
                }} />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function ChartTip({ active, payload, levels }: {
  active?:  boolean
  payload?: readonly { payload?: StackDatum }[]
  levels:   { key: DueLevel; color: string }[]
}) {
  const d = payload?.[0]?.payload
  if (!active || !d) return null
  return (
    <div className="rounded-[10px] border border-[#EEF2F0] bg-white px-3 py-2 text-[12px] shadow-lg dark:border-white/10 dark:bg-[#1a2014]" style={fontThai}>
      <div className="mb-1 font-semibold text-[#14271C] dark:text-white">{d.name}</div>
      {levels.map((l) => (d[l.key] ?? 0) > 0 && (
        <div key={l.key} className="flex items-center gap-2 text-[#6B7C72] dark:text-gray-300">
          <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: l.color }} />
          <span className="mr-3">{DUE_LABEL[l.key]}</span>
          <span className="ml-auto font-mono text-[#14271C] dark:text-white">{fmtNum(d[l.key])}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-[#EEF2F0] pt-1 font-semibold text-[#14271C] dark:border-white/10 dark:text-white">
        <span>รวม</span><span className="font-mono">{fmtNum(d.total)} เส้น</span>
      </div>
    </div>
  )
}

function FacetSelect({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[11.5px] text-[#6B7C72] dark:text-gray-400">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className={inp + " max-w-[200px] py-1 text-[12px] " + (value ? "border-[#1B8C4B]/50 ring-1 ring-[#1B8C4B]/20" : "")}>
        <option value="">ทั้งหมด</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

function Segmented<K extends string>({ value, onChange, options }: {
  value: K; onChange: (k: K) => void; options: { key: K; label: string }[]
}) {
  return (
    <div className="flex items-center rounded-[11px] border border-[#EEF2F0] bg-white p-0.5 dark:border-white/10 dark:bg-[#151a10]">
      {options.map((o) => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)}
          className={[
            "rounded-[9px] px-2.5 py-1 text-[11.5px] font-medium transition-colors",
            value === o.key ? "bg-[#14271C] text-white dark:bg-white dark:text-gray-900" : "text-[#6B7C72] hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/5",
          ].join(" ")}
          style={fontThai}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
