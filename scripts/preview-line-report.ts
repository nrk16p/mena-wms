/* พรีวิวข้อความ "รายงานสรุปประจำวัน" / "ไม่มี PR" จากเทอร์มินัล โดยไม่ต้องเปิดหน้าเว็บ
 * ป้อน JSON ที่ได้จาก /api/repair-external/daily-summary เข้ามาทาง stdin:
 *   curl -s "$URL/api/repair-external/daily-summary" -H "Cookie: next-auth.session-token=$TOKEN" \
 *     | npx tsx scripts/preview-line-report.ts [--nopr]
 * ใช้ฟังก์ชันเดียวกับหน้าเว็บ (lib/repair-external) ข้อความจึงตรงกับที่ผู้ใช้จะได้จริง
 */
import { buildDailySummaryText, buildNoPrOverviewText, type DailySummary } from "../lib/repair-external"

const origin = process.env.ORIGIN ?? "https://mena-wms.vercel.app"
const noPr   = process.argv.includes("--nopr")

let raw = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (c) => { raw += c })
process.stdin.on("end", () => {
  let data: DailySummary
  try { data = JSON.parse(raw) } catch { console.error("อ่าน JSON ไม่ได้ — ส่งผลลัพธ์จาก /daily-summary เข้ามาทาง stdin"); process.exit(1) }
  console.log(noPr ? buildNoPrOverviewText(data, { origin }) : buildDailySummaryText(data, { origin }))
})
