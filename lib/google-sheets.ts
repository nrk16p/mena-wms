// Google Sheets client แบบไม่พึ่ง googleapis — เซ็น JWT RS256 ด้วย node:crypto แล้วเรียก REST ตรง
// server-only — service account key อยู่ใน env ห้าม import จาก client component

import { createSign } from "node:crypto"

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets"
const SCOPE = "https://www.googleapis.com/auth/spreadsheets"

type ServiceAccount = { client_email: string; private_key: string }

function serviceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set")
  const j = JSON.parse(raw)
  if (!j.client_email || !j.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing client_email/private_key")
  return j
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url")

// cache access token ใน module scope — หมดอายุ 1 ชม. ต่ออายุล่วงหน้า 5 นาที
let cachedToken: { token: string; exp: number } | null = null

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.exp - 300 > now) return cachedToken.token

  const sa = serviceAccount()
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  }))
  const signer = createSign("RSA-SHA256")
  signer.update(`${header}.${claims}`)
  const jwt = `${header}.${claims}.${signer.sign(sa.private_key, "base64url")}`

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  })
  if (!res.ok) throw new Error(`Google token ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  cachedToken = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) }
  return cachedToken.token
}

async function sheetsFetch(path: string, init?: RequestInit): Promise<unknown> {
  const token = await accessToken()
  const res = await fetch(`${SHEETS_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

/** อ่านค่าทั้ง range (ค่าที่แสดงผลตามที่เห็นในชีต) */
export async function readRange(spreadsheetId: string, range: string): Promise<string[][]> {
  const data = await sheetsFetch(
    `/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`
  ) as { values?: string[][] }
  return data.values ?? []
}

/** เขียนหลายเซลล์ในครั้งเดียว — data: [{range: "'Tab'!T5", values: [["ME018"]]}] */
export async function batchUpdateValues(
  spreadsheetId: string,
  data: { range: string; values: string[][] }[]
): Promise<void> {
  await sheetsFetch(`/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  })
}

/** แปลง column index (0-based) เป็นตัวอักษรคอลัมน์ A1 เช่น 19 -> T */
export function colLetter(index: number): string {
  let n = index + 1, s = ""
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}
