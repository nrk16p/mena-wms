// lib/atms-auth-dialog.ts — กล่องผูกบัญชี ATMS ของหน้ายาง (ฝั่ง client)
// /api/tire-change/sync ตอบ 401 พร้อม code → ถามให้ตรงกับเหตุ:
//   need_link / bad_credentials = กรอก username + password ATMS (ครั้งเดียว ระบบ login ให้เองครั้งต่อไป)
//   expired = PHPSESSID ที่วางมาเองหมดอายุ → ถาม PHPSESSID ใหม่
// ทางสำรอง "วาง PHPSESSID แทน" ยังอยู่ เผื่อ api-ncac ล่ม (ผูกบัญชีต้องผ่าน api-ncac ตรวจอีเมล)
import Swal from "sweetalert2"
import { darkOpts } from "@/lib/swal"

type SyncAuthError = { code?: string; error?: string; atmsUsername?: string }

/** คืน {} = ผูกบัญชีแล้ว ยิง sync ซ้ำได้ · { phpsessid } = ใช้ค่าที่วางมา · null = ผู้ใช้ยกเลิก */
export async function askAtmsAuth(d: SyncAuthError): Promise<{ phpsessid?: string } | null> {
  if (d.code === "expired") return askPhpsessid()

  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
  const lead = d.code === "bad_credentials"
    ? "ATMS ไม่รับรหัสผ่านที่ผูกไว้ อาจเปลี่ยนรหัสใน ATMS แล้ว กรอกใหม่อีกครั้ง"
    : "กรอกชื่อผู้ใช้และรหัสผ่าน ATMS ครั้งเดียว ครั้งต่อไประบบจะ login ให้เองเมื่อ session หมด"
  const field = "width:100%;margin:0;box-sizing:border-box"

  const r = await Swal.fire({
    title: "เชื่อมบัญชี ATMS",
    html: `
      <form id="atms-form" autocomplete="on" style="display:flex;flex-direction:column;gap:.6rem;text-align:left" onsubmit="return false">
        <p style="margin:0 0 .25rem;font-size:.9rem;opacity:.8">${lead}</p>
        <input id="atms-u" name="username" class="swal2-input" style="${field}" placeholder="ชื่อผู้ใช้ ATMS"
               autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(d.atmsUsername ?? "")}" />
        <input id="atms-p" name="password" type="password" class="swal2-input" style="${field}" placeholder="รหัสผ่าน ATMS"
               autocomplete="current-password" />
        <p style="margin:.25rem 0 0;font-size:.78rem;opacity:.6">ใช้บัญชีเดียวกับที่เข้า mena-atms.com · อีเมลในบัญชี ATMS ต้องตรงกับอีเมลที่ล็อกอิน WMS · รหัสผ่านเก็บแบบเข้ารหัส</p>
      </form>`,
    focusConfirm: false,
    showCancelButton: true,
    showDenyButton: true,
    confirmButtonText: "เชื่อมแล้ว Sync",
    denyButtonText: "วาง PHPSESSID แทน",
    cancelButtonText: "ยกเลิก",
    confirmButtonColor: "#1B8C4B",
    denyButtonColor: "#6b7280",
    reverseButtons: true,
    showLoaderOnConfirm: true,
    allowOutsideClick: () => !Swal.isLoading(),
    didOpen: (popup) => {
      const u = popup.querySelector<HTMLInputElement>("#atms-u")
      const p = popup.querySelector<HTMLInputElement>("#atms-p")
      ;(u?.value ? p : u)?.focus()
      // Enter ในช่องไหนก็ได้ = กดเชื่อม (Swal จับ Enter ให้เฉพาะ input ของตัวเอง)
      popup.querySelector("#atms-form")?.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter") { e.preventDefault(); Swal.clickConfirm() }
      })
    },
    preConfirm: async () => {
      const popup = Swal.getPopup()
      const username = popup?.querySelector<HTMLInputElement>("#atms-u")?.value.trim() ?? ""
      const password = popup?.querySelector<HTMLInputElement>("#atms-p")?.value ?? ""
      if (!username || !password) { Swal.showValidationMessage("กรอกชื่อผู้ใช้และรหัสผ่านให้ครบ"); return false }
      const res = await fetch("/api/tire-change/atms-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      }).catch(() => null)
      const out = await res?.json().catch(() => ({}))
      if (!res?.ok) { Swal.showValidationMessage(out?.error ?? "เชื่อมบัญชีไม่สำเร็จ ลองใหม่อีกครั้ง"); return false }
      return true
    },
    ...darkOpts(),
  })

  if (r.isConfirmed) return {}
  if (r.isDenied) return askPhpsessid()
  return null
}

async function askPhpsessid(): Promise<{ phpsessid: string } | null> {
  const { value, isConfirmed } = await Swal.fire<string>({
    title: "วาง PHPSESSID",
    text: "เปิด mena-atms.com → DevTools → Application → Cookies → คัดลอกค่า PHPSESSID",
    input: "text",
    inputPlaceholder: "PHPSESSID",
    showCancelButton: true,
    confirmButtonText: "Sync",
    cancelButtonText: "ยกเลิก",
    reverseButtons: true,
    inputValidator: (v) => (String(v ?? "").trim() ? null : "วางค่า PHPSESSID"),
    ...darkOpts(),
  })
  return isConfirmed && value?.trim() ? { phpsessid: value.trim() } : null
}
