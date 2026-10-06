// scripts/check-driver-handover.ts — รัน: npx tsx scripts/check-driver-handover.ts
// lib/driver-handover.ts: อ่านชีตกับ Cloud Run พร้อมกัน · แคชแถวชีต (handover-sheet) · เขียนแล้วเห็นทันที · เส้นเขียนอ่านชีตสด
// ไม่ออกเน็ต/ไม่แตะ DB: fetch ถูกแทนด้วยตัวปลอม · Mongo client ปลอมตั้งไว้ใน global ก่อน import (lib/mongo จะไม่สร้าง client จริง)
//                       service account ใช้คีย์ที่สร้างในเครื่อง · Runtime Cache บังคับใช้หน่วยความจำ
import assert from "node:assert/strict"
import { generateKeyPairSync } from "node:crypto"

// ── สภาพแวดล้อมก่อน import ──────────────────────────────────────────────────
process.env.RUNTIME_CACHE_DISABLE_BUILD_CACHE = "true"
process.env.MONGO_URI = "mongodb://stub.invalid"   // lib/mongo แค่เช็คว่ามีค่า — client ปลอมตั้งไว้แล้วด้านล่าง
const audits: Record<string, unknown>[] = []
;(globalThis as Record<string, unknown>)._mongoClientPromise = Promise.resolve({
  db: () => ({ collection: () => ({ insertOne: async (d: Record<string, unknown>) => { audits.push(d) } }) }),
})
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
})
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "check@local.test", private_key: privateKey })

// ── ชีตปลอม (index คอลัมน์ตาม COL ใน lib) ────────────────────────────────────
const C = { informDate: 2, trainStart: 4, code: 5, name: 6, position: 8, customer: 9, status: 11, leaveDate: 12, truckNum: 19, plate: 20, trainDue: 39, receivedDate: 40 }
const DATA_START_ROW = 4
function mkRow(f: Partial<Record<keyof typeof C, string>>): string[] {
  const r = Array.from({ length: 41 }, () => "")
  for (const [k, v] of Object.entries(f)) r[C[k as keyof typeof C]] = v ?? ""
  return r
}
const initialRows = () => [
  mkRow({ code: "D001", name: "สมชาย", status: "รอรับรถ", customer: "ASIA MS", position: "Mixer L", trainDue: "01/10/2026" }),
  mkRow({ code: "D002", name: "สมหญิง", status: "ฝึกงาน", customer: "ASIA MS", position: "Mixer L", trainStart: "01/10/2026", truckNum: "ME 127", plate: "70-1234" }),
  mkRow({ code: "D003", name: "ไม่อยู่ในคิว", status: "ลาออก", customer: "ASIA MS", position: "Mixer L" }),
]
let sheet: string[][] = initialRows()
const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1

// ── fetch ปลอม: จดทุก request + หน่วงคำตอบได้ (gate) ──────────────────────────
type Call = { url: string; method: string }
const calls: Call[] = []
let gate: Promise<void> | null = null
let failSheet = false, failFleet = false
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } })
const fleet = {
  data: [{
    status_id: 2, status_name: "รถซ่อม",
    branches: [{ customers: [{ customer_name: "ASIA", vehicle_types: [{ vehicle_type_abbr: "ML", owner_types: [{ trucks: [
      { trucknum: "ME127", truckplate: "70-1234", sub_status_name: "B", sub_status_nickname: "ซ่อม", duration_days: 3, status_since: "2026-10-01T08:00:00", plant_name: "P1" },
      { trucknum: "ME200", truckplate: "70-9999", sub_status_name: "B", sub_status_nickname: "ซ่อม", duration_days: 9, status_since: "2026-09-27T08:00:00", plant_name: "P2" },
    ] }] }] }] }],
  }],
}
const openJobs = {
  items: [{
    plate: "70-1234", mr_code: "BKMR26100001", mr_id: 55,
    open_maintenance_job: {
      current_step: { step: { label_th: "รถซ่อม" }, note: "n", event_at: "2026-10-02T09:00:00" },
      expected_done_at: "2099-01-10T00:00:00", repair_mode_label: "อู่นอก", vendor_name: "อู่ A", severity: "light",
      pr_amount_total: 1200, purchase_links: [{ is_approved: true, purchase_orders: [{ received_status: "รับทั้งหมด" }] }],
    },
  }],
}
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const method = init?.method ?? "GET"
  calls.push({ url, method })
  if (gate) await gate
  if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "tok", expires_in: 3600 })
  if (url.includes("sheets.googleapis.com") && url.includes(":batchUpdate")) {
    const body = JSON.parse(String(init?.body)) as { data: { range: string; values: string[][] }[] }
    for (const d of body.data) {
      const m = d.range.match(/!([A-Z]+)(\d+)$/)!
      sheet[Number(m[2]) - DATA_START_ROW][colIndex(m[1])] = d.values[0][0]
    }
    return json({})
  }
  if (url.includes("sheets.googleapis.com")) {
    if (failSheet) { await new Promise((r) => setTimeout(r, 30)); return json({ error: "sheet down" }, 500) }
    const range = decodeURIComponent(url.split("/values/")[1].split("?")[0])
    const m = range.match(/!A(\d+):[A-Z]+(\d*)$/)!
    const from = Number(m[1]) - DATA_START_ROW
    const rows = m[2] ? sheet.slice(from, Number(m[2]) - DATA_START_ROW + 1) : sheet.slice(from)
    return json({ values: rows.map((r) => [...r]) })
  }
  if (url.includes("/repair-board/open-jobs")) return failFleet ? json({}, 503) : json(openJobs)
  if (url.includes("/fleet/current")) return failFleet ? json({}, 503) : json(fleet)
  throw new Error(`unexpected fetch ${url}`)
}) as typeof fetch

const isSheetRead = (c: Call) => c.url.includes("sheets.googleapis.com") && c.method === "GET"
const isFullSheetRead = (c: Call) => isSheetRead(c) && /A4%3A[A-Z]+\?/.test(c.url)
const count = (p: (c: Call) => boolean) => calls.filter(p).length
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))
const strip = <T extends { fetchedAt: string }>(d: T) => ({ ...d, fetchedAt: "" })

async function main() {
  const h = await import("../lib/driver-handover")
  const { invalidateCache, CACHE_TAGS } = await import("../lib/shared-cache")

  // 1. ครั้งแรก (แคชว่าง): เริ่มอ่านชีตกับยิง Cloud Run พร้อมกัน — ไม่รอชีตเสร็จก่อน
  let release!: () => void
  gate = new Promise<void>((r) => { release = r })
  const firstP = h.fetchHandoverData()
  await tick()
  const started = calls.map((c) => c.url)
  assert.ok(started.some((u) => u.startsWith("https://oauth2.googleapis.com/token") || u.includes("sheets.googleapis.com")), "ต้องเริ่มอ่านชีตแล้ว")
  assert.ok(started.some((u) => u.includes("/repair-board/open-jobs")), "open-jobs ต้องเริ่มระหว่างชีตยังไม่ตอบ")
  assert.ok(started.some((u) => u.includes("/fleet/current")), "fleet/current ต้องเริ่มระหว่างชีตยังไม่ตอบ")
  gate = null; release()
  const first = await firstP

  // ผลลัพธ์ยังเหมือนเดิม: คัดคนตามสถานะ + จับคู่รถ + สถานะรถของคนที่จองไว้
  assert.deepEqual(first.drivers.map((d) => [d.row, d.name, d.status]), [[4, "สมชาย", "รอรับรถ"], [5, "สมหญิง", "ฝึกงาน"]])
  assert.equal(first.drivers[0].readyDate, "2026-10-01")
  assert.deepEqual(first.drivers[1].truckStatus, { step: "รถซ่อม", expectedDone: "2099-01-10", parked: true, parkedDays: 3 })
  assert.deepEqual(first.trucks.map((t) => [t.trucknum, t.reservedBy, t.job?.mrCode ?? null, t.job?.partsInfo ?? null]),
    [["ME127", "สมหญิง", "BKMR26100001", "PR 1/1 อนุมัติ · PO 1/1 รับของครบ"], ["ME200", "", null, null]])
  const sheetReads1 = count(isFullSheetRead)
  assert.equal(sheetReads1, 1)

  // 2. ภายใน 30 วิ: ไม่อ่านชีตซ้ำ (แคช) แต่ผลเหมือนเดิมทุกช่อง · Cloud Run ยังยิงตามเดิม
  const fleetCalls = count((c) => c.url.includes("/fleet/current"))
  const second = await h.fetchHandoverData()
  assert.equal(count(isFullSheetRead), sheetReads1, "ภายใน freshMs ต้องใช้แถวชีตจากแคช")
  assert.equal(count((c) => c.url.includes("/fleet/current")), fleetCalls + 1)
  assert.deepEqual(strip(second), strip(first), "ผลจากแคชต้องเหมือนอ่านสด")

  // 3. fetchDrivers() (ใช้กันจองซ้ำตอน POST) ยังอ่านชีตสดทุกครั้ง
  await h.fetchDrivers()
  assert.equal(count(isFullSheetRead), sheetReads1 + 1, "fetchDrivers() ต้องอ่านสด ไม่ใช้แคช")

  // 4. อัปเดตสถานะผ่าน WMS: หาแถวจากชีตสด → เขียน → GET ถัดไปเห็นทันที (ล้างแคชแล้ว)
  const beforeWrite = calls.length
  await h.updateDriverStatus({ row: 5, code: "D002", name: "สมหญิง", fromStatus: "ฝึกงาน", toStatus: "รอรับรถ", by: "tester" })
  const writeCalls = calls.slice(beforeWrite)
  assert.ok(writeCalls.some((c) => isSheetRead(c) && c.url.includes(encodeURIComponent("A5:AO5"))), "ต้องเช็คแถวจากชีตสด")
  assert.ok(writeCalls.some((c) => c.url.includes(":batchUpdate")))
  assert.equal(audits.at(-1)?.action, "update_status", "ยังลง log เหมือนเดิม")
  const reads2 = count(isFullSheetRead)
  const afterStatus = await h.fetchHandoverData()
  assert.equal(count(isFullSheetRead), reads2 + 1, "หลังเขียนต้องอ่านชีตใหม่")
  assert.equal(afterStatus.drivers.find((d) => d.code === "D002")?.status, "รอรับรถ", "ต้องเห็นสถานะใหม่ทันที")

  // 5. มีคนแทรกแถวในชีตตรง ๆ (แคชยังเป็นของเก่า) → assignTruck ต้องหาแถวจากชีตสด ไม่ใช่จากแคช
  sheet = [mkRow({ code: "D000", name: "แทรกใหม่", status: "รอฝึกงาน", customer: "ASIA MS", position: "Mixer L" }), ...sheet]
  await h.assignTruck({ row: 4, code: "D001", name: "สมชาย", trucknum: "ME200", plate: "70-9999", by: "tester" })
  assert.equal(sheet[1][C.name], "สมชาย")
  assert.equal(sheet[1][C.truckNum], "ME200", "ต้องเขียนลงแถวที่เลื่อนไปแล้ว (หาจากชีตสด)")
  assert.equal(sheet[0][C.truckNum], "", "ห้ามเขียนทับแถวที่แทรกเข้ามา")
  assert.equal(audits.at(-1)?.action, "assign_truck")
  const afterAssign = await h.fetchHandoverData()
  assert.equal(afterAssign.drivers.find((d) => d.code === "D001")?.truckNum, "ME200", "หลังยืนยันรถต้องเห็นทันที")
  assert.equal(afterAssign.trucks.find((t) => t.trucknum === "ME200")?.reservedBy, "สมชาย")

  // 6. ชีตกับ Cloud Run ล่มพร้อมกัน → error ของชีตมาก่อน (เหมือนเดิมที่อ่านชีตก่อน) และไม่เก็บผลล้มลงแคช
  await invalidateCache([CACHE_TAGS.handover])
  failSheet = true; failFleet = true
  await assert.rejects(h.fetchHandoverData(), /Sheets API 500/)
  failSheet = false
  await assert.rejects(h.fetchHandoverData(), /ATMS API 503/)
  failFleet = false
  const reads3 = count(isFullSheetRead)
  const recovered = await h.fetchHandoverData()
  assert.equal(recovered.drivers.length, 3)
  assert.equal(count(isFullSheetRead), reads3, "แถวชีตที่อ่านสำเร็จรอบก่อนถูกเก็บ (Cloud Run ล้มไม่เกี่ยวกับแคชชีต)")

  // 7. fetchTrucks (export เดิม) ยังใช้ได้
  const trucks = await h.fetchTrucks(recovered.drivers)
  assert.deepEqual(trucks.map((t) => t.trucknum), ["ME127", "ME200"])

  console.log("check-driver-handover: ok")
}

main().catch((e) => { console.error(e); process.exit(1) })
