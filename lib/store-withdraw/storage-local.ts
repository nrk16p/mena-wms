// lib/store-withdraw/storage-local.ts — ที่เก็บไฟล์แนบในเครื่อง (เดโม/dev เท่านั้น) · เปิดได้เมื่อ NODE_ENV != production และตั้ง CORE_RETURN_DEV_LOCAL_STORAGE=1 ทั้งคู่
// ไฟล์อยู่ใต้โฟลเดอร์ชั่วคราว ตั้งชื่อด้วย sha256 ของ key (ไม่เอา key ไปเป็น path) · ส่ง/อ่านผ่าน /api/dev-storage (route นั้นเช็กเงื่อนไขเดียวกัน)
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { AttachStorage } from "./storage"

export const DEV_LOCAL_FLAG = "CORE_RETURN_DEV_LOCAL_STORAGE"

/** เปิดใช้ได้เฉพาะนอก production และมีแฟลกชัดเจน */
export function devLocalStorageEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" && env[DEV_LOCAL_FLAG] === "1"
}

/** แฟลกถูกตั้งแต่เป็น production = ตั้งค่าผิด → ล้มดัง ๆ ไม่แอบใช้ */
export function assertDevLocalSafe(env: Record<string, string | undefined> = process.env): void {
  if (env[DEV_LOCAL_FLAG] === "1" && env.NODE_ENV === "production") {
    throw new Error(`${DEV_LOCAL_FLAG} ใช้ใน production ไม่ได้`)
  }
}

export const devLocalDir = () => process.env.CORE_RETURN_DEV_STORAGE_DIR || path.join(os.tmpdir(), "core-return-dev-storage")
const slot = (key: string) => path.join(devLocalDir(), createHash("sha256").update(key).digest("hex"))

export function devPutFile(key: string, contentType: string, body: Buffer): void {
  if (!devLocalStorageEnabled()) throw new Error("dev local storage ปิดอยู่")
  fs.mkdirSync(devLocalDir(), { recursive: true })
  fs.writeFileSync(slot(key), body)
  fs.writeFileSync(slot(key) + ".json", JSON.stringify({ key, contentType }))
}

export function devReadFile(key: string): { body: Buffer; contentType: string } | null {
  if (!devLocalStorageEnabled()) throw new Error("dev local storage ปิดอยู่")
  try {
    const meta = JSON.parse(fs.readFileSync(slot(key) + ".json", "utf8")) as { contentType: string }
    return { body: fs.readFileSync(slot(key)), contentType: meta.contentType }
  } catch { return null }
}

const q = (key: string) => `/api/dev-storage?key=${encodeURIComponent(key)}`

export const devLocalStorage: AttachStorage = {
  async presignPut(key) {
    return q(key)
  },
  async headObject(key) {
    try {
      const meta = JSON.parse(fs.readFileSync(slot(key) + ".json", "utf8")) as { contentType: string }
      return { size: fs.statSync(slot(key)).size, contentType: meta.contentType }
    } catch { return null }
  },
  async presignGet(key) {
    return q(key)
  },
}
