// lib/store-withdraw/creds.ts — บัญชี ATMS ของพนักงานคลัง (รหัสผ่านเข้ารหัสเสมอ ไม่คืน/ไม่ log ออกไปที่ไหน)
import { credCol } from "./db"
import { decryptSecret, encryptSecret } from "./crypto"

export type AtmsProfile = {
  username?: string
  email?: string
  name?: string
  branch?: string | null
  department?: string | null
  is_driver?: boolean
  is_mechanic?: boolean
}

const key = (email: string) => email.trim().toLowerCase()

export async function saveCreds(email: string, username: string, password: string, profile: AtmsProfile | null) {
  const col = await credCol()
  await col.updateOne(
    { email: key(email) },
    {
      $set: {
        atmsUsername: username,
        passwordEnc: encryptSecret(password),
        branch: profile?.branch ?? null,
        profile: profile ? { ...profile } : null,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  )
}

/** ถอดรหัสฝั่งเซิร์ฟเวอร์เท่านั้น — ใช้ส่งต่อให้ api-ncac แล้วทิ้ง */
export async function getCreds(email: string): Promise<{ username: string; password: string } | null> {
  const d = await (await credCol()).findOne({ email: key(email) })
  if (!d) return null
  return { username: d.atmsUsername, password: decryptSecret(d.passwordEnc) }
}

export async function deleteCreds(email: string) {
  await (await credCol()).deleteOne({ email: key(email) })
}

export async function credStatus(email: string): Promise<{ linked: boolean; atmsUsername?: string; branch?: string }> {
  const d = await (await credCol()).findOne({ email: key(email) }, { projection: { atmsUsername: 1, branch: 1 } })
  if (!d) return { linked: false }
  return { linked: true, atmsUsername: d.atmsUsername, ...(d.branch ? { branch: d.branch } : {}) }
}
