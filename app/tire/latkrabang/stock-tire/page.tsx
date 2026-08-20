import { Suspense } from "react"
import { TireStockSafetyPage } from "@/components/tire/stock-safety-page"
import { assertBranchAccess } from "@/lib/branch-guard"

export default async function TireLatkrabangStockPage() {
  await assertBranchAccess("latkrabang")
  return (
    <Suspense>
      <TireStockSafetyPage branch="latkrabang" branchLabel="ลาดกระบัง" />
    </Suspense>
  )
}
