"use client"

// รูป "เอกสารที่ต้องแนบเมื่อวางบิล" ของผู้ขายหนึ่งราย — จัดซื้อกดคัดลอกเป็น PNG แล้ววางในไลน์ส่งผู้ขาย
// การ์ดใช้ inline style ทั้งหมด (ไม่ใช้ class ของ tailwind/dark mode) เพราะรูปต้องออกมาเหมือนกันทุกเครื่องทุกธีม
// ขนาดการ์ด 540px × pixelRatio 2 = รูปกว้าง 1080px (พอดีจอมือถือในไลน์)

import { useRef, useState } from "react"
import { X, Copy, Download } from "lucide-react"
import { swalToast } from "@/lib/swal"
import { BRAND, COMPANY } from "@/lib/vendor-brand"
import { thaiDate, todayICT } from "@/lib/ap-tracking"
import {
  AP_BILLING_INFO, billingInfoGaps, creditTermText, templateDocLabel, type ApTplDocKey,
} from "@/lib/ap-doc-template"

// ── ฟอนต์ ────────────────────────────────────────────────────────────────────
// html-to-image ฝังเว็บฟอนต์เองไม่ได้ (อ่าน cssRules ของสไตล์ชีต Google Fonts ข้ามโดเมนแล้วโดน SecurityError
// หน้าอื่นจึงใช้ skipFonts) → ดึง CSS ของ Prompt เอง แปลงไฟล์ฟอนต์เป็น data URL แล้วส่งให้ผ่าน fontEmbedCSS
// เอาเฉพาะชุดอักษรไทย + ละติน · ดึงไม่ได้ (ออฟไลน์) ถอยไปใช้ฟอนต์ของเครื่อง รูปยังออกได้
const FONT_CSS_URL = "https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600&display=swap"
let fontCssPromise: Promise<string> | null = null

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result))
  r.onerror = () => reject(r.error)
  r.readAsDataURL(blob)
})

function promptFontCss(): Promise<string> {
  fontCssPromise ??= (async () => {
    const css = await (await fetch(FONT_CSS_URL)).text()
    const blocks = css.split(/(?=\/\* [a-z-]+ \*\/)/).filter((b) => /^\/\* (thai|latin) \*\//.test(b))
    if (!blocks.length) throw new Error("ไม่พบ @font-face ของ Prompt")
    const out = await Promise.all(blocks.map(async (b) => {
      const m = /url\((https:[^)]+)\)/.exec(b)
      if (!m) return b
      return b.replace(m[1], await toDataUrl(await (await fetch(m[1])).blob()))
    }))
    return out.join("\n")
  })().catch((e) => { fontCssPromise = null; throw e })
  return fontCssPromise
}

async function capturePng(el: HTMLElement): Promise<Blob> {
  const { toBlob } = await import("html-to-image")
  const fontEmbedCSS = await promptFontCss().catch((e) => { console.warn("embed font failed", e); return "" })
  const opts = {
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    ...(fontEmbedCSS ? { fontEmbedCSS } : { skipFonts: true }),
  }
  // Safari/WebKit: การจับภาพครั้งแรกมักได้ภาพเปล่า — วอร์มก่อนแล้วค่อยจับจริง (แพตเทิร์นเดียวกับ /deadstock)
  await toBlob(el, opts)
  const blob = await toBlob(el, opts)
  if (!blob) throw new Error("จับภาพไม่สำเร็จ")
  return blob
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.download = filename
  a.href = url
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// ── การ์ด ────────────────────────────────────────────────────────────────────
const FONT = "'Prompt', 'Sarabun', sans-serif"

function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden style={{ flexShrink: 0 }}>
      <rect x="1" y="1" width="20" height="20" rx="6" fill={BRAND.green} />
      <path d="M6 11.5l3.2 3.2L16 8" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function InfoBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "12px 16px", borderRadius: 12, background: BRAND.bg }}>
      <div style={{ fontSize: 12, color: BRAND.muted, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, color: BRAND.ink, lineHeight: 1.55 }}>{children}</div>
    </div>
  )
}

export function ApDocTemplateCard({
  name, docs, creditTerm,
}: { name: string; docs: ApTplDocKey[]; creditTerm: string }) {
  const term = creditTermText(creditTerm)
  const info = AP_BILLING_INFO
  return (
    <div style={{ width: 540, background: BRAND.white, fontFamily: FONT, color: BRAND.body, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "20px 28px 16px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mena-logo.svg" alt="Mena Transport" style={{ height: 42, width: "auto" }} />
        <div style={{ lineHeight: 1.3 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: BRAND.green }}>{COMPANY.nameTh}</div>
          <div style={{ fontSize: 11, color: BRAND.muted }}>{COMPANY.nameEn}</div>
        </div>
      </div>

      <div style={{ background: BRAND.green, color: BRAND.white, padding: "18px 28px" }}>
        <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.3 }}>เอกสารที่ต้องแนบเมื่อวางบิล</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>กรุณาส่งให้ครบทุกรายการ เพื่อให้ตั้งหนี้และจ่ายเงินได้ตรงรอบ</div>
      </div>

      <div style={{ padding: "20px 28px 8px" }}>
        <div style={{ fontSize: 12, color: BRAND.muted }}>เรียน</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: BRAND.ink, lineHeight: 1.4 }}>{name}</div>
        {/* รหัสผู้ขายไม่พิมพ์บนรูป (ผู้ใช้สั่ง 22/09/2026) — ยังใช้ตั้งชื่อไฟล์ */}
      </div>

      <div style={{ padding: "8px 28px 4px" }}>
        {docs.map((k, i) => (
          <div key={k} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "11px 0",
            borderTop: i === 0 ? "none" : `1px solid ${BRAND.line}`,
          }}>
            <CheckIcon />
            <span style={{ fontSize: 17, fontWeight: 500, color: BRAND.ink }}>{templateDocLabel(k)}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 10, padding: "14px 28px 22px" }}>
        {/* บล็อก "ออกเอกสารในนาม" (ชื่อ/ที่อยู่/เลขผู้เสียภาษี) ถอดออก 22/09/2026 ตามที่ผู้ใช้สั่ง */}
        {term && <InfoBlock label="เงื่อนไขการชำระ">{term}</InfoBlock>}
        {info.sendTo && <InfoBlock label="ส่งเอกสารที่">{info.sendTo}</InfoBlock>}
        {info.contact && <InfoBlock label="ติดต่อสอบถาม">{info.contact}</InfoBlock>}
      </div>

      <div style={{
        background: BRAND.greenDark, color: "rgba(255,255,255,0.85)", fontSize: 11,
        padding: "10px 28px", display: "flex", justifyContent: "space-between",
      }}>
        <span>menatransport.co.th</span>
        <span>ข้อมูล ณ {thaiDate(todayICT())}</span>
      </div>
    </div>
  )
}

// ── หน้าต่างพรีวิว + ปุ่มคัดลอก/ดาวน์โหลด ─────────────────────────────────────
export function ApDocTemplateShareDialog({
  name, code, docs, creditTerm, onClose,
}: { name: string; code: string; docs: ApTplDocKey[]; creditTerm: string; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<"" | "copy" | "download">("")
  const gaps = billingInfoGaps()
  const filename = `เอกสารวางบิล-${(code || name).replace(/[\\/:*?"<>|\s]+/g, "_")}.png`

  const capture = () => {
    const el = cardRef.current
    if (!el) return Promise.reject(new Error("ไม่พบการ์ด"))
    return capturePng(el)
  }

  const copy = async () => {
    if (busy) return
    setBusy("copy")
    // ต้องสร้าง ClipboardItem ทันทีในจังหวะที่กด (Safari นับเฉพาะ user gesture) โดยส่งเป็น Promise ของรูป
    const blobP = capture()
    try {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blobP })])
      } catch {
        // เบราว์เซอร์ที่ไม่รับ Promise ใน ClipboardItem — รอรูปเสร็จแล้วลองอีกรอบ
        await navigator.clipboard.write([new ClipboardItem({ "image/png": await blobP })])
      }
      swalToast("success", "คัดลอกรูปแล้ว — วางในไลน์ได้เลย")
    } catch (e) {
      console.warn("copy image failed", e)
      // คัดลอกไม่ได้ (สิทธิ์คลิปบอร์ด / เบราว์เซอร์เก่า) → ดาวน์โหลดแทน รูปไม่หาย
      try {
        downloadBlob(await blobP, filename)
        swalToast("info", "คัดลอกไม่ได้ในเบราว์เซอร์นี้ — ดาวน์โหลดเป็นไฟล์ PNG ให้แทน")
      } catch (e2) {
        swalToast("error", `สร้างรูปไม่สำเร็จ: ${e2 instanceof Error ? e2.message : e2}`)
      }
    } finally {
      setBusy("")
    }
  }

  const download = async () => {
    if (busy) return
    setBusy("download")
    try {
      downloadBlob(await capture(), filename)
    } catch (e) {
      swalToast("error", `สร้างรูปไม่สำเร็จ: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy("")
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-[#161a23]">
        <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3 dark:border-white/10">
          <div className="min-w-0">
            <div className="text-sm font-bold">รูปส่งผู้ขาย · เอกสารที่ต้องแนบ</div>
            <div className="truncate text-xs text-gray-500">{name}</div>
          </div>
          <button onClick={onClose} aria-label="ปิด" className="ml-auto rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-gray-100 p-4 dark:bg-black/30">
          {/* จับภาพที่โหนดชั้นในซึ่งไม่มี margin — html-to-image คัด margin ของโหนดราก (mx-auto) ไปด้วย
              รูปจะเยื้องขวาแล้วขอบขวาโดนตัด */}
          <div className="mx-auto w-[540px] shadow-sm">
            <div ref={cardRef}>
              <ApDocTemplateCard name={name} docs={docs} creditTerm={creditTerm} />
            </div>
          </div>
        </div>

        <div className="space-y-2 border-t border-gray-100 px-5 py-3 dark:border-white/10">
          {gaps.length > 0 && (
            <div className="text-[11px] text-amber-700 dark:text-amber-400">
              ยังไม่ได้ตั้ง {gaps.join(", ")} — บรรทัดเหล่านี้จะไม่อยู่บนรูป (ตั้งค่าที่ AP_BILLING_INFO ใน lib/ap-doc-template.ts)
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={copy} disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
              <Copy className="h-4 w-4" />{busy === "copy" ? "กำลังสร้างรูป…" : "คัดลอกรูป"}
            </button>
            <button onClick={download} disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/5">
              <Download className="h-4 w-4" />{busy === "download" ? "กำลังสร้างรูป…" : "ดาวน์โหลด PNG"}
            </button>
            <span className="ml-auto text-[11px] text-gray-400">รูปกว้าง 1080px</span>
          </div>
        </div>
      </div>
    </div>
  )
}
