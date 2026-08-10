"use client"

// เฝ้า session ฝั่ง client — ยึดรูปแบบเดียวกับ MenaIT service (app/context/SessionContext.tsx)
//
//   1) session หมดอายุ / ไม่มี user     → Swal "เซสชันหมดอายุ" → เคลียร์ storage → กลับหน้า login
//   2) มี session แต่โปรไฟล์พนักงานไม่ครบ → Swal บอกฟิลด์ที่ขาด → บังคับ login ใหม่
//
// ข้อ 2 จำเป็นเพราะ JWT เติมข้อมูลพนักงานได้เฉพาะตอน sign-in เท่านั้น
// กันวนลูป: ถ้า login ใหม่แล้วยังไม่ครบ (เช่น API HR ล่ม) จะให้เลือก "ลองใหม่" หรือ "ใช้งานต่อ"

import { useEffect, useRef } from "react"
import { signOut, useSession } from "next-auth/react"
import Swal from "sweetalert2"
import { EMPLOYEE_FIELD_LABELS, missingEmployeeFields } from "@/lib/session-profile"

const RETRY_KEY  = "mena_profile_retry"
const BRAND      = "#1B8C4B"
/** localStorage key ที่ไม่ควรล้างตอน logout (ค่าตั้งค่า UI ล้วน ๆ) */
const KEEP_KEYS = new Set(["theme"])

function darkOpts(): { background?: string; color?: string } {
  if (typeof document === "undefined") return {}
  if (!document.documentElement.classList.contains("dark")) return {}
  return { background: "#0f1117", color: "#f9fafb" }
}

/** เคลียร์ข้อมูลผู้ใช้ที่ค้างใน browser (MenaIT ใช้ localStorage.clear() — ที่นี่กันธีมหลุด) */
function clearUserStorage() {
  for (const k of Object.keys(localStorage)) {
    if (!KEEP_KEYS.has(k)) localStorage.removeItem(k)
  }
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

export function SessionGuard() {
  const { data: session, status } = useSession()
  const fired = useRef(false)

  useEffect(() => {
    if (status === "loading") return

    // ── 1) ไม่มี session (หมดอายุ / ถูก revoke ระหว่างเปิดแท็บค้างไว้)
    if (status === "unauthenticated") {
      if (fired.current) return
      fired.current = true
      Swal.fire({
        icon: "warning",
        title: "เซสชันหมดอายุ",
        text: "กรุณาเข้าสู่ระบบใหม่อีกครั้ง",
        confirmButtonText: "ไปหน้าเข้าสู่ระบบ",
        confirmButtonColor: BRAND,
        allowOutsideClick: false,
        allowEscapeKey: false,
        ...darkOpts(),
      }).then(() => {
        clearUserStorage()
        window.location.href = "/login"
      })
      return
    }

    // ── 2) มี session แล้ว — ตรวจว่าโปรไฟล์พนักงานครบไหม
    const missing = missingEmployeeFields(session?.user?.employee)
    if (missing.length === 0) {
      sessionStorage.removeItem(RETRY_KEY)
      return
    }

    const state = sessionStorage.getItem(RETRY_KEY)
    if (state === "skip") return           // ผู้ใช้เลือก "ใช้งานต่อ" ไปแล้วในรอบนี้
    if (fired.current) return
    fired.current = true

    const list = missing.map((f) => `<li>${EMPLOYEE_FIELD_LABELS[f]}</li>`).join("")
    const listHtml =
      `<div style="text-align:left;font-size:13px;line-height:1.7">` +
      `<p style="margin:0 0 6px">ข้อมูลที่ขาดใน session:</p>` +
      `<ul style="margin:0;padding-left:18px">${list}</ul></div>`

    if (state !== "retried") {
      Swal.fire({
        icon: "warning",
        title: "ข้อมูลผู้ใช้ไม่ครบ",
        html: `${listHtml}<p style="font-size:12.5px;margin-top:10px;opacity:.75">กรุณาเข้าสู่ระบบใหม่เพื่อดึงข้อมูลพนักงานอีกครั้ง</p>`,
        confirmButtonText: "เข้าสู่ระบบใหม่",
        confirmButtonColor: BRAND,
        allowOutsideClick: false,
        allowEscapeKey: false,
        ...darkOpts(),
      }).then(() => {
        sessionStorage.setItem(RETRY_KEY, "retried")
        clearUserStorage()
        signOut({ callbackUrl: "/login" })
      })
      return
    }

    // login ใหม่แล้วยังไม่ครบ — ไม่บังคับซ้ำ ให้ผู้ใช้ตัดสินใจ
    Swal.fire({
      icon: "error",
      title: "ยังดึงข้อมูลพนักงานไม่ได้",
      html:
        `${listHtml}<p style="font-size:12px;margin-top:10px;opacity:.7">` +
        esc(session?.apiAuthError ?? "ระบบ HR ไม่ตอบกลับ — โปรดแจ้งผู้ดูแลระบบ") +
        `</p>`,
      showCancelButton: true,
      confirmButtonText: "ลองเข้าสู่ระบบใหม่",
      cancelButtonText: "ใช้งานต่อ",
      confirmButtonColor: BRAND,
      reverseButtons: true,
      allowOutsideClick: false,
      ...darkOpts(),
    }).then((r) => {
      if (r.isConfirmed) {
        clearUserStorage()
        signOut({ callbackUrl: "/login" })
      } else {
        sessionStorage.setItem(RETRY_KEY, "skip")
      }
    })
  }, [status, session])

  return null
}
