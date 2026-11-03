"use client"

// รอบขายซาก: รายการรอบ · สร้างรอบ (เลือกคลัง + วันตัดรอบ → ติ๊กซาก) · เปิดรอบดูรายการ · Export · ขายทั้งรอบ · ยกเลิกรอบ
import { useMemo, useState } from "react"
import { Download, Loader2, Plus } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { swalTextInput, swalToast } from "@/lib/swal"
import { DateInput, baht, btnGhost, btnPrimary, daysFrom, download, inputCls, postJson, useFetch, useKeyed, qtyText, thDate, thDateTime, todayYmd, type Row } from "./shared"

type Round = {
  roundNo: string; warehouses: string[]; cutoffDate: string; status: "open" | "sold" | "cancelled"; count: number; costAmount: number
  createdBy: { name: string }; createdAt: string; soldDate?: string | null; buyer?: string | null; totalPrice?: number | null; note?: string; cancelReason?: string
}
const ROUND_ST: Record<Round["status"], { label: string; cls: string }> = {
  open: { label: "รอขาย", cls: "bg-sky-50 text-sky-800 ring-sky-200" },
  sold: { label: "ขายแล้ว", cls: "bg-green-50 text-green-800 ring-green-200" },
  cancelled: { label: "ยกเลิก", cls: "bg-gray-100 text-gray-600 ring-gray-200" },
}
const settle = () => new Promise<void>((r) => setTimeout(r, 150))
const EMPTY = new Set<string>()

export function RoundsPanel({ warehouses, canRound, onChanged, compact }: { warehouses: string[]; canRound: boolean; onChanged: () => void; compact?: boolean }) {
  const [tick, setTick] = useState(0)
  const { data, error } = useFetch<{ items: Round[] }>("/api/core-return/rounds", tick)
  const items = data?.items ?? null
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const changed = () => { setTick((t) => t + 1); onChanged() }
  const shown = compact ? (items ?? []).slice(0, 6) : items ?? []
  return (
    <section data-testid="rounds" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">รอบขายซาก</h3>
        <div className="flex gap-2">
          <button type="button" onClick={() => download("/api/core-return/report/scrap-aging")} className={btnGhost} data-testid="aging-export"><Download size={14} />ซากรอขาย ณ วันนี้</button>
          {canRound && <button type="button" onClick={() => setCreating(true)} className={btnPrimary} data-testid="round-new"><Plus size={14} />สร้างรอบ</button>}
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!items ? <div className="h-20 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5" /> : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#E2E8E4] px-3 py-5 text-center text-xs text-gray-400 dark:border-white/10">ยังไม่มีรอบขาย</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li key={r.roundNo}>
              <button type="button" onClick={() => setOpen(r.roundNo)} data-round={r.roundNo} className="w-full rounded-xl border border-[#E2E8E4] bg-white p-3 text-left hover:border-[#1B8C4B] dark:border-white/10 dark:bg-[#0f1117]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-gray-900 dark:text-white">{r.roundNo}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ROUND_ST[r.status].cls}`}>{ROUND_ST[r.status].label}</span>
                </div>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{r.warehouses.join(", ")} · ตัดรอบ {thDate(r.cutoffDate)}</p>
                <p className="text-xs text-gray-500">{r.count} รายการ · ทุนเดิม {baht(r.costAmount)} บาท{r.status === "sold" && r.totalPrice != null ? ` · ขายได้ ${baht(r.totalPrice)} บาท` : ""}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
      <CreateRoundDialog key={creating ? "open" : "closed"} open={creating} warehouses={warehouses} onClose={() => setCreating(false)} onDone={(no) => { changed(); setOpen(no) }} />
      <RoundDialog key={open ?? "none"} roundNo={open} canRound={canRound} onClose={() => setOpen(null)} onChanged={changed} />
    </section>
  )
}

function CreateRoundDialog({ open, warehouses, onClose, onDone }: { open: boolean; warehouses: string[]; onClose: () => void; onDone: (no: string) => void }) {
  const [wh, setWh] = useState<string[]>(() => warehouses) // เริ่มทุกคลัง ติ๊กออกเองได้
  const [cutoff, setCutoff] = useState(todayYmd())
  const previewUrl = open && wh.length ? `/api/core-return/rounds/preview?warehouses=${encodeURIComponent(wh.join(","))}&cutoffDate=${cutoff}` : null
  const { data: pv, error: pvError } = useFetch<{ items: Row[] }>(previewUrl)
  const rows = pv?.items ?? null
  // ติ๊กออก = เก็บเป็นรายการที่ไม่เอา (ค่าเริ่มต้นเลือกทั้งหมด) · เปลี่ยนคลัง/วันตัดรอบ = เริ่มใหม่
  const [unpicked, setUnpicked] = useKeyed<Set<string>>(previewUrl ?? "", EMPTY)
  const picked = useMemo(() => new Set((rows ?? []).map((r) => r.row_key).filter((k) => !unpicked.has(k))), [rows, unpicked])
  const setPicked = (fn: (cur: Set<string>) => Set<string>) => { const next = fn(picked); setUnpicked(new Set((rows ?? []).map((r) => r.row_key).filter((k) => !next.has(k)))) }
  const [busy, setBusy] = useState(false)
  const [saveError, setError] = useState("")
  const error = saveError || pvError
  const total = useMemo(() => (rows ?? []).filter((r) => picked.has(r.row_key)).reduce((a, r) => a + (r.amount ?? 0), 0), [rows, picked])
  const save = async () => {
    setBusy(true); setError("")
    try {
      const j = await postJson("/api/core-return/rounds", { warehouses: wh, cutoffDate: cutoff, keys: [...picked] })
      onClose(); await settle()
      void swalToast("success", `สร้างรอบ ${j.roundNo} แล้ว ${j.count} รายการ${j.skipped ? ` (ข้าม ${j.skipped} ที่มีรอบอื่นเลือกไปก่อน)` : ""}`)
      onDone(j.roundNo)
    } catch (e) { setError(e instanceof Error ? e.message : "สร้างรอบไม่สำเร็จ") } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl" data-testid="round-create">
        <DialogHeader><DialogTitle>สร้างรอบขายซาก</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="คลัง">
            {warehouses.map((w) => (
              <button key={w} type="button" aria-pressed={wh.includes(w)} onClick={() => setWh((cur) => cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w])}
                className={`rounded-full border px-3 py-1.5 text-sm ${wh.includes(w) ? "border-[#1B8C4B] bg-[#1B8C4B]/10 text-[#1B8C4B]" : "border-[#E2E8E4] text-gray-600 dark:border-white/10"}`}>{w}</button>
            ))}
          </div>
          <label className="block max-w-xs space-y-1 text-sm"><span className="font-medium text-gray-700 dark:text-gray-200">เอาซากที่เข้าคลังถึงวันที่</span>
            <DateInput value={cutoff} max={todayYmd()} onChange={setCutoff} />
          </label>
          {!rows ? <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5" /> : rows.length === 0 ? (
            <p className="rounded-xl bg-gray-50 px-3 py-4 text-center text-sm text-gray-500 dark:bg-white/5">ไม่มีซากรอขายที่ยังไม่เข้ารอบ</p>
          ) : (
            <div className="max-h-[45vh] overflow-y-auto rounded-xl border border-[#E2E8E4] dark:border-white/10">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#F6F8F7] text-left text-xs text-gray-500 dark:bg-[#161922]">
                  <tr><th className="p-2"><input type="checkbox" aria-label="เลือกทั้งหมด" checked={picked.size === rows.length} onChange={(e) => setPicked(() => (e.target.checked ? new Set(rows.map((r) => r.row_key)) : new Set()))} /></th>
                    <th className="p-2">สินค้า</th><th className="p-2">ทะเบียน</th><th className="p-2">เข้าคลังซาก</th><th className="p-2 text-right">ทุนเดิม</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.row_key} className="border-t border-[#EEF2F0] dark:border-white/5">
                      <td className="p-2"><input type="checkbox" aria-label={`เลือก ${r.skuName}`} checked={picked.has(r.row_key)} onChange={(e) => setPicked((cur) => { const n = new Set(cur); if (e.target.checked) n.add(r.row_key); else n.delete(r.row_key); return n })} /></td>
                      <td className="p-2"><span className="block max-w-[220px] truncate">{r.skuName}</span><span className="text-xs text-gray-500">{r.skuCode} · {r.warehouse}</span></td>
                      <td className="p-2 text-xs">{r.plate}</td>
                      <td className="p-2 text-xs">{thDate(r.sale?.scrapInDate)} <span className="text-gray-500">({daysFrom(r.sale?.scrapInDate)} วัน)</span></td>
                      <td className="p-2 text-right">{baht(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-300">เลือก {picked.size} รายการ · ทุนเดิม {baht(total)} บาท</span>
            <div className="flex gap-2"><button type="button" className={btnGhost} onClick={onClose}>ยกเลิก</button>
              <button type="button" className={btnPrimary} disabled={busy || picked.size === 0 || !wh.length} onClick={save}>{busy && <Loader2 size={16} className="animate-spin" />}สร้างรอบ</button></div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RoundDialog({ roundNo, canRound, onClose, onChanged }: { roundNo: string | null; canRound: boolean; onClose: () => void; onChanged: () => void }) {
  const [tick, setTick] = useState(0)
  const { data } = useFetch<{ round: Round; items: Row[] }>(roundNo ? `/api/core-return/rounds/${encodeURIComponent(roundNo)}` : null, tick)
  const [selling, setSelling] = useState(false)
  const [soldDate, setSoldDate] = useState(todayYmd())
  const [buyer, setBuyer] = useState("")
  const [total, setTotal] = useState("")
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const sell = async () => {
    if (!roundNo) return
    setBusy(true); setError("")
    try {
      const j = await postJson(`/api/core-return/rounds/${encodeURIComponent(roundNo)}/sold`, { soldDate, buyer, totalPrice: total, linePrices: prices })
      void swalToast("success", `บันทึกขายแล้ว ${j.sold} รายการ`)
      setSelling(false); setTick((t) => t + 1); onChanged()
    } catch (e) { setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ") } finally { setBusy(false) }
  }
  const cancel = async () => {
    if (!roundNo) return
    onClose(); await settle()
    const r = await swalTextInput({ title: `ยกเลิกรอบ ${roundNo}`, label: "เหตุผล", placeholder: "เช่น ผู้ซื้อไม่มารับ", required: true, confirmText: "ยกเลิกรอบ", danger: true })
    if (!r.isConfirmed || !r.value) return
    try {
      const j = await postJson(`/api/core-return/rounds/${encodeURIComponent(roundNo)}/cancel`, { reason: r.value })
      void swalToast("success", `ยกเลิกแล้ว ซาก ${j.released} รายการกลับไปรอขาย`)
      onChanged()
    } catch (e) { void swalToast("error", e instanceof Error ? e.message : "ยกเลิกไม่สำเร็จ") }
  }
  const rd = data?.round
  return (
    <Dialog open={!!roundNo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl" data-testid="round-dialog">
        <DialogHeader><DialogTitle>รอบขาย {roundNo}</DialogTitle></DialogHeader>
        {!data ? <div className="h-32 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5" /> : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ROUND_ST[rd!.status].cls}`}>{ROUND_ST[rd!.status].label}</span>
              <span className="text-gray-600 dark:text-gray-300">{rd!.warehouses.join(", ")} · ตัดรอบ {thDate(rd!.cutoffDate)} · {data.items.length} รายการ · ทุนเดิม {baht(rd!.costAmount)} บาท</span>
            </div>
            <p className="text-xs text-gray-500">สร้างโดย {rd!.createdBy.name} · {thDateTime(rd!.createdAt)}
              {rd!.status === "sold" ? ` · ขาย ${thDate(rd!.soldDate)}${rd!.buyer ? ` ให้ ${rd!.buyer}` : ""}${rd!.totalPrice != null ? ` · ${baht(rd!.totalPrice)} บาท` : ""}` : ""}
              {rd!.status === "cancelled" ? ` · ยกเลิก: ${rd!.cancelReason ?? ""}` : ""}</p>
            <div className="max-h-[42vh] overflow-y-auto rounded-xl border border-[#E2E8E4] dark:border-white/10">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#F6F8F7] text-left text-xs text-gray-500 dark:bg-[#161922]">
                  <tr><th className="p-2">#</th><th className="p-2">สินค้า</th><th className="p-2">WD / ทะเบียน</th><th className="p-2">ในคลังซาก</th><th className="p-2 text-right">ทุนเดิม</th>{(selling || rd!.status === "sold") && <th className="p-2 text-right">ราคาขาย</th>}</tr>
                </thead>
                <tbody>
                  {data.items.map((r, i) => (
                    <tr key={r.row_key} className="border-t border-[#EEF2F0] dark:border-white/5">
                      <td className="p-2 text-xs text-gray-500">{i + 1}</td>
                      <td className="p-2"><span className="block max-w-[240px] truncate">{r.skuName}</span><span className="text-xs text-gray-500">{r.skuCode} · {qtyText(r.coreQtyReturned || r.qtyIssued)} ชิ้น</span></td>
                      <td className="p-2 text-xs">{r.wdCode}<br />{r.plate}</td>
                      <td className="p-2 text-xs">{thDate(r.sale?.scrapInDate)} · {daysFrom(r.sale?.scrapInDate)} วัน</td>
                      <td className="p-2 text-right">{baht(r.amount)}</td>
                      {selling && <td className="p-2 text-right"><input aria-label="ราคาขายบรรทัดนี้" inputMode="decimal" className="w-24 rounded-lg border border-[#E2E8E4] px-2 py-1 text-right text-sm" value={prices[r.row_key] ?? ""} onChange={(e) => setPrices((p) => ({ ...p, [r.row_key]: e.target.value }))} /></td>}
                      {!selling && rd!.status === "sold" && <td className="p-2 text-right">{r.sale?.price != null ? baht(r.sale.price) : "-"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selling && (
              <div className="grid gap-3 rounded-xl bg-[#F6F8F7] p-3 sm:grid-cols-3 dark:bg-white/[0.04]">
                <label className="space-y-1 text-sm"><span className="font-medium">วันที่ขาย</span><DateInput value={soldDate} max={todayYmd()} onChange={setSoldDate} /></label>
                <label className="space-y-1 text-sm"><span className="font-medium">ผู้ซื้อ (ถ้ามี)</span><input className={inputCls} value={buyer} onChange={(e) => setBuyer(e.target.value)} /></label>
                <label className="space-y-1 text-sm"><span className="font-medium">ราคารวม (ถ้ามี)</span><input className={inputCls} inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="ว่าง = รวมจากรายบรรทัด" /></label>
              </div>
            )}
            {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => download(`/api/core-return/rounds/${encodeURIComponent(roundNo!)}/export`)} className={btnGhost} data-testid="round-export"><Download size={14} />Export Excel รอบนี้</button>
              {canRound && rd!.status === "open" && !selling && <button type="button" className={btnGhost} onClick={cancel}>ยกเลิกรอบ</button>}
              {canRound && rd!.status === "open" && !selling && <button type="button" className={btnPrimary} onClick={() => setSelling(true)}>บันทึกขายแล้วทั้งรอบ</button>}
              {selling && <button type="button" className={btnGhost} onClick={() => setSelling(false)}>ยังไม่บันทึก</button>}
              {selling && <button type="button" className={btnPrimary} disabled={busy} onClick={sell}>{busy && <Loader2 size={16} className="animate-spin" />}ยืนยันขายทั้งรอบ</button>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
