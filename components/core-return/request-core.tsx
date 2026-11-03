"use client"

// ชิปสถานะซากบนใบเบิก WMS (หน้าใบของฉัน / คิวสโตร์) + ปุ่มคืนซาก + แถบ "ของฉันที่ยังไม่คืนซาก"
import { useState } from "react"
import Link from "next/link"
import { Recycle } from "lucide-react"
import { OUTSTANDING } from "@/lib/core-return/core"
import { ReturnDialog } from "./dialogs"
import { CoreChip, baht, useFetch, usePerms, type Row } from "./shared"
import { K } from "./tokens"

const DONE = new Set(["ISSUED", "RECEIVED", "SETTLED"])

/** แถวซากของใบที่ได้ WD แล้ว จัดตามเลขใบ · tick = รีเฟรชหลังคืนซาก */
export function useRequestCore(reqs: { no: string; status: string }[]) {
  const [tick, setTick] = useState(0)
  const nos = [...new Set(reqs.filter((r) => DONE.has(r.status)).map((r) => r.no))].sort().slice(0, 300)
  const perms = usePerms()
  const url = perms.read && nos.length ? `/api/core-return/by-request?nos=${encodeURIComponent(nos.join(","))}` : null
  const { data } = useFetch<{ items: (Row & { swLineIndex: number; swUsageIndex?: number | null })[] }>(url, tick)
  const byNo = new Map<string, (Row & { swLineIndex: number; swUsageIndex?: number | null })[]>()
  for (const r of data?.items ?? []) byNo.set(r.swNo!, [...(byNo.get(r.swNo!) ?? []), r])
  return { byNo, refresh: () => setTick((t) => t + 1), canReturn: perms.ret }
}

/** ชิปของบรรทัดเดียว (Mobile/PM อาจมีหลายแถวต่อบรรทัด = หลายคัน) */
export function LineCoreChips({ rows, canReturn, onReturn }: { rows: Row[]; canReturn: boolean; onReturn: (r: Row) => void }) {
  if (!rows.length) return null
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5" data-testid="core-chips">
      {rows.map((r) => (
        <span key={r.row_key} className="inline-flex items-center gap-1">
          <CoreChip status={r.coreStatus} short />
          {rows.length > 1 && r.plate && <span className="text-[11px] text-gray-500">{r.plate}</span>}
          {canReturn && OUTSTANDING.includes(r.coreStatus) && (
            <button type="button" data-act="core-return" onClick={() => onReturn(r)} className={`rounded-lg ${K["bg-primary"]} px-2 py-0.5 text-[11px] font-medium text-white ${K["hover:bg-c157A40"]}`}>คืนซาก</button>
          )}
        </span>
      ))}
    </span>
  )
}

/** กล่องคืนซากที่ใช้ร่วมกับหน้าติดตามซาก */
export function RequestCoreReturn({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: () => void }) {
  return <ReturnDialog key={row?.row_key ?? "none"} row={row} onClose={onClose} onDone={onDone} />
}

/** แถบเตือนบนหน้าใบของฉัน: ยังไม่คืนซากกี่รายการ → ลิงก์ไปหน้าติดตามซากเฉพาะของฉัน */
export function MineCoreBanner({ tick = 0 }: { tick?: number }) {
  const perms = usePerms()
  const { data } = useFetch<{ total: number; summary: { pending: { count: number; amount: number }; legacy: { count: number; amount: number } } | null }>(
    perms.read ? "/api/core-return?mine=1&status=pending,legacy&summary=1" : null, tick)
  const n = data?.total ?? 0
  if (!n) return null
  const amt = (data?.summary?.pending.amount ?? 0) + (data?.summary?.legacy.amount ?? 0)
  return (
    <Link href="/store-withdraw/core-return?mine=1" data-testid="mine-core-banner" className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-200">
      <span className="flex items-center gap-2"><Recycle size={16} />ของฉันที่ยังไม่คืนซาก {n} รายการ{amt > 0 ? ` · ${baht(amt)} บาท` : ""}</span>
      <span className="text-xs font-medium underline">ดูทั้งหมด</span>
    </Link>
  )
}
