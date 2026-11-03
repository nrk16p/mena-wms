"use client"

// กล่องโต้ตอบของงานซาก: คืนซาก · บันทึกขายแล้ว · Rebuild เสร็จ · ติดตาม · รายละเอียด+ประวัติ
import { Fragment, useState } from "react"
import { Loader2, ShieldAlert, ShieldCheck, X } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NO_CORE_REASONS, STATUS_LABEL, type CoreStatus } from "@/lib/core-return/core"
import {
  CoreChip, baht, btnGhost, btnPrimary, followText, inputCls, useFetch, postJson, qtyText, rowUrl, thDate, thDateTime, todayYmd, type Row,
} from "./shared"

const settle = () => new Promise<void>((r) => setTimeout(r, 150))

function RowHead({ row }: { row: Row }) {
  return (
    <div className="rounded-xl bg-[#F6F8F7] p-3 text-sm dark:bg-white/[0.04]">
      <p className="font-medium text-gray-900 dark:text-white">{row.skuName || row.skuCode}</p>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        {row.skuCode} · {row.plate || "-"}{row.vehicleNo ? ` (${row.vehicleNo})` : ""} · {row.wdCode || "-"} · เบิก {thDate(row.issuedDate)} · {qtyText(row.qtyIssued)} ชิ้น
      </p>
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-500">{hint}</span>}
    </label>
  )
}

function Footer({ busy, onCancel, label, error }: { busy: boolean; onCancel: () => void; label: string; error: string }) {
  return (
    <>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className={btnGhost}>ยกเลิก</button>
        <button type="submit" disabled={busy} className={btnPrimary} data-testid="dialog-submit">{busy && <Loader2 size={16} className="animate-spin" />}{label}</button>
      </div>
    </>
  )
}

type Done = (row: Row) => void

function useSubmit(url: string, onDone: Done, onClose: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async (body: unknown) => {
    setBusy(true); setError("")
    try {
      const j = await postJson(url, body)
      onClose(); await settle(); onDone(j.row)
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ")
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, submit }
}

const CHOICES: { key: "sell" | "rebuild" | "no_core"; title: string; desc: string }[] = [
  { key: "sell", title: "S1 ขายซาก", desc: "เอาเข้าคลังซาก รอขาย" },
  { key: "rebuild", title: "Rebuild ซ่อม", desc: "ส่งซ่อมกลับมาใช้ใหม่" },
  { key: "no_core", title: "ไม่มีซากคืน", desc: "ของสิ้นเปลือง / ซากเสียทิ้ง" },
]

export function ReturnDialog({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: Done }) {
  const [choice, setChoice] = useState<"sell" | "rebuild" | "no_core" | null>(null)
  const [qty, setQty] = useState(String(row?.qtyIssued ?? 1))
  const [shortReason, setShortReason] = useState("")
  const [scrapInDate, setScrapInDate] = useState(todayYmd())
  const [sentDate, setSentDate] = useState("")
  const [vendor, setVendor] = useState("")
  const [reason, setReason] = useState<string>(NO_CORE_REASONS[0])
  const [note, setNote] = useState("")
  const { busy, error, submit } = useSubmit(row ? rowUrl(row.row_key, "return") : "", onDone, onClose)
  const short = row?.qtyIssued != null && Number(qty) > 0 && Number(qty) < row.qtyIssued
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg" data-testid="return-dialog">
        <DialogHeader><DialogTitle>คืนซาก</DialogTitle></DialogHeader>
        {row && (
          <form className="space-y-4" onSubmit={(e) => {
            e.preventDefault()
            void submit({ choice, qty: choice === "no_core" ? undefined : qty, shortReason, scrapInDate: choice === "sell" ? scrapInDate : undefined, rebuildSentDate: sentDate || undefined, rebuildVendor: vendor, noCoreReason: reason, note })
          }}>
            <RowHead row={row} />
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">ซากนี้จะไปทางไหน</legend>
              <div className="grid grid-cols-3 gap-2" role="radiogroup">
                {CHOICES.map((c) => (
                  <button key={c.key} type="button" role="radio" aria-checked={choice === c.key} data-choice={c.key} onClick={() => setChoice(c.key)}
                    className={`rounded-xl border p-3 text-left transition ${choice === c.key ? "border-[#1B8C4B] bg-[#1B8C4B]/10 ring-1 ring-[#1B8C4B]" : "border-[#E2E8E4] hover:border-[#1B8C4B]/60 dark:border-white/10"}`}>
                    <span className="block text-sm font-semibold text-gray-900 dark:text-white">{c.title}</span>
                    <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{c.desc}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            {choice && choice !== "no_core" && (
              <Field label="จำนวนที่คืน" hint={`เบิกไป ${qtyText(row.qtyIssued)}`}>
                <input className={inputCls} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="จำนวนที่คืน" />
              </Field>
            )}
            {choice && choice !== "no_core" && short && (
              <Field label="คืนไม่ครบ เพราะอะไร">
                <input className={inputCls} value={shortReason} onChange={(e) => setShortReason(e.target.value)} placeholder="เช่น อีกตัวแตก ทิ้งที่อู่" />
              </Field>
            )}
            {choice === "sell" && (
              <Field label="วันที่เข้าคลังซาก" hint="ซากจะรออยู่คลังซากจนถึงรอบขาย">
                <input type="date" className={inputCls} value={scrapInDate} max={todayYmd()} onChange={(e) => setScrapInDate(e.target.value)} required aria-label="วันที่เข้าคลังซาก" />
              </Field>
            )}
            {choice === "rebuild" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="วันที่ส่งซ่อม (ถ้ามี)"><input type="date" className={inputCls} value={sentDate} max={todayYmd()} onChange={(e) => setSentDate(e.target.value)} /></Field>
                <Field label="ส่งที่ไหน (ถ้ามี)"><input className={inputCls} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="ชื่ออู่/ร้าน" /></Field>
              </div>
            )}
            {choice === "no_core" && (
              <Field label="ทำไมไม่มีซาก">
                <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
                  {NO_CORE_REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </Field>
            )}
            {choice && (
              <Field label={choice === "no_core" && reason === "อื่นๆ" ? "หมายเหตุ (ต้องใส่)" : "หมายเหตุ (ถ้ามี)"}>
                <textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            )}
            <Footer busy={busy} onCancel={onClose} label="บันทึกคืนซาก" error={error || ""} />
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function SoldDialog({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: Done }) {
  const [soldDate, setSoldDate] = useState(todayYmd())
  const [price, setPrice] = useState("")
  const [buyer, setBuyer] = useState("")
  const [note, setNote] = useState("")
  const { busy, error, submit } = useSubmit(row ? rowUrl(row.row_key, "sold") : "", onDone, onClose)
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>บันทึกขายซากแล้ว</DialogTitle></DialogHeader>
        {row && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit({ soldDate, price, buyer, note }) }}>
            <RowHead row={row} />
            <p className="text-xs text-gray-500">เข้าคลังซาก {thDate(row.sale?.scrapInDate)}</p>
            <Field label="วันที่ขาย"><input type="date" className={inputCls} value={soldDate} max={todayYmd()} onChange={(e) => setSoldDate(e.target.value)} required /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="ราคาขาย (ถ้ามี)"><input className={inputCls} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="บาท" /></Field>
              <Field label="ผู้ซื้อ (ถ้ามี)"><input className={inputCls} value={buyer} onChange={(e) => setBuyer(e.target.value)} /></Field>
            </div>
            <Field label="หมายเหตุ (ถ้ามี)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <Footer busy={busy} onCancel={onClose} label="บันทึกขายแล้ว" error={error} />
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function RebuiltDialog({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: Done }) {
  const [date, setDate] = useState(todayYmd())
  const [note, setNote] = useState("")
  const { busy, error, submit } = useSubmit(row ? rowUrl(row.row_key, "rebuilt") : "", onDone, onClose)
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Rebuild เสร็จ</DialogTitle></DialogHeader>
        {row && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit({ rebuiltDate: date, note }) }}>
            <RowHead row={row} />
            {row.rebuild?.vendor && <p className="text-xs text-gray-500">ส่งซ่อมที่ {row.rebuild.vendor}{row.rebuild.sentDate ? ` · ${thDate(row.rebuild.sentDate)}` : ""}</p>}
            <Field label="วันที่ได้ของคืน"><input type="date" className={inputCls} value={date} max={todayYmd()} onChange={(e) => setDate(e.target.value)} required /></Field>
            <Field label="หมายเหตุ (ถ้ามี)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น เข้าสต๊อกแล้ว" /></Field>
            <Footer busy={busy} onCancel={onClose} label="บันทึก Rebuild เสร็จ" error={error} />
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function FollowUpDialog({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: Done }) {
  const [note, setNote] = useState("")
  const [next, setNext] = useState("")
  const { busy, error, submit } = useSubmit(row ? rowUrl(row.row_key, "follow-up") : "", onDone, onClose)
  const ft = row ? followText(row.followUp) : null
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="follow-dialog">
        <DialogHeader><DialogTitle>ติดตามซาก</DialogTitle></DialogHeader>
        {row && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit({ note, nextDate: next || null }) }}>
            <RowHead row={row} />
            <p className="text-xs text-gray-500">{ft ?? "ยังไม่เคยตาม"}{row.followUp?.lastNote ? ` · "${row.followUp.lastNote}"` : ""}</p>
            <Field label="ตามอะไร กับใคร"><textarea className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น โทรหาหัวหน้าช่าง บอกจะส่งพรุ่งนี้" required /></Field>
            <Field label="ตามอีกครั้งวันที่ (ถ้ามี)"><input type="date" className={inputCls} value={next} min={todayYmd()} onChange={(e) => setNext(e.target.value)} /></Field>
            <Footer busy={busy} onCancel={onClose} label="บันทึกการตาม" error={error} />
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

type Hist = { seq: number; action: string; from: CoreStatus | null; to: CoreStatus | null; actor: { name: string; email: string }; at: string; note?: string; data?: Record<string, unknown> }
const ACTION: Record<string, string> = { create: "สร้างจากใบเบิก", return: "คืนซาก", sold: "ขายแล้ว", rebuilt: "Rebuild เสร็จ", follow_up: "ติดตาม", round_add: "เข้ารอบขาย", round_cancel: "ยกเลิกรอบขาย" }
const CHOICE_TH: Record<string, string> = { sell: "S1 ขายซาก", rebuild: "Rebuild ซ่อม", no_core: "ไม่มีซากคืน" }

function histDetail(h: Hist): string {
  const d = h.data ?? {}
  const parts: string[] = []
  if (h.action === "return") {
    parts.push(CHOICE_TH[String(d.choice)] ?? String(d.choice))
    if (d.qty) parts.push(`${d.qty} ชิ้น`)
    if (d.scrapInDate) parts.push(`เข้าคลังซาก ${thDate(String(d.scrapInDate))}`)
    if (d.rebuildVendor) parts.push(`ส่ง ${d.rebuildVendor}`)
    if (d.noCoreReason) parts.push(String(d.noCoreReason))
    if (d.shortReason) parts.push(`คืนไม่ครบ: ${d.shortReason}`)
  }
  if (h.action === "sold") { if (d.soldDate) parts.push(thDate(String(d.soldDate))); if (d.price != null) parts.push(`${baht(Number(d.price))} บาท`); if (d.roundNo) parts.push(String(d.roundNo)) }
  if (h.action === "follow_up" && d.nextDate) parts.push(`ตามอีก ${thDate(String(d.nextDate))}`)
  if ((h.action === "round_add" || h.action === "round_cancel") && d.roundNo) parts.push(String(d.roundNo))
  if (h.action === "create" && d.swNo) parts.push(String(d.swNo))
  if (h.note) parts.push(h.note)
  return parts.join(" · ")
}

export function DetailDrawer({ rowKey, onClose }: { rowKey: string | null; onClose: () => void }) {
  const { data, error } = useFetch<{ row: Row; history: Hist[]; chain: { ok: boolean; brokenAt?: number } }>(rowKey ? rowUrl(rowKey) : null)
  if (!rowKey) return null
  const r = data?.row
  const info: [string, React.ReactNode][] = r ? [
    ["วันที่เบิก", thDate(r.issuedDate)], ["คลัง", r.warehouse ?? "-"], ["WD", r.wdCode ?? "-"], ["MR", r.mrCode ?? "-"],
    ["ทะเบียน", `${r.plate ?? "-"}${r.vehicleNo ? ` (${r.vehicleNo})` : ""}`], ["พจส.", r.driver ?? "-"], ["จุดประสงค์", r.purpose ?? "-"],
    ["สินค้า", `${r.skuCode ?? ""} ${r.skuName ?? ""}`], ["กลุ่มสินค้า", r.productGroup ?? "-"], ["จำนวน / ยอดเงิน", `${qtyText(r.qtyIssued)} · ${baht(r.amount)} บาท`],
    ...(r.requester ? [["ผู้เบิก (WMS)", `${r.requester.name}${r.swNo ? ` · ${r.swNo}` : ""}`] as [string, string]] : []),
    ...(r.mrItemLabel ? [["ประเภทการซ่อม", r.mrItemLabel] as [string, string]] : []),
    ...(r.legacyRound ? [["ไฟล์ติดตามเดิม", `${r.legacyRound}${r.legacyNote ? ` · ${r.legacyNote}` : ""}`] as [string, string]] : []),
    ...(r.sale?.scrapInDate ? [["เข้าคลังซาก", thDate(r.sale.scrapInDate)] as [string, string]] : []),
    ...(r.saleRoundNo ? [["รอบขาย", r.saleRoundNo] as [string, string]] : []),
    ...(r.followUp?.count ? [["การตาม", `${followText(r.followUp)}${r.followUp.nextDate ? ` · ตามอีก ${thDate(r.followUp.nextDate)}` : ""}`] as [string, string]] : []),
  ] : []
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="รายละเอียดซาก" data-testid="drawer">
      <button type="button" aria-label="ปิด" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-xl dark:bg-[#12151c]">
        <div className="flex items-center justify-between border-b border-[#EEF2F0] px-4 py-3 dark:border-white/10">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">รายละเอียดซาก</h2>
          <button type="button" onClick={onClose} aria-label="ปิด" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {!data && !error && <div className="h-40 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5" />}
          {r && (
            <>
              <div className="flex flex-wrap items-center gap-2"><CoreChip status={r.coreStatus} />{r.legacyRound && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800">{r.legacyRound}</span>}</div>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
                {info.map(([k, v]) => (<Fragment key={k}><dt className="text-gray-500">{k}</dt><dd className="break-words text-gray-900 dark:text-gray-100">{v}</dd></Fragment>))}
              </dl>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">ประวัติ</h3>
                  {data.chain.ok
                    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800"><ShieldCheck size={13} />บันทึกครบ ไม่ถูกแก้</span>
                    : <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800"><ShieldAlert size={13} />พบความผิดปกติ</span>}
                </div>
                {data.history.length === 0 ? <p className="text-sm text-gray-500">ยังไม่มีการบันทึก</p> : (
                  <ol className="space-y-2 border-l-2 border-[#E2E8E4] pl-3 dark:border-white/10">
                    {data.history.map((h) => (
                      <li key={h.seq} className="text-sm">
                        <p className="font-medium text-gray-900 dark:text-white">{ACTION[h.action] ?? h.action}{h.to && h.from !== h.to ? ` → ${STATUS_LABEL[h.to]}` : ""}</p>
                        <p className="text-xs text-gray-500">{thDateTime(h.at)} · {h.actor.name}</p>
                        {histDetail(h) && <p className="mt-0.5 text-xs text-gray-700 dark:text-gray-300">{histDetail(h)}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
