"use client"

// DecimalInput — ช่องกรอกทศนิยมที่พิมพ์ "2.30" ได้ (เก็บข้อความที่กำลังพิมพ์ไว้เอง ไม่ให้ตัวเลขกลืนจุด)
// ส่งค่าขึ้นข้างบนทุกครั้งที่พิมพ์ · ออกจากช่อง (blur) แล้วจัดรูปแบบ · ค่าเปลี่ยนจากข้างนอก (เช่นจัดแถวใหม่) ก็ซิงก์กลับ
import { useState } from "react"
import { formatPlain, isTypable, parseDecimal } from "@/lib/decimal-input"

export function DecimalInput({ value, onValue, emptyAs = null, format = formatPlain, className, disabled, placeholder, ariaLabel }: {
  value: number | null
  onValue: (n: number | null) => void
  /** ค่าที่ถือว่าตรงกับช่องว่าง (จำนวน = 0, ราคา = null) */
  emptyAs?: number | null
  format?: (n: number | null) => string
  className?: string
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
}) {
  const [text, setText] = useState(() => format(value))
  const [seen, setSeen] = useState(value)

  // ค่าจากข้างนอกเปลี่ยนและไม่ตรงกับที่พิมพ์อยู่ (เช่นถูกเขียนทับจากที่อื่น) → ซิงก์ข้อความ · ตรงกันอยู่แล้ว = ไม่แตะที่กำลังพิมพ์
  // (ปรับระหว่าง render แทน effect — ตามแนวทางของ React สำหรับ state ที่มาจาก prop)
  if (value !== seen) {
    setSeen(value)
    if ((parseDecimal(text) ?? emptyAs) !== value) setText(format(value))
  }

  return (
    <input
      type="text" inputMode="decimal" autoComplete="off"
      aria-label={ariaLabel} placeholder={placeholder} disabled={disabled} className={className}
      value={text}
      onChange={(e) => {
        const t = e.target.value
        if (!isTypable(t)) return
        setText(t)
        onValue(parseDecimal(t))
      }}
      onBlur={() => { setText(format(parseDecimal(text) ?? emptyAs)) }}
    />
  )
}
