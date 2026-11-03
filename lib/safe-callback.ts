// lib/safe-callback.ts — ปลายทางหลัง login (callbackUrl ที่ middleware ใส่มา) · รับเฉพาะ path ในเว็บนี้ กันลิงก์พาไปเว็บอื่น
export function safeCallback(raw: string | null | undefined): string {
  const s = (raw ?? "").trim()
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("\\")) return "/"
  if (/[\u0000-\u001f]/.test(s)) return "/"
  if (s === "/login" || s.startsWith("/login?") || s.startsWith("/login/")) return "/"
  return s
}
