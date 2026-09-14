// ชิ้นส่วนหน้า "คู่มือ API" — ใช้ร่วมกันทุกหน้า api-guide (อู่นอก, ยางถึงกำหนดเปลี่ยน)
// แยกออกมาเพราะหน้าพวกนี้เป็นหน้าที่ dev นอกทีมเปิดอ่าน ถ้าแต่ละหน้าคุมสไตล์เอง
// พอแก้หน้าหนึ่งอีกหน้าจะเพี้ยนตามไม่ทัน กลายเป็นเอกสารคนละยี่ห้อของระบบเดียวกัน

import type { ElementType, ReactNode } from "react"

export const guideFontThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }
export const guideFontHead = { fontFamily: "'Mitr', sans-serif" }

export function Section({ icon: Icon, title, children }: { icon: ElementType; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-[#14271C] dark:text-white" style={guideFontHead}>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1B8C4B]/10 text-[#1B8C4B]"><Icon size={16} /></span>
        {title}
      </h2>
      <div className="space-y-2 text-[13px] leading-relaxed text-[#4B5F54] dark:text-gray-300">{children}</div>
    </section>
  )
}

export function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-[#14271C] dark:bg-black/40 p-3.5 text-[12px] leading-relaxed text-[#c8e6d4]">
      <code>{children}</code>
    </pre>
  )
}

export function Param({ name, required, children }: { name: string; required?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <code className="mt-0.5 shrink-0 rounded-md bg-[#F6FAF7] dark:bg-white/5 px-1.5 py-0.5 text-[12px] font-semibold text-[#1B8C4B]">{name}</code>
      <span>
        {required
          ? <b className="mr-1 text-[#dc2626]">(จำเป็น)</b>
          : <span className="mr-1 text-[#9AA8A0]">(ไม่บังคับ)</span>}
        {children}
      </span>
    </li>
  )
}

/** ป้ายวิธีเรียก GET / POST / PATCH หน้าบรรทัด endpoint */
export function Method({ verb }: { verb: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" }) {
  const tone =
    verb === "GET"   ? "bg-[#1B8C4B]/10 text-[#1B8C4B]"
    : verb === "POST" ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
    : verb === "PATCH" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
    : "bg-red-500/10 text-red-600 dark:text-red-400"
  return <code className={`mr-2 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${tone}`}>{verb}</code>
}
