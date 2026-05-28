"use client"

import { useEffect, useRef } from "react"
import { useSession } from "next-auth/react"
import Swal from "sweetalert2"

export function WelcomePopup() {
  const { data: session } = useSession()
  const shown = useRef(false)

  useEffect(() => {
    if (!session?.user) return
    if (!localStorage.getItem("mena_pending_welcome")) return
    if (shown.current) return
    shown.current = true

    localStorage.removeItem("mena_pending_welcome")

    const name = session.user.name?.split(" ")[0] ?? "คุณ"

    Swal.fire({
      title: `ยินดีต้อนรับ, ${name}! 👋`,
      text: "เข้าสู่ระบบสำเร็จ",
      icon: "success",
      confirmButtonText: "เริ่มใช้งาน",
      confirmButtonColor: "#16a34a",
      ...(document.documentElement.classList.contains("dark")
        ? { background: "#0f1117", color: "#f9fafb" }
        : {}),
    }).then(() => {
      if (!localStorage.getItem("mena_tour_done")) {
        setTimeout(() => window.dispatchEvent(new CustomEvent("mena:show-tour")), 300)
      }
    })
  }, [session])

  return null
}
