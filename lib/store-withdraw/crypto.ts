// lib/store-withdraw/crypto.ts — เข้ารหัสรหัสผ่าน ATMS ของคลัง (AES-256-GCM, ใช้ฝั่งเซิร์ฟเวอร์เท่านั้น)
// รูปแบบ token: v1:<iv b64>:<tag b64>:<ciphertext b64>
// กุญแจ = STORE_ATMS_CRED_KEY (base64 32 ไบต์) ถ้าตั้งไว้ · ไม่ตั้ง = สร้างจาก NEXTAUTH_SECRET เดิมด้วย HKDF-SHA256
//   (ถ้าเปลี่ยน NEXTAUTH_SECRET ภายหลัง สโตร์ต้องผูกบัญชี ATMS ใหม่ — เหมือนตอนเปลี่ยน STORE_ATMS_CRED_KEY)
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"

function getKey(): Buffer {
  const raw = process.env.STORE_ATMS_CRED_KEY
  if (!raw) {
    const base = process.env.NEXTAUTH_SECRET
    if (!base) throw new Error("ยังไม่ได้ตั้ง STORE_ATMS_CRED_KEY หรือ NEXTAUTH_SECRET")
    return Buffer.from(hkdfSync("sha256", base, "mena-wms/store-withdraw", "atms-cred-v1", 32))
  }
  const key = Buffer.from(raw, "base64")
  if (key.length !== 32) throw new Error("STORE_ATMS_CRED_KEY ต้องเป็น base64 ของ 32 ไบต์")
  return key
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", getKey(), iv)
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()])
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":")
}

export function decryptSecret(token: string): string {
  const [v, iv, tag, ct] = token.split(":")
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("รูปแบบข้อมูลที่เข้ารหัสไม่ถูกต้อง")
  const tagBuf = Buffer.from(tag, "base64")
  if (tagBuf.length !== 16) throw new Error("รูปแบบข้อมูลที่เข้ารหัสไม่ถูกต้อง")
  const d = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"), { authTagLength: 16 })
  d.setAuthTag(tagBuf)
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8")
}
