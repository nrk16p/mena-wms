"use client"

import { Fragment } from "react"
import { Paperclip } from "lucide-react"
import {
  AP_DOC_FIELDS, apUrgency, atmsPoUrl, docChecked, isDocSetComplete, thaiDate, thaiDateTime, thaiDow, todayICT,
} from "@/lib/ap-tracking"
import { NUM, URGENCY, baht, mitr } from "@/components/ap-style"
import type { ApRow } from "@/components/ap-types"

// ใบที่ยัง "เลือกเพื่อส่งบัญชีพร้อมกัน" ไม่ได้ — บอกเหตุผลไว้ที่ checkbox เลย ไม่ต้องให้เดา
function selectableReason(r: ApRow): string {
  if (r.sentDate) return "ส่งบัญชีไปแล้ว"
  if (!isDocSetComplete(r.docs)) return "เอกสารยังไม่ครบชุด"
  return ""
}

// จุด 5 จุดแทนช่องติ๊ก 5 คอลัมน์ — กวาดสายตาแถวเดียวก็รู้ว่าขาดกี่ใบ รายละเอียดอยู่ใน tooltip
function DocDots({ row }: { row: ApRow }) {
  const on = AP_DOC_FIELDS.filter((f) => docChecked(row.docs, f.key))
  const title = on.length ? `มีแล้ว: ${on.map((f) => f.label).join(", ")}` : "ยังไม่มีเอกสารการเงินสักใบ"
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      {AP_DOC_FIELDS.map((f) => (
        <span key={f.key}
          className={`h-2 w-2 rounded-full ${docChecked(row.docs, f.key) ? "bg-emerald-500" : "bg-gray-200 dark:bg-white/15"}`} />
      ))}
      {row.fileCount > 0 && (
        <span className="ml-1 inline-flex items-center text-[10px] text-gray-400">
          <Paperclip className="h-3 w-3" />{row.fileCount}
        </span>
      )}
    </span>
  )
}

// แถวเดียวของตาราง — แยกออกมาเพราะต้องใช้ทั้งมุมมองรายการและมุมมองจัดกลุ่มตามวันที่กดส่ง
function ApDepositRow({
  r, today, selected, onToggle, onOpen, onSend, showSentMarked,
}: {
  r: ApRow
  today: string
  selected: boolean
  onToggle: (code: string) => void
  onOpen: (row: ApRow) => void
  onSend: (row: ApRow) => void
  showSentMarked: boolean
}) {
  const u   = apUrgency(r.dueDate, r.sentDate, today)
  const why = selectableReason(r)
  // สีขอบบนกับสีแถบซ้ายตั้งแยกกัน (border-t-* / border-l-*) — ถ้าใช้ border-gray-100 รวม
  // จะไปทับสีแถบซ้ายตามลำดับ CSS ที่ Tailwind สร้าง แล้วแถบเตือนหายไปเงียบ ๆ
  return (
    <tr
      className={`border-t border-t-gray-100 border-l-4 dark:border-t-white/5 ${URGENCY[u].rail} hover:bg-gray-50/60 dark:hover:bg-white/5`}>
      <td className="px-3 py-3 align-top">
        <input type="checkbox" checked={selected} disabled={Boolean(why)}
          onChange={() => onToggle(r.depositCode)} title={why || "เลือกเพื่อส่งบัญชีพร้อมกัน"}
          className="h-4 w-4 accent-emerald-600 disabled:opacity-30" />
      </td>

      <td className="max-w-[22rem] px-3 py-3 align-top">
        <button type="button" onClick={() => onOpen(r)}
          className="font-medium text-[#14271C] underline-offset-2 hover:underline dark:text-white">
          {r.depositCode}
        </button>
        <div className="truncate text-xs text-gray-600 dark:text-gray-300" title={r.supplier}>{r.supplier}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-gray-400">
          <span>รับ {thaiDate(r.receivedAt)}</span>
          {/* เลข PO กดเปิดหน้า PO ใน ATMS ได้เลย (ต้องล็อกอิน ATMS ในเบราว์เซอร์อยู่) */}
          {r.purchaseOrder && (r.poId
            ? <a href={atmsPoUrl(r.poId)} target="_blank" rel="noreferrer" title="เปิด PO ใน ATMS"
                className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-400">· {r.purchaseOrder} ↗</a>
            : <span>· {r.purchaseOrder}</span>)}
          {/* ทะเบียนรถจาก PO — คนหน้างานจำงานด้วยทะเบียน ไม่ใช่เลขใบ */}
          {r.vehicle && <span className="text-sky-700 dark:text-sky-400">· 🚚 {r.vehicle}</span>}
          {r.carryover && <span className="text-amber-600">· ค้างยกมา</span>}
        </div>
        {/* ข้อมูลขั้นของงานที่คนอ่านต้องรู้ต่อจากเลขใบ — ไม่ต้องมีคอลัมน์สถานะแยก
            เพราะแท็บด้านบนบอกขั้นอยู่แล้ว */}
        {r.review?.status === "ไม่ผ่าน" ? (
          <div className="mt-0.5 truncate text-[11px] text-rose-600 dark:text-rose-400" title={r.review.note}>
            บัญชีตีกลับ{r.review.note ? ` · ${r.review.note}` : ""}
          </div>
        ) : r.sentDate ? (
          <div className="mt-0.5 text-[11px] text-gray-400">
            ส่งบัญชี {r.sentType} {thaiDate(r.sentDate)}
            {r.review?.status === "ผ่าน" ? " · บัญชีตรวจผ่าน" : ""}
            {/* วันจ่ายที่บัญชียืนยันตอนกดผ่าน — ใบที่ผ่านแล้วคนถามต่อทันทีว่าเงินออกวันไหน */}
            {r.pay?.payDate ? <span className="text-emerald-600 dark:text-emerald-400"> · 💰 จ่าย {thaiDate(r.pay.payDate)}</span> : ""}
          </div>
        ) : null}
        {/* หมายเหตุจาก PR (เลขใบแจ้งซ่อม/ทะเบียน/ช่าง) — ตัวเต็มอ่านได้จาก tooltip */}
        {r.prNote && <div className="mt-0.5 truncate text-[11px] text-gray-400" title={r.prNote}>{r.prNote}</div>}
        {r.note && <div className="mt-0.5 truncate text-[11px] italic text-gray-400" title={r.note}>“{r.note}”</div>}
      </td>

      <td className={`px-3 py-3 text-right align-top font-medium ${NUM}`}>{baht(r.amount)}</td>

      <td className="px-3 py-3 align-top text-xs">
        <div className={NUM}>{r.dueDate ? thaiDate(r.dueDate) : "—"}</div>
        <div className={URGENCY[u].text}>
          {u === "overdue" ? `เกิน ${r.overdue} วัน`
            : u === "noTerm" ? "ยังไม่ตั้งเครดิตเทอม"
            : u === "due7" ? "ใกล้ครบกำหนด"
            : r.creditTerm ? `เครดิต ${r.creditTerm}` : ""}
        </div>
      </td>

      <td className="px-3 py-3 align-top"><DocDots row={r} /></td>


      {showSentMarked && (
        // เวลาที่จัดซื้อกดเปลี่ยนสถานะเป็น "ส่งบัญชีแล้ว" — คนละตัวกับวันโอนในคอลัมน์ก่อนหน้า
        // ใบที่ส่งไปก่อนระบบเก็บฟิลด์นี้จะว่างจนกว่าจะ backfill จาก log
        <td className="px-3 py-3 align-top text-xs">
          {r.sentMarkedAt ? (
            <>
              <div className={NUM}>{thaiDateTime(r.sentMarkedAt)}</div>
              <div className="truncate text-gray-400" title={r.sentMarkedBy}>{r.sentMarkedBy || r.sentType}</div>
            </>
          ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
        </td>
      )}

      <td className="px-3 py-3 text-right align-top">
        <button onClick={() => onSend(r)} disabled={!r.sentDate && !isDocSetComplete(r.docs)}
          title={!r.sentDate && !isDocSetComplete(r.docs) ? "เอกสารยังไม่ครบชุด" : undefined}
          className={`rounded-lg border px-2.5 py-1 text-xs transition ${r.sentDate
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300"
            : isDocSetComplete(r.docs)
              ? "border-gray-200/80 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"
              : "cursor-not-allowed border-dashed border-gray-200 text-gray-300 dark:border-white/10 dark:text-gray-600"}`}>
          {r.sentDate ? `✅ ${r.sentType}` : "ส่งบัญชี"}
        </button>
      </td>
    </tr>
  )
}

export function ApTable({
  rows, loading, selected, onToggle, onToggleAll, onOpen, onSend, emptyNote,
  groups, showSentMarked = false, unit = "ใบ",
  page, totalPages, pageNumbers, firstIdx, lastIdx, totalRows, perPage, perPageOptions, onPage, onPerPage,
}: {
  rows: ApRow[]
  loading: boolean
  selected: Set<string>
  onToggle: (code: string) => void
  onToggleAll: () => void
  onOpen: (row: ApRow) => void
  onSend: (row: ApRow) => void
  emptyNote: React.ReactNode
  // มุมมองจัดกลุ่ม: ส่ง groups มาแทนการเรียงแถวเรียบ ๆ (rows ยังต้องส่งมาด้วย = แถวทั้งหมดของหน้านี้
  // ใช้คิดว่า "เลือกทั้งหน้า" ครอบคลุมใบไหนบ้าง จะได้ตรงกับที่ตาเห็น)
  groups?: { date: string; rows: ApRow[] }[] | null
  showSentMarked?: boolean
  unit?: string            // หน่วยของการแบ่งหน้า — "ใบ" ในมุมมองรายการ, "วัน" ในมุมมองจัดกลุ่ม
  page: number
  totalPages: number
  pageNumbers: number[]
  firstIdx: number
  lastIdx: number
  totalRows: number
  perPage: number
  perPageOptions: readonly number[]
  onPage: (p: number) => void
  onPerPage: (n: number) => void
}) {
  const today = todayICT()
  const selectable = rows.filter((r) => !selectableReason(r))
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.depositCode))
  // จำนวนคอลัมน์จริง ณ ตอนนี้ — colSpan ของหัวกลุ่ม/แถวว่างต้องขยับตามคอลัมน์ที่ซ่อน/โผล่
  // ไม่งั้นเลข 6 ที่ hardcode ไว้จะทำให้พื้นหลังหัวกลุ่มขาดไปหนึ่งช่องเงียบ ๆ
  const cols = showSentMarked ? 7 : 6

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50/80 text-xs text-gray-500 dark:bg-white/5 dark:text-gray-400">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input type="checkbox" checked={allSelected} onChange={onToggleAll}
                  disabled={selectable.length === 0} title="เลือกทุกใบที่ส่งบัญชีได้ในหน้านี้"
                  className="h-4 w-4 accent-emerald-600" />
              </th>
              <th className="px-3 py-2.5 text-left font-medium">ใบรับของ</th>
              <th className="px-3 py-2.5 text-right font-medium">ยอดเงิน</th>
              <th className="px-3 py-2.5 text-left font-medium">กำหนดชำระ</th>
              <th className="px-3 py-2.5 text-left font-medium">เอกสาร</th>
              {showSentMarked && <th className="px-3 py-2.5 text-left font-medium">กดส่งเมื่อ</th>}
              <th className="px-3 py-2.5 text-right font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && Array.from({ length: 6 }).map((_, i) => (
              // โครงแถวตอนโหลด — ตารางไม่กระพริบเป็นช่องว่างแล้วค่อยเด้งกลับมา
              <tr key={`sk-${i}`} className="border-t border-gray-100 dark:border-white/5">
                <td colSpan={cols} className="px-3 py-3">
                  <div className="h-4 w-full animate-pulse rounded bg-gray-100 dark:bg-white/5" />
                </td>
              </tr>
            ))}

            {/* มุมมองจัดกลุ่มตามวันที่กดส่งบัญชี — หัวกลุ่มบอกจำนวนใบและยอดรวมของวันนั้น
                จะได้เทียบ "วันไหนส่งไปเท่าไหร่" ได้โดยไม่ต้องบวกเอง */}
            {groups
              ? groups.map((g) => (
                <Fragment key={g.date || "ไม่มีวันที่"}>
                  <tr className="border-t border-gray-200 bg-gray-50/80 dark:border-white/10 dark:bg-white/5">
                    <td colSpan={cols} className="px-3 py-2">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span className="font-medium text-[#14271C] dark:text-white" style={mitr}>
                          {g.date ? thaiDate(g.date) : "ยังไม่มีวันที่กดส่ง"}
                        </span>
                        {g.date && <span className="text-gray-400">{thaiDow(g.date)}</span>}
                        <span className={`ml-auto text-gray-500 dark:text-gray-400 ${NUM}`}>
                          {g.rows.length.toLocaleString("th-TH")} ใบ
                        </span>
                        <span className={`font-medium ${NUM}`}>
                          {baht(g.rows.reduce((sum, x) => sum + x.amount, 0))}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {g.rows.map((r) => (
                    <ApDepositRow key={r.depositCode} r={r} today={today} selected={selected.has(r.depositCode)}
                      onToggle={onToggle} onOpen={onOpen} onSend={onSend} showSentMarked={showSentMarked} />
                  ))}
                </Fragment>
              ))
              : rows.map((r) => (
                <ApDepositRow key={r.depositCode} r={r} today={today} selected={selected.has(r.depositCode)}
                  onToggle={onToggle} onOpen={onOpen} onSend={onSend} showSentMarked={showSentMarked} />
              ))}

            {!loading && rows.length === 0 && (
              <tr><td colSpan={cols} className="px-3 py-16 text-center text-gray-400">{emptyNote}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalRows > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500 dark:text-gray-400">
            แสดง {firstIdx.toLocaleString("th-TH")}–{lastIdx.toLocaleString("th-TH")} จาก {totalRows.toLocaleString("th-TH")} {unit}
          </span>
          <select value={perPage} onChange={(e) => onPerPage(Number(e.target.value))}
            className="rounded-lg border border-gray-200/80 bg-white px-2 py-1 text-xs dark:border-white/10 dark:bg-white/5">
            {perPageOptions.map((n) => <option key={n} value={n}>{n === 0 ? "ทั้งหมด" : `${n} ${unit}/หน้า`}</option>)}
          </select>

          {totalPages > 1 && (
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => onPage(page - 1)} disabled={page === 1}
                className="rounded-lg border border-gray-200/80 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5">‹ ก่อนหน้า</button>
              {pageNumbers.map((p, i) => (
                <Fragment key={p}>
                  {i > 0 && p - pageNumbers[i - 1] > 1 && <span className="px-1 text-xs text-gray-400">…</span>}
                  <button onClick={() => onPage(p)}
                    className={`min-w-[2rem] rounded-lg border px-2 py-1 text-xs ${p === page
                      ? "border-[#14271C] bg-[#14271C] text-white dark:border-white dark:bg-white dark:text-[#14271C]"
                      : "border-gray-200/80 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"}`}>{p}</button>
                </Fragment>
              ))}
              <button onClick={() => onPage(page + 1)} disabled={page === totalPages}
                className="rounded-lg border border-gray-200/80 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5">ถัดไป ›</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
