import { Suspense } from "react"
import { TireStockSafetyPage } from "@/components/tire/stock-safety-page"
import { assertBranchAccess } from "@/lib/branch-guard"

export default async function TireSaraburiStockPage() {
  await assertBranchAccess("saraburi")
  return (
    <Suspense>
      <TireStockSafetyPage branch="saraburi" branchLabel="สระบุรี" />
    </Suspense>
  )
}
