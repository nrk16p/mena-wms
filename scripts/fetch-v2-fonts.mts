// scripts/fetch-v2-fonts.mts — ดึงฟอนต์ menaIT V.2 มาเก็บในโปรเจกต์
//   รัน: npx tsx scripts/fetch-v2-fonts.mts
//
// ทำไมต้องโฮสต์เอง: เดิมหน้า /sku/convert ใช้ next/font/google ซึ่งไปดึงไฟล์ฟอนต์จาก Google
// *ตอน build* → build บน Vercel ล้มเมื่อดึงไม่สำเร็จ (13/10/2026 deployment af6c94f:
// "NextFontGoogleFontFileReplacer ... Error while looking up import map") ทั้งที่โค้ดไม่มีปัญหา
// ย้ายมาเป็นไฟล์ในโปรเจกต์แล้ว build ไม่ต้องต่อเน็ตอีก
//
// เขียนไฟล์ลง public/fonts/v2/*.woff2 + app/sku/convert/v2-fonts.css (@font-face ที่ชี้ไปที่ไฟล์นั้น)
// เก็บเฉพาะ subset latin + thai ชุดเดียวกับที่ next/font/google เคยดึง (unicode-range ของ Google
// ติดมาในแต่ละบล็อก เบราว์เซอร์จึงโหลดเฉพาะช่วงที่หน้านั้นใช้จริง)
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const CSS_URL = "https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600;700"
  + "&family=Noto+Sans+Thai:wght@400;500;600&display=swap"
// Google ตอบ woff2 เฉพาะกับ UA ที่รองรับ — UA เปล่าจะได้ ttf ไฟล์ใหญ่กว่าหลายเท่า
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
const KEEP = new Set(["latin", "thai"])
const OUT_DIR = "public/fonts/v2"
const CSS_OUT = "app/sku/convert/v2-fonts.css"

const res = await fetch(CSS_URL, { headers: { "User-Agent": UA } })
if (!res.ok) throw new Error(`โหลด CSS จาก Google ไม่สำเร็จ: ${res.status}`)
const css = await res.text()

const blocks = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*(@font-face \{[\s\S]*?\})/g)]
const keep = blocks.filter((m) => KEEP.has(m[1]))
if (!keep.length) throw new Error("ไม่เจอบล็อก @font-face ที่ต้องการ — Google เปลี่ยนรูปแบบ CSS?")

await mkdir(OUT_DIR, { recursive: true })
const out: string[] = [
  "/* app/sku/convert/v2-fonts.css — @font-face ของฟอนต์ที่โฮสต์เอง (public/fonts/v2)",
  " * ไฟล์นี้ถูกสร้างด้วย scripts/fetch-v2-fonts.mts — แก้ที่สคริปต์แล้วรันใหม่ ไม่ต้องแก้มือ",
  ` * ที่มา: ${CSS_URL}`,
  " */",
  "",
]
let total = 0
for (const [, subset, block] of keep) {
  const fam = /font-family:\s*'([^']+)'/.exec(block)![1]
  const weight = /font-weight:\s*(\d+)/.exec(block)![1]
  const url = /url\((https:\/\/[^)]+\.woff2)\)/.exec(block)![1]
  const name = `${fam.replace(/\s+/g, "")}-${weight}-${subset}.woff2`
  const file = await fetch(url, { headers: { "User-Agent": UA } })
  if (!file.ok) throw new Error(`โหลด ${name} ไม่สำเร็จ: ${file.status}`)
  const buf = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(OUT_DIR, name), buf)
  total += buf.length
  console.log(`   ${name.padEnd(38)} ${(buf.length / 1024).toFixed(1)} KB`)
  out.push(block.replace(/url\(https:\/\/[^)]+\.woff2\)/, `url(/fonts/v2/${name})`).trim(), "")
}
await writeFile(CSS_OUT, out.join("\n"))
console.log(`รวม ${keep.length} ไฟล์ ${(total / 1024).toFixed(1)} KB → ${OUT_DIR}`)
console.log(`เขียน @font-face ${keep.length} บล็อก → ${CSS_OUT}`)
