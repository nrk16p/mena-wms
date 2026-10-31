"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api, type LinkStatus } from "./queue-types"

const inputCls =
  "w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"

export function AtmsLinkDialog({ onClose, onLinked }: { onClose: () => void; onLinked: (s: LinkStatus) => void }) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const s: LinkStatus = await api("/api/store-withdraw/atms-link", { method: "POST", body: { username: username.trim(), password } })
      setPassword("")
      onLinked(s)
    } catch (err) {
      setError(err instanceof Error ? err.message : "ผูกบัญชีไม่สำเร็จ ลองใหม่อีกครั้ง")
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>ผูกบัญชี ATMS ของคุณ</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3" autoComplete="off">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            ใส่ชื่อผู้ใช้และรหัสผ่าน ATMS ของคุณเอง เก็บแบบเข้ารหัส และใช้ตัดสต๊อกใน ATMS ภายใต้ชื่อคุณเท่านั้น
            อยากเลิกเมื่อไหร่ก็ได้ที่เมนูบนหน้าจอคิว &quot;เลิกผูกบัญชี ATMS&quot;
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">ชื่อผู้ใช้ ATMS</span>
            <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" name="atms-username" required />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">รหัสผ่าน ATMS</span>
            <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" name="atms-password" required />
          </label>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-[#E2E8E4] px-4 py-2.5 text-sm dark:border-white/10">ไว้ก่อน</button>
            <button type="submit" disabled={busy || !username.trim() || !password} className="inline-flex items-center gap-1.5 rounded-xl bg-[#1B8C4B] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#157a40] disabled:opacity-50">
              {busy && <Loader2 size={14} className="animate-spin" />}ผูกบัญชี
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
