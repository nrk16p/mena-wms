"use client"
// /form-vendor/docs/[token] — vendor แนบเอกสารเพิ่มตามที่ฝ่ายจัดซื้อขอ (ลิงก์ใช้ได้ครั้งเดียว มีวันหมดอายุ)
import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Loader2 } from "lucide-react"
import { Hero, PublicSkeleton, VO_CSS, scrollTop, useLiff } from "./public-ui"
import { SlotUploader } from "./slot-uploader"
import { DOC_MAX_BYTES, DOC_MAX_FILES, DOC_TYPES } from "@/lib/vendor-onboarding/types"
import { ApiError, errMsg, getLink, submitLink, type LinkInfo, type UploadedFile } from "@/lib/vendor-onboarding/client"

type Load = { state: "loading" } | { state: "ok"; info: LinkInfo } | { state: "error"; status: number; message: string }

export function DocsLinkPage({ token }: { token: string }) {
  const { liff } = useLiff()
  const [load, setLoad] = useState<Load>({ state: "loading" })
  const [files, setFiles] = useState<Record<string, UploadedFile[]>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState("")
  const [done, setDone] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    getLink(token)
      .then((info) => { if (alive) setLoad({ state: "ok", info }) })
      .catch((e) => { if (alive) setLoad({ state: "error", status: e instanceof ApiError ? e.status : 0, message: errMsg(e) }) })
    return () => { alive = false }
  }, [token, reloadKey])

  const onBusy = useCallback((slot: string, b: boolean) => setBusy((x) => (x[slot] === b ? x : { ...x, [slot]: b })), [])
  const presignExtra = useMemo(() => ({}), [])

  if (load.state === "loading") return <PublicSkeleton title="แนบเอกสารเพิ่ม" />

  const shell = (title: string, body: React.ReactNode, sub?: string) => (
    <div className="vo">
      <style>{VO_CSS}</style>
      <Hero title={title} sub={sub ?? "Mena Transport"} />
      <section className="vo-card">{body}</section>
    </div>
  )

  if (load.state === "error") {
    if (load.status === 404) {
      return shell("ลิงก์ใช้ไม่ได้", <>
        <h2 className="vo-h2">ไม่พบลิงก์นี้</h2>
        <p className="vo-lead" style={{ margin: 0 }}>ลิงก์อาจพิมพ์ไม่ครบ ลองกดจากข้อความที่ได้รับอีกครั้ง หรือขอลิงก์ใหม่จากฝ่ายจัดซื้อ</p>
      </>)
    }
    return shell("แนบเอกสารเพิ่ม", <>
      <h2 className="vo-h2">เปิดลิงก์ไม่ได้</h2>
      <p className="vo-lead">{load.message}</p>
      <button type="button" className="vo-btn wide" onClick={() => { setLoad({ state: "loading" }); setReloadKey((k) => k + 1) }}>ลองใหม่</button>
    </>)
  }

  const info = load.info
  const sub = `${info.companyName} · ${info.ref}`

  if (done) {
    return (
      <div className="vo">
        <style>{VO_CSS}</style>
        <Hero title="ส่งเอกสารแล้ว" sub={sub} />
        <section className="vo-card vo-done">
          <div className="vo-done-check"><Check size={34} strokeWidth={3} aria-hidden /></div>
          <h2 className="vo-h2" style={{ marginTop: 14 }}>ได้รับเอกสารแล้ว ขอบคุณครับ</h2>
          <p className="vo-lead" style={{ margin: 0 }}>ฝ่ายจัดซื้อจะตรวจต่อจากเดิม ถ้ามีอะไรเพิ่มจะติดต่อกลับทางผู้ติดต่อที่ให้ไว้</p>
        </section>
        {liff && <div className="vo-bar"><button type="button" className="vo-btn wide" onClick={() => liff.closeWindow()}>ปิดหน้าต่าง</button></div>}
      </div>
    )
  }

  if (info.used) {
    return shell("ส่งเอกสารแล้ว", <>
      <h2 className="vo-h2">ลิงก์นี้ใช้ไปแล้ว</h2>
      <p className="vo-lead" style={{ margin: 0 }}>เอกสารชุดนี้ส่งถึงฝ่ายจัดซื้อแล้ว ถ้าต้องส่งเพิ่มอีก ขอลิงก์ใหม่จากฝ่ายจัดซื้อ</p>
    </>, sub)
  }

  if (info.expired || info.status !== "need_docs") {
    return shell("ลิงก์หมดอายุ", <>
      <h2 className="vo-h2">ลิงก์นี้หมดอายุแล้ว</h2>
      <p className="vo-lead" style={{ margin: 0 }}>ติดต่อฝ่ายจัดซื้อเพื่อขอลิงก์ใหม่ แจ้งเลขที่ใบสมัคร {info.ref} ได้เลย</p>
    </>, sub)
  }
  const limits = { maxFiles: info.maxFiles ?? DOC_MAX_FILES, maxBytes: info.maxBytes ?? DOC_MAX_BYTES, types: info.types ?? DOC_TYPES }
  const missing = info.requested.filter((r) => !(files[r.slot]?.length))
  const uploading = Object.values(busy).some(Boolean)
  const presignUrl = `/api/form-vendor/link/${encodeURIComponent(token)}/presign`

  async function submit() {
    setTouched(true)
    if (missing.length || uploading || saving) return
    setSaving(true); setSubmitError("")
    try {
      await submitLink(token, info.requested.map((r) => ({ slot: r.slot, files: files[r.slot] ?? [] })))
      setDone(true)
      scrollTop()
    } catch (e) {
      setSubmitError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="vo">
      <style>{VO_CSS}</style>
      <Hero title="แนบเอกสารเพิ่ม" sub={sub} />
      <section className="vo-card" aria-label="เอกสารที่ขอเพิ่ม">
        <p className="vo-lead">ฝ่ายจัดซื้อขอเอกสาร {info.requested.length} รายการด้านล่าง แนบให้ครบทุกรายการแล้วกดส่ง ลิงก์นี้ส่งได้ครั้งเดียว</p>
        {info.requested.map((r) => (
          <div key={r.slot} className="vo-slot">
            <div className="vo-slot-head">
              <div>
                <div className="vo-slot-name">{r.label}</div>
                {r.note && <div className="vo-slot-hint">ฝ่ายจัดซื้อฝากบอก: {r.note}</div>}
              </div>
              <span className={`vo-tag ${files[r.slot]?.length ? "ok" : "req"}`}>{files[r.slot]?.length ? "แนบแล้ว" : "ต้องแนบ"}</span>
            </div>
            <SlotUploader slot={r.slot} label={r.label} files={files[r.slot] ?? []} onChange={(l) => setFiles((f) => ({ ...f, [r.slot]: l }))}
              onBusy={onBusy} presignUrl={presignUrl} presignExtra={presignExtra} limits={limits} />
            {touched && !files[r.slot]?.length && <div className="vo-err">รายการนี้ต้องแนบ</div>}
          </div>
        ))}
      </section>
      <div className="vo-bar">
        {uploading && <div className="vo-info" role="status">รอไฟล์อัปให้เสร็จก่อนนะครับ</div>}
        {touched && missing.length > 0 && <div className="vo-alert" role="alert">ยังขาด {missing.length} รายการ แนบให้ครบก่อนส่ง</div>}
        {submitError && <div className="vo-alert" role="alert">{submitError}</div>}
        <button type="button" className="vo-btn wide" onClick={submit} disabled={saving || uploading}>
          {saving ? <><Loader2 size={18} className="animate-spin" aria-hidden /> กำลังส่ง…</> : "ส่งเอกสาร"}
        </button>
      </div>
    </div>
  )
}
