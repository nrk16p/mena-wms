import { RfqVendorParts } from "@/components/rfq-vendor-parts"
export const metadata = { title: "ใบขอราคา — Mena Transport" }
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <RfqVendorParts token={token} />   // ตัวเลื่อนหน้าอยู่ที่ layout
}
