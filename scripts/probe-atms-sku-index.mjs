// scripts/probe-atms-sku-index.mjs
// รัน: node scripts/probe-atms-sku-index.mjs
// ยิง ATMS 1 request เพื่อยืนยันลำดับคอลัมน์ของหน้า SKU index ก่อนเขียน job จริง
import https from "node:https"

const SESSION = process.env.ATMS_SKU_SESSION || "06loqvjfva9b4l6mgnrjm9h07c"
const agent = new https.Agent({ rejectUnauthorized: false })

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      {
        hostname: u.hostname, path: u.pathname + u.search, method: "GET", agent, timeout: 120000,
        headers: { Cookie: `PHPSESSID=${SESSION}`, "Accept-Language": "th,en;q=0.9" },
      },
      (res) => {
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (c) => (body += c))
        res.on("end", () => resolve(body))
      }
    )
    req.on("error", reject)
    req.on("timeout", () => req.destroy(new Error("timeout")))
    req.end()
  })
}

const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()

const qs = new URLSearchParams({
  code: "", name: "", remark: "", type: "", inventory_id: "4", sku_tag_id: "",
  stock_unit_id: "", brand_id: "", is_tire: "", trackable: "", has_serial_no: "",
  no_gl_code: "0", submit: "ค้นหา", order_by: "s.code asc", page: "1",
})

const html = await fetchHtml(`https://www.mena-atms.com/inv/sku/index?${qs}`)

if (/name=["']LoginForm/i.test(html) || /เข้าสู่ระบบ/.test(html)) {
  console.error("❌ คุกกี้หมดอายุ — ตั้ง ATMS_SKU_SESSION ใหม่ก่อน")
  process.exit(1)
}

const thead = html.match(/<thead[\s\S]*?<\/thead>/)
if (thead) {
  const ths = [...thead[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => strip(m[1]))
  console.log("=== หัวตาราง ===")
  ths.forEach((t, i) => console.log(`  [${i}] ${t}`))
}

const tbody = html.match(/<tbody[\s\S]*?<\/tbody>/)
if (!tbody) { console.error("❌ ไม่พบ tbody"); process.exit(1) }

const rows = [...tbody[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
console.log(`\n=== ${rows.length} แถวในหน้านี้ · ตัวอย่าง 5 แถวแรก ===`)
for (const tr of rows.slice(0, 5)) {
  const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]))
  console.log(`  จำนวน td = ${tds.length}`)
  tds.forEach((t, i) => console.log(`    [${i}] ${t.slice(0, 40)}`))
  console.log("")
}

const total = strip(html).match(/[\d,]+\s*-\s*[\d,]+\s*\/\s*([\d,]+)/)
console.log("=== ยอดรวมจากแถบแบ่งหน้า ===", total ? total[1] : "ไม่พบ")
