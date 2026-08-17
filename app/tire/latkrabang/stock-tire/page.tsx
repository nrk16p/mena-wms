import { Suspense } from "react"
import { TireStockPage } from "@/components/tire-stock-page"
import { assertBranchAccess } from "@/lib/branch-guard"

export default async function TireLatkrabangStockPage() {
  await assertBranchAccess("latkrabang")
  return (
    <Suspense>
      <TireStockPage branch="latkrabang" branchLabel="ลาดกระบัง" />
    </Suspense>
  )
}
