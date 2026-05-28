"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"

export function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem("theme")
    const isDark =
      stored === "dark" ||
      (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches)
    setDark(isDark)
    document.documentElement.classList.toggle("dark", isDark)
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle("dark", next)
    localStorage.setItem("theme", next ? "dark" : "light")
  }

  return (
    <button
      onClick={toggle}
      title={dark ? "Light mode" : "Dark mode"}
      className={`
        flex items-center gap-2.5 rounded-lg py-2 text-[13px] font-medium transition-all duration-150
        text-gray-400 dark:text-gray-500
        hover:bg-gray-100 dark:hover:bg-white/6 hover:text-gray-700 dark:hover:text-gray-300
        ${collapsed ? "justify-center px-0 w-full" : "px-2.5 w-full"}
      `}
    >
      {dark
        ? <Sun size={15} className="shrink-0" />
        : <Moon size={15} className="shrink-0" />
      }
      {!collapsed && <span>{dark ? "Light Mode" : "Dark Mode"}</span>}
    </button>
  )
}
