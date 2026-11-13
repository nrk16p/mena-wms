import { Suspense } from "react"
import { TireFleetPage } from "@/components/tire/fleet-page"

export default function TirePage() {
  return (
    <Suspense>
      <TireFleetPage />
    </Suspense>
  )
}
