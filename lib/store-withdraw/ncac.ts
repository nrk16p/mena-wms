// lib/store-withdraw/ncac.ts — ตัวเรียก api-ncac (ฝั่งเซิร์ฟเวอร์เท่านั้น)
export type NcacOpts = {
  creds?: { username: string; password: string }
  body?: unknown
  query?: Record<string, string | number | undefined>
  /** ไม่ระบุ = NCAC_TIMEOUT_MS (90 วิ ของงานตัดสต๊อก) · งานอ่านที่ห้ามค้างหน้าจอให้ใส่สั้น ๆ */
  timeoutMs?: number
}

export const NCAC_TIMEOUT_MS = 90_000

export async function ncac<T = unknown>(
  method: "GET" | "POST",
  path: string,
  opts: NcacOpts = {},
): Promise<{ status: number; data: T }> {
  const base = process.env.NCAC_BASE
  if (!base) throw new Error("ยังไม่ได้ตั้ง NCAC_BASE")
  const qs = opts.query
    ? Object.entries(opts.query).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")
    : ""
  const url = base.replace(/\/+$/, "") + path + (qs ? `?${qs}` : "")
  const headers: Record<string, string> = { "x-api-key": process.env.NCAC_API_KEY ?? "" }
  if (opts.body !== undefined) headers["content-type"] = "application/json"
  if (opts.creds) {
    headers["X-ATMS-Username"] = opts.creds.username
    headers["X-ATMS-Password"] = opts.creds.password
  }
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? NCAC_TIMEOUT_MS),
    cache: "no-store",
  })
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = { detail: text.slice(0, 300) } }
  }
  return { status: res.status, data: data as T }
}
