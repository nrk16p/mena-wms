import { OnboardingPrint } from "@/components/vendor-onboarding/print-sheet"

export const metadata = { title: "ใบคัดเลือกผู้ส่งมอบ" }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <OnboardingPrint id={id} />
}
