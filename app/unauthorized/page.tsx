// หน้าที่ middleware ส่งมาเมื่อผู้ใช้ไม่มีสิทธิ์เปิดหน้าของส่วนงานนั้น (สิทธิ์ตามแผนก — lib/access-policy.ts)
import Link from "next/link"
import { ShieldAlert } from "lucide-react"
import { SECTION_LABELS, type Section } from "@/lib/access-policy"

export default async function Unauthorized({ searchParams }: { searchParams: Promise<{ from?: string; section?: string }> }) {
  const { from, section } = await searchParams
  const label = section === "admin" ? "ผู้ดูแลระบบ" : SECTION_LABELS[section as Section]
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-900">
      <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" aria-hidden />
      <h1 className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">ไม่มีสิทธิ์เข้าหน้านี้</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
        {label ? <>ส่วน &ldquo;{label}&rdquo; ไม่อยู่ในสิทธิ์ของแผนกคุณ</> : "หน้านี้ไม่อยู่ในสิทธิ์ของคุณ"}
        {from ? <><br /><span className="text-xs text-gray-400">{from}</span></> : null}
      </p>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">หากต้องใช้งาน ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์</p>
      <Link href="/" className="mt-5 inline-block rounded-lg bg-[#1B8C4B] px-4 py-2 text-sm font-medium text-white hover:opacity-90">กลับหน้าหลัก</Link>
    </div>
  )
}
