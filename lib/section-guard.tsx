import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getUserPermissions, type SectionKey } from "@/lib/permissions"

/** Server-side gate used by per-section layout.tsx files. */
export async function requireSection(section: SectionKey): Promise<void> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect("/login")
  const perms = await getUserPermissions(session.user.email)
  if (!perms.isSuperAdmin && !perms.allowed.includes(section)) redirect("/unauthorized")
}

export async function requireSuperAdmin(): Promise<void> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect("/login")
  const perms = await getUserPermissions(session.user.email)
  if (!perms.isSuperAdmin) redirect("/unauthorized")
}
