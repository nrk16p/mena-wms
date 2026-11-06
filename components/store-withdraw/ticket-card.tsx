"use client"

import { useState } from "react"
import { AlertTriangle, Clock, Flag, Loader2, Paperclip, Truck, Undo2, User } from "lucide-react"
import { WORK_TYPE_LABEL, isPendingFlow, waitMinutes, workTypeFromKind } from "@/lib/store-withdraw/core"
import { lateMinutes, lateText, leftoverTotal } from "@/lib/store-withdraw/pending"
import { DOC_LABEL } from "./doc-ref-types"
import { StatusChip } from "./status-chip"
import { SummaryView } from "./summary-dialog"
import { itemKey, type QItem, type QKeyed } from "./queue-types"

export const WAIT_WARN_MIN = 30
const STUCK_MS = 5 * 60_000

export type BusyKind = "issue" | "other"
export type ColKey = "NEW" | "PREPARING" | "READY" | "DONE_TODAY" | "HANDED_OUT"

export type CardActions = {
  claim: (i: QItem) => void
  prepare: (i: QItem) => void
  issue: (i: QItem) => void
  reject: (i: QItem) => void
  /** ปิดใบที่ WD เกิดใน ATMS แล้วแต่ไปต่อไม่ได้ (แก้ใน ATMS เองแล้ว) */
  closeManual: (i: QItem) => void
  acceptReturn: (i: QItem) => void
  /** Mobile/PM: ตัดสต๊อกหลังช่างสรุป (returnConfirmed = ติ๊กรับของคืนแล้ว) */
  settle: (i: QItem, returnConfirmed: boolean) => void
  /** เปิดดูการ์ด — คิวใช้ตรวจใบกับ ATMS (ไม่บังคับ) */
  open?: (i: QItem) => void
}

const btn = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
const primaryCls = `${btn} flex-1 border border-[#17793F] bg-[#17793F] font-semibold text-white hover:bg-[#126433]`
const ghostCls = `${btn} border border-[#D5DCD8] bg-white text-[#2B3D32] hover:border-red-300 hover:text-red-700 dark:border-white/10 dark:bg-transparent dark:text-gray-200`
const docBtn = "font-mono font-semibold text-[#14271C] underline decoration-[#C9D1CC] underline-offset-[3px] hover:decoration-[#17793F] dark:text-white dark:decoration-white/20"

export const hm = (iso: string) => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
}

export const dmhm = (iso: string | Date | null | undefined) => {
  if (!iso) return "-"
  const d = new Date(iso)
  return isNaN(d.getTime()) ? "-" : d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export function waitText(min: number) {
  if (min < 60) return `รอ ${min} นาที`
  return `รอ ${Math.floor(min / 60)} ชม. ${min % 60} นาที`
}

export const kindLabel = (i: QItem) => (i.itemType === "return" && i.return ? "ขอคืนอะไหล่" : i.kind === "cutoff" ? "เบิกตัดยอด" : "เบิกจากสต๊อก")
export const workLabel = (i: QItem) => WORK_TYPE_LABEL[i.workType ?? workTypeFromKind(i.kind)]

/** สถานะที่การ์ดกับแผงรายละเอียดใช้ร่วมกัน */
export function cardState(item: QItem, now: Date, busy: BusyKind | null, column: ColKey) {
  const isReturn = item.itemType === "return" && !!item.return
  const ret = item.return
  const done = column === "DONE_TODAY"
  const waiting = column === "HANDED_OUT" // ของออกไปแล้ว รอช่างสรุป — ไม่ใช่งานสโตร์
  // Mobile/PM ที่ช่างสรุปแล้ว: ตัดสต๊อก (WD ต่อทะเบียน) · error/progress อยู่ในกลุ่ม
  const settleItem = !isReturn && isPendingFlow(item) && (item.status === "SUMMARIZED" || item.status === "SETTLING" || item.status === "SETTLE_FAILED")
  const showSummary = !isReturn && !!item.summary && (settleItem || item.status === "SETTLED")
  const groupErr = (item.settleGroups ?? []).find((g) => g.status !== "DONE" && g.atms.error)?.atms.error ?? null
  const mins = waitMinutes(new Date(item.createdAt), now)
  const failed = isReturn ? ret!.status === "RETURN_FAILED" : item.status === "ISSUE_FAILED" || item.status === "SETTLE_FAILED"
  const issuing = busy === "issue" || (isReturn ? ret!.status === "RETURNING" : item.status === "ISSUING" || item.status === "SETTLING")
  // ยิง ATMS ไปแล้วไม่ได้คำตอบ: ใบค้าง ISSUING พร้อมข้อความ · ปุ่มลองใหม่เปิดเมื่อครบ 5 นาที (stale) กันตัดซ้ำ
  const stale = !busy && issuing && now.getTime() - new Date(item.updatedAt).getTime() > STUCK_MS
  const atms = isReturn ? ret!.atms : settleItem ? { ...item.atms, error: groupErr } : item.atms
  const unknown = !busy && issuing && !!atms.error
  return {
    isReturn, ret, done, waiting, settleItem, showSummary, failed, issuing, stale, unknown, atms, mins,
    late: !done && !waiting && mins > WAIT_WARN_MIN,
    dueLate: lateMinutes(item, now),
    leftover: leftoverTotal(item.summary),
    showError: failed || unknown,
  }
}
export type CardState = ReturnType<typeof cardState>

/** ปุ่มของการ์ด/แผงรายละเอียด ตามสถานะใบ (ใบที่ส่งแล้ว/รอช่างสรุปไม่มีปุ่ม — ผู้เรียกไม่ต้อง render) */
export function ActionBar({ item, st, busy, actions, size = "md" }: { item: QItem; st: CardState; busy: BusyKind | null; actions: CardActions; size?: "md" | "lg" }) {
  const [returnOk, setReturnOk] = useState(false)
  const h = size === "lg" ? "min-h-11" : "min-h-10"
  const primary = `${primaryCls} ${h}`
  const ghost = `${ghostCls} ${h}`
  const { isReturn, failed, issuing, stale, unknown, settleItem, leftover } = st

  if (busy === "other") return <span data-testid="working" className={`inline-flex ${h} items-center gap-1.5 text-sm text-[#4A5A50]`}><Loader2 size={14} className="animate-spin" />กำลังทำรายการ</span>
  if (unknown && !stale) return <button type="button" data-testid="retry-wait" className={`${primary} w-full`} disabled title="รอครบ 5 นาทีก่อนลองใหม่">ลองใหม่ (รอครบ 5 นาที)</button>
  if (issuing && !stale) {
    return (
      <span data-testid="issuing" className={`flex ${h} w-full items-center gap-2 rounded-lg bg-violet-50 px-3 text-[13px] font-medium text-violet-800 dark:bg-violet-500/10 dark:text-violet-300`}>
        <Loader2 size={15} className="animate-spin" />กำลังตัดใน ATMS · รอผล
      </span>
    )
  }
  if (isReturn) return <div className="flex gap-2"><button type="button" className={primary} onClick={() => actions.acceptReturn(item)}>{failed || stale ? "ลองใหม่" : "รับคืน"}</button></div>
  if (settleItem) {
    return (
      <div className="flex w-full flex-col gap-2 rounded-lg border border-sky-200 bg-sky-50/70 p-2.5 dark:border-sky-500/30 dark:bg-sky-500/10">
        {leftover > 0 && (
          <label className="flex min-h-8 cursor-pointer items-center gap-2 text-[13px] text-[#14271C] dark:text-gray-200">
            <input type="checkbox" data-testid="return-ok" checked={returnOk} onChange={(e) => setReturnOk(e.target.checked)} className="h-[18px] w-[18px] accent-[#17793F]" />
            รับของคืนแล้ว ({leftover})
          </label>
        )}
        <button type="button" data-testid="settle" className={primary} disabled={leftover > 0 && !returnOk} onClick={() => actions.settle(item, returnOk)}>
          {failed || stale ? "ลองใหม่" : "ตัดสต๊อก"}
        </button>
      </div>
    )
  }
  if (failed || stale) {
    return (
      <div className="flex gap-2">
        <button type="button" className={primary} onClick={() => actions.issue(item)}>ลองใหม่</button>
        {failed && (item.atms.gmId == null
          ? <button type="button" className={ghost} onClick={() => actions.reject(item)}>ปฏิเสธ</button>
          : <button type="button" data-testid="close-manual" className={ghost} onClick={() => actions.closeManual(item)}>ปิดใบ (แก้ใน ATMS แล้ว)</button>)}
      </div>
    )
  }
  const main = item.status === "NEW"
    ? item.kind === "cutoff" ? { label: "ตัดยอด", run: actions.issue } : { label: "รับงาน", run: actions.claim }
    : item.status === "PREPARING" ? { label: "จัดของ", run: actions.prepare }
    : item.status === "READY" ? { label: "ส่งของ", run: actions.issue }
    : null
  if (!main) return null
  return (
    <div className="flex gap-2">
      <button type="button" className={primary} onClick={() => main.run(item)}>{main.label}</button>
      <button type="button" className={ghost} onClick={() => actions.reject(item)}>ปฏิเสธ</button>
    </div>
  )
}

function WaitChip({ st, item }: { st: CardState; item: QItem }) {
  if (st.waiting) {
    return st.dueLate > 0
      ? <span data-testid="due-late" className="inline-flex h-[22px] items-center whitespace-nowrap rounded-full bg-red-700 px-2 text-xs font-semibold text-white">เลยกำหนดสรุป {lateText(st.dueLate)}</span>
      : <span data-testid="due" className="whitespace-nowrap text-xs tabular-nums text-[#4A5A50] dark:text-gray-400">สรุปภายใน {dmhm(item.summaryDueAt)}</span>
  }
  return (
    <span data-testid="wait" data-late={st.late ? "1" : "0"}
      className={`inline-flex items-center gap-1 whitespace-nowrap text-xs tabular-nums ${st.late ? "h-[22px] rounded-full bg-amber-100 px-2 font-semibold text-amber-900 dark:bg-amber-500/20 dark:text-amber-200" : "text-[#4A5A50] dark:text-gray-400"}`}>
      <Clock size={12} aria-hidden="true" />{waitText(st.mins)}
    </span>
  )
}

export function AtmsAlerts({ st }: { st: CardState }) {
  return (
    <>
      {st.atms.drift && (
        <p data-testid="atms-drift" className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <Flag size={14} className="mt-0.5 shrink-0" /><span><b>ATMS ถูกแก้</b> · {st.atms.drift}</span>
        </p>
      )}
      {st.showError && (
        <p role="alert" data-testid="atms-error" className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{st.atms.error || "ส่ง ATMS ไม่สำเร็จ กดลองใหม่"}</span>
        </p>
      )}
    </>
  )
}

export function TicketCard({ item, now, busy, actions, column, selected = false, onSelect }: {
  item: QItem; now: Date; busy: BusyKind | null; actions: CardActions; column: ColKey
  selected?: boolean
  /** กดเลขใบ = เปิดแผงรายละเอียด (ไม่ส่งมา = แค่ตรวจใบกับ ATMS) */
  onSelect?: (i: QItem) => void
}) {
  const st = cardState(item, now, busy, column)
  const { isReturn, ret } = st
  const select = () => (onSelect ? onSelect(item) : actions.open?.(item))
  const frame = selected
    ? "border-[#17793F] ring-[3px] ring-[#17793F]/20"
    : st.failed ? "border-red-300 ring-[3px] ring-red-500/10 dark:border-red-500/50" : "border-[#DDE3E0] dark:border-white/10"
  const base = `rounded-[10px] border bg-white p-3 text-[13px] leading-[1.45] text-[#14271C] shadow-[0_1px_2px_rgba(20,39,28,.06)] dark:bg-[#161922] dark:text-gray-100 ${frame}`
  const dataAttrs = { "data-testid": "ticket", "data-no": item.no, "data-kind": isReturn ? "return" : item.kind, "data-status": isReturn ? ret!.status : item.status }

  // ส่งแล้ววันนี้: การ์ดย่อ เลขใบ · เลข WD · เวลา
  if (st.done) {
    return (
      <li {...dataAttrs} className={base}>
        <div className="flex items-baseline gap-2">
          {isReturn && <Undo2 size={13} className="shrink-0 self-center text-[#5B3AA8]" aria-label="ใบคืน" />}
          <button type="button" onClick={select} className={`${docBtn} text-[13px]`}>{item.no}</button>
          {item.plate && <span className="truncate text-xs text-[#2B3D32] dark:text-gray-300">{item.plate}</span>}
          <span className="ml-auto shrink-0 text-xs tabular-nums text-[#4A5A50] dark:text-gray-400">{hm(item.updatedAt)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {st.atms.code && <span className="text-xs text-[#4A5A50] dark:text-gray-400">{isReturn ? "DD" : "WD"} <span data-testid="wd-code" className="font-mono font-semibold text-[#2B3D32] dark:text-gray-200">{st.atms.code}</span></span>}
          <span className="ml-auto"><StatusChip status={item.status} /></span>
        </div>
        {item.status === "REJECTED" && item.rejectReason && <p className="mt-1.5 line-clamp-2 text-xs text-[#4A5A50] dark:text-gray-400">เหตุผล: {item.rejectReason}</p>}
        {st.atms.drift && <div className="mt-2"><AtmsAlerts st={{ ...st, showError: false }} /></div>}
      </li>
    )
  }

  const lines = isReturn
    ? ret!.lines.map((l) => ({ key: l.lineIndex, name: item.lines[l.lineIndex]?.skuName ?? "?", mr: "", qtyText: `คืน ${l.qty}` }))
    : item.lines.map((l, li) => ({
        key: `${l.skuId}-${li}`, name: l.skuName,
        mr: l.mrItemLabel ? l.mrItemLabel.replace(/^\S*MR\S*\d\s+/i, "").replace(/\s*:\s*\d+$/, "") : "",
        qtyText: `${l.issuedQty != null && l.issuedQty !== l.requestedQty ? `${l.issuedQty}/` : ""}${l.requestedQty}${l.short ? " (ขาด)" : ""}`,
      }))
  const attach = item.attachCount ?? 0

  return (
    <li {...dataAttrs} className={`${base} flex flex-col gap-2.5`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {item.urgent && <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-red-700 px-2 text-xs font-semibold text-white"><Truck size={13} aria-hidden="true" />รถจอดรอ</span>}
        {isReturn && <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-violet-100 px-2 text-xs font-semibold text-[#5B3AA8] dark:bg-violet-500/15 dark:text-violet-300"><Undo2 size={13} aria-hidden="true" />ใบคืน</span>}
        <span className="text-xs text-[#4A5A50] dark:text-gray-400">{kindLabel(item)}</span>
        {!isReturn && <span data-testid="worktype" className="inline-flex h-5 items-center rounded bg-[#E8F3EC] px-1.5 text-[11.5px] font-semibold text-[#14532D] dark:bg-emerald-500/10 dark:text-emerald-300">{workLabel(item)}</span>}
        <span className="ml-auto"><WaitChip st={st} item={item} /></span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <button type="button" onClick={select} aria-label={`เปิดรายละเอียด ${item.no}`} className={`${docBtn} text-sm`}>{item.no}</button>
        {item.plate && <span className="text-[13px] text-[#2B3D32] dark:text-gray-300">ทะเบียน {item.plate}</span>}
      </div>

      {isReturn && ret!.reason && <p data-testid="return-reason" className="break-words text-[12.5px] text-[#5B3AA8] dark:text-violet-300">เหตุผลที่คืน: {ret!.reason}</p>}

      {st.showSummary ? <SummaryView req={item} compact /> : (
        <ul className="space-y-1 border-t border-[#EDF1EE] pt-2 dark:border-white/10">
          {lines.slice(0, 3).map((l) => (
            <li key={l.key} className="flex items-start justify-between gap-2.5">
              <span className="min-w-0">
                <span className="block truncate text-[#1F3328] dark:text-gray-100">{l.name}</span>
                {l.mr && <span data-testid="mr-type" className="block truncate text-[11.5px] text-[#157A40] dark:text-emerald-400">{l.mr}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-[#2B3D32] dark:text-gray-300">{l.qtyText}</span>
            </li>
          ))}
          {lines.length > 3 && <li><button type="button" onClick={select} className="text-xs text-[#4A5A50] hover:text-[#157A40] dark:text-gray-400">+ อีก {lines.length - 3} รายการ</button></li>}
        </ul>
      )}
      {item.remark && !isReturn && <p className="line-clamp-2 text-xs text-[#4A5A50] dark:text-gray-400">หมายเหตุ: {item.remark}</p>}

      {st.atms.code && <p className="text-xs text-[#4A5A50] dark:text-gray-400">เลข {isReturn ? "DD" : "WD"} <span data-testid="wd-code" className="font-mono font-semibold text-[#2B3D32] dark:text-gray-200">{st.atms.code}</span></p>}
      <AtmsAlerts st={st} />
      {st.waiting && <span className="self-start"><StatusChip status={item.status} /></span>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#EDF1EE] pt-2 text-xs text-[#4A5A50] dark:border-white/10 dark:text-gray-400">
        <span className="inline-flex items-center gap-1"><User size={12} aria-hidden="true" />{item.requestedBy.name}</span>
        {item.mrCode && <span className="font-mono text-[11.5px]">{item.mrCode}</span>}
        {item.ref && <span data-testid="ref">อ้างอิง {DOC_LABEL[item.ref.type]} <span className="font-mono text-[11.5px]">{item.ref.code}</span></span>}
        {!isReturn && attach > 0 && (
          <button type="button" onClick={select} aria-label={`ไฟล์แนบ ${attach} ไฟล์`} className="inline-flex items-center gap-0.5 hover:text-[#157A40]"><Paperclip size={12} aria-hidden="true" />{attach}</button>
        )}
        {item.claimedBy && item.status !== "NEW" && !isReturn && <span className="ml-auto">จัดโดย {item.claimedBy.name}</span>}
      </div>

      {!st.waiting && <ActionBar item={item} st={st} busy={busy} actions={actions} />}
    </li>
  )
}

export function KeyedCard({ row }: { row: QKeyed }) {
  return (
    <li data-testid="keyed-ticket" className="rounded-[10px] border border-dashed border-[#B8C2BC] bg-[#F7F9F8] p-3 text-[#4A5A50] dark:border-white/15 dark:bg-white/5 dark:text-gray-400">
      <div className="flex items-baseline gap-2">
        <p className="font-mono text-[13px] font-semibold text-[#2B3D32] dark:text-gray-200">{row.code || "WD"}</p>
        <span className="ml-auto text-xs tabular-nums">{hm(row.created_at)}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="min-w-0 truncate text-xs">{[row.pick_to, row.user].filter(Boolean).join(" · ")}</span>
        <span className="ml-auto inline-flex h-[22px] shrink-0 items-center rounded-full bg-[#E2E6E4] px-2 text-xs font-semibold text-[#3F4B44] dark:bg-white/10 dark:text-gray-300">คีย์ใน ATMS</span>
      </div>
      {row.remark && <p className="mt-1 line-clamp-2 text-xs">{row.remark}</p>}
    </li>
  )
}

export { itemKey }
