"use client"

// กล่องโต้ตอบของงานซาก: คืนซาก · บันทึกขายแล้ว · Rebuild เสร็จ · ติดตาม · รายละเอียด+ประวัติ
import { Fragment, useEffect, useState } from "react"
import { FileText, Paperclip, ShieldAlert, X } from "lucide-react"
import { AttachPicker, doneIds, isUploading, type Picked } from "@/components/store-withdraw/attach-picker"
import { NO_CORE_REASONS, OUTSTANDING, STATUS_LABEL, type CoreStatus } from "@/lib/core-return/core"
import {
  CoreChip, DateInput, DaysBadge, attachApi, baht, daysFrom, followText, inputCls, useFetch, postJson, qtyText, rowUrl, thDate, thDateTime, todayYmd, usePerms, type Att, type Row,
} from "./shared"
import { BORDER, FIELD, GROUND, TXT, K } from "./tokens"
import { Bar, Button, Modal, toast } from "./ui"

const settle = () => new Promise<void>((r) => setTimeout(r, 150))

/** กล่องสรุปรายการที่กำลังทำ */
function RowHead({ row }: { row: Row }) {
  return (
    <div className={`rounded-xl ${GROUND} px-3 py-2.5 text-sm`}>
      <p className={`font-semibold ${K["text-ink"]}`}>{row.skuName || row.skuCode}</p>
      <p className={`mt-0.5 text-xs ${TXT.muted}`}>
        {row.skuCode} · {row.plate || "-"}{row.vehicleNo ? ` (${row.vehicleNo})` : ""} · {row.wdCode || "-"} · เบิก {thDate(row.issuedDate)} · {qtyText(row.qtyIssued)} ชิ้น
      </p>
    </div>
  )
}

function Field({ label, children, hint, error }: { label: string; children: React.ReactNode; hint?: string; error?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={FIELD.label}>{label}</span>
      {children}
      {error ? <span role="alert" className={FIELD.error}>{error}</span> : hint && <span className={FIELD.hint}>{hint}</span>}
    </label>
  )
}

function Footer({ busy, wait, onCancel, label, error }: { busy: boolean; wait?: boolean; onCancel: () => void; label: string; error: string }) {
  return (
    <>
      {error && <p role="alert" className={`rounded-xl ${K["bg-cFBE4E2"]} px-3 py-2.5 text-sm font-semibold ${K["text-c9F1D12"]}`}>{error}</p>}
      <div className={`flex justify-end gap-2 border-t ${K["border-cEEF2F0"]} pt-3.5`}>
        <Button variant="ghost" size="lg" onClick={onCancel}>ยกเลิก</Button>
        <Button type="submit" size="lg" loading={busy} loadingText="กำลังบันทึก" disabled={wait} data-testid="dialog-submit">{label}</Button>
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
  { key: "sell", title: "S1 ซากมีมูลค่า", desc: "เข้าคลังซาก รอขาย" },
  { key: "rebuild", title: "A2 ของรีบิ้ว", desc: "ส่งรีบิ้ว กลับมาใช้ใหม่" },
  { key: "no_core", title: "S2 ซากไม่มีมูลค่า", desc: "ขายไม่ได้ / ของสิ้นเปลือง / เสียทิ้ง" },
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
  const [files, setFiles] = useState<Picked[]>([])
  const { busy, error, submit } = useSubmit(row ? rowUrl(row.row_key, "return") : "", onDone, onClose)
  const uploading = isUploading(files)
  const short = row?.qtyIssued != null && Number(qty) > 0 && Number(qty) < row.qtyIssued
  const over = row?.qtyIssued != null && Number(qty) > row.qtyIssued
  return (
    <Modal open={!!row} onClose={onClose} title="คืนซาก" testid="return-dialog">
        {row && (
          <form className="flex flex-col gap-3.5" onSubmit={(e) => {
            e.preventDefault()
            void submit({ choice, qty: choice === "no_core" ? undefined : qty, shortReason, scrapInDate: choice === "sell" ? scrapInDate : undefined, rebuildSentDate: sentDate || undefined, rebuildVendor: vendor, noCoreReason: reason, note, attachmentIds: doneIds(files) })
          }}>
            <RowHead row={row} />
            <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className={`mb-1.5 ${FIELD.label}`}>ซากนี้จะไปทางไหน</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup">
                {CHOICES.map((c) => (
                  <label key={c.key} data-choice={c.key}
                    className={`flex cursor-pointer flex-col gap-0.5 rounded-xl p-3 transition-colors focus-within:ring-2 ${K["focus-within:ring-primary"]} focus-within:ring-offset-2 ${choice === c.key ? `border-2 ${K["border-primary"]} ${K["bg-cF2FAF5"]}` : `border ${BORDER} bg-white ${K["hover:border-primary"]}`}`}>
                    <span className={`flex items-center gap-2 text-sm font-bold ${K["text-ink"]}`}>
                      <input type="radio" name="core-choice" value={c.key} checked={choice === c.key} onChange={() => setChoice(c.key)} className={`h-4 w-4 ${K["accent-primary"]}`} />{c.title}
                    </span>
                    <span className={`pl-6 text-xs ${TXT.muted}`}>{c.desc}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {choice && choice !== "no_core" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="จำนวนที่คืน" hint={`เบิกไป ${qtyText(row.qtyIssued)}`} error={over ? `เกินที่เบิก (เบิกไป ${qtyText(row.qtyIssued)})` : undefined}>
                  <input className={inputCls} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-invalid={over || undefined} />
                </Field>
                {choice === "sell" && (
                  <Field label="วันที่เข้าคลังซาก">
                    <DateInput value={scrapInDate} max={todayYmd()} onChange={setScrapInDate} required />
                  </Field>
                )}
                {choice === "rebuild" && <Field label="วันที่ส่งรีบิ้ว (ถ้ามี)"><DateInput value={sentDate} max={todayYmd()} onChange={setSentDate} /></Field>}
              </div>
            )}
            {choice === "sell" && <p className={`-mt-1.5 text-xs ${TXT.muted}`}>ซากจะรออยู่คลังซากจนถึงรอบขาย</p>}
            {choice && choice !== "no_core" && short && (
              <Field label="คืนไม่ครบ เพราะอะไร">
                <input className={inputCls} value={shortReason} onChange={(e) => setShortReason(e.target.value)} placeholder="เช่น อีกตัวแตก ทิ้งที่อู่" />
              </Field>
            )}
            {choice === "rebuild" && (
              <Field label="ส่งที่ไหน (ถ้ามี)"><input className={inputCls} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="ชื่ออู่/ร้าน" /></Field>
            )}
            {choice === "no_core" && (
              <Field label="ทำไมไม่มีมูลค่า">
                <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
                  {NO_CORE_REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </Field>
            )}
            {choice && (
              <Field label={choice === "no_core" && reason === "อื่นๆ" ? "หมายเหตุ (ต้องใส่)" : "หมายเหตุ (ถ้ามี)"}>
                <textarea className={FIELD.area} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            )}
            <div className="flex flex-col gap-1" data-testid="return-attach">
              <AttachPicker variant="tiles" no={row.row_key} apiBase={attachApi(row.row_key)} context="return" items={files} onChange={(f) => setFiles(f)} label="รูปซาก (ถ้ามี)" hint="ไม่เกิน 8 รูป · รูปละไม่เกิน 10 MB" />
              {files.length > 0 && <p className={`text-xs ${TXT.muted}`}>รูปที่แนบแล้วลบไม่ได้ ดูให้ตรงก่อนกดบันทึก</p>}
            </div>
            <Footer busy={busy} wait={uploading} onCancel={onClose} label={uploading ? "รอรูปอัปโหลด" : "บันทึกคืนซาก"} error={error || ""} />
          </form>
        )}
    </Modal>
  )
}

export function SoldDialog({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: Done }) {
  const [soldDate, setSoldDate] = useState(todayYmd())
  const [price, setPrice] = useState("")
  const [buyer, setBuyer] = useState("")
  const [note, setNote] = useState("")
  const { busy, error, submit } = useSubmit(row ? rowUrl(row.row_key, "sold") : "", onDone, onClose)
  return (
    <Modal open={!!row} onClose={onClose} title="บันทึกขายซากแล้ว">
        {row && (
          <form className="flex flex-col gap-3.5" onSubmit={(e) => { e.preventDefault(); void submit({ soldDate, price, buyer, note }) }}>
            <RowHead row={row} />
            <p className={`text-xs ${K["text-muted"]}`}>เข้าคลังซาก {thDate(row.sale?.scrapInDate)}</p>
            <Field label="วันที่ขาย"><DateInput value={soldDate} max={todayYmd()} onChange={setSoldDate} required /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="ราคาขาย (ถ้ามี)"><input className={inputCls} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="บาท" /></Field>
              <Field label="ผู้ซื้อ (ถ้ามี)"><input className={inputCls} value={buyer} onChange={(e) => setBuyer(e.target.value)} /></Field>
            </div>
            <Field label="หมายเหตุ (ถ้ามี)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <Footer busy={busy} onCancel={onClose} label="บันทึกขายแล้ว" error={error} />
          </form>
        )}
    </Modal>
  )
}

export function RebuiltDialog({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: Done }) {
  const [date, setDate] = useState(todayYmd())
  const [note, setNote] = useState("")
  const { busy, error, submit } = useSubmit(row ? rowUrl(row.row_key, "rebuilt") : "", onDone, onClose)
  return (
    <Modal open={!!row} onClose={onClose} title="A2 รีบิ้วเสร็จ">
        {row && (
          <form className="flex flex-col gap-3.5" onSubmit={(e) => { e.preventDefault(); void submit({ rebuiltDate: date, note }) }}>
            <RowHead row={row} />
            {row.rebuild?.vendor && <p className={`text-xs ${K["text-muted"]}`}>ส่งรีบิ้วที่ {row.rebuild.vendor}{row.rebuild.sentDate ? ` · ${thDate(row.rebuild.sentDate)}` : ""}</p>}
            <Field label="วันที่ได้ของคืน"><DateInput value={date} max={todayYmd()} onChange={setDate} required /></Field>
            <Field label="หมายเหตุ (ถ้ามี)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น เข้าสต๊อกแล้ว" /></Field>
            <Footer busy={busy} onCancel={onClose} label="บันทึกรีบิ้วเสร็จ" error={error} />
          </form>
        )}
    </Modal>
  )
}

export function FollowUpDialog({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: Done }) {
  const [note, setNote] = useState("")
  const [next, setNext] = useState("")
  const { busy, error, submit } = useSubmit(row ? rowUrl(row.row_key, "follow-up") : "", onDone, onClose)
  const ft = row ? followText(row.followUp) : null
  return (
    <Modal open={!!row} onClose={onClose} title="ติดตามซาก" testid="follow-dialog">
        {row && (
          <form className="flex flex-col gap-3.5" onSubmit={(e) => { e.preventDefault(); void submit({ note, nextDate: next || null }) }}>
            <RowHead row={row} />
            <p className={`text-xs ${K["text-muted"]}`}>{ft ?? "ยังไม่เคยตาม"}{row.followUp?.lastNote ? ` · "${row.followUp.lastNote}"` : ""}</p>
            <Field label="ตามอะไร กับใคร"><textarea className={FIELD.area} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น โทรหาหัวหน้าช่าง บอกจะส่งพรุ่งนี้" required /></Field>
            <Field label="ตามอีกครั้งวันที่ (ถ้ามี)"><DateInput value={next} min={todayYmd()} onChange={setNext} /></Field>
            <Footer busy={busy} onCancel={onClose} label="บันทึกการตาม" error={error} />
          </form>
        )}
    </Modal>
  )
}

export function BulkFollowDialog({ keys, onClose, onDone }: { keys: string[] | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("")
  const [next, setNext] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [res, setRes] = useState<{ ok: string[]; failed: { key: string; error: string }[] } | null>(null)
  const close = () => { const had = !!res?.ok.length; onClose(); if (had) onDone() }
  return (
    <Modal open={!!keys} onClose={close} title={`ติดตาม ${keys?.length ?? 0} รายการ`} testid="bulk-follow-dialog">
        {keys && !res && (
          <form className="flex flex-col gap-3.5" onSubmit={async (e) => {
            e.preventDefault(); setBusy(true); setError("")
            try { const r = await postJson("/api/core-return/bulk/follow-up", { keys, note, nextDate: next || null }); setRes(r); if (r.failed?.length) toast("error", `ติดตามไม่สำเร็จ ${r.failed.length} จาก ${keys.length} รายการ`) } catch (er) { setError(er instanceof Error ? er.message : "บันทึกไม่สำเร็จ") } finally { setBusy(false) }
          }}>
            <p className={`text-xs ${K["text-muted"]}`}>ข้อความและวันนัดเดียวกันจะบันทึกให้ทุกรายการที่เลือก</p>
            <Field label="ตามอะไร กับใคร"><textarea className={FIELD.area} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น โทรหาหัวหน้าช่าง บอกจะส่งพรุ่งนี้" required /></Field>
            <Field label="ตามอีกครั้งวันที่ (ถ้ามี)"><DateInput value={next} min={todayYmd()} onChange={setNext} /></Field>
            <Footer busy={busy} onCancel={onClose} label={`บันทึกการตาม ${keys.length} รายการ`} error={error} />
          </form>
        )}
        {res && (
          <div className="space-y-3" data-testid="bulk-result">
            <p className={`text-sm font-semibold ${K["text-ink"]}`}>สำเร็จ {res.ok.length} รายการ{res.failed.length ? ` · ไม่สำเร็จ ${res.failed.length} รายการ` : ""}</p>
            {res.failed.length > 0 && (
              <ul className={`max-h-40 space-y-1 overflow-y-auto rounded-xl ${K["bg-cFBE4E2"]} p-2.5 text-xs ${K["text-c9F1D12"]}`}>
                {res.failed.map((f) => <li key={f.key}>{f.key} · {f.error}</li>)}
              </ul>
            )}
            <div className={`flex justify-end border-t ${K["border-cEEF2F0"]} pt-3.5`}><Button size="lg" onClick={close}>ปิด</Button></div>
          </div>
        )}
    </Modal>
  )
}

type Hist = { seq: number; action: string; from: CoreStatus | null; to: CoreStatus | null; actor: { name: string; email: string }; at: string; note?: string; data?: Record<string, unknown> }
const ACTION: Record<string, string> = { create: "สร้างจากใบเบิก", return: "คืนซาก", sold: "ขายแล้ว", rebuilt: "รีบิ้วเสร็จ", follow_up: "ติดตาม", round_add: "เข้ารอบขาย", round_cancel: "ยกเลิกรอบขาย", attach: "แนบรูป" }
const CHOICE_TH: Record<string, string> = { sell: "S1 ซากมีมูลค่า", rebuild: "A2 ของรีบิ้ว", no_core: "S2 ซากไม่มีมูลค่า" }

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
  if (h.action === "attach" && d.filename) parts.push(String(d.filename))
  if (h.action === "sold") { if (d.soldDate) parts.push(thDate(String(d.soldDate))); if (d.price != null) parts.push(`${baht(Number(d.price))} บาท`); if (d.roundNo) parts.push(String(d.roundNo)) }
  if (h.action === "follow_up" && d.nextDate) parts.push(`ตามอีก ${thDate(String(d.nextDate))}`)
  if ((h.action === "round_add" || h.action === "round_cancel") && d.roundNo) parts.push(String(d.roundNo))
  if (h.action === "create" && d.swNo) parts.push(String(d.swNo))
  if (h.note) parts.push(h.note)
  return parts.join(" · ")
}

const isImg = (a: Att) => a.contentType.startsWith("image/") && a.contentType !== "image/heic"

function Thumbs({ items }: { items: Att[] }) {
  return (
    <ul className="mt-1.5 flex flex-wrap gap-2">
      {items.map((a) => (
        <li key={a.id}>
          <a href={a.url} target="_blank" rel="noopener noreferrer" title={`${a.filename} · ${a.by.name}`} data-testid="photo" className={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-[10px] border ${BORDER} ${K["bg-cDCE5DF"]} ${K["text-muted"]} focus-visible:outline-none focus-visible:ring-2 ${K["focus-visible:ring-primary"]}`}>
            {isImg(a)
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={a.url} alt={a.filename} className="h-full w-full object-cover" />
              : <span className="flex flex-col items-center text-[10px]"><FileText size={20} />{a.filename.split(".").pop()}</span>}
          </a>
        </li>
      ))}
    </ul>
  )
}

function AddPhotosDialog({ rowKey, onClose, onDone }: { rowKey: string; onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<Picked[]>([])
  const uploading = isUploading(files)
  const finish = () => { if (uploading) return; if (doneIds(files).length) onDone(); onClose() }
  return (
    <Modal open onClose={finish} title="แนบรูปเพิ่ม" testid="add-photos-dialog">
        <p className={`text-xs ${K["text-muted"]}`}>รูปที่แนบแล้วลบหรือแก้ไม่ได้ ดูให้ตรงก่อนแนบ</p>
        <AttachPicker no={rowKey} apiBase={attachApi(rowKey)} context="other" items={files} onChange={(f) => setFiles(f)} label="เลือกรูป" />
        <div className={`flex justify-end border-t ${K["border-cEEF2F0"]} pt-3.5`}><Button size="lg" disabled={uploading} onClick={finish}>เสร็จแล้ว</Button></div>
    </Modal>
  )
}

export type DrawerAct = "return" | "sold" | "rebuilt" | "follow"

/** ปุ่มที่คนนี้ทำได้กับแถวนี้ เรียงตามความสำคัญ: ตัวแรก = ปุ่มหลักในตาราง/การ์ด · ที่เหลืออยู่ในลิ้นชัก (ใช้ทั้งลิ้นชักและตาราง) · ฝั่ง API เช็กสิทธิ์ซ้ำเสมอ */
export function rowActions(r: Pick<Row, "coreStatus" | "saleRoundNo">, p: { ret: boolean; store: boolean; follow: boolean }): DrawerAct[] {
  const out: DrawerAct[] = []
  if (OUTSTANDING.includes(r.coreStatus) && p.ret) out.push("return")
  if (r.coreStatus === "sell_waiting" && p.store && !r.saleRoundNo) out.push("sold")
  if (r.coreStatus === "rebuild" && p.store) out.push("rebuilt")
  if (!CLOSED_SET.includes(r.coreStatus) && p.follow) out.push("follow")
  return out
}
const CLOSED_SET: CoreStatus[] = ["sold", "rebuilt", "no_core"]
export const ACT_LABEL: Record<DrawerAct, string> = { return: "คืนซาก", follow: "ติดตาม", sold: "บันทึกขายแล้ว", rebuilt: "รีบิ้วเสร็จ" }
/** สีปุ่มหลักตามทีมที่ทำ: ยานยนต์เขียว · สโตร์ฟ้า · จัดซื้อม่วง */
export const ACT_VARIANT: Record<DrawerAct, "primary" | "store" | "procure"> = { return: "primary", sold: "store", rebuilt: "store", follow: "procure" }

const DOT: Record<string, string> = {
  create: `${K["bg-primary"]}`, return: `${K["bg-vehicle"]}`, sold: `${K["bg-store"]}`, rebuilt: `${K["bg-c156C3A"]}`, follow_up: `${K["bg-procure"]}`, round_add: `${K["bg-store"]}`, round_cancel: `${K["bg-danger"]}`, attach: `${K["bg-muted"]}`,
}

export function DetailDrawer({ rowKey, onClose, onAct }: { rowKey: string | null; onClose: () => void; onAct?: (kind: DrawerAct, row: Row) => void }) {
  const [tick, setTick] = useState(0)
  const [adding, setAdding] = useState(false)
  const perms = usePerms()
  const { data, error } = useFetch<{ row: Row; history: Hist[]; chain: { ok: boolean; brokenAt?: number } }>(rowKey ? rowUrl(rowKey) : null, tick)
  const files = useFetch<{ items: Att[] }>(rowKey ? attachApi(rowKey) : null, tick)
  useEffect(() => {
    if (!rowKey) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !adding) onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [rowKey, adding, onClose])
  if (!rowKey) return null
  const atts = files.data?.items ?? []
  const byId = new Map(atts.map((a) => [a.id, a]))
  const r = data?.row
  const garageText = r ? (!r.garage || r.garage === "ไม่ทราบชื่ออู่" ? `${r.garageType || "อู่นอก"} (ไม่ทราบชื่อ)` : `${r.garageType || "อู่"} · ${r.garage}`) : ""
  const info: [string, React.ReactNode][] = r ? [
    ["WD / MR", `${r.wdCode ?? "-"} · ${r.mrCode ?? "-"}`],
    ["รถ", `${r.plate ?? "-"}${r.vehicleNo ? ` · ${r.vehicleNo}` : ""}`],
    ["อู่", garageText],
    ["จำนวน", `${qtyText(r.qtyIssued)} ชิ้น · ${baht(r.amount)} บาท`],
    ["วันที่เบิก", thDate(r.issuedDate)], ["คลัง", r.warehouse ?? "-"], ["พจส.", r.driver ?? "-"], ["จุดประสงค์", r.purpose ?? "-"],
    ["สินค้า", `${r.skuCode ?? ""} ${r.skuName ?? ""}`], ["กลุ่มสินค้า", r.productGroup ?? "-"],
    ...(r.requester ? [["ผู้เบิก (WMS)", `${r.requester.name}${r.swNo ? ` · ${r.swNo}` : ""}`] as [string, string]] : []),
    ...(r.mrItemLabel ? [["ประเภทการซ่อม", r.mrItemLabel] as [string, string]] : []),
    ...(r.legacyRound ? [["ไฟล์ติดตามเดิม", `${r.legacyRound}${r.legacyNote ? ` · ${r.legacyNote}` : ""}`] as [string, string]] : []),
    ...(r.sale?.scrapInDate ? [["เข้าคลังซาก", thDate(r.sale.scrapInDate)] as [string, string]] : []),
    ...(r.saleRoundNo ? [["รอบขาย", r.saleRoundNo] as [string, string]] : []),
    ...(r.followUp?.count ? [["การตาม", `${followText(r.followUp)}${r.followUp.nextDate ? ` · ตามอีก ${thDate(r.followUp.nextDate)}` : ""}`] as [string, string]] : []),
  ] : []
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="รายละเอียดซาก" data-testid="drawer">
      <button type="button" aria-label="ปิด" tabIndex={-1} className={`absolute inset-0 ${K["bg-ink/40"]}`} onClick={onClose} />
      <aside aria-label="รายละเอียดซาก" className={`absolute inset-y-0 right-0 flex w-full max-w-[400px] flex-col border-l ${BORDER} bg-white shadow-[-10px_0_30px_rgba(20,39,28,0.10)] sm:rounded-l-[18px]`}>
        <div className="flex items-center justify-between px-[18px] pb-2 pt-[18px]">
          <h2 className={`text-[17px] font-bold ${K["text-ink"]}`}>รายละเอียดซาก</h2>
          <button type="button" onClick={onClose} aria-label="ปิด" className={`flex h-11 w-11 items-center justify-center rounded-[10px] ${K["bg-ground"]} ${K["text-muted"]} ${K["hover:bg-cEEF1EF"]} focus-visible:outline-none focus-visible:ring-2 ${K["focus-visible:ring-primary"]} lg:h-9 lg:w-9`}><X size={16} aria-hidden /></button>
        </div>
        <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-[18px] pb-[18px] pt-2">
          {error && <p role="alert" className={`rounded-xl ${K["bg-cFBE4E2"]} px-3 py-2.5 text-sm font-semibold ${K["text-c9F1D12"]}`}>{error}</p>}
          {!data && !error && <div className="flex flex-col gap-3" role="status" aria-label="กำลังโหลด"><Bar w="w-2/5" h="h-6" /><Bar w="w-4/5" h="h-5" /><Bar h="h-24" /><Bar w="w-32" h="h-10" /></div>}
          {r && (
            <>
              <div className="flex flex-wrap items-center gap-2"><CoreChip status={r.coreStatus} />{OUTSTANDING.includes(r.coreStatus) && <DaysBadge days={daysFrom(r.issuedDate)} />}{r.legacyRound && <span className={`rounded-full ${K["bg-cFDF0DE"]} px-2.5 py-0.5 text-xs font-semibold ${K["text-c8A4B06"]}`}>{r.legacyRound}</span>}</div>
              <p className={`text-base font-bold ${K["text-ink"]}`}>{r.skuName || r.skuCode}</p>
              <dl className="m-0 grid grid-cols-[96px_1fr] gap-x-2.5 gap-y-1.5 text-[13px]">
                {info.map(([k, v]) => (<Fragment key={k}><dt className={TXT.muted}>{k}</dt><dd className={`m-0 break-words ${K["text-ink"]}`}>{v}</dd></Fragment>))}
              </dl>
              {(() => {
                const acts = onAct ? rowActions(r, perms) : []
                if (!acts.length && !perms.ret) return null
                return (
                  <div className="flex flex-wrap gap-2" data-testid="drawer-actions">
                    {acts.map((k, i) => (
                      <Button key={k} data-act={k} variant={i === 0 ? ACT_VARIANT[k] : "secondary"} onClick={() => onAct?.(k, r)}>{ACT_LABEL[k]}</Button>
                    ))}
                    {perms.ret && <Button variant="secondary" data-testid="add-photos" onClick={() => setAdding(true)}><Paperclip size={14} aria-hidden />แนบรูปเพิ่ม</Button>}
                  </div>
                )
              })()}
              <div data-testid="drawer-photos" className={`border-t ${K["border-cEEF2F0"]} pt-3`}>
                <h3 className={`inline-flex items-center gap-1 text-sm font-bold ${K["text-ink"]}`}><Paperclip size={13} aria-hidden />รูปแนบ{atts.length ? ` (${atts.length})` : ""}</h3>
                {files.error && <p className={`mt-1 text-xs ${K["text-danger"]}`}>{files.error}</p>}
                {!files.error && !files.data && <div className="mt-2 flex gap-2" role="status" aria-label="กำลังโหลดรูป"><Bar w="w-16" h="h-16" className="rounded-[10px]" /><Bar w="w-16" h="h-16" className="rounded-[10px]" /></div>}
                {files.data && (atts.length ? <Thumbs items={atts} /> : <p className={`mt-1 text-xs ${TXT.muted}`}>ยังไม่มีรูปแนบ</p>)}
              </div>
              <div className={`flex flex-col gap-2.5 border-t ${K["border-cEEF2F0"]} pt-3`}>
                <div className="flex items-center justify-between">
                  <h3 className={`text-sm font-bold ${K["text-ink"]}`}>ประวัติ</h3>
                  {data.chain.ok
                    ? <span className={`text-xs font-semibold ${K["text-c156C3A"]}`}>บันทึกครบ ไม่ถูกแก้</span>
                    : <span className={`inline-flex items-center gap-1 rounded-full ${K["bg-cFBE4E2"]} px-2 py-0.5 text-xs font-semibold ${K["text-c9F1D12"]}`}><ShieldAlert size={13} aria-hidden />พบความผิดปกติ</span>}
                </div>
                {data.history.length === 0 ? <p className={`text-sm ${TXT.muted}`}>ยังไม่มีการบันทึก</p> : (
                  <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
                    {data.history.map((h) => (
                      <li key={h.seq} className="flex gap-2.5 text-[13px]">
                        <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[h.action] ?? `${K["bg-muted"]}`}`} />
                        <div className="min-w-0">
                          <p className="m-0"><b>{ACTION[h.action] ?? h.action}{h.to && h.from !== h.to ? ` → ${STATUS_LABEL[h.to]}` : ""}</b>{histDetail(h) && <span className={`${K["text-c33433A"]}`}> · {histDetail(h)}</span>}</p>
                          <p className={`m-0 text-xs ${TXT.muted}`}>{thDateTime(h.at)} · {h.actor.name}</p>
                          {h.action === "return" && Array.isArray(h.data?.attachmentIds) && (() => {
                            const mine = (h.data!.attachmentIds as string[]).map((id) => byId.get(id)).filter((x): x is Att => !!x)
                            return mine.length ? <Thumbs items={mine} /> : null
                          })()}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
      {adding && <AddPhotosDialog rowKey={rowKey} onClose={() => setAdding(false)} onDone={() => setTick((t) => t + 1)} />}
    </div>
  )
}
