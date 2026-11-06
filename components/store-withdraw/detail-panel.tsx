"use client"

// แผงรายละเอียดใบเบิกด้านขวาของคิวสโตร์ (กดเลขใบบนการ์ด) · ปุ่มใช้ ActionBar ตัวเดียวกับการ์ด
import { useEffect } from "react"
import { Check, Truck, X } from "lucide-react"
import { isPendingFlow } from "@/lib/store-withdraw/core"
import { DOC_KIND_NAME } from "./doc-ref-types"
import { AttachButton, AttachChip } from "./attach-picker"
import { StatusChip } from "./status-chip"
import { SummaryView, mrTypeName } from "./summary-dialog"
import { ActionBar, AtmsAlerts, cardState, dmhm, hm, kindLabel, waitText, workLabel, type BusyKind, type CardActions, type ColKey } from "./ticket-card"
import type { QItem } from "./queue-types"

type Step = { label: string; meta: string; state: "done" | "cur" | "err" | "todo" }

const RETURN_LABEL: Record<string, string> = { RETURN_REQUESTED: "รอสโตร์รับคืน", RETURNING: "กำลังรับคืนใน ATMS", RETURNED: "รับคืนแล้ว", RETURN_FAILED: "รับคืนไม่สำเร็จ" }

/** ขั้นตอนของใบตามประเภทงาน · stage = ขั้นปัจจุบัน (เท่าจำนวนขั้น = จบแล้ว) · errAt = ขั้นที่ ATMS ไม่ผ่าน */
function steps(i: QItem): Step[] {
  const created = `${dmhm(i.createdAt)} · ${i.requestedBy.name}`
  const claim = i.claimedBy?.name ?? ""
  const code = i.atms.code ? `เลข ${i.atms.code}` : ""
  let labels: string[]
  let meta: string[]
  let stage: number
  let errAt = -1
  if (i.itemType === "return" && i.return) {
    const r = i.return
    labels = ["ช่างขอคืนอะไหล่", "สโตร์รับคืน (DD)"]
    meta = [dmhm(r.createdAt), r.atms.code ? `เลข ${r.atms.code}` : ""]
    stage = r.status === "RETURNED" ? 2 : 1
    if (r.status === "RETURN_FAILED") errAt = 1
  } else if (i.status === "REJECTED" || i.status === "CANCELLED") {
    labels = ["สร้างใบเบิก", i.status === "REJECTED" ? "สโตร์ปฏิเสธ" : "ยกเลิกแล้ว"]
    meta = [created, i.rejectReason ?? ""]
    stage = 2
  } else if (i.kind === "cutoff") {
    labels = ["สร้างใบเบิก", "ตัดยอดใน ATMS (WD)"]
    meta = [created, code]
    stage = i.status === "ISSUED" || i.status === "RECEIVED" ? 2 : 1
    if (i.status === "ISSUE_FAILED") errAt = 1
  } else if (isPendingFlow(i)) {
    labels = ["สร้างใบเบิก", "สโตร์รับงาน", "จัดของครบ", "ส่งของ", "ช่างสรุปการใช้", "ตัดสต๊อก ATMS"]
    const sum = i.summary ? `${dmhm(i.summary.at)} · ${i.summary.by.name}` : i.summaryDueAt ? `กำหนด ${dmhm(i.summaryDueAt)}` : ""
    meta = [created, claim, "", "", sum, (i.settleGroups ?? []).map((g) => g.atms.code).filter(Boolean).join(", ")]
    stage = ({ NEW: 1, PREPARING: 2, READY: 3, HANDED_OUT: 4, SUMMARIZED: 5, SETTLING: 5, SETTLE_FAILED: 5, SETTLED: 6 } as Record<string, number>)[i.status] ?? 1
    if (i.status === "SETTLE_FAILED") errAt = 5
  } else {
    labels = ["สร้างใบเบิก", "สโตร์รับงาน", "จัดของครบ", "ส่งของ · ตัด ATMS (WD)"]
    meta = [created, claim, "", code]
    stage = ({ NEW: 1, PREPARING: 2, READY: 3, ISSUING: 3, ISSUE_FAILED: 3, ISSUED: 4, RECEIVED: 4 } as Record<string, number>)[i.status] ?? 1
    if (i.status === "ISSUE_FAILED") errAt = 3
  }
  return labels.map((label, n) => ({
    label, meta: meta[n] ?? "",
    state: n === errAt ? "err" : n < stage ? "done" : n === stage ? "cur" : "todo",
  }))
}

function Dot({ state }: { state: Step["state"] }) {
  if (state === "done") return <span aria-label="เสร็จแล้ว" className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#17793F] text-white"><Check size={11} strokeWidth={3} /></span>
  if (state === "cur") return <span aria-label="ขั้นปัจจุบัน" className="h-[18px] w-[18px] rounded-full border-[5px] border-[#17793F] bg-white dark:bg-[#161922]" />
  if (state === "err") return <span aria-label="ผิดพลาด" className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-red-700 text-xs font-bold text-white">!</span>
  return <span aria-label="ยังไม่ถึง" className="h-[18px] w-[18px] rounded-full border-2 border-[#C9D1CC] bg-white dark:border-white/20 dark:bg-transparent" />
}

export function DetailPanel({ item, column, now, busy, actions, onClose }: {
  item: QItem; column: ColKey; now: Date; busy: BusyKind | null; actions: CardActions; onClose: () => void
}) {
  // Esc ปิดแผง · ถ้ามี dialog/swal เปิดอยู่ให้ Esc ปิดตัวนั้นก่อน
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector('[role="dialog"], [role="alertdialog"], .swal2-container')) return
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const st = cardState(item, now, busy, column)
  const { isReturn, ret } = st
  const rows = isReturn
    ? ret!.lines.map((l) => ({ key: `r${l.lineIndex}`, code: item.lines[l.lineIndex]?.skuCode ?? "", name: item.lines[l.lineIndex]?.skuName ?? "?", mr: "", qty: `คืน ${l.qty}` }))
    : item.lines.map((l, n) => ({
        key: `${l.skuId}-${n}`, code: l.skuCode, name: l.skuName, mr: l.mrItemLabel ? mrTypeName(l.mrItemLabel) : "",
        qty: `${l.issuedQty != null && l.issuedQty !== l.requestedQty ? `${l.issuedQty}/` : ""}${l.requestedQty}${l.short ? " (ขาด)" : ""}`,
      }))
  const facts: [string, string][] = [
    ["ประเภท", isReturn ? kindLabel(item) : `${kindLabel(item)} · ${workLabel(item)}`],
    ["ทะเบียน", item.plate || "-"],
    ["ผู้ขอ", item.requestedBy.name],
    ["MR", item.mrCode || "-"],
    ["อ้างอิง", item.ref ? `${DOC_KIND_NAME[item.ref.type]} ${item.ref.code}` : "-"],
    ["สร้างเมื่อ", dmhm(item.createdAt)],
    ["จัดโดย", item.claimedBy?.name ?? "-"],
    [isReturn ? "เลข DD" : "เลข WD", st.atms.code ?? "-"],
  ]
  const note = isReturn ? (ret!.reason ? `เหตุผลที่คืน: ${ret!.reason}` : "") : [item.remark, item.rejectReason ? `ปฏิเสธ: ${item.rejectReason}` : ""].filter(Boolean).join(" · ")
  const hasActions = !st.done && !st.waiting

  return (
    <aside aria-label={`รายละเอียดใบ ${item.no}`} data-testid="detail-panel"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-[#E1E6E3] bg-white shadow-[-12px_0_32px_rgba(20,39,28,.10)] sm:w-[440px] dark:border-white/10 dark:bg-[#161922]">
      <div className="flex flex-col gap-2 border-b border-[#E1E6E3] px-5 pb-3.5 pt-4 dark:border-white/10">
        <div className="flex items-center gap-2">
          {isReturn
            ? <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-[#5B3AA8] dark:bg-violet-500/15 dark:text-violet-300">{RETURN_LABEL[ret!.status] ?? ret!.status}</span>
            : <StatusChip status={item.status} />}
          {item.urgent && !st.done && <span className="inline-flex h-6 items-center gap-1 rounded-full bg-red-700 px-2.5 text-xs font-semibold text-white"><Truck size={13} aria-hidden="true" />รถจอดรอ</span>}
          <button type="button" onClick={onClose} aria-label="ปิดรายละเอียด" className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#D5DCD8] text-[#2B3D32] hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"><X size={16} /></button>
        </div>
        <h2 className="font-mono text-xl font-semibold text-[#14271C] dark:text-white">{item.no}</h2>
        <p className="text-[13px] text-[#4A5A50] dark:text-gray-400">{[item.plate && `ทะเบียน ${item.plate}`, kindLabel(item), !isReturn && workLabel(item), !st.done && !st.waiting && waitText(st.mins)].filter(Boolean).join(" · ")}</p>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <AtmsAlerts st={st} />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-[#4A5A50] dark:text-gray-400">{k}</dt>
              <dd className="mt-0.5 break-words text-[13.5px] font-medium text-[#14271C] dark:text-gray-100">{v}</dd>
            </div>
          ))}
        </dl>

        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold text-[#14271C] dark:text-white">รายการอะไหล่ <span className="font-normal text-[#4A5A50] dark:text-gray-400">· {rows.length} รายการ</span></h3>
          {st.showSummary ? <SummaryView req={item} /> : (
            <div className="overflow-hidden rounded-lg border border-[#E1E6E3] dark:border-white/10">
              <div className="grid grid-cols-[110px_minmax(0,1fr)_80px] gap-2 bg-[#F6F8F7] px-3 py-2 text-xs font-semibold text-[#4A5A50] dark:bg-white/5 dark:text-gray-400">
                <span>รหัส</span><span>รายการ</span><span className="text-right">จำนวน</span>
              </div>
              {rows.map((r) => (
                <div key={r.key} className="grid grid-cols-[110px_minmax(0,1fr)_80px] gap-2 border-t border-[#EDF1EE] px-3 py-2 text-[13px] dark:border-white/10">
                  <span className="break-all font-mono text-xs text-[#2B3D32] dark:text-gray-300">{r.code}</span>
                  <span className="min-w-0">
                    <span className="block text-[#14271C] dark:text-gray-100">{r.name}</span>
                    {r.mr && <span className="block text-[11.5px] text-[#157A40] dark:text-emerald-400">{r.mr}</span>}
                  </span>
                  <span className="text-right tabular-nums text-[#14271C] dark:text-gray-100">{r.qty}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {note && (
          <section className="space-y-1">
            <h3 className="text-[13px] font-semibold text-[#14271C] dark:text-white">หมายเหตุ</h3>
            <p className="break-words text-[13px] text-[#2B3D32] dark:text-gray-300">{note}</p>
          </section>
        )}

        {!isReturn && (
          <section className="space-y-1">
            <h3 className="text-[13px] font-semibold text-[#14271C] dark:text-white">ไฟล์แนบ</h3>
            {(item.attachCount ?? 0) === 0 && <p className="text-xs text-[#4A5A50] dark:text-gray-400">ยังไม่มีไฟล์แนบ</p>}
            <AttachChip key={item.no} no={item.no} count={item.attachCount ?? 0} />
            <div className="pt-1"><AttachButton no={item.no} context="other" /></div>
          </section>
        )}

        <section className="space-y-2.5">
          <h3 className="text-[13px] font-semibold text-[#14271C] dark:text-white">ความคืบหน้า</h3>
          <ol className="space-y-3">
            {steps(item).map((s, n) => (
              <li key={n} className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2.5">
                <span className="flex justify-center pt-0.5"><Dot state={s.state} /></span>
                <span className="flex flex-col">
                  <span className={`text-[13.5px] text-[#14271C] dark:text-gray-100 ${s.state === "cur" || s.state === "err" ? "font-semibold" : ""}`}>{s.label}</span>
                  {s.meta && <span className="text-xs text-[#4A5A50] dark:text-gray-400">{s.meta}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="border-t border-[#E1E6E3] px-5 py-3 dark:border-white/10">
        {hasActions
          ? <ActionBar key={item.no} item={item} st={st} busy={busy} actions={actions} size="lg" />
          : <p className="flex min-h-11 items-center text-[13px] text-[#4A5A50] dark:text-gray-400">{st.waiting ? "รอช่างสรุปการใช้ · ไม่ใช่งานสโตร์" : `ปิดแล้ว ${hm(item.updatedAt)}`}</p>}
      </div>
    </aside>
  )
}
