import { TireStockAddPage } from "@/components/tire/stock-add-page"
import { assertBranchAccess } from "@/lib/branch-guard"

export default async function TireLatkrabangNewPage() {
  await assertBranchAccess("latkrabang")
  return <TireStockAddPage branch="latkrabang" branchLabel="ลาดกระบัง" />
}
