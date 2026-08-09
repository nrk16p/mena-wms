import { getServerSession } from "next-auth"
import { notFound } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { AI_MIXER_ALLOWED_EMAILS } from "@/lib/ai-mixer"
import { AiMixerMaintenancePage } from "@/components/ai-mixer-maintenance-page"

export const metadata = { title: "AI จัดการงานซ่อมรถโม่ · Mena WMS" }

// guard ฝั่ง server — คนอื่นเปิด URL ตรงๆ จะเจอ 404 (ไม่ใช่แค่ซ่อนเมนู)
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!AI_MIXER_ALLOWED_EMAILS.includes(session?.user?.email ?? "")) notFound()
  return <AiMixerMaintenancePage />
}
