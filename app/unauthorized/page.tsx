"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"
import { ShieldAlert } from "lucide-react"

export default function UnauthorizedPage() {
  const { data: session } = useSession()
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30 text-amber-500 mb-5">
        <ShieldAlert size={30} />
      </span>
      <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">คุณไม่มีสิทธิ์เข้าถึงหน้านี้</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
        {session?.user?.name ? `คุณ ${session.user.name} ` : ""}ยังไม่ได้รับสิทธิ์สำหรับส่วนนี้ของระบบ
      </p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">กรุณาติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์การใช้งาน</p>
      <Link
        href="/"
        className="rounded-lg bg-[#1B8C4B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C] transition-colors"
      >
        กลับหน้าหลัก
      </Link>
    </div>
  )
}
