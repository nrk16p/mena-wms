"use client"

// คำค้นเมนูที่ใช้ร่วมกันระหว่าง sidebar (ช่องค้นหา) กับหน้าหลัก (แสดงผลค้นหาเป็นการ์ด)
// เก็บในโมดูลเดียว ไม่ต้องห่อ context ทั้งแอป

import { useSyncExternalStore } from "react"

let query = ""
const listeners = new Set<() => void>()

export function setNavQuery(q: string) {
  if (q === query) return
  query = q
  listeners.forEach((l) => l())
}

export function useNavQuery() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => query,
    () => "",
  )
}

// อีเวนต์ข้ามคอมโพเนนต์
export const NAV_SEARCH_FOCUS = "wms:nav-search-focus"   // ขอให้ sidebar โฟกัสช่องค้นหา
export const NAV_NOTICE_OPEN  = "wms:nav-notice-open"    // เปิดการ์ดแจ้งเปลี่ยนเมนูอีกครั้ง

// ── เมนูโปรด (กดดาว) ── เก็บ href ใน localStorage ต่อเบราว์เซอร์ ใช้ร่วม sidebar + หน้าหลัก
const FAV_KEY = "navFavorites"
const EMPTY: string[] = []
let favCache: string[] | null = null
const favListeners = new Set<() => void>()

function readFavs(): string[] {
  if (favCache) return favCache
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]")
    favCache = Array.isArray(v) ? v.filter((x) => typeof x === "string") : []
  } catch { favCache = [] }
  return favCache
}

export function toggleFavorite(href: string) {
  const cur = readFavs()
  favCache = cur.includes(href) ? cur.filter((h) => h !== href) : [...cur, href]
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favCache)) } catch { /* ignore */ }
  favListeners.forEach((l) => l())
}

export function useNavFavorites(): string[] {
  return useSyncExternalStore(
    (cb) => { favListeners.add(cb); return () => { favListeners.delete(cb) } },
    readFavs,
    () => EMPTY,
  )
}
