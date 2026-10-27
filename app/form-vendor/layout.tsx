// ฟอร์มลงทะเบียน Vendor (public) — ออกแบบสำหรับเปิดใน LINE LIFF (จอมือถือ ไม่มีแถบบน/ท้ายเว็บ)
// layout นี้เป็นตัวเลื่อนหน้าเอง (body ของแอปล็อกความสูง h-screen ไว้) — id vendor-scroll ใช้กับ scrollToTop
import type { Viewport } from "next"
import { BRAND } from "@/lib/vendor-brand"

export const metadata = { title: "ลงทะเบียนผู้ให้บริการ — Mena Transport" }
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: BRAND.green }

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div id="vendor-scroll" style={{ height: "100%", width: "100%", overflowY: "auto", background: BRAND.bg }}>
      {children}
    </div>
  )
}
