import { Suspense } from "react"
import { TireStockPage } from "@/components/tire-stock-page"

export default function TireLatkrabangStockPage() {
  return (
    <Suspense>
      <TireStockPage branch="latkrabang" branchLabel="ลาดกระบัง" />
    </Suspense>
  )
}
