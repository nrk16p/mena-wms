"use client"

// ชิ้นส่วนอะไหล่ Hub ที่คิวสโตร์ · แผงรายละเอียด · หน้าใบของฉันใช้ร่วมกัน
// ใบที่ไม่มี Hub (hubCount = 0) ไม่ render อะไรเลย
import { useState } from "react"
import { AlertTriangle } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { hubSentText } from "@/lib/store-withdraw/hub-core"
import { DocRefPicker } from "./doc-ref-picker"
import type { DocHit } from "./doc-ref-types"
import type { HubReq } from "./summary-dialog"

type HubItem = Pick<HubReq, "hubStatus" | "hubOverdue" | "hubCount" | "hubIssuedAt"> & { itemType?: "request" | "return" }

/** ใบที่ส่งของ Hub แล้วแต่ยังไม่ผูก PR */
export const waitPr = (i: HubItem) => i.itemType !== "return" && i.hubCount > 0 && (i.hubStatus === "WAIT_PR" || i.hubStatus === "WAIT_PR_WD")
export const waitHubWd = (i: HubItem) => i.hubCount > 0 && (i.hubStatus === "WAIT_WD" || i.hubStatus === "WAIT_PR_WD")

/** ป้ายบนการ์ด: Hub n · เกินกำหนด PR · รอตัด WD Hub */
export function HubBadges({ item }: { item: HubItem }) {
  if (!item.hubCount || item.itemType === "return") return null
  return (
    <>
      <span data-testid="hub-badge" className="inline-flex h-[22px] items-center rounded-full bg-sky-100 px-2 text-xs font-semibold text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">Hub {item.hubCount}</span>
      {item.hubOverdue && <span data-testid="hub-overdue" className="inline-flex h-[22px] items-center rounded-full bg-red-700 px-2 text-xs font-semibold text-white">เกินกำหนด PR</span>}
      {waitHubWd(item) && <span data-testid="hub-wait-wd" className="inline-flex h-[22px] items-center rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">รอตัด WD Hub</span>}
    </>
  )
}

/** บรรทัดบนการ์ดช่องส่งแล้ว: "ส่งแล้ววันนี้ → รอ PR อะไหล่ Hub" */
export function HubSentLine({ item, now }: { item: HubItem; now: Date }) {
  if (!waitPr(item) || !item.hubIssuedAt) return null
  return <p data-testid="hub-sent" className="mt-1.5 text-xs font-medium text-sky-800 dark:text-sky-300">{hubSentText(item.hubIssuedAt, now)} → รอ PR อะไหล่ Hub</p>
}

/** แถบบนจอคิว/ใบของฉัน: รอผูก PR อะไหล่ Hub n ใบ · เกินกำหนด m ใบ (n = 0 ไม่แสดง) */
export function HubBanner({ items, onShow, showing = false }: { items: HubItem[]; onShow?: () => void; showing?: boolean }) {
  const list = items.filter(waitPr)
  const n = list.length
  if (n === 0) return null
  const m = list.filter((i) => i.hubOverdue).length
  return (
    <div data-testid="hub-banner" role="status" className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] border py-2.5 pl-4 pr-3 text-[13.5px] ${m > 0 ? "border-red-300 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300" : "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300"}`}>
      <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
      <span className="flex-1">รอผูก PR อะไหล่ Hub {n} ใบ · เกินกำหนด {m} ใบ</span>
      {onShow && <button type="button" data-testid="hub-banner-show" onClick={onShow} className="min-h-9 rounded-lg border border-current px-3 text-[13px] font-semibold">{showing ? "ดูทั้งหมด" : "ดูเฉพาะใบเหล่านี้"}</button>}
    </div>
  )
}

/** ปุ่มผูก PR ขึ้นเมื่อใบมี Hub และยังไม่ปิด · ใบปิดแล้วที่ WD Hub ตัดไปแล้ว (WAIT_PR/DONE) ยังผูก/เปลี่ยนได้ */
export const canBindHubPr = (i: Pick<HubReq, "hubCount"> & { status: string; hubStatus?: HubReq["hubStatus"] }) =>
  i.hubCount > 0 && (i.status !== "REJECTED" && i.status !== "CANCELLED" || i.hubStatus === "WAIT_PR" || i.hubStatus === "DONE")

export function HubBindDialog({ no, plate, inventoryId, current, onClose, onDone }: {
  no: string; plate: string; inventoryId: number; current?: string | null; onClose: () => void; onDone: () => void
}) {
  const [picked, setPicked] = useState<DocHit | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!picked) return swalError("เลือก PR ก่อน")
    setBusy(true)
    try {
      const r = await fetch(`/api/store-withdraw/${encodeURIComponent(no)}/hub-pr`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: picked.code, id: picked.id }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "ผูก PR ไม่สำเร็จ ลองใหม่อีกครั้ง")
      await swalToast("success", `ผูก PR ${picked.code} แล้ว`)
      onDone()
    } catch (e) {
      swalError(e instanceof Error ? e.message : "ผูก PR ไม่สำเร็จ")
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>ผูก PR อะไหล่ Hub · {no}</DialogTitle></DialogHeader>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          {current ? `ตอนนี้ผูก PR ${current} อยู่ เลือกใบใหม่ถ้าจะเปลี่ยน` : "ค้นหา PR ที่เปิดเติมของ Hub แล้วเลือก"}
        </p>
        <DocRefPicker lockKind plate={plate} inventoryId={inventoryId} kind="pr" onKind={() => {}}
          picked={picked} onPick={setPicked} onClear={() => setPicked(null)} panelOpen={false} onTogglePanel={() => {}} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-[#E2E8E4] px-4 py-2.5 text-sm dark:border-white/10">ปิด</button>
          <button type="button" data-testid="hub-bind-submit" onClick={submit} disabled={busy || !picked} className="rounded-xl bg-[#1B8C4B] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">ผูก PR</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
