import { DocsLinkPage } from "@/components/vendor-onboarding/docs-link-page"

export const metadata = { title: "แนบเอกสารเพิ่ม — Mena Transport" }

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <DocsLinkPage token={token} />
}
