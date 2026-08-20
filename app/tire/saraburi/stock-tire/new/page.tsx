import { TireStockAddPage } from "@/components/tire/stock-add-page"
import { assertBranchAccess } from "@/lib/branch-guard"

export default async function TireSaraburiNewPage() {
  await assertBranchAccess("saraburi")
  return <TireStockAddPage branch="saraburi" branchLabel="สระบุรี" />
}
