"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Sidebar } from "./sidebar"
import { Navbar } from "./navbar"
import { TourHighlight } from "./tour-highlight"

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [navOpen, setNavOpen] = useState(false)
  // ปิด drawer อัตโนมัติเมื่อเปลี่ยนหน้า
  useEffect(() => { setNavOpen(false) }, [pathname])

  const isLoginPage        = pathname === "/login"
  const isPresentationPage = pathname === "/presentation"
  const isPrdPage          = pathname === "/prd"

  if (isLoginPage || isPresentationPage) {
    return <div className="w-full h-full">{children}</div>
  }

  if (isPrdPage) {
    return <div className="w-full h-full overflow-y-auto">{children}</div>
  }

  return (
    <>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      {/* backdrop (มือถือเท่านั้น) */}
      {navOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setNavOpen(false)} aria-hidden />
      )}
      <TourHighlight />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Navbar onMenuClick={() => setNavOpen(true)} />
        <main className="main-canvas flex-1 overflow-y-auto px-3 py-4 lg:px-7 lg:py-6">{children}</main>
      </div>
    </>
  )
}
