import type { SwStatus } from "@/lib/store-withdraw/types"

const META: Record<SwStatus, { label: string; cls: string }> = {
  NEW:          { label: "รอสโตร์รับ",       cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30" },
  PREPARING:    { label: "สโตร์กำลังจัด",     cls: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30" },
  READY:        { label: "พร้อมให้มารับ",     cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30" },
  ISSUING:      { label: "กำลังตัดใน ATMS",   cls: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30" },
  ISSUED:       { label: "ส่งของแล้ว",        cls: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-500/30" },
  ISSUE_FAILED: { label: "ส่ง ATMS ไม่สำเร็จ", cls: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30" },
  RECEIVED:     { label: "รับแล้ว",           cls: "bg-green-50 text-green-700 ring-green-200 dark:bg-green-500/10 dark:text-green-300 dark:ring-green-500/30" },
  REJECTED:     { label: "สโตร์ปฏิเสธ",       cls: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30" },
  CANCELLED:    { label: "ยกเลิกแล้ว",        cls: "bg-gray-100 text-gray-600 ring-gray-200 dark:bg-white/5 dark:text-gray-400 dark:ring-white/10" },
}

export const statusLabel = (s: SwStatus) => META[s]?.label ?? s

export function StatusChip({ status }: { status: SwStatus }) {
  const m = META[status] ?? { label: status, cls: "bg-gray-100 text-gray-600 ring-gray-200" }
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${m.cls}`}>
      {m.label}
    </span>
  )
}
