"use client"

import { AlertTriangle, Flag, Loader2, Undo2 } from "lucide-react"
import { waitMinutes } from "@/lib/store-withdraw/core"
import { StatusChip } from "./status-chip"
import { itemKey, type QItem, type QKeyed } from "./queue-types"

export const WAIT_WARN_MIN = 30
const STUCK_MS = 5 * 60_000

export type BusyKind = "issue" | "other"

export type CardActions = {
  claim: (i: QItem) => void
  prepare: (i: QItem) => void
  issue: (i: QItem) => void
  reject: (i: QItem) => void
  acceptReturn: (i: QItem) => void
  /** เปิดดูการ์ด — คิวใช้ตรวจใบกับ ATMS (ไม่บังคับ) */
  open?: (i: QItem) => void
}

const btn = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-60"
const primary = `${btn} bg-[#1B8C4B] text-white hover:bg-[#157a40]`
const ghost = `${btn} border border-[#E2E8E4] text-gray-700 hover:text-red-600 dark:border-white/10 dark:text-gray-200`

const hm = (iso: string) => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
}

function waitText(min: number) {
  if (min < 60) return `รอ ${min} นาที`
  return `รอ ${Math.floor(min / 60)} ชม. ${min % 60} นาที`
}

export function TicketCard({ item, now, busy, actions, column }: {
  item: QItem; now: Date; busy: BusyKind | null; actions: CardActions; column: "NEW" | "PREPARING" | "READY" | "DONE_TODAY"
}) {
  const isReturn = item.itemType === "return" && !!item.return
  const ret = item.return
  const done = column === "DONE_TODAY"
  const mins = waitMinutes(new Date(item.createdAt), now)
  const late = !done && mins > WAIT_WARN_MIN
  const atms = isReturn ? ret!.atms : item.atms
  const failed = isReturn ? ret!.status === "RETURN_FAILED" : item.status === "ISSUE_FAILED"
  const issuing = busy === "issue" || (isReturn ? ret!.status === "RETURNING" : item.status === "ISSUING")
  const stale = !busy && issuing && now.getTime() - new Date(item.updatedAt).getTime() > STUCK_MS

  const stripe = item.urgent && !done ? "border-l-red-500" : isReturn ? "border-l-purple-500" : "border-l-transparent"
  const tone = failed
    ? "border-red-400 ring-1 ring-red-300 bg-white dark:bg-[#161922]"
    : isReturn
      ? "border-purple-200 bg-purple-50/60 dark:border-purple-500/30 dark:bg-purple-500/10"
      : "border-[#EEF2F0] bg-white dark:border-white/10 dark:bg-[#161922]"

  const lines = isReturn
    ? ret!.lines.map((l) => ({ key: l.lineIndex, name: item.lines[l.lineIndex]?.skuName ?? "?", sub: item.lines[l.lineIndex]?.skuCode ?? "", qtyText: `คืน ${l.qty}` }))
    : item.lines.map((l) => ({
        key: l.skuId, name: l.skuName, sub: l.skuCode,
        qtyText: `${l.issuedQty != null && l.issuedQty !== l.requestedQty ? `${l.issuedQty}/` : ""}${l.requestedQty}${l.short ? " (ขาด)" : ""}`,
      }))

  return (
    <li data-testid="ticket" data-no={item.no} data-kind={isReturn ? "return" : item.kind} data-status={isReturn ? ret!.status : item.status}
      className={`rounded-2xl border border-l-4 p-3.5 ${stripe} ${tone}`}>
      <div className="flex items-start justify-between gap-2" onClick={() => actions.open?.(item)}>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm font-semibold text-gray-900 dark:text-white">
            {isReturn && <Undo2 size={14} className="text-purple-600" aria-label="ใบคืน" />}
            <span>{item.no}</span>
            <span className="font-normal text-gray-500">· {item.plate}</span>
          </p>
          <p className="text-xs text-gray-500">
            {isReturn ? "ขอคืนอะไหล่" : item.kind === "cutoff" ? "เบิกตัดยอด" : "เบิกจากสต๊อก"}
            {item.mrCode && ` · ${item.mrCode}`} · {item.requestedBy.name}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {item.urgent && !done && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">รถจอดรอ</span>}
          {done
            ? <span className="text-xs text-gray-500">{hm(item.updatedAt)}</span>
            : <span data-testid="wait" data-late={late ? "1" : "0"} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${late ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" : "text-gray-500"}`}>{waitText(mins)}</span>}
        </div>
      </div>

      <ul className="mt-2 divide-y divide-[#EEF2F0] text-sm dark:divide-white/10">
        {lines.slice(0, 5).map((l) => (
          <li key={l.key} className="flex items-start justify-between gap-3 py-1">
            <span className="min-w-0"><span className="block truncate text-gray-900 dark:text-white">{l.name}</span><span className="block text-xs text-gray-500">{l.sub}</span></span>
            <span className="shrink-0 text-xs text-gray-600 dark:text-gray-300">{l.qtyText}</span>
          </li>
        ))}
        {lines.length > 5 && <li className="py-1 text-xs text-gray-500">และอีก {lines.length - 5} รายการ</li>}
      </ul>
      {item.remark && !isReturn && <p className="mt-1.5 text-xs text-gray-500">หมายเหตุ: {item.remark}</p>}

      {atms.code && <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">เลข {isReturn ? "DD" : "WD"}: <span data-testid="wd-code" className="font-semibold">{atms.code}</span></p>}

      {atms.drift && (
        <p data-testid="atms-drift" className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <Flag size={14} className="mt-0.5 shrink-0" /><span><b>ATMS ถูกแก้</b> · {atms.drift}</span>
        </p>
      )}

      {failed && (
        <p role="alert" data-testid="atms-error" className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{atms.error || "ส่ง ATMS ไม่สำเร็จ — กดลองใหม่"}</span>
        </p>
      )}

      {done ? (
        <div className="mt-2"><StatusChip status={item.status} /></div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {busy === "other" ? (
            <span data-testid="working" className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" />กำลังทำรายการ</span>
          ) : issuing && !stale ? (
            <span data-testid="issuing" className="inline-flex items-center gap-1.5 rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
              <Loader2 size={14} className="animate-spin" />กำลังตัดใน ATMS
            </span>
          ) : isReturn ? (
            <button type="button" className={primary} onClick={() => actions.acceptReturn(item)}>{failed || stale ? "ลองใหม่" : "รับคืน"}</button>
          ) : failed || stale ? (
            <button type="button" className={primary} onClick={() => actions.issue(item)}>ลองใหม่</button>
          ) : item.status === "NEW" ? (
            <>
              {item.kind === "cutoff"
                ? <button type="button" className={primary} onClick={() => actions.issue(item)}>ตัดยอด</button>
                : <button type="button" className={primary} onClick={() => actions.claim(item)}>รับงาน</button>}
              <button type="button" className={ghost} onClick={() => actions.reject(item)}>ปฏิเสธ</button>
            </>
          ) : item.status === "PREPARING" ? (
            <>
              <button type="button" className={primary} onClick={() => actions.prepare(item)}>จัดของ</button>
              <button type="button" className={ghost} onClick={() => actions.reject(item)}>ปฏิเสธ</button>
            </>
          ) : item.status === "READY" ? (
            <>
              <button type="button" className={primary} onClick={() => actions.issue(item)}>ส่งของ</button>
              <button type="button" className={ghost} onClick={() => actions.reject(item)}>ปฏิเสธ</button>
            </>
          ) : null}
          {item.claimedBy && item.status !== "NEW" && !isReturn && <span className="text-xs text-gray-500">จัดโดย {item.claimedBy.name}</span>}
        </div>
      )}
    </li>
  )
}

export function KeyedCard({ row }: { row: QKeyed }) {
  return (
    <li data-testid="keyed-ticket" className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-3.5 text-gray-500 dark:border-white/15 dark:bg-white/5 dark:text-gray-400">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">{row.code || "WD"}</p>
        <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">คีย์ใน ATMS</span>
      </div>
      <p className="mt-1 text-xs">{[row.pick_to, row.user, hm(row.created_at)].filter(Boolean).join(" · ")}</p>
      {row.remark && <p className="mt-1 line-clamp-2 text-xs">{row.remark}</p>}
    </li>
  )
}

export { itemKey }
