"use client"

import { Fragment } from "react"
import { Paperclip } from "lucide-react"
import {
  AP_DOC_FIELDS, apUrgency, docChecked, isDocSetComplete, thaiDate, todayICT,
} from "@/lib/ap-tracking"
import { NUM, URGENCY, baht } from "@/components/ap-style"
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

export function ApTable({
  rows, loading, selected, onToggle, onToggleAll, onOpen, onSend, emptyNote,
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
              <th className="px-3 py-2.5 text-right font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && Array.from({ length: 6 }).map((_, i) => (
              // โครงแถวตอนโหลด — ตารางไม่กระพริบเป็นช่องว่างแล้วค่อยเด้งกลับมา
              <tr key={`sk-${i}`} className="border-t border-gray-100 dark:border-white/5">
                <td colSpan={6} className="px-3 py-3">
                  <div className="h-4 w-full animate-pulse rounded bg-gray-100 dark:bg-white/5" />
                </td>
              </tr>
            ))}

            {rows.map((r) => {
              const u   = apUrgency(r.dueDate, r.sentDate, today)
              const why = selectableReason(r)
              // สีขอบบนกับสีแถบซ้ายตั้งแยกกัน (border-t-* / border-l-*) — ถ้าใช้ border-gray-100 รวม
              // จะไปทับสีแถบซ้ายตามลำดับ CSS ที่ Tailwind สร้าง แล้วแถบเตือนหายไปเงียบ ๆ
              return (
                <tr key={r.depositCode}
                  className={`border-t border-t-gray-100 border-l-4 dark:border-t-white/5 ${URGENCY[u].rail} hover:bg-gray-50/60 dark:hover:bg-white/5`}>
                  <td className="px-3 py-3 align-top">
                    <input type="checkbox" checked={selected.has(r.depositCode)} disabled={Boolean(why)}
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
                      {r.purchaseOrder && <span>· {r.purchaseOrder}</span>}
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
                      </div>
                    ) : null}
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
            })}

            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-16 text-center text-gray-400">{emptyNote}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalRows > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500 dark:text-gray-400">
            แสดง {firstIdx.toLocaleString("th-TH")}–{lastIdx.toLocaleString("th-TH")} จาก {totalRows.toLocaleString("th-TH")} ใบ
          </span>
          <select value={perPage} onChange={(e) => onPerPage(Number(e.target.value))}
            className="rounded-lg border border-gray-200/80 bg-white px-2 py-1 text-xs dark:border-white/10 dark:bg-white/5">
            {perPageOptions.map((n) => <option key={n} value={n}>{n === 0 ? "ทั้งหมด" : `${n} แถว/หน้า`}</option>)}
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
