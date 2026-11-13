"use client"

// ตารางยางรายเส้นของ Dashboard — หน้าตา/การใช้งานแบบเดียวกับตาราง "คำขอ / อนุมัติ"
// (หัวคอลัมน์กรอง+เรียงได้ · ติ๊กเลือกทำพร้อมกัน · แบ่งหน้า) + รับเรื่องแบบแท็บ "ยางถึงกำหนดเปลี่ยน"
// แต่รับได้ทั้งรายเส้นและทั้งคัน · 1 แถว = ยาง 1 เส้น จัดข้อมูลเป็น 2 บรรทัดต่อช่องให้ตารางแคบลง

import { useMemo, useState } from "react"
import { CheckCircle2, Search, Truck, Undo2, X } from "lucide-react"
import { ColHead, useColFilter, type FacetDef, type SortDef } from "@/components/tire/col-filter"
import {
  FOLLOW_CHIP, FOLLOW_DOT, FOLLOW_LABEL, FOLLOW_ORDER, LEVEL_DOT, type Row,
} from "@/components/tire/dashboard-shared"
import { Pager } from "@/components/tire/transaction-tracking"
import { RowMenu, branchChipCls, branchLabel, card, fmtDateOnly, fmtNum, fontHead, fontThai, inp } from "@/components/tire/shared"
import { DUE_LABEL, dueChipCls, type DueLevel } from "@/lib/tire-due"

// หัวตารางชุดเดียวกับหน้า คำขอ/อนุมัติ (txTheadCls/txThCls/txTdCls) — ขอบแนวตั้งบาง แถวกระชับกว่า
const theadCls = "sticky top-0 z-20 border-b-2 border-[#1B8C4B]/30 bg-[#E4EFE8] dark:border-[#1B8C4B]/45 dark:bg-[#1B2419]"
const thCls =
  "border-r border-[#1B8C4B]/15 px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-[#14271C] " +
  "last:border-r-0 dark:border-white/8 dark:text-gray-100"
const tdCls = "border-r border-[#F1F5F2] px-2.5 py-1.5 align-middle last:border-r-0 dark:border-white/5"

const PAGE_SIZES = [20, 50, 100] as const
const LEVEL_RANK: Record<DueLevel, number> = { over: 4, due: 3, warn: 2, ok: 1, unknown: 0 }

const FACETS: Record<string, FacetDef<Row>> = {
  plate:    { label: "ทะเบียน",   value: (r) => r.plate },
  plant:    { label: "แพล้นท์",   value: (r) => r.plant },
  position: { label: "ตำแหน่ง",   value: (r) => r.position || "—" },
  product:  { label: "รุ่นยาง",   value: (r) => r.product },
  level:    { label: "สถานะยาง",  value: (r) => DUE_LABEL[r.level] },
  follow:   { label: "งานติดตาม", value: (r) => FOLLOW_LABEL[r.follow] },
}
const SORTS: Record<string, SortDef<Row>> = {
  plate:    (r) => r.plate,
  plant:    (r) => r.plant,
  position: (r) => r.position,
  product:  (r) => r.product,
  changeIn: (r) => r.changeIn || "0",
  usedPct:  (r) => r.usedPct ?? -1,
  level:    (r) => LEVEL_RANK[r.level],
  follow:   (r) => FOLLOW_ORDER.indexOf(r.follow),
}

// เส้นที่มีคำขอแล้ว = งานเดินในหน้า คำขอ/อนุมัติ แล้ว ไม่ต้องรับเรื่องซ้ำ
const canAccept = (r: Row) => r.follow === "n"
const canUnaccept = (r: Row) => r.follow === "a"

export function TireDashTable({ rows, acting, onOpenVehicle, onAccept, onAcceptVehicle }: {
  rows:            Row[]
  acting:          boolean
  onOpenVehicle:   (v: { branch: string; plate: string }) => void
  onAccept:        (targets: Row[], on: boolean) => Promise<boolean>
  onAcceptVehicle: (r: Row, on: boolean) => void
}) {
  const [q, setQ] = useState("")
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[1])
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // ยังไม่เลือกเรียง = เกินกำหนดหนักสุดก่อน (เรียงมาให้ตั้งแต่ต้น ไม่ต้องกดเอง)
  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? rows.filter((r) => r.plate.toLowerCase().includes(needle) || r.fleetNo.toLowerCase().includes(needle) || r.serial.toLowerCase().includes(needle))
      : rows.slice()
    return list.sort((a, b) => (b.usedPct ?? -1) - (a.usedPct ?? -1) || a.plate.localeCompare(b.plate, "th"))
  }, [rows, q])
  const col = useColFilter(searched, FACETS, SORTS)
  const list = col.rows

  const pageCount = Math.max(1, Math.ceil(list.length / perPage))
  const current = Math.min(page, pageCount)
  const sliceFrom = (current - 1) * perPage
  const pageRows = list.slice(sliceFrom, sliceFrom + perPage)

  // แถวที่เลือกไว้แต่ถูกกรองหายไปแล้ว ไม่นับ — กันกดรับเรื่องโดนเส้นที่มองไม่เห็น
  const visibleIds = useMemo(() => new Set(list.map((r) => r.id)), [list])
  const selectedRows = list.filter((r) => selected.has(r.id))
  const acceptTargets = selectedRows.filter(canAccept)
  const unacceptTargets = selectedRows.filter(canUnaccept)
  const pageSelectable = pageRows.filter((r) => canAccept(r) || canUnaccept(r))
  const allPageSelected = pageSelectable.length > 0 && pageSelectable.every((r) => selected.has(r.id))
  const somePageSelected = pageSelectable.some((r) => selected.has(r.id))

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set([...s].filter((x) => visibleIds.has(x)))
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  const toggleAllPage = () => setSelected((s) => {
    const n = new Set([...s].filter((x) => visibleIds.has(x)))
    for (const r of pageSelectable) {
      if (allPageSelected) n.delete(r.id)
      else n.add(r.id)
    }
    return n
  })
  async function bulk(targets: Row[], on: boolean) {
    if (await onAccept(targets, on)) setSelected(new Set())
  }

  const filtered = q.trim() !== "" || col.active

  return (
    <section>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] text-[#14271C] dark:text-white" style={fontHead}>รายการยางรายเส้น</h2>
        <span className="text-[12px] text-[#9AA8A0]" style={fontThai}>{fmtNum(list.length)} เส้น</span>
        {col.active && (
          <button type="button" onClick={col.clear}
            className="inline-flex items-center gap-1 text-[12px] text-[#1B8C4B] underline-offset-4 hover:underline" style={fontThai}>
            <X size={12} /> ล้างตัวกรองในตาราง
          </button>
        )}
        <div className="relative ml-auto w-full sm:w-[260px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }}
            placeholder="ค้นหาทะเบียน / เบอร์รถ / ซีเรียล" className={inp + " w-full pl-8"} style={fontThai} />
        </div>
      </div>

      {/* แถบทำรายการพร้อมกัน — โผล่เฉพาะตอนติ๊กเลือก (แบบหน้า คำขอ/อนุมัติ) */}
      {selectedRows.length > 0 && (
        <div className="sticky top-2 z-30 mb-2.5 flex flex-wrap items-center gap-2.5 rounded-2xl border border-[#1B8C4B]/25 bg-[#EAF7EF]/95 px-4 py-2.5 backdrop-blur dark:border-[#1B8C4B]/40 dark:bg-[#132018]/90">
          <span className="text-[13px] font-medium text-[#14271C] dark:text-white" style={fontThai}>เลือกไว้ {selectedRows.length} เส้น</span>
          {acceptTargets.length > 0 && (
            <button type="button" disabled={acting} onClick={() => bulk(acceptTargets, true)}
              className="inline-flex cursor-pointer items-center gap-1 rounded-[10px] bg-[#1B8C4B] px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={fontThai}>
              <CheckCircle2 size={12} /> รับเรื่องที่เลือก ({acceptTargets.length})
            </button>
          )}
          {unacceptTargets.length > 0 && (
            <button type="button" disabled={acting} onClick={() => bulk(unacceptTargets, false)}
              className="inline-flex cursor-pointer items-center gap-1 rounded-[10px] border border-[#1B8C4B]/40 bg-white px-3 py-1.5 text-[12px] font-semibold text-[#14271C] transition-colors hover:bg-[#F0FDF4] disabled:opacity-50 dark:bg-transparent dark:text-white dark:hover:bg-white/5"
              style={fontThai}>
              <Undo2 size={12} /> ยกเลิกรับเรื่อง ({unacceptTargets.length})
            </button>
          )}
          <button type="button" onClick={() => setSelected(new Set())}
            className="ml-auto cursor-pointer text-[12px] text-[#6B7C72] underline-offset-4 hover:text-[#14271C] hover:underline dark:text-gray-400 dark:hover:text-white"
            style={fontThai}>
            ล้างการเลือก
          </button>
        </div>
      )}

      <div className={card + " overflow-x-auto"}>
        <table className="w-full text-sm">
          <thead>
            <tr className={theadCls}>
              <th className={thCls + " w-9"}>
                <input
                  ref={(el) => { if (el) el.indeterminate = somePageSelected && !allPageSelected }}
                  type="checkbox" checked={allPageSelected} onChange={toggleAllPage}
                  disabled={pageSelectable.length === 0}
                  title="เลือกทุกเส้นที่รับเรื่อง/ยกเลิกได้ในหน้านี้"
                  className="h-4 w-4 cursor-pointer accent-[#1B8C4B] disabled:opacity-30"
                />
              </th>
              <ColHead ctx={col.ctx} label="ทะเบียน / เบอร์รถ" className={thCls}
                sortKey="plate" sortLabels={["ทะเบียน ก → ฮ", "ทะเบียน ฮ → ก"]} facetKey="plate" />
              <ColHead ctx={col.ctx} label="แพล้นท์ / ฟลีท" className={thCls}
                sortKey="plant" sortLabels={["แพล้นท์ ก → ฮ", "แพล้นท์ ฮ → ก"]} facetKey="plant" />
              <ColHead ctx={col.ctx} label="ตำแหน่ง" className={thCls}
                sortKey="position" sortLabels={["ตำแหน่ง ก → ฮ", "ตำแหน่ง ฮ → ก"]} facetKey="position" />
              <ColHead ctx={col.ctx} label="รุ่นยาง / ซีเรียล" className={thCls}
                sortKey="product" sortLabels={["รุ่น ก → ฮ", "รุ่น ฮ → ก"]} facetKey="product" />
              <ColHead ctx={col.ctx} label="เปลี่ยนเข้า" className={thCls}
                sortKey="changeIn" sortLabels={["เก่าสุดก่อน", "ใหม่สุดก่อน"]} />
              <ColHead ctx={col.ctx} label="ระยะที่ใช้" className={thCls + " min-w-[150px]"}
                sortKey="usedPct" sortLabels={["ใช้ไปน้อยสุดก่อน", "ใช้ไปมากสุดก่อน"]} />
              <ColHead ctx={col.ctx} label="สถานะยาง" className={thCls}
                sortKey="level" sortLabels={["ปกติก่อน", "หนักสุดก่อน"]} facetKey="level" />
              <ColHead ctx={col.ctx} label="งานติดตาม" className={thCls}
                sortKey="follow" sortLabels={["รับเรื่อง → เปลี่ยนแล้ว", "เปลี่ยนแล้ว → รับเรื่อง"]} facetKey="follow" />
              <th className={thCls + " w-14 text-center"}>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-[13px] text-gray-400" style={fontThai}>
                {filtered ? "ไม่มีรายการตามเงื่อนไข — ลองปรับคำค้นหรือล้างตัวกรอง" : "ไม่มีข้อมูลตามตัวกรองด้านบน"}
              </td></tr>
            ) : pageRows.map((r, i) => {
              const selectable = canAccept(r) || canUnaccept(r)
              return (
                <tr key={r.id}
                  className={`border-b border-gray-100 last:border-0 dark:border-white/5 ${i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : ""} hover:bg-[#F0FDF4] dark:hover:bg-white/4`}>
                  <td className={tdCls}>
                    <input type="checkbox" checked={selected.has(r.id)} disabled={!selectable} onChange={() => toggle(r.id)}
                      title={selectable ? "เลือกเพื่อทำรายการพร้อมกัน" : "มีคำขอเปลี่ยนแล้ว — ติดตามต่อที่หน้า คำขอ/อนุมัติ"}
                      className="h-4 w-4 cursor-pointer accent-[#1B8C4B] disabled:opacity-30" />
                  </td>

                  <td className={tdCls}>
                    <span className="flex items-center gap-1.5">
                      <button type="button" onClick={() => onOpenVehicle({ branch: r.branch, plate: r.plate })}
                        title="เปิดดูยางรายล้อของคันนี้"
                        className="font-mono text-[13px] font-bold text-[#14271C] hover:text-[#1B8C4B] hover:underline dark:text-white">
                        {r.plate}
                      </button>
                      <span className={`rounded px-1 py-px text-[9.5px] font-semibold ${branchChipCls(r.branch)}`} style={fontThai}>{branchLabel(r.branch)}</span>
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[#9AA8A0]" style={fontThai}>
                      <span className="font-mono">{r.fleetNo || "—"}</span> · {r.unit === "trailer" ? "หาง" : "หัว"}
                    </span>
                  </td>

                  <td className={tdCls + " max-w-[170px]"} style={fontThai}>
                    <span className="block truncate text-[12px] text-[#14271C] dark:text-gray-200" title={r.plant}>{r.plant}</span>
                    <span className="block truncate text-[11px] text-[#9AA8A0]" title={`${r.fleet} · ${r.vtype}`}>{r.fleet}</span>
                  </td>

                  <td className={tdCls + " max-w-[150px]"} style={fontThai}>
                    <span className="block truncate text-[12px] text-[#14271C] dark:text-gray-200" title={r.position}>{r.position || "—"}</span>
                  </td>

                  <td className={tdCls + " max-w-[220px]"}>
                    <span className="block truncate text-[12px] text-[#14271C] dark:text-gray-200" style={fontThai} title={r.product}>{r.product}</span>
                    <span className="block truncate font-mono text-[10.5px] text-[#9AA8A0]">{r.serial || "—"}</span>
                  </td>

                  <td className={tdCls + " whitespace-nowrap text-[12px] tabular-nums text-[#3C4B42] dark:text-gray-300"}>
                    {r.changeIn ? fmtDateOnly(r.changeIn) : "—"}
                  </td>

                  <td className={tdCls}>
                    {r.usedPct == null ? (
                      <span className="text-[11.5px] text-[#9AA8A0]" style={fontThai}>{r.kmUsed ? `${fmtNum(r.kmUsed)} กม. · ไม่มีระยะกำหนด` : "ไม่มีข้อมูลระยะ"}</span>
                    ) : (
                      <>
                        <span className="flex items-baseline justify-between gap-2 tabular-nums">
                          <span className="text-[12.5px] font-bold text-[#14271C] dark:text-white">{r.usedPct}%</span>
                          <span className="text-[10.5px] text-[#9AA8A0]">
                            {fmtNum(r.kmUsed)}{r.partial && <span className="text-[#E8A317]" title="ยางใส่ก่อนช่วงที่มีข้อมูล — ระยะจริงมากกว่านี้">*</span>} / {fmtNum(r.spec)} กม.
                          </span>
                        </span>
                        <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-[#EEF2F0] dark:bg-white/10">
                          <span className={`block h-full ${LEVEL_DOT[r.level]}`} style={{ width: `${Math.min(100, r.usedPct)}%` }} />
                        </span>
                      </>
                    )}
                  </td>

                  <td className={tdCls}>
                    <span className={`inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${dueChipCls[r.level]}`} style={fontThai}>
                      {DUE_LABEL[r.level]}
                    </span>
                    {r.snoozed && <span className="mt-0.5 block text-[10px] text-[#9AA8A0]" style={fontThai}>พักแจ้งเตือนอยู่</span>}
                  </td>

                  <td className={tdCls} style={fontThai}>
                    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${FOLLOW_CHIP[r.follow]}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${FOLLOW_DOT[r.follow]}`} />
                      {FOLLOW_LABEL[r.follow]}
                    </span>
                    {r.acceptedBy && (
                      <span className="mt-0.5 block max-w-[140px] truncate text-[10px] text-[#9AA8A0]" title={`รับเรื่องโดย ${r.acceptedBy}`}>
                        {r.acceptedBy}{r.acceptedAt ? ` · ${fmtDateOnly(r.acceptedAt)}` : ""}
                      </span>
                    )}
                  </td>

                  <td className={tdCls + " text-center"}>
                    <RowMenu items={[
                      { label: "รับเรื่องเส้นนี้", icon: CheckCircle2, hidden: !canAccept(r), onSelect: () => onAccept([r], true) },
                      { label: "ยกเลิกรับเรื่อง", icon: Undo2, hidden: !canUnaccept(r), onSelect: () => onAccept([r], false) },
                      { label: "รับเรื่องทั้งคัน", icon: CheckCircle2, onSelect: () => onAcceptVehicle(r, true), divider: canAccept(r) || canUnaccept(r) },
                      { label: "ยกเลิกรับเรื่องทั้งคัน", icon: Undo2, onSelect: () => onAcceptVehicle(r, false) },
                      { label: "เปิดดูยางรายล้อ", icon: Truck, onSelect: () => onOpenVehicle({ branch: r.branch, plate: r.plate }), divider: true },
                    ]} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ท้ายตาราง: จำนวน + แบ่งหน้า (แบบหน้า คำขอ/อนุมัติ) */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <p className="text-[12px] text-[#9AA8A0]" style={fontThai}>
          {list.length ? (
            <>
              แสดง <span className="font-medium text-[#14271C] dark:text-white">{sliceFrom + 1}–{sliceFrom + pageRows.length}</span> จาก {fmtNum(list.length)} เส้น
              {list.length !== rows.length ? ` (ตามตัวกรองด้านบน ${fmtNum(rows.length)})` : ""}
            </>
          ) : "ไม่มีรายการที่ตรงกับเงื่อนไข"}
        </p>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 sm:flex">
            <span className="text-[12px] text-[#9AA8A0]" style={fontThai}>ต่อหน้า</span>
            <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1) }}
              aria-label="จำนวนรายการต่อหน้า" className={inp}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <Pager current={current} count={pageCount} onGo={setPage} />
        </div>
      </div>
    </section>
  )
}
