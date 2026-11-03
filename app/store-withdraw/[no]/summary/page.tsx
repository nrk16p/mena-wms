// /store-withdraw/{no}/summary — หน้าสรุปการใช้รายคันของใบ Mobile/PM (ลิงก์เปิดบนมือถือ)
// สิทธิ์: middleware = section store-withdraw (ยังไม่ล็อกอิน → /login?callbackUrl=หน้านี้) · ที่นี่เช็กซ้ำว่าเป็นเจ้าของใบ
import Link from "next/link"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { swCol, withRef } from "@/lib/store-withdraw/db"
import { SummaryPage, type SummaryReq } from "@/components/store-withdraw/summary-page"

export const dynamic = "force-dynamic"

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="mx-auto max-w-md p-6 text-center" data-testid="summary-notice">
      <p className="text-base font-semibold text-gray-900 dark:text-white">{title}</p>
      <p className="mt-1 text-sm text-gray-500">{text}</p>
      <Link href="/store-withdraw" className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-[#E2E8E4] px-4 py-2 text-sm text-gray-700 dark:border-white/10 dark:text-gray-200">ไปหน้าใบเบิกของฉัน</Link>
    </div>
  )
}

export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no: raw } = await params
  const no = decodeURIComponent(raw).trim().toUpperCase()
  const session = await getServerSession(authOptions)
  const me = session?.user?.email?.trim().toLowerCase() ?? ""
  const doc = /^SW-[A-Z0-9-]{1,30}$/.test(no) ? await (await swCol()).findOne({ no }, { projection: { _id: 0 } }) : null
  if (!doc) return <Notice title="ไม่พบใบเบิกนี้" text={`ตรวจเลขใบ ${no} อีกครั้ง`} />
  if (!me || doc.requestedBy.email.trim().toLowerCase() !== me) {
    return <Notice title="ใบนี้ไม่ใช่ของคุณ" text="หน้านี้สรุปได้เฉพาะคนที่ยื่นใบนี้ ถ้าเปิดผิดบัญชี ออกจากระบบแล้วเข้าใหม่ด้วยบัญชีของคนยื่น" />
  }
  // ส่งให้ client แบบ JSON (วันที่เป็นสตริง)
  const req = JSON.parse(JSON.stringify(withRef(doc))) as SummaryReq
  return <SummaryPage initial={req} />
}
