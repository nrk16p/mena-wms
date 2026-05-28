"use client"

import { useEffect, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import Swal from "sweetalert2"

export function WelcomePopup() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { data: session } = useSession()
  const shown = useRef(false)

  useEffect(() => {
    if (searchParams.get("welcome") !== "1") return
    if (!session?.user) return   // รอ session โหลดจริงก่อน
    if (shown.current) return    // ป้องกันรันซ้ำเมื่อ dependency เปลี่ยน
    shown.current = true

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
      router.replace("/")
      if (!localStorage.getItem("mena_tour_done")) {
        setTimeout(() => window.dispatchEvent(new CustomEvent("mena:show-tour")), 300)
      }
    })
  }, [searchParams, session, router])

  return null
}
