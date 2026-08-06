"use client"

import { useState } from "react"

// รูปโปรไฟล์ Google มาเป็น .../photo=s96-c — ขอขนาดตามที่ใช้จริง (x2 สำหรับจอ retina)
function sizedGoogleAvatar(url: string, px: number): string {
  return url.replace(/=s\d+-c$/, `=s${Math.min(Math.round(px * 2), 512)}-c`)
}

// "Kittaboon Laingern (Bew)" → "KL" · "สมชาย ใจดี" → "สใ"
function initialsOf(name?: string | null): string {
  const words = (name ?? "")
    .replace(/\(.*?\)/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return "U"
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

type Props = {
  src?: string | null
  name?: string | null
  /** ขนาดด้าน (px) */
  size?: number
  /** วงแหวนขอบขาว/เข้ม — ใช้เวลาวางบนพื้นสี */
  ring?: boolean
  className?: string
}

/**
 * Avatar ของผู้ใช้ — ดึงรูปจาก session.user.image (Google)
 * - referrerPolicy="no-referrer" จำเป็นสำหรับ lh3.googleusercontent.com ไม่งั้นบางเบราว์เซอร์/บาง network โดน block แล้วรูปไม่ขึ้น
 * - โหลดไม่สำเร็จ → fallback เป็นตัวย่อชื่อบนพื้นเขียว (ไม่มีวันเห็นรูปแตก)
 */
export function UserAvatar({ src, name, size = 32, ring = false, className = "" }: Props) {
  const [broken, setBroken] = useState(false)
  const shell = [
    "shrink-0 rounded-full object-cover",
    ring ? "ring-2 ring-white/70 dark:ring-white/15" : "",
    className,
  ].join(" ")

  if (!src || broken) {
    return (
      <div
        className={`${shell} flex items-center justify-center bg-linear-to-br from-[#1B8C4B] to-[#12703A] font-bold text-white`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.4), fontFamily: "'Mitr', sans-serif" }}
        aria-hidden
      >
        {initialsOf(name)}
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sizedGoogleAvatar(src, size)}
      alt={name ?? "โปรไฟล์ผู้ใช้"}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className={`${shell} bg-[#EAF6EE]`}
      style={{ width: size, height: size }}
    />
  )
}
