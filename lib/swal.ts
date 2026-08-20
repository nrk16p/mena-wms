import Swal from "sweetalert2"

function darkOpts(): { background?: string; color?: string } {
  if (typeof document === "undefined") return {}
  if (!document.documentElement.classList.contains("dark")) return {}
  return { background: "#0f1117", color: "#f9fafb" }
}

export function swalConfirm(title: string, text?: string) {
  return Swal.fire({
    title,
    text,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "ยืนยัน",
    cancelButtonText: "ยกเลิก",
    confirmButtonColor: "#ef4444",
    reverseButtons: true,
    ...darkOpts(),
  })
}

export function swalDeleteConfirm(text: string) {
  return swalConfirm("ยืนยันการลบ?", text)
}

export function swalToast(icon: "success" | "error" | "warning" | "info", title: string) {
  return Swal.fire({
    icon,
    title,
    ...darkOpts(),
  })
}

export function swalError(text: string) {
  return Swal.fire({
    icon: "error",
    title: "เกิดข้อผิดพลาด",
    text,
    ...darkOpts(),
  })
}

/** ถามวันที่ (YYYY-MM-DD) — ใช้ตอนลากการ์ดเปลี่ยนสถานะ ต้องบอกวันคาดพ้นขั้นใหม่
 *  min = วันนี้ กันเผลอใส่วันที่ผ่านไปแล้ว · ยกเลิก = ไม่เปลี่ยนสถานะ */
export function swalStageEtaInput(status: string, today: string, preset: string) {
  return Swal.fire<string>({
    title: "คาดว่าจะพ้นเมื่อไหร่?",
    html: `เปลี่ยนเป็นสถานะ <b>${status}</b><br><span style="font-size:.85rem;opacity:.7">ระบุวันที่คาดว่าจะพ้นขั้นนี้ไปขั้นถัดไป</span>`,
    input: "date",
    inputValue: preset,
    inputAttributes: { min: today },
    showCancelButton: true,
    confirmButtonText: "เปลี่ยนสถานะ",
    cancelButtonText: "ยกเลิก",
    confirmButtonColor: "#1B8C4B",
    reverseButtons: true,
    inputValidator: (v) => (v ? null : "กรุณาระบุวันที่"),
    ...darkOpts(),
  })
}

export function swalRejectInput(sku: string) {
  return Swal.fire<string>({
    title: "ปฏิเสธ SKU",
    html: `<code style="font-size:0.8rem;opacity:0.65">${sku}</code>`,
    input: "textarea",
    inputLabel: "เหตุผลการปฏิเสธ (ไม่บังคับ)",
    inputPlaceholder: "เช่น ซ้ำกับ SKU-XXX, ข้อมูลไม่ครบ, ยี่ห้อไม่ถูกต้อง...",
    inputAttributes: { rows: "3" },
    showCancelButton: true,
    confirmButtonText: "ยืนยันปฏิเสธ",
    confirmButtonColor: "#dc2626",
    cancelButtonText: "ยกเลิก",
    reverseButtons: true,
    ...darkOpts(),
  })
}
