import { PriceCompareForm } from "@/components/price-compare-form"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PriceCompareForm id={id} />
}
