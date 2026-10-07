"use client"

// แถบบอก "ดูอย่างเดียว" บนหน้าของส่วนงานที่สิทธิ์ตามแผนกเป็น view (lib/access-policy.ts)
// ปุ่มแก้ไขในหน้ายังแสดงอยู่ แต่ API ที่เขียนข้อมูลจะตอบ 403 พร้อมข้อความเดียวกันนี้
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { Eye } from "lucide-react"
import { sectionForPage, SECTION_LABELS, type Section } from "@/lib/access-policy"

export function ViewOnlyBanner() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const section = sectionForPage(pathname)
  const access = session?.user?.access
  if (!section || section === "admin" || !access || access[section as Section] !== "view") return null
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
      <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        <b>ดูอย่างเดียว</b> — ส่วน &ldquo;{SECTION_LABELS[section as Section]}&rdquo; คุณดูข้อมูลได้แต่แก้ไขหรือบันทึกไม่ได้
        (สิทธิ์ตามแผนกใน HR หากต้องใช้งานติดต่อผู้ดูแลระบบ)
      </span>
    </div>
  )
}
