import { requireSection } from "@/lib/section-guard"

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireSection("tire")
  return <>{children}</>
}
