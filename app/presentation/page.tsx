"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import "reveal.js/reveal.css"
import "reveal.js/theme/white.css"

type Stats = {
  totalApproved: number
  totalPending:  number
  totalRejected: number
  byType:        Record<string, number>
  totalBrands:   number
}

const TYPES = ["PRT", "PM", "LAB", "SVC", "CLN", "TRP", "ACC"]

// Light-theme palette
const EM   = "#059669"   // emerald-600
const TXT  = "#111827"   // gray-900
const DIM  = "#6b7280"   // gray-500
const CARD = "#f9fafb"   // gray-50
const BDR  = "#d1fae5"   // emerald-100
const BG   = "#ffffff"

export default function PresentationPage() {
  const deckRef           = useRef<HTMLDivElement>(null)
  const router            = useRouter()
  const [stats, setStats] = useState<Stats | null>(null)

  // Fetch live stats
  useEffect(() => {
    Promise.all([
      fetch("/api/sku?status=approved&limit=1").then(r => r.json()),
      fetch("/api/sku?status=pending&limit=1").then(r => r.json()),
      fetch("/api/sku?status=rejected&limit=1").then(r => r.json()),
      fetch("/api/sku?status=approved&distinct=brand").then(r => r.json()),
      ...TYPES.map(t => fetch(`/api/sku?status=approved&type=${t}&limit=1`).then(r => r.json())),
    ]).then(([approved, pending, rejected, brands, ...typeRes]) => {
      setStats({
        totalApproved: approved.total ?? 0,
        totalPending:  pending.total  ?? 0,
        totalRejected: rejected.total ?? 0,
        totalBrands:   Array.isArray(brands) ? brands.length : 0,
        byType:        Object.fromEntries(TYPES.map((t, i) => [t, typeRes[i]?.total ?? 0])),
      })
    }).catch(() => {})
  }, [])

  // Initialise Reveal.js
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let deck: any = null
    async function init() {
      const Reveal = (await import("reveal.js")).default
      if (!deckRef.current) return
      deck = new Reveal(deckRef.current, {
        hash:                 false,
        controls:             true,
        progress:             true,
        center:               true,
        transition:           "slide",
        backgroundTransition: "fade",
        // Fixed design size — reveal.js scales this to fit every screen
        width:                1280,
        height:               720,
        margin:               0.06,
        minScale:             0.1,
        maxScale:             3.0,
      })
      deck.initialize()
    }
    init()
    return () => { try { deck?.destroy() } catch { /* ignore */ } }
  }, [])

  // Escape → exit
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") router.push("/") }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [router])

  const maxType = stats ? Math.max(...Object.values(stats.byType), 1) : 1

  // ── shared micro-components ─────────────────────────────────────
  const tag = (label: string) => (
    <span key={label} style={{
      background: "#ecfdf5", border: `1px solid ${BDR}`, color: EM,
      borderRadius: 6, padding: "4px 12px", fontSize: 15, fontWeight: 500,
    }}>{label}</span>
  )

  const row = (icon: string, title: string, desc: string) => (
    <div key={title} style={{
      display: "flex", gap: 16, background: CARD, border: `1px solid #e5e7eb`,
      borderRadius: 10, padding: "14px 18px", textAlign: "left", alignItems: "flex-start",
    }}>
      <span style={{ color: EM, fontWeight: 700, whiteSpace: "nowrap", fontSize: 15 }}>{icon} {title}</span>
      <span style={{ color: DIM, fontSize: 14, lineHeight: 1.6 }}>{desc}</span>
    </div>
  )

  const card = (emoji: string, title: string, body: string) => (
    <div style={{ background: CARD, border: `1px solid #e5e7eb`, borderRadius: 14, padding: "28px 24px", textAlign: "left" }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>{emoji}</div>
      <div style={{ color: EM, fontWeight: 700, fontSize: 17, marginBottom: 8 }}>{title}</div>
      <div style={{ color: DIM, fontSize: 14, lineHeight: 1.75 }}>{body}</div>
    </div>
  )

  const heading = (feature: string, title: string) => (
    <>
      <div style={{ fontSize: 13, letterSpacing: "0.3em", color: EM, textTransform: "uppercase", marginBottom: 6 }}>{feature}</div>
      <h2 style={{ fontSize: 36, fontWeight: 700, color: TXT, margin: "0 0 10px" }}>{title}</h2>
    </>
  )

  const story = (th: string) => (
    <p style={{ color: DIM, fontSize: 15, marginBottom: 22, fontStyle: "italic", borderLeft: `3px solid ${BDR}`, paddingLeft: 14 }}>
      &ldquo;{th}&rdquo;
    </p>
  )

  return (
    <div style={{ position: "fixed", inset: 0, background: BG, zIndex: 50 }}>

      {/* Exit */}
      <button
        onClick={() => router.push("/")}
        style={{
          position: "fixed", top: 14, right: 18, zIndex: 200,
          background: "#fff", border: "1px solid #e5e7eb",
          color: TXT, padding: "6px 16px", borderRadius: 8,
          cursor: "pointer", fontSize: 13, fontWeight: 500,
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        }}
      >
        ✕ ออก
      </button>

      <div className="reveal" ref={deckRef} style={{ width: "100%", height: "100%" }}>
        <div className="slides" style={{ fontFamily: "'Noto Sans Thai', system-ui, -apple-system, sans-serif", color: TXT }}>

          {/* ── 01 ชื่อเรื่อง ─────────────────────────────────────────── */}
          <section data-background-color={BG}>
            <div style={{ padding: "40px 60px" }}>
              <div style={{ fontSize: 13, letterSpacing: "0.3em", color: EM, textTransform: "uppercase", marginBottom: 12 }}>
                ระบบจัดการภายใน
              </div>
              <h1 style={{ fontSize: 72, fontWeight: 800, color: TXT, margin: "0 0 6px", letterSpacing: "-0.02em" }}>
                Mena WMS
              </h1>
              <h2 style={{ fontSize: 26, fontWeight: 400, color: DIM, margin: "0 0 28px" }}>
                Master SKU Web — ระบบจัดการข้อมูลอะไหล่และ SKU
              </h2>
              <div style={{ width: 56, height: 3, background: EM, margin: "0 0 32px", borderRadius: 2 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 580 }}>
                {[
                  ["เทคโนโลยี", "Next.js 16 · React 19 · MongoDB"],
                  ["การยืนยันตัวตน", "Google OAuth (NextAuth)"],
                  ["การเข้าถึง", "@menatransport.co.th เท่านั้น"],
                  ["บทบาท", "ผู้ดูแลระบบ & ผู้ใช้ทั่วไป"],
                ].map(([k, v]) => (
                  <div key={k} style={{ background: CARD, border: `1px solid #e5e7eb`, borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ color: EM, fontSize: 13, marginBottom: 4, fontWeight: 600 }}>{k}</div>
                    <div style={{ color: DIM, fontSize: 15 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── 02 ผู้ใช้งาน ─────────────────────────────────────────── */}
          <section data-background-color={BG}>
            <div style={{ padding: "40px 60px" }}>
              <div style={{ fontSize: 13, letterSpacing: "0.3em", color: EM, textTransform: "uppercase", marginBottom: 6 }}>ใครใช้ระบบนี้</div>
              <h2 style={{ fontSize: 36, fontWeight: 700, color: TXT, margin: "0 0 28px" }}>ผู้ใช้งาน</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, maxWidth: 800 }}>
                {card("👤", "ผู้ใช้ทั่วไป",
                  "เจ้าหน้าที่คลังสินค้าที่สร้างและส่งรายการ SKU ใหม่เพื่อรอการอนุมัติ สามารถติดตามสถานะของรายการที่ส่งและส่งใหม่เมื่อถูกปฏิเสธ")}
                {card("🛡️", "ผู้ดูแลระบบ",
                  "ผู้จัดการที่ตรวจสอบ อนุมัติ หรือปฏิเสธรายการ SKU ที่รอดำเนินการ พร้อมจัดการพจนานุกรมรหัสอ้างอิงทั้งหมดในระบบ")}
              </div>
            </div>
          </section>

          {/* ── 03 การเข้าสู่ระบบ ────────────────────────────────────── */}
          <section data-background-color={BG}>
            <div style={{ padding: "40px 60px" }}>
              {heading("ฟีเจอร์ที่ 01", "การเข้าสู่ระบบ")}
              {story("ในฐานะพนักงาน Mena ฉันต้องการเข้าสู่ระบบด้วยบัญชี Google ของบริษัท เพื่อให้เฉพาะผู้ที่ได้รับอนุญาตเท่านั้นที่สามารถเข้าถึงระบบได้")}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 680 }}>
                {row("✓", "Google SSO", "เข้าสู่ระบบด้วย Google — ไม่ต้องจำรหัสผ่านแยกต่างหาก ใช้บัญชีบริษัทได้ทันที")}
                {row("✓", "จำกัดโดเมน", "อนุญาตเฉพาะอีเมล @menatransport.co.th เท่านั้น บัญชีอื่นถูกปฏิเสธอัตโนมัติ")}
                {row("✓", "ปกป้องทุกหน้า", "Middleware ดูแลทุก route — ผู้ใช้ที่ยังไม่ได้ล็อกอินจะถูกเปลี่ยนเส้นทางไปหน้า Login")}
              </div>
            </div>
          </section>

          {/* ── 04 แดชบอร์ด ─────────────────────────────────────────── */}
          <section data-background-color={BG}>
            <div style={{ padding: "40px 60px" }}>
              {heading("ฟีเจอร์ที่ 02", "หน้าแดชบอร์ด")}
              {story("ในฐานะผู้ใช้ ฉันต้องการเห็นภาพรวม SKU ทั้งหมด เพื่อตรวจสอบสถานะข้อมูลในระบบ")}

              {/* Stat cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, maxWidth: 720, marginBottom: 24 }}>
                {[
                  ["อนุมัติแล้ว", stats?.totalApproved ?? "—", "#059669"],
                  ["รอดำเนินการ", stats?.totalPending  ?? "—", "#d97706"],
                  ["ถูกปฏิเสธ",  stats?.totalRejected ?? "—", "#dc2626"],
                  ["ยี่ห้อ",     stats?.totalBrands   ?? "—", "#7c3aed"],
                ].map(([label, value, color]) => (
                  <div key={label as string} style={{ background: CARD, border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 12px", textAlign: "center" }}>
                    <div style={{ color: color as string, fontSize: 34, fontWeight: 700, lineHeight: 1 }}>{value}</div>
                    <div style={{ color: DIM, fontSize: 14, marginTop: 6 }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Bar chart */}
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 90, maxWidth: 500 }}>
                {TYPES.map(t => {
                  const val = stats?.byType[t] ?? 0
                  const pct = Math.round((val / maxType) * 100)
                  return (
                    <div key={t} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <div style={{ color: DIM, fontSize: 11 }}>{val || "—"}</div>
                      <div style={{ background: EM, width: "100%", height: `${Math.max(pct * 0.6, 4)}px`, borderRadius: "3px 3px 0 0", opacity: 0.85 }} />
                      <div style={{ color: DIM, fontSize: 11 }}>{t}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          {/* ── 05 เพิ่ม SKU ใหม่ ─────────────────────────────────────── */}
          <section data-background-color={BG}>
            <div style={{ padding: "40px 60px" }}>
              {heading("ฟีเจอร์ที่ 03", "เพิ่ม SKU ใหม่")}
              {story("ในฐานะผู้ใช้ทั่วไป ฉันต้องการสร้าง SKU ใหม่ เพื่อให้ผู้ดูแลระบบตรวจสอบและอนุมัติ")}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 760 }}>
                {[
                  ["รหัส SKU อัตโนมัติ",  "สร้างจาก คลัง + ประเภท + L1/L2/L3 + ลำดับ โดยอัตโนมัติ พร้อมแสดงตัวอย่างก่อนบันทึก"],
                  ["ลำดับชั้น 3 ระดับ",  "L1 ระบบ → L2 ชุดประกอบ → L3 ชิ้นส่วน — ดรอปดาวน์แบบต่อเนื่องกรองตามประเภทค่าใช้จ่าย"],
                  ["ข้อมูลครบถ้วน",       "ชื่อ TH+EN, เบอร์อะไหล่, ยี่ห้อ, เกรด, เบอร์แท้อ้างอิง, เบอร์เทียบ, รถที่ใช้งานได้, รหัส ATMS"],
                  ["ขั้นตอนการอนุมัติ",   "ผู้ใช้ทั่วไป → รอคิวอนุมัติ · ผู้ดูแลระบบ → อนุมัติทันทีเมื่อบันทึก"],
                ].map(([title, desc]) => (
                  <div key={title} style={{ background: CARD, border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 18px" }}>
                    <div style={{ color: EM, fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{title}</div>
                    <div style={{ color: DIM, fontSize: 14, lineHeight: 1.65 }}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── 06 คิวรออนุมัติ (Admin) ──────────────────────────────── */}
          <section data-background-color={BG}>
            <div style={{ padding: "40px 60px" }}>
              {heading("ฟีเจอร์ที่ 04 · เฉพาะผู้ดูแลระบบ", "คิวรออนุมัติ")}
              {story("ในฐานะผู้ดูแลระบบ ฉันต้องการตรวจสอบรายการ SKU ที่รอดำเนินการ เพื่ออนุมัติหรือปฏิเสธพร้อมเหตุผล")}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 700 }}>
                {row("↕", "แถวขยายได้",    "คลิกแถวเพื่อดูข้อมูล SKU ทั้งหมดก่อนตัดสินใจ")}
                {row("⚠", "ตรวจจับรายการซ้ำ", "ระบบแจ้งเตือนเมื่อพบ SKU ที่คล้ายกัน เพื่อป้องกันข้อมูลซ้ำซ้อน")}
                {row("✓", "อนุมัติ / ปฏิเสธ",  "อนุมัติบันทึกทันที · ปฏิเสธต้องระบุเหตุผลที่ผู้ส่งสามารถเห็นได้")}
              </div>
            </div>
          </section>

          {/* ── 07 ติดตามรายการที่ส่ง ─────────────────────────────────── */}
          <section data-background-color={BG}>
            <div style={{ padding: "40px 60px" }}>
              {heading("ฟีเจอร์ที่ 05", "ติดตามรายการที่ส่ง")}
              {story("ในฐานะผู้ใช้ทั่วไป ฉันต้องการดูสถานะของ SKU ที่ส่งไป เพื่อทราบว่าได้รับการอนุมัติหรือถูกปฏิเสธ")}
              <div style={{ display: "flex", gap: 20, marginBottom: 24, maxWidth: 560 }}>
                {[["⏳", "รอดำเนินการ", "#d97706"], ["✅", "อนุมัติแล้ว", "#059669"], ["❌", "ถูกปฏิเสธ", "#dc2626"]].map(([icon, label, color]) => (
                  <div key={label} style={{ flex: 1, background: CARD, border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 30 }}>{icon}</div>
                    <div style={{ color: color as string, fontWeight: 600, fontSize: 16, marginTop: 8 }}>{label}</div>
                  </div>
                ))}
              </div>
              <p style={{ color: DIM, fontSize: 14 }}>
                เหตุผลการปฏิเสธแสดงให้ผู้ส่งเห็น · SKU ที่ถูกปฏิเสธสามารถแก้ไขและส่งใหม่ได้
              </p>
            </div>
          </section>

          {/* ── 08 ค้นหาเบอร์อะไหล่ ──────────────────────────────────── */}
          <section data-background-color={BG}>
            <div style={{ padding: "40px 60px" }}>
              {heading("ฟีเจอร์ที่ 06", "ค้นหาด้วยเบอร์อะไหล่ (OE Search)")}
              {story("ในฐานะผู้ใช้ ฉันต้องการค้นหาด้วยเบอร์อะไหล่หรือเบอร์แท้อ้างอิง เพื่อค้นหา SKU ที่ต้องการได้อย่างรวดเร็ว")}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, maxWidth: 680, marginBottom: 18 }}>
                {[
                  ["เบอร์ตรง", "ตรงกับเบอร์อะไหล่หลัก",    "#059669"],
                  ["OEM ref",  "ตรงกับเบอร์แท้อ้างอิง",     "#2563eb"],
                  ["เทียบได้", "ตรงกับรายการเบอร์เทียบ",    "#d97706"],
                ].map(([tag2, desc, color]) => (
                  <div key={tag2} style={{ background: CARD, border: "1px solid #e5e7eb", borderRadius: 10, padding: "18px 16px", textAlign: "center" }}>
                    <div style={{ color: color as string, fontWeight: 700, fontSize: 18, marginBottom: 8 }}>{tag2}</div>
                    <div style={{ color: DIM, fontSize: 13, lineHeight: 1.5 }}>{desc}</div>
                  </div>
                ))}
              </div>
              <p style={{ color: DIM, fontSize: 14 }}>
                ผลลัพธ์ไฮไลต์ฟิลด์ที่ตรงกัน · แสดงประเภท เกรด ราคา และการจำแนกประเภท L1/L2/L3
              </p>
            </div>
          </section>

          {/* ── 09 พจนานุกรมรหัส (Admin) ─────────────────────────────── */}
          <section data-background-color={BG}>
            <div style={{ padding: "40px 60px" }}>
              {heading("ฟีเจอร์ที่ 07 · เฉพาะผู้ดูแลระบบ", "จัดการพจนานุกรมรหัส")}
              {story("ในฐานะผู้ดูแลระบบ ฉันต้องการจัดการรหัสอ้างอิง เพื่อให้ข้อมูลในระบบถูกต้องและเป็นปัจจุบัน")}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxWidth: 680, marginBottom: 18 }}>
                {["คลังสินค้า", "ประเภทค่าใช้จ่าย", "ระบบ L1", "ชุดประกอบ L2", "ชิ้นส่วน L3", "ตำแหน่ง", "หน่วย", "เกรด", "ประเภทรถ", "ยี่ห้อ"].map(tag)}
              </div>
              <p style={{ color: DIM, fontSize: 14 }}>
                เพิ่ม · แก้ไข · ลบ พร้อมป้ายกำกับ TH + EN · L2 กรองตาม L1 · L3 กรองตาม L1 + L2 เพื่อความสมบูรณ์ของข้อมูล
              </p>
            </div>
          </section>

          {/* ── 10 ต้นไม้อะไหล่ & ทะเบียนรถ ─────────────────────────── */}
          <section data-background-color={BG}>
            <div style={{ padding: "40px 60px" }}>
              {heading("ฟีเจอร์ที่ 08", "ต้นไม้อะไหล่ & ทะเบียนรถ")}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, maxWidth: 740, marginTop: 16 }}>
                {card("🌳", "ลำดับชั้นอะไหล่",
                  "โครงสร้างแบบ drill-down: L1 → L2 → L3 เรียกดูการจำแนกประเภทอะไหล่ทั้งหมดเพื่อใช้อ้างอิงและตรวจสอบความสอดคล้องของข้อมูล")}
                {card("🚛", "ทะเบียนรถ",
                  "เชื่อมโยง SKU กับรถที่ใช้งานได้ตามทะเบียนหรือรุ่น ใช้ระหว่างการสร้าง SKU เพื่อระบุความเข้ากันได้กับรถในกองยาน")}
              </div>
            </div>
          </section>

          {/* ── 11 สิทธิ์การใช้งาน ────────────────────────────────────── */}
          <section data-background-color={BG}>
            <div style={{ padding: "40px 60px" }}>
              <div style={{ fontSize: 13, letterSpacing: "0.3em", color: EM, textTransform: "uppercase", marginBottom: 6 }}>สรุป</div>
              <h2 style={{ fontSize: 36, fontWeight: 700, color: TXT, margin: "0 0 24px" }}>สิทธิ์การใช้งานตามบทบาท</h2>
              <div style={{ maxWidth: 680 }}>
                {/* Header */}
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", paddingBottom: 10, borderBottom: `2px solid ${EM}`, marginBottom: 2 }}>
                  <div style={{ color: EM, fontWeight: 700, fontSize: 15 }}>ฟีเจอร์</div>
                  <div style={{ color: EM, fontWeight: 700, fontSize: 15, textAlign: "center" }}>ผู้ใช้ทั่วไป</div>
                  <div style={{ color: EM, fontWeight: 700, fontSize: 15, textAlign: "center" }}>ผู้ดูแลระบบ</div>
                </div>
                {[
                  ["ดู SKU ที่อนุมัติแล้ว",       true,  true],
                  ["สร้าง SKU ใหม่",              true,  true],
                  ["อนุมัติ / ปฏิเสธ SKU",        false, true],
                  ["จัดการพจนานุกรมรหัส",         false, true],
                  ["ดูคิวรออนุมัติ",              false, true],
                  ["ติดตามรายการที่ส่ง",           true,  true],
                ].map(([feature, user, admin]) => (
                  <div key={feature as string} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", padding: "11px 0", borderBottom: "1px solid #f3f4f6" }}>
                    <div style={{ color: TXT, fontSize: 15 }}>{feature as string}</div>
                    <div style={{ textAlign: "center", fontSize: 18, color: user ? EM : "#d1d5db" }}>{user ? "✓" : "—"}</div>
                    <div style={{ textAlign: "center", fontSize: 18, color: EM }}>✓</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
