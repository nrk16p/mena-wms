// lib/store-withdraw/storage.ts — ที่เก็บไฟล์แนบหลักฐาน (DO Spaces ผ่าน lib/spaces.ts) · เทสต์สลับเป็นของปลอมด้วย setAttachStorage
import { assertDevLocalSafe, devLocalStorage, devLocalStorageEnabled } from "./storage-local"
export interface AttachStorage {
  presignPut(key: string, contentType: string): Promise<string>
  headObject(key: string): Promise<{ size: number; contentType: string | null } | null>
  presignGet(key: string, filename: string): Promise<string>
}

const real: AttachStorage = {
  async presignPut(key, contentType) {
    return (await import("../spaces")).presignPrivatePut(key, contentType)
  },
  async headObject(key) {
    return (await import("../spaces")).headPrivate(key)
  },
  async presignGet(key, filename) {
    return (await import("../spaces")).presignPrivateGet(key, filename)
  },
}

let injected: AttachStorage | null = null

/** ใช้ในเทสต์เท่านั้น */
export function setAttachStorage(s: AttachStorage | null) {
  injected = s
}

/** เดโมในเครื่อง: ใช้ที่เก็บไฟล์บนดิสก์แทน Spaces (ดู storage-local.ts · เปิดไม่ได้ใน production) */
export function attachStorage(): AttachStorage {
  if (injected) return injected
  assertDevLocalSafe()
  return devLocalStorageEnabled() ? devLocalStorage : real
}
