// ── Media (presign-api) integration ───────────────────────────────────────
// Flow (see image.md):
//   1. POST /media/presign           → { media_id, batch_id, upload_url }
//   2. PUT  upload_url  (browser → S3 directly)
//   3. POST /media/{id}/complete     → worker generates webp + thumbnail
//   4. DELETE /media/{id}            → soft delete (purged after 7 days)

// External presign-api base — used server-side by the proxy routes only.
export const MEDIA_API_URL =
  process.env.MEDIA_API_URL || "https://presign-api-548129382487.asia-southeast1.run.app"

// Public CDN base for the generated webp / thumbnail. Safe to expose to the client.
export const MEDIA_CDN_BASE =
  process.env.NEXT_PUBLIC_MEDIA_CDN_BASE || "https://mn-bucket.sgp1.digitaloceanspaces.com"

// A media reference persisted on the SKU document.
export type SkuImage = {
  mediaId:      number
  batchId:      string
  filename:     string
  webpUrl:      string
  thumbnailUrl: string
}

// "photo.jpg" → "photo"
function stripExt(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, "")
}

// ทำชื่อไฟล์ให้ปลอดภัยสำหรับ S3 key/URL — ตัดอักขระที่ทำ URL พัง
// (# ตัด URL เป็น fragment, ? เป็น query, % & ฯลฯ) · คงภาษาไทยไว้ให้อ่านออก
export function sanitizeMediaFilename(name: string): string {
  const base = (name.split(/[/\\]/).pop() || "file").trim()
  const m    = base.match(/^(.*?)(\.[A-Za-z0-9]+)?$/)
  let stem = (m?.[1] ?? base)
    .replace(/[#?%&+=<>:;"'`|{}[\]^~\\]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  if (!stem) stem = "file"
  if (stem.length > 80) stem = stem.slice(0, 80)
  return stem + (m?.[2] ?? "").toLowerCase()
}

// https://…/media/{batch}/{id}/webp/{name}.webp
// encodeURIComponent กันอักขระพิเศษในชื่อเก่า (เช่น #) ตัด URL ขาด
export function webpUrl(batchId: string, mediaId: number | string, filename: string): string {
  return `${MEDIA_CDN_BASE}/media/${batchId}/${mediaId}/webp/${encodeURIComponent(stripExt(filename))}.webp`
}

// https://…/media/{batch}/{id}/thumbnail/{name}-thumbnail.webp
export function thumbnailUrl(batchId: string, mediaId: number | string, filename: string): string {
  return `${MEDIA_CDN_BASE}/media/${batchId}/${mediaId}/thumbnail/${encodeURIComponent(stripExt(filename))}-thumbnail.webp`
}

// max upload size enforced by the presign-api (25MB default)
export const MEDIA_MAX_BYTES = 25 * 1024 * 1024
