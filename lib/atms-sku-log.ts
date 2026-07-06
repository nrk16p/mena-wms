import https from "node:https"
import { AtmsSessionError, AtmsNetworkError } from "@/lib/atms-sync"

// Session cookie for the ATMS activity log. The fallback value is committed
// intentionally (approved) so the cron works without extra env setup;
// set ATMS_SKU_SESSION in Vercel to override when the cookie rotates.
const ATMS_FALLBACK_SESSION = "g750scm4tc4r99mief0fmhn6f5"
export function atmsSkuSession(): string {
  return process.env.ATMS_SKU_SESSION || ATMS_FALLBACK_SESSION
}

const agent = new https.Agent({ rejectUnauthorized: false })

function fetchHtml(url: string, phpsessid: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET", agent, timeout: 240000,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
        Connection: "keep-alive",
        Cookie: `PHPSESSID=${phpsessid}`,
        Referer: "https://www.mena-atms.com/account/log/index",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36",
      },
    }
    const req = https.request(options, (res) => {
      const location = String(res.headers.location ?? "")
      if (location.includes("/account/user/login")) {
        res.resume()
        reject(new AtmsSessionError())
        return
      }
      const chunks: Buffer[] = []
      res.on("data", (c: Buffer) => chunks.push(c))
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
      res.on("error", reject)
    })
    req.on("timeout", () => { req.destroy(); reject(new AtmsNetworkError("Request timed out")) })
    req.on("error", (e) => reject(new AtmsNetworkError(e.message)))
    req.end()
  })
}

/** dd/mm/yyyy as used by the ATMS log filters and display */
function ddmmyyyy(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
}

function logIndexUrl(fromDate: string, toDate: string, page: number, orderBy = "created_at desc"): string {
  const qs = new URLSearchParams({
    model: "sku", app_action: "add",
    username: "", pk: "", ip: "", msg: "",
    from_created_at: fromDate, to_created_at: toDate,
    submit: "ค้นหา", order_by: orderBy, page: String(page),
  })
  return `https://www.mena-atms.com/account/log/index?${qs}`
}

/** Rows-per-page is stored server-side per session — pin it so pagination math holds. */
export async function ensureRowsPerPage(phpsessid: string, n = 1000): Promise<void> {
  await fetchHtml(`https://www.mena-atms.com/account/user/set.row.per.page/?row-per-page=${n}&redir=%2F`, phpsessid)
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
}

/** Total from the pagination bar: "1 - 1000 / 52,505" */
function parseTotal(html: string): number | null {
  const m = stripTags(html).match(/[\d,]+\s*-\s*[\d,]+\s*\/\s*([\d,]+)/)
  return m ? Number(m[1].replace(/,/g, "")) : null
}

export type SkuAddEvent = {
  skuPk:    number
  username: string
  addedAt:  Date
  month:    string // "YYYY-MM", derived from the ATMS-displayed (Thai local) date
}

function parseEventRows(html: string): SkuAddEvent[] {
  const tbody = html.match(/<tbody[\s\S]*?<\/tbody>/)
  if (!tbody) return []
  const events: SkuAddEvent[] = []
  for (const tr of tbody[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]))
    // columns: username, created_at, pk, model, action, ip, note, actions
    if (tds.length < 5 || tds[4] !== "add") continue
    const dm = tds[1].match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
    if (!dm) continue
    events.push({
      skuPk:    Number(tds[2]),
      username: tds[0],
      addedAt:  new Date(+dm[3], +dm[2] - 1, +dm[1], +(dm[4] ?? 0), +(dm[5] ?? 0)),
      month:    `${dm[3]}-${dm[2]}`,
    })
  }
  return events
}

/** All SKU "add" events in [from, to] (inclusive, dates only). Requires rows-per-page = 1000. */
export async function fetchAddEvents(from: Date, to: Date, phpsessid: string): Promise<SkuAddEvent[]> {
  const events: SkuAddEvent[] = []
  for (let page = 1; ; page++) {
    const html = await fetchHtml(logIndexUrl(ddmmyyyy(from), ddmmyyyy(to), page), phpsessid)
    const batch = parseEventRows(html)
    events.push(...batch)
    if (batch.length < 1000) break
  }
  return events
}

/** Count of SKU "add" events in a calendar month (single cheap request). */
export async function fetchMonthCount(year: number, month: number, phpsessid: string): Promise<number> {
  const lastDay = new Date(year, month, 0).getDate()
  const from = `01/${String(month).padStart(2, "0")}/${year}`
  const to   = `${String(lastDay).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`
  const html = await fetchHtml(logIndexUrl(from, to, 1, "created_at asc"), phpsessid)
  const total = parseTotal(html)
  return total ?? parseEventRows(html).length
}
