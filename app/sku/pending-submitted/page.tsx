import Link from "next/link"
import { Clock, PlusCircle } from "lucide-react"

export default function PendingSubmittedPage() {
  return (
    <div className="max-w-md mx-auto pt-16 text-center">
      <div className="flex justify-center mb-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-950/40">
          <Clock size={32} className="text-amber-500" />
        </div>
      </div>
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">ส่ง SKU เรียบร้อยแล้ว</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        SKU ของคุณอยู่ในสถานะ <span className="font-medium text-amber-600 dark:text-amber-400">รออนุมัติ</span><br />
        Admin จะตรวจสอบและอนุมัติในเร็วๆ นี้
      </p>
      <div className="flex gap-3 justify-center">
        <Link
          href="/sku/new"
          className="flex items-center gap-2 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <PlusCircle size={14} />
          เพิ่ม SKU อีกรายการ
        </Link>
        <Link
          href="/sku"
          className="rounded-lg border border-gray-200 dark:border-white/10 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors"
        >
          ดูรายการ SKU
        </Link>
      </div>
    </div>
  )
}
