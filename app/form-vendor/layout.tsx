// สมัครเป็นผู้ส่งมอบ (public) — ออกแบบสำหรับเปิดใน LINE LIFF (จอมือถือ ไม่มีแถบบน/ท้ายเว็บ) · เปิดบนคอมก็ได้
// layout นี้เป็นตัวเลื่อนหน้าเอง (body ของแอปล็อกความสูง h-screen ไว้) — id vendor-scroll ใช้กับ scrollTop
// ครอบทั้ง /form-vendor และ /form-vendor/docs/[token]
import type { Viewport } from "next"
import { BRAND } from "@/lib/vendor-brand"

export const metadata = { title: "สมัครเป็นผู้ส่งมอบ — Mena Transport" }
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: BRAND.green }

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div id="vendor-scroll" style={{ height: "100%", width: "100%", overflowY: "auto", background: BRAND.bg, colorScheme: "light" }}>
      {children}
    </div>
  )
}
