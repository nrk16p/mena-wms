// หน้าอู่ทุกหน้า: แถบโลโก้ + ท้ายข้อมูลบริษัท · layout นี้เป็นตัวเลื่อนหน้าเอง (body ของแอปล็อกความสูง h-screen ไว้)
import { VendorTopBar, VendorFooter } from "@/components/rfq-vendor-shell"
import { BRAND } from "@/lib/vendor-brand"

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div id="vendor-scroll" style={{ height: "100%", overflowY: "auto", background: BRAND.bg, display: "flex", flexDirection: "column" }}>
      <VendorTopBar />
      <main style={{ flex: 1 }}>{children}</main>
      <VendorFooter />
    </div>
  )
}
