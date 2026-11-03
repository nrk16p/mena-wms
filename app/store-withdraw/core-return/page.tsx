import { CoreReturnPage } from "@/components/core-return/core-return-page"

export const metadata = { title: "ติดตามซากอะไหล่" }

type SP = Record<string, string | string[] | undefined>

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined
  const v = one("view")
  const l = Number(one("lane"))
  return (
    <CoreReturnPage initial={{
      mine: one("mine") === "1",
      view: v === "table" || v === "closed" || v === "lanes" ? v : undefined,
      lane: one("lane") != null && (l === 0 || l === 1 || l === 2) ? (l as 0 | 1 | 2) : undefined,
    }} />
  )
}
