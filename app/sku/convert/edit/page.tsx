"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2, Lock, Plus, RefreshCw, Save } from "lucide-react"
import { EntryCard } from "@/components/sku-convert/entry-card"
import { EvidencePanel } from "@/components/sku-convert/evidence-panel"
import { Mascot } from "@/components/sku-convert/mascot-v2"
import { useConvertItem } from "@/components/sku-convert/use-convert-item"
import { Chip, Skeleton, Stepper, StatusChip, fmtMoney, fmtQty, type StepDef } from "@/components/sku-convert/ui"
import { MAX_ENTRIES, entryMissing, entryWrong, qtyCheck, rowStatus, splitFrom } from "@/lib/sku-convert-core"
import { swalConfirm } from "@/lib/swal"
import { cn } from "@/lib/utils"

const LIST_KEY = "skuConvert:list"

function listHref(): string {
  try {
    const q = sessionStorage.getItem(LIST_KEY)
    return q ? `/sku/convert?${q}` : "/sku/convert"
  } catch {
    return "/sku/convert"
  }
}
const editHref = (id: string) => `/sku/convert/edit?id=${encodeURIComponent(id)}`

export default function ConvertEditPage() {
  return (
    <Suspense fallback={<div className="p-8"><Skeleton className="h-40 w-full" /></div>}>
      <EditInner />
    </Suspense>
  )
}

function EditInner() {
  const id = useSearchParams().get("id") ?? ""
  if (!id) {
    return (
      <div className="mx-auto max-w-lg p-10 text-center">
        <Mascot size={88} motion="none" className="mb-4" />
        <p className="text-[#33476b]">ไม่ได้ระบุรหัสที่ต้องการแก้ไข</p>
        <Link href="/sku/convert" className="v2-btn mt-4">กลับรายการ</Link>
      </div>
    )
  }
  // key = id → state (entries, lock) resets cleanly when "ไปรหัสถัดไป" changes the query
  return <Workspace key={id} id={id} />
}

function Workspace({ id }: { id: string }) {
  const router = useRouter()
  const c = useConvertItem(id)
  const { item, book, entries, setEntries, readOnly, holder, saving, dirty, save } = c
  const [flash, setFlash] = useState("")
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSave = useCallback(async (andNext: boolean) => {
    if (saving || readOnly) return
    const r = await save(andNext)
    if (!r.ok) return
    if (andNext) {
      router.push(c.next ? editHref(c.next) : listHref())
      return
    }
    setFlash("บันทึกแล้ว")
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(""), 3000)
  }, [saving, readOnly, save, router, c.next])

  // Ctrl/Cmd+S saves (stays on the row)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        void handleSave(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [handleSave])

  // unsaved-work guard for reload / tab close
  useEffect(() => {
    if (!dirty) return
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", onUnload)
    return () => window.removeEventListener("beforeunload", onUnload)
  }, [dirty])
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

  async function goBack() {
    if (dirty && !readOnly) {
      const r = await swalConfirm("ยังไม่ได้บันทึก", "ออกจากหน้านี้โดยไม่บันทึกการแก้ไข?")
      if (!r.isConfirmed) return
    }
    router.push(listHref())
  }

  if (c.loading) return <LoadingView />
  if (c.loadError || !item || !book) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-20 text-center" role="alert">
        <AlertTriangle className="h-10 w-10 text-[#ff8a3d]" />
        <p className="text-[#33476b]">{c.loadError || "โหลดข้อมูลไม่สำเร็จ"}</p>
        <div className="flex gap-2">
          <button type="button" className="v2-btn" onClick={c.retake}>ลองใหม่</button>
          <Link href={listHref()} className="v2-btn-soft">กลับรายการ</Link>
        </div>
      </div>
    )
  }

  const parts = item.kind === "parts"
  const status = rowStatus(item.kind, item.atmsQty, entries, book)
  const qc = parts ? qtyCheck(item.atmsQty, entries) : null
  const card1Ok = !!entries[0] && !entryMissing(entries[0]).length && !entryWrong(entries[0], book).length
  const steps: StepDef[] = [
    { label: "① ดูหลักฐาน", state: "done" },
    { label: "② รหัสใหม่ #1", state: card1Ok ? "done" : "todo", hint: card1Ok ? "กรอกครบ" : "ยังกรอกไม่ครบ" },
    { label: "③ แยกรหัส", state: entries.length >= 2 ? "done" : "skip", hint: entries.length >= 2 ? `แยก ${entries.length} รหัส` : "ไม่แยก (ข้ามได้)" },
    parts
      ? { label: "④ แบ่งจำนวน", state: qc!.state === "ok" || qc!.state === "none" ? "done" : qc!.state === "short" || qc!.state === "over" ? "warn" : "todo", hint: qc!.state === "none" ? "ไม่มียอด" : `${fmtQty(qc!.total)} / ${fmtQty(item.atmsQty)}` }
      : { label: "④ แบ่งจำนวน", state: "skip", hint: "ไม่ใช้กับค่าแรง/บริการ" },
    { label: "⑤ ตรวจ", state: status === "done" ? "done" : "todo", hint: status === "done" ? "ครบทุกข้อ" : "ยังไม่ครบ" },
  ]
  const liveDiff = c.liveStock && Math.abs(c.liveStock.qty - item.atmsQty) > 1e-6

  return (
    <>
      <header className="v2-shell relative overflow-hidden rounded-b-[40px] px-4 pb-14 pt-5 text-white sm:px-8">
        <div aria-hidden className="v2-orb -right-32 -top-44 h-80 w-80" />
        <div className="relative mx-auto max-w-[1400px]">
          <button type="button" onClick={goBack} className="mb-2 inline-flex items-center gap-1.5 text-sm text-white/90 hover:text-white">
            <ArrowLeft className="h-4 w-4" />กลับรายการ
          </button>
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-sm font-semibold text-[#86f3c6]">{item.code}</p>
              <h1 className="mt-0.5 text-xl font-bold leading-snug sm:text-3xl">{item.name}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip tone="blue">{item.warehouse}</Chip>
                {item.group && <Chip tone="ink">{item.group}</Chip>}
                {parts && <Chip tone="mint">คงเหลือ 30/09: {fmtQty(item.atmsQty)}{item.unit ? ` ${item.unit}` : ""} · {fmtMoney(item.atmsValue)} ฿</Chip>}
                {parts && c.liveStock && (
                  <Chip tone={liveDiff ? "sun" : "ink"}>{liveDiff && <AlertTriangle className="h-3 w-3" />}ATMS วันนี้ {fmtQty(c.liveStock.qty)}</Chip>
                )}
                <Chip tone="ink">เคลื่อนไหว {fmtQty(item.moves)} ครั้ง</Chip>
                <StatusChip status={status} entryCount={entries.length} />
              </div>
            </div>
            <Mascot size={72} motion="none" className="hidden shrink-0 sm:inline-flex" />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto -mt-8 max-w-[1400px] space-y-4 px-4 pb-28 sm:px-8">
        {readOnly && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[22px] border border-[#ffd9ae] bg-[#fff6ea] p-4 text-sm text-[#7a3b08] shadow-[var(--v2-shadow-card)]">
            <Lock aria-hidden className="h-5 w-5 shrink-0 text-[#ff8a3d]" />
            <p className="min-w-0 flex-1">
              {holder ? <><b>{holder.name || holder.email}</b> กำลังแก้ไขรหัสนี้อยู่</> : "รหัสนี้เปิดดูได้อย่างเดียว"} — หน้านี้แก้ไขไม่ได้จนกว่าเขาจะบันทึกหรือออก
            </p>
            <button type="button" className="v2-btn-soft" onClick={c.retake}><RefreshCw className="h-4 w-4" />ลองรับรหัสนี้อีกครั้ง</button>
          </div>
        )}
        {c.error && !readOnly && (
          <div role="alert" className="flex items-center gap-2 rounded-[22px] border border-[#f7c4be] bg-[#fff1ef] p-3 text-sm text-[#8a1c12]">
            <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />{c.error}
          </div>
        )}
        {c.error && readOnly && <p role="alert" className="px-1 text-sm text-[#8a1c12]">{c.error}</p>}

        <section className="v2-glass rounded-[28px] p-3 sm:p-4"><Stepper steps={steps} /></section>

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="min-w-0 lg:sticky lg:top-3 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
            <EvidencePanel item={item} liveStock={c.liveStock} />
          </div>

          <div className="min-w-0 space-y-4">
            {parts && qc && (
              <div
                role="status" aria-live="polite"
                className={cn(
                  "v2-glass v2-solid sticky top-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[22px] px-4 py-3 text-sm",
                  qc.state === "short" || qc.state === "over" ? "!bg-[#fff6ea]" : "",
                )}
              >
                <span className="font-semibold text-[#33476b]">แบ่งจำนวน</span>
                <span className="tabular-nums text-[#0f2748]">
                  {entries.map((e) => fmtQty(e.qty ?? 0)).join(" + ")} = <b>{fmtQty(qc.total)}</b> / {fmtQty(item.atmsQty)}
                </span>
                {qc.state === "ok" && <Chip tone="mint">✓ ตรงยอด</Chip>}
                {qc.state === "none" && <Chip tone="ink">ไม่มียอดคงเหลือ</Chip>}
                {qc.state === "short" && <Chip tone="sun">⚠ ขาด {fmtQty(qc.diff)}</Chip>}
                {qc.state === "over" && <Chip tone="sun">⚠ เกิน {fmtQty(qc.diff)}</Chip>}
              </div>
            )}

            {entries.map((e, i) => (
              <EntryCard
                key={i}
                index={i}
                entry={e}
                book={book}
                kind={item.kind}
                atmsQty={item.atmsQty}
                otherQty={entries.reduce((s, x, j) => (j === i ? s : s + (x.qty ?? 0)), 0)}
                rowCode={item.code}
                readOnly={readOnly}
                autoFocus={i === 0 && !readOnly}
                onChange={(patch) => setEntries((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
                onRemove={entries.length > 1 ? () => setEntries((prev) => prev.filter((_, j) => j !== i)) : undefined}
              />
            ))}

            {!readOnly && (
              <button
                type="button" className="v2-btn-soft w-full !rounded-[22px] !py-3" disabled={entries.length >= MAX_ENTRIES}
                onClick={() => setEntries((prev) => [...prev, splitFrom(prev[0])])}
              >
                <Plus className="h-4 w-4" />แยกอีกรหัส (คัดลอกจากรหัสใหม่ #1)
              </button>
            )}
          </div>
        </div>
      </main>

      <div className="sticky bottom-3 z-20 mx-auto max-w-[1400px] px-3 sm:px-8">
        <div className="v2-glass v2-solid flex flex-wrap items-center justify-between gap-2 rounded-[28px] p-2.5 shadow-[var(--v2-shadow-lift)]">
          <div className="flex items-center gap-2">
            <button type="button" className="v2-btn-soft" onClick={goBack}><ArrowLeft className="h-4 w-4" />กลับรายการ</button>
            <span aria-live="polite" className="text-xs text-[#33476b]">
              {flash ? <span className="font-semibold text-[#0b8a5e]">✓ {flash}</span> : dirty && !readOnly ? "● มีการแก้ไขที่ยังไม่บันทึก" : ""}
            </span>
          </div>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="v2-btn-soft" disabled={saving} onClick={() => void handleSave(false)} title="Ctrl/Cmd + S">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}บันทึก
              </button>
              <button type="button" className="v2-btn" disabled={saving} onClick={() => void handleSave(true)}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}บันทึกแล้วไปรหัสถัดไป<ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function LoadingView() {
  return (
    <div aria-busy="true" aria-label="กำลังโหลด">
      <div className="v2-shell rounded-b-[40px] px-4 pb-14 pt-8 sm:px-8">
        <div className="mx-auto max-w-[1400px] space-y-3">
          <Skeleton className="h-4 w-28 !bg-white/30" />
          <Skeleton className="h-9 w-2/3 !bg-white/30" />
          <Skeleton className="h-6 w-1/2 !bg-white/30" />
        </div>
      </div>
      <div className="mx-auto -mt-8 max-w-[1400px] space-y-4 px-4 sm:px-8">
        <Skeleton className="h-16 w-full !rounded-[28px]" />
        <div className="grid gap-4 lg:grid-cols-[5fr_7fr]">
          <Skeleton className="h-96 !rounded-[22px]" />
          <Skeleton className="h-[34rem] !rounded-[24px]" />
        </div>
      </div>
    </div>
  )
}
