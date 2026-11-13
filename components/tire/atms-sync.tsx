"use client"

// ── ดึงข้อมูลเปลี่ยนยางล่าสุดจาก ATMS ──────────────────────────────────────────
// ดึงทีละสาขา แล้วคำนวณระยะใหม่ครั้งเดียวตอนสาขาสุดท้าย (rebuild ล้างแคช tag tire ให้เอง)
// ไม่งั้นเปลี่ยนยางเสร็จแล้วหน้ายางยังค้างยางชุดเดิมจนถึง cron รอบถัดไป

import { useState } from "react"
import { CloudDownload, Loader2 } from "lucide-react"
import { askAtmsAuth } from "@/lib/atms-auth-dialog"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"
import { branchLabel, fmtNum, fontThai } from "@/components/tire/shared"

export type AtmsSyncStep = { branch: string; index: number; total: number }

export function useAtmsSync(branches: string[], onDone: () => void) {
  const [step, setStep] = useState<AtmsSyncStep | null>(null)

  async function sync() {
    if (branches.length === 0 || step) return
    const { isConfirmed } = await swalConfirm(
      "อัปเดตข้อมูลจาก ATMS?",
      `ดึงประวัติเปลี่ยนยาง${branches.map(branchLabel).join(" + ")} แล้วคำนวณระยะใหม่ทั้งฟลีต ใช้เวลาราว 1–2 นาที`,
    )
    if (!isConfirmed) return
    let phpsessid: string | undefined
    let count = 0
    try {
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i]
        setStep({ branch: b, index: i, total: branches.length })
        const post = () => fetch("/api/tire-change/sync", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ branch: b, rebuild: i === branches.length - 1, ...(phpsessid ? { phpsessid } : {}) }),
        })
        let res = await post()
        // ยังไม่ผูก/รหัสเปลี่ยน → กรอกบัญชี ATMS ครั้งเดียว (หรือวาง PHPSESSID แทน) แล้วลองใหม่ จนสำเร็จหรือกดยกเลิก
        while (res.status === 401) {
          const next = await askAtmsAuth(await res.json().catch(() => ({})))
          if (!next) return
          phpsessid = next.phpsessid
          res = await post()
        }
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(`${branchLabel(b)}: ${d.error ?? "ดึงข้อมูลไม่สำเร็จ"}`)
        count += d.count ?? 0
      }
      swalToast("success", `อัปเดตจาก ATMS สำเร็จ ${fmtNum(count)} รายการ · คำนวณระยะใหม่แล้ว`)
      onDone()
    } catch (e) {
      swalError((e as Error).message)
    } finally {
      setStep(null)
    }
  }

  return { sync, step }
}

/** ปุ่มหลักของแถบความสดของข้อมูล — ทึบสีหลัก ให้เด่นกว่าปุ่มรอง (รีเฟรช / ส่งออก) */
export function AtmsSyncButton({ onClick, step, stale, disabled }: {
  onClick:   () => void
  step:      AtmsSyncStep | null
  stale?:    boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !!step}
      title={stale ? "ข้อมูล ATMS เก่ากว่า 1 วัน — กดเพื่ออัปเดต" : "ดึงประวัติเปลี่ยนยางล่าสุดจาก ATMS แล้วคำนวณระยะใหม่"}
      className={
        "relative inline-flex h-8 items-center gap-1.5 rounded-[10px] bg-[#17793F] px-3.5 text-[12.5px] font-semibold text-white " +
        "shadow-sm transition-colors hover:bg-[#146A37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B8C4B]/40 " +
        "focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70"
      }
      style={fontThai}
    >
      {step ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />}
      {step ? `กำลังอัปเดต ${step.index + 1}/${step.total}` : "อัปเดตจาก ATMS"}
      {stale && !step && (
        <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-[#151a10]" />
        </span>
      )}
    </button>
  )
}

/** แถบความคืบหน้าใต้แถบความสด — บอกว่ากำลังทำขั้นไหน อย่าเพิ่งปิดหน้า */
export function AtmsSyncProgress({ step }: { step: AtmsSyncStep | null }) {
  if (!step) return null
  const last = step.index === step.total - 1
  const pct  = Math.round(((step.index + 0.5) / step.total) * 100)
  return (
    <div
      role="status"
      className="-mt-2 mb-4 rounded-[12px] border border-[#1B8C4B]/25 bg-[#F0FDF4] px-4 py-2.5 dark:border-green-500/20 dark:bg-green-950/30"
      style={fontThai}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <Loader2 size={14} className="animate-spin text-[#17793F] dark:text-green-400" />
        <span className="font-semibold text-[#14271C] dark:text-white">
          ขั้นที่ {step.index + 1}/{step.total} · ดึงประวัติเปลี่ยนยาง{branchLabel(step.branch)}
          {last ? " แล้วคำนวณระยะใหม่ทั้งฟลีต" : ""}
        </span>
        <span className="text-[#6B7C72] dark:text-gray-400">ใช้เวลาราว 1–2 นาที · อย่าเพิ่งปิดหน้านี้</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#1B8C4B]/15">
        <div className="h-full rounded-full bg-[#17793F] transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
