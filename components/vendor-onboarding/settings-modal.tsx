"use client"
// ตั้งค่า onboarding — เกณฑ์คะแนนขั้นต่ำ, อีเมลผู้รีวิว/ผู้อนุมัติ, อายุลิงก์ขอเอกสาร
// ปุ่มโชว์ให้ approver/admin · สิทธิ์จริงตรวจที่ API (403 = แจ้งในกล่อง)
import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { ApiError, errMsg, getSettings, putSettings, type OnboardingSettings } from "@/lib/vendor-onboarding/client"
import { ModalShell, btn, inputCls } from "./admin-ui"

const toList = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
const emailOk = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

export function SettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<{ passThreshold: string; reviewerEmails: string; approverEmails: string; linkDays: string } | null>(null)
  const [error, setError] = useState("")
  const [forbidden, setForbidden] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    getSettings()
      .then((s) => { if (!alive) return; if (s.canEdit === false) setForbidden(true); setForm({ passThreshold: String(s.passThreshold), reviewerEmails: s.reviewerEmails.join("\n"), approverEmails: s.approverEmails.join("\n"), linkDays: String(s.linkDays) }) })
      .catch((e) => { if (!alive) return; if (e instanceof ApiError && e.status === 403) setForbidden(true); setError(errMsg(e)) })
    return () => { alive = false }
  }, [])

  const problems: string[] = []
  if (form) {
    const t = Number(form.passThreshold)
    if (!Number.isInteger(t) || t < 1 || t > 50) problems.push("เกณฑ์ขั้นต่ำต้องเป็นเลข 1–50")
    const d = Number(form.linkDays)
    if (!Number.isInteger(d) || d < 1 || d > 90) problems.push("อายุลิงก์ต้องเป็นเลข 1–90 วัน")
    const bad = [...toList(form.reviewerEmails), ...toList(form.approverEmails)].filter((x) => !emailOk(x))
    if (bad.length) problems.push(`อีเมลไม่ถูก: ${bad.join(", ")}`)
  }

  async function save() {
    if (!form || problems.length) return
    setSaving(true); setError("")
    try {
      const body: OnboardingSettings = {
        passThreshold: Number(form.passThreshold),
        reviewerEmails: toList(form.reviewerEmails),
        approverEmails: toList(form.approverEmails),
        linkDays: Number(form.linkDays),
      }
      await putSettings(body)
      onSaved()
      onClose()
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true)
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const label = "mb-1 block text-[13px] font-semibold text-[#14271C] dark:text-white"
  const help = "mt-1 text-[12px] text-gray-500 dark:text-gray-400"

  return (
    <ModalShell title="ตั้งค่าการคัดเลือกผู้ส่งมอบ" onClose={onClose} width="560px"
      footer={<>
        <button type="button" className={btn.ghost} onClick={onClose}>ปิด</button>
        {form && !forbidden && (
          <button type="button" className={btn.primary} disabled={saving || problems.length > 0} onClick={() => void save()}>
            {saving && <Loader2 size={14} className="animate-spin" aria-hidden />} บันทึก
          </button>
        )}
      </>}>
      {forbidden ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">บัญชีนี้แก้ตั้งค่าไม่ได้ ให้ผู้จัดการจัดซื้อหรือแอดมินเป็นคนแก้</p>
      ) : error && !form ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>
      ) : !form ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" aria-hidden /> กำลังโหลด</div>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border border-[#E8EEEA] bg-white p-4 dark:border-white/8 dark:bg-[#151a10]">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="vo-set-thr" className={label}>เกณฑ์ผ่านขั้นต่ำ (ข้อ)</label>
              <input id="vo-set-thr" inputMode="numeric" value={form.passThreshold} onChange={(e) => setForm({ ...form, passThreshold: e.target.value.replace(/\D/g, "") })} className={inputCls} />
              <p className={help}>มีผลกับใบที่ส่งเข้ามาหลังบันทึก ใบเก่าใช้เกณฑ์เดิม</p>
            </div>
            <div>
              <label htmlFor="vo-set-days" className={label}>ลิงก์ขอเอกสารใช้ได้ (วัน)</label>
              <input id="vo-set-days" inputMode="numeric" value={form.linkDays} onChange={(e) => setForm({ ...form, linkDays: e.target.value.replace(/\D/g, "") })} className={inputCls} />
            </div>
          </div>
          <div>
            <label htmlFor="vo-set-rev" className={label}>อีเมลผู้รีวิว</label>
            <textarea id="vo-set-rev" rows={3} value={form.reviewerEmails} onChange={(e) => setForm({ ...form, reviewerEmails: e.target.value })} className={`${inputCls} font-mono text-[12.5px]`} />
            <p className={help}>บรรทัดละหนึ่งอีเมล</p>
          </div>
          <div>
            <label htmlFor="vo-set-app" className={label}>อีเมลผู้อนุมัติ</label>
            <textarea id="vo-set-app" rows={3} value={form.approverEmails} onChange={(e) => setForm({ ...form, approverEmails: e.target.value })} className={`${inputCls} font-mono text-[12.5px]`} />
          </div>
          {problems.length > 0 && <p role="alert" className="text-[12.5px] text-red-600 dark:text-red-300">{problems.join(" · ")}</p>}
          {error && <p role="alert" className="text-[12.5px] text-red-600 dark:text-red-300">{error}</p>}
        </div>
      )}
    </ModalShell>
  )
}
