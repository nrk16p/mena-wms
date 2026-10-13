import "./v2.css"

// ฟอนต์ menaIT V.2 โฮสต์เองในโปรเจกต์ (@font-face อยู่ใน v2-fonts.css ที่ v2.css import เข้ามา)
// เดิมใช้ next/font/google ซึ่งดึงไฟล์จาก Google ตอน build → build บน Vercel ล้มเมื่อดึงไม่สำเร็จ
// (13/10/2026) ดูรายละเอียดและวิธีดึงไฟล์ใหม่ใน scripts/fetch-v2-fonts.mts
//
// next/font เคย preload ไฟล์ให้เอง — ทำเองแทนเฉพาะน้ำหนัก 400 ที่ทุกหน้าในกลุ่มนี้ใช้
// (น้ำหนักอื่นปล่อยให้โหลดตอนเบราว์เซอร์เจอว่าต้องใช้ ตามเดิมของ font-display: swap)
const PRELOAD = [
  "/fonts/v2/NotoSansThai-400-thai.woff2",
  "/fonts/v2/NotoSansThai-400-latin.woff2",
  "/fonts/v2/Prompt-400-thai.woff2",
  "/fonts/v2/Prompt-400-latin.woff2",
]

export default function ConvertLayout({ children }: { children: React.ReactNode }) {
  // Negative margins cancel the WMS <main> padding so the canvas/hero run edge to edge.
  return (
    <div className="v2-scope v2-canvas -mx-3 -my-4 min-h-full lg:-mx-7 lg:-my-6">
      {PRELOAD.map((href) => (
        <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
      ))}
      {children}
    </div>
  )
}
