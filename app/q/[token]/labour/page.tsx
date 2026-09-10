import { RfqVendorLabour } from "@/components/rfq-vendor-labour"
export const metadata = { title: "ใบขอราคา — Mena Transport" }
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <div style={{ width: "100%", height: "100%", overflowY: "auto" }}><RfqVendorLabour token={token} /></div>
}
