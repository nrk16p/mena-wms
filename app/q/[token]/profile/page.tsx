import { RfqVendorProfile } from "@/components/rfq-vendor-profile"
export const metadata = { title: "ใบขอราคา — Mena Transport" }
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <RfqVendorProfile token={token} />   // ตัวเลื่อนหน้าอยู่ที่ layout
}
