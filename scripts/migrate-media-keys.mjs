// ย้าย media objects ที่ key มีอักขระพัง (# ช่องว่าง ฯลฯ) → key แบบ sanitized
// แล้วอัพเดต refs ใน DB ให้เป็น canonical (ตรงกับ normalizeImages ของแอป)
import { readFileSync } from "fs"
import { MongoClient } from "mongodb"
import { S3Client, CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3"

const ROOT = "/Users/menatransport_02/Documents/project/master-sku-web"
const env = Object.fromEntries(
  readFileSync(ROOT + "/.env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")] })
)
const uri = readFileSync(ROOT + "/scripts/check-sku-vehicles.mjs", "utf8").match(/mongodb(?:\+srv)?:\/\/[^"'`]+/)[0]

const BUCKET = env.DO_SPACES_BUCKET
const CDN = "https://mn-bucket.sgp1.digitaloceanspaces.com"
const s3 = new S3Client({
  region: env.DO_SPACES_REGION || "sgp1",
  endpoint: env.DO_SPACES_ENDPOINT,
  credentials: { accessKeyId: env.DO_SPACES_KEY, secretAccessKey: env.DO_SPACES_SECRET },
  forcePathStyle: false,
})

const stripExt = (f) => f.replace(/\.[^./\\]+$/, "")
function sanitize(name) {
  const base = (name.split(/[/\\]/).pop() || "file").trim()
  const m = base.match(/^(.*?)(\.[A-Za-z0-9]+)?$/)
  let stem = (m?.[1] ?? base).replace(/[#?%&+=<>:;"'`|{}[\]^~\\]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
  if (!stem) stem = "file"
  if (stem.length > 80) stem = stem.slice(0, 80)
  return stem + (m?.[2] ?? "").toLowerCase()
}
const hostile = (name) => /[#?%&+=<>:;"'`|{}[\]^~\\ ]/.test(name)

// key จาก URL ที่เก็บไว้ (ตัด CDN base + decode ถ้าเคย encode ไปแล้ว)
function keyFromUrl(u) {
  let k = u.replace(CDN + "/", "")
  if (/%[0-9A-Fa-f]{2}/.test(k)) k = decodeURIComponent(k)
  return k
}

async function exists(key) {
  try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true } catch { return false }
}
async function copy(fromKey, toKey) {
  if (await exists(toKey)) return "already"
  if (!(await exists(fromKey))) return "missing-src"
  await s3.send(new CopyObjectCommand({
    Bucket: BUCKET,
    Key: toKey,
    CopySource: encodeURIComponent(BUCKET + "/" + fromKey).replace(/%2F/g, "/"),
    ACL: "public-read",
  }))
  return "copied"
}

const c = await MongoClient.connect(uri)
const db = c.db("master_data")
const targets = [
  { coll: "order_tracking", fields: ["images"] },
  { coll: "repair_external", fields: ["images", "negotiationImages"] },
  { coll: "master_sku", fields: ["images"] },
]
let migrated = 0, errors = 0
for (const t of targets) {
  const col = db.collection(t.coll)
  for (const f of t.fields) {
    const docs = await col.find({ [f]: { $elemMatch: { filename: { $regex: "[#?%&+ ]" } } } }).toArray()
    for (const d of docs) {
      const arr = d[f] || []
      let changed = false
      const out = []
      for (const img of arr) {
        if (!img?.filename || !hostile(img.filename)) { out.push(img); continue }
        const safe = sanitize(img.filename)
        const safeStem = stripExt(safe)
        const base = `media/${img.batchId}/${img.mediaId}`
        const newWebpKey = `${base}/webp/${safeStem}.webp`
        const newThumbKey = `${base}/thumbnail/${safeStem}-thumbnail.webp`
        try {
          const r1 = await copy(keyFromUrl(img.webpUrl), newWebpKey)
          const r2 = await copy(keyFromUrl(img.thumbnailUrl), newThumbKey)
          if (r1 === "missing-src" || r2 === "missing-src") { console.log("SKIP missing src:", t.coll, img.mediaId); out.push(img); errors++; continue }
          out.push({
            ...img,
            filename: safe,
            webpUrl: `${CDN}/${base}/webp/${encodeURIComponent(safeStem)}.webp`,
            thumbnailUrl: `${CDN}/${base}/thumbnail/${encodeURIComponent(safeStem)}-thumbnail.webp`,
          })
          changed = true; migrated++
        } catch (e) {
          console.log("ERR", t.coll, img.mediaId, e.message); out.push(img); errors++
        }
      }
      if (changed) await col.updateOne({ _id: d._id }, { $set: { [f]: out } })
    }
  }
  console.log(t.coll, "done")
}
console.log("migrated images:", migrated, "| errors:", errors)
await c.close()
