import { Suspense } from "react"
import { TireStockPage } from "@/components/tire/stock-page"
import { assertBranchAccess } from "@/lib/branch-guard"

// สต็อกยางรายเส้น (serial) — เดิมอยู่ที่ /stock-tire ย้ายมาที่นี่ตอนที่หน้าหลักเปลี่ยนไปใช้ข้อมูลชุดเดียวกับ Safety Stock
export default async function TireSaraburiStockSerialPage() {
  await assertBranchAccess("saraburi")
  return (
    <Suspense>
      <TireStockPage branch="saraburi" branchLabel="สระบุรี" />
    </Suspense>
  )
}
