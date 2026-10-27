"use client"
// แผงกรองที่เลื่อนขึ้นจากด้านล่าง (บนคอมเป็นกล่องกลางจอ) — แก้ในแผงก่อน กด "ดูผล" ถึงใช้จริง
import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { VP_STATUS_LABEL, vpFilterBills, vpMonthLabel, type VpBill, type VpFilter, type VpSort, type VpStatus } from "@/lib/vendor-portal"

const STATUSES: VpStatus[] = ["processing", "scheduled", "paid"]
const SORTS: { k: VpSort; label: string }[] = [
  { k: "recent", label: "รับของล่าสุด" },
  { k: "payDate", label: "กำหนดโอนใกล้สุด" },
  { k: "amount", label: "ยอดมากสุด" },
]

const OPT = "inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition"
const on = (v: boolean) => (v ? "border-[#1E3A5F] bg-indigo-50 font-semibold text-[#1E3A5F]" : "border-slate-300 text-slate-700 hover:bg-slate-50")

export function FilterSheet({ bills, months, value, onApply, onClose }: {
  bills: VpBill[]
  months: string[]
  value: VpFilter
  onApply: (f: VpFilter) => void
  onClose: () => void
}) {
  const [f, setF] = useState<VpFilter>(value)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", esc)
    return () => window.removeEventListener("keydown", esc)
  }, [onClose])

  const toggle = <T,>(list: T[] | undefined, x: T) => {
    const cur = list ?? []
    return cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x]
  }
  const countBy = (s: VpStatus) => vpFilterBills(bills, { ...f, statuses: [s] }).length
  const result = vpFilterBills(bills, f).length

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="กรองรายการ">
      <div className="absolute inset-0 bg-slate-900/45" onClick={onClose} />
      <div className="relative max-h-[88%] w-full overflow-y-auto rounded-t-2xl bg-white px-4 pb-4 pt-2 sm:max-w-md sm:rounded-2xl">
        <div className="mx-auto mb-2.5 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" />
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">กรองรายการ</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setF({ sort: "recent" })} className="h-10 px-2 text-[13px] font-medium text-blue-600">ล้างทั้งหมด</button>
            <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="ปิด"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <section className="mt-3">
          <div className="mb-2 text-[13px] font-semibold text-slate-700">สถานะ <span className="font-normal text-slate-400">เลือกได้หลายอัน</span></div>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button key={s} onClick={() => setF({ ...f, statuses: toggle(f.statuses, s) })} className={`${OPT} ${on(Boolean(f.statuses?.includes(s)))}`}>
                {VP_STATUS_LABEL[s]} <span className="text-xs font-normal text-slate-400">{countBy(s)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-4">
          <div className="mb-2 text-[13px] font-semibold text-slate-700">เดือนที่รับของ</div>
          <div className="flex flex-wrap gap-2">
            {months.map((m) => (
              <button key={m} onClick={() => setF({ ...f, months: toggle(f.months, m) })} className={`${OPT} ${on(Boolean(f.months?.includes(m)))}`}>
                {vpMonthLabel(m)}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-500">ตั้งแต่
              <input type="date" value={f.from ?? ""} onChange={(e) => setF({ ...f, from: e.target.value || undefined })}
                className="mt-1 h-10 w-full rounded-xl border border-slate-300 px-2 text-sm text-slate-900" />
            </label>
            <label className="text-xs text-slate-500">ถึง
              <input type="date" value={f.to ?? ""} onChange={(e) => setF({ ...f, to: e.target.value || undefined })}
                className="mt-1 h-10 w-full rounded-xl border border-slate-300 px-2 text-sm text-slate-900" />
            </label>
          </div>
        </section>

        <section className="mt-4">
          <div className="mb-2 text-[13px] font-semibold text-slate-700">เรียงตาม</div>
          <div className="flex flex-wrap gap-2">
            {SORTS.map((x) => (
              <button key={x.k} onClick={() => setF({ ...f, sort: x.k })} className={`${OPT} ${on((f.sort ?? "recent") === x.k)}`}>{x.label}</button>
            ))}
          </div>
        </section>

        <div className="sticky bottom-0 mt-5 flex gap-2 bg-white pt-2">
          <button onClick={onClose} className="h-12 flex-1 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700">ยกเลิก</button>
          <button onClick={() => onApply(f)} className="h-12 flex-[2] rounded-xl bg-[#1E3A5F] text-sm font-semibold text-white">ดูผล {result} ใบ</button>
        </div>
      </div>
    </div>
  )
}
