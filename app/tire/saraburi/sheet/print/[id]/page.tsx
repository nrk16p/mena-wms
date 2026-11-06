import { RoundPrint } from "@/components/tire/sheet/round-print"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RoundPrint id={id} />
}
