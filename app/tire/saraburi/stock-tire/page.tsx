import { Suspense } from "react"
import { TireStockPage } from "@/components/tire-stock-page"
import { assertBranchAccess } from "@/lib/branch-guard"

export default async function TireSaraburiStockPage() {
  await assertBranchAccess("saraburi")
  return (
    <Suspense>
      <TireStockPage branch="saraburi" branchLabel="สระบุรี" />
    </Suspense>
  )
}
