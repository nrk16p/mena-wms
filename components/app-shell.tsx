"use client"

import { usePathname } from "next/navigation"
import { Sidebar } from "./sidebar"
import { Navbar } from "./navbar"
import { TourHighlight } from "./tour-highlight"

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
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
      <Sidebar />
      <TourHighlight />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Navbar />
        <main className="flex-1 overflow-y-auto px-8 py-7">{children}</main>
      </div>
    </>
  )
}
