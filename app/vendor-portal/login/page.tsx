"use client"
// หน้าเข้าสู่ระบบของเจ้าหนี้ — ชื่อผู้ใช้ = รหัสผู้ขาย · รหัสผ่านได้จากฝ่ายจัดซื้อ
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"
import { VP_FONT } from "@/components/vendor-portal/ui"
import { COMPANY } from "@/lib/vendor-brand"

export default function VendorPortalLoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError("")
    if (!username.trim() || !password) { setError("กรอกชื่อผู้ใช้และรหัสผ่านให้ครบ"); return }
    setBusy(true)
    try {
      const res = await fetch("/api/vendor-portal/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d?.error ?? "เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง"); return }
      router.replace("/vendor-portal")
    } catch {
      setError("เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่")
    } finally {
      setBusy(false)
    }
  }

  const input = "h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-[#046132] focus:ring-2 focus:ring-[#046132]/20"

  return (
    <div className="h-full overflow-y-auto bg-slate-50 text-slate-900" style={VP_FONT}>
      <div className="h-40 bg-[#046132]" />

      <div className="px-4">
      <form onSubmit={submit} className="mx-auto -mt-28 w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-[0_4px_16px_rgba(15,23,42,0.08)]">
        <div className="pb-1 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mena-logo.svg" alt="Mena Transport" className="mx-auto h-16 w-auto" />
          <div className="mt-3 text-[11px] font-semibold tracking-[0.12em] text-[#046132]">SUPPLIER PORTAL</div>
          <h1 className="mt-0.5 text-lg font-semibold text-slate-900">ติดตามการจ่ายเงินคู่ค้า</h1>
        </div>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">ชื่อผู้ใช้</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} className={input}
            autoComplete="username" autoCapitalize="characters" spellCheck={false} placeholder="รหัสผู้ขาย" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">รหัสผ่าน</span>
          <div className="relative">
            <input value={password} onChange={(e) => setPassword(e.target.value)} className={`${input} pr-12`}
              type={show ? "text" : "password"} autoComplete="current-password" spellCheck={false} />
            <button type="button" onClick={() => setShow((v) => !v)}
              className="absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
              aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}>
              {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        </label>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <button type="submit" disabled={busy}
          className="h-12 w-full rounded-xl bg-[#046132] text-base font-semibold text-white transition hover:bg-[#023A1E] disabled:opacity-60">
          {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
        </button>
      </form>
      </div>

      <p className="mx-auto mt-5 max-w-sm px-6 text-center text-sm leading-relaxed text-slate-500">
        ลืมรหัสผ่านหรือยังไม่มีบัญชี<br />ติดต่อฝ่ายจัดซื้อที่ดูแลร้านของคุณ
      </p>
      <p className="mx-auto mt-8 max-w-sm px-6 pb-10 text-center text-xs text-slate-400">{COMPANY.nameTh}</p>
    </div>
  )
}
