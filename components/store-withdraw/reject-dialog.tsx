"use client"

// สโตร์ปฏิเสธใบ: เหตุผล (บังคับ) + แนบรูป/ไฟล์ได้ถ้ามี (ไม่บังคับ)
import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AttachPicker, doneIds, isUploading, type Picked } from "./attach-picker"

export function RejectDialog({ no, onClose, onSubmit }: { no: string; onClose: () => void; onSubmit: (reason: string, attachmentIds: string[]) => void }) {
  const [reason, setReason] = useState("")
  const [files, setFiles] = useState<Picked[]>([])
  const bad = !reason.trim() || isUploading(files)
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-auto">
        <DialogHeader><DialogTitle>ปฏิเสธใบ {no}</DialogTitle></DialogHeader>
        <label htmlFor="sw-reject-reason" className="block text-xs font-medium text-gray-500">เหตุผล (ผู้ขอจะเห็นข้อความนี้)</label>
        <textarea id="sw-reject-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ของหมด รออะไหล่เข้า"
          className="w-full rounded-[11px] border border-[#E2E8E4] bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B] dark:border-white/10 dark:bg-[#0f1117] dark:text-white" />
        <AttachPicker no={no} context="reject" items={files} onChange={(f) => setFiles(f)} hint="แนบรูปประกอบได้ถ้ามี (ไม่บังคับ)" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-[#E2E8E4] px-4 py-2.5 text-sm dark:border-white/10">ปิด</button>
          <button type="button" data-testid="reject-submit" disabled={bad} onClick={() => onSubmit(reason.trim(), doneIds(files))} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">ปฏิเสธ</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
