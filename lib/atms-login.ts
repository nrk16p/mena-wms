// lib/atms-login.ts — login ATMS ด้วย username/password แทนผู้ใช้ แล้วได้ PHPSESSID มาใช้ดึงข้อมูลต่อ (ฝั่งเซิร์ฟเวอร์เท่านั้น)
//
// ทำไม: เดิมหน้ายางให้ผู้ใช้เปิด DevTools ไปก๊อป PHPSESSID เองทุกครั้งที่ session หลุด
// ตอนนี้ใช้บัญชี ATMS ที่ผู้ใช้ผูกไว้ (เก็บเข้ารหัสใน store_atms_creds ชุดเดียวกับงานเบิกของ) login ให้อัตโนมัติ
//
// ฟอร์ม login ของ ATMS ไม่มี CSRF token (ตรวจ 13/11/2026): GET หน้า login ได้คุกกี้ → POST ด้วยคุกกี้นั้น
//   สำเร็จ = 302 ออกจากหน้า login · ผิด = 200 กลับมาหน้าฟอร์มพร้อม "ชื่อผู้ใช้งาน หรือ รหัสผ่านไม่ถูกต้อง"
import https from "node:https"
import { credCol } from "@/lib/store-withdraw/db"
import { getCreds } from "@/lib/store-withdraw/creds"
import { decryptSecret, encryptSecret } from "@/lib/store-withdraw/crypto"

const LOGIN_URL = "https://www.mena-atms.com/account/user/login"
const agent = new https.Agent({ rejectUnauthorized: false })

export class AtmsLoginError extends Error { constructor() { super("bad_credentials") } }
export class AtmsLoginNetworkError extends Error {}

type Raw = { status: number; location: string; cookie: string; body: string }

function request(method: "GET" | "POST", cookie: string, form?: string): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const u = new URL(LOGIN_URL)
    const headers: Record<string, string> = {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "th,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (mena-wms)",
    }
    if (cookie) headers.Cookie = `PHPSESSID=${cookie}`
    if (form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded"
      headers["Content-Length"] = String(Buffer.byteLength(form))
    }
    const req = https.request({ hostname: u.hostname, path: u.pathname, method, agent, timeout: 30000, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (c: Buffer) => chunks.push(c))
      res.on("end", () => {
        const set = ([] as string[]).concat(res.headers["set-cookie"] ?? [])
        const m = set.join(";").match(/PHPSESSID=([^;\s]+)/)
        resolve({
          status: res.statusCode ?? 0,
          location: String(res.headers.location ?? ""),
          cookie: m ? m[1] : "",
          body: Buffer.concat(chunks).toString("utf8"),
        })
      })
      res.on("error", reject)
    })
    req.on("timeout", () => { req.destroy(); reject(new AtmsLoginNetworkError("ATMS ไม่ตอบ (timeout)")) })
    req.on("error", (e) => reject(new AtmsLoginNetworkError(e.message)))
    if (form) req.write(form)
    req.end()
  })
}

/** login แล้วคืน PHPSESSID · รหัสผิด = AtmsLoginError · ติดต่อไม่ได้ = AtmsLoginNetworkError */
export async function atmsLogin(username: string, password: string): Promise<string> {
  const first = await request("GET", "")
  if (!first.cookie) throw new AtmsLoginNetworkError("ATMS ไม่ส่ง session กลับมา")
  const form = new URLSearchParams({ username, password, submit: "login", next: "" }).toString()
  const res = await request("POST", first.cookie, form)
  const backToLogin = res.status === 200 || /\/account\/user\/login/.test(res.location)
  if (backToLogin) throw new AtmsLoginError()
  if (res.status < 300 || res.status >= 400) throw new AtmsLoginNetworkError(`ATMS ตอบ ${res.status}`)
  // PHP อาจออก session id ใหม่ตอน login สำเร็จ — ถ้ามีให้ใช้ตัวใหม่
  return res.cookie || first.cookie
}

const key = (email: string) => email.trim().toLowerCase()

/**
 * PHPSESSID ของผู้ใช้จากบัญชี ATMS ที่ผูกไว้ — null = ยังไม่ผูก (หรือกุญแจเข้ารหัสเปลี่ยน ต้องผูกใหม่)
 * fresh=false ใช้ session ที่แคชไว้ก่อน (ไม่ต้อง login ทุกครั้ง) · fresh=true login ใหม่แล้วแคชทับ
 */
export async function linkedAtmsSession(email: string, fresh = false): Promise<{ phpsessid: string; username: string } | null> {
  const col = await credCol()
  const doc = await col.findOne({ email: key(email) })
  if (!doc) return null
  if (!fresh && doc.sessionEnc) {
    try {
      return { phpsessid: decryptSecret(doc.sessionEnc), username: doc.atmsUsername }
    } catch { /* แคชเสีย — login ใหม่ด้านล่าง */ }
  }
  let creds: { username: string; password: string } | null
  try {
    creds = await getCreds(email)
  } catch {
    return null // ถอดรหัสไม่ได้ (เปลี่ยนกุญแจ) = ถือว่ายังไม่ผูก
  }
  if (!creds) return null
  const phpsessid = await atmsLogin(creds.username, creds.password)
  await col.updateOne({ email: key(email) }, { $set: { sessionEnc: encryptSecret(phpsessid), sessionAt: new Date() } })
  return { phpsessid, username: creds.username }
}
