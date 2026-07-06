import https from "node:https"
import { AtmsSessionError, AtmsNetworkError } from "@/lib/atms-sync"

// Session cookie for the ATMS activity log. The fallback value is committed
// intentionally (approved) so the cron works without extra env setup;
// set ATMS_SKU_SESSION in Vercel to override when the cookie rotates.
const ATMS_FALLBACK_SESSION = "g750scm4tc4r99mief0fmhn6f5"
export function atmsSkuSession(): string {
  return process.env.ATMS_SKU_SESSION || ATMS_FALLBACK_SESSION
}

/** ATMS inventory_id → warehouse display name (from the SKU index dropdown) */
export const INVENTORY_NAMES: Record<string, string> = {
  "3": "คลังสระบุรี", "4": "คลังลาดกระบัง", "5": "คลัง HR กรุงเทพ",
  "6": "คลัง HR ลาดกระบัง", "7": "คลัง HR สระบุรี", "8": "คลัง จป.สระบุรี",
  "9": "คลัง จป.ลาดกระบัง", "10": "คลังทรัพย์สิน", "11": "คลังขอนแก่น",
  "12": "คลัง IT", "13": "คลังฝ่ายขาย", "15": "คลังไม่มีสต๊อก ลาดกระบัง",
  "16": "คลัง จป. ขอนแก่น", "17": "คลังทรัพย์สินลาดกระบัง", "18": "คลังทรัพย์สินสระบุรี",
  "21": "คลังไม่มีสต๊อก สระบุรี", "22": "คลังไม่มีสต๊อก กรุงเทพฯ", "23": "คลังจัดส่ง ลาดกระบัง",
  "24": "คลัง DIST", "25": "คลัง DIST จป.สระบุรี", "26": "คลัง DIST HR สระบุรี",
  "31": "คลัง DIST จป.ขอนแก่น", "32": "คลัง DIST จัดส่ง ขอนแก่น", "33": "คลัง DIST ขอนแก่น (SB)",
  "34": "คลัง TDM", "35": "คลัง OPS", "36": "คลังฝ่ายสำนักเลขา",
  "37": "คลัง HR-ศูนย์จัดส่งบางปะกง", "38": "คลังจัดส่ง (บางปะกง)",
  "39": "คลัง บัญชีการเงิน สกท.", "40": "คลังจัดส่่ง (สระบุรี)",
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
  skuPk:       number
  username:    string
  addedAt:     Date
  addedAtText: string // "dd/mm/yyyy HH:MM" as displayed by ATMS (Thai local)
  month:       string // "YYYY-MM", derived from the ATMS-displayed date
  logId:       string // ATMS log row id, for the detail page with the input payload
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
    const logId = tr[1].match(/\/account\/log\/view\/id\/([a-f0-9]+)/)?.[1] ?? ""
    events.push({
      skuPk:       Number(tds[2]),
      username:    tds[0],
      addedAt:     new Date(+dm[3], +dm[2] - 1, +dm[1], +(dm[4] ?? 0), +(dm[5] ?? 0)),
      addedAtText: tds[1],
      month:       `${dm[3]}-${dm[2]}`,
      logId,
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

export type LogInput = { code: string; name: string; inventoryId: string }

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
}

/** The log detail page carries the submitted form as JSON — code, name, inventory_id, etc. */
export async function fetchLogInput(logId: string, phpsessid: string): Promise<LogInput | null> {
  const html = await fetchHtml(`https://www.mena-atms.com/account/log/view/id/${logId}`, phpsessid)
  const m = decodeEntities(stripTags(html)).match(/input\s*:\s*(\{[\s\S]*?\})\s*(?:ย้อนกลับ|$)/)
  if (!m) return null
  try {
    const input = JSON.parse(m[1])
    return {
      code:        String(input.code ?? ""),
      name:        String(input.name ?? ""),
      inventoryId: String(input.inventory_id ?? ""),
    }
  } catch {
    return null
  }
}

export type SkuMasterRow = {
  skuPk: number; code: string; name: string; group: string
  warehouse: string; oracleCode: string; brand: string; unit: string
}

/** Look a SKU up on the index by exact code — gives group/warehouse display names. */
export async function fetchSkuByCode(code: string, phpsessid: string): Promise<SkuMasterRow | null> {
  const qs = new URLSearchParams({
    code, name: "", remark: "", type: "", inventory_id: "", sku_tag_id: "",
    stock_unit_id: "", brand_id: "", is_tire: "", trackable: "", has_serial_no: "",
    no_gl_code: "0", submit: "ค้นหา", order_by: "s.code asc",
  })
  const html = await fetchHtml(`https://www.mena-atms.com/inv/sku/index?${qs}`, phpsessid)
  const tbody = html.match(/<tbody[\s\S]*?<\/tbody>/)
  if (!tbody) return null
  for (const tr of tbody[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const raw = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
    if (raw.length < 15) continue
    const tds = raw.map((m) => stripTags(m[1]))
    if (tds[0].toLowerCase() !== code.toLowerCase()) continue
    const pk = raw[14][1].match(/\/inv\/sku\/view\/id\/(\d+)/)
    if (!pk) continue
    return {
      skuPk: Number(pk[1]), code: tds[0], name: tds[1], group: tds[2],
      warehouse: tds[3], oracleCode: tds[4], brand: tds[5], unit: tds[9],
    }
  }
  return null
}
