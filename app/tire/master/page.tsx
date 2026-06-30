import { Suspense } from "react"
import { TireSpecMasterPage } from "@/components/tire-spec-master-page"

export default function TireMasterPage() {
  return (
    <Suspense>
      <TireSpecMasterPage />
    </Suspense>
  )
}
