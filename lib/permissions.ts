import { ObjectId } from "mongodb"
import clientPromise from "@/lib/mongo"
import { SUPERADMIN_EMAIL, SECTION_KEYS, DEFAULT_ACCESS } from "@/lib/permission-constants"

const DB = process.env.MONGO_DB ?? "master_data"

export { SUPERADMIN_EMAIL, SECTION_KEYS, SECTION_LABELS, DEFAULT_ACCESS, type SectionKey } from "@/lib/permission-constants"

export type UserPermissions = {
  isSuperAdmin: boolean
  allowed: string[]
  groupName: string | null
}

export async function getUserPermissions(email: string | null | undefined): Promise<UserPermissions> {
  if (!email) return { isSuperAdmin: false, allowed: [], groupName: null }
  if (email === SUPERADMIN_EMAIL) return { isSuperAdmin: true, allowed: [...SECTION_KEYS], groupName: "Superadmin" }

  try {
    const client = await clientPromise
    const db     = client.db(DB)
    const user   = await db.collection("app_users").findOne({ email })
    if (!user?.group_id) return { isSuperAdmin: false, allowed: [...DEFAULT_ACCESS], groupName: null }
    const group = await db.collection("permission_groups").findOne({ _id: new ObjectId(String(user.group_id)) })
    if (!group) return { isSuperAdmin: false, allowed: [...DEFAULT_ACCESS], groupName: null }
    return { isSuperAdmin: false, allowed: group.access ?? [], groupName: group.name ?? null }
  } catch {
    // DB hiccup should not lock people out of what they had before permissions existed
    return { isSuperAdmin: false, allowed: [...DEFAULT_ACCESS], groupName: null }
  }
}

export async function upsertAppUser(u: { email: string; name?: string | null; image?: string | null }): Promise<void> {
  const client = await clientPromise
  await client.db(DB).collection("app_users").updateOne(
    { email: u.email },
    {
      $set: { name: u.name ?? "", image: u.image ?? "", last_seen: new Date() },
      $setOnInsert: { email: u.email, group_id: null, group_name: null, created_at: new Date() },
    },
    { upsert: true }
  )
}
