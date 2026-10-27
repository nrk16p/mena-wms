"use client"
// บัญชีพอร์ทัลเจ้าหนี้ในหน้า /ap-tracking/suppliers — ช่องสถานะรายแถว + ปุ่มสร้างทุกเจ้า + กล่องโชว์รหัสครั้งเดียว
// API: /api/ap-suppliers/portal-accounts (สิทธิ์ส่วน ap: ดู = เห็นสถานะ · แก้ = สร้าง/รีเซ็ต/ปิด)
import { useState } from "react"
import * as XLSX from "xlsx"
import { Copy, Check, Download, KeyRound, X } from "lucide-react"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"
import { vpLineMessage, type VpAccountRow } from "@/lib/vendor-portal"
import { CARD } from "./ap-style"

export type VpIssued = { username: string; password: string; displayName: string }
type Action = "create" | "reset" | "disable" | "enable" | "bulk"

const BTN = "rounded-lg border border-gray-200/80 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"

const shortDate = (iso?: string) => {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Bangkok" })
}

export async function postVpAccount(action: Action, atmsCode?: string): Promise<{ issued?: VpIssued[] }> {
  const res = await fetch("/api/ap-suppliers/portal-accounts", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, atmsCode }),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")
  return d
}

/** ช่อง "บัญชีเจ้าหนี้" ของแถวหนึ่ง */
export function VpAccountCell({ row, onIssued, onChanged }: {
  row: VpAccountRow | undefined
  onIssued: (xs: VpIssued[]) => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  if (!row) return <span className="text-[11px] text-gray-400">—</span>
  const why = row.reason === "ชื่อผู้ใช้ซ้ำ" ? `ชื่อผู้ใช้ ${row.username} ซ้ำกับรหัส ${row.clashWith} ตรวจรหัสใน ATMS ก่อน` : row.reason
  // สร้างไม่ได้และยังไม่มีบัญชี = บอกเหตุผลอย่างเดียว · มีบัญชีค้างอยู่ ยังต้องปิดบัญชีได้
  if (!row.eligible && !row.account) return <span className="text-[11px] text-gray-400">{why}</span>

  const run = async (action: Action, confirmText?: string) => {
    if (confirmText) {
      const ok = await swalConfirm(confirmText, row.displayName)
      if (!ok.isConfirmed) return
    }
    setBusy(true)
    try {
      const d = await postVpAccount(action, row.atmsCode)
      if (d.issued?.length) onIssued(d.issued)
      else swalToast("success", action === "disable" ? `ปิดบัญชี ${row.username} แล้ว` : `เปิดบัญชี ${row.username} แล้ว`)
      onChanged()
    } catch (e) {
      swalError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ")
    } finally {
      setBusy(false)
    }
  }

  const a = row.account
  return (
    <div className="space-y-1">
      {row.username && <div className="font-mono text-[11px] text-gray-500">{row.username}</div>}
      {!row.eligible && <div className="text-[11px] text-amber-700 dark:text-amber-400">{why}</div>}
      {!a && <div className="text-[11px] text-gray-400">ยังไม่มีบัญชี</div>}
      {a?.legacyUsername && (
        <div className="text-[10px] text-amber-700 dark:text-amber-400">
          ชื่อผู้ใช้เดิม {a.legacyUsername} ใช้ไม่ได้แล้ว กดรีเซ็ตรหัสเพื่อเปลี่ยนเป็น {row.username}
        </div>
      )}
      {a && (
        <div className={`text-[11px] ${a.disabled ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
          {a.disabled ? "ปิดอยู่" : "มีบัญชีแล้ว"}
          <span className="text-gray-400"> · {a.lastLoginAt ? `เข้าล่าสุด ${shortDate(a.lastLoginAt)}` : "ยังไม่เคยเข้า"}</span>
        </div>
      )}
      {row.hiddenNames.length > 0 && (
        <div className="text-[10px] text-amber-700 dark:text-amber-400" title={row.hiddenNames.join(", ")}>
          ชื่อซ้ำกับเจ้าอื่นใน ATMS {row.hiddenNames.length} ชื่อ ใบของชื่อนั้นไม่ขึ้นในพอร์ทัล
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {!a && <button disabled={busy} onClick={() => run("create")} className={BTN}>สร้างบัญชี</button>}
        {a && row.eligible && <button disabled={busy} onClick={() => run("reset", "ออกรหัสผ่านใหม่?")} className={BTN}>รีเซ็ตรหัส</button>}
        {a && !a.disabled && <button disabled={busy} onClick={() => run("disable", "ปิดบัญชีนี้? เจ้าหนี้จะเข้าไม่ได้ทันที")} className={BTN}>ปิดบัญชี</button>}
        {a?.disabled && <button disabled={busy} onClick={() => run("enable")} className={BTN}>เปิดบัญชี</button>}
      </div>
    </div>
  )
}

/** กล่องโชว์รหัสผ่านที่เพิ่งออก — ปิดแล้วเปิดดูอีกไม่ได้ */
export function VpIssuedDialog({ issued, onClose }: { issued: VpIssued[]; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null)
  const origin = typeof window !== "undefined" ? window.location.origin : ""

  const copy = async (x: VpIssued) => {
    try {
      await navigator.clipboard.writeText(vpLineMessage(x, origin))
      setCopied(x.username)
      setTimeout(() => setCopied((c) => (c === x.username ? null : c)), 1800)
    } catch {
      swalError("คัดลอกไม่สำเร็จ ลองเลือกข้อความแล้วคัดลอกเอง")
    }
  }

  const download = () => {
    const ws = XLSX.utils.json_to_sheet(issued.map((x) => ({
      "รหัสคู่ค้า": x.username, "ชื่อ": x.displayName, "ชื่อผู้ใช้": x.username, "รหัสผ่าน": x.password, "ลิงก์": `${origin}/vendor-portal`,
    })))
    ws["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 40 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "บัญชีเจ้าหนี้")
    XLSX.writeFile(wb, `vendor-portal-accounts-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const close = async () => {
    const ok = await swalConfirm("ปิดกล่องนี้?", "ปิดแล้วจะดูรหัสผ่านนี้อีกไม่ได้ ต้องรีเซ็ตใหม่")
    if (ok.isConfirmed) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className={`${CARD} w-full max-w-2xl max-h-[85vh] flex flex-col`}>
        <div className="flex items-center gap-2 border-b px-4 py-3 dark:border-white/10">
          <KeyRound className="h-5 w-5 text-emerald-600" />
          <div className="font-semibold">รหัสผ่านเจ้าหนี้ {issued.length} ราย</div>
          <button onClick={close} className="ml-auto rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-white/10" aria-label="ปิด"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          รหัสโชว์ครั้งเดียว คัดลอกหรือดาวน์โหลดไว้ก่อนปิดกล่อง
        </div>
        <div className="overflow-y-auto px-4 pb-3">
          <table className="min-w-full text-sm">
            <thead className="text-xs text-gray-500"><tr>
              <th className="py-1 text-left">เจ้าหนี้</th><th className="py-1 text-left">ชื่อผู้ใช้</th><th className="py-1 text-left">รหัสผ่าน</th><th />
            </tr></thead>
            <tbody>
              {issued.map((x) => (
                <tr key={x.username} className="border-t dark:border-white/10">
                  <td className="py-1.5 pr-2">{x.displayName}</td>
                  <td className="py-1.5 pr-2 font-mono">{x.username}</td>
                  <td className="py-1.5 pr-2 font-mono">{x.password}</td>
                  <td className="py-1.5 text-right">
                    <button onClick={() => copy(x)} className={`${BTN} inline-flex items-center gap-1`}>
                      {copied === x.username ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied === x.username ? "คัดลอกแล้ว" : "คัดลอกข้อความส่งไลน์"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3 dark:border-white/10">
          <button onClick={download} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
            <Download className="h-4 w-4" />ดาวน์โหลด Excel
          </button>
          <button onClick={close} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700">เสร็จแล้ว</button>
        </div>
      </div>
    </div>
  )
}
