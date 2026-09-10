// scripts/mint-session-token.ts — dev only: สร้าง next-auth session cookie สำหรับทดสอบ API ด้วย curl
// รัน: npx tsx scripts/mint-session-token.ts   → พิมพ์ token
import fs from "node:fs"
import { encode } from "next-auth/jwt"
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")] }))
// สคริปต์นี้ปั๊ม session cookie ที่ผ่าน auth ได้จริง — ถ้า .env ชี้ไปโดเมนจริง แปลว่ากำลังจะสร้าง token ของ production
if (!/localhost|127\.0\.0\.1/.test(env.NEXTAUTH_URL ?? "")) throw new Error("mint-session-token: dev only (NEXTAUTH_URL is not localhost)")
// IIFE: package.json ไม่มี "type": "module" → tsx transform เป็น CJS ซึ่งไม่รองรับ top-level await
void (async () => {
  const token = await encode({ secret: env.NEXTAUTH_SECRET, token: { name: "API Test", email: "apitest@menatransport.co.th", sub: "apitest", role: "user", employee: { username: "apitest", department: "ทดสอบ", position: "ทดสอบ" } } })
  console.log(token)
})()
