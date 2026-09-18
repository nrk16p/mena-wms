import { RfqVendorLabour } from "@/components/rfq-vendor-labour"
export const metadata = { title: "ใบขอราคา — Mena Transport" }
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <RfqVendorLabour token={token} />   // ตัวเลื่อนหน้าอยู่ที่ layout
}
