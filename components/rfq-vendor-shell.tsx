// เปลือกหน้าอู่ (public): แถบโลโก้บนสุด + ท้ายเขียวข้อมูลบริษัท — หน้าตาเดียวกับเว็บทางการ
// server component (ไม่มี state) · ใช้ใน app/q/[token]/layout.tsx
import { BRAND, COMPANY } from "@/lib/vendor-brand"

const wrap = { maxWidth: 880, margin: "0 auto", padding: "0 16px" } as const

export function VendorTopBar() {
  return (
    <header style={{ flexShrink: 0, background: BRAND.white, borderBottom: `1px solid ${BRAND.line}`, fontFamily: BRAND.font }}>
      <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 14, height: 64 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mena-logo.svg" alt="Mena Transport" height={40} style={{ height: 40, width: "auto" }} />
        <div style={{ width: 1, height: 28, background: BRAND.line }} />
        <div style={{ lineHeight: 1.25 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, color: BRAND.green }}>SUPPLIER PORTAL</div>
          <div style={{ fontSize: 14, color: BRAND.ink }}>ระบบขอใบเสนอราคา</div>
        </div>
      </div>
    </header>
  )
}

export function VendorFooter() {
  return (
    <footer style={{ flexShrink: 0, position: "relative", overflow: "hidden", background: BRAND.green, color: BRAND.white, fontFamily: BRAND.font, marginTop: 32 }}>
      {/* โค้งจางแบบท้ายเว็บทางการ (มาจากเส้นหัวใจในโลโก้) */}
      <div aria-hidden style={{ position: "absolute", right: -120, top: -60, width: 360, height: 360, borderRadius: "50%", border: "36px solid rgba(255,255,255,.07)" }} />
      <div style={{ ...wrap, position: "relative", padding: "28px 16px 22px", display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "space-between" }}>
        <div style={{ maxWidth: 480 }}>
          <div style={{ fontSize: 16, fontWeight: 500 }}>{COMPANY.nameTh}</div>
          <div style={{ fontSize: 13, opacity: .85, marginTop: 4, lineHeight: 1.6 }}>สำนักงานกรุงเทพมหานคร {COMPANY.address}</div>
        </div>
        <div style={{ fontSize: 13, opacity: .9, lineHeight: 1.7, maxWidth: 300 }}>
          สอบถามเรื่องใบขอราคา ติดต่อฝ่ายจัดซื้อผู้ส่งลิงก์นี้ให้คุณ
          <br />
          <a href={COMPANY.site} target="_blank" rel="noreferrer" style={{ color: BRAND.white }}>menatransport.co.th ↗</a>
        </div>
      </div>
      <div style={{ position: "relative", background: BRAND.greenDark, fontSize: 12, padding: "10px 0" }}>
        <div style={{ ...wrap, opacity: .8 }}>© {new Date().getFullYear() + 543} {COMPANY.nameTh} · ข้อมูลที่กรอกใช้เพื่อการคัดเลือกผู้ให้บริการเท่านั้น</div>
      </div>
    </footer>
  )
}
