"use client"

// หน้า Hub ของสโตร์: คงเหลือ · รับเข้า · รายการอะไหล่ · Sub · ความเคลื่อนไหว
import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Eye } from "lucide-react"
import { OptionCombobox } from "../option-combobox"
import { HubStockTab } from "./hub-stock-tab"
import { HubReceiveTab } from "./hub-receive-tab"
import { HubItemsTab } from "./hub-items-tab"
import { HubVendorsTab } from "./hub-vendors-tab"
import { HubMovesTab } from "./hub-moves-tab"
import type { InvOpt } from "./hub-shared"

const TABS = [["stock", "คงเหลือ"], ["receive", "รับเข้า"], ["items", "รายการอะไหล่"], ["vendors", "Sub"], ["moves", "ความเคลื่อนไหว"]] as const
type Tab = (typeof TABS)[number][0]
const LATKRABANG = 4

export function HubPage() {
  const { data: session } = useSession()
  const canEdit = session?.user?.access?.["store-hub"] === "edit"
  const [tab, setTab] = useState<Tab>("stock")
  const [invs, setInvs] = useState<InvOpt[]>([])
  const [inventoryId, setInventoryId] = useState<number | "">("")
  const [optErr, setOptErr] = useState("")
  const [stockVer, setStockVer] = useState(0)   // รับเข้าแล้ว → +1 ให้แท็บคงเหลือโหลดใหม่

  useEffect(() => {
    const ctl = new AbortController()
    fetch("/api/store-withdraw/options", { signal: ctl.signal })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "โหลดรายการคลังไม่สำเร็จ"); return j })
      .then((j: { inventories: InvOpt[] }) => {
        setInvs(j.inventories)
        setInventoryId(j.inventories.find((o) => o.id === LATKRABANG)?.id ?? j.inventories[0]?.id ?? "")
      })
      .catch((e) => { if (!ctl.signal.aborted) setOptErr(e instanceof Error ? e.message : "โหลดรายการคลังไม่สำเร็จ") })
    return () => ctl.abort()
  }, [])

  const inv = typeof inventoryId === "number" ? inventoryId : null

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>อะไหล่ Hub</h1>
          <p className="text-xs text-gray-500">ของที่ Sub ฝากไว้ในคลัง รับเข้า ดูยอด และดูว่าใครเบิกไป</p>
        </div>
        <div className="w-56">
          <OptionCombobox id="hub-inv" options={invs} value={inventoryId} onChange={setInventoryId} placeholder="เลือกคลัง" searchPlaceholder="พิมพ์ชื่อคลัง" />
        </div>
      </div>

      {optErr && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{optErr}</p>}
      {!canEdit && session && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"><Eye size={14} />คุณดูได้อย่างเดียว รับเข้าหรือแก้ข้อมูลไม่ได้</p>
      )}

      <div role="tablist" className="flex flex-wrap gap-1 border-b border-[#E2E8E4] dark:border-white/10">
        {TABS.filter(([k]) => canEdit || k !== "receive").map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === k ? "border-[#1B8C4B] font-semibold text-[#1B8C4B]" : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>{label}</button>
        ))}
      </div>

      {tab === "stock" && <HubStockTab key={`${inv}-${stockVer}`} inventoryId={inv} />}
      {tab === "receive" && canEdit && <HubReceiveTab inventoryId={inv} onDone={() => setStockVer((v) => v + 1)} />}
      {tab === "items" && <HubItemsTab key={`${inv}-${stockVer}`} inventoryId={inv} canEdit={canEdit} />}
      {tab === "vendors" && <HubVendorsTab invs={invs} canEdit={canEdit} />}
      {tab === "moves" && <HubMovesTab />}
    </div>
  )
}
