import { requireSuperAdmin } from "@/lib/section-guard"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireSuperAdmin()
  return <>{children}</>
}
