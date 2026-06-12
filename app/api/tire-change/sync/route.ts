import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import https from "node:https"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_change"

// ATMS branch_id values (from the branch dropdown on /veh/tire/index)
const BRANCH_IDS: Record<string, string> = {
  latkrabang: "2",
  saraburi:   "3",
}

const agent = new https.Agent({ rejectUnauthorized: false })

function exportUrl(branchId: string) {
  const qs = new URLSearchParams({
    page: "1",
    vehicle: "",
    maintenance_request: "",
    serial_no: "",
    branch_id: branchId,
    tire_position_id: "",
    is_latest: "",
    sell_repair_status: "done",
    from_change_date: "",
    to_change_date: "",
    submit: "ค้นหา",
    order_by: "t.updated_at asc",
  })
  return `https://www.mena-atms.com/veh/tire/index.export/?${qs}`
}

function fetchAtms(url: string, phpsessid: string): Promise<{ contentType: string; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      agent,
      timeout: 120000,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
        Connection: "keep-alive",
        Cookie: `PHPSESSID=${phpsessid}`,
        Referer: "https://www.mena-atms.com/veh/tire/index/",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 13; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36",
      },
    }

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (chunk: Buffer) => chunks.push(chunk))
      res.on("end", () =>
        resolve({
          contentType: (res.headers["content-type"] as string) || "",
          buffer: Buffer.concat(chunks),
        })
      )
      res.on("error", reject)
    })

    req.on("timeout", () => {
      req.destroy()
      reject(new Error("Request timed out"))
    })
    req.on("error", reject)
    req.end()
  })
}

// "29/05/2026 12:24" → Date | null
function parseThaiDate(s: string): Date | null {
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (!m) return null
  return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0))
}

// Excel serial number (e.g. 46301.686) → Date | null
function parseExcelDate(v: unknown): Date | null {
  if (typeof v === "number" && v > 20000) return new Date(Math.round((v - 25569) * 86400 * 1000))
  if (typeof v === "string") return parseThaiDate(v)
  return null
}

// "1,234" / 1234 → number
function toNum(v: unknown): number {
  return Number(String(v ?? "").replace(/,/g, "")) || 0
}

// POST /api/tire-change/sync — { branch: "latkrabang" | "saraburi", phpsessid? }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const branch: string = body.branch ?? ""
  const phpsessid: string = body.phpsessid || process.env.ATMS_SESSION || ""

  const branchId = BRANCH_IDS[branch]
  if (!branchId)   return NextResponse.json({ error: "branch must be latkrabang or saraburi" }, { status: 400 })
  if (!phpsessid)  return NextResponse.json({ error: "PHPSESSID is required" }, { status: 400 })

  let result: { contentType: string; buffer: Buffer }
  try {
    result = await fetchAtms(exportUrl(branchId), phpsessid)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Failed to reach ATMS server: ${msg}` }, { status: 502 })
  }

  const { contentType, buffer } = result
  if (!contentType.includes("excel") && !contentType.includes("spreadsheet")) {
    return NextResponse.json(
      { error: "Session expired — วาง PHPSESSID ใหม่แล้วลองอีกครั้ง" },
      { status: 401 }
    )
  }

  // raw: true keeps dates as the original d/m/y strings instead of
  // letting XLSX guess (it misreads them as m/d/y serial numbers)
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true })

  if (rows.length === 0) {
    return NextResponse.json({ error: "No data in file" }, { status: 422 })
  }

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
    updatedAt:          parseExcelDate(row["แก้ไขเมื่อ"]), // raw string → parseThaiDate path
    syncedAt,
  }))

  const client = await clientPromise
  const col = client.db(DB).collection(COLL)

  // replace only this branch's records
  await col.deleteMany({ branch })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await col.insertMany(docs as any)

  return NextResponse.json({ branch, count: docs.length, syncedAt })
}
