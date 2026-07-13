import * as XLSX from "xlsx"
import https from "node:https"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_change"

// ATMS branch_id: 2=ลาดกระบัง, 3=สระบุรี, 5=ขอนแก่น, 7=DIST
// ขอนแก่น รวมเข้า ลาดกระบัง / DIST รวมเข้า สระบุรี
export const BRANCH_IDS: Record<string, string[]> = {
  latkrabang: ["2", "5"],
  saraburi:   ["3", "7"],
}

export class AtmsSessionError extends Error { constructor() { super("session_expired") } }
export class AtmsNetworkError extends Error {}
export class AtmsEmptyError   extends Error { constructor() { super("no_data") } }

const agent = new https.Agent({ rejectUnauthorized: false })

function exportUrl(branchId: string) {
  const qs = new URLSearchParams({
    page: "1", vehicle: "", maintenance_request: "", serial_no: "",
    branch_id: branchId, tire_position_id: "", is_latest: "",
    sell_repair_status: "", from_change_date: "", to_change_date: "",
    submit: "ค้นหา", order_by: "t.updated_at asc",
  })
  return `https://www.mena-atms.com/veh/tire/index.export/?${qs}`
}

function fetchAtms(url: string, phpsessid: string): Promise<{ contentType: string; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET", agent, timeout: 120000,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
        Connection: "keep-alive",
        Cookie: `PHPSESSID=${phpsessid}`,
        Referer: "https://www.mena-atms.com/veh/tire/index/",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36",
      },
    }
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (c: Buffer) => chunks.push(c))
      res.on("end", () => resolve({ contentType: (res.headers["content-type"] as string) || "", buffer: Buffer.concat(chunks) }))
      res.on("error", reject)
    })
    req.on("timeout", () => { req.destroy(); reject(new AtmsNetworkError("Request timed out")) })
    req.on("error", (e) => reject(new AtmsNetworkError(e.message)))
    req.end()
  })
}

function parseThaiDate(s: string): Date | null {
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (!m) return null
  return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0))
}

function parseExcelDate(v: unknown): Date | null {
  if (typeof v === "number" && v > 20000) return new Date(Math.round((v - 25569) * 86400 * 1000))
  if (typeof v === "string") return parseThaiDate(v)
  return null
}

function toNum(v: unknown): number {
  return Number(String(v ?? "").replace(/,/g, "")) || 0
}

const STATUS_MAP: Record<string, string> = {
  "อื่นๆ":           "Withdraw",
  "ขายแล้ว":         "Sold",
  "หล่อดอกเรียบร้อย": "Retreaded",
  "รอขาย":           "Pending Sale",
  "A2":              "Retreaded",
}

export type SyncResult = {
  branch:       string
  count:        number
  stockUpdated: number
  syncedAt:     Date
}

/** Fetch from ATMS (ทุก branch_id ของสาขานั้น), replace tire_change for this branch, auto-update tire_stock statuses. */
export async function runBranchSync(branch: string, phpsessid: string): Promise<SyncResult> {
  const branchIds = BRANCH_IDS[branch]
  if (!branchIds?.length) throw new Error(`Unknown branch: ${branch}`)

  const rows: Record<string, unknown>[] = []
  for (const branchId of branchIds) {
    let raw: { contentType: string; buffer: Buffer }
    try {
      raw = await fetchAtms(exportUrl(branchId), phpsessid)
    } catch (err) {
      throw err instanceof AtmsNetworkError ? err : new AtmsNetworkError(String(err))
    }

    if (!raw.contentType.includes("excel") && !raw.contentType.includes("spreadsheet")) {
      throw new AtmsSessionError()
    }

    const workbook = XLSX.read(raw.buffer, { type: "buffer", raw: true })
    const sheet    = workbook.Sheets[workbook.SheetNames[0]]
    rows.push(...XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true }))
  }
  if (rows.length === 0) throw new AtmsEmptyError()

  const syncedAt = new Date()
  const docs = rows.map((row) => ({
    branch,
    vehicle:            String(row["ยานพาหนะ"] ?? ""),
    tirePosition:       String(row["ตำแหน่งยาง"] ?? ""),
    product:            String(row["สินค้า"] ?? ""),
    serialNo:           String(row["serial no"] ?? ""),
    treadMm:            toNum(row["มม."]),
    mileageStart:       toNum(row["เลขไมล์เริ่มต้น"]),
    mileageEnd:         toNum(row["เลขไมล์สิ้นสุด"]),
    maintenanceRequest: String(row["แจ้งซ่อม / ขอเปลี่ยนยาง"] ?? ""),
    changeIn:           parseThaiDate(String(row["เปลี่ยนเข้า"] ?? "")),
    changeOut:          parseThaiDate(String(row["เปลี่ยนออก"] ?? "")),
    isLatest:           String(row["ล่าสุด"] ?? "").trim().toLowerCase() === "yes",
    sellRepairStatus:   String(row["ส่ง ขาย / ซ่อม"] ?? ""),
    updatedAt:          parseExcelDate(row["แก้ไขเมื่อ"]),
    syncedAt,
  }))

  const client   = await clientPromise
  const col      = client.db(DB).collection(COLL)
  await col.deleteMany({ branch })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await col.insertMany(docs as any)

  const stockCol     = client.db(DB).collection("tire_stock")
  const latestDocs   = docs.filter((d) => d.isLatest && d.serialNo)
  const stockUpdates = latestDocs.map((d) => ({
    updateOne: {
      filter: { branch, serialNo: d.serialNo },
      update: { $set: { status: STATUS_MAP[d.sellRepairStatus] ?? "In Stock", updatedAt: syncedAt } },
    },
  }))
  let stockUpdated = 0
  if (stockUpdates.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await stockCol.bulkWrite(stockUpdates as any)
    stockUpdated = r.modifiedCount
  }

  return { branch, count: docs.length, stockUpdated, syncedAt }
}
