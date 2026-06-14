import { Suspense } from "react"
import { TireStockPage } from "@/components/tire-stock-page"

export default function TireSaraburiStockPage() {
  return (
    <Suspense>
      <TireStockPage branch="saraburi" branchLabel="สระบุรี" />
    </Suspense>
  )
}
