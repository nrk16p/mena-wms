import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import crypto from "crypto"

let client: S3Client | null = null

function s3(): S3Client {
  if (client) return client
  const endpoint = process.env.DO_SPACES_ENDPOINT
  const key      = process.env.DO_SPACES_KEY
  const secret   = process.env.DO_SPACES_SECRET
  if (!endpoint || !key || !secret) throw new Error("Missing DO_SPACES_ENDPOINT / DO_SPACES_KEY / DO_SPACES_SECRET")
  client = new S3Client({
    region: process.env.DO_SPACES_REGION || "sgp1",
    endpoint,
    credentials: { accessKeyId: key, secretAccessKey: secret },
  })
  return client
}

// Upload a base64 data URL image to DigitalOcean Spaces, returns the public URL
export async function uploadImage(dataUrl: string, folder: string): Promise<string> {
  const m = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/)
  if (!m) throw new Error("Invalid image data URL")
  const contentType = m[1]
  const buffer = Buffer.from(m[2], "base64")

  const bucket = process.env.DO_SPACES_BUCKET
  if (!bucket) throw new Error("Missing DO_SPACES_BUCKET")
  const region = process.env.DO_SPACES_REGION || "sgp1"
  const prefix = (process.env.DO_SPACES_PREFIX || "").replace(/^\/+|\/+$/g, "")

  const ext = contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : ".jpg"
  const name = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext}`
  const key = [prefix, folder, name].filter(Boolean).join("/")

  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: "public-read",
    })
  )

  return `https://${bucket}.${region}.digitaloceanspaces.com/${key}`
}
