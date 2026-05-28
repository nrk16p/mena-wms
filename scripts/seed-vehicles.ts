/**
 * Seed vehicle_master collection from ยานพาหนะ-20260528000736.xls
 * Run: MONGO_URI=... npx tsx scripts/seed-vehicles.ts
 */

import { MongoClient } from "mongodb"
import { readFileSync } from "fs"
import { parse } from "node-html-parser"

const URI = process.env.MONGO_URI ?? ""
const DB  = process.env.MONGO_DB  ?? "master_data"
if (!URI) throw new Error("Set MONGO_URI env var")

const FILE = "/Users/menatransport_02/Documents/master_data/master_sku/ยานพาหนะ-20260528000736.xls"

function parseTable(html: string) {
  const root = parse(html)
  const rows = root.querySelectorAll("tr")
  if (rows.length === 0) return { headers: [], data: [] }

  const headers = rows[0].querySelectorAll("th,td").map((c) => c.text.trim())
  const data: Record<string, string>[] = []

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].querySelectorAll("td")
    const obj: Record<string, string> = {}
    headers.forEach((h, j) => { obj[h] = (cells[j]?.text ?? "").trim() })
    data.push(obj)
  }
  return { headers, data }
}

async function seed() {
  const html = readFileSync(FILE, "utf-8")
  const { data } = parseTable(html)

  const client = new MongoClient(URI)
  await client.connect()
  const col = client.db(DB).collection("vehicle_master")

  // Create index on plate for fast lookup
  await col.createIndex({ plate: 1 })
  await col.createIndex({ vehicleType: 1 })
  await col.createIndex({ brand: 1 })
  await col.createIndex({ branch: 1 })

  let upserted = 0
  let skipped  = 0

  for (const row of data) {
    const plate = row["ทะเบียน"]?.trim()
    if (!plate) { skipped++; continue }

    const doc = {
      plate,
      fleetNo:     row["เลขรถ"]                    || "",
      fleet:       row["ฟลีท"]                     || "",
      brand:       row["ยี่ห้อ"]                    || "",
      branch:      row["สาขา"]                     || "",
      vehicleType: row["ประเภทยานพาหนะ"]            || "",
      vehicleTypeExtra: row["ประเภทยานพาหนะเพิ่มเติม"] || "",
      model:       row["รุ่น"]                     || "",
      engineNo:    row["เลขเครื่องยนต์"]            || "",
      chassisNo:   row["เลขตัวถัง"]                 || "",
      fuelType:    row["ประเภทเชื้อเพลิง"]           || "",
      year:        row["ปี"]                        || "",
      ownership:   row["กรรมสิทธิ์"]                || "",
      project:     row["โปรเจค"]                   || "",
      plant:       row["แพล้นท์"]                  || "",
      hasPump:     row["มีปัมป์"] === "1",
      isTrailer:   row["เป็นหาง"] === "1",
      note:        row["หมายเหตุ"]                 || "",
      updatedAt:   new Date(),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await col.updateOne(
      { plate } as any,
      { $set: doc, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    )
    upserted++
  }

  console.log(`✅ Done: ${upserted} vehicles upserted, ${skipped} skipped (no plate)`)
  await client.close()
}

seed().catch(console.error)
